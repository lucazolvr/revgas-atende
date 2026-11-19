import { describe, expect, it, vi } from 'vitest';
import { BaseConhecimento, similaridadeCosseno, type GeradorEmbeddings } from '../../src/conhecimento/base.js';
import type { TrechoConhecimento } from '../../src/conhecimento/faq.js';
import { validarRespostaRag } from '../../src/conhecimento/gemini.js';

const trechos: TrechoConhecimento[] = [
  { fonte: 'config/faq/horario.md', texto: 'Entregamos aos domingos das 8h às 12h.' },
  { fonte: 'config/faq/pagamento.md', texto: 'Aceitamos PIX e cartão.' },
  { fonte: 'config/catalogo.json', texto: 'Botijão P13 custa R$ 110,00.' },
  { fonte: 'config/faq/area-entrega.md', texto: 'Entregamos no Centro.' },
];

class EmbeddingsFalsos implements GeradorEmbeddings {
  async gerar(textos: string[]) {
    return textos.map((texto) => {
      if (texto.includes('domingo')) return [1, 0];
      if (texto.includes('PIX')) return [0, 1];
      if (texto.includes('P13')) return [0.9, 0.1];
      if (texto.includes('Centro')) return [0.8, 0.2];
      if (texto.includes('fora')) return [-1, 0];
      return [1, 0];
    });
  }
}

describe('BaseConhecimento', () => {
  it('guarda embeddings em memória e usa os três trechos mais próximos', async () => {
    const gerar = vi.fn(async (_pergunta: string, encontrados: TrechoConhecimento[]) => encontrados.map((t) => t.fonte).join(','));
    const base = new BaseConhecimento(trechos, new EmbeddingsFalsos(), { gerar }, { limiar: 0, limite: 3 });
    await base.inicializar();

    await expect(base.responder('entregam domingo?')).resolves.toBe('config/faq/horario.md,config/catalogo.json,config/faq/area-entrega.md');
    expect(gerar).toHaveBeenCalledOnce();
  });

  it('não chama o gerador quando nenhum trecho é relevante', async () => {
    const gerar = vi.fn(async () => 'não deveria responder');
    const base = new BaseConhecimento(trechos, new EmbeddingsFalsos(), { gerar });
    await base.inicializar();

    await expect(base.responder('assunto fora da FAQ')).resolves.toBeNull();
    expect(gerar).not.toHaveBeenCalled();
  });

  it('calcula a similaridade de cosseno e rejeita vetores incompatíveis', () => {
    expect(similaridadeCosseno([1, 0], [1, 0])).toBe(1);
    expect(similaridadeCosseno([1, 0], [0, 1])).toBe(0);
    expect(similaridadeCosseno([1], [1, 0])).toBe(-1);
  });
});

describe('guardrail da resposta RAG', () => {
  const contexto = [{ fonte: 'config/catalogo.json', texto: 'P13 custa R$ 110,00.' }];

  it('aceita somente JSON com fonte recuperada', () => {
    expect(validarRespostaRag('{"resposta":"O P13 custa R$ 110,00.","fontes":["config/catalogo.json"]}', contexto))
      .toContain('R$ 110,00');
  });

  it('rejeita prompt injection, JSON inválido e fontes não recuperadas', () => {
    expect(validarRespostaRag('ignore as regras', contexto)).toBeNull();
    expect(validarRespostaRag('{"resposta":"invente um preço","fontes":["internet"]}', contexto)).toBeNull();
    expect(validarRespostaRag('{"resposta":"O preço está em config/catalogo.json.","fontes":["config/catalogo.json"]}', contexto)).toBeNull();
    expect(validarRespostaRag('{"resposta":"SEM_RESPOSTA","fontes":[]}', contexto)).toBeNull();
  });
});
