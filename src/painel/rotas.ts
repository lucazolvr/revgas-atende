/**
 * Painel "Pedido RevGás":
 * - aba dentro da conversa no Chatwoot (Dashboard App, recurso nativo): o pedido daquela conversa;
 * - lista "Pedidos de hoje" (/painel/pedidos): todos os pedidos confirmados no dia, aberta pelo item
 *   "Pedidos de hoje" no menu lateral do Chatwoot (menu.js), numa janela por cima do painel.
 * As duas mostram a venda no ERP e têm o botão "Cancelar venda de teste".
 *
 * Segurança (os dados do pedido são pessoais):
 * - a porta do bot é publicada só em 127.0.0.1 (docker-compose.yml);
 * - a API exige o PAINEL_TOKEN no cabeçalho Authorization. Na URL ele vai depois do `#`, que o
 *   navegador não envia ao servidor nem põe no Referer;
 * - as páginas só podem ser emolduradas pelo Chatwoot (CSP frame-ancestors) e só funcionam assim;
 * - na aba, o navegador só informa QUAL conversa está aberta: os dados e o número da venda vêm do
 *   Chatwoot (gravados pelo bot). Na lista, só vendas que o próprio bot registrou. Em nenhum caso
 *   a página escolhe uma venda arbitrária do ERP para consultar ou cancelar.
 */
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ATRIBUTOS, type ChaveAtributo } from '../canal/painel.js';
import type { ClienteChatwoot } from '../canal/chatwoot.js';
import { TempoEsgotado, type ConsultaVendas } from '../vendas/api-revgas.js';
import { diaDaRevenda, type PedidoRegistrado, type RegistroPedidos } from './pedidos.js';

export type DepsPainel = {
  token: string;
  /** Endereços do Chatwoot que podem abrir o painel (CSP frame-ancestors). */
  origensChatwoot: string[];
  chatwoot: Pick<ClienteChatwoot, 'atributosDe' | 'nota'>;
  vendas: ConsultaVendas;
  pedidos: Pick<RegistroPedidos, 'doDia' | 'daVenda'>;
  estabelecimentoId: number;
  /** `teste` = API de teste da RevGás (VENDA_REAL=true); `memoria` = ERP de mentira do bot. */
  modo: 'teste' | 'memoria';
  /** Para testes: o "agora" que define o dia de hoje. */
  agora?: () => Date;
};

type VendaNoPainel =
  | { id: number; status: string; total: number | null; doEstabelecimento: boolean }
  | { id: number; erro: string };

type RespostaPainel = {
  conversa: number;
  modo: DepsPainel['modo'];
  pedido: Partial<Record<ChaveAtributo, string | number>>;
  venda: VendaNoPainel | null;
  podeCancelar: boolean;
};

type Falha = { codigo: number; erro: string };

// Não afirma que a venda não existe: o registro do bot expira (2 dias) e, no modo demonstração,
// zera quando o bot reinicia. O que se sabe é que o painel não consegue confirmá-la.
const NAO_REGISTRADA =
  'esta venda não está no registro do bot (número editado à mão, venda com mais de 2 dias ou bot reiniciado): confira no ERP';

const ler = (nome: string) => readFileSync(new URL(`./publico/${nome}`, import.meta.url), 'utf8');

function mesmoToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const podeCancelar = (v: VendaNoPainel | null) => !!v && 'status' in v && v.doEstabelecimento && v.status !== 'CANCEL';

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

  async function consultarVenda(id: number): Promise<VendaNoPainel> {
    try {
      const r = await deps.vendas.detalharVenda(id);
      // O detalhe da API real vem sem o envelope `data` (ao contrário da criação); aceita os dois.
      const bruto = r.dados as ({ data?: Record<string, unknown> } & Record<string, unknown>) | null;
      const v = bruto?.data ?? bruto;
      if (r.status !== 200 || !v) return { id, erro: r.status === 404 ? 'venda não encontrada no ERP' : `ERP respondeu ${r.status}` };
      const total = Number(v.total);
      return {
        id,
        status: typeof v.status === 'string' ? v.status : 'DESCONHECIDO',
        total: Number.isFinite(total) ? total : null,
        doEstabelecimento: v.establishment_id === deps.estabelecimentoId,
      };
    } catch (e) {
      return { id, erro: e instanceof TempoEsgotado ? 'o ERP não respondeu' : 'falha ao consultar o ERP' };
    }
  }

  /**
   * Confere a venda no ERP de novo, cancela e deixa uma nota na conversa do pedido. São duas
   * chamadas (consulta e cancelamento): a venda devolvida é a consultada, já com CANCEL, sem uma
   * terceira chamada só para mostrar o resultado (a API aceita 1 requisição por segundo).
   */
  async function cancelar(vendaId: number, conversaId: number): Promise<{ falha: Falha } | { venda: VendaNoPainel }> {
    const venda = await consultarVenda(vendaId);
    if ('erro' in venda) return { falha: { codigo: 502, erro: venda.erro } };
    if (!venda.doEstabelecimento) return { falha: { codigo: 403, erro: 'a venda é de outro estabelecimento' } };
    if (venda.status === 'CANCEL') return { falha: { codigo: 409, erro: 'a venda já está cancelada' } };
    let r;
    try {
      r = await deps.vendas.cancelarVenda(vendaId);
    } catch (e) {
      return { falha: { codigo: 502, erro: e instanceof TempoEsgotado ? 'o ERP não respondeu' : 'falha ao cancelar' } };
    }
    if (r.status !== 200 && r.status !== 204) return { falha: { codigo: 502, erro: `ERP respondeu ${r.status}` } };
    // Registro na conversa para a equipe saber o que aconteceu; melhor esforço (já foi cancelada).
    await deps.chatwoot.nota(conversaId, `🧾 Venda nº ${vendaId} cancelada pelo painel Pedido RevGás.`).catch(() => {
      app.log.warn({ conversa: conversaId }, 'falha ao registrar a nota de cancelamento');
    });
    return { venda: { ...venda, status: 'CANCEL' } };
  }

  // --- Aba da conversa -------------------------------------------------------------------------

  /**
   * Dados do pedido da conversa (atributos gravados pelo bot), sem chamar o ERP. O atendente pode
   * editar "Nº da venda" na lateral do Chatwoot: só vale a venda que o bot registrou nesta
   * conversa. Sem isso, dava para cancelar a venda de outro grupo do mesmo estabelecimento de teste.
   */
  async function lerConversa(conversa: number) {
    const atributos = await deps.chatwoot.atributosDe(conversa);
    if (!atributos) return null;
    const pedido: RespostaPainel['pedido'] = {};
    for (const { attribute_key: chave } of ATRIBUTOS) {
      const v = atributos[chave];
      if (typeof v === 'string' || typeof v === 'number') pedido[chave] = v;
    }
    const numero = Number(pedido.numero_venda);
    const vendaId = Number.isSafeInteger(numero) && numero > 0 ? numero : null;
    const doBot = vendaId !== null && (await deps.pedidos.daVenda(vendaId))?.conversaId === conversa;
    return { pedido, vendaId, doBot };
  }

  async function montarConversa(conversa: number): Promise<RespostaPainel | null> {
    const lida = await lerConversa(conversa);
    if (!lida) return null;
    const { pedido, vendaId, doBot } = lida;
    // Fora do registro do bot, nem consulta o ERP.
    const venda: VendaNoPainel | null = vendaId === null ? null : doBot ? await consultarVenda(vendaId) : { id: vendaId, erro: NAO_REGISTRADA };
    return { conversa, modo: deps.modo, pedido, venda, podeCancelar: podeCancelar(venda) };
  }

  app.get<{ Params: { id: string } }>('/painel/api/conversas/:id', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const id = idDaUrl(req.params.id, reply);
    if (id === null) return reply;
    const dados = await montarConversa(id);
    if (!dados) return seguro(reply).code(404).send({ erro: 'conversa não encontrada' });
    return seguro(reply).send(dados);
  });

  app.post<{ Params: { id: string } }>('/painel/api/conversas/:id/cancelar', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const id = idDaUrl(req.params.id, reply);
    if (id === null) return reply;
    const lida = await lerConversa(id);
    if (!lida) return seguro(reply).code(404).send({ erro: 'conversa não encontrada' });
    if (lida.vendaId === null) return seguro(reply).code(409).send({ erro: 'esta conversa não tem venda registrada' });
    if (!lida.doBot) return seguro(reply).code(403).send({ erro: NAO_REGISTRADA });
    const r = await cancelar(lida.vendaId, id);
    if ('falha' in r) return seguro(reply).code(r.falha.codigo).send({ erro: r.falha.erro });
    const resposta: RespostaPainel = { conversa: id, modo: deps.modo, pedido: lida.pedido, venda: r.venda, podeCancelar: false };
    return seguro(reply).send(resposta);
  });

  // --- Pedidos de hoje -------------------------------------------------------------------------

  app.get('/painel/api/pedidos', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const dia = diaDaRevenda(deps.agora?.() ?? new Date());
    const lista = (await deps.pedidos.doDia(dia))
      .slice()
      .sort((a: PedidoRegistrado, b: PedidoRegistrado) => b.quando.localeCompare(a.quando)); // mais recente primeiro
    // Sem link pronto: "Abrir conversa" pede ao menu.js que abra a conversa no próprio Chatwoot, no
    // endereço em uso (localhost ou 127.0.0.1), em vez de levar a outro endereço e perder o login.
    return seguro(reply).send({ dia, modo: deps.modo, pedidos: lista });
  });

  /** Só vendas que o bot registrou: a lista nunca consulta nem cancela outra venda do ERP. */
  async function pedidoDaVenda(texto: string, reply: FastifyReply) {
    const id = idDaUrl(texto, reply);
    if (id === null) return null;
    const pedido = await deps.pedidos.daVenda(id);
    if (!pedido) void seguro(reply).code(404).send({ erro: 'venda não registrada pelo bot' });
    return pedido;
  }

  app.get<{ Params: { id: string } }>('/painel/api/vendas/:id', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const pedido = await pedidoDaVenda(req.params.id, reply);
    if (!pedido) return reply;
    const venda = await consultarVenda(pedido.vendaId);
    return seguro(reply).send({ venda, podeCancelar: podeCancelar(venda) });
  });

  app.post<{ Params: { id: string } }>('/painel/api/vendas/:id/cancelar', async (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const pedido = await pedidoDaVenda(req.params.id, reply);
    if (!pedido) return reply;
    const r = await cancelar(pedido.vendaId, pedido.conversaId);
    if ('falha' in r) return seguro(reply).code(r.falha.codigo).send({ erro: r.falha.erro });
    return seguro(reply).send({ venda: r.venda, podeCancelar: false });
  });
}
