import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { RegistroPedidosMemoria, type PedidoRegistrado } from '../../src/painel/pedidos.js';
import { registrarPainel, type DepsPainel } from '../../src/painel/rotas.js';
import { ApiRevGasFalsa } from '../../src/vendas/api-revgas.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import { corpoDaVenda } from '../../src/vendas/pedido.js';

const TOKEN = 'token-do-painel-para-teste-1234567890';
const catalogo = carregarCatalogo();
const PEDIDO = {
  telefone: '5586999990000',
  nome: 'Maria',
  produto: 'P13',
  quantidade: 2,
  endereco: { logradouro: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Teresina', uf: 'PI' },
  pagamento: 'PIX' as const,
};

const AGORA = new Date('2026-11-21T15:00:00Z'); // 12h em Teresina
const registro = (vendaId: number, conversaId: number, quando: string): PedidoRegistrado => ({
  vendaId, conversaId, quando, nome: `Cliente ${vendaId}`, produto: 'Botijão de gás P13', quantidade: 2,
  total: 'R$ 220,00', pagamento: 'PIX', endereco: 'Rua Nova, 10 - Centro, Teresina/PI',
});

/**
 * Aba: conversa 7 com a venda 1 (estabelecimento 2580); conversa 8 sem venda; 9 não existe.
 * Conversas 12 e 13: "Nº da venda" editado à mão para a venda 2 (de outra conversa) e para a 4.
 * Lista: venda 1 hoje cedo (conversa 7), venda 2 hoje à tarde (conversa 10), venda 3 ontem.
 * A venda 4 existe no ERP mas não foi registrada pelo bot.
 */
async function montar(opcoes: { estabelecimentoDaVenda?: number } = {}) {
  const vendas = new ApiRevGasFalsa();
  for (let i = 0; i < 4; i++) {
    await vendas.criarVenda(corpoDaVenda(PEDIDO, catalogo, { clienteId: 1, estabelecimentoId: opcoes.estabelecimentoDaVenda ?? 2580 }));
  }
  const pedidos = new RegistroPedidosMemoria();
  await pedidos.adicionar(registro(1, 7, '2026-11-21T10:30:00Z'));
  await pedidos.adicionar(registro(2, 10, '2026-11-21T14:00:00Z'));
  await pedidos.adicionar(registro(3, 11, '2026-11-21T02:00:00Z')); // 23h do dia 20 em Teresina
  const atributos: Record<number, Record<string, unknown>> = {
    7: { numero_venda: 1, total: 'R$ 220,00', forma_pagamento: 'PIX', endereco: 'Rua Nova, 10 - Centro, Teresina/PI', quantidade: 2, outro: 'x' },
    8: { quantidade: 3 },
    12: { numero_venda: 2 },
    13: { numero_venda: 4 },
  };
  const chatwoot = {
    atributosDe: vi.fn(async (id: number) => atributos[id] ?? null),
    nota: vi.fn(async (_id: number, _texto: string) => {}),
  };
  const deps: DepsPainel = {
    token: TOKEN,
    origensChatwoot: ['http://localhost:3000'],
    contaChatwoot: 1,
    chatwoot,
    vendas,
    pedidos,
    estabelecimentoId: 2580,
    modo: 'memoria',
    agora: () => AGORA,
  };
  const app = Fastify();
  registrarPainel(app, deps);
  const pedir = (url: string, metodo: 'GET' | 'POST' = 'GET', token: string | null = TOKEN) =>
    app.inject({ method: metodo, url, headers: token === null ? {} : { authorization: `Bearer ${token}` } });
  return { app, vendas, chatwoot, pedir };
}

describe('painel Pedido RevGás', () => {
  it('serve a página só para ser aberta dentro do Chatwoot', async () => {
    const { pedir } = await montar();
    for (const url of ['/painel', '/painel/painel.js', '/painel/painel.css', '/painel/pedidos', '/painel/pedidos.js', '/painel/menu.js']) {
      const r = await pedir(url, 'GET', null);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-security-policy']).toContain('frame-ancestors http://localhost:3000');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
    }
    expect((await pedir('/painel', 'GET', null)).body).toContain('Pedido RevGás');
  });

  it('API sem token, com token errado ou com id inválido é recusada', async () => {
    const { pedir, chatwoot } = await montar();
    expect((await pedir('/painel/api/conversas/7', 'GET', null)).statusCode).toBe(401);
    expect((await pedir('/painel/api/conversas/7', 'GET', 'errado')).statusCode).toBe(401);
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST', 'errado')).statusCode).toBe(401);
    expect((await pedir('/painel/api/conversas/abc')).statusCode).toBe(400);
    expect((await pedir('/painel/api/conversas/0')).statusCode).toBe(400);
    expect(chatwoot.atributosDe).not.toHaveBeenCalled();
  });

  it('mostra o pedido gravado pelo bot e a venda no ERP', async () => {
    const { pedir } = await montar();
    const r = await pedir('/painel/api/conversas/7');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({
      conversa: 7,
      modo: 'memoria',
      pedido: { numero_venda: 1, total: 'R$ 220,00', forma_pagamento: 'PIX', endereco: 'Rua Nova, 10 - Centro, Teresina/PI', quantidade: 2 },
      venda: { id: 1, status: 'OPEN', total: 220, doEstabelecimento: true },
      podeCancelar: true,
    });
  });

  it('conversa sem venda não oferece cancelar; conversa inexistente é 404', async () => {
    const { pedir } = await montar();
    expect((await pedir('/painel/api/conversas/8')).json()).toMatchObject({ pedido: { quantidade: 3 }, venda: null, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/8/cancelar', 'POST')).statusCode).toBe(409);
    expect((await pedir('/painel/api/conversas/9')).statusCode).toBe(404);
  });

  it('cancela a venda da conversa, registra nota e não cancela duas vezes', async () => {
    const { pedir, vendas, chatwoot } = await montar();
    const r = await pedir('/painel/api/conversas/7/cancelar', 'POST');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ venda: { id: 1, status: 'CANCEL' }, podeCancelar: false });
    expect(vendas.canceladas.has(1)).toBe(true);
    expect(chatwoot.nota).toHaveBeenCalledWith(7, expect.stringContaining('Venda nº 1 cancelada'));
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(409);
  });

  it('não cancela venda de outro estabelecimento', async () => {
    const { pedir, vendas } = await montar({ estabelecimentoDaVenda: 999 });
    expect((await pedir('/painel/api/conversas/7')).json()).toMatchObject({ venda: { doEstabelecimento: false }, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(403);
    expect(vendas.canceladas.size).toBe(0);
  });

  it('número da venda editado à mão na lateral não consulta nem cancela no ERP', async () => {
    const { pedir, vendas } = await montar();
    const detalhar = vi.spyOn(vendas, 'detalharVenda');
    for (const conversa of [12, 13]) {
      expect((await pedir(`/painel/api/conversas/${conversa}`)).json()).toMatchObject({
        venda: { erro: 'a venda não foi registrada pelo bot nesta conversa' },
        podeCancelar: false,
      });
      expect((await pedir(`/painel/api/conversas/${conversa}/cancelar`, 'POST')).statusCode).toBe(403);
    }
    expect(detalhar).not.toHaveBeenCalled();
    expect(vendas.canceladas.size).toBe(0);
  });

  it('ERP fora do ar: mostra o erro e não cancela', async () => {
    const { pedir, vendas } = await montar();
    vendas.detalharVenda = async () => ({ status: 500, dados: null });
    expect((await pedir('/painel/api/conversas/7')).json()).toMatchObject({ venda: { id: 1, erro: 'ERP respondeu 500' }, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(502);
    expect(vendas.canceladas.size).toBe(0);
  });

  it('falha ao registrar a nota não desfaz o cancelamento', async () => {
    const { pedir, vendas, chatwoot } = await montar();
    chatwoot.nota.mockRejectedValue(new Error('Chatwoot fora'));
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(200);
    expect(vendas.canceladas.has(1)).toBe(true);
  });


  describe('pedidos de hoje (menu do Chatwoot)', () => {
    it('lista só os pedidos de hoje em Teresina, do mais recente, com link para a conversa', async () => {
      const { pedir } = await montar();
      expect((await pedir('/painel/api/pedidos', 'GET', null)).statusCode).toBe(401);
      const d = (await pedir('/painel/api/pedidos')).json();
      expect(d.dia).toBe('2026-11-21');
      expect(d.pedidos.map((p: PedidoRegistrado) => p.vendaId)).toEqual([2, 1]);
      expect(d.pedidos[0]).toMatchObject({ nome: 'Cliente 2', conversaId: 10, link: 'http://localhost:3000/app/accounts/1/conversations/10' });
    });

    it('consulta a venda de um pedido do bot', async () => {
      const { pedir } = await montar();
      expect((await pedir('/painel/api/vendas/2')).json()).toEqual({
        venda: { id: 2, status: 'OPEN', total: 220, doEstabelecimento: true },
        podeCancelar: true,
      });
    });

    it('não consulta nem cancela venda que o bot não registrou', async () => {
      const { pedir, vendas } = await montar();
      const detalhar = vi.spyOn(vendas, 'detalharVenda');
      expect((await pedir('/painel/api/vendas/4')).statusCode).toBe(404);
      expect((await pedir('/painel/api/vendas/4/cancelar', 'POST')).statusCode).toBe(404);
      expect((await pedir('/painel/api/vendas/x')).statusCode).toBe(400);
      expect((await pedir('/painel/api/vendas/2', 'GET', 'errado')).statusCode).toBe(401);
      expect(detalhar).not.toHaveBeenCalled();
      expect(vendas.canceladas.size).toBe(0);
    });

    it('cancela pela lista e registra a nota na conversa daquele pedido', async () => {
      const { pedir, vendas, chatwoot } = await montar();
      const r = await pedir('/painel/api/vendas/2/cancelar', 'POST');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ venda: { id: 2, status: 'CANCEL' }, podeCancelar: false });
      expect(vendas.canceladas).toEqual(new Set([2]));
      expect(chatwoot.nota).toHaveBeenCalledWith(10, expect.stringContaining('Venda nº 2 cancelada'));
      expect((await pedir('/painel/api/vendas/2/cancelar', 'POST')).statusCode).toBe(409);
    });

    it('não cancela pela lista venda de outro estabelecimento', async () => {
      const { pedir, vendas } = await montar({ estabelecimentoDaVenda: 999 });
      expect((await pedir('/painel/api/vendas/2/cancelar', 'POST')).statusCode).toBe(403);
      expect(vendas.canceladas.size).toBe(0);
    });
  });
});
