/**
 * Avaliação offline da interpretação por IA:  npm run eval:ia  [-- --limite 10]
 * Roda o Gemini em eval/mensagens.jsonl (rotuladas pela equipe) e gera
 * eval/resultados/ia-<data>.md (tabelas para o relatório) e .json (resultado por mensagem).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { INTENCOES, type Interpretacao, type Interpretador } from '../src/ia/interpretacao.js';
import { CAMPOS, compararEntidades, percentil, precisaoRevocacao, somar, type Campo } from './estatistica.js';

export type MensagemRotulada = { id: number; estado: string; texto: string; esperado: Interpretacao };
export type ResultadoMensagem = MensagemRotulada & { obtido: Interpretacao | null; acertouIntencao: boolean };

export function carregarMensagens(caminho = 'eval/mensagens.jsonl'): MensagemRotulada[] {
  return readFileSync(caminho, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as MensagemRotulada);
}

export async function avaliarIa(mensagens: MensagemRotulada[], ia: Interpretador, aoAvancar?: (i: number) => void) {
  const resultados: ResultadoMensagem[] = [];
  for (const [i, m] of mensagens.entries()) {
    const obtido = await ia.interpretar(m.texto, m.estado);
    resultados.push({ ...m, obtido, acertouIntencao: obtido?.intencao === m.esperado.intencao });
    aoAvancar?.(i + 1);
  }
  const porCampo = Object.fromEntries(
    CAMPOS.map((c) => [c, somar(resultados.map((r) => compararEntidades(r.esperado.entidades, r.obtido?.entidades)[c]))]),
  ) as Record<Campo, ReturnType<typeof somar>>;
  const porIntencao = Object.fromEntries(
    INTENCOES.map((intencao) => {
      const doTipo = resultados.filter((r) => r.esperado.intencao === intencao);
      return [intencao, { total: doTipo.length, acertos: doTipo.filter((r) => r.acertouIntencao).length }];
    }),
  );
  return {
    resultados,
    total: resultados.length,
    semResposta: resultados.filter((r) => !r.obtido).length,
    acuraciaIntencao: resultados.filter((r) => r.acertouIntencao).length / (resultados.length || 1),
    porIntencao,
    porCampo,
    geral: somar(Object.values(porCampo)),
  };
}

const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);

export function relatorioMarkdown(r: Awaited<ReturnType<typeof avaliarIa>>, meta: { modelo: string; data: string; latencias: number[]; indisponiveis: number }) {
  const linhas = [
    `# Avaliação da interpretação por IA (${meta.data})`,
    '',
    `- **Modelo:** \`${meta.modelo}\` (temperatura 0, saída estruturada em JSON)`,
    `- **Conjunto:** ${r.total} mensagens construídas e rotuladas pela equipe (\`eval/mensagens.jsonl\`)`,
    `- **Sem resposta válida:** ${r.semResposta} (das quais ${meta.indisponiveis} por indisponibilidade/cota da API, não por erro da IA)`,
    `- **Latência por mensagem:** mediana ${(percentil(meta.latencias, 0.5) / 1000).toFixed(2).replace('.', ',')} s · p95 ${(percentil(meta.latencias, 0.95) / 1000).toFixed(2).replace('.', ',')} s`,
    '',
    `## Intenção — acurácia ${pct(r.acuraciaIntencao)}`,
    '',
    '| Intenção | Mensagens | Acertos | Acurácia |',
    '|---|---:|---:|---:|',
    ...Object.entries(r.porIntencao)
      .filter(([, v]) => v.total)
      .map(([k, v]) => `| ${k} | ${v.total} | ${v.acertos} | ${pct(v.acertos / v.total)} |`),
    '',
    '## Entidades',
    '',
    'VP = extraiu o valor certo · FP = extraiu algo indevido ou errado · FN = deixou de extrair (valor errado conta como FP e FN).',
    '',
    '| Campo | Suporte | VP | FP | FN | Precisão | Revocação | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...CAMPOS.filter((c) => r.porCampo[c].vp + r.porCampo[c].fn + r.porCampo[c].fp).map((c) => {
      const k = r.porCampo[c];
      const m = precisaoRevocacao(k);
      return `| ${c} | ${m.suporte} | ${k.vp} | ${k.fp} | ${k.fn} | ${pct(m.precisao)} | ${pct(m.revocacao)} | ${pct(m.f1)} |`;
    }),
    (() => {
      const m = precisaoRevocacao(r.geral);
      return `| **micro (todos)** | **${m.suporte}** | ${r.geral.vp} | ${r.geral.fp} | ${r.geral.fn} | **${pct(m.precisao)}** | **${pct(m.revocacao)}** | **${pct(m.f1)}** |`;
    })(),
    '',
    '## Erros (para análise qualitativa)',
    '',
    '| # | Etapa | Mensagem | Esperado | Obtido |',
    '|---:|---|---|---|---|',
    ...r.resultados
      .filter((x) => {
        const c = compararEntidades(x.esperado.entidades, x.obtido?.entidades);
        return !x.acertouIntencao || Object.values(c).some((k) => k.fp || k.fn);
      })
      .map((x) => `| ${x.id} | ${x.estado} | ${x.texto.replaceAll('|', '\\|')} | \`${JSON.stringify(x.esperado)}\` | \`${JSON.stringify(x.obtido)}\` |`),
    '',
    '> Limitação: as mensagens foram escritas pela equipe imitando clientes reais (gírias, abreviações, erros de digitação); não são conversas reais. O conjunto pode ser ampliado com mensagens do teste com usuários.',
  ];
  return linhas.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { IaAvaliada } = await import('./ia-real.js');
  const i = process.argv.indexOf('--limite');
  const mensagens = carregarMensagens().slice(0, i > 0 ? Number(process.argv[i + 1]) : undefined);
  const ia = new IaAvaliada();
  console.log(`Avaliando ${mensagens.length} mensagens com ${ia.modelo} (respeitando a cota grátis, ~5 s por mensagem)...`);
  const r = await avaliarIa(mensagens, ia, (n) => process.stdout.write(`\r${n}/${mensagens.length}`));
  const data = new Date().toISOString().slice(0, 10);
  mkdirSync('eval/resultados', { recursive: true });
  const md = relatorioMarkdown(r, { modelo: ia.modelo, data, latencias: ia.latencias, indisponiveis: ia.indisponiveis });
  writeFileSync(`eval/resultados/ia-${data}.md`, md);
  writeFileSync(`eval/resultados/ia-${data}.json`, JSON.stringify({ modelo: ia.modelo, data, latencias: ia.latencias, ...r }, null, 2));
  console.log(`\n\nIntenção: ${pct(r.acuraciaIntencao)} · Entidades F1 (micro): ${pct(precisaoRevocacao(r.geral).f1)}`);
  console.log(`Relatório: eval/resultados/ia-${data}.md`);
}
