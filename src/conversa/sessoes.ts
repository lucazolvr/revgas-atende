import type { Redis } from 'ioredis';
import type { Sessao } from './motor.js';

export interface Sessoes {
  obter(id: number): Promise<Sessao | null>;
  salvar(id: number, s: Sessao): Promise<void>;
}

/** shortcut: some ao reiniciar o bot; use Redis (REDIS_URL) fora dos testes. */
export class SessoesMemoria implements Sessoes {
  private mapa = new Map<number, Sessao>();
  async obter(id: number) {
    return this.mapa.get(id) ?? null;
  }
  async salvar(id: number, s: Sessao) {
    this.mapa.set(id, s);
  }
}

/** Recebe a conexão pronta: o bot abre uma só e divide com o registro de pedidos do painel. */
export class SessoesRedis implements Sessoes {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSegundos = 7200,
  ) {}
  async obter(id: number) {
    const v = await this.redis.get(`sessao:${id}`);
    return v ? (JSON.parse(v) as Sessao) : null;
  }
  async salvar(id: number, s: Sessao) {
    await this.redis.set(`sessao:${id}`, JSON.stringify(s), 'EX', this.ttlSegundos);
  }
}
