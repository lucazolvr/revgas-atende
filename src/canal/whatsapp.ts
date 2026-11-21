/**
 * Liga o WhatsApp (WAHA) ao Chatwoot e ao bot: a lógica do `npm run setup` (scripts/setup.ts).
 * Pode rodar de novo sem duplicar nada e só muda o que estiver diferente.
 */
import { randomUUID } from 'node:crypto';
import { NOME_CAIXA, type ApiConta } from './painel.js';

export const SESSAO = 'default';
export const NOME_BOT = 'RevGás Atende';

/** Chamada à API do WAHA. Com `semErro404`, devolve null quando o recurso não existe. */
export type ApiWaha = <T>(caminho: string, metodo?: string, corpo?: unknown, semErro404?: boolean) => Promise<T>;

type AgentBot = { id: number; name: string; access_token?: string };
type Caixa = { id: number; name: string; inbox_identifier?: string; webhook_url?: string };
export type ConfigApp = {
  url: string;
  accountId: number;
  accountToken: string;
  inboxId: number;
  inboxIdentifier: string;
  locale: string;
};
type AppWaha = { id: string; session: string; app: string; config?: Partial<ConfigApp> };
type SessaoWaha = { name: string; status: string };

export type Resultado = { log: string[]; tokenBot?: string };

const mesmaConfig = (a: Partial<ConfigApp> | undefined, b: ConfigApp) =>
  !!a && (Object.keys(b) as (keyof ConfigApp)[]).every((k) => a[k] === b[k]);

export async function ligarWhatsApp(
  cw: ApiConta,
  waha: ApiWaha,
  opcoes: { conta: number; tokenAdmin: string; tokenWebhook: string },
): Promise<Resultado> {
  const log: string[] = [];

  // 1. Agent Bot (o Chatwoot chama o bot pela rede interna do Docker)
  const urlWebhookBot = `http://bot:3000/webhook/${opcoes.tokenWebhook}`;
  let bot = (await cw<AgentBot[]>('/agent_bots')).find((b) => b.name === NOME_BOT);
  if (bot) {
    bot = await cw<AgentBot>(`/agent_bots/${bot.id}`, 'PATCH', { outgoing_url: urlWebhookBot });
    log.push(`✓ Agent Bot já existia (id ${bot.id}); webhook atualizado.`);
  } else {
    bot = await cw<AgentBot>('/agent_bots', 'POST', {
      name: NOME_BOT,
      description: 'Atendente virtual de pedidos de gás',
      outgoing_url: urlWebhookBot,
    });
    log.push(`✓ Agent Bot criado (id ${bot.id}).`);
  }

  // 2. Caixa do WhatsApp no Chatwoot (canal API). O endereço dela para o WAHA só é trocado no
  //    passo 4, depois que a integração existe: se algo falhar no meio, a caixa antiga continua valendo.
  const { payload: caixas } = await cw<{ payload: Caixa[] }>('/inboxes');
  let caixa = caixas.find((c) => c.name === NOME_CAIXA);
  if (!caixa) {
    caixa = await cw<Caixa>('/inboxes', 'POST', { name: NOME_CAIXA, channel: { type: 'api' } });
    log.push(`✓ Caixa "${NOME_CAIXA}" criada (id ${caixa.id}).`);
  }
  if (!caixa.inbox_identifier) caixa = await cw<Caixa>(`/inboxes/${caixa.id}`);
  if (!caixa.inbox_identifier) throw new Error(`A caixa "${NOME_CAIXA}" não é do tipo API (sem inbox_identifier).`);

  // 3. Integração do WAHA com a caixa. Uma só por sessão: com duas, cada mensagem cairia em duas
  //    caixas e o bot responderia duas vezes. Fica a que já aponta para esta caixa (ou a primeira).
  //    O WAHA reinicia a sessão sozinho a cada mudança na integração, então só muda o que precisa.
  const config: ConfigApp = {
    url: 'http://chatwoot:3000',
    accountId: opcoes.conta,
    accountToken: opcoes.tokenAdmin,
    inboxId: caixa.id,
    inboxIdentifier: caixa.inbox_identifier,
    locale: 'pt-BR',
  };
  const apps = ((await waha<AppWaha[]>(`/api/apps?session=${SESSAO}`)) ?? []).filter(
    (a) => a.app === 'chatwoot' && a.session === SESSAO,
  );
  const app = apps.find((a) => a.config?.inboxId === caixa.id) ?? apps[0];
  for (const extra of apps.filter((a) => a !== app)) {
    await waha(`/api/apps/${extra.id}`, 'DELETE');
    log.push(`✓ Integração repetida removida (caixa ${extra.config?.inboxId ?? '?'}).`);
  }
  const idApp = app?.id ?? `app_${randomUUID().replaceAll('-', '')}`;
  const corpoApp = { id: idApp, session: SESSAO, app: 'chatwoot', config };
  if (!app) {
    await waha('/api/apps', 'POST', corpoApp);
    log.push('✓ Integração WAHA ↔ Chatwoot criada.');
  } else if (!mesmaConfig(app.config, config)) {
    await waha(`/api/apps/${idApp}`, 'PUT', corpoApp);
    log.push('✓ Integração WAHA ↔ Chatwoot atualizada.');
  } else {
    log.push('✓ Integração WAHA ↔ Chatwoot já estava certa.');
  }

  // 4. A caixa entrega as respostas ao WAHA por este endereço (leva o id da integração)
  const urlWebhookWaha = `http://waha:3000/webhooks/chatwoot/${SESSAO}/${idApp}`;
  if (caixa.webhook_url !== urlWebhookWaha) {
    await cw(`/inboxes/${caixa.id}`, 'PATCH', { channel: { webhook_url: urlWebhookWaha } });
    log.push(`✓ Caixa "${NOME_CAIXA}" (id ${caixa.id}) agora aponta para o WAHA.`);
  } else {
    log.push(`✓ Caixa "${NOME_CAIXA}" já estava certa (id ${caixa.id}).`);
  }
  await cw(`/inboxes/${caixa.id}/set_agent_bot`, 'POST', { agent_bot: bot.id });
  log.push('✓ Agent Bot ligado à caixa (conversas novas nascem "pendentes", com o bot).');

  // 5. Sessão do WhatsApp no WAHA
  const sessao = await waha<SessaoWaha | null>(`/api/sessions/${SESSAO}`, 'GET', undefined, true);
  if (!sessao) {
    await waha('/api/sessions', 'POST', { name: SESSAO, start: true });
    log.push(`✓ Sessão "${SESSAO}" criada no WAHA.`);
  } else if (sessao.status === 'STOPPED') {
    await waha(`/api/sessions/${SESSAO}/start`, 'POST');
    log.push(`✓ Sessão "${SESSAO}" religada.`);
  } else if (sessao.status === 'FAILED') {
    await waha(`/api/sessions/${SESSAO}/restart`, 'POST');
    log.push(`✓ Sessão "${SESSAO}" reiniciada (estava FAILED).`);
  } else {
    log.push(`✓ Sessão "${SESSAO}" já existia (${sessao.status}).`);
  }

  return { log, tokenBot: bot.access_token };
}
