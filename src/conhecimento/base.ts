import type { TrechoConhecimento } from './faq.js';

export interface GeradorEmbeddings {
  gerar(textos: string[]): Promise<number[][]>;
}

export interface GeradorResposta {
  gerar(pergunta: string, trechos: TrechoConhecimento[]): Promise<string | null>;
}

export type ResultadoBusca = TrechoConhecimento & { similaridade: number };

/** Índice vetorial pequeno, propositalmente mantido apenas em memória. */
export class BaseConhecimento {
  private indice: Array<TrechoConhecimento & { embedding: number[] }> = [];

  constructor(
    private readonly trechos: TrechoConhecimento[],
    private readonly embeddings: GeradorEmbeddings,
    private readonly respostas: GeradorResposta,
    private readonly opts: { limite?: number; limiar?: number } = {},
  ) {}

  async inicializar(): Promise<void> {
    const vetores = await this.embeddings.gerar(this.trechos.map((t) => t.texto));
    if (vetores.length !== this.trechos.length || vetores.some((v) => !vetorValido(v))) {
      throw new Error('embeddings inválidos para a FAQ');
    }
    this.indice = this.trechos.map((trecho, i) => ({ ...trecho, embedding: vetores[i]! }));
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
    const limiar = this.opts.limiar ?? 0.65;
    const limite = this.opts.limite ?? 3;
    return this.indice
      .map(({ embedding, ...trecho }) => ({ ...trecho, similaridade: similaridadeCosseno(consulta, embedding) }))
      .filter((r) => r.similaridade >= limiar)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, limite);
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
