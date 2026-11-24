import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { extrairMensagem, type ClienteChatwoot, type MensagemRecebida } from './canal/chatwoot.js';
import * as M from './conversa/mensagens.js';
import { ETIQUETAS } from './canal/painel.js';
import { novaSessao, processar, type Acao, type Sessao } from './conversa/motor.js';
import type { Sessoes } from './conversa/sessoes.js';
import type { RegistroPedidos } from './painel/pedidos.js';
import type { Interpretador } from './ia/interpretacao.js';
import { registrarEvento } from './metricas.js';
import type { Produto } from './vendas/catalogo.js';
import type { Pedido } from './vendas/pedido.js';
import type { ResultadoRegistro } from './vendas/registrar.js';

export type DepsServidor = {
  webhookToken: string;
  chatwoot: Pick<ClienteChatwoot, 'responder' | 'nota' | 'etiquetar' | 'transferir' | 'atributos'>;
  sessoes: Sessoes;
  catalogo: Produto[];
  interpretadorPara: (telefone: string) => Interpretador | null;
  registrar: (p: Pedido) => Promise<ResultadoRegistro>;
  /** Nome e endereço do último pedido desse telefone (cliente que volta não repete tudo). */
  clienteAnterior?: (telefone: string) => Promise<Pick<Pedido, 'nome' | 'endereco'> | null>;
  responderDuvida?: (texto: string) => Promise<string | null>;
  /** Lista de pedidos do dia ("Pedidos de hoje" no menu do Chatwoot). */
  pedidos?: Pick<RegistroPedidos, 'adicionar'>;
  /** Proteções contra rajadas; os padrões atendem uma conversa humana normal. */
  limites?: { porConversa?: number; global?: number; janelaMs?: number; filasMaximas?: number };
};

function mesmoToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function criarServidor(deps: DepsServidor) {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 }); // sem log de corpo: as mensagens têm dados pessoais
  // Uma fila por conversa: mensagens da mesma conversa são processadas em ordem, nunca em paralelo.
  const filas = new Map<number, Promise<void>>();
  const limite = {
    porConversa: deps.limites?.porConversa ?? 20,
    global: deps.limites?.global ?? 300,
    janelaMs: deps.limites?.janelaMs ?? 60_000,
    filasMaximas: deps.limites?.filasMaximas ?? 200,
  };
  const porConversa = new Map<number, { inicio: number; quantidade: number }>();
  let janelaGlobal = { inicio: Date.now(), quantidade: 0 };

  async function atender(msg: MensagemRecebida) {
    if (!msg.texto) return deps.chatwoot.responder(msg.conversaId, M.SO_TEXTO);
    const inicio = Date.now();
    const interpretador = deps.interpretadorPara(msg.telefone);
    let sessao = await deps.sessoes.obter(msg.conversaId);
    if (!sessao) {
      const anterior = await clienteAnterior(msg.telefone);
      if (anterior) registrarEvento({ conversaId: msg.conversaId, tipo: 'cliente_reconhecido' });
      sessao = novaSessao(msg.telefone, anterior ?? {});
    }
    const { sessao: nova, acoes } = await processar(sessao, msg.texto, {
      catalogo: deps.catalogo,
      interpretador,
      registrar: async (p) => {
        const r = await deps.registrar(p);
        registrarEvento({ conversaId: msg.conversaId, tipo: 'venda', resultado: r.tipo });
        return r;
      },
      // A mesma regra de privacidade da interpretação vale para o RAG: fora de
      // NUMEROS_IA não enviamos a pergunta ao Gemini e o motor usa o fallback.
      responderDuvida: interpretador ? deps.responderDuvida : undefined,
    });
    // Depois de passar para um humano, se a conversa voltar ao bot começa um pedido novo
    // (mantendo nome e endereço), em vez de retomar do meio.
    const transferiu = acoes.some((a) => a.tipo === 'transferir');
    const { nome, endereco } = nova.pedido;
    await deps.sessoes.salvar(msg.conversaId, transferiu ? novaSessao(msg.telefone, { nome, endereco }) : nova);
    await executar(msg.conversaId, acoes);
    // Venda recém-registrada ou conversa indo para um humano: dados do pedido na lateral do painel.
    const registrou = nova.estado === 'REGISTRADO' && nova.vendaId !== sessao.vendaId;
    if (registrou || transferiu) await gravarAtributos(msg.conversaId, nova);
    if (registrou) await anotarPedido(msg.conversaId, nova);
    registrarEvento({
      conversaId: msg.conversaId,
      tipo: 'mensagem',
      estado: nova.estado,
      ms: Date.now() - inicio,
      ia: interpretador !== null,
    });
  }

  /** Melhor esforço: sem o histórico (API fora do ar), o pedido só começa do zero. */
  async function clienteAnterior(telefone: string) {
    try {
      return (await deps.clienteAnterior?.(telefone)) ?? null;
    } catch (e) {
      app.log.warn({ erro: e instanceof Error ? e.message : 'desconhecido' }, 'falha ao buscar o último pedido do cliente');
      return null;
    }
  }

  /** Melhor esforço: o cliente já recebeu a resposta; uma falha aqui não pode virar "falha ao atender". */
  async function gravarAtributos(id: number, s: Sessao) {
    const dados = M.atributosDoPedido(s.pedido, deps.catalogo, s.vendaId);
    if (!Object.keys(dados).length) return; // nada coletado: mantém o que já estava na lateral
    try {
      await deps.chatwoot.atributos(id, dados);
    } catch (e) {
      app.log.warn({ conversa: id, erro: e instanceof Error ? e.message : 'desconhecido' }, 'falha ao gravar dados do pedido');
    }
  }

  /** Melhor esforço, como os atributos: a venda já foi registrada e o cliente já foi avisado. */
  async function anotarPedido(id: number, s: Sessao) {
    if (!deps.pedidos || !s.vendaId) return;
    const a = M.atributosDoPedido(s.pedido, deps.catalogo, s.vendaId);
    try {
      await deps.pedidos.adicionar({
        vendaId: s.vendaId,
        conversaId: id,
        quando: new Date().toISOString(),
        nome: s.pedido.nome ?? '',
        produto: deps.catalogo.find((x) => x.codigo === s.pedido.produto)?.nome ?? '',
        quantidade: s.pedido.quantidade ?? 0,
        total: String(a.total ?? ''),
        pagamento: String(a.forma_pagamento ?? ''),
        endereco: String(a.endereco ?? ''),
      });
    } catch (e) {
      app.log.warn({ conversa: id, erro: e instanceof Error ? e.message : 'desconhecido' }, 'falha ao anotar o pedido do dia');
    }
  }

  async function executar(id: number, acoes: Acao[]) {
    for (const a of acoes) {
      if (a.tipo === 'responder') {
        await deps.chatwoot.responder(id, a.texto);
        continue;
      }
      registrarEvento({ conversaId: id, tipo: 'transferencia', motivo: a.motivo });
      await deps.chatwoot.nota(id, a.resumo);
      await deps.chatwoot.etiquetar(id, ETIQUETAS[a.motivo].map((e) => e.title));
      await deps.chatwoot.responder(id, M.TRANSFERINDO);
      await deps.chatwoot.transferir(id, a.motivo === 'vazamento' ? 'urgent' : undefined);
    }
  }

  /** Descarta excessos silenciosamente para o Chatwoot não tentar reenviar em rajada. */
  function permitido(msg: MensagemRecebida): boolean {
    const agora = Date.now();
    if (agora - janelaGlobal.inicio >= limite.janelaMs) {
      janelaGlobal = { inicio: agora, quantidade: 0 };
      for (const [id, estado] of porConversa) {
        if (agora - estado.inicio >= limite.janelaMs) porConversa.delete(id);
      }
    }
    if (janelaGlobal.quantidade >= limite.global) return false;
    const estado = porConversa.get(msg.conversaId);
    const atual = !estado || agora - estado.inicio >= limite.janelaMs ? { inicio: agora, quantidade: 0 } : estado;
    if (atual.quantidade >= limite.porConversa) return false;
    janelaGlobal.quantidade++;
    atual.quantidade++;
    porConversa.set(msg.conversaId, atual);
    return true;
  }

  function enfileirar(msg: MensagemRecebida) {
    if (!permitido(msg)) {
      app.log.warn({ conversa: msg.conversaId }, 'limite de mensagens excedido');
      return;
    }
    if (!filas.has(msg.conversaId) && filas.size >= limite.filasMaximas) {
      app.log.warn({ conversa: msg.conversaId }, 'limite de filas excedido');
      return;
    }
    const anterior = filas.get(msg.conversaId) ?? Promise.resolve();
    const atual = anterior
      .then(() => atender(msg))
      .catch((e: unknown) => {
        registrarEvento({ conversaId: msg.conversaId, tipo: 'erro' });
        app.log.error({ conversa: msg.conversaId, erro: e instanceof Error ? e.message : 'desconhecido' }, 'falha ao atender');
      });
    filas.set(msg.conversaId, atual);
    void atual.finally(() => {
      if (filas.get(msg.conversaId) === atual) filas.delete(msg.conversaId);
    });
  }

  app.get('/saude', async () => ({ ok: true }));

  app.post<{ Params: { token: string } }>('/webhook/:token', async (req, reply) => {
    if (!mesmoToken(req.params.token, deps.webhookToken)) return reply.code(404).send();
    const msg = extrairMensagem(req.body);
    if (msg) enfileirar(msg);
    return { ok: true }; // responde logo; o Chatwoot não espera a IA nem a API RevGás
  });

  /** Para testes e desligamento: espera todas as conversas em andamento terminarem. */
  const ocioso = async () => {
    while (filas.size) await Promise.all([...filas.values()]);
  };

  return { app, ocioso };
}
