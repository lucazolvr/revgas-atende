import { z } from 'zod';
import type { FormaPagamento, Produto } from '../vendas/catalogo.js';
import type { Endereco } from '../vendas/pedido.js';

export const INTENCOES = [
  'fazer_pedido',
  'informar_dados',
  'duvida',
  'falar_com_humano',
  'emergencia_gas',
  'confirmar',
  'corrigir',
  'cancelar',
  'saudacao',
  'outro',
] as const;
export type Intencao = (typeof INTENCOES)[number];

export type Entidades = {
  nome?: string;
  produto?: string;
  quantidade?: number;
  endereco?: Partial<Endereco>;
  pagamento?: FormaPagamento;
  trocoParaCentavos?: number;
};
export type Interpretacao = { intencao: Intencao; entidades: Entidades };

export interface Interpretador {
  /** `null` quando não deu para interpretar (erro, timeout, resposta inválida). */
  interpretar(texto: string, estado: string): Promise<Interpretacao | null>;
}

const texto = (max: number) => z.string().trim().min(1).max(max);
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

/** Cada campo é validado sozinho: um campo ruim é descartado sem perder os outros. */
function campos(cat: Produto[]) {
  return {
    nome: texto(80),
    produto: z.enum(cat.map((p) => p.codigo) as [string, ...string[]]),
    quantidade: z.number().int().min(1).max(20),
    pagamento: z.enum(['PIX', 'MONEY', 'CARTAO_DE_DEBITO', 'CARTAO_DE_CREDITO']),
    trocoParaCentavos: z.number().int().min(1).max(100_000),
  };
}
const camposEndereco = {
  logradouro: texto(120),
  numero: texto(20),
  bairro: texto(80),
  cidade: texto(80),
  uf: z.string().trim().toUpperCase().refine((u) => UFS.includes(u)),
  complemento: texto(120),
  referencia: texto(120),
};

function filtrar(bruto: unknown, esquemas: Record<string, z.ZodType>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  if (!bruto || typeof bruto !== 'object') return saida;
  for (const [chave, esquema] of Object.entries(esquemas)) {
    const v = (bruto as Record<string, unknown>)[chave];
    if (v === undefined || v === null || v === '') continue;
    const r = esquema.safeParse(v);
    if (r.success) saida[chave] = r.data;
  }
  return saida;
}

export function validarInterpretacao(bruto: unknown, cat: Produto[]): Interpretacao | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const { intencao, entidades } = bruto as { intencao?: unknown; entidades?: Record<string, unknown> };
  if (!INTENCOES.includes(intencao as Intencao)) return null;
  const e = filtrar(entidades, campos(cat)) as Entidades;
  const endereco = filtrar(entidades?.endereco, camposEndereco);
  if (Object.keys(endereco).length) e.endereco = endereco;
  return { intencao: intencao as Intencao, entidades: e };
}

/** Respostas fixas por texto: para testes e para rodar sem chave do Gemini. */
export class InterpretadorFalso implements Interpretador {
  constructor(private readonly respostas: Record<string, Interpretacao>) {}
  async interpretar(texto: string): Promise<Interpretacao | null> {
    return this.respostas[texto] ?? null;
  }
}
