/**
 * Painel "Pedido RevGás". **A fonte é a API da RevGás**: o bot não guarda pedidos.
 * - aba dentro da conversa no Chatwoot (Dashboard App, recurso nativo): a venda daquela conversa,
 *   com status e histórico vindos do ERP;
 * - lista "Pedidos de hoje" (/painel/pedidos): as vendas do bot no dia (ativas e canceladas) e o
 *   estoque do ERP, aberta pelo item "Pedidos de hoje" no menu lateral do Chatwoot (menu.js).
 * As duas têm o botão "Cancelar venda de teste".
 *
 * Segurança (os dados do pedido são pessoais):
 * - a porta do bot é publicada só em 127.0.0.1 (docker-compose.yml);
 * - a API exige o PAINEL_TOKEN no cabeçalho Authorization. Na URL ele vai depois do `#`, que o
 *   navegador não envia ao servidor nem põe no Referer;
 * - as páginas só podem ser emolduradas pelo Chatwoot (CSP frame-ancestors) e só funcionam assim;
 * - só vendas do bot (nosso estabelecimento + marca "RevGás Atende" na observação) são mostradas
 *   ou canceladas. Na aba, a venda ainda precisa ter sido criada NAQUELA conversa ("Conversa N."
 *   na observação): editar "Nº da venda" na lateral do Chatwoot não dá acesso a outra venda.
 */
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ATRIBUTOS, type ChaveAtributo } from '../canal/painel.js';
import type { ClienteChatwoot } from '../canal/chatwoot.js';
import { registrarEvento } from '../metricas.js';
import { TempoEsgotado, type ConsultaErp, type ConsultaVendas, type HistoricoVenda, type VendaResumo } from '../vendas/api-revgas.js';
import type { Produto } from '../vendas/catalogo.js';
import { diaDaRevenda } from '../vendas/pedido.js';

export type DepsPainel = {
  token: string;
  /** Endereços do Chatwoot que podem abrir o painel (CSP frame-ancestors). */
  origensChatwoot: string[];
  chatwoot: Pick<ClienteChatwoot, 'atributosDe' | 'nota'>;
  vendas: ConsultaVendas;
  erp: Pick<ConsultaErp, 'produtos'>;
  catalogo: Produto[];
  /** `teste` = API de teste da RevGás (VENDA_REAL=true); `memoria` = ERP de mentira do bot. */
  modo: 'teste' | 'memoria';
  /** Para testes: o "agora" que define o dia de hoje. */
  agora?: () => Date;
};

type VendaNoPainel = HistoricoVenda | { id: number; erro: string };

type RespostaPainel = {
  conversa: number;
  modo: DepsPainel['modo'];
  pedido: Partial<Record<ChaveAtributo, string | number>>;
  venda: VendaNoPainel | null;
  podeCancelar: boolean;
};

type Falha = { codigo: number; erro: string };

const NAO_E_DO_BOT = 'venda não encontrada entre as vendas do bot neste estabelecimento: confira no ERP';
// Número editado à mão na lateral, ou venda de antes de o bot anotar a conversa na observação.
const OUTRA_CONVERSA = 'esta venda não foi registrada pelo bot nesta conversa: confira no ERP';

const ler = (nome: string) => readFileSync(new URL(`./publico/${nome}`, import.meta.url), 'utf8');

function mesmoToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const podeCancelar = (v: VendaResumo | { erro: string } | null): boolean => !!v && !('erro' in v) && v.doBot && v.status !== 'CANCEL';

export function registrarPainel(app: FastifyInstance, deps: DepsPainel) {
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${deps.origensChatwoot.join(' ')}`,
  ].join('; ');
  const seguro = (reply: FastifyReply) =>
    reply
      .header('content-security-policy', csp)
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store');

  // Arquivos das páginas: sem dados, não precisam de token.
  const arquivos: [string, string, string][] = [
    ['/painel', ler('index.html'), 'text/html; charset=utf-8'],
    ['/painel/pedidos', ler('pedidos.html'), 'text/html; charset=utf-8'],
    ['/painel/status.js', ler('status.js'), 'text/javascript; charset=utf-8'],
    ['/painel/painel.js', ler('painel.js'), 'text/javascript; charset=utf-8'],
    ['/painel/pedidos.js', ler('pedidos.js'), 'text/javascript; charset=utf-8'],
    // Carregado pelo Chatwoot (DASHBOARD_SCRIPTS) para pôr "Pedidos de hoje" no menu lateral.
    ['/painel/menu.js', ler('menu.js'), 'text/javascript; charset=utf-8'],
    ['/painel/painel.css', ler('painel.css'), 'text/css; charset=utf-8'],
  ];
  for (const [rota, conteudo, tipo] of arquivos) {
    app.get(rota, async (_req, reply) => seguro(reply).type(tipo).send(conteudo));
  }

  function autorizado(req: FastifyRequest, reply: FastifyReply): boolean {
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo === 'Bearer' && token && mesmoToken(token, deps.token)) return true;
    void seguro(reply).code(401).send({ erro: 'token inválido' });
    return false;
  }

  /** Id de conversa ou venda vindo da URL: só inteiro positivo (vai para URLs autenticadas). */
  function idDaUrl(texto: string, reply: FastifyReply): number | null {
    const id = Number(texto);
    if (/^\d{1,12}$/.test(texto) && Number.isSafeInteger(id) && id > 0) return id;
    void seguro(reply).code(400).send({ erro: 'id inválido' });
    return null;
  }

  /** Venda do bot com status e histórico; erro legível se não for do bot ou o ERP falhar. */
  async function consultarVenda(id: number): Promise<VendaNoPainel> {
    try {
      return (await deps.vendas.historico(id)) ?? { id, erro: NAO_E_DO_BOT };
    } catch (e) {
      return { id, erro: e instanceof TempoEsgotado ? 'o ERP não respondeu' : 'falha ao consultar o ERP' };
    }
  }

  /**
   * Cancela uma venda já consultada (do bot, não cancelada) e deixa uma nota na conversa dela.
   * São duas chamadas ao todo (consulta e cancelamento): a venda devolvida é a consultada, já com
   * CANCEL, sem uma terceira chamada só para mostrar o resultado (a API aceita 1 requisição por segundo).
   */
  async function cancelar(venda: HistoricoVenda): Promise<{ falha: Falha } | { venda: HistoricoVenda }> {
    if (venda.status === 'CANCEL') return { falha: { codigo: 409, erro: 'a venda já está cancelada' } };
    let r;
    try {
      r = await deps.vendas.cancelarVenda(venda.id);
    } catch (e) {
      return { falha: { codigo: 502, erro: e instanceof TempoEsgotado ? 'o ERP não respondeu' : 'falha ao cancelar' } };
    }
    if (r.status !== 200 && r.status !== 204) return { falha: { codigo: 502, erro: `ERP respondeu ${r.status}` } };
    registrarEvento({ conversaId: venda.conversaId ?? 0, tipo: 'cancelamento', resultado: 'atendente' });
    // Registro na conversa para a equipe saber o que aconteceu; melhor esforço (já foi cancelada).
    if (venda.conversaId) {
      await deps.chatwoot.nota(venda.conversaId, `🧾 Venda nº ${venda.id} cancelada pelo painel Pedido RevGás.`).catch(() => {
        app.log.warn({ conversa: venda.conversaId }, 'falha ao registrar a nota de cancelamento');
      });
    }
    const quando = new Date().toISOString();
    return { venda: { ...venda, status: 'CANCEL', logs: [...venda.logs, { status: 'CANCEL', quando }] } };
  }

  // --- Aba da conversa -------------------------------------------------------------------------

  /** Atributos gravados pelo bot na conversa (lateral do Chatwoot) e o número da venda, se houver. */
  async function lerConversa(conversa: number) {
    const atributos = await deps.chatwoot.atributosDe(conversa);
    if (!atributos) return null;
    const pedido: RespostaPainel['pedido'] = {};
    for (const { attribute_key: chave } of ATRIBUTOS) {
      const v = atributos[chave];
      if (typeof v === 'string' || typeof v === 'number') pedido[chave] = v;
    }
    const numero = Number(pedido.numero_venda);
    return { pedido, vendaId: Number.isSafeInteger(numero) && numero > 0 ? numero : null };
  }

  /** A venda da conversa, só se o ERP confirmar que foi criada pelo bot NESTA conversa. */
  async function vendaDaConversa(conversa: number, vendaId: number): Promise<VendaNoPainel> {
    const venda = await consultarVenda(vendaId);
    if ('erro' in venda || venda.conversaId === conversa) return venda;
    return { id: vendaId, erro: OUTRA_CONVERSA };
  }

  app.get<{ Params: { id: string } }>('/painel/api/conversas/:id', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const id = idDaUrl(req.params.id, reply);
    if (id === null) return reply;
    const lida = await lerConversa(id);
    if (!lida) return seguro(reply).code(404).send({ erro: 'conversa não encontrada' });
    const venda = lida.vendaId === null ? null : await vendaDaConversa(id, lida.vendaId);
    const resposta: RespostaPainel = { conversa: id, modo: deps.modo, pedido: lida.pedido, venda, podeCancelar: podeCancelar(venda) };
    return seguro(reply).send(resposta);
  });

  app.post<{ Params: { id: string } }>('/painel/api/conversas/:id/cancelar', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const id = idDaUrl(req.params.id, reply);
    if (id === null) return reply;
    const lida = await lerConversa(id);
    if (!lida) return seguro(reply).code(404).send({ erro: 'conversa não encontrada' });
    if (lida.vendaId === null) return seguro(reply).code(409).send({ erro: 'esta conversa não tem venda registrada' });
    const venda = await vendaDaConversa(id, lida.vendaId);
    if ('erro' in venda) return seguro(reply).code(venda.erro === OUTRA_CONVERSA || venda.erro === NAO_E_DO_BOT ? 403 : 502).send({ erro: venda.erro });
    const r = await cancelar(venda);
    if ('falha' in r) return seguro(reply).code(r.falha.codigo).send({ erro: r.falha.erro });
    const resposta: RespostaPainel = { conversa: id, modo: deps.modo, pedido: lida.pedido, venda: r.venda, podeCancelar: false };
    return seguro(reply).send(resposta);
  });

  // --- Pedidos de hoje e estoque ---------------------------------------------------------------

  /** Hoje e os 6 dias anteriores, no fuso da revenda (do mais recente ao mais antigo). */
  function ultimosDias(): string[] {
    const agora = (deps.agora?.() ?? new Date()).getTime();
    return [...new Set(Array.from({ length: 7 }, (_, i) => diaDaRevenda(new Date(agora - i * 86_400_000))))];
  }

  app.get<{ Querystring: { dia?: string } }>('/painel/api/pedidos', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const dias = ultimosDias();
    // Só os últimos 7 dias: a busca varre poucas páginas da listagem (1 req/s na API real).
    const dia = req.query.dia ?? dias[0]!;
    if (!dias.includes(dia)) return seguro(reply).code(400).send({ erro: 'dia fora dos últimos 7 dias' });
    try {
      // Uma varredura da listagem traz status, total, itens e endereço: sem uma consulta por pedido.
      const pedidos = await deps.vendas.vendasDoBot(dia);
      // Sem link pronto: "Abrir conversa" pede ao menu.js que abra a conversa no próprio Chatwoot.
      return seguro(reply).send({ dia, dias, modo: deps.modo, pedidos: pedidos.map((v) => ({ ...v, podeCancelar: podeCancelar(v) })) });
    } catch (e) {
      return seguro(reply).code(502).send({ erro: e instanceof TempoEsgotado ? 'o ERP não respondeu' : 'falha ao consultar o ERP' });
    }
  });

  /** Produtos do catálogo do bot com o estoque atual no ERP (`null` = o ERP não informou). */
  app.get('/painel/api/estoque', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    try {
      const doErp = await deps.erp.produtos();
      const estoque = deps.catalogo.map((p) => {
        const e = doErp.find((x) => x.id === p.productId);
        return { codigo: p.codigo, nome: p.nome, estoque: e ? (e.ativo ? e.estoque : 0) : null };
      });
      return seguro(reply).send({ estoque });
    } catch {
      return seguro(reply).code(502).send({ erro: 'falha ao consultar o estoque no ERP' });
    }
  });

  /** Só vendas do bot: a lista nunca consulta nem cancela outra venda do ERP. */
  async function vendaDoBot(texto: string, reply: FastifyReply): Promise<HistoricoVenda | null> {
    const id = idDaUrl(texto, reply);
    if (id === null) return null;
    const venda = await consultarVenda(id);
    if (!('erro' in venda)) return venda;
    void seguro(reply).code(venda.erro === NAO_E_DO_BOT ? 404 : 502).send({ erro: venda.erro });
    return null;
  }

  app.get<{ Params: { id: string } }>('/painel/api/vendas/:id', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const venda = await vendaDoBot(req.params.id, reply);
    if (!venda) return reply;
    return seguro(reply).send({ venda, podeCancelar: podeCancelar(venda) });
  });

  app.post<{ Params: { id: string } }>('/painel/api/vendas/:id/cancelar', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const venda = await vendaDoBot(req.params.id, reply);
    if (!venda) return reply;
    const r = await cancelar(venda);
    if ('falha' in r) return seguro(reply).code(r.falha.codigo).send({ erro: r.falha.erro });
    return seguro(reply).send({ venda: r.venda, podeCancelar: false });
  });
}
