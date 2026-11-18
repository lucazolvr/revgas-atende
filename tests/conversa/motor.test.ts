import { describe, expect, it, vi } from 'vitest';
import { InterpretadorFalso } from '../../src/ia/interpretacao.js';
import { ehEmergencia } from '../../src/conversa/emergencia.js';
import { novaSessao, processar, type Deps, type Sessao } from '../../src/conversa/motor.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import type { ResultadoRegistro } from '../../src/vendas/registrar.js';

const catalogo = carregarCatalogo();

function deps(extra: Partial<Deps> = {}) {
  const registrar = vi.fn(async (): Promise<ResultadoRegistro> => ({ tipo: 'ok', id: 77 }));
  return { catalogo, interpretador: null, registrar, ...extra } satisfies Deps;
}

async function conversa(d: Deps, mensagens: string[], s: Sessao = novaSessao('5586999990000')) {
  let ultimas: Awaited<ReturnType<typeof processar>>['acoes'] = [];
  for (const m of mensagens) {
    const r = await processar(s, m, d);
    s = r.sessao;
    ultimas = r.acoes;
  }
  return { sessao: s, acoes: ultimas };
}

const textoDe = (acoes: { tipo: string; texto?: string }[]) => acoes.map((a) => a.texto ?? '').join('\n');

describe('motor da conversa (menus, sem IA)', () => {
  it('faz um pedido completo e registra uma vez', async () => {
    const d = deps();
    const { sessao, acoes } = await conversa(d, [
      'oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'pi', '1', '1',
    ]);
    expect(sessao.estado).toBe('REGISTRADO');
    expect(sessao.vendaId).toBe(77);
    expect(d.registrar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.registrar).mock.calls[0]![0]).toMatchObject({
      nome: 'Maria', produto: 'P13', quantidade: 2, pagamento: 'PIX',
      endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
    });
    expect(textoDe(acoes)).toContain('77');
  });

  it('mostra o resumo com o total do catálogo', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1']);
    expect(sessao.estado).toBe('RESUMO');
    expect(textoDe(acoes)).toContain('R$ 220,00');
  });

  it('"1" repetido depois de registrado não cria outra venda', async () => {
    const d = deps();
    const { acoes } = await conversa(d, ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1', '1', '1']);
    expect(d.registrar).toHaveBeenCalledTimes(1);
    expect(textoDe(acoes)).toContain('já está registrado');
  });

  it('dinheiro pede troco e valida contra o total', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '2', '100']);
    expect(sessao.estado).toBe('TROCO');
    expect(textoDe(acoes)).toContain('maior que o total');
    const r = await processar(sessao, 'R$ 250', deps());
    expect(r.sessao.pedido.trocoParaCentavos).toBe(25000);
    expect(r.sessao.estado).toBe('RESUMO');
  });

  it('corrige só o endereço', async () => {
    const { sessao } = await conversa(deps(), [
      'oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1', '2', '3',
      'Av. Frei Serafim', '200', 'Centro', 'Teresina', 'PI',
    ]);
    expect(sessao.estado).toBe('RESUMO');
    expect(sessao.pedido.endereco?.logradouro).toBe('Av. Frei Serafim');
    expect(sessao.pedido.nome).toBe('Maria');
  });

  it('cancela no resumo', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1', '3']);
    expect(sessao.estado).toBe('INICIO');
    expect(textoDe(acoes)).toContain('cancelado');
  });

  it('duas respostas inválidas seguidas transferem para humano', async () => {
    const { acoes } = await conversa(deps(), ['oi', 'Maria', '1', 'muitos', 'sei lá']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'nao_entendi' }));
  });

  it('cheiro de gás em qualquer etapa → segurança + transferência urgente', async () => {
    const { acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'tô sentindo um cheiro de gás aqui']);
    expect(textoDe(acoes)).toContain('193');
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'vazamento' }));
  });

  it('pedir atendente transfere com o resumo do que já foi coletado', async () => {
    const { acoes } = await conversa(deps(), ['oi', 'Maria', 'quero falar com um atendente']);
    const t = acoes.find((a) => a.tipo === 'transferir');
    expect(t).toMatchObject({ motivo: 'humano' });
    expect(t && 'resumo' in t && t.resumo).toContain('Maria');
  });

  it('venda incerta (timeout) transfere para verificar', async () => {
    const d = deps({ registrar: vi.fn(async (): Promise<ResultadoRegistro> => ({ tipo: 'incerta' })) });
    const { acoes } = await conversa(d, ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1', '1']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'verificar_venda' }));
  });

  it('nova mensagem depois de registrado começa outro pedido', async () => {
    const { sessao } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1', '1', 'boa noite']);
    expect(sessao.vendaId).toBeUndefined();
    expect(sessao.estado).not.toBe('REGISTRADO');
  });
});

describe('motor da conversa (com IA)', () => {
  const frase = 'manda 2 botijão pra Rua Nova 10, Centro, Teresina PI, pago no pix';
  const ia = new InterpretadorFalso({
    [frase]: {
      intencao: 'fazer_pedido',
      entidades: {
        produto: 'P13', quantidade: 2, pagamento: 'PIX',
        endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
      },
    },
    'sou a Ana': { intencao: 'informar_dados', entidades: { nome: 'Ana' } },
  });

  it('texto livre preenche tudo e só pergunta o nome', async () => {
    const { sessao, acoes } = await conversa(deps({ interpretador: ia }), [frase]);
    expect(sessao.estado).toBe('NOME');
    expect(textoDe(acoes)).toContain('nome');
    const r = await processar(sessao, 'sou a Ana', deps({ interpretador: ia }));
    expect(r.sessao.estado).toBe('RESUMO');
    expect(r.sessao.pedido.nome).toBe('Ana');
  });

  it('IA fora do ar (null) cai nos menus', async () => {
    const { sessao } = await conversa(deps({ interpretador: new InterpretadorFalso({}) }), ['oi', 'Maria', '1']);
    expect(sessao.estado).toBe('QUANTIDADE');
  });
});

describe('ehEmergencia', () => {
  it('detecta variações', () => {
    expect(ehEmergencia('CHEIRO DE GÁS')).toBe(true);
    expect(ehEmergencia('o botijão está vazando')).toBe(true);
    expect(ehEmergencia('quero gás')).toBe(false);
  });
});
