import type { CorpoVenda } from './pedido.js';

export type Resposta = { status: number; dados: unknown };

/** A requisição saiu, mas a resposta não chegou: a venda PODE ter sido criada. */
export class TempoEsgotado extends Error {}

export interface ApiRevGas {
  criarVenda(corpo: CorpoVenda): Promise<Resposta>;
}

/** Imita o ERP em memória. Padrão nos testes e na demo sem VENDA_REAL. */
export class ApiRevGasFalsa implements ApiRevGas {
  vendas: CorpoVenda[] = [];
  proximaResposta?: Resposta | 'timeout';

  async criarVenda(corpo: CorpoVenda): Promise<Resposta> {
    const forcada = this.proximaResposta;
    this.proximaResposta = undefined;
    if (forcada === 'timeout') throw new TempoEsgotado('timeout simulado');
    if (forcada) return forcada;
    this.vendas.push(corpo);
    return { status: 201, dados: { data: { id: this.vendas.length } } };
  }
}

export class ApiRevGasHttp implements ApiRevGas {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly intervaloMs: number;
  private readonly timeoutMs: number;
  private fila: Promise<unknown> = Promise.resolve();
  private ultima = 0;

  constructor(
    url: string,
    private readonly chave: string,
    opts: { fetch?: typeof fetch; intervaloMs?: number; timeoutMs?: number } = {},
  ) {
    if (!url.trim() || !chave.trim()) throw new Error('REVGAS_API_URL e REVGAS_API_KEY são obrigatórias');
    this.base = url.trim().replace(/\/+$/, '');
    this.fetch = opts.fetch ?? fetch;
    this.intervaloMs = opts.intervaloMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  criarVenda(corpo: CorpoVenda): Promise<Resposta> {
    return this.enfileirar(() => this.enviar('POST', '/sales', corpo));
  }

  // Fora da porta ApiRevGas: só para conferir e limpar vendas de teste (npm run cancelar-venda).
  detalharVenda(id: number): Promise<Resposta> {
    const v = idValido(id);
    return this.enfileirar(() => this.enviar('GET', `/sales/${v}`, undefined));
  }

  cancelarVenda(id: number): Promise<Resposta> {
    const v = idValido(id);
    return this.enfileirar(() => this.enviar('PUT', `/sales/${v}/cancel`, { motive_cancel_sale_id: null }));
  }

  // A API limita a 1 req/s: as chamadas saem uma por vez, espaçadas.
  private enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const vez = this.fila.then(async () => {
      const espera = this.ultima + this.intervaloMs - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      this.ultima = Date.now();
      return tarefa();
    });
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private async enviar(metodo: string, caminho: string, corpo: unknown): Promise<Resposta> {
    let resposta: Response;
    try {
      resposta = await this.fetch(this.base + caminho, {
        method: metodo,
        headers: { Authorization: this.chave, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
        redirect: 'manual', // a chave nunca segue para outro endereço
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new TempoEsgotado(`sem resposta da API em ${metodo} ${caminho}`);
    }
    let dados: unknown = null;
    try {
      dados = await resposta.json();
    } catch {
      /* corpo vazio ou não-JSON */
    }
    return { status: resposta.status, dados };
  }
}

/** O id vai para a URL autenticada: só inteiro positivo. */
function idValido(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`id de venda inválido: ${id}`);
  return id;
}
