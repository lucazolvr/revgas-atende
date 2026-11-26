import { describe, expect, it } from 'vitest';
import { responderFaq } from '../../src/conhecimento/palavras.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';

const catalogo = carregarCatalogo();

describe('respostas por palavra-chave', () => {
  it('monta os preços atuais a partir do catálogo', () => {
    expect(responderFaq('qual o preço do gás?', catalogo)).toContain('R$ 110,00');
  });

  it('usa o primeiro parágrafo do FAQ de horário', () => {
    expect(responderFaq('abre domingo?', catalogo)?.toLowerCase()).toContain('domingo');
  });

  it('retorna null quando nenhuma palavra-chave corresponde', () => {
    expect(responderFaq('qual a capital da França?', catalogo)).toBeNull();
  });
});
