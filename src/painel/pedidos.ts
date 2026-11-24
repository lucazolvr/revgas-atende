import type { Redis } from 'ioredis';

import { diaDaRevenda } from '../vendas/pedido.js';

export { diaDaRevenda };

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

/**
 * Some ao reiniciar o bot (usado com o ERP de demonstração, que também some). Descarta pedidos com
 * mais de 2 dias, como o Redis: nome e endereço não ficam guardados além disso.
 */
export class RegistroPedidosMemoria implements RegistroPedidos {
  private lista: PedidoRegistrado[] = [];
  constructor(private readonly agora: () => number = Date.now) {}

  private validos() {
    const limite = this.agora() - DIAS_GUARDADOS * 86_400_000;
    this.lista = this.lista.filter((p) => Date.parse(p.quando) >= limite);
    return this.lista;
  }
  async adicionar(p: PedidoRegistrado) {
    this.validos().push(p);
  }
  async doDia(dia: string) {
    return this.validos().filter((p) => diaDaRevenda(new Date(p.quando)) === dia);
  }
  async daVenda(vendaId: number) {
    return this.validos().findLast((p) => p.vendaId === vendaId) ?? null;
  }
}

/** Recebe a conexão pronta (a mesma das sessões do bot). */
export class RegistroPedidosRedis implements RegistroPedidos {
  constructor(private readonly redis: Redis) {}
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
