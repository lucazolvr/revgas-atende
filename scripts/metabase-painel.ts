/**
 * Monta (ou atualiza) no Metabase o painel "Integração RevGás" a partir de docs/metabase.md.
 * Pode rodar de novo sem duplicar nada. A lógica fica em src/dados/metabase.ts (com testes).
 *
 * Antes, uma vez por computador: criar a conta de administrador em http://127.0.0.1:3003 e uma
 * chave de API (Admin → Configurações → Autenticação → Chaves de API, grupo "Administradores"),
 * e colocar a chave em METABASE_API_KEY no .env.
 *
 * Uso: npm run metabase:painel
 */
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import { clienteMetabase, lerConsultas, montarPainel } from '../src/dados/metabase.js';

try {
  loadEnvFile('.env');
} catch {
  console.error('Crie o .env a partir do .env.example antes.');
  process.exit(1);
}

const URL_METABASE = process.env.METABASE_URL?.trim() || 'http://127.0.0.1:3003';
const chave = process.env.METABASE_API_KEY?.trim();
const senha = process.env.METABASE_DB_SENHA?.trim();
if (!chave || !senha) {
  console.error(`Falta ${!chave ? 'METABASE_API_KEY' : 'METABASE_DB_SENHA'} no .env (veja docs/metabase.md).`);
  process.exit(1);
}

const consultas = lerConsultas(readFileSync('docs/metabase.md', 'utf8'));
const { painelId, log } = await montarPainel(clienteMetabase(URL_METABASE, chave), consultas, {
  host: 'postgres',
  porta: 5432,
  banco: 'revgas',
  usuario: 'metabase_leitura',
  senha,
});
for (const linha of log) console.log(linha);
console.log(`\nPainel: ${URL_METABASE}/dashboard/${painelId}#refresh=60  (o #refresh=60 atualiza a cada 1 minuto)`);
