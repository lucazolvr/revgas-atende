/**
 * Liga as peças depois do `docker compose up -d` (pode rodar de novo sem duplicar nada):
 *   1. cria o Agent Bot "RevGás Atende" no Chatwoot, apontando para o webhook do bot;
 *   2. cria a instância "revgas" na Evolution e liga a integração com o Chatwoot
 *      (a Evolution cria a caixa "WhatsApp RevGás" sozinha);
 *   3. liga o Agent Bot à caixa.
 * Uso: npm run setup   (lê o .env; Chatwoot em 127.0.0.1:3000 e Evolution em 127.0.0.1:8080)
 */
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  console.error('Crie o .env a partir do .env.example antes.');
  process.exit(1);
}

const CHATWOOT = 'http://127.0.0.1:3000';
const EVOLUTION = 'http://127.0.0.1:8080';
const INSTANCIA = 'revgas';
const NOME_CAIXA = 'WhatsApp RevGás';
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
const chaveEvolution = exigir('EVOLUTION_API_KEY');
const tokenWebhook = exigir('BOT_WEBHOOK_TOKEN');

async function chamar<T>(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')} → ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

const cw = <T>(caminho: string, metodo = 'GET', corpo?: unknown) =>
  chamar<T>(`${CHATWOOT}/api/v1/accounts/${conta}${caminho}`, {
    method: metodo,
    headers: { api_access_token: tokenAdmin },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
const evo = <T>(caminho: string, metodo = 'GET', corpo?: unknown) =>
  chamar<T>(`${EVOLUTION}${caminho}`, {
    method: metodo,
    headers: { apikey: chaveEvolution },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

type AgentBot = { id: number; name: string; access_token?: string };
type Caixa = { id: number; name: string };

// 1. Agent Bot (o Chatwoot chama o bot pela rede interna do Docker)
const urlWebhook = `http://bot:3000/webhook/${tokenWebhook}`;
const bots = await cw<AgentBot[]>('/agent_bots');
let bot = bots.find((b) => b.name === NOME_BOT);
if (bot) {
  bot = await cw<AgentBot>(`/agent_bots/${bot.id}`, 'PATCH', { outgoing_url: urlWebhook });
  console.log(`✓ Agent Bot já existia (id ${bot.id}); webhook atualizado.`);
} else {
  bot = await cw<AgentBot>('/agent_bots', 'POST', {
    name: NOME_BOT,
    description: 'Atendente virtual de pedidos de gás',
    outgoing_url: urlWebhook,
  });
  console.log(`✓ Agent Bot criado (id ${bot.id}).`);
}

// 2. Instância da Evolution + integração com o Chatwoot
const instancias = await evo<{ name?: string; instance?: { instanceName?: string } }[]>('/instance/fetchInstances');
const existe = instancias.some((i) => (i.name ?? i.instance?.instanceName) === INSTANCIA);
if (!existe) {
  await evo('/instance/create', 'POST', { instanceName: INSTANCIA, integration: 'WHATSAPP-BAILEYS', qrcode: true });
  console.log(`✓ Instância "${INSTANCIA}" criada na Evolution.`);
} else {
  console.log(`✓ Instância "${INSTANCIA}" já existia.`);
}
await evo(`/chatwoot/set/${INSTANCIA}`, 'POST', {
  enabled: true,
  accountId: conta,
  token: tokenAdmin,
  url: 'http://chatwoot:3000',
  signMsg: false,
  reopenConversation: true,
  conversationPending: true, // conversa nova nasce "pendente": fica com o bot até alguém assumir
  nameInbox: NOME_CAIXA,
  mergeBrazilContacts: true,
  importContacts: false,
  importMessages: false,
  autoCreate: true,
});
console.log('✓ Evolution ligada ao Chatwoot.');

// 3. Agent Bot na caixa do WhatsApp
const { payload: caixas } = await cw<{ payload: Caixa[] }>('/inboxes');
const caixa = caixas.find((c) => c.name === NOME_CAIXA);
if (!caixa) {
  console.error(`✗ A caixa "${NOME_CAIXA}" ainda não apareceu no Chatwoot. Rode de novo em alguns segundos.`);
  process.exit(1);
}
await cw(`/inboxes/${caixa.id}/set_agent_bot`, 'POST', { agent_bot: bot.id });
console.log(`✓ Agent Bot ligado à caixa "${NOME_CAIXA}" (id ${caixa.id}).`);

console.log('\nFalta pouco:');
if (bot.access_token) {
  console.log(`1. Coloque no .env:  CHATWOOT_BOT_TOKEN=${bot.access_token}`);
} else {
  console.log('1. Copie o token do bot (Chatwoot → Configurações → Bots → RevGás Atende) para CHATWOOT_BOT_TOKEN no .env.');
}
console.log('2. Reinicie o bot:   docker compose up -d --build bot');
console.log(`3. Leia o QR code:   ${EVOLUTION}/manager  (instância "${INSTANCIA}", use a EVOLUTION_API_KEY)`);
