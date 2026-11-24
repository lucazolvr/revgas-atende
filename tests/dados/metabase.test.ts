import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { layout, lerConsultas, montarPainel, NOME_BANCO, NOME_COLECAO, NOME_PAINEL, visualizacao } from '../../src/dados/metabase.js';

const md = readFileSync('docs/metabase.md', 'utf8');
const conexao = { host: 'postgres', porta: 5432, banco: 'revgas', usuario: 'metabase_leitura', senha: 'x' };

describe('lerConsultas (docs/metabase.md)', () => {
  it('lê as 8 consultas, com título limpo, SQL e tipo de gráfico', () => {
    const c = lerConsultas(md);
    expect(c).toHaveLength(8);
    expect(c[0]).toMatchObject({ titulo: 'Requisições recentes', display: 'table' });
    expect(c[1]).toMatchObject({ titulo: 'Requisições por rota e status', display: 'bar', empilhado: true });
    expect(c[5]).toMatchObject({ display: 'pie', dimensoes: ['origem'] });
    for (const q of c) {
      expect(q.sql).toMatch(/^select[\s\S]*from revgas\.(chamadas_api|eventos)/);
      expect(q.sql).not.toMatch(/```/);
    }
  });

  it('as colunas citadas no gráfico existem no SQL', () => {
    for (const q of lerConsultas(md)) {
      for (const col of [...q.dimensoes, ...q.metricas]) expect(q.sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('recusa um tipo de gráfico desconhecido', () => {
    expect(() => lerConsultas('### 1. X\n\n<!-- metabase: {"display":"mapa"} -->\n\n```sql\nselect 1\n```')).toThrow(/inválido/);
  });
});

describe('visualizacao e layout', () => {
  it('barras empilhadas, pizza e tabela', () => {
    const [tabela, empilhado, , , , pizza] = lerConsultas(md);
    expect(visualizacao(tabela!)).toEqual({});
    expect(visualizacao(empilhado!)).toMatchObject({ 'graph.dimensions': ['rota', 'status'], 'stackable.stack_type': 'stacked' });
    expect(visualizacao(pizza!)).toEqual({ 'pie.dimension': 'origem', 'pie.metric': 'cancelamentos' });
  });

  it('a tabela ao vivo ocupa a largura toda; o resto vai em duas colunas sem sobrepor', () => {
    expect(layout(0)).toEqual({ row: 0, col: 0, size_x: 24, size_y: 8 });
    const pos = [1, 2, 3, 4].map(layout);
    expect(pos.map((p) => p.col)).toEqual([0, 12, 0, 12]);
    expect(pos[2]!.row).toBe(pos[0]!.row + 7);
  });
});

function metabaseFalso(estado: { bancos?: any[]; colecoes?: any[]; itens?: any[] } = {}) {
  let id = 100;
  const chamadas: [string, string, any][] = [];
  const chamar = vi.fn(async (metodo: string, caminho: string, corpo?: any) => {
    chamadas.push([metodo, caminho, corpo]);
    if (metodo === 'GET' && caminho === '/database') return { data: estado.bancos ?? [] };
    if (metodo === 'GET' && caminho === '/collection') return estado.colecoes ?? [];
    if (metodo === 'GET' && caminho.startsWith('/collection/')) return { data: estado.itens ?? [] };
    if (metodo === 'POST') return { id: ++id };
    return {};
  });
  return { chamar, chamadas };
}

describe('montarPainel', () => {
  it('cria conexão só leitura, coleção, 8 perguntas e o painel com 8 cartões', async () => {
    const { chamar, chamadas } = metabaseFalso();
    await montarPainel(chamar, lerConsultas(md), conexao);
    const banco = chamadas.find(([m, c]) => m === 'POST' && c === '/database')![2];
    expect(banco).toMatchObject({ engine: 'postgres', name: NOME_BANCO });
    expect(banco.details).toMatchObject({ dbname: 'revgas', user: 'metabase_leitura', 'schema-filters-patterns': 'revgas' });
    expect(chamadas.filter(([m, c]) => m === 'POST' && c === '/card')).toHaveLength(8);
    const card = chamadas.find(([m, c]) => m === 'POST' && c === '/card')![2];
    expect(card.dataset_query).toMatchObject({ type: 'native', native: { query: expect.stringMatching(/^select/) } });
    const put = chamadas.find(([m, c]) => m === 'PUT' && c.startsWith('/dashboard/'))![2];
    expect(put.dashcards).toHaveLength(8);
  });

  it('rodar de novo reaproveita tudo pelo nome, sem criar nada', async () => {
    const consultas = lerConsultas(md);
    const { chamar, chamadas } = metabaseFalso({
      bancos: [{ id: 1, name: NOME_BANCO }],
      colecoes: [{ id: 2, name: NOME_COLECAO }],
      itens: [
        ...consultas.map((c, i) => ({ id: 10 + i, model: 'card', name: c.titulo })),
        { id: 50, model: 'dashboard', name: NOME_PAINEL },
      ],
    });
    const r = await montarPainel(chamar, consultas, conexao);
    expect(chamadas.filter(([m]) => m === 'POST')).toHaveLength(0);
    expect(r.painelId).toBe(50);
    const put = chamadas.find(([m, c]) => m === 'PUT' && c === '/dashboard/50')![2];
    expect(put.dashcards.map((d: any) => d.card_id)).toEqual(consultas.map((_, i) => 10 + i));
  });
});
