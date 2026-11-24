import { describe, expect, it, vi } from 'vitest';
import { criarRegistroPostgres } from '../../src/dados/postgres.js';

function poolFalso(falha?: Error) {
  return {
    query: vi.fn(async (_sql: string, _valores?: unknown[]) => {
      if (falha) throw falha;
      return { rows: [] };
    }),
    end: vi.fn(async () => {}),
  };
}

describe('criarRegistroPostgres', () => {
  it('grava a chamada à API com os 6 valores na ordem', async () => {
    const pool = poolFalso();
    const r = criarRegistroPostgres('postgres://x', pool);
    r.chamada({ metodo: 'PUT', rota: '/sales/:id/cancel', status: 204, ms: 120, vendaId: 7, fila: 'consulta' });
    await r.fechar();
    const [sql, valores] = pool.query.mock.calls[0]!;
    expect(sql).toMatch(/^INSERT INTO revgas\.chamadas_api \(metodo, rota, status, ms, venda_id, fila\)/);
    expect(valores).toEqual(['PUT', '/sales/:id/cancel', 204, 120, 7, 'consulta']);
  });

  it('grava o evento; campos ausentes viram null', async () => {
    const pool = poolFalso();
    const r = criarRegistroPostgres('postgres://x', pool);
    r.evento({ conversaId: 12, tipo: 'cancelamento', resultado: 'cliente' });
    await r.fechar();
    const [sql, valores] = pool.query.mock.calls[0]!;
    expect(sql).toMatch(/^INSERT INTO revgas\.eventos \(conversa_id, tipo, estado, motivo, resultado, ms, ia\)/);
    expect(valores).toEqual([12, 'cancelamento', null, null, 'cliente', null, null]);
  });

  it('banco fora do ar não propaga erro para quem chamou', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = poolFalso(new Error('connect ECONNREFUSED'));
    const r = criarRegistroPostgres('postgres://x', pool);
    expect(() => r.chamada({ metodo: 'GET', rota: '/products', status: 200, ms: 5, vendaId: null, fila: 'consulta' })).not.toThrow();
    await expect(r.fechar()).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    aviso.mockRestore();
  });
});
