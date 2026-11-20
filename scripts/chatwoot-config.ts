/**
 * Deixa o painel do Chatwoot sob medida para a RevGás (pode rodar de novo sem duplicar nada):
 *   1. etiquetas do bot com cor e descrição;
 *   2. respostas prontas (/saiu, /endereco, /seguranca, /horario, /obrigado);
 *   3. atributos de conversa com os dados do pedido (o bot preenche);
 *   4. horário de atendimento da caixa "WhatsApp RevGás".
 * As definições ficam em src/canal/painel.ts e os textos em src/conversa/mensagens.ts.
 * Uso: npm run chatwoot:config   (depois do npm run setup; lê o .env; Chatwoot em 127.0.0.1:3000)
 */
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { configurarPainel } from '../src/canal/painel.js';

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

try {
  const log = await configurarPainel(cw);
  for (const linha of log) console.log(linha);
  if (log.some((l) => /^[+~] etiqueta/.test(l))) renovarCacheDoPainel();
  console.log('\nPronto (+ criado · ~ atualizado · = já estava certo). Recarregue o painel do Chatwoot.');
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
