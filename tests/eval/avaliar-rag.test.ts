import { describe, expect, it } from 'vitest';
import {
  EmbeddingsEmCache,
  avaliarModo,
  carregarPerguntas,
  compararModos,
  discordancias,
  relatorioMarkdown,
  resumir,
} from '../../eval/avaliar-rag.js';
import { mcnemarExato } from '../../eval/estatistica.js';
import { carregarFaq } from '../../src/conhecimento/faq.js';
import { trechoCatalogo } from '../../src/conhecimento/gemini.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';

describe('perguntas rotuladas', () => {
  const perguntas = carregarPerguntas();
  const fontes = new Set([...carregarFaq(), trechoCatalogo(carregarCatalogo())].map((t) => t.fonte));

  it('~25 perguntas com ids únicos e 5 a 8 fora da FAQ', () => {
    expect(perguntas.length).toBeGreaterThanOrEqual(25);
    expect(new Set(perguntas.map((p) => p.id)).size).toBe(perguntas.length);
    const fora = perguntas.filter((p) => !p.esperado.length).length;
    expect(fora).toBeGreaterThanOrEqual(5);
    expect(fora).toBeLessThanOrEqual(8);
  });

  it('toda fonte esperada é um trecho que o bot realmente indexa', () => {
    for (const p of perguntas) for (const f of p.esperado) expect(fontes.has(f), `pergunta ${p.id}: ${f}`).toBe(true);
  });

  it('todo arquivo da FAQ tem pelo menos uma pergunta', () => {
    const usadas = new Set(perguntas.flatMap((p) => p.esperado));
    for (const f of fontes) expect(usadas.has(f), f).toBe(true);
  });
});

describe('EmbeddingsEmCache', () => {
  it('calcula cada texto uma vez só e devolve na ordem pedida', async () => {
    const pedidos: string[][] = [];
    const cache = new EmbeddingsEmCache({ gerar: async (t) => (pedidos.push(t), t.map((x) => [x.length])) });
    expect(await cache.gerar(['ab', 'abc', 'ab'])).toEqual([[2], [3], [2]]);
    expect(await cache.gerar(['abc', 'abcd'])).toEqual([[3], [4]]);
    expect(pedidos).toEqual([['ab', 'abc'], ['abcd']]);
    expect(cache.chamadas).toBe(2);
  });
});

describe('avaliarModo e métricas', () => {
  // Vetores de brinquedo: cada eixo é um assunto.
  const trechos = [
    { fonte: 'pix.md', texto: 'Aceitamos PIX e cartão.' },
    { fonte: 'horario.md', texto: 'Abrimos no domingo das 8h às 13h.' },
  ];
  const vetor: Record<string, number[]> = {
    [trechos[0]!.texto]: [1, 0],
    [trechos[1]!.texto]: [0, 1],
    'paga como?': [0.9, 0.1], // só pelo sentido
    'abre domingo?': [0.8, 0.3], // o vetor erra (parece pagamento), mas "domingo" é palavra rara
    'vende água?': [-1, -1],
  };
  const embeddings = { gerar: async (t: string[]) => t.map((x) => vetor[x]!) };
  const perguntas = [
    { id: 1, pergunta: 'paga como?', esperado: ['pix.md'] },
    { id: 2, pergunta: 'abre domingo?', esperado: ['horario.md'] },
    { id: 3, pergunta: 'vende água?', esperado: [] },
  ];

  it('vetorial × híbrido: o híbrido acha pela palavra rara, e os dois recusam o que está fora', async () => {
    const v = await avaliarModo(perguntas, trechos, embeddings, { modo: 'vetorial' });
    const h = await avaliarModo(perguntas, trechos, embeddings, { modo: 'hibrido', limiarBm25: 0.1 });
    expect(v.map((r) => r.acertou)).toEqual([true, false, true]);
    expect(h.map((r) => r.acertou)).toEqual([true, true, true]);
    expect(resumir(v)).toEqual({ naFaq: 2, acerto1: 1, acerto3: 1, semResposta: 0, fora: 1, recusaCorreta: 1, indevidas: 0, acertos: 2, total: 3 });
    expect(discordancias(v, h).map((d) => d.vetorial.id)).toEqual([2]);
    expect(compararModos(v, h)).toMatchObject({ soVetorial: 0, soHibrido: 1, n: 1, p: 1 });
    const md = relatorioMarkdown({ data: 'x', vetorial: v, hibrido: h, sensibilidade: [], chamadasGemini: 1 });
    expect(md).toContain('| Vetorial (antes) | 1/2 (50,0%)');
    expect(md).toContain('| 2 | abre domingo? | horario |');
  });

  it('pergunta fora da FAQ que recebe trecho conta como resposta indevida', async () => {
    const r = await avaliarModo([perguntas[2]!], trechos, embeddings, { modo: 'vetorial', limiar: -1 });
    expect(resumir(r)).toMatchObject({ recusaCorreta: 0, indevidas: 1 });
  });
});

describe('mcnemarExato', () => {
  it('binomial bicaudal nas discordâncias', () => {
    expect(mcnemarExato(0, 0).p).toBe(1);
    expect(mcnemarExato(1, 1).p).toBe(1);
    expect(mcnemarExato(0, 5).p).toBeCloseTo(0.0625);
    expect(mcnemarExato(6, 0).p).toBeCloseTo(0.03125);
    expect(mcnemarExato(2, 8).p).toBeCloseTo(0.1094, 3);
  });
});
