/**
 * O painel do Chatwoot "sob medida" para a RevGás, só com recursos nativos e via API (sem fork):
 * etiquetas com cor, respostas prontas, dados do pedido na lateral e horário da caixa.
 * O bot usa as mesmas definições (ETIQUETAS), então etiqueta nova aqui já sai com cor no painel.
 */
import type { MotivoTransferencia } from '../conversa/motor.js';
import { HORARIO_REVENDA } from '../conversa/horario.js';
import { RESPOSTAS_PRONTAS } from '../conversa/mensagens.js';

export const NOME_CAIXA = 'WhatsApp RevGás';

export type Etiqueta = { title: string; description: string; color: string };

const E = {
  vazamento: { title: 'vazamento', description: 'Cliente relatou cheiro de gás ou vazamento', color: '#DC2626' },
  urgente: { title: 'urgente', description: 'Prioridade máxima: atender antes de tudo', color: '#7F1D1D' },
  pediuAtendente: { title: 'pediu-atendente', description: 'Cliente pediu para falar com uma pessoa', color: '#2563EB' },
  incompleto: { title: 'pedido-incompleto', description: 'O bot não entendeu o cliente duas vezes', color: '#EAB308' },
  correcoes: { title: 'muitas-correcoes', description: 'O cliente corrigiu o mesmo pedido 3 vezes', color: '#CA8A04' },
  erroVenda: { title: 'erro-venda', description: 'A API RevGás recusou a venda', color: '#EA580C' },
  erroCancelamento: {
    title: 'erro-cancelamento',
    description: 'O cliente pediu para cancelar e a API não confirmou: conferir no ERP',
    color: '#B45309',
  },
  erroConsulta: { title: 'erro-consulta', description: 'A API não respondeu ao consultar os pedidos do cliente', color: '#9333EA' },
  verificar: {
    title: 'verificar-venda',
    description: 'A API não respondeu: conferir no ERP se a venda existe antes de refazer',
    color: '#F97316',
  },
} satisfies Record<string, Etiqueta>;

/** Etiquetas que o bot põe na conversa ao transferir, por motivo. */
export const ETIQUETAS: Record<MotivoTransferencia, Etiqueta[]> = {
  vazamento: [E.vazamento, E.urgente],
  humano: [E.pediuAtendente],
  nao_entendi: [E.incompleto],
  verificar_venda: [E.verificar],
  erro_venda: [E.erroVenda],
  correcoes: [E.correcoes],
  erro_cancelamento: [E.erroCancelamento],
  erro_consulta: [E.erroConsulta],
};

export const TODAS_ETIQUETAS: Etiqueta[] = Object.values(E);

/** Atributos de conversa que o bot preenche (ver `atributosDoPedido`). */
export const ATRIBUTOS = [
  { attribute_key: 'numero_venda', attribute_display_name: 'Nº da venda', attribute_display_type: 'number', attribute_description: 'Número da venda no ERP RevGás' },
  { attribute_key: 'total', attribute_display_name: 'Total', attribute_display_type: 'text', attribute_description: 'Valor total do pedido' },
  { attribute_key: 'forma_pagamento', attribute_display_name: 'Pagamento', attribute_display_type: 'text', attribute_description: 'Forma de pagamento (e troco)' },
  { attribute_key: 'endereco', attribute_display_name: 'Endereço', attribute_display_type: 'text', attribute_description: 'Endereço de entrega' },
  { attribute_key: 'quantidade', attribute_display_name: 'Quantidade', attribute_display_type: 'number', attribute_description: 'Quantidade de botijões' },
] as const;

export type ChaveAtributo = (typeof ATRIBUTOS)[number]['attribute_key'];

/**
 * Horário da caixa, gerado de HORARIO_REVENDA (src/conversa/horario.ts).
 * O Chatwoot não tem feriados; neles vale o horário do dia da semana. `day_of_week`: 0 = domingo.
 */
export const HORARIO = [0, 1, 2, 3, 4, 5, 6].map((dia) => {
  const h = dia === 0 ? HORARIO_REVENDA.domingo : HORARIO_REVENDA.semana;
  return { day_of_week: dia, closed_all_day: false, open_all_day: false, open_hour: h.abre, open_minutes: 0, close_hour: h.fecha, close_minutes: 0 };
});

export const FUSO = 'America/Fortaleza'; // Teresina: UTC−3, sem horário de verão

/** Chamada autenticada à API da conta: `/labels` vira `/api/v1/accounts/{id}/labels`. */
export type ApiConta = <T>(caminho: string, metodo?: string, corpo?: unknown) => Promise<T>;

type ComId = { id: number };
type Lista<T> = T[] | { payload: T[] };
const itens = <T>(r: Lista<T>) => (Array.isArray(r) ? r : r.payload);

/**
 * Cria o que falta e corrige o que está diferente; rodar de novo não duplica nada.
 * Devolve uma linha por item, para o script mostrar o que fez.
 */

const TITULO_ABA = 'Pedido RevGás';

export async function configurarPainel(cw: ApiConta, opcoes: { urlAba?: string } = {}): Promise<string[]> {
  const log: string[] = [];

  // 1. Etiquetas
  const etiquetas = itens(await cw<Lista<Etiqueta & ComId & { show_on_sidebar: boolean }>>('/labels'));
  for (const e of TODAS_ETIQUETAS) {
    const corpo = { ...e, show_on_sidebar: true };
    const atual = etiquetas.find((x) => x.title === e.title);
    if (!atual) {
      await cw('/labels', 'POST', { label: corpo });
      log.push(`+ etiqueta ${e.title}`);
    } else if (atual.description !== e.description || atual.color.toUpperCase() !== e.color || !atual.show_on_sidebar) {
      await cw(`/labels/${atual.id}`, 'PATCH', { label: corpo });
      log.push(`~ etiqueta ${e.title}`);
    } else {
      log.push(`= etiqueta ${e.title}`);
    }
  }

  // 2. Respostas prontas (o atendente digita "/" + código)
  const respostas = itens(await cw<Lista<{ short_code: string; content: string } & ComId>>('/canned_responses'));
  for (const [codigo, conteudo] of Object.entries(RESPOSTAS_PRONTAS)) {
    const corpo = { canned_response: { short_code: codigo, content: conteudo } };
    const atual = respostas.find((x) => x.short_code === codigo);
    if (!atual) {
      await cw('/canned_responses', 'POST', corpo);
      log.push(`+ resposta /${codigo}`);
    } else if (atual.content !== conteudo) {
      await cw(`/canned_responses/${atual.id}`, 'PATCH', corpo);
      log.push(`~ resposta /${codigo}`);
    } else {
      log.push(`= resposta /${codigo}`);
    }
  }

  // 3. Atributos de conversa (dados do pedido na lateral)
  type Def = (typeof ATRIBUTOS)[number];
  const defs = itens(
    await cw<Lista<{ [K in keyof Def]: string } & ComId & { attribute_model: string }>>(
      '/custom_attribute_definitions?attribute_model=conversation_attribute',
    ),
  ).filter((d) => d.attribute_model === 'conversation_attribute');
  for (const a of ATRIBUTOS) {
    const atual = defs.find((d) => d.attribute_key === a.attribute_key);
    if (!atual) {
      await cw('/custom_attribute_definitions', 'POST', {
        custom_attribute_definition: { ...a, attribute_model: 'conversation_attribute' },
      });
      log.push(`+ atributo ${a.attribute_key}`);
    } else if (
      atual.attribute_display_name !== a.attribute_display_name ||
      atual.attribute_description !== a.attribute_description ||
      atual.attribute_display_type !== a.attribute_display_type
    ) {
      const { attribute_key: _chave, ...resto } = a; // a chave não muda: os dados gravados dependem dela
      await cw(`/custom_attribute_definitions/${atual.id}`, 'PATCH', { custom_attribute_definition: resto });
      log.push(`~ atributo ${a.attribute_key}`);
    } else {
      log.push(`= atributo ${a.attribute_key}`);
    }
  }

  // 4. Horário de atendimento da caixa do WhatsApp
  const caixa = itens(await cw<Lista<ComId & { name: string }>>('/inboxes')).find((c) => c.name === NOME_CAIXA);
  if (!caixa) throw new Error(`A caixa "${NOME_CAIXA}" não existe. Rode "npm run setup" antes.`);
  // Sem out_of_office_message: o Chatwoot não manda aviso automático e o bot continua respondendo
  // fora do horário (o cliente não recebe duas mensagens). O horário aparece no painel e nos relatórios.
  await cw(`/inboxes/${caixa.id}`, 'PATCH', { working_hours_enabled: true, timezone: FUSO, working_hours: HORARIO });
  log.push(`✓ horário da caixa "${NOME_CAIXA}"`);

  // 5. Aba "Pedido RevGás" dentro da conversa (Dashboard App). A URL leva o token: nunca vai pro log.
  if (opcoes.urlAba) {
    type Aba = ComId & { title: string; content: { type: string; url: string }[] };
    const abas = itens(await cw<Lista<Aba>>('/dashboard_apps'));
    const corpo = { dashboard_app: { title: TITULO_ABA, content: [{ type: 'frame', url: opcoes.urlAba }] } };
    const atual = abas.find((a) => a.title === TITULO_ABA);
    if (!atual) {
      await cw('/dashboard_apps', 'POST', corpo);
      log.push(`+ aba ${TITULO_ABA}`);
    } else if (atual.content.length !== 1 || atual.content[0]?.url !== opcoes.urlAba || atual.content[0]?.type !== 'frame') {
      await cw(`/dashboard_apps/${atual.id}`, 'PATCH', corpo);
      log.push(`~ aba ${TITULO_ABA}`);
    } else {
      log.push(`= aba ${TITULO_ABA}`);
    }
  }

  return log;
}
