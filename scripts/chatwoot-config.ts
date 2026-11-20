/**
 * Deixa o painel do Chatwoot sob medida para a RevGás (pode rodar de novo sem duplicar nada):
 *   1. etiquetas do bot com cor e descrição;
 *   2. respostas prontas (/saiu, /endereco, /seguranca, /horario, /obrigado);
 *   3. atributos de conversa com os dados do pedido (o bot preenche);
 *   4. horário de atendimento da caixa "WhatsApp RevGás";
 *   5. aba "Pedido RevGás" dentro da conversa e item "Pedidos de hoje" no menu lateral
 *      (se houver PAINEL_TOKEN no .env).
 * As definições ficam em src/canal/painel.ts e os textos em src/conversa/mensagens.ts.
 * Uso: npm run chatwoot:config   (depois do npm run setup; lê o .env; Chatwoot em 127.0.0.1:3000)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { configurarPainel, htmlDoMenu } from '../src/canal/painel.js';

try {
  loadEnvFile('.env');
} catch {
  console.error('Crie o .env a partir do .env.example antes.');
  process.exit(1);
}

const CHATWOOT = 'http://127.0.0.1:3000';

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

async function cw<T>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const url = `${CHATWOOT}/api/v1/accounts/${conta}${caminho}`;
  const r = await fetch(url, {
    method: metodo,
    headers: { api_access_token: tokenAdmin, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${url.replace(/\?.*/, '')} → ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

/**
 * O Chatwoot versiona o cache de etiquetas do navegador pelo segundo da última alteração. Criadas
 * todas no mesmo segundo, um painel aberto guardava só a primeira e nem Ctrl+F5 resolvia.
 * Renovar a chave depois (o rails runner leva segundos para subir) faz o painel buscar a lista nova.
 */
function renovarCacheDoPainel() {
  try {
    execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'chatwoot', 'bundle', 'exec', 'rails', 'runner', `Account.find(${Number(conta)}).reset_cache_keys`],
      { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    console.log('✓ cache do painel renovado');
  } catch {
    console.log(
      '! Se a barra lateral não mostrar todas as etiquetas, rode:\n' +
        `  docker compose exec chatwoot bundle exec rails runner "Account.find(${Number(conta)}).reset_cache_keys"`,
    );
  }
}

/** Item "Pedidos de hoje" no menu lateral (vazio = tira). Precisa do rails runner no container. */
function aplicarMenu(html: string) {
  const ruby = readFileSync('scripts/aplicar-menu.rb', 'utf8');
  try {
    const saida = execFileSync('docker', ['compose', 'exec', '-T', '-e', 'REVGAS_MENU_HTML', 'chatwoot', 'bundle', 'exec', 'rails', 'runner', ruby], {
      encoding: 'utf8',
      // O HTML (com o token) vai pelo ambiente, não pela linha de comando.
      env: { ...process.env, REVGAS_MENU_HTML: html, MSYS_NO_PATHCONV: '1' },
    });
    console.log(saida.split('\n').filter((l) => l.startsWith('✓')).join('\n'));
  } catch {
    console.log('! Não consegui aplicar o menu "Pedidos de hoje" (o docker compose está no ar?). Rode de novo depois.');
  }
}

try {
  // Aba "Pedido RevGás": só com PAINEL_TOKEN. O token vai depois do # (o navegador não o envia ao servidor).
  const tokenPainel = process.env.PAINEL_TOKEN?.trim();
  const urlPainel = (process.env.PAINEL_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, '');
  const urlAba = tokenPainel ? `${urlPainel}/painel#token=${encodeURIComponent(tokenPainel)}` : undefined;
  const log = await configurarPainel(cw, { urlAba });
  if (!urlAba) log.push('· aba Pedido RevGás desligada (sem PAINEL_TOKEN no .env)');
  for (const linha of log) console.log(linha);
  if (log.some((l) => /^[+~] etiqueta/.test(l))) renovarCacheDoPainel();
  // Menu "Pedidos de hoje": também só com PAINEL_TOKEN (sem ele, o item sai do menu).
  aplicarMenu(tokenPainel ? htmlDoMenu(urlPainel, tokenPainel) : '');
  console.log('\nPronto (+ criado · ~ atualizado · = já estava certo). Recarregue o painel do Chatwoot.');
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
