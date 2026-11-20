import { Redis } from 'ioredis';

/** Fuso da revenda (Teresina, UTC−3): "hoje" é o dia de lá, não o do servidor. */
const FUSO_REVENDA = 'America/Fortaleza';

/** Um pedido confirmado, como a lista "Pedidos de hoje" mostra. */
export type PedidoRegistrado = {
  vendaId: number;
  conversaId: number;
  /** ISO 8601 (UTC). */
  quando: string;
  nome: string;
  produto: string;
  quantidade: number;
  total: string;
  pagamento: string;
  endereco: string;
};

/** Dia (AAAA-MM-DD) de um instante no fuso da revenda. */
export function diaDaRevenda(quando: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_REVENDA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(quando);
}

/**
 * Pedidos confirmados por dia. Guarda dados pessoais (nome, endereço), então só o necessário
 * para a lista e por pouco tempo: a lista mostra só o dia de hoje.
 */
export interface RegistroPedidos {
  adicionar(p: PedidoRegistrado): Promise<void>;
  doDia(dia: string): Promise<PedidoRegistrado[]>;
  /** Pedido de uma venda registrada nos últimos dias; `null` = venda que o bot não registrou. */
  daVenda(vendaId: number): Promise<PedidoRegistrado | null>;
}

const DIAS_GUARDADOS = 2;

/** Some ao reiniciar o bot; use Redis (REDIS_URL) fora dos testes. */
export class RegistroPedidosMemoria implements RegistroPedidos {
  private lista: PedidoRegistrado[] = [];
  async adicionar(p: PedidoRegistrado) {
    this.lista.push(p);
  }
  async doDia(dia: string) {
    return this.lista.filter((p) => diaDaRevenda(new Date(p.quando)) === dia);
  }
  async daVenda(vendaId: number) {
    return this.lista.findLast((p) => p.vendaId === vendaId) ?? null;
  }
}

export class RegistroPedidosRedis implements RegistroPedidos {
  private readonly redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url);
  }
  async adicionar(p: PedidoRegistrado) {
    const ttl = DIAS_GUARDADOS * 86_400;
    const chaveDia = `pedidos:dia:${diaDaRevenda(new Date(p.quando))}`;
    await this.redis
      .multi()
      .rpush(chaveDia, JSON.stringify(p))
      .expire(chaveDia, ttl)
      .set(`pedidos:venda:${p.vendaId}`, JSON.stringify(p), 'EX', ttl)
      .exec();
  }
  async doDia(dia: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return [];
    const itens = await this.redis.lrange(`pedidos:dia:${dia}`, 0, -1);
    return itens.map((i) => JSON.parse(i) as PedidoRegistrado);
  }
  async daVenda(vendaId: number) {
    if (!Number.isSafeInteger(vendaId) || vendaId <= 0) return null;
    const v = await this.redis.get(`pedidos:venda:${vendaId}`);
    return v ? (JSON.parse(v) as PedidoRegistrado) : null;
  }
}
