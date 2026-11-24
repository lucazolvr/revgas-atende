/**
 * Monta no Metabase o painel "Integração RevGás" a partir de docs/metabase.md (issue #40).
 *
 * O Markdown é a fonte única: cada "### N. Título" traz um comentário
 * `<!-- metabase: {"display": ..., "dimensoes": [...], "metricas": [...]} -->` e um bloco ```sql.
 * Pode rodar de novo sem duplicar nada: reaproveita a conexão, a coleção, as perguntas (pelo nome)
 * e o painel, e só atualiza o SQL e o layout.
 */

export type Consulta = {
  titulo: string;
  sql: string;
  display: 'table' | 'bar' | 'line' | 'pie';
  dimensoes: string[];
  metricas: string[];
  empilhado: boolean;
};

const BLOCO = /^### (.+)\n+<!-- metabase: (\{.*\}) -->\n[\s\S]*?```sql\n([\s\S]*?)```/gm;
const DISPLAYS = new Set(['table', 'bar', 'line', 'pie']);

/** Lê as consultas do docs/metabase.md. O título perde o tipo de gráfico entre parênteses. */
export function lerConsultas(markdown: string): Consulta[] {
  const consultas: Consulta[] = [];
  for (const m of markdown.replace(/\r\n/g, '\n').matchAll(BLOCO)) {
    const meta = JSON.parse(m[2]!) as Partial<Consulta>;
    if (!meta.display || !DISPLAYS.has(meta.display)) throw new Error(`Tipo de gráfico inválido em "${m[1]}"`);
    consultas.push({
      titulo: m[1]!.replace(/\s*\([^)]*\)\s*$/, '').replace(/^\d+\.\s*/, '').trim(),
      sql: m[3]!.trim(),
      display: meta.display,
      dimensoes: meta.dimensoes ?? [],
      metricas: meta.metricas ?? [],
      empilhado: meta.empilhado ?? false,
    });
  }
  return consultas;
}

/** Configuração de visualização do Metabase para a consulta. */
export function visualizacao(c: Consulta): Record<string, unknown> {
  if (c.display === 'table') return {};
  if (c.display === 'pie') return { 'pie.dimension': c.dimensoes[0], 'pie.metric': c.metricas[0] };
  return {
    'graph.dimensions': c.dimensoes,
    'graph.metrics': c.metricas,
    ...(c.empilhado ? { 'stackable.stack_type': 'stacked' } : {}),
  };
}

/** Posição no grid de 24 colunas: a 1ª consulta (tabela ao vivo) ocupa a largura toda; o resto, duas por linha. */
export function layout(indice: number): { row: number; col: number; size_x: number; size_y: number } {
  if (indice === 0) return { row: 0, col: 0, size_x: 24, size_y: 8 };
  const k = indice - 1;
  return { row: 8 + Math.floor(k / 2) * 7, col: (k % 2) * 12, size_x: 12, size_y: 7 };
}

export type Conexao = { host: string; porta: number; banco: string; usuario: string; senha: string };

type Chamar = (metodo: string, caminho: string, corpo?: unknown) => Promise<any>;

export const NOME_BANCO = 'RevGás (integração)';
export const NOME_COLECAO = 'Integração RevGás';
export const NOME_PAINEL = 'Integração RevGás';

/** Cliente mínimo da API do Metabase com chave de API (header x-api-key). */
export function clienteMetabase(url: string, chave: string, f: typeof fetch = fetch): Chamar {
  return async (metodo, caminho, corpo) => {
    const r = await f(`${url}/api${caminho}`, {
      method: metodo,
      headers: { 'x-api-key': chave, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`Metabase ${metodo} ${caminho}: HTTP ${r.status} ${texto.slice(0, 200)}`);
    return texto ? JSON.parse(texto) : null;
  };
}

const lista = (r: any): any[] => (Array.isArray(r) ? r : (r?.data ?? []));

/** Garante conexão, coleção, perguntas e painel. Devolve o id do painel e um registro do que fez. */
export async function montarPainel(chamar: Chamar, consultas: Consulta[], conexao: Conexao): Promise<{ painelId: number; log: string[] }> {
  const log: string[] = [];

  // 1. Conexão com o Postgres (usuário só leitura, só o schema revgas)
  const detalhes = {
    host: conexao.host,
    port: conexao.porta,
    dbname: conexao.banco,
    user: conexao.usuario,
    password: conexao.senha,
    ssl: false,
    'schema-filters-type': 'inclusion',
    'schema-filters-patterns': 'revgas',
  };
  let banco = lista(await chamar('GET', '/database')).find((d) => d.name === NOME_BANCO);
  if (banco) {
    await chamar('PUT', `/database/${banco.id}`, { details: detalhes });
    log.push(`= conexão "${NOME_BANCO}" (id ${banco.id}) atualizada`);
  } else {
    banco = await chamar('POST', '/database', { engine: 'postgres', name: NOME_BANCO, details: detalhes });
    log.push(`+ conexão "${NOME_BANCO}" (id ${banco.id})`);
  }

  // 2. Coleção
  let colecao = lista(await chamar('GET', '/collection')).find((c) => c.name === NOME_COLECAO && !c.archived);
  if (!colecao) {
    colecao = await chamar('POST', '/collection', { name: NOME_COLECAO, parent_id: null });
    log.push(`+ coleção "${NOME_COLECAO}"`);
  }
  const itens = lista(await chamar('GET', `/collection/${colecao.id}/items?models=card&models=dashboard`));

  // 3. Perguntas (uma por consulta, pelo nome)
  const cartoes: number[] = [];
  for (const c of consultas) {
    const corpo = {
      name: c.titulo,
      type: 'question',
      display: c.display,
      visualization_settings: visualizacao(c),
      collection_id: colecao.id,
      dataset_query: { database: banco.id, type: 'native', native: { query: c.sql, 'template-tags': {} } },
    };
    const existente = itens.find((i) => i.model === 'card' && i.name === c.titulo);
    if (existente) {
      await chamar('PUT', `/card/${existente.id}`, corpo);
      cartoes.push(existente.id);
      log.push(`= pergunta "${c.titulo}"`);
    } else {
      const novo = await chamar('POST', '/card', corpo);
      cartoes.push(novo.id);
      log.push(`+ pergunta "${c.titulo}"`);
    }
  }

  // 4. Painel com as perguntas no grid
  let painel = itens.find((i) => i.model === 'dashboard' && i.name === NOME_PAINEL);
  if (!painel) {
    painel = await chamar('POST', '/dashboard', {
      name: NOME_PAINEL,
      collection_id: colecao.id,
      description: 'Requisições do bot à API RevGás e eventos de atendimento (sem dados pessoais). SQL em docs/metabase.md.',
    });
    log.push(`+ painel "${NOME_PAINEL}"`);
  } else {
    log.push(`= painel "${NOME_PAINEL}"`);
  }
  await chamar('PUT', `/dashboard/${painel.id}`, {
    dashcards: cartoes.map((card_id, i) => ({ id: -(i + 1), card_id, ...layout(i), parameter_mappings: [], visualization_settings: {} })),
  });
  return { painelId: painel.id, log };
}
