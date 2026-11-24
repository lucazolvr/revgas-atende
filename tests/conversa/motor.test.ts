import { describe, expect, it, vi } from 'vitest';
import { InterpretadorFalso } from '../../src/ia/interpretacao.js';
import { ehEmergencia } from '../../src/conversa/emergencia.js';
import { novaSessao, processar, separarCidadeUf, type Deps, type Sessao } from '../../src/conversa/motor.js';
import * as M from '../../src/conversa/mensagens.js';
import type { HistoricoVenda, VendaResumo } from '../../src/vendas/api-revgas.js';
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
      'oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1',
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
    const { sessao, acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1']);
    expect(sessao.estado).toBe('RESUMO');
    expect(textoDe(acoes)).toContain('R$ 220,00');
  });

  it('"1" repetido depois de registrado não cria outra venda', async () => {
    const d = deps();
    const { acoes } = await conversa(d, ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1', '1']);
    expect(d.registrar).toHaveBeenCalledTimes(1);
    expect(textoDe(acoes)).toContain('já está registrado');
  });

  it('dinheiro pede troco e valida contra o total', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '2', '100']);
    expect(sessao.estado).toBe('TROCO');
    expect(textoDe(acoes)).toContain('maior que o total');
    const r = await processar(sessao, 'R$ 250', deps());
    expect(r.sessao.pedido.trocoParaCentavos).toBe(25000);
    expect(r.sessao.estado).toBe('RESUMO');
  });

  it('corrige só o endereço', async () => {
    const { sessao } = await conversa(deps(), [
      'oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '2', '3',
      'Av. Frei Serafim', '200', 'Centro', 'Teresina',
    ]);
    expect(sessao.estado).toBe('RESUMO');
    expect(sessao.pedido.endereco?.logradouro).toBe('Av. Frei Serafim');
    expect(sessao.pedido.nome).toBe('Maria');
  });

  it('cancela no resumo', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '3']);
    expect(sessao.estado).toBe('INICIO');
    expect(textoDe(acoes)).toContain('cancelado');
  });

  it('cancela no meio do pedido, pelos menus', async () => {
    for (const pedido of ['cancelar', 'Quero desistir']) {
      const { sessao, acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', pedido]);
      expect(sessao.estado).toBe('INICIO');
      expect(sessao.pedido.nome).toBeUndefined();
      expect(textoDe(acoes)).toContain('cancelado');
    }
  });

  it('"cancelar" antes de começar o pedido não responde "cancelado"', async () => {
    const { acoes } = await conversa(deps(), ['cancelar']);
    expect(textoDe(acoes)).not.toContain('cancelado');
  });

  it('duas respostas inválidas seguidas transferem para humano', async () => {
    const { acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', 'muitos', 'sei lá']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'nao_entendi' }));
  });

  it('cheiro de gás em qualquer etapa → segurança + transferência urgente', async () => {
    const { acoes } = await conversa(deps(), ['oi', '1', 'Maria', '1', '2', 'tô sentindo um cheiro de gás aqui']);
    expect(textoDe(acoes)).toContain('193');
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'vazamento' }));
  });

  it('pedir atendente transfere com o resumo do que já foi coletado', async () => {
    const { acoes } = await conversa(deps(), ['oi', '1', 'Maria', 'quero falar com um atendente']);
    const t = acoes.find((a) => a.tipo === 'transferir');
    expect(t).toMatchObject({ motivo: 'humano' });
    expect(t && 'resumo' in t && t.resumo).toContain('Maria');
  });

  it('venda incerta (timeout) transfere para verificar', async () => {
    const d = deps({ registrar: vi.fn(async (): Promise<ResultadoRegistro> => ({ tipo: 'incerta' })) });
    const { acoes } = await conversa(d, ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'verificar_venda' }));
  });

  it('sem IA entende "meu nome é Ana", "pode confirmar" e "quero corrigir"', async () => {
    const d = deps();
    const base = ['oi', '1', 'meu nome é Ana', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1'];
    const resumo = await conversa(d, base);
    expect(resumo.sessao.pedido.nome).toBe('Ana');
    expect((await processar(resumo.sessao, 'quero corrigir', d)).sessao.estado).toBe('CORRIGIR');
    expect((await processar(resumo.sessao, 'pode confirmar', d)).sessao.estado).toBe('REGISTRADO');
  });

  it('nova mensagem depois de registrado começa outro pedido', async () => {
    const { sessao } = await conversa(deps(), ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1', 'boa noite']);
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

  it('diz à IA qual parte do endereço foi perguntada', async () => {
    const etapas: string[] = [];
    const espiao = { interpretar: async (_t: string, etapa: string) => (etapas.push(etapa), null) };
    await conversa(deps({ interpretador: espiao }), ['oi', '1', 'Maria', '1', '2', 'Quadra 12', '5', 'Dirceu']);
    expect(etapas).toContain('ENDERECO (pergunta atual: bairro)');
  });

  it('IA fora do ar (null) cai nos menus', async () => {
    const { sessao } = await conversa(deps({ interpretador: new InterpretadorFalso({}) }), ['oi', '1', 'Maria', '1']);
    expect(sessao.estado).toBe('QUANTIDADE');
  });

  it('dúvida relevante usa a resposta da base de conhecimento', async () => {
    const pergunta = 'vocês entregam no domingo?';
    const rag = vi.fn(async () => 'Entregamos no domingo das 8h às 12h.');
    const { acoes } = await conversa(deps({
      interpretador: new InterpretadorFalso({ [pergunta]: { intencao: 'duvida', entidades: {} } }),
      responderDuvida: rag,
    }), [pergunta]);

    expect(rag).toHaveBeenCalledWith(pergunta);
    expect(textoDe(acoes)).toContain('domingo das 8h às 12h');
  });

  it('dúvida fora da base usa DUVIDA_SEM_RESPOSTA', async () => {
    const pergunta = 'qual a previsão do tempo?';
    const { acoes } = await conversa(deps({
      interpretador: new InterpretadorFalso({ [pergunta]: { intencao: 'duvida', entidades: {} } }),
      responderDuvida: async () => null,
    }), [pergunta]);

    expect(textoDe(acoes)).toContain('atendente');
  });
});

describe('recomendações da avaliação (issue #2)', () => {
  const atePagamento = ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina'];

  it('"cartão" sem tipo: pergunta débito ou crédito, sem contar como "não entendi"', async () => {
    const d = deps();
    const { sessao, acoes } = await conversa(d, [...atePagamento, 'cartão']);
    expect(sessao.estado).toBe('PAGAMENTO');
    expect(sessao.falhas).toBe(0);
    expect(textoDe(acoes)).toContain('débito ou de crédito');
    const r = await processar(sessao, 'débito', d);
    expect(r.sessao.pedido.pagamento).toBe('CARTAO_DE_DEBITO');
    expect(r.sessao.estado).toBe('RESUMO');
  });

  it('não aceita o tipo de cartão que a IA chutou', async () => {
    const ia = new InterpretadorFalso({
      cartão: { intencao: 'informar_dados', entidades: { pagamento: 'CARTAO_DE_CREDITO' } },
      'cartão de crédito': { intencao: 'informar_dados', entidades: { pagamento: 'CARTAO_DE_CREDITO' } },
    });
    const d = deps({ interpretador: ia });
    const { sessao } = await conversa(d, [...atePagamento, 'cartão']);
    expect(sessao.pedido.pagamento).toBeUndefined();
    expect(sessao.estado).toBe('PAGAMENTO');
    // quando o cliente diz o tipo, vale normalmente
    expect((await processar(sessao, 'cartão de crédito', d)).sessao.pedido.pagamento).toBe('CARTAO_DE_CREDITO');
  });

  it('na 3ª correção do mesmo pedido, transfere para um atendente', async () => {
    const d = deps();
    let { sessao } = await conversa(d, [...atePagamento, '1']);
    for (let i = 1; i <= 2; i++) {
      sessao = (await conversa(d, ['2', '4', '1'], sessao)).sessao; // corrigir → pagamento → PIX
      expect(sessao.estado).toBe('RESUMO');
    }
    const { acoes } = await processar(sessao, '2', d);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'correcoes' }));
    expect(d.registrar).not.toHaveBeenCalled();
  });
});

describe('cidade e estado', () => {
  const ateCidade = ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro'];

  it('pergunta cidade e estado juntos, numa mensagem só', async () => {
    const { sessao, acoes } = await conversa(deps(), ateCidade);
    expect(sessao.estado).toBe('ENDERECO');
    expect(textoDe(acoes)).toContain('Qual a cidade e o estado?');
  });

  it('cidade da área de entrega: o estado sai sozinho e pula para o pagamento', async () => {
    for (const [cidade, uf] of [['Teresina', 'PI'], ['timon', 'MA']] as const) {
      const { sessao } = await conversa(deps(), [...ateCidade, cidade]);
      expect(sessao.pedido.endereco?.uf).toBe(uf);
      expect(sessao.estado).toBe('PAGAMENTO');
    }
  });

  it('cidade e estado na mesma resposta', async () => {
    const { sessao } = await conversa(deps(), [...ateCidade, 'Parnaíba - PI']);
    expect(sessao.pedido.endereco).toMatchObject({ cidade: 'Parnaíba', uf: 'PI' });
    expect(sessao.estado).toBe('PAGAMENTO');
  });

  it('cidade fora da área sem estado: aí sim pergunta o estado', async () => {
    const { sessao, acoes } = await conversa(deps(), [...ateCidade, 'Parnaíba']);
    expect(sessao.estado).toBe('ENDERECO');
    expect(textoDe(acoes)).toContain('Qual o estado?');
    expect((await processar(sessao, 'PI', deps())).sessao.estado).toBe('PAGAMENTO');
  });

  it('com IA: a cidade extraída já completa o estado', async () => {
    const frase = 'manda 2 botijão pra Rua Nova 10, Centro, Teresina, no pix';
    const ia = new InterpretadorFalso({
      [frase]: { intencao: 'fazer_pedido', entidades: { produto: 'P13', quantidade: 2, pagamento: 'PIX', endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina' } } },
    });
    const { sessao } = await conversa(deps({ interpretador: ia }), [frase]);
    expect(sessao.pedido.endereco?.uf).toBe('PI');
    expect(sessao.estado).toBe('NOME'); // só falta o nome
  });

  it('não troca o estado que o cliente informou', async () => {
    const { sessao } = await conversa(deps(), [...ateCidade, 'Teresina MA']);
    expect(sessao.pedido.endereco?.uf).toBe('MA');
  });

  it('separarCidadeUf', () => {
    expect(separarCidadeUf('Teresina/PI')).toEqual({ cidade: 'Teresina', uf: 'PI' });
    expect(separarCidadeUf('São José do Piauí, piaui')).toEqual({ cidade: 'São José do Piauí', uf: 'PI' });
    expect(separarCidadeUf('Timon')).toEqual({ cidade: 'Timon' });
    expect(separarCidadeUf('Bom Jesus')).toEqual({ cidade: 'Bom Jesus' }); // "Jesus" não é UF
  });
});

describe('ehEmergencia', () => {
  it('detecta variações', () => {
    expect(ehEmergencia('CHEIRO DE GÁS')).toBe(true);
    expect(ehEmergencia('o botijão está vazando')).toBe(true);
    expect(ehEmergencia('quero gás')).toBe(false);
  });
});

describe('menu principal, acompanhar e cancelar (Tarefa 3)', () => {
  const venda = (id: number, extra: Partial<VendaResumo> = {}): VendaResumo => ({
    id, data: '2026-11-24T13:30:00.000Z', status: 'ACTIVE', total: 220, endereco: 'Rua Nova, 10', pago: false,
    doBot: true, cliente: 'Maria', conversaId: 7, itens: '2x GLP 13KG', pagamento: 'PIX', ...extra,
  });
  const historicoDe = (v: VendaResumo): HistoricoVenda => ({ ...v, logs: [{ status: 'OPEN', quando: v.data }, { status: 'ACTIVE', quando: v.data }] });

  function comVendas(vendas: VendaResumo[], resultado: 'ok' | 'ja_cancelada' | 'falha' = 'ok', extra: Partial<Deps> = {}) {
    return deps({
      vendasDoCliente: vi.fn(async () => vendas),
      historico: vi.fn(async (id: number) => {
        const v = vendas.find((x) => x.id === id);
        return v ? historicoDe(v) : null;
      }),
      cancelar: vi.fn(async () => resultado),
      ...extra,
    });
  }

  it('"oi" sem histórico → menu principal, sem perguntar o nome', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi']);
    expect(sessao.estado).toBe('MENU');
    expect(textoDe(acoes)).toContain(M.MENU_PRINCIPAL);
    expect(textoDe(acoes)).not.toContain(M.PERGUNTA_NOME);
  });

  it('cliente reconhecido: saudação de volta com o nome, e o menu', async () => {
    const s = novaSessao('5586999990000', { nome: 'Maria' });
    const { acoes } = await conversa(deps(), ['boa tarde'], s);
    expect(textoDe(acoes)).toContain('Maria');
    expect(textoDe(acoes)).toContain(M.MENU_PRINCIPAL);
  });

  it('"1" no menu começa o pedido pela pergunta que falta', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', '1']);
    expect(sessao.estado).toBe('NOME');
    expect(textoDe(acoes)).toContain(M.PERGUNTA_NOME);
  });

  it('"quero 2 botijão" no início pula o menu e segue o pedido', async () => {
    const { sessao, acoes } = await conversa(deps(), ['quero 2 botijão']);
    expect(sessao.estado).toBe('NOME');
    expect(textoDe(acoes)).not.toContain(M.MENU_PRINCIPAL);
  });

  it('"2" com uma venda → detalhe com o status em português e o histórico', async () => {
    const d = comVendas([venda(12)]);
    const { acoes } = await conversa(d, ['oi', '2']);
    const texto = textoDe(acoes);
    expect(texto).toContain('nº 12');
    expect(texto).toContain('Recebido');
    expect(texto).toContain('Em andamento');
    expect(d.historico).toHaveBeenCalledWith(12, 'acompanhar');
  });

  it('"cadê meu pedido" no início vai direto para acompanhar', async () => {
    const d = comVendas([venda(12)]);
    const { acoes } = await conversa(d, ['cadê meu pedido?']);
    expect(textoDe(acoes)).toContain('nº 12');
  });

  it('acompanhar com várias vendas: lista e mostra a escolhida', async () => {
    const d = comVendas([venda(12), venda(15, { total: 110 })]);
    const r1 = await conversa(d, ['oi', '2']);
    expect(r1.sessao.estado).toBe('ACOMPANHAR');
    expect(textoDe(r1.acoes)).toContain('Seus pedidos em aberto:');
    expect(textoDe(r1.acoes)).toContain('2 - nº 15');
    const r2 = await conversa(d, ['2'], r1.sessao);
    expect(textoDe(r2.acoes)).toContain('nº 15');
    expect(d.historico).toHaveBeenLastCalledWith(15, 'acompanhar');
  });

  it('"3", "1", "1" → cancela pela API uma vez e só então diz "cancelado"', async () => {
    const d = comVendas([venda(12)]);
    const r1 = await conversa(d, ['oi', '3', '1']);
    expect(textoDe(r1.acoes)).toContain('Cancelar o pedido nº 12 (R$ 220,00)?');
    expect(d.cancelar).not.toHaveBeenCalled();
    const r2 = await conversa(d, ['1'], r1.sessao);
    expect(d.cancelar).toHaveBeenCalledTimes(1);
    expect(d.cancelar).toHaveBeenCalledWith(12);
    expect(textoDe(r2.acoes)).toContain(M.pedidoCancelado(12));
    expect(r2.sessao.estado).toBe('MENU');
  });

  it('"2" na confirmação não cancela', async () => {
    const d = comVendas([venda(12)]);
    const { sessao } = await conversa(d, ['oi', '3', '1', '2']);
    expect(d.cancelar).not.toHaveBeenCalled();
    expect(sessao.estado).toBe('MENU');
  });

  it('venda cancelada pelo atendente antes do "sim" → JA_CANCELADO', async () => {
    const { acoes } = await conversa(comVendas([venda(12)], 'ja_cancelada'), ['oi', '3', '1', '1']);
    expect(textoDe(acoes)).toContain(M.JA_CANCELADO);
    expect(textoDe(acoes)).not.toContain('cancelado. ✅');
  });

  it('falha da API ao cancelar → transfere com erro_cancelamento e nunca diz "cancelado"', async () => {
    const { acoes } = await conversa(comVendas([venda(12)], 'falha'), ['oi', '3', '1', '1']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'erro_cancelamento' }));
    expect(textoDe(acoes).toLowerCase()).not.toContain('cancelado');
  });

  it('API fora do ar ao listar → aviso e transferência, sem chamar cancelar', async () => {
    const d = comVendas([], 'ok', { vendasDoCliente: vi.fn(async () => Promise.reject(new Error('timeout'))) });
    const { acoes } = await conversa(d, ['oi', '3']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'erro_consulta' }));
    expect(d.cancelar).not.toHaveBeenCalled();
  });

  it('"3" sem vendas → SEM_PEDIDO_ATIVO e volta ao menu, sem chamar cancelar', async () => {
    const d = comVendas([]);
    const { sessao, acoes } = await conversa(d, ['oi', '3']);
    expect(textoDe(acoes)).toContain(M.SEM_PEDIDO_ATIVO);
    expect(sessao.estado).toBe('MENU');
    expect(d.cancelar).not.toHaveBeenCalled();
  });

  it('"9" com 2 vendas listadas → não entendi e volta ao menu, sem chamar cancelar', async () => {
    const d = comVendas([venda(12), venda(15)]);
    const { sessao, acoes } = await conversa(d, ['oi', '3', '9']);
    expect(textoDe(acoes)).toContain(M.NAO_ENTENDI);
    expect(sessao.estado).toBe('MENU');
    expect(d.cancelar).not.toHaveBeenCalled();
  });

  it('revenda sem permitir cancelamento → transfere para atendente', async () => {
    const d = comVendas([venda(12)], 'ok', { situacao: vi.fn(async () => ({ aceitaPedido: true, permiteCancelar: false })) });
    const { acoes } = await conversa(d, ['oi', '3']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'humano' }));
    expect(d.cancelar).not.toHaveBeenCalled();
  });

  it('"menu" no meio do pedido → menu principal, e o pedido continua de onde parou', async () => {
    const r1 = await conversa(deps(), ['oi', '1', 'Maria', '1', 'menu']);
    expect(r1.sessao.estado).toBe('MENU');
    expect(textoDe(r1.acoes)).toContain(M.MENU_PRINCIPAL);
    expect(r1.sessao.pedido).toMatchObject({ nome: 'Maria', produto: 'P13' });
    const r2 = await conversa(deps(), ['1'], r1.sessao);
    expect(r2.sessao.estado).toBe('QUANTIDADE');
  });

  it('"cancelar" depois de registrar cancela a venda de verdade, pela API', async () => {
    const d = comVendas([venda(77)]);
    const r = await conversa(d, ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1', 'cancelar']);
    expect(textoDe(r.acoes)).toContain('nº 77');
    expect(textoDe(r.acoes)).not.toContain(M.CANCELADO);
    const fim = await conversa(d, ['1', '1'], r.sessao);
    expect(d.cancelar).toHaveBeenCalledWith(77);
    expect(textoDe(fim.acoes)).toContain(M.pedidoCancelado(77));
  });

  it('"oi" de novo com o menu aberto só repete o menu (não conta como "não entendi")', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'oi', 'boa tarde']);
    expect(sessao).toMatchObject({ estado: 'MENU', falhas: 0 });
    expect(acoes).toEqual([{ tipo: 'responder', texto: M.MENU_PRINCIPAL }]);
  });

  it('texto que não é opção no menu: não entendi e repete o menu', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'xyz']);
    expect(sessao.falhas).toBe(1);
    expect(textoDe(acoes)).toContain(M.NAO_ENTENDI);
  });

  it('"4" abre a dúvida e "5" chama o atendente', async () => {
    const r = await conversa(deps(), ['oi', '4']);
    expect(r.sessao.estado).toBe('DUVIDA');
    const { acoes } = await conversa(deps(), ['oi', '5']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'humano' }));
  });
});

describe('produtos, estoque e revenda aberta (Tarefa 4)', () => {
  const comEstoque = (estoque: Record<string, number>, extra: Partial<Deps> = {}) => deps({ estoque: vi.fn(async () => estoque), ...extra });
  const ateEndereco = ['Rua Nova', '10', 'Centro', 'Teresina', '1']; // ... até o resumo, no PIX

  it('estoque { P13: 0, P45: 3 } → o menu não mostra o P13, e o "1" é o P45', async () => {
    const d = comEstoque({ P13: 0, P45: 3 });
    const r = await conversa(d, ['oi', '1', 'Maria']);
    expect(textoDe(r.acoes)).not.toContain('P13');
    expect(textoDe(r.acoes)).toContain('1 - Botijão P45 (45kg)');
    const r2 = await conversa(d, ['1'], r.sessao);
    expect(r2.sessao.pedido.produto).toBe('P45');
  });

  it('quantidade 5 com estoque 3 → "Só temos 3", sem contar como "não entendi"', async () => {
    const d = comEstoque({ P13: 3 });
    const { sessao, acoes } = await conversa(d, ['oi', '1', 'Maria', '1', '5']);
    expect(textoDe(acoes)).toContain(M.semEstoque(3));
    expect(sessao).toMatchObject({ estado: 'QUANTIDADE', falhas: 0 });
    const r = await conversa(d, ['3'], sessao);
    expect(r.sessao.pedido.quantidade).toBe(3);
  });

  it('P13 esgota antes do resumo → avisa e volta a "Qual produto?"', async () => {
    const estoque: Record<string, number> = { P13: 10, P45: 5 };
    const d = deps({ estoque: vi.fn(async () => ({ ...estoque })) });
    const r = await conversa(d, ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina']);
    expect(r.sessao.estado).toBe('PAGAMENTO');
    estoque.P13 = 0;
    const { sessao, acoes } = await conversa(d, ['1'], r.sessao);
    expect(sessao.estado).toBe('PRODUTO');
    expect(sessao.pedido.produto).toBeUndefined();
    expect(textoDe(acoes)).toContain('Qual produto?');
    expect(textoDe(acoes)).toContain('Botijão P13 (13kg)'); // no aviso de que esgotou
    expect(textoDe(acoes)).not.toContain('Confira seu pedido');
  });

  it('estoque cai abaixo da quantidade no "confirmar" → não registra e pergunta a quantidade de novo', async () => {
    const estoque: Record<string, number> = { P13: 10 };
    const d = deps({ estoque: vi.fn(async () => ({ ...estoque })) });
    const r = await conversa(d, ['oi', '1', 'Maria', '1', '5', ...ateEndereco]);
    expect(r.sessao.estado).toBe('RESUMO');
    estoque.P13 = 2;
    const { sessao, acoes } = await conversa(d, ['1'], r.sessao);
    expect(d.registrar).not.toHaveBeenCalled();
    expect(sessao.estado).toBe('QUANTIDADE');
    expect(textoDe(acoes)).toContain(M.semEstoque(2));
  });

  it('aceitaPedido: false → REVENDA_FECHADA e menu, sem começar o pedido', async () => {
    const d = deps({ situacao: vi.fn(async () => ({ aceitaPedido: false, permiteCancelar: true })) });
    const r1 = await conversa(d, ['oi', '1']);
    expect(textoDe(r1.acoes)).toContain(M.REVENDA_FECHADA);
    expect(r1.sessao.estado).toBe('MENU');
    const r2 = await conversa(d, ['quero 2 botijão']);
    expect(textoDe(r2.acoes)).toContain(M.REVENDA_FECHADA);
    expect(r2.sessao.estado).toBe('MENU');
  });

  it('revenda fecha no meio do pedido → o "confirmar" não registra', async () => {
    let aceita = true;
    const d = deps({ situacao: vi.fn(async () => ({ aceitaPedido: aceita, permiteCancelar: true })) });
    const r = await conversa(d, ['oi', '1', 'Maria', '1', '2', ...ateEndereco]);
    aceita = false;
    const { acoes } = await conversa(d, ['1'], r.sessao);
    expect(d.registrar).not.toHaveBeenCalled();
    expect(textoDe(acoes)).toContain(M.REVENDA_FECHADA);
  });

  it('todos com estoque 0 → SEM_PRODUTOS e transfere', async () => {
    const { acoes } = await conversa(comEstoque({ P13: 0, P45: 0, AGUA20: 0 }), ['oi', '1', 'Maria']);
    expect(textoDe(acoes)).toContain(M.SEM_PRODUTOS);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'humano' }));
  });

  it('estoque fora do ar → segue sem limite (melhor esforço)', async () => {
    const d = deps({ estoque: vi.fn(async () => Promise.reject(new Error('ERP fora'))) });
    const { sessao } = await conversa(d, ['oi', '1', 'Maria', '1', '15']);
    expect(sessao.pedido.quantidade).toBe(15);
  });

  it('"botijão" sem tamanho pergunta qual; "13kg", "45" e "água" escolhem sem perguntar', async () => {
    const naEtapa = ['oi', '1', 'Maria'];
    expect((await conversa(deps(), [...naEtapa, 'botijão'])).sessao.estado).toBe('PRODUTO');
    expect((await conversa(deps(), [...naEtapa, 'botijão de 13kg'])).sessao.pedido.produto).toBe('P13');
    expect((await conversa(deps(), [...naEtapa, 'o de 45'])).sessao.pedido.produto).toBe('P45');
    expect((await conversa(deps(), [...naEtapa, 'água'])).sessao.pedido.produto).toBe('AGUA20');
  });

  it('"botijão" com só um tamanho em estoque escolhe esse', async () => {
    const { sessao } = await conversa(comEstoque({ P13: 0 }), ['oi', '1', 'Maria', 'botijão']);
    expect(sessao.pedido.produto).toBe('P45');
  });

  it('produto em falta pedido pelo nome → avisa e mostra o menu', async () => {
    const { sessao, acoes } = await conversa(comEstoque({ P13: 0 }), ['oi', '1', 'Maria', 'p13']);
    expect(sessao.estado).toBe('PRODUTO');
    expect(textoDe(acoes)).toContain(M.produtoEmFalta('Botijão P13 (13kg)'));
  });
});
