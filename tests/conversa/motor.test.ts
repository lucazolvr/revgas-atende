import { describe, expect, it, vi } from 'vitest';
import { InterpretadorFalso } from '../../src/ia/interpretacao.js';
import { ehEmergencia } from '../../src/conversa/emergencia.js';
import { novaSessao, processar, separarCidadeUf, type Deps, type Sessao } from '../../src/conversa/motor.js';
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
      'oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1',
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
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1']);
    expect(sessao.estado).toBe('RESUMO');
    expect(textoDe(acoes)).toContain('R$ 220,00');
  });

  it('"1" repetido depois de registrado não cria outra venda', async () => {
    const d = deps();
    const { acoes } = await conversa(d, ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1', '1']);
    expect(d.registrar).toHaveBeenCalledTimes(1);
    expect(textoDe(acoes)).toContain('já está registrado');
  });

  it('dinheiro pede troco e valida contra o total', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '2', '100']);
    expect(sessao.estado).toBe('TROCO');
    expect(textoDe(acoes)).toContain('maior que o total');
    const r = await processar(sessao, 'R$ 250', deps());
    expect(r.sessao.pedido.trocoParaCentavos).toBe(25000);
    expect(r.sessao.estado).toBe('RESUMO');
  });

  it('corrige só o endereço', async () => {
    const { sessao } = await conversa(deps(), [
      'oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '2', '3',
      'Av. Frei Serafim', '200', 'Centro', 'Teresina',
    ]);
    expect(sessao.estado).toBe('RESUMO');
    expect(sessao.pedido.endereco?.logradouro).toBe('Av. Frei Serafim');
    expect(sessao.pedido.nome).toBe('Maria');
  });

  it('cancela no resumo', async () => {
    const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '3']);
    expect(sessao.estado).toBe('INICIO');
    expect(textoDe(acoes)).toContain('cancelado');
  });

  it('resposta do endereço em várias linhas: só a primeira vale para o campo', async () => {
    const { sessao } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova\nSim, para entregar', '\n10\n', 'Centro']);
    expect(sessao.pedido.endereco).toMatchObject({ logradouro: 'Rua Nova', numero: '10', bairro: 'Centro' });
  });

  it('cancela no meio do pedido, pelos menus', async () => {
    for (const pedido of ['cancelar', 'Quero desistir']) {
      const { sessao, acoes } = await conversa(deps(), ['oi', 'Maria', '1', pedido]);
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
    const { acoes } = await conversa(d, ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1']);
    expect(acoes).toContainEqual(expect.objectContaining({ tipo: 'transferir', motivo: 'verificar_venda' }));
  });

  it('sem IA entende "meu nome é Ana", "pode confirmar" e "quero corrigir"', async () => {
    const d = deps();
    const base = ['oi', 'meu nome é Ana', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1'];
    const resumo = await conversa(d, base);
    expect(resumo.sessao.pedido.nome).toBe('Ana');
    expect((await processar(resumo.sessao, 'quero corrigir', d)).sessao.estado).toBe('CORRIGIR');
    expect((await processar(resumo.sessao, 'pode confirmar', d)).sessao.estado).toBe('REGISTRADO');
  });

  it('nova mensagem depois de registrado começa outro pedido', async () => {
    const { sessao } = await conversa(deps(), ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1', 'boa noite']);
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
    await conversa(deps({ interpretador: espiao }), ['oi', 'Maria', '1', '2', 'Quadra 12', '5', 'Dirceu']);
    expect(etapas).toContain('ENDERECO (pergunta atual: bairro)');
  });

  it('IA fora do ar (null) cai nos menus', async () => {
    const { sessao } = await conversa(deps({ interpretador: new InterpretadorFalso({}) }), ['oi', 'Maria', '1']);
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
  const atePagamento = ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina'];

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
  const ateCidade = ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro'];

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
