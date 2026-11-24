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

// --- v2: consultas (Tarefa 1, #33) ---

const MARCA = 'Pedido via WhatsApp (RevGás Atende). Cliente:';
function venda(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, date: '2026-11-23T18:00:00-03:00', status: 'ACTIVE', total: 110, paid: false, establishment_id: 2580,
    short_address: 'Rua Nova, 10', location: 'Rua Nova', number: '10', neighborhood: 'Centro', city: 'Teresina', state_federation: 'PI',
    observation: `${MARCA} Maria 5586999990000.`, ...extra,
  };
}

/** Responde por caminho (sem a base); guarda as URLs pedidas. */
function roteador(rotas: Record<string, unknown>) {
  const urls: string[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = String(url).replace('https://x/v1', '');
    urls.push(`${init?.method} ${caminho}`);
    const chave = Object.keys(rotas).find((k) => caminho === k || caminho.startsWith(k + '?') && !rotas[caminho]);
    const r = rotas[caminho] ?? (chave ? rotas[chave] : undefined);
    if (r === undefined) return new Response('{}', { status: 404 });
    const [status, dados] = Array.isArray(r) && typeof r[0] === 'number' ? (r as [number, unknown]) : [200, r];
    return new Response(status === 204 ? null : JSON.stringify(dados), { status });
  });
  return { f, urls };
}

const http = (f: typeof fetch, extra: Record<string, unknown> = {}) =>
  new ApiRevGasHttp('https://x/v1', 'K', { fetch: f, intervaloMs: 0, estabelecimentoId: 2580, ...extra });

describe('ApiRevGasHttp v2', () => {
  it('vendasDoCliente: só ACTIVE do bot, do estabelecimento e do telefone (com ou sem o 9), no máximo 5', async () => {
    const pagina = {
      data: [
        venda(9, { date: '2026-11-23T20:00:00-03:00' }),
        venda(8, { observation: 'venda no balcão' }),
        venda(7, { establishment_id: 1 }),
        venda(6, { observation: `${MARCA} Ana 5586988887777.` }),
        ...[5, 4, 3, 2, 1].map((id) => venda(id, { date: `2026-11-2${id % 3}T10:00:00-03:00` })),
      ],
      pagination: { has_next: false },
    };
    const { f, urls } = roteador({ '/sales?status=ACTIVE&page_size=50&page=1': pagina });
    const vendas = await http(f).vendasDoCliente('558699990000');
    expect(urls[0]).toBe('GET /sales?status=ACTIVE&page_size=50&page=1');
    expect(vendas.map((v) => v.id)).toEqual([9, 5, 2, 4, 1]);
    expect(vendas[0]).toEqual({
      id: 9, data: '2026-11-23T20:00:00-03:00', status: 'ACTIVE', total: 110, endereco: 'Rua Nova, 10', pago: false, doBot: true,
      cliente: 'Maria', conversaId: null, itens: '', pagamento: '',
    });
  });

  it('resumo: conversa, itens e pagamento vêm da venda (observação, products, payments)', async () => {
    const v = venda(9, {
      observation: `${MARCA} Maria 5586999990000. Conversa 12.`,
      products: [{ quantity: 2, product_id: 26717, product_description: 'GLP 13KG' }],
      payments: [{ payment_type: 'PIX' }],
    });
    const { f } = roteador({ '/sales/9': v });
    expect(await http(f).historico(9)).toMatchObject({ cliente: 'Maria', conversaId: 12, itens: '2x GLP 13KG', pagamento: 'PIX' });
  });

  it('historico: logs como { status, quando }; venda que não é do bot → null', async () => {
    const logs = [{ status: 'OPEN', created_at: '2026-11-23T18:00:00-03:00', user_id: 1 }];
    const { f } = roteador({ '/sales/9': venda(9, { logs }), '/sales/7': venda(7, { establishment_id: 1, logs }), '/sales/5': [404, {}] });
    const api = http(f);
    expect(await api.historico(9)).toMatchObject({ id: 9, doBot: true, logs: [{ status: 'OPEN', quando: '2026-11-23T18:00:00-03:00' }] });
    expect(await api.historico(7)).toBeNull();
    expect(await api.historico(5)).toBeNull();
  });

  it('vendasDoBot: dia no fuso da revenda (23h30 em Fortaleza ainda é o mesmo dia)', async () => {
    const pagina = {
      data: [
        venda(3, { date: '2026-11-24T02:30:00Z' }), // 23h30 de 23/11 em Fortaleza
        venda(2, { date: '2026-11-23T08:00:00-03:00', status: 'CANCEL' }),
        venda(1, { date: '2026-11-22T21:00:00-03:00' }),
      ],
      pagination: { has_next: true },
    };
    const { f, urls } = roteador({ '/sales?page_size=50&page=1': pagina });
    const vendas = await http(f).vendasDoBot('2026-11-23');
    expect(vendas.map((v) => [v.id, v.status])).toEqual([[3, 'ACTIVE'], [2, 'CANCEL']]);
    expect(urls).toHaveLength(1); // a página já chegou a 22/11: não busca a próxima
  });

  it('produtos e situacao: cache de 5 minutos', async () => {
    let agora = 0;
    const { f, urls } = roteador({
      '/products?page_size=50&page=1': { data: [{ id: 26717, description: 'GLP 13KG', stock_quantity: 933, inactive: false }], pagination: { has_next: false } },
      '/establishments/2580': { accept_order: true, allow_cancel_sale: false },
    });
    const api = http(f, { agora: () => agora });
    expect(await api.produtos()).toEqual([{ id: 26717, descricao: 'GLP 13KG', estoque: 933, ativo: true }]);
    expect(await api.situacao()).toEqual({ aceitaPedido: true, permiteCancelar: false });
    await api.produtos();
    await api.situacao();
    expect(urls).toHaveLength(2);
    agora = 5 * 60_000 + 1;
    await api.produtos();
    expect(urls).toHaveLength(3);
  });

  it('aoChamar recebe cada chamada com a rota normalizada', async () => {
    const chamadas: unknown[] = [];
    const { f } = roteador({ '/sales/7/cancel': [204, {}], '/sales': [201, { data: { id: 8 } }] });
    const api = http(f, { aoChamar: (c: unknown) => chamadas.push(c) });
    await api.cancelarVenda(7);
    await api.criarVenda(corpo);
    expect(chamadas).toEqual([
      { metodo: 'PUT', rota: '/sales/:id/cancel', status: 204, ms: expect.any(Number), vendaId: 7, fila: 'consulta' },
      { metodo: 'POST', rota: '/sales', status: 201, ms: expect.any(Number), vendaId: 8, fila: 'venda' },
    ]);
  });

  it('aoChamar com falha de rede: status null', async () => {
    const chamadas: { status: number | null }[] = [];
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const api = http(f as never, { aoChamar: (c: { status: number | null }) => chamadas.push(c) });
    await expect(api.detalharVenda(3)).rejects.toBeInstanceOf(TempoEsgotado);
    expect(chamadas[0]).toMatchObject({ rota: '/sales/:id', status: null, vendaId: 3 });
  });
});

describe('ApiRevGasFalsa v2', () => {
  it('lista, detalha e cancela como a API real', async () => {
    const api = new ApiRevGasFalsa();
    const pedido = { ...corpo, location: 'Rua Nova', number: '10', neighborhood: 'Centro', city: 'Teresina', state_federation: 'PI',
      observation: `${MARCA} Maria 5586999990000.`, payments: [{ payment_type: 'PIX', value: 110 }], products: [{ product_id: 1, quantity: 1, value: 110 }] } as CorpoVenda;
    await api.criarVenda(pedido);
    expect((await api.vendasDoCliente('5586999990000')).map((v) => v.id)).toEqual([1]);
    expect(await api.historico(1)).toMatchObject({ status: 'ACTIVE', total: 110, logs: [{ status: 'OPEN' }] });
    await api.cancelarVenda(1);
    expect(await api.vendasDoCliente('5586999990000')).toEqual([]);
    expect(await api.historico(1)).toMatchObject({ status: 'CANCEL', logs: [{ status: 'OPEN' }, { status: 'CANCEL' }] });
    expect(await api.situacao()).toEqual({ aceitaPedido: true, permiteCancelar: true });
  });
});
