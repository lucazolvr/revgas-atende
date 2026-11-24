import { clienteDaVenda, diaDaRevenda, type CorpoVenda, type Pedido, type VendaListada } from './pedido.js';

export type Resposta = { status: number; dados: unknown };

/** A requisição saiu, mas a resposta não chegou: a venda PODE ter sido criada. */
export class TempoEsgotado extends Error {}

/** Uma venda como o bot e o painel mostram. `total` em reais, como a API manda. */
export type VendaResumo = { id: number; data: string; status: string; total: number; endereco: string; pago: boolean; doBot: boolean };
export type HistoricoVenda = VendaResumo & { logs: { status: string; quando: string }[] };
export type ProdutoErp = { id: number; descricao: string; estoque: number; ativo: boolean };
export type SituacaoRevenda = { aceitaPedido: boolean; permiteCancelar: boolean };
/** Uma chamada à API, para o registro no Postgres (Metabase). Sem dados pessoais. */
export type ChamadaApi = { metodo: string; rota: string; status: number | null; ms: number; vendaId: number | null; fila: Fila };
type Fila = 'venda' | 'consulta';

export interface ApiRevGas {
  criarVenda(corpo: CorpoVenda): Promise<Resposta>;
}

/** Consultar e cancelar vendas: usado pelo bot, pelo painel "Pedido RevGás" e pelo npm run cancelar-venda. */
export interface ConsultaVendas {
  detalharVenda(id: number): Promise<Resposta>;
  cancelarVenda(id: number): Promise<Resposta>;
  /** Status, total, endereço e histórico de uma venda do bot. `null` = não existe ou não é do bot. */
  historico(id: number): Promise<HistoricoVenda | null>;
  /** Vendas do bot cuja data cai no dia (AAAA-MM-DD, fuso da revenda), ativas e canceladas. */
  vendasDoBot(dia: string): Promise<VendaResumo[]>;
}

/**
 * Cliente que volta. A chave não acessa /customers, então o histórico de vendas do ERP faz o papel
 * do cadastro: o telefone está na observação de cada venda do bot.
 */
export interface BuscaCliente {
  /** Nome e endereço da venda mais recente desse telefone. */
  ultimoCliente(telefone: string): Promise<Pick<Pedido, 'nome' | 'endereco'> | null>;
  /** Vendas ACTIVE do bot com esse telefone, mais recentes primeiro, no máximo 5. */
  vendasDoCliente(telefone: string): Promise<VendaResumo[]>;
}

/** Catálogo e situação da revenda no ERP (com cache de 5 minutos na API real). */
export interface ConsultaErp {
  produtos(): Promise<ProdutoErp[]>;
  situacao(): Promise<SituacaoRevenda>;
}

/** Venda criada por este bot: do nosso estabelecimento (quando configurado) e com a marca na observação. */
function ehDoBot(v: VendaApi, estabelecimentoId?: number): boolean {
  return (!estabelecimentoId || v.establishment_id === estabelecimentoId) && !!v.observation?.includes('RevGás Atende');
}

type VendaApi = VendaListada & {
  id: number;
  date: string;
  status: string;
  total: number;
  paid?: boolean;
  short_address?: string;
  display_address?: string;
  logs?: { status: string; created_at: string }[];
};

function resumo(v: VendaApi, estabelecimentoId?: number): VendaResumo {
  return {
    id: v.id,
    data: v.date,
    status: v.status,
    total: v.total,
    endereco: v.short_address ?? v.display_address ?? `${v.location ?? ''}, ${v.number ?? ''}`,
    pago: !!v.paid,
    doBot: ehDoBot(v, estabelecimentoId),
  };
}

const MAXIMO_DO_CLIENTE = 5;
const recentesPrimeiro = (a: VendaResumo, b: VendaResumo) => Date.parse(b.data) - Date.parse(a.data);

/** Imita o ERP em memória. Padrão nos testes e na demo sem VENDA_REAL. */
export class ApiRevGasFalsa implements ApiRevGas, ConsultaVendas, BuscaCliente, ConsultaErp {
  vendas: CorpoVenda[] = [];
  /** Quando cada venda foi criada (ISO); os testes podem trocar. */
  datas: string[] = [];
  canceladas = new Set<number>();
  proximaResposta?: Resposta | 'timeout';
  produtosErp: ProdutoErp[] = [];
  situacaoErp: SituacaoRevenda = { aceitaPedido: true, permiteCancelar: true };

  /** As vendas no formato da listagem da API real. */
  private comoApi(): VendaApi[] {
    return this.vendas.map((v, i) => ({
      ...v,
      id: i + 1,
      date: this.datas[i] ?? new Date(0).toISOString(),
      status: this.canceladas.has(i + 1) ? 'CANCEL' : 'ACTIVE',
      total: (v.products ?? []).reduce((s, p) => s + p.value * p.quantity, 0),
      short_address: `${v.location}, ${v.number}`,
    }));
  }

  async ultimoCliente(telefone: string) {
    for (const v of [...this.vendas].reverse()) {
      const c = clienteDaVenda(v, telefone);
      if (c) return c;
    }
    return null;
  }

  async vendasDoCliente(telefone: string) {
    return this.comoApi()
      .filter((v) => v.status === 'ACTIVE' && ehDoBot(v) && clienteDaVenda(v, telefone))
      .map((v) => resumo(v))
      .sort(recentesPrimeiro)
      .slice(0, MAXIMO_DO_CLIENTE);
  }

  async historico(id: number) {
    const v = this.comoApi()[idValido(id) - 1];
    if (!v || !ehDoBot(v)) return null;
    const logs = [{ status: 'OPEN', quando: v.date }, ...(v.status === 'CANCEL' ? [{ status: 'CANCEL', quando: v.date }] : [])];
    return { ...resumo(v), logs };
  }

  async vendasDoBot(dia: string) {
    return this.comoApi()
      .filter((v) => ehDoBot(v) && diaDaRevenda(new Date(v.date)) === dia)
      .map((v) => resumo(v))
      .sort(recentesPrimeiro);
  }

  async produtos() {
    return this.produtosErp;
  }

  async situacao() {
    return this.situacaoErp;
  }

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
    this.datas.push(new Date().toISOString());
    return { status: 201, dados: { data: { id: this.vendas.length } } };
  }
}

const CACHE_MS = 5 * 60_000;
// shortcut: varre só as vendas mais recentes (páginas de 50, 1 req/s); trocar por GET /customers
// quando a RevGás liberar esse acesso para a chave.
const PAGINAS_DO_CLIENTE = 2;
const PAGINAS_DO_DIA = 4;
const PAGINAS_DE_PRODUTOS = 4;

type Pagina<T> = { data?: T[]; pagination?: { has_next?: boolean } } | null;

export class ApiRevGasHttp implements ApiRevGas, ConsultaVendas, BuscaCliente, ConsultaErp {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly intervaloMs: number;
  private readonly timeoutMs: number;
  private readonly estabelecimentoId?: number;
  private readonly agora: () => number;
  private readonly aoChamar?: (c: ChamadaApi) => void;
  /** Criar venda (cliente esperando) passa na frente das consultas. */
  private readonly filas: Record<Fila, (() => Promise<void>)[]> = { venda: [], consulta: [] };
  private processando = false;
  private ultima = 0;
  private readonly cache = new Map<string, { ate: number; valor: unknown }>();

  constructor(
    url: string,
    private readonly chave: string,
    opts: {
      fetch?: typeof fetch;
      intervaloMs?: number;
      timeoutMs?: number;
      estabelecimentoId?: number;
      /** Relógio do cache (testes). */
      agora?: () => number;
      aoChamar?: (c: ChamadaApi) => void;
    } = {},
  ) {
    if (!url.trim() || !chave.trim()) throw new Error('REVGAS_API_URL e REVGAS_API_KEY são obrigatórias');
    this.base = url.trim().replace(/\/+$/, '');
    this.fetch = opts.fetch ?? fetch;
    this.intervaloMs = opts.intervaloMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.estabelecimentoId = opts.estabelecimentoId;
    this.agora = opts.agora ?? Date.now;
    this.aoChamar = opts.aoChamar;
  }

  criarVenda(corpo: CorpoVenda): Promise<Resposta> {
    return this.enfileirar('venda', () => this.enviar('POST', '/sales', corpo, 'venda'));
  }

  detalharVenda(id: number): Promise<Resposta> {
    return this.consultar('GET', `/sales/${idValido(id)}`);
  }

  cancelarVenda(id: number): Promise<Resposta> {
    return this.consultar('PUT', `/sales/${idValido(id)}/cancel`, { motive_cancel_sale_id: null });
  }

  async historico(id: number) {
    const r = await this.detalharVenda(id);
    // O detalhe vem sem o envelope `data` (ao contrário da listagem); aceita os dois formatos.
    const bruto = r.dados as ({ data?: VendaApi } & VendaApi) | null;
    const v = bruto?.data ?? bruto;
    if (r.status !== 200 || !v?.id || !ehDoBot(v, this.estabelecimentoId)) return null;
    return { ...resumo(v, this.estabelecimentoId), logs: (v.logs ?? []).map((l) => ({ status: l.status, quando: l.created_at })) };
  }

  async ultimoCliente(telefone: string) {
    let achado: Pick<Pedido, 'nome' | 'endereco'> | null = null;
    await this.varrerVendas('', PAGINAS_DO_CLIENTE, (v) => {
      achado = ehDoBot(v, this.estabelecimentoId) ? clienteDaVenda(v, telefone) : null;
      return !!achado;
    });
    return achado;
  }

  async vendasDoCliente(telefone: string) {
    const vendas: VendaResumo[] = [];
    await this.varrerVendas('status=ACTIVE&', PAGINAS_DO_CLIENTE, (v) => {
      if (ehDoBot(v, this.estabelecimentoId) && clienteDaVenda(v, telefone)) vendas.push(resumo(v, this.estabelecimentoId));
      return false;
    });
    return vendas.sort(recentesPrimeiro).slice(0, MAXIMO_DO_CLIENTE);
  }

  async vendasDoBot(dia: string) {
    const vendas: VendaResumo[] = [];
    // A listagem vem da mais nova para a mais antiga: ao passar do dia, para.
    await this.varrerVendas('', PAGINAS_DO_DIA, (v) => {
      const d = diaDaRevenda(new Date(v.date));
      if (d === dia && ehDoBot(v, this.estabelecimentoId)) vendas.push(resumo(v, this.estabelecimentoId));
      return d < dia;
    });
    return vendas.sort(recentesPrimeiro);
  }

  produtos(): Promise<ProdutoErp[]> {
    return this.emCache('produtos', async () => {
      const produtos: ProdutoErp[] = [];
      for (let pagina = 1; pagina <= PAGINAS_DE_PRODUTOS; pagina++) {
        const r = await this.consultar('GET', `/products?page_size=50&page=${pagina}`);
        const corpo = r.dados as Pagina<{ id: number; description: string; stock_quantity: number; inactive: boolean }>;
        if (r.status !== 200 || !Array.isArray(corpo?.data)) throw new Error(`GET /products respondeu ${r.status}`);
        for (const p of corpo.data) produtos.push({ id: p.id, descricao: p.description, estoque: p.stock_quantity, ativo: !p.inactive });
        if (!corpo.pagination?.has_next) break;
      }
      return produtos;
    });
  }

  situacao(): Promise<SituacaoRevenda> {
    return this.emCache('situacao', async () => {
      if (!this.estabelecimentoId) return { aceitaPedido: true, permiteCancelar: true };
      const r = await this.consultar('GET', `/establishments/${this.estabelecimentoId}`);
      const e = r.dados as { accept_order?: boolean; allow_cancel_sale?: boolean } | null;
      if (r.status !== 200 || !e) throw new Error(`GET /establishments respondeu ${r.status}`);
      return { aceitaPedido: e.accept_order !== false, permiteCancelar: e.allow_cancel_sale !== false };
    });
  }

  /** Falha não entra no cache: a próxima chamada tenta de novo. */
  private async emCache<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
    const c = this.cache.get(chave);
    if (c && c.ate > this.agora()) return c.valor as T;
    const valor = await buscar();
    this.cache.set(chave, { ate: this.agora() + CACHE_MS, valor });
    return valor;
  }

  /** Percorre a listagem de vendas página a página até `parar` devolver true ou acabar. */
  private async varrerVendas(filtro: string, paginas: number, parar: (v: VendaApi) => boolean) {
    for (let pagina = 1; pagina <= paginas; pagina++) {
      const r = await this.consultar('GET', `/sales?${filtro}page_size=50&page=${pagina}`);
      const corpo = r.dados as Pagina<VendaApi>;
      if (r.status !== 200 || !Array.isArray(corpo?.data)) return;
      for (const v of corpo.data) if (parar(v)) return;
      if (!corpo.pagination?.has_next) return;
    }
  }

  private consultar(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
    return this.enfileirar('consulta', () => this.enviar(metodo, caminho, corpo, 'consulta'));
  }

  // A API limita a 1 req/s: as chamadas saem uma por vez, espaçadas. Sem prioridade, abrir a lista
  // do painel (uma consulta por pedido) atrasava em segundos a venda de um cliente que confirmava.
  private enfileirar<T>(fila: Fila, tarefa: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.filas[fila].push(() => tarefa().then(resolve, reject));
      void this.processar();
    });
  }

  private async processar() {
    if (this.processando) return;
    this.processando = true;
    try {
      while (this.filas.venda.length || this.filas.consulta.length) {
        const espera = this.ultima + this.intervaloMs - Date.now();
        if (espera > 0) await new Promise((r) => setTimeout(r, espera));
        // Escolhe só depois da espera: uma venda que chegou nesse meio-tempo ainda passa na frente.
        const proxima = this.filas.venda.shift() ?? this.filas.consulta.shift()!;
        this.ultima = Date.now();
        await proxima();
      }
    } finally {
      this.processando = false;
    }
  }

  private async enviar(metodo: string, caminho: string, corpo: unknown, fila: Fila): Promise<Resposta> {
    const inicio = Date.now();
    const registrar = (status: number | null, dados: unknown) => {
      if (!this.aoChamar) return;
      const doCaminho = caminho.match(/^\/sales\/(\d+)/)?.[1];
      const criada = (dados as { data?: { id?: unknown } } | null)?.data?.id;
      try {
        this.aoChamar({
          metodo,
          rota: caminho.split('?')[0]!.replace(/\/\d+(?=\/|$)/g, '/:id'),
          status,
          ms: Date.now() - inicio,
          vendaId: doCaminho ? Number(doCaminho) : typeof criada === 'number' ? criada : null,
          fila,
        });
      } catch {
        /* registro é melhor esforço: nunca atrapalha a chamada */
      }
    };
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
      registrar(null, null);
      throw new TempoEsgotado(`sem resposta da API em ${metodo} ${caminho.split('?')[0]}`);
    }
    let dados: unknown = null;
    try {
      dados = await resposta.json();
    } catch {
      /* corpo vazio ou não-JSON */
    }
    registrar(resposta.status, dados);
    return { status: resposta.status, dados };
  }
}

/** O id vai para a URL autenticada: só inteiro positivo. */
function idValido(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`id de venda inválido: ${id}`);
  return id;
}
