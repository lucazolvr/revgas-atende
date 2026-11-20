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

  it('venda de cliente passa na frente das consultas do painel, sem quebrar o espaçamento', async () => {
    const ordem: string[] = [];
    const momentos: number[] = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      ordem.push(`${init?.method} ${String(url).replace('https://x/v1', '')}`);
      momentos.push(Date.now());
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 });
    });
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 40 });
    // O painel abre a lista (três consultas) e logo depois um cliente confirma o pedido.
    const consultas = [api.detalharVenda(1), api.detalharVenda(2), api.detalharVenda(3)];
    const venda = api.criarVenda(corpo);
    await Promise.all([...consultas, venda]);
    expect(ordem).toEqual(['GET /sales/1', 'POST /sales', 'GET /sales/2', 'GET /sales/3']);
    for (let i = 1; i < momentos.length; i++) expect(momentos[i]! - momentos[i - 1]!).toBeGreaterThanOrEqual(35);
  });

  it('uma chamada com erro não trava a fila', async () => {
    let primeira = true;
    const f = vi.fn(async () => {
      if (primeira) {
        primeira = false;
        throw new TypeError('fetch failed');
      }
      return new Response(JSON.stringify({ data: { id: 7 } }), { status: 201 });
    });
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 0 });
    const [falhou, deu] = await Promise.allSettled([api.detalharVenda(1), api.criarVenda(corpo)]);
    expect(falhou.status).toBe('rejected');
    expect(deu).toMatchObject({ status: 'fulfilled', value: { status: 201 } });
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

describe('ApiRevGasFalsa: conferir e cancelar', () => {
  it('detalha no formato da API real e cancela', async () => {
    const api = new ApiRevGasFalsa();
    await api.criarVenda(corpo);
    expect((await api.detalharVenda(1)).dados).toMatchObject({ id: 1, establishment_id: corpo.establishment_id, status: 'OPEN' });
    expect((await api.cancelarVenda(1)).status).toBe(204);
    expect((await api.detalharVenda(1)).dados).toMatchObject({ status: 'CANCEL' });
    expect((await api.detalharVenda(2)).status).toBe(404);
    await expect(api.detalharVenda(-1)).rejects.toThrow('inválido');
  });
});

describe('ApiRevGasHttp: conferir e cancelar venda de teste', () => {
  it('detalha com GET e cancela com PUT /sales/:id/cancel', async () => {
    const f = fetchFalso(200, { data: {} });
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 0 });
    await api.detalharVenda(42);
    await api.cancelarVenda(42);
    expect(f.mock.calls.map(([u, i]) => [u, i?.method])).toEqual([
      ['https://x/v1/sales/42', 'GET'],
      ['https://x/v1/sales/42/cancel', 'PUT'],
    ]);
    expect(JSON.parse(String(f.mock.calls[1]![1]?.body))).toEqual({ motive_cancel_sale_id: null });
  });

  it('recusa id que não é inteiro positivo antes de chamar a API', () => {
    const f = fetchFalso();
    const api = new ApiRevGasHttp('https://x/v1', 'K', { fetch: f });
    expect(() => api.cancelarVenda(-1)).toThrow();
    expect(() => api.detalharVenda(1.5)).toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
