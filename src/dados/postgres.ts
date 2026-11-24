import pg from 'pg';
import type { Evento } from '../metricas.js';
import type { ChamadaApi } from '../vendas/api-revgas.js';

/** O que usamos do pg.Pool (os testes passam um falso). */
type PoolMinimo = { query(sql: string, valores: unknown[]): Promise<unknown>; end(): Promise<void> };

/**
 * Grava no banco "revgas" (scripts/revgas-db.sql) as chamadas à API e os eventos de atendimento,
 * que o Metabase lê. Melhor esforço: quem chama não espera nem recebe erro; o cliente no WhatsApp
 * nunca sente uma falha do banco. Nada pessoal entra aqui (ver os tipos ChamadaApi e Evento).
 */
export function criarRegistroPostgres(url: string, pool: PoolMinimo = novoPool(url)) {
  const pendentes = new Set<Promise<unknown>>();
  let ultimoAviso = 0;

  function gravar(sql: string, valores: unknown[]) {
    const p = pool
      .query(sql, valores)
      .catch((e: unknown) => {
        // Banco fora do ar: um aviso por minuto, não um por mensagem.
        if (Date.now() - ultimoAviso < 60_000) return;
        ultimoAviso = Date.now();
        console.warn(`Postgres (registro das métricas) falhou: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      })
      .finally(() => pendentes.delete(p));
    pendentes.add(p);
  }

  return {
    chamada(c: ChamadaApi): void {
      gravar('INSERT INTO revgas.chamadas_api (metodo, rota, status, ms, venda_id, fila) VALUES ($1, $2, $3, $4, $5, $6)', [
        c.metodo, c.rota, c.status, c.ms, c.vendaId, c.fila,
      ]);
    },
    evento(e: Evento): void {
      gravar('INSERT INTO revgas.eventos (conversa_id, tipo, estado, motivo, resultado, ms, ia) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        e.conversaId, e.tipo, e.estado ?? null, e.motivo ?? null, e.resultado ?? null, e.ms ?? null, e.ia ?? null,
      ]);
    },
    /** Espera as gravações em andamento e fecha a conexão (desligamento do bot). */
    async fechar(): Promise<void> {
      await Promise.all(pendentes);
      await pool.end().catch(() => undefined);
    },
  };
}

export type RegistroPostgres = ReturnType<typeof criarRegistroPostgres>;

function novoPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  // Conexão ociosa que cai (Postgres reiniciou) emite 'error'; sem ouvinte, derrubaria o bot inteiro.
  pool.on('error', () => undefined);
  return pool;
}
