import { normalizar } from '../src/conversa/emergencia.js';
import type { Entidades } from '../src/ia/interpretacao.js';

/** Campos avaliados, com o endereço "achatado" (endereco.bairro etc.). */
export const CAMPOS = [
  'nome', 'produto', 'quantidade', 'pagamento', 'trocoParaCentavos',
  'endereco.logradouro', 'endereco.numero', 'endereco.bairro', 'endereco.cidade', 'endereco.uf',
  'endereco.complemento', 'endereco.referencia',
] as const;
export type Campo = (typeof CAMPOS)[number];

export type Contagem = { vp: number; fp: number; fn: number };

/** Compara sem diferenciar maiúsculas, acentos e pontuação ("Av. Frei Serafim" = "av frei serafim"). */
const ABREVIACOES: [RegExp, string][] = [
  [/^av\b/, 'avenida'],
  [/^r\b/, 'rua'],
  [/\bapto?\b/g, 'apartamento'],
  [/\bqd\b/g, 'quadra'],
];

function igualar(v: unknown): string {
  let t = normalizar(String(v)).replace(/[.,;:!?/-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, por] of ABREVIACOES) t = t.replace(re, por);
  return t;
}

export function achatar(e: Entidades | undefined): Partial<Record<Campo, string>> {
  const saida: Partial<Record<Campo, string>> = {};
  if (!e) return saida;
  for (const campo of CAMPOS) {
    const [a, b] = campo.split('.') as [keyof Entidades, string?];
    const valor = b ? (e[a] as Record<string, unknown> | undefined)?.[b] : e[a];
    if (valor !== undefined && valor !== null && valor !== '') saida[campo] = igualar(valor);
  }
  return saida;
}

/**
 * Por campo: VP = extraiu o valor certo; FP = extraiu algo que não devia (ou valor errado);
 * FN = não extraiu o que devia (ou valor errado). Valor errado conta como FP e FN, como é usual.
 */
export function compararEntidades(esperado: Entidades | undefined, obtido: Entidades | undefined): Record<Campo, Contagem> {
  const e = achatar(esperado);
  const o = achatar(obtido);
  const r = {} as Record<Campo, Contagem>;
  for (const campo of CAMPOS) {
    const c = { vp: 0, fp: 0, fn: 0 };
    if (e[campo] !== undefined && o[campo] === e[campo]) c.vp = 1;
    else {
      if (o[campo] !== undefined) c.fp = 1;
      if (e[campo] !== undefined) c.fn = 1;
    }
    r[campo] = c;
  }
  return r;
}

export function somar(contagens: Contagem[]): Contagem {
  return contagens.reduce((a, c) => ({ vp: a.vp + c.vp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { vp: 0, fp: 0, fn: 0 });
}

export function precisaoRevocacao(c: Contagem) {
  const precisao = c.vp + c.fp ? c.vp / (c.vp + c.fp) : NaN;
  const revocacao = c.vp + c.fn ? c.vp / (c.vp + c.fn) : NaN;
  const f1 = precisao + revocacao ? (2 * precisao * revocacao) / (precisao + revocacao) : NaN;
  return { precisao, revocacao, f1, suporte: c.vp + c.fn };
}

export function percentil(valores: number[], p: number): number {
  if (!valores.length) return NaN;
  const ordenados = [...valores].sort((a, b) => a - b);
  const i = (ordenados.length - 1) * p;
  const baixo = Math.floor(i);
  return ordenados[baixo]! + (ordenados[Math.ceil(i)]! - ordenados[baixo]!) * (i - baixo);
}

export const mediana = (v: number[]) => percentil(v, 0.5);
export const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

// Abramowitz & Stegun 7.1.26 (erro < 1,5e-7): suficiente para um valor-p.
function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const cdfNormal = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Teste de postos sinalizados de Wilcoxon (pareado, bicaudal), aproximação normal com
 * correção de continuidade e de empates; diferenças zero são descartadas (Wilcoxon, 1945).
 * Mesmo resultado que scipy.stats.wilcoxon(a, b, correction=True, method="approx").
 */
export function wilcoxonPareado(a: number[], b: number[]) {
  if (a.length !== b.length) throw new Error('amostras pareadas precisam ter o mesmo tamanho');
  const difs = a.map((x, i) => x - b[i]!).filter((d) => d !== 0);
  const n = difs.length;
  if (n === 0) return { n, wMais: 0, wMenos: 0, z: 0, p: 1 };
  const ordem = difs.map((d, i) => ({ abs: Math.abs(d), i })).sort((x, y) => x.abs - y.abs);
  const postos = new Array<number>(n);
  let correcaoEmpates = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && ordem[j + 1]!.abs === ordem[i]!.abs) j++;
    const posto = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) postos[ordem[k]!.i] = posto;
    const t = j - i + 1;
    correcaoEmpates += t ** 3 - t;
    i = j + 1;
  }
  const wMais = difs.reduce((s, d, i) => s + (d > 0 ? postos[i]! : 0), 0);
  const wMenos = difs.reduce((s, d, i) => s + (d < 0 ? postos[i]! : 0), 0);
  const w = Math.min(wMais, wMenos);
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - correcaoEmpates / 48);
  const z = sigma ? (Math.abs(w - mu) - 0.5) / sigma : 0;
  return { n, wMais, wMenos, z, p: Math.min(1, 2 * (1 - cdfNormal(z))) };
}
