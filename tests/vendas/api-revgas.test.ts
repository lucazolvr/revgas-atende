import { describe, expect, it, vi } from 'vitest';
import { ApiRevGasFalsa, ApiRevGasHttp, TempoEsgotado } from '../../src/vendas/api-revgas.js';
import { registrarVenda } from '../../src/vendas/registrar.js';
import type { CorpoVenda } from '../../src/vendas/pedido.js';

const corpo = { customer_id: 1 } as CorpoVenda;

function fetchFalso(status = 201, dados: unknown = { data: { id: 42 } }) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(dados), { status }));
}

describe('ApiRevGasHttp', () => {
  it('manda a chave crua no Authorization para /sales', async () => {
    const f = fetchFalso();
    const api = new ApiRevGasHttp('https://api.exemplo/v1/', 'CHAVE', { fetch: f, intervaloMs: 0 });
    const r = await api.criarVenda(corpo);
    expect(r).toEqual({ status: 201, dados: { data: { id: 42 } } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.exemplo/v1/sales');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    const h = new Headers(init?.headers);
    expect(h.get('Authorization')).toBe('CHAVE');
    expect(h.get('Content-Type')).toBe('application/json');
  });

  it('espaça as chamadas (1 req/s na API real)', async () => {
    const f = fetchFalso();
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 60 });
    const t0 = Date.now();
    await Promise.all([api.criarVenda(corpo), api.criarVenda(corpo)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });

  it('falha de rede vira TempoEsgotado', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 0 });
    await expect(api.criarVenda(corpo)).rejects.toBeInstanceOf(TempoEsgotado);
  });
});

describe('registrarVenda', () => {
  it('201 → ok com id', async () => {
    const api = new ApiRevGasFalsa();
    expect(await registrarVenda(api, corpo)).toEqual({ tipo: 'ok', id: 1 });
    expect(api.vendas).toHaveLength(1);
  });

  it('422 → inválida', async () => {
    const api = new ApiRevGasFalsa();
    api.proximaResposta = { status: 422, dados: { message: 'city inválida' } };
    expect(await registrarVenda(api, corpo)).toMatchObject({ tipo: 'invalida' });
  });

  it('timeout → incerta, sem repetir o POST', async () => {
    const api = new ApiRevGasFalsa();
    const espiao = vi.spyOn(api, 'criarVenda');
    api.proximaResposta = 'timeout';
    expect(await registrarVenda(api, corpo)).toEqual({ tipo: 'incerta' });
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it('500 → erro', async () => {
    const api = new ApiRevGasFalsa();
    api.proximaResposta = { status: 500, dados: null };
    expect(await registrarVenda(api, corpo)).toEqual({ tipo: 'erro', status: 500 });
  });
});
