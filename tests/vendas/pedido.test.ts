import { describe, expect, it } from 'vitest';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import { clienteDaVenda, corpoDaVenda, formatarReais, totalCentavos, type Pedido } from '../../src/vendas/pedido.js';

const cat = carregarCatalogo();
const ids = { clienteId: 99, estabelecimentoId: 2580 };
const pedido: Pedido = {
  telefone: '5586999990000',
  nome: 'Maria',
  produto: 'P13',
  quantidade: 2,
  endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
  pagamento: 'PIX',
};

describe('pedido', () => {
  it('soma o total pelo preço do catálogo', () => {
    expect(totalCentavos(pedido, cat)).toBe(22000);
  });

  it('formata reais', () => {
    expect(formatarReais(22000)).toBe('R$ 220,00');
    expect(formatarReais(150)).toBe('R$ 1,50');
  });

  it('monta o corpo da venda da API RevGás', () => {
    const corpo = corpoDaVenda(pedido, cat, ids);
    expect(corpo).toMatchObject({
      customer_id: 99,
      establishment_id: 2580,
      location: 'Rua Nova',
      number: '10',
      neighborhood: 'Centro',
      city: 'Teresina',
      state_federation: 'PI',
      products: [{ product_id: 26717, quantity: 2, value: 110 }],
      payments: [{ payment_type: 'PIX', value: 220 }],
      channel: 'WHATSAPP',
      origin: 'INTEGRATION',
      option: 'NORMAL',
      broadcast: 'NONE',
    });
    expect(corpo.observation).toContain('Maria');
    expect(corpo.observation).toContain('5586999990000');
  });

  it('põe o troco na observação quando é dinheiro', () => {
    const corpo = corpoDaVenda({ ...pedido, pagamento: 'MONEY', trocoParaCentavos: 20000 }, cat, ids);
    expect(corpo.observation).toContain('Troco para R$ 200,00');
  });

  it('não manda complemento nem referência vazios (a API exige 1 a 255 caracteres)', () => {
    const sem = corpoDaVenda(pedido, cat, ids);
    expect('complement' in sem).toBe(false);
    expect('landmark' in sem).toBe(false);
    const com = corpoDaVenda({ ...pedido, endereco: { ...pedido.endereco, complemento: ' apto 302 ', referencia: 'perto da praça' } }, cat, ids);
    expect(com).toMatchObject({ complement: 'apto 302', landmark: 'perto da praça' });
  });

  it('recusa pedido incompleto', () => {
    expect(() => corpoDaVenda({ telefone: '1' }, cat, ids)).toThrow();
  });
});

describe('clienteDaVenda', () => {
  const venda = {
    observation: 'Pedido via WhatsApp (RevGás Atende). Cliente: Maria Silva 5586999990000. Troco para R$ 200,00.',
    location: 'Rua Nova', number: '10', neighborhood: 'Centro', city: 'Teresina', state_federation: 'PI',
  };

  it('lê nome e endereço da venda do mesmo telefone (com ou sem o 9 extra)', () => {
    expect(clienteDaVenda(venda, '558699990000')).toEqual({
      nome: 'Maria Silva',
      endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
    });
  });

  it('outro telefone ou venda que não é do bot → null', () => {
    expect(clienteDaVenda(venda, '5586988887777')).toBeNull();
    expect(clienteDaVenda({ ...venda, observation: 'venda no balcão' }, '5586999990000')).toBeNull();
  });

  it('endereço incompleto: só o nome', () => {
    expect(clienteDaVenda({ ...venda, city: '' }, '5586999990000')).toEqual({ nome: 'Maria Silva' });
  });

  it('o corpo que o bot envia é lido de volta', () => {
    const c = corpoDaVenda(pedido, cat, ids);
    expect(clienteDaVenda({ ...c, establishment_id: c.establishment_id }, pedido.telefone)).toEqual({ nome: 'Maria', endereco: pedido.endereco });
  });
});

it('corpoDaVenda: com conversaId, a observação liga a venda à conversa', () => {
  expect(corpoDaVenda(pedido, cat, { ...ids, conversaId: 12 }).observation).toMatch(/Cliente: Maria 5586999990000\. Conversa 12\.$/);
});
