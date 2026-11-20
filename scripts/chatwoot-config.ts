/**
 * Deixa o painel do Chatwoot sob medida para a RevGás (pode rodar de novo sem duplicar nada):
 *   1. etiquetas do bot com cor e descrição;
 *   2. respostas prontas (/saiu, /endereco, /seguranca, /horario, /obrigado);
 *   3. atributos de conversa com os dados do pedido (o bot preenche);
 *   4. horário de atendimento da caixa "WhatsApp RevGás";
 *   5. aba "Pedido RevGás" dentro da conversa (se houver PAINEL_TOKEN).
 * A marca, o menu "Pedidos de hoje" e o cache do painel ficam com o scripts/chatwoot-ajustes.rb.
 * As definições ficam em src/canal/painel.ts e os textos em src/conversa/mensagens.ts.
 *
 * Roda sozinho a cada `docker compose up` (serviço chatwoot-config). À mão: npm run chatwoot:config
 * (lê o .env; Chatwoot em 127.0.0.1:3000).
 */
import { loadEnvFile } from 'node:process';
import { configurarPainel } from '../src/canal/painel.js';
import { TOKEN_PAINEL_MINIMO, tokenPainelValido } from '../src/config.js';

// No Docker as variáveis já vêm do env_file; à mão, do .env.
try {
  loadEnvFile('.env');
} catch {
  /* sem .env: usa o ambiente */
}

/** No `docker compose up` (CHATWOOT_CONFIG_AUTOMATICO=1), falta de pré-requisito não é erro. */
const automatico = process.env.CHATWOOT_CONFIG_AUTOMATICO === '1';
const CHATWOOT = (process.env.CHATWOOT_CONFIG_URL?.trim() || 'http://127.0.0.1:3000').replace(/\/+$/, '');

function pular(motivo: string): never {
  console.log(`· chatwoot-config: ${motivo}`);
  process.exit(automatico ? 0 : 1);
}

const conta = process.env.CHATWOOT_ACCOUNT_ID?.trim();
const tokenAdmin = process.env.CHATWOOT_ADMIN_TOKEN?.trim();
if (!conta) pular('falta CHATWOOT_ACCOUNT_ID no .env.');
if (!tokenAdmin) pular('falta CHATWOOT_ADMIN_TOKEN no .env (primeira instalação: crie a conta no Chatwoot e copie o token).');

async function cw<T>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const url = `${CHATWOOT}/api/v1/accounts/${conta}${caminho}`;
  const r = await fetch(url, {
    method: metodo,
    headers: { api_access_token: tokenAdmin!, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${url.replace(/\?.*/, '')} → ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

/** No `docker compose up` o Chatwoot pode estar subindo: espera até ~3 min. */
async function esperarChatwoot() {
  const limite = Date.now() + (automatico ? 180_000 : 5_000);
  for (;;) {
    try {
      const r = await fetch(`${CHATWOOT}/api`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    if (Date.now() > limite) pular(`o Chatwoot não respondeu em ${CHATWOOT}.`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

await esperarChatwoot();
try {
  // Aba "Pedido RevGás": só com PAINEL_TOKEN. O token vai depois do # (o navegador não o envia ao servidor).
  // Com token curto o bot desliga o painel; a aba também fica de fora, para não aparecer quebrada.
  const bruto = process.env.PAINEL_TOKEN?.trim();
  const tokenPainel = tokenPainelValido(bruto) ? bruto : undefined;
  const urlPainel = (process.env.PAINEL_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, '');
  const urlAba = tokenPainel ? `${urlPainel}/painel#token=${encodeURIComponent(tokenPainel)}` : undefined;
  const log = await configurarPainel(cw, { urlAba });
  if (!urlAba) {
    log.push(
      bruto
        ? `· aba Pedido RevGás desligada (PAINEL_TOKEN com menos de ${TOKEN_PAINEL_MINIMO} caracteres)`
        : '· aba Pedido RevGás desligada (sem PAINEL_TOKEN no .env)',
    );
  }
  for (const linha of log) console.log(linha);
  console.log('\nPronto (+ criado · ~ atualizado · = já estava certo).');
  if (!automatico) {
    console.log('Marca, menu "Pedidos de hoje" e cache do painel: docker compose run --rm chatwoot-ajustes');
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  // Antes do npm run setup a caixa do WhatsApp não existe: no automático, só avisa.
  if (msg.includes('npm run setup')) pular(msg);
  console.error(`✗ chatwoot-config: ${msg}`);
  if (/→ 401:/.test(msg)) console.error('  Dica: o CHATWOOT_ADMIN_TOKEN do .env está errado ou foi trocado (Chatwoot → Perfil → Token de acesso).');
  else if (/→ 404:/.test(msg)) console.error('  Dica: confira o CHATWOOT_ACCOUNT_ID do .env (o número em /app/accounts/N/ no endereço do Chatwoot).');
  // No `docker compose up`, um erro aqui não derruba a subida: o bot e o Chatwoot seguem no ar,
  // e o problema fica explicado no log (docker compose logs chatwoot-config).
  process.exit(automatico ? 0 : 1);
}
