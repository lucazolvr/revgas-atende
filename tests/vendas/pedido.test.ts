import { describe, expect, it } from 'vitest';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import { corpoDaVenda, formatarReais, totalCentavos, type Pedido } from '../../src/vendas/pedido.js';

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

  it('recusa pedido incompleto', () => {
    expect(() => corpoDaVenda({ telefone: '1' }, cat, ids)).toThrow();
  });
});
