import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registrarPainel, type DepsPainel } from '../../src/painel/rotas.js';
import { ApiRevGasFalsa, TempoEsgotado } from '../../src/vendas/api-revgas.js';
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

/**
 * ERP (estabelecimento 2580): venda 1 da conversa 7 (hoje cedo), venda 2 da conversa 10 (hoje à
 * tarde), venda 3 da conversa 11 (ontem, 23h em Teresina) e venda 4, de outro estabelecimento.
 * Aba: conversa 7 com a venda 1; 8 sem venda; 9 não existe; 12 com "Nº da venda" editado à mão
 * para a venda 2 (de outra conversa); 13 editada para a venda 4.
 */
async function montar(opcoes: { estabelecimentoDaVenda?: number } = {}) {
  const vendas = new ApiRevGasFalsa();
  vendas.estabelecimentoId = 2580;
  const criar = async (conversaId: number, quando: string, estabelecimentoId = opcoes.estabelecimentoDaVenda ?? 2580) => {
    await vendas.criarVenda(corpoDaVenda(PEDIDO, catalogo, { clienteId: 1, estabelecimentoId, conversaId }));
    vendas.datas[vendas.datas.length - 1] = quando;
  };
  await criar(7, '2026-11-21T10:30:00Z');
  await criar(10, '2026-11-21T14:00:00Z');
  await criar(11, '2026-11-21T02:00:00Z');
  await criar(13, '2026-11-21T14:30:00Z', 999);
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
    chatwoot,
    vendas,
    erp: vendas,
    catalogo,
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
    for (const url of ['/painel', '/painel/status.js', '/painel/painel.js', '/painel/painel.css', '/painel/pedidos', '/painel/pedidos.js', '/painel/menu.js']) {
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
    expect((await pedir('/painel/api/estoque', 'GET', null)).statusCode).toBe(401);
    expect((await pedir('/painel/api/conversas/abc')).statusCode).toBe(400);
    expect((await pedir('/painel/api/conversas/0')).statusCode).toBe(400);
    expect(chatwoot.atributosDe).not.toHaveBeenCalled();
  });

  it('mostra o pedido gravado pelo bot e a venda no ERP, com o histórico', async () => {
    const { pedir } = await montar();
    const r = await pedir('/painel/api/conversas/7');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toMatchObject({
      conversa: 7,
      modo: 'memoria',
      pedido: { numero_venda: 1, total: 'R$ 220,00', forma_pagamento: 'PIX', endereco: 'Rua Nova, 10 - Centro, Teresina/PI', quantidade: 2 },
      venda: { id: 1, status: 'ACTIVE', total: 220, doBot: true, conversaId: 7, cliente: 'Maria', pagamento: 'PIX', logs: [{ status: 'OPEN' }] },
      podeCancelar: true,
    });
    expect(r.json().pedido).not.toHaveProperty('outro');
  });

  it('conversa sem venda não oferece cancelar; conversa inexistente é 404', async () => {
    const { pedir } = await montar();
    expect((await pedir('/painel/api/conversas/8')).json()).toMatchObject({ pedido: { quantidade: 3 }, venda: null, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/8/cancelar', 'POST')).statusCode).toBe(409);
    expect((await pedir('/painel/api/conversas/9')).statusCode).toBe(404);
  });

  it('cancelar faz só duas chamadas ao ERP (conferir e cancelar), pela aba e pela lista', async () => {
    const { pedir, vendas } = await montar();
    const conferir = vi.spyOn(vendas, 'historico');
    const cancelarNoErp = vi.spyOn(vendas, 'cancelarVenda');
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).json()).toMatchObject({ venda: { id: 1, status: 'CANCEL', total: 220 } });
    expect([conferir.mock.calls.length, cancelarNoErp.mock.calls.length]).toEqual([1, 1]);
    expect((await pedir('/painel/api/vendas/2/cancelar', 'POST')).json()).toMatchObject({ venda: { id: 2, status: 'CANCEL' } });
    expect([conferir.mock.calls.length, cancelarNoErp.mock.calls.length]).toEqual([2, 2]);
  });

  it('cancela a venda da conversa, registra nota e não cancela duas vezes', async () => {
    const { pedir, vendas, chatwoot } = await montar();
    const r = await pedir('/painel/api/conversas/7/cancelar', 'POST');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ venda: { id: 1, status: 'CANCEL', logs: [{ status: 'OPEN' }, { status: 'CANCEL' }] }, podeCancelar: false });
    expect(vendas.canceladas.has(1)).toBe(true);
    expect(chatwoot.nota).toHaveBeenCalledWith(7, expect.stringContaining('Venda nº 1 cancelada'));
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(409);
  });

  it('não mostra nem cancela venda de outro estabelecimento', async () => {
    const { pedir, vendas } = await montar({ estabelecimentoDaVenda: 999 });
    expect((await pedir('/painel/api/conversas/7')).json()).toMatchObject({ venda: { id: 1, erro: expect.stringContaining('não encontrada') }, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(403);
    expect(vendas.canceladas.size).toBe(0);
  });

  it('número da venda editado à mão na lateral não mostra nem cancela outra venda', async () => {
    const { pedir, vendas } = await montar();
    for (const conversa of [12, 13]) {
      expect((await pedir(`/painel/api/conversas/${conversa}`)).json()).toMatchObject({ venda: { erro: expect.any(String) }, podeCancelar: false });
      expect((await pedir(`/painel/api/conversas/${conversa}/cancelar`, 'POST')).statusCode).toBe(403);
    }
    expect((await pedir('/painel/api/conversas/12')).json().venda.erro).toContain('nesta conversa');
    expect(vendas.canceladas.size).toBe(0);
  });

  it('ERP fora do ar: mostra o erro e não cancela', async () => {
    const { pedir, vendas } = await montar();
    vendas.historico = async () => {
      throw new TempoEsgotado('sem resposta');
    };
    expect((await pedir('/painel/api/conversas/7')).json()).toMatchObject({ venda: { id: 1, erro: 'o ERP não respondeu' }, podeCancelar: false });
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(502);
    expect(vendas.canceladas.size).toBe(0);
  });

  it('falha ao registrar a nota não desfaz o cancelamento', async () => {
    const { pedir, vendas, chatwoot } = await montar();
    chatwoot.nota.mockRejectedValue(new Error('Chatwoot fora'));
    expect((await pedir('/painel/api/conversas/7/cancelar', 'POST')).statusCode).toBe(200);
    expect(vendas.canceladas.has(1)).toBe(true);
  });

  describe('pedidos de hoje e estoque (menu do Chatwoot)', () => {
    it('lista as vendas do bot de hoje em Teresina, da mais recente, direto do ERP', async () => {
      const { pedir, vendas } = await montar();
      const conferir = vi.spyOn(vendas, 'historico');
      expect((await pedir('/painel/api/pedidos', 'GET', null)).statusCode).toBe(401);
      const d = (await pedir('/painel/api/pedidos')).json();
      expect(d.dia).toBe('2026-11-21');
      expect(d.pedidos.map((p: { id: number }) => p.id)).toEqual([2, 1]); // sem a de ontem e sem a de outro estabelecimento
      expect(d.pedidos[0]).toMatchObject({ cliente: 'Maria', conversaId: 10, total: 220, status: 'ACTIVE', podeCancelar: true });
      expect(d.pedidos[0]).not.toHaveProperty('link'); // o menu.js abre a conversa no endereço em uso
      expect(conferir).not.toHaveBeenCalled(); // uma listagem só, sem consulta por pedido
    });

    it('lista mostra as canceladas, sem oferecer cancelar de novo', async () => {
      const { pedir, vendas } = await montar();
      await vendas.cancelarVenda(1);
      const d = (await pedir('/painel/api/pedidos')).json();
      expect(d.pedidos.find((p: { id: number }) => p.id === 1)).toMatchObject({ status: 'CANCEL', podeCancelar: false });
    });

    it('consulta o histórico de uma venda do bot', async () => {
      const { pedir } = await montar();
      expect((await pedir('/painel/api/vendas/2')).json()).toMatchObject({
        venda: { id: 2, status: 'ACTIVE', total: 220, doBot: true, logs: [{ status: 'OPEN' }] },
        podeCancelar: true,
      });
    });

    it('não mostra nem cancela venda que não é do bot', async () => {
      const { pedir, vendas } = await montar();
      expect((await pedir('/painel/api/vendas/4')).statusCode).toBe(404);
      expect((await pedir('/painel/api/vendas/4/cancelar', 'POST')).statusCode).toBe(404);
      expect((await pedir('/painel/api/vendas/99')).statusCode).toBe(404);
      expect((await pedir('/painel/api/vendas/x')).statusCode).toBe(400);
      expect((await pedir('/painel/api/vendas/2', 'GET', 'errado')).statusCode).toBe(401);
      expect(vendas.canceladas.size).toBe(0);
    });

    it('cancela pela lista e registra a nota na conversa daquela venda', async () => {
      const { pedir, vendas, chatwoot } = await montar();
      const r = await pedir('/painel/api/vendas/2/cancelar', 'POST');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ venda: { id: 2, status: 'CANCEL' }, podeCancelar: false });
      expect(vendas.canceladas).toEqual(new Set([2]));
      expect(chatwoot.nota).toHaveBeenCalledWith(10, expect.stringContaining('Venda nº 2 cancelada'));
      expect((await pedir('/painel/api/vendas/2/cancelar', 'POST')).statusCode).toBe(409);
    });

    it('estoque: catálogo do bot com o estoque do ERP (inativo = 0; ausente = desconhecido)', async () => {
      const { pedir, vendas } = await montar();
      expect((await pedir('/painel/api/estoque')).json().estoque).toEqual([
        { codigo: 'P13', nome: 'Botijão P13 (13kg)', estoque: null },
        { codigo: 'P45', nome: 'Botijão P45 (45kg)', estoque: null },
        { codigo: 'AGUA20', nome: 'Água mineral 20L', estoque: null },
      ]);
      vendas.produtosErp = [{ id: 26717, descricao: 'GLP 13KG', estoque: 933, ativo: true }];
      expect((await pedir('/painel/api/estoque')).json().estoque[0].estoque).toBe(933);
      vendas.produtosErp = [{ id: 26717, descricao: 'GLP 13KG', estoque: 933, ativo: false }];
      expect((await pedir('/painel/api/estoque')).json().estoque[0].estoque).toBe(0);
      vendas.produtos = async () => {
        throw new Error('ERP fora');
      };
      expect((await pedir('/painel/api/estoque')).statusCode).toBe(502);
    });
  });
});
