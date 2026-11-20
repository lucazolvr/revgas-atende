import { describe, expect, it } from 'vitest';
import { ATRIBUTOS, ETIQUETAS, HORARIO, NOME_CAIXA, TODAS_ETIQUETAS, configurarPainel, type ApiConta } from '../../src/canal/painel.js';
import { RESPOSTAS_PRONTAS, SEGURANCA } from '../../src/conversa/mensagens.js';

type Registro = Record<string, unknown> & { id: number };

/** Chatwoot em memória com as rotas e os formatos de resposta da v4 que o script usa. */
function chatwootFalso(caixas: string[] = [NOME_CAIXA]) {
  const db: Record<string, Registro[]> = {
    labels: [],
    canned_responses: [],
    custom_attribute_definitions: [],
    inboxes: caixas.map((name, i) => ({ id: i + 1, name })),
  };
  const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
  const envelope: Record<string, string | undefined> = {
    labels: 'label',
    canned_responses: 'canned_response',
    custom_attribute_definitions: 'custom_attribute_definition',
  };
  let proximoId = 100;

  const cw: ApiConta = async <T,>(caminho: string, metodo = 'GET', corpo?: unknown) => {
    chamadas.push({ metodo, caminho, corpo });
    const [recurso, id] = caminho.replace(/\?.*/, '').split('/').filter(Boolean) as [string, string?];
    const tabela = db[recurso];
    if (!tabela) throw new Error(`rota desconhecida ${caminho}`);
    const dados = (envelope[recurso] ? (corpo as Record<string, unknown>)?.[envelope[recurso]!] : corpo) as Record<string, unknown>;
    if (metodo === 'GET') {
      // labels e inboxes vêm dentro de { payload }, os outros como lista.
      return (recurso === 'labels' || recurso === 'inboxes' ? { payload: tabela } : tabela) as T;
    }
    if (metodo === 'POST') {
      const chave = recurso === 'labels' ? 'title' : recurso === 'canned_responses' ? 'short_code' : 'attribute_key';
      // Como no Chatwoot: a chave do atributo é única por modelo (conversa, contato...), não na conta.
      const mesmoModelo = (r: Registro) => recurso !== 'custom_attribute_definitions' || r.attribute_model === dados.attribute_model;
      if (tabela.some((r) => r[chave] === dados[chave] && mesmoModelo(r))) throw new Error(`422: ${chave} duplicado`);
      const novo = { id: proximoId++, ...dados };
      tabela.push(novo);
      return novo as T;
    }
    const atual = tabela.find((r) => r.id === Number(id));
    if (!atual) throw new Error(`404 ${caminho}`);
    Object.assign(atual, dados);
    return atual as T;
  };
  return { cw, db, chamadas };
}

describe('configurarPainel', () => {
  it('cria tudo do zero', async () => {
    const { cw, db } = chatwootFalso();
    await configurarPainel(cw);
    expect(db.labels!.map((l) => l.title).sort()).toEqual(TODAS_ETIQUETAS.map((e) => e.title).sort());
    expect(db.labels!.every((l) => l.show_on_sidebar === true && /^#[0-9A-F]{6}$/.test(String(l.color)))).toBe(true);
    expect(db.canned_responses!.find((r) => r.short_code === 'seguranca')?.content).toBe(SEGURANCA);
    expect(db.canned_responses).toHaveLength(Object.keys(RESPOSTAS_PRONTAS).length);
    expect(db.custom_attribute_definitions!.map((a) => a.attribute_key)).toEqual(ATRIBUTOS.map((a) => a.attribute_key));
    expect(db.custom_attribute_definitions!.every((a) => a.attribute_model === 'conversation_attribute')).toBe(true);
    expect(db.inboxes![0]).toMatchObject({ working_hours_enabled: true, timezone: 'America/Fortaleza', working_hours: HORARIO });
  });

  it('rodar de novo não duplica nem altera nada', async () => {
    const { cw, db, chamadas } = chatwootFalso();
    await configurarPainel(cw);
    const antes = structuredClone(db);
    chamadas.length = 0;
    const log = await configurarPainel(cw);
    expect(db).toEqual(antes);
    // Na segunda vez só leituras, mais o PATCH do horário (que é idempotente).
    expect(chamadas.filter((c) => c.metodo !== 'GET').map((c) => c.caminho)).toEqual(['/inboxes/1']);
    expect(log.filter((l) => l.startsWith('+') || l.startsWith('~'))).toEqual([]);
  });

  it('corrige o que o bot criou sem cor e o texto que mudou', async () => {
    const { cw, db } = chatwootFalso();
    db.labels!.push({ id: 1, title: 'vazamento', description: null, color: '#1f93ff', show_on_sidebar: false });
    db.canned_responses!.push({ id: 2, short_code: 'saiu', content: 'texto antigo' });
    const log = await configurarPainel(cw);
    expect(db.labels!.filter((l) => l.title === 'vazamento')).toEqual([
      { id: 1, title: 'vazamento', description: expect.stringContaining('vazamento'), color: '#DC2626', show_on_sidebar: true },
    ]);
    expect(db.canned_responses!.find((r) => r.id === 2)?.content).toBe(RESPOSTAS_PRONTAS.saiu);
    expect(log).toContain('~ etiqueta vazamento');
    expect(log).toContain('~ resposta /saiu');
  });

  it('cor em minúsculas no Chatwoot conta como a mesma cor', async () => {
    const { cw, db, chamadas } = chatwootFalso();
    const e = TODAS_ETIQUETAS[0]!;
    db.labels!.push({ id: 1, ...e, color: e.color.toLowerCase(), show_on_sidebar: true });
    await configurarPainel(cw);
    expect(chamadas.some((c) => c.caminho === '/labels/1')).toBe(false);
  });

  it('não confunde atributo de contato com o de conversa', async () => {
    const { cw, db } = chatwootFalso();
    db.custom_attribute_definitions!.push({ id: 1, attribute_key: 'endereco', attribute_model: 'contact_attribute' });
    await configurarPainel(cw);
    expect(db.custom_attribute_definitions!.filter((a) => a.attribute_key === 'endereco')).toHaveLength(2);
  });

  it('sem a caixa do WhatsApp pede para rodar o setup', async () => {
    const { cw } = chatwootFalso(['Outra caixa']);
    await expect(configurarPainel(cw)).rejects.toThrow('npm run setup');
  });
});

describe('definições do painel', () => {
  it('todo motivo de transferência tem etiqueta com nome aceito pelo Chatwoot', () => {
    for (const lista of Object.values(ETIQUETAS)) {
      expect(lista.length).toBeGreaterThan(0);
      for (const e of lista) {
        expect(e.title).toMatch(/^[a-z0-9_-]+$/);
        expect(TODAS_ETIQUETAS).toContain(e);
      }
    }
    expect(ETIQUETAS.vazamento.map((e) => e.title)).toEqual(['vazamento', 'urgente']);
  });

  it('horário igual ao da FAQ: seg–sáb 7h–20h, domingo 8h–13h', () => {
    const domingo = HORARIO.find((h) => h.day_of_week === 0)!;
    expect([domingo.open_hour, domingo.close_hour]).toEqual([8, 13]);
    for (const h of HORARIO.filter((x) => x.day_of_week !== 0)) expect([h.open_hour, h.close_hour]).toEqual([7, 20]);
    expect(HORARIO).toHaveLength(7);
  });

  it('códigos das respostas prontas sem espaço nem barra', () => {
    for (const codigo of Object.keys(RESPOSTAS_PRONTAS)) expect(codigo).toMatch(/^[a-z0-9_-]+$/);
  });
});
