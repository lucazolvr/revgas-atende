import { describe, expect, it } from 'vitest';
import { extrairRegras, numeroPorExtenso, separarEndereco } from '../../src/conversa/regras.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';

const catalogo = carregarCatalogo();

describe('regras locais', () => {
  it('extrai produto, quantidade e pagamento da mesma mensagem', () => {
    expect(extrairRegras('2 botijão no pix', catalogo)).toMatchObject({ produto: 'P13', quantidade: 2, pagamento: 'PIX' });
  });
  it('entende quantidades por extenso, variações e troco', () => {
    expect(extrairRegras('dois botijões, dinhero, troco pra 200', catalogo)).toMatchObject({
      produto: 'P13', quantidade: 2, pagamento: 'MONEY', trocoParaCentavos: 20000,
    });
  });
  it('reconhece débito e não assume o tipo de cartão', () => {
    expect(extrairRegras('cartao debito', catalogo).pagamento).toBe('CARTAO_DE_DEBITO');
    expect(extrairRegras('cartão', catalogo).pagamento).toBeUndefined();
  });
  it('separa endereço completo e ignora texto sem vírgulas suficientes', () => {
    expect(separarEndereco('Rua Nova, 10, Centro, Teresina')).toMatchObject({
      logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI',
    });
    expect(separarEndereco('Rua Nova 10')).toBeNull();
  });
  it('converte números por extenso de um a dez', () => {
    expect(numeroPorExtenso('duas')).toBe(2);
    expect(numeroPorExtenso('dez')).toBe(10);
    expect(numeroPorExtenso('onze')).toBeNull();
  });
});
