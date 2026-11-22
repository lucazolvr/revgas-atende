/**
 * Cancela vendas de teste criadas na API RevGás (ambiente de teste):
 *   npm run cancelar-venda -- 123 [124 ...]
 * Mostra a venda antes de cancelar e só cancela as do REVGAS_ESTABELECIMENTO configurado.
 */
import { ApiRevGasHttp } from '../src/vendas/api-revgas.js';

process.loadEnvFile('.env');
const ids = process.argv.slice(2).map(Number);
const estabelecimento = Number(process.env.REVGAS_ESTABELECIMENTO);
if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
  console.error('Uso: npm run cancelar-venda -- <id> [<id> ...]');
  process.exit(1);
}
const api = new ApiRevGasHttp(process.env.REVGAS_API_URL ?? 'https://api.revgas.com/v1', process.env.REVGAS_API_KEY ?? '');

for (const id of ids) {
  const atual = await api.detalharVenda(id);
  // O detalhe vem sem o envelope `data` (ao contrário da criação); aceita os dois formatos.
  const bruto = atual.dados as ({ data?: Record<string, unknown> } & Record<string, unknown>) | null;
  const venda = bruto?.data ?? bruto;
  if (atual.status !== 200 || !venda) {
    console.log(`✗ ${id}: não encontrada (HTTP ${atual.status})`);
    continue;
  }
  if (venda.establishment_id !== estabelecimento) {
    console.log(`✗ ${id}: é do estabelecimento ${venda.establishment_id}, não do ${estabelecimento}; não cancelei`);
    continue;
  }
  if (venda.status === 'CANCEL') {
    console.log(`• ${id}: já estava cancelada`);
    continue;
  }
  const r = await api.cancelarVenda(id);
  console.log(r.status === 200 || r.status === 204 ?`✓ ${id}: cancelada (estava ${venda.status}, total R$ ${venda.total})` : `✗ ${id}: HTTP ${r.status} ${JSON.stringify(r.dados).slice(0, 200)}`);
}
