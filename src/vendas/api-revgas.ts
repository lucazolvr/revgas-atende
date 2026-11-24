import { clienteDaVenda, type CorpoVenda, type Pedido, type VendaListada } from './pedido.js';

export type Resposta = { status: number; dados: unknown };

/** A requisição saiu, mas a resposta não chegou: a venda PODE ter sido criada. */
export class TempoEsgotado extends Error {}

export interface ApiRevGas {
  criarVenda(corpo: CorpoVenda): Promise<Resposta>;
}

/** Consultar e cancelar vendas: usado pelo painel "Pedido RevGás" e pelo npm run cancelar-venda. */
export interface ConsultaVendas {
  detalharVenda(id: number): Promise<Resposta>;
  cancelarVenda(id: number): Promise<Resposta>;
}

/**
 * Cliente que volta: nome e endereço da venda mais recente desse telefone. A chave não acessa
 * /customers, então o histórico de vendas do ERP faz o papel do cadastro.
 */
export interface BuscaCliente {
  ultimoCliente(telefone: string): Promise<Pick<Pedido, 'nome' | 'endereco'> | null>;
}

/** Imita o ERP em memória. Padrão nos testes e na demo sem VENDA_REAL. */
export class ApiRevGasFalsa implements ApiRevGas, ConsultaVendas, BuscaCliente {
  vendas: CorpoVenda[] = [];

  async ultimoCliente(telefone: string) {
    for (const v of [...this.vendas].reverse()) {
      const c = clienteDaVenda(v, telefone);
      if (c) return c;
    }
    return null;
  }
  canceladas = new Set<number>();
  proximaResposta?: Resposta | 'timeout';

  /** Mesmo formato do detalhe da API real (sem o envelope `data`). */
  async detalharVenda(id: number): Promise<Resposta> {
    const v = this.vendas[idValido(id) - 1];
    if (!v) return { status: 404, dados: null };
    const total = (v.products ?? []).reduce((s, p) => s + p.value * p.quantity, 0);
    return {
      status: 200,
      dados: { id, establishment_id: v.establishment_id, status: this.canceladas.has(id) ? 'CANCEL' : 'OPEN', total },
    };
  }

  async cancelarVenda(id: number): Promise<Resposta> {
    if (!this.vendas[idValido(id) - 1]) return { status: 404, dados: null };
    this.canceladas.add(id);
    return { status: 204, dados: null };
  }

  async criarVenda(corpo: CorpoVenda): Promise<Resposta> {
    const forcada = this.proximaResposta;
    this.proximaResposta = undefined;
    if (forcada === 'timeout') throw new TempoEsgotado('timeout simulado');
    if (forcada) return forcada;
    this.vendas.push(corpo);
    return { status: 201, dados: { data: { id: this.vendas.length } } };
  }
}

export class ApiRevGasHttp implements ApiRevGas, ConsultaVendas, BuscaCliente {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly intervaloMs: number;
  private readonly timeoutMs: number;
  /** Criar venda (cliente esperando) passa na frente de consultar/cancelar (painel). */
  private readonly filas: Record<'venda' | 'painel', (() => Promise<void>)[]> = { venda: [], painel: [] };
  private processando = false;
  private ultima = 0;
  private readonly estabelecimentoId?: number;

  constructor(
    url: string,
    private readonly chave: string,
    opts: { fetch?: typeof fetch; intervaloMs?: number; timeoutMs?: number; estabelecimentoId?: number } = {},
  ) {
    this.estabelecimentoId = opts.estabelecimentoId;
    if (!url.trim() || !chave.trim()) throw new Error('REVGAS_API_URL e REVGAS_API_KEY são obrigatórias');
    this.base = url.trim().replace(/\/+$/, '');
    this.fetch = opts.fetch ?? fetch;
    this.intervaloMs = opts.intervaloMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  criarVenda(corpo: CorpoVenda): Promise<Resposta> {
    return this.enfileirar('venda', () => this.enviar('POST', '/sales', corpo));
  }

  // Fora da porta ApiRevGas: conferir e limpar vendas de teste (painel e npm run cancelar-venda).
  detalharVenda(id: number): Promise<Resposta> {
    const v = idValido(id);
    return this.enfileirar('painel', () => this.enviar('GET', `/sales/${v}`, undefined));
  }

  // shortcut: varre só as 100 vendas mais recentes (2 páginas, 1 req/s); trocar por GET /customers
  // quando a RevGás liberar esse acesso para a chave.
  async ultimoCliente(telefone: string) {
    for (let pagina = 1; pagina <= 2; pagina++) {
      const r = await this.enfileirar('painel', () => this.enviar('GET', `/sales?page_size=50&page=${pagina}`, undefined));
      const corpo = r.dados as { data?: VendaListada[]; pagination?: { has_next?: boolean } } | null;
      if (r.status !== 200 || !Array.isArray(corpo?.data)) return null;
      for (const v of corpo.data) {
        // O estabelecimento de teste é compartilhado: só vale venda do nosso.
        if (this.estabelecimentoId && v.establishment_id !== this.estabelecimentoId) continue;
        const c = clienteDaVenda(v, telefone);
        if (c) return c;
      }
      if (!corpo.pagination?.has_next) return null;
    }
    return null;
  }

  cancelarVenda(id: number): Promise<Resposta> {
    const v = idValido(id);
    return this.enfileirar('painel', () => this.enviar('PUT', `/sales/${v}/cancel`, { motive_cancel_sale_id: null }));
  }

  // A API limita a 1 req/s: as chamadas saem uma por vez, espaçadas. Sem prioridade, abrir a lista
  // do painel (uma consulta por pedido) atrasava em segundos a venda de um cliente que confirmava.
  private enfileirar<T>(fila: 'venda' | 'painel', tarefa: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.filas[fila].push(() => tarefa().then(resolve, reject));
      void this.processar();
    });
  }

  private async processar() {
    if (this.processando) return;
    this.processando = true;
    try {
      while (this.filas.venda.length || this.filas.painel.length) {
        const espera = this.ultima + this.intervaloMs - Date.now();
        if (espera > 0) await new Promise((r) => setTimeout(r, espera));
        // Escolhe só depois da espera: uma venda que chegou nesse meio-tempo ainda passa na frente.
        const proxima = this.filas.venda.shift() ?? this.filas.painel.shift()!;
        this.ultima = Date.now();
        await proxima();
      }
    } finally {
      this.processando = false;
    }
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
