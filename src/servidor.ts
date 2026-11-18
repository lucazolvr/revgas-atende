import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { extrairMensagem, type ClienteChatwoot, type MensagemRecebida } from './canal/chatwoot.js';
import * as M from './conversa/mensagens.js';
import { novaSessao, processar, type Acao, type MotivoTransferencia } from './conversa/motor.js';
import type { Sessoes } from './conversa/sessoes.js';
import type { Interpretador } from './ia/interpretacao.js';
import { registrarEvento } from './metricas.js';
import type { Produto } from './vendas/catalogo.js';
import type { Pedido } from './vendas/pedido.js';
import type { ResultadoRegistro } from './vendas/registrar.js';

export type DepsServidor = {
  webhookToken: string;
  chatwoot: Pick<ClienteChatwoot, 'responder' | 'nota' | 'etiquetar' | 'transferir'>;
  sessoes: Sessoes;
  catalogo: Produto[];
  interpretadorPara: (telefone: string) => Interpretador | null;
  registrar: (p: Pedido) => Promise<ResultadoRegistro>;
  responderDuvida?: (texto: string) => Promise<string | null>;
};

const ETIQUETAS: Record<MotivoTransferencia, string[]> = {
  vazamento: ['vazamento', 'urgente'],
  humano: ['pediu-atendente'],
  nao_entendi: ['pedido-incompleto'],
  verificar_venda: ['verificar-venda'],
  erro_venda: ['erro-venda'],
};

function mesmoToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function criarServidor(deps: DepsServidor) {
  const app = Fastify({ logger: { level: 'warn' } }); // sem log de corpo: as mensagens têm dados pessoais
  // Uma fila por conversa: mensagens da mesma conversa são processadas em ordem, nunca em paralelo.
  const filas = new Map<number, Promise<void>>();

  async function atender(msg: MensagemRecebida) {
    if (!msg.texto) return deps.chatwoot.responder(msg.conversaId, M.SO_TEXTO);
    const inicio = Date.now();
    const interpretador = deps.interpretadorPara(msg.telefone);
    const sessao = (await deps.sessoes.obter(msg.conversaId)) ?? novaSessao(msg.telefone);
    const { sessao: nova, acoes } = await processar(sessao, msg.texto, {
      catalogo: deps.catalogo,
      interpretador,
      registrar: async (p) => {
        const r = await deps.registrar(p);
        registrarEvento({ conversaId: msg.conversaId, tipo: 'venda', resultado: r.tipo });
        return r;
      },
      responderDuvida: deps.responderDuvida,
    });
    // Depois de passar para um humano, se a conversa voltar ao bot começa um pedido novo
    // (mantendo nome e endereço), em vez de retomar do meio.
    const transferiu = acoes.some((a) => a.tipo === 'transferir');
    const { nome, endereco } = nova.pedido;
    await deps.sessoes.salvar(msg.conversaId, transferiu ? novaSessao(msg.telefone, { nome, endereco }) : nova);
    await executar(msg.conversaId, acoes);
    registrarEvento({
      conversaId: msg.conversaId,
      tipo: 'mensagem',
      estado: nova.estado,
      ms: Date.now() - inicio,
      ia: interpretador !== null,
    });
  }

  async function executar(id: number, acoes: Acao[]) {
    for (const a of acoes) {
      if (a.tipo === 'responder') {
        await deps.chatwoot.responder(id, a.texto);
        continue;
      }
      registrarEvento({ conversaId: id, tipo: 'transferencia', motivo: a.motivo });
      await deps.chatwoot.nota(id, a.resumo);
      await deps.chatwoot.etiquetar(id, ETIQUETAS[a.motivo]);
      await deps.chatwoot.responder(id, M.TRANSFERINDO);
      await deps.chatwoot.transferir(id, a.motivo === 'vazamento' ? 'urgent' : undefined);
    }
  }

  function enfileirar(msg: MensagemRecebida) {
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
