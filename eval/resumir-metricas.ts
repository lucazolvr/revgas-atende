/**
 * Resumo do uso real do bot (teste com usuários / demo):  npm run eval:metricas  [-- --desde 2026-11-20]
 * Lê dados/metricas.jsonl e dados/metricas-AAAA-MM-DD.jsonl (sem texto, nome, telefone ou endereço).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Evento } from '../src/metricas.js';
import { mediana, percentil } from './estatistica.js';

export type Registro = Evento & { em: string };

export function lerMetricas(diretorio = 'dados', desde?: string): Registro[] {
  if (!existsSync(diretorio)) return [];
  return readdirSync(diretorio)
    .filter((n) => /^metricas(-\d{4}-\d{2}-\d{2})?\.jsonl$/.test(n))
    .flatMap((n) => readFileSync(`${diretorio}/${n}`, 'utf8').split('\n'))
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Registro)
    .filter((r) => !desde || r.em >= desde);
}

export function resumirMetricas(registros: Registro[]) {
  const conversas = new Map<number, Registro[]>();
  for (const r of registros) conversas.set(r.conversaId, [...(conversas.get(r.conversaId) ?? []), r]);
  const porConversa = [...conversas.values()].map((evs) => {
    const msgs = evs.filter((e) => e.tipo === 'mensagem');
    const venda = evs.find((e) => e.tipo === 'venda');
    return {
      mensagens: msgs.length,
      ia: msgs.some((e) => e.ia),
      vendeu: venda?.resultado === 'ok',
      transferencia: evs.find((e) => e.tipo === 'transferencia')?.motivo,
      minutos: (Date.parse(evs.at(-1)!.em) - Date.parse(evs[0]!.em)) / 60000,
    };
  });
  const ms = registros.filter((r) => r.tipo === 'mensagem' && typeof r.ms === 'number').map((r) => r.ms!);
  const vendidas = porConversa.filter((c) => c.vendeu);
  const motivos: Record<string, number> = {};
  for (const c of porConversa) if (c.transferencia) motivos[c.transferencia] = (motivos[c.transferencia] ?? 0) + 1;
  return {
    conversas: porConversa.length,
    comIa: porConversa.filter((c) => c.ia).length,
    vendas: vendidas.length,
    transferencias: motivos,
    erros: registros.filter((r) => r.tipo === 'erro').length,
    mensagensAteVenda: { comIa: mediana(vendidas.filter((c) => c.ia).map((c) => c.mensagens)), semIa: mediana(vendidas.filter((c) => !c.ia).map((c) => c.mensagens)) },
    minutosAteVenda: mediana(vendidas.map((c) => c.minutos)),
    respostaBot: { medianaMs: mediana(ms), p95Ms: percentil(ms, 0.95) },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--desde');
  const r = resumirMetricas(lerMetricas('dados', i > 0 ? process.argv[i + 1] : undefined));
  const n = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
  const md = [
    '# Uso real do bot (métricas sem dados pessoais)',
    '',
    '| Métrica | Valor |',
    '|---|---:|',
    `| Conversas | ${r.conversas} (${r.comIa} com IA) |`,
    `| Vendas registradas | ${r.vendas} (${n((100 * r.vendas) / (r.conversas || 1))}% das conversas) |`,
    `| Transferências para humano | ${Object.entries(r.transferencias).map(([k, v]) => `${k}: ${v}`).join(', ') || '0'} |`,
    `| Erros técnicos | ${r.erros} |`,
    `| Mensagens até a venda (mediana) | com IA ${n(r.mensagensAteVenda.comIa)} · sem IA ${n(r.mensagensAteVenda.semIa)} |`,
    `| Tempo até a venda (mediana) | ${n(r.minutosAteVenda)} min |`,
    `| Tempo de resposta do bot | mediana ${n(r.respostaBot.medianaMs / 1000)} s · p95 ${n(r.respostaBot.p95Ms / 1000)} s |`,
  ].join('\n');
  mkdirSync('eval/resultados', { recursive: true });
  writeFileSync('eval/resultados/uso-real.md', md + '\n');
  console.log(md);
}
