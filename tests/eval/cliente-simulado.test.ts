import { describe, expect, it } from 'vitest';
import { simular, type Perfil } from '../../eval/cliente-simulado.js';
import { InterpretadorFalso } from '../../src/ia/interpretacao.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';

const catalogo = carregarCatalogo();
const perfil: Perfil = {
  id: 1,
  nome: 'Ana',
  quantidade: 2,
  endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
  pagamento: 'PIX',
  primeiraMensagem: 'manda 2 botijão pra Rua Nova 10, Centro, Teresina PI, no pix',
};
const entidadesCertas = {
  produto: 'P13', quantidade: 2, pagamento: 'PIX' as const,
  endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
};

describe('cliente simulado', () => {
  it('menu: conclui certo em 11 mensagens (oi, "1" no menu principal, nome, produto, qtd, 4 de endereço (a UF sai da cidade), pagamento, confirmar)', async () => {
    const r = await simular(perfil, 'menu', { catalogo, interpretador: null });
    expect(r).toMatchObject({ concluiu: true, correto: true, mensagens: 11, correcoes: 0 });
  });

  it('menu com dinheiro e troco: 12 mensagens', async () => {
    const r = await simular({ ...perfil, pagamento: 'MONEY', trocoPara: 30000 }, 'menu', { catalogo, interpretador: null });
    expect(r).toMatchObject({ concluiu: true, correto: true, mensagens: 12 });
  });

  it('IA: frase livre + nome + confirmar = 3 mensagens', async () => {
    const ia = new InterpretadorFalso({
      [perfil.primeiraMensagem]: { intencao: 'fazer_pedido', entidades: entidadesCertas },
      'meu nome é Ana': { intencao: 'informar_dados', entidades: { nome: 'Ana' } },
      'pode confirmar': { intencao: 'confirmar', entidades: {} },
    });
    const r = await simular(perfil, 'ia', { catalogo, interpretador: ia });
    expect(r).toMatchObject({ concluiu: true, correto: true, mensagens: 3 });
  });

  it('IA que erra o número da casa: o cliente percebe no resumo e corrige', async () => {
    const ia = new InterpretadorFalso({
      [perfil.primeiraMensagem]: { intencao: 'fazer_pedido', entidades: { ...entidadesCertas, endereco: { ...entidadesCertas.endereco, numero: '100' } } },
      'meu nome é Ana': { intencao: 'informar_dados', entidades: { nome: 'Ana' } },
      'quero corrigir': { intencao: 'corrigir', entidades: {} },
      'pode confirmar': { intencao: 'confirmar', entidades: {} },
    });
    const r = await simular(perfil, 'ia', { catalogo, interpretador: ia });
    expect(r).toMatchObject({ concluiu: true, correto: true, correcoes: 1 });
    expect(r.mensagens).toBe(3 + 1 + 1 + 4); // + "corrigir" + "3" + endereço de novo (a UF sai da cidade)
  });

  it('IA fora do ar: cai nos menus e ainda conclui', async () => {
    const r = await simular(perfil, 'ia', { catalogo, interpretador: new InterpretadorFalso({}) });
    expect(r.concluiu).toBe(true);
  });
});

describe('experimento', () => {
  it('resume e testa H1 com perfis reais e IA falsa perfeita', async () => {
    const { carregarPerfis, relatorioMarkdown, resumirExperimento, rodarExperimento } = await import('../../eval/experimento.js');
    const perfis = carregarPerfis();
    expect(perfis).toHaveLength(20);
    // IA falsa: entende tudo da primeira mensagem (exceto o nome) e as respostas seguintes
    const respostas: Record<string, import('../../src/ia/interpretacao.js').Interpretacao> = { 'pode confirmar': { intencao: 'confirmar', entidades: {} } };
    for (const p of perfis.slice(0, 6)) {
      respostas[p.primeiraMensagem] = { intencao: 'fazer_pedido', entidades: { produto: 'P13', quantidade: p.quantidade, pagamento: p.pagamento, endereco: p.endereco, ...(p.trocoPara ? { trocoParaCentavos: p.trocoPara } : {}) } };
      respostas[`meu nome é ${p.nome}`] = { intencao: 'informar_dados', entidades: { nome: p.nome } };
    }
    const resultados = await rodarExperimento(perfis.slice(0, 6), new InterpretadorFalso(respostas));
    const s = resumirExperimento(resultados);
    expect(s.menu.corretos).toBe(6);
    expect(s.ia.corretos).toBe(6);
    expect(s.ia.mensagens.mediana).toBe(3);
    expect(s.wilcoxonMensagens.wMenos).toBe(0); // IA sempre menor
    expect(relatorioMarkdown(resultados, { modelo: 'falso', data: 'x' })).toContain('| 1 | 11 | 3 | 0 | ✅ | — |');
  });
});
