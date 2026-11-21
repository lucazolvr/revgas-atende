/**
 * Liga as peças depois do `docker compose up -d` (pode rodar de novo sem duplicar nada):
 *   1. cria o Agent Bot "RevGás Atende" no Chatwoot, apontando para o webhook do bot;
 *   2. garante a caixa "WhatsApp RevGás" (canal API) apontando para o WAHA e liga o Agent Bot a ela.
 *      Se a caixa já existe (instalação que veio da Evolution), só troca o endereço: o histórico fica;
 *   3. cria ou atualiza a integração do WAHA com essa caixa (app "chatwoot");
 *   4. cria ou religa a sessão "default" do WhatsApp no WAHA (motor GOWS).
 * Uso: npm run setup   (lê o .env; Chatwoot em 127.0.0.1:3000 e WAHA em 127.0.0.1:3002)
 */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { NOME_CAIXA } from '../src/canal/painel.js';

try {
  loadEnvFile('.env');
} catch {
  console.error('Crie o .env a partir do .env.example antes.');
  process.exit(1);
}

const CHATWOOT = 'http://127.0.0.1:3000';
const WAHA = 'http://127.0.0.1:3002';
const SESSAO = 'default';
const NOME_BOT = 'RevGás Atende';

function exigir(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) {
    console.error(`Falta ${nome} no .env.`);
    process.exit(1);
  }
  return v;
}

const conta = exigir('CHATWOOT_ACCOUNT_ID');
const tokenAdmin = exigir('CHATWOOT_ADMIN_TOKEN');
const chaveWaha = exigir('WAHA_API_KEY');
const tokenWebhook = exigir('BOT_WEBHOOK_TOKEN');

/** `semErro404`: devolve null em vez de lançar quando o recurso não existe. */
async function chamar<T>(
  url: string,
  init: RequestInit & { headers: Record<string, string> },
  semErro404 = false,
): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const texto = await r.text();
  if (semErro404 && r.status === 404) return null as T;
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')} → ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

const cw = <T>(caminho: string, metodo = 'GET', corpo?: unknown) =>
  chamar<T>(`${CHATWOOT}/api/v1/accounts/${conta}${caminho}`, {
    method: metodo,
    headers: { api_access_token: tokenAdmin },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
const waha = <T>(caminho: string, metodo = 'GET', corpo?: unknown, semErro404 = false) =>
  chamar<T>(
    `${WAHA}${caminho}`,
    { method: metodo, headers: { 'X-Api-Key': chaveWaha }, body: corpo ? JSON.stringify(corpo) : undefined },
    semErro404,
  );

type AgentBot = { id: number; name: string; access_token?: string };
type Caixa = { id: number; name: string; inbox_identifier?: string; webhook_url?: string };
type AppWaha = { id: string; session: string; app: string };
type SessaoWaha = { name: string; status: string };

try {
  await fetch(`${WAHA}/ping`);
} catch {
  console.error(`✗ O WAHA não respondeu em ${WAHA}. Rode "docker compose up -d" e tente de novo.`);
  process.exit(1);
}

// 1. Agent Bot (o Chatwoot chama o bot pela rede interna do Docker)
const urlWebhookBot = `http://bot:3000/webhook/${tokenWebhook}`;
const bots = await cw<AgentBot[]>('/agent_bots');
let bot = bots.find((b) => b.name === NOME_BOT);
if (bot) {
  bot = await cw<AgentBot>(`/agent_bots/${bot.id}`, 'PATCH', { outgoing_url: urlWebhookBot });
  console.log(`✓ Agent Bot já existia (id ${bot.id}); webhook atualizado.`);
} else {
  bot = await cw<AgentBot>('/agent_bots', 'POST', {
    name: NOME_BOT,
    description: 'Atendente virtual de pedidos de gás',
    outgoing_url: urlWebhookBot,
  });
  console.log(`✓ Agent Bot criado (id ${bot.id}).`);
}

// 2. Caixa do WhatsApp no Chatwoot (canal API). O Chatwoot entrega as respostas ao WAHA por este
//    endereço, que leva o id da integração: reaproveita o id de uma integração que já exista.
const apps = (await waha<AppWaha[]>(`/api/apps?session=${SESSAO}`)) ?? [];
const idApp = apps.find((a) => a.app === 'chatwoot' && a.session === SESSAO)?.id ?? `app_${randomUUID().replaceAll('-', '')}`;
const urlWebhookWaha = `http://waha:3000/webhooks/chatwoot/${SESSAO}/${idApp}`;

const { payload: caixas } = await cw<{ payload: Caixa[] }>('/inboxes');
let caixa = caixas.find((c) => c.name === NOME_CAIXA);
if (!caixa) {
  caixa = await cw<Caixa>('/inboxes', 'POST', { name: NOME_CAIXA, channel: { type: 'api', webhook_url: urlWebhookWaha } });
  console.log(`✓ Caixa "${NOME_CAIXA}" criada (id ${caixa.id}).`);
} else if (caixa.webhook_url !== urlWebhookWaha) {
  caixa = await cw<Caixa>(`/inboxes/${caixa.id}`, 'PATCH', { channel: { webhook_url: urlWebhookWaha } });
  console.log(`✓ Caixa "${NOME_CAIXA}" já existia (id ${caixa.id}); agora aponta para o WAHA.`);
} else {
  console.log(`✓ Caixa "${NOME_CAIXA}" já estava certa (id ${caixa.id}).`);
}
if (!caixa.inbox_identifier) caixa = await cw<Caixa>(`/inboxes/${caixa.id}`);
await cw(`/inboxes/${caixa.id}/set_agent_bot`, 'POST', { agent_bot: bot.id });
console.log(`✓ Agent Bot ligado à caixa (conversas novas nascem "pendentes", com o bot).`);

// 3. Integração do WAHA com a caixa (o WAHA usa o token do administrador para criar contatos e mensagens)
const configApp = {
  url: 'http://chatwoot:3000',
  accountId: Number(conta),
  accountToken: tokenAdmin,
  inboxId: caixa.id,
  inboxIdentifier: caixa.inbox_identifier,
  locale: 'pt-BR',
};
if (apps.some((a) => a.id === idApp)) {
  await waha(`/api/apps/${idApp}`, 'PUT', { id: idApp, session: SESSAO, app: 'chatwoot', config: configApp });
  console.log('✓ Integração WAHA ↔ Chatwoot atualizada.');
} else {
  await waha('/api/apps', 'POST', { id: idApp, session: SESSAO, app: 'chatwoot', config: configApp });
  console.log('✓ Integração WAHA ↔ Chatwoot criada.');
}

// 4. Sessão do WhatsApp no WAHA
let sessao = await waha<SessaoWaha | null>(`/api/sessions/${SESSAO}`, 'GET', undefined, true);
if (!sessao) {
  sessao = await waha<SessaoWaha>('/api/sessions', 'POST', { name: SESSAO, start: true });
  console.log(`✓ Sessão "${SESSAO}" criada no WAHA.`);
} else if (sessao.status === 'STOPPED') {
  await waha(`/api/sessions/${SESSAO}/start`, 'POST');
  console.log(`✓ Sessão "${SESSAO}" religada.`);
} else if (sessao.status === 'FAILED') {
  await waha(`/api/sessions/${SESSAO}/restart`, 'POST');
  console.log(`✓ Sessão "${SESSAO}" reiniciada (estava FAILED).`);
} else {
  console.log(`✓ Sessão "${SESSAO}" já existia (${sessao.status}).`);
}

console.log('\nFalta pouco:');
if (bot.access_token) {
  console.log(`1. Coloque no .env:  CHATWOOT_BOT_TOKEN=${bot.access_token}`);
} else {
  console.log('1. Copie o token do bot (Chatwoot → Configurações → Bots → RevGás Atende) para CHATWOOT_BOT_TOKEN no .env.');
}
console.log('2. Reinicie o bot:   docker compose up -d --build bot');
console.log(`3. Leia o QR code:   ${WAHA}/dashboard  (usuário e senha do .env; na 1ª vez, cole a WAHA_API_KEY`);
console.log(`                     no "Worker"; depois, na sessão "${SESSAO}", clique no ícone de login)`);
