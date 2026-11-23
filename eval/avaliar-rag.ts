/**
 * Avaliação do RAG híbrido (issue #27):  npm run eval:rag
 * Roda as perguntas rotuladas de eval/perguntas-faq.jsonl na busca só vetorial (como era antes) e
 * na híbrida (vetor + BM25 com fusão RRF, a do bot hoje), com os embeddings reais do Gemini.
 * Os dois modos usam OS MESMOS vetores (calculados uma vez e guardados): a diferença medida vem só
 * da forma de buscar. Só a busca é avaliada: nenhuma resposta é gerada.
 * Gera eval/resultados/rag-<data>.md (tabelas) e .json (resultado por pergunta).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BaseConhecimento, type GeradorEmbeddings, type OpcoesBusca, type ResultadoBusca } from '../src/conhecimento/base.js';
import type { TrechoConhecimento } from '../src/conhecimento/faq.js';
import { mcnemarExato } from './estatistica.js';

/** `esperado`: fontes que respondem a pergunta (qualquer uma vale). Vazio = fora da FAQ: o certo é não responder. */
export type PerguntaRotulada = { id: number; pergunta: string; esperado: string[] };

export type ResultadoPergunta = PerguntaRotulada & {
  /** Fontes devolvidas pela busca, na ordem (até 3, como no bot). */
  fontes: string[];
  trechos: { fonte: string; similaridade: number; bm25: number }[];
  /** Na FAQ: a fonte certa veio em 1º. Fora da FAQ: a busca voltou vazia. */
  acertou: boolean;
  acerto3: boolean;
};

export type Resumo = {
  naFaq: number;
  acerto1: number;
  acerto3: number;
  /** Perguntas da FAQ que ficaram sem nenhum trecho (o bot diria que não sabe). */
  semResposta: number;
  fora: number;
  recusaCorreta: number;
  /** Perguntas fora da FAQ que receberam trecho (o bot tentaria responder). */
  indevidas: number;
  /** Acerto geral: acerto@1 na FAQ + recusa correta fora dela. */
  acertos: number;
  total: number;
};

export function carregarPerguntas(caminho = 'eval/perguntas-faq.jsonl'): PerguntaRotulada[] {
  return readFileSync(caminho, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PerguntaRotulada);
}

/**
 * Guarda o vetor de cada texto: a FAQ e as perguntas são calculadas uma vez só e repetidas em
 * todos os modos e limiares. `aoChamar` conta as chamadas de verdade ao Gemini.
 */
export class EmbeddingsEmCache implements GeradorEmbeddings {
  private readonly cache = new Map<string, number[]>();
  chamadas = 0;

  constructor(private readonly base: GeradorEmbeddings) {}

  async gerar(textos: string[]): Promise<number[][]> {
    const faltam = [...new Set(textos.filter((t) => !this.cache.has(t)))];
    if (faltam.length) {
      this.chamadas++;
      const vetores = await this.base.gerar(faltam);
      if (vetores.length !== faltam.length) throw new Error(`o Gemini devolveu ${vetores.length} vetores para ${faltam.length} textos`);
      faltam.forEach((t, i) => this.cache.set(t, vetores[i]!));
    }
    return textos.map((t) => this.cache.get(t)!);
  }
}

const semResposta = { gerar: async () => null };

export async function avaliarModo(
  perguntas: PerguntaRotulada[],
  trechos: TrechoConhecimento[],
  embeddings: GeradorEmbeddings,
  opcoes: OpcoesBusca,
): Promise<ResultadoPergunta[]> {
  const base = new BaseConhecimento(trechos, embeddings, semResposta, opcoes);
  await base.inicializar();
  const resultados: ResultadoPergunta[] = [];
  for (const p of perguntas) {
    const achados: ResultadoBusca[] = await base.buscar(p.pergunta);
    const fontes = achados.map((a) => a.fonte);
    const naFaq = p.esperado.length > 0;
    resultados.push({
      ...p,
      fontes,
      trechos: achados.map(({ fonte, similaridade, bm25 }) => ({ fonte, similaridade, bm25 })),
      acertou: naFaq ? p.esperado.includes(fontes[0] ?? '') : fontes.length === 0,
      acerto3: naFaq ? fontes.some((f) => p.esperado.includes(f)) : fontes.length === 0,
    });
  }
  return resultados;
}

export function resumir(resultados: ResultadoPergunta[]): Resumo {
  const naFaq = resultados.filter((r) => r.esperado.length);
  const fora = resultados.filter((r) => !r.esperado.length);
  return {
    naFaq: naFaq.length,
    acerto1: naFaq.filter((r) => r.acertou).length,
    acerto3: naFaq.filter((r) => r.acerto3).length,
    semResposta: naFaq.filter((r) => !r.fontes.length).length,
    fora: fora.length,
    recusaCorreta: fora.filter((r) => r.acertou).length,
    indevidas: fora.filter((r) => !r.acertou).length,
    acertos: resultados.filter((r) => r.acertou).length,
    total: resultados.length,
  };
}

/** Perguntas em que os dois modos deram resultado diferente (acerto ou 1º trecho). */
export function discordancias(vetorial: ResultadoPergunta[], hibrido: ResultadoPergunta[]) {
  return vetorial
    .map((v, i) => ({ vetorial: v, hibrido: hibrido[i]! }))
    .filter(({ vetorial: v, hibrido: h }) => v.acertou !== h.acertou || (v.fontes[0] ?? '') !== (h.fontes[0] ?? ''));
}

export function compararModos(vetorial: ResultadoPergunta[], hibrido: ResultadoPergunta[]) {
  const soVetorial = vetorial.filter((v, i) => v.acertou && !hibrido[i]!.acertou).length;
  const soHibrido = hibrido.filter((h, i) => h.acertou && !vetorial[i]!.acertou).length;
  return { soVetorial, soHibrido, ...mcnemarExato(soVetorial, soHibrido) };
}

const num = (x: number, casas = 2) => x.toFixed(casas).replace('.', ',');
/** Variações de limiar, só para ver a sensibilidade (não para escolher com 27 perguntas). */
export const VARIACOES: { nome: string; opcoes: OpcoesBusca }[] = [
  ...[0.6, 0.65, 0.7].map((limiar) => ({ nome: `vetorial, cosseno ≥ ${num(limiar)}`, opcoes: { modo: 'vetorial' as const, limiar } })),
  ...[0.6, 0.65, 0.7].flatMap((limiar) =>
    [1.0, 1.5, 2.0].map((limiarBm25) => ({
      nome: `híbrido, cosseno ≥ ${num(limiar)} ou BM25 ≥ ${num(limiarBm25, 1)}`,
      opcoes: { modo: 'hibrido' as const, limiar, limiarBm25 },
    })),
  ),
];

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '—');
const curta = (fonte?: string) => (fonte ? fonte.replace(/^config\/(faq\/)?/, '').replace(/\.(md|json)$/, '') : '(nada)');
const celula = (r: ResultadoPergunta) =>
  r.trechos.length ? r.trechos.map((t) => `${curta(t.fonte)} (cos ${num(t.similaridade)}, bm25 ${num(t.bm25)})`).join('<br>') : '(nada: não responde)';

export type Avaliacao = {
  data: string;
  vetorial: ResultadoPergunta[];
  hibrido: ResultadoPergunta[];
  sensibilidade: { nome: string; resumo: Resumo }[];
  chamadasGemini: number;
};

export function relatorioMarkdown(a: Avaliacao): string {
  const v = resumir(a.vetorial);
  const h = resumir(a.hibrido);
  const c = compararModos(a.vetorial, a.hibrido);
  const linha = (nome: string, r: Resumo) =>
    `| ${nome} | ${r.acerto1}/${r.naFaq} (${pct(r.acerto1, r.naFaq)}) | ${r.acerto3}/${r.naFaq} (${pct(r.acerto3, r.naFaq)}) | ${r.semResposta} | ${r.recusaCorreta}/${r.fora} (${pct(r.recusaCorreta, r.fora)}) | ${r.indevidas} | ${r.acertos}/${r.total} (${pct(r.acertos, r.total)}) |`;
  const cabecalho = [
    '| Modo | Acerto@1 | Acerto@3 | FAQ sem resposta | Recusa correta | Respostas indevidas | Acerto geral |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  return [
    `# Avaliação do RAG híbrido (${a.data})`,
    '',
    `- **Conjunto:** ${v.total} perguntas escritas e rotuladas pela equipe antes de rodar os modos (\`eval/perguntas-faq.jsonl\`): ${v.naFaq} da FAQ e ${v.fora} fora dela.`,
    '- **Embeddings:** `gemini-embedding-001`, os mesmos vetores nos dois modos.',
    `- **Chamadas ao Gemini:** ${a.chamadasGemini} (só embeddings; nenhuma resposta gerada).`,
    '- **Limiares do bot:** cosseno ≥ 0,65; no híbrido, também BM25 ≥ 1,5. Até 3 trechos por pergunta.',
    '',
    '## Vetorial × híbrido',
    '',
    ...cabecalho,
    linha('Vetorial (antes)', v),
    linha('**Híbrido (bot hoje)**', h),
    '',
    `Acerto geral = acerto@1 na FAQ + recusa correta fora dela. Só o vetorial acertou: ${c.soVetorial} · só o híbrido acertou: ${c.soHibrido} · McNemar exato: p = ${num(c.p, 3)} (n = ${c.n} discordâncias).`,
    '',
    '## Perguntas em que os modos discordaram',
    '',
    '| # | Pergunta | Esperado | Vetorial | Híbrido |',
    '|---:|---|---|---|---|',
    ...discordancias(a.vetorial, a.hibrido).map(
      ({ vetorial: x, hibrido: y }) =>
        `| ${x.id} | ${x.pergunta} | ${x.esperado.map(curta).join(' ou ') || '(não responder)'} | ${x.acertou ? '✓' : '✗'} ${celula(x)} | ${y.acertou ? '✓' : '✗'} ${celula(y)} |`,
    ),
    '',
    '## Erros do híbrido',
    '',
    '| # | Pergunta | Esperado | Obtido |',
    '|---:|---|---|---|',
    ...a.hibrido.filter((r) => !r.acertou).map((r) => `| ${r.id} | ${r.pergunta} | ${r.esperado.map(curta).join(' ou ') || '(não responder)'} | ${celula(r)} |`),
    '',
    '## Sensibilidade aos limiares',
    '',
    'Só para ver se o resultado depende do limiar escolhido; com 27 perguntas, escolher o limiar por esta tabela seria ajustar ao próprio teste.',
    '',
    ...cabecalho,
    ...a.sensibilidade.map((s) => linha(s.nome, s.resumo)),
    '',
  ].join('\n');
}

/** Erros que passam com espera: cota por minuto (429), sobrecarga (503) e tempo esgotado. */
const TRANSITORIO = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand|aborted|timeout/i;

/** Tenta de novo em erro transitório; cota do dia esgotada para logo. */
class ComNovaTentativa implements GeradorEmbeddings {
  constructor(private readonly base: GeradorEmbeddings) {}

  async gerar(textos: string[]): Promise<number[][]> {
    for (let tentativa = 0; ; tentativa++) {
      try {
        return await this.base.gerar(textos);
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (/per ?day|PerDay/i.test(msg)) throw new Error('Cota diária grátis do Gemini esgotada. Rode de novo depois que ela zerar.');
        if (!TRANSITORIO.test(msg) || tentativa >= 3) throw e;
        await new Promise((r) => setTimeout(r, 15_000 * (tentativa + 1)));
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { GoogleGenAI } = await import('@google/genai');
  const { EmbeddingsGemini, trechoCatalogo } = await import('../src/conhecimento/gemini.js');
  const { carregarFaq } = await import('../src/conhecimento/faq.js');
  const { carregarCatalogo } = await import('../src/vendas/catalogo.js');
  try {
    process.loadEnvFile('.env');
  } catch {
    /* variáveis podem vir do ambiente */
  }
  const chave = process.env.GEMINI_API_KEY?.trim();
  if (!chave) throw new Error('Falta GEMINI_API_KEY no .env');

  const perguntas = carregarPerguntas();
  // Os mesmos trechos do bot (ConhecimentoGemini.criar): a FAQ e os preços do catálogo.
  const trechos = [...carregarFaq(), trechoCatalogo(carregarCatalogo())];
  const embeddings = new EmbeddingsEmCache(new ComNovaTentativa(new EmbeddingsGemini(new GoogleGenAI({ apiKey: chave }), 30_000)));
  console.log(`Avaliando ${perguntas.length} perguntas em ${trechos.length} trechos (vetorial × híbrido)...`);
  // Uma chamada para tudo: os vetores ficam guardados para todos os modos e limiares.
  await embeddings.gerar([...trechos.map((t) => t.texto), ...perguntas.map((p) => p.pergunta)]);

  const vetorial = await avaliarModo(perguntas, trechos, embeddings, { modo: 'vetorial' });
  const hibrido = await avaliarModo(perguntas, trechos, embeddings, { modo: 'hibrido' });
  const sensibilidade = [];
  for (const variacao of VARIACOES) {
    sensibilidade.push({ nome: variacao.nome, resumo: resumir(await avaliarModo(perguntas, trechos, embeddings, variacao.opcoes)) });
  }

  const data = new Date().toISOString().slice(0, 10);
  const avaliacao: Avaliacao = { data, vetorial, hibrido, sensibilidade, chamadasGemini: embeddings.chamadas };
  mkdirSync('eval/resultados', { recursive: true });
  writeFileSync(`eval/resultados/rag-${data}.md`, relatorioMarkdown(avaliacao));
  writeFileSync(
    `eval/resultados/rag-${data}.json`,
    JSON.stringify({ ...avaliacao, resumo: { vetorial: resumir(vetorial), hibrido: resumir(hibrido) }, comparacao: compararModos(vetorial, hibrido) }, null, 2),
  );
  for (const [nome, r] of [['Vetorial', resumir(vetorial)], ['Híbrido ', resumir(hibrido)]] as const) {
    console.log(`${nome}: acerto@1 ${pct(r.acerto1, r.naFaq)} · acerto@3 ${pct(r.acerto3, r.naFaq)} · recusa correta ${pct(r.recusaCorreta, r.fora)} · indevidas ${r.indevidas}`);
  }
  console.log(`Relatório: eval/resultados/rag-${data}.md (${embeddings.chamadas} chamada(s) ao Gemini)`);
}
