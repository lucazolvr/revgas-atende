import { describe, expect, it, vi } from 'vitest';
import {
  BaseConhecimento,
  IndiceBm25,
  fundirRankings,
  palavrasChave,
  similaridadeCosseno,
  type GeradorEmbeddings,
} from '../../src/conhecimento/base.js';
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

  describe('busca híbrida (vetor + BM25)', () => {
    // Pergunta "longe" de todos os trechos no espaço vetorial, a não ser que fale de horário.
    const embeddings: GeradorEmbeddings = {
      gerar: async (textos) => textos.map((t) => (trechos.some((x) => x.texto === t) ? (t.includes('domingo') ? [1, 0] : [0, 1]) : t.includes('abrem') ? [1, 0] : [-1, 0])),
    };
    const buscar = async (pergunta: string, opts: ConstructorParameters<typeof BaseConhecimento>[3] = {}) => {
      const base = new BaseConhecimento(trechos, embeddings, { gerar: async () => null }, opts);
      await base.inicializar();
      return (await base.buscar(pergunta)).map((r) => r.fonte);
    };

    it('a palavra-chave acha o trecho que o vetor não acha', async () => {
      expect(await buscar('aceita pix?', { modo: 'vetorial' })).toEqual([]);
      expect(await buscar('aceita pix?', { limiarBm25: 1 })).toEqual(['config/faq/pagamento.md']);
    });

    it('o vetor acha o trecho sem palavra em comum', async () => {
      expect((await buscar('que horas vocês abrem?'))[0]).toBe('config/faq/horario.md');
    });

    it('palavra comum demais não basta: sem trecho relevante, não responde', async () => {
      expect(await buscar('entregamos?')).toEqual([]); // "entregamos" está em 2 de 4 trechos
    });
  });

  it('RRF soma 1/(k + posição) das listas', () => {
    const fusao = fundirRankings([['a', 'b'], ['b', 'c']], 1);
    expect([...fusao.keys()]).toEqual(['b', 'a', 'c']); // b: 1/3 + 1/2; a: 1/2; c: 1/3
  });

  it('palavras-chave sem acento, palavras vazias nem plural em "s"', () => {
    expect(palavrasChave('Vocês entregam aos Domingos? PIX')).toEqual(['entregam', 'domingo', 'pix']);
  });

  it('BM25 pontua mais o trecho com a palavra rara', () => {
    const [domingo, pix] = new IndiceBm25(trechos.map((t) => t.texto)).pontuar('pix');
    expect(pix).toBeGreaterThan(0);
    expect(domingo).toBe(0);
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
