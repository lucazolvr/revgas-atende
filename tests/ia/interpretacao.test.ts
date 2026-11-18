import { describe, expect, it } from 'vitest';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import { validarInterpretacao } from '../../src/ia/interpretacao.js';

const cat = carregarCatalogo();

describe('validarInterpretacao', () => {
  it('aceita uma interpretação correta', () => {
    const r = validarInterpretacao(
      {
        intencao: 'fazer_pedido',
        entidades: {
          produto: 'P13',
          quantidade: 2,
          pagamento: 'PIX',
          endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'pi' },
        },
      },
      cat,
    );
    expect(r).toEqual({
      intencao: 'fazer_pedido',
      entidades: {
        produto: 'P13',
        quantidade: 2,
        pagamento: 'PIX',
        endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
      },
    });
  });

  it('descarta quantidade absurda mas mantém o resto', () => {
    const r = validarInterpretacao(
      { intencao: 'fazer_pedido', entidades: { quantidade: 500, endereco: { logradouro: 'Rua A' } } },
      cat,
    );
    expect(r?.entidades.quantidade).toBeUndefined();
    expect(r?.entidades.endereco).toEqual({ logradouro: 'Rua A' });
  });

  it('descarta pagamento e produto fora do catálogo', () => {
    const r = validarInterpretacao(
      { intencao: 'informar_dados', entidades: { pagamento: 'BITCOIN', produto: 'P45', nome: 'Ana' } },
      cat,
    );
    expect(r).toEqual({ intencao: 'informar_dados', entidades: { nome: 'Ana' } });
  });

  it('intenção inválida → null', () => {
    expect(validarInterpretacao({ intencao: 'xyz', entidades: {} }, cat)).toBeNull();
    expect(validarInterpretacao('lixo', cat)).toBeNull();
  });

  it('ignora preço vindo da IA', () => {
    const r = validarInterpretacao({ intencao: 'fazer_pedido', entidades: { preco: 1 } }, cat);
    expect(r).toEqual({ intencao: 'fazer_pedido', entidades: {} });
  });
});
