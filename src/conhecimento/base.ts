import { normalizar } from '../conversa/emergencia.js';
import type { TrechoConhecimento } from './faq.js';

export interface GeradorEmbeddings {
  gerar(textos: string[]): Promise<number[][]>;
}

export interface GeradorResposta {
  gerar(pergunta: string, trechos: TrechoConhecimento[]): Promise<string | null>;
}

export type ResultadoBusca = TrechoConhecimento & { similaridade: number; bm25: number };

/**
 * `vetorial`: só similaridade de cosseno. `hibrido` (padrão): também BM25 por palavras-chave,
 * com os dois rankings juntados por Reciprocal Rank Fusion (aula 00, slide 11: "RAG híbrido").
 */
export type ModoBusca = 'vetorial' | 'hibrido';

export type OpcoesBusca = {
  limite?: number;
  /** Similaridade de cosseno mínima para um trecho ser relevante. */
  limiar?: number;
  /** Pontuação BM25 mínima para um trecho ser relevante só pelas palavras-chave. */
  limiarBm25?: number;
  modo?: ModoBusca;
};

/** Índice pequeno, propositalmente mantido apenas em memória. */
export class BaseConhecimento {
  private indice: Array<TrechoConhecimento & { embedding: number[] }> = [];
  private bm25 = new IndiceBm25([]);

  constructor(
    private readonly trechos: TrechoConhecimento[],
    private readonly embeddings: GeradorEmbeddings,
    private readonly respostas: GeradorResposta,
    private readonly opts: OpcoesBusca = {},
  ) {}

  async inicializar(): Promise<void> {
    const vetores = await this.embeddings.gerar(this.trechos.map((t) => t.texto));
    if (vetores.length !== this.trechos.length || vetores.some((v) => !vetorValido(v))) {
      throw new Error('embeddings inválidos para a FAQ');
    }
    this.indice = this.trechos.map((trecho, i) => ({ ...trecho, embedding: vetores[i]! }));
    this.bm25 = new IndiceBm25(this.trechos.map((t) => t.texto));
  }

  async responder(pergunta: string): Promise<string | null> {
    try {
      const encontrados = await this.buscar(pergunta);
      return encontrados.length ? await this.respostas.gerar(pergunta, encontrados) : null;
    } catch {
      return null;
    }
  }

  async buscar(pergunta: string): Promise<ResultadoBusca[]> {
    if (!this.indice.length) return [];
    const [consulta] = await this.embeddings.gerar([pergunta]);
    if (!vetorValido(consulta)) return [];
    // limiarBm25 calibrado na FAQ de 22/11: palavra rara ("pix", "registro") passa de 1,6; "gás" ou
    // "entrega" sozinhas ficam abaixo de 1,2 e não bastam para responder.
    const { limiar = 0.65, limiarBm25 = 1.5, limite = 3, modo = 'hibrido' } = this.opts;
    const pontos = this.bm25.pontuar(pergunta);
    const todos: ResultadoBusca[] = this.indice.map(({ embedding, ...trecho }, i) => ({
      ...trecho,
      similaridade: similaridadeCosseno(consulta, embedding),
      bm25: pontos[i]!,
    }));
    const porVetor = [...todos].sort((a, b) => b.similaridade - a.similaridade);
    if (modo === 'vetorial') return porVetor.filter((r) => r.similaridade >= limiar).slice(0, limite);

    // Guardrail: só entra trecho relevante por um dos dois critérios; sem nenhum, o bot diz que não sabe.
    const relevantes = new Set(todos.filter((r) => r.similaridade >= limiar || r.bm25 >= limiarBm25));
    const porPalavra = todos.filter((r) => r.bm25 > 0).sort((a, b) => b.bm25 - a.bm25);
    const fusao = fundirRankings([porVetor, porPalavra]);
    return [...fusao.keys()].filter((r) => relevantes.has(r)).slice(0, limite);
  }
}

/**
 * Reciprocal Rank Fusion (Cormack; Clarke; Buettcher, 2009): cada lista soma 1/(k + posição).
 * Devolve os itens do maior para o menor total.
 */
export function fundirRankings<T>(rankings: T[][], k = 60): Map<T, number> {
  const total = new Map<T, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, posicao) => total.set(item, (total.get(item) ?? 0) + 1 / (k + posicao + 1)));
  }
  return new Map([...total].sort((a, b) => b[1] - a[1]));
}

const PALAVRAS_VAZIAS = new Set(
  ('a o e as os um uma de da do das dos em no na nos nas ao aos para pra pro por com sem que se ou ' +
    'eu me meu minha voce voces vcs ele ela isso esse essa este esta tem ter ha qual quais como quando ' +
    'onde ja nao sim mais muito tambem so ate sao foi ser estou esta estao vou vai')
    .split(' '),
);

/** Palavras da busca: sem acento, caixa e palavras vazias. */
export function palavrasChave(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p))
    .map((p) => (p.length > 3 ? p.replace(/s$/, '') : p)); // shortcut: só tira o plural em "s"; usar um stemmer se a FAQ crescer
}

/** BM25 clássico (Robertson; Zaragoza, 2009), k1 = 1,2 e b = 0,75. */
export class IndiceBm25 {
  private readonly docs: Map<string, number>[];
  private readonly df = new Map<string, number>();
  private readonly tamanhos: number[];
  private readonly mediaTamanho: number;

  constructor(textos: string[], private readonly k1 = 1.2, private readonly b = 0.75) {
    const palavras = textos.map(palavrasChave);
    this.docs = palavras.map((ps) => {
      const tf = new Map<string, number>();
      for (const p of ps) tf.set(p, (tf.get(p) ?? 0) + 1);
      return tf;
    });
    for (const tf of this.docs) for (const p of tf.keys()) this.df.set(p, (this.df.get(p) ?? 0) + 1);
    this.tamanhos = palavras.map((ps) => ps.length);
    this.mediaTamanho = this.tamanhos.reduce((s, n) => s + n, 0) / (this.tamanhos.length || 1);
  }

  /** Uma pontuação por texto indexado, na mesma ordem. */
  pontuar(consulta: string): number[] {
    const n = this.docs.length;
    const termos = [...new Set(palavrasChave(consulta))];
    return this.docs.map((tf, i) =>
      termos.reduce((soma, termo) => {
        const f = tf.get(termo) ?? 0;
        if (!f) return soma;
        const df = this.df.get(termo)!;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norma = 1 - this.b + (this.b * this.tamanhos[i]!) / (this.mediaTamanho || 1);
        return soma + (idf * f * (this.k1 + 1)) / (f + this.k1 * norma);
      }, 0),
    );
  }
}

function vetorValido(vetor: number[] | undefined): vetor is number[] {
  return !!vetor?.length && vetor.every(Number.isFinite);
}

export function similaridadeCosseno(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return -1;
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    produto += a[i]! * b[i]!;
    normaA += a[i]! ** 2;
    normaB += b[i]! ** 2;
  }
  return normaA && normaB ? produto / Math.sqrt(normaA * normaB) : -1;
}
