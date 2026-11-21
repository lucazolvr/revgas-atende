/**
 * Liga as peças depois do `docker compose up -d` (pode rodar de novo sem duplicar nada):
 *   1. cria o Agent Bot "RevGás Atende" no Chatwoot, apontando para o webhook do bot;
 *   2. garante a caixa "WhatsApp RevGás" (canal API). Se ela já existe (instalação que veio da
 *      Evolution), reaproveita: as conversas antigas ficam;
 *   3. cria ou atualiza a integração do WAHA com essa caixa (app "chatwoot") e aponta a caixa para ela;
 *   4. cria ou religa a sessão "default" do WhatsApp no WAHA (motor GOWS).
 * A lógica fica em src/canal/whatsapp.ts (com testes).
 * Uso: npm run setup   (lê o .env; Chatwoot em 127.0.0.1:3000 e WAHA em 127.0.0.1:3002)
 */
import { loadEnvFile } from 'node:process';
import { SESSAO, ligarWhatsApp } from '../src/canal/whatsapp.js';

try {
  loadEnvFile('.env');
} catch {
  console.error('Crie o .env a partir do .env.example antes.');
  process.exit(1);
}

const CHATWOOT = 'http://127.0.0.1:3000';
const WAHA = 'http://127.0.0.1:3002';

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

async function chamar<T>(url: string, init: RequestInit & { headers: Record<string, string> }, semErro404 = false): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
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

// Confere antes que o WAHA está de pé e que a chave do .env é a dele.
try {
  const r = await fetch(`${WAHA}/api/sessions`, { headers: { 'X-Api-Key': chaveWaha }, signal: AbortSignal.timeout(5_000) });
  if (r.status === 401) {
    console.error('✗ O WAHA recusou a WAHA_API_KEY do .env. Se mudou a chave, rode "docker compose up -d waha" de novo.');
    process.exit(1);
  }
  if (!r.ok) throw new Error(String(r.status));
} catch (e) {
  if (e instanceof Error && /^\d+$/.test(e.message)) console.error(`✗ O endereço ${WAHA} respondeu ${e.message}: não parece ser o WAHA.`);
  else console.error(`✗ O WAHA não respondeu em ${WAHA}. Rode "docker compose up -d" e tente de novo.`);
  process.exit(1);
}

const { log, tokenBot } = await ligarWhatsApp(cw, waha, { conta: Number(conta), tokenAdmin, tokenWebhook });
for (const linha of log) console.log(linha);

console.log('\nFalta pouco:');
if (tokenBot) {
  console.log(`1. Coloque no .env:  CHATWOOT_BOT_TOKEN=${tokenBot}`);
} else {
  console.log('1. Copie o token do bot (Chatwoot → Configurações → Bots → RevGás Atende) para CHATWOOT_BOT_TOKEN no .env.');
}
console.log('2. Reinicie o bot:   docker compose up -d --build bot');
console.log(`3. Leia o QR code:   ${WAHA}/dashboard  (usuário e senha do .env; na 1ª vez, cole a WAHA_API_KEY`);
console.log(`                     no "Worker"; depois, na sessão "${SESSAO}", clique no ícone de login)`);
