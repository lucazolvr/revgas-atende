/**
 * Experimento H1 (pareado):  npm run eval:experimento  [-- --limite 5]
 * H1: com interpretação por IA, o cliente conclui o pedido com menos mensagens do que pelo menu.
 * H0: não há diferença no número de mensagens.
 * Cada perfil de eval/perfis.json faz o mesmo pedido pelos dois caminhos, contra o motor real.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Interpretador } from '../src/ia/interpretacao.js';
import { carregarCatalogo } from '../src/vendas/catalogo.js';
import { simular, type Modo, type Perfil, type ResultadoSimulacao } from './cliente-simulado.js';
import { media, mediana, percentil, wilcoxonPareado } from './estatistica.js';

export function carregarPerfis(caminho = 'eval/perfis.json'): Perfil[] {
  return JSON.parse(readFileSync(caminho, 'utf8')) as Perfil[];
}

export async function rodarExperimento(perfis: Perfil[], ia: Interpretador, aoAvancar?: (n: number) => void) {
  const catalogo = carregarCatalogo();
  const resultados: ResultadoSimulacao[] = [];
  for (const [i, perfil] of perfis.entries()) {
    resultados.push(await simular(perfil, 'menu', { catalogo, interpretador: null }));
    // Com a IA real, o tempo do bot é a soma das chamadas à API, sem as pausas que respeitam a cota grátis.
    const latencias = (ia as { latencias?: number[] }).latencias;
    const antes = latencias?.length ?? 0;
    const r = await simular(perfil, 'ia', { catalogo, interpretador: ia });
    if (latencias) r.msBot = latencias.slice(antes).reduce((a, b) => a + b, 0);
    resultados.push(r);
    aoAvancar?.(i + 1);
  }
  return resultados;
}

export function resumirExperimento(resultados: ResultadoSimulacao[]) {
  const de = (m: Modo) => resultados.filter((r) => r.modo === m).sort((a, b) => a.perfil - b.perfil);
  const descrever = (m: Modo) => {
    const rs = de(m);
    const msgs = rs.map((r) => r.mensagens);
    return {
      n: rs.length,
      concluiram: rs.filter((r) => r.concluiu).length,
      corretos: rs.filter((r) => r.correto).length,
      transferidos: rs.filter((r) => r.transferencia).length,
      comCorrecao: rs.filter((r) => r.correcoes > 0).length,
      mensagens: { media: media(msgs), mediana: mediana(msgs), min: Math.min(...msgs), max: Math.max(...msgs), q1: percentil(msgs, 0.25), q3: percentil(msgs, 0.75) },
      caracteres: { media: media(rs.map((r) => r.caracteres)), mediana: mediana(rs.map((r) => r.caracteres)) },
      msBot: { mediana: mediana(rs.map((r) => r.msBot)), p95: percentil(rs.map((r) => r.msBot), 0.95) },
    };
  };
  const menu = de('menu');
  const ia = de('ia');
  return {
    menu: descrever('menu'),
    ia: descrever('ia'),
    reducaoMediana: 1 - mediana(ia.map((r) => r.mensagens)) / mediana(menu.map((r) => r.mensagens)),
    wilcoxonMensagens: wilcoxonPareado(menu.map((r) => r.mensagens), ia.map((r) => r.mensagens)),
    wilcoxonCaracteres: wilcoxonPareado(menu.map((r) => r.caracteres), ia.map((r) => r.caracteres)),
  };
}

const num = (x: number, casas = 1) => (Number.isFinite(x) ? x.toFixed(casas).replace('.', ',') : '—');
const pct = (a: number, b: number) => `${a}/${b} (${num((100 * a) / (b || 1), 0)}%)`;
const valorP = (p: number) => (p < 0.001 ? '< 0,001' : num(p, 4));

export function relatorioMarkdown(resultados: ResultadoSimulacao[], meta: { modelo: string; data: string }) {
  const s = resumirExperimento(resultados);
  const linha = (rotulo: string, f: (d: typeof s.menu) => string) => `| ${rotulo} | ${f(s.menu)} | ${f(s.ia)} |`;
  return [
    `# Experimento: pedido pelo menu × pedido com IA (${meta.data})`,
    '',
    '**H1:** com interpretação por IA, o cliente conclui o pedido com **menos mensagens** do que pelo menu numerado.  ',
    '**H0:** não há diferença no número de mensagens.  ',
    `**Desenho:** pareado. ${s.menu.n} perfis de cliente (\`eval/perfis.json\`) fazem o mesmo pedido pelos dois caminhos, contra o motor real do bot; um cliente simulado responde às perguntas e confere o resumo antes de confirmar. IA: \`${meta.modelo}\`.  `,
    '**Teste:** Wilcoxon de postos sinalizados, bicaudal, α = 0,05.',
    '',
    '## Resultados',
    '',
    '| Métrica | Menu (controle) | IA (tratamento) |',
    '|---|---:|---:|',
    linha('Pedidos concluídos', (d) => pct(d.concluiram, d.n)),
    linha('Pedidos registrados corretos', (d) => pct(d.corretos, d.n)),
    linha('Precisaram corrigir no resumo', (d) => pct(d.comCorrecao, d.n)),
    linha('Transferidos para humano', (d) => pct(d.transferidos, d.n)),
    linha('Mensagens do cliente — média', (d) => num(d.mensagens.media)),
    linha('Mensagens do cliente — mediana [Q1–Q3]', (d) => `${num(d.mensagens.mediana)} [${num(d.mensagens.q1)}–${num(d.mensagens.q3)}]`),
    linha('Mensagens do cliente — mín–máx', (d) => `${d.mensagens.min}–${d.mensagens.max}`),
    linha('Caracteres digitados — mediana', (d) => num(d.caracteres.mediana, 0)),
    linha('Tempo de processamento do bot por pedido — mediana', (d) => `${num(d.msBot.mediana / 1000, 2)} s`),
    '',
    '## Teste de hipótese',
    '',
    '| Variável | n (pares ≠ 0) | W+ | W− | z | p |',
    '|---|---:|---:|---:|---:|---:|',
    `| Mensagens | ${s.wilcoxonMensagens.n} | ${s.wilcoxonMensagens.wMais} | ${s.wilcoxonMensagens.wMenos} | ${num(s.wilcoxonMensagens.z, 2)} | ${valorP(s.wilcoxonMensagens.p)} |`,
    `| Caracteres | ${s.wilcoxonCaracteres.n} | ${s.wilcoxonCaracteres.wMais} | ${s.wilcoxonCaracteres.wMenos} | ${num(s.wilcoxonCaracteres.z, 2)} | ${valorP(s.wilcoxonCaracteres.p)} |`,
    '',
    `Redução da mediana de mensagens com IA: **${num(100 * s.reducaoMediana, 0)}%**. ` +
      (s.wilcoxonMensagens.p < 0.05 && s.ia.mensagens.mediana < s.menu.mensagens.mediana
        ? '**H0 rejeitada** (p < 0,05): a IA reduz o número de mensagens.'
        : '**H0 não rejeitada** (p ≥ 0,05).'),
    '',
    '## Por perfil',
    '',
    '| Perfil | Menu: msgs | IA: msgs | IA: correções | IA: correto | IA: transferido |',
    '|---:|---:|---:|---:|:---:|---|',
    ...[...new Set(resultados.map((r) => r.perfil))].map((id) => {
      const m = resultados.find((r) => r.perfil === id && r.modo === 'menu')!;
      const i = resultados.find((r) => r.perfil === id && r.modo === 'ia')!;
      return `| ${id} | ${m.mensagens} | ${i.mensagens} | ${i.correcoes} | ${i.correto ? '✅' : '❌'} | ${i.transferencia ?? '—'} |`;
    }),
    '',
    '> Limitações: clientes simulados a partir de perfis escritos pela equipe; o tempo que uma pessoa leva para ler e digitar não foi simulado (só o processamento do bot). O teste com usuários reais (SUS) complementa esta parte.',
  ].join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { IaAvaliada } = await import('./ia-real.js');
  const i = process.argv.indexOf('--limite');
  const perfis = carregarPerfis().slice(0, i > 0 ? Number(process.argv[i + 1]) : undefined);
  const ia = new IaAvaliada();
  console.log(`Experimento com ${perfis.length} perfis (${ia.modelo}). Leva alguns minutos por causa da cota grátis...`);
  const resultados = await rodarExperimento(perfis, ia, (n) => process.stdout.write(`\r${n}/${perfis.length}`));
  const data = new Date().toISOString().slice(0, 10);
  mkdirSync('eval/resultados', { recursive: true });
  writeFileSync(`eval/resultados/experimento-${data}.md`, relatorioMarkdown(resultados, { modelo: ia.modelo, data }));
  writeFileSync(`eval/resultados/experimento-${data}.json`, JSON.stringify({ modelo: ia.modelo, data, indisponiveis: ia.indisponiveis, latencias: ia.latencias, resultados, resumo: resumirExperimento(resultados) }, null, 2));
  const s = resumirExperimento(resultados);
  console.log(`\n\nMensagens (mediana): menu ${s.menu.mensagens.mediana} × IA ${s.ia.mensagens.mediana} · Wilcoxon p = ${valorP(s.wilcoxonMensagens.p)}`);
  console.log(`Relatório: eval/resultados/experimento-${data}.md`);
}
