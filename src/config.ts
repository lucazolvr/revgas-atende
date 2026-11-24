import { z } from 'zod';

/**
 * Só dígitos, sem o 9 extra do celular brasileiro: o WhatsApp identifica alguns números
 * como 55 DDD XXXXXXXX (12 dígitos) mesmo quando a pessoa usa 55 DDD 9XXXXXXXX (13).
 */
export function chaveTelefone(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  return d.length === 13 && d.startsWith('55') && d[4] === '9' ? d.slice(0, 4) + d.slice(5) : d;
}

/** Tamanho mínimo do PAINEL_TOKEN; menor que isso, o painel de pedidos fica desligado. */
export const TOKEN_PAINEL_MINIMO = 32;
export const tokenPainelValido = (t: string | undefined): t is string => !!t && t.trim().length >= TOKEN_PAINEL_MINIMO;

const vazioParaUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opcional = z.preprocess(vazioParaUndefined, z.string().trim().optional());
const inteiroOpcional = z.preprocess(vazioParaUndefined, z.coerce.number().int().positive().optional());
const inteiroPositivo = z.coerce.number().int().positive();

const esquema = z
  .object({
    PORTA: z.coerce.number().int().default(3000),
    CHATWOOT_URL: z.string().url(),
    CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
    CHATWOOT_BOT_TOKEN: z.string().min(1),
    BOT_WEBHOOK_TOKEN: z.string().min(32, 'BOT_WEBHOOK_TOKEN precisa de 32+ caracteres'),
    REDIS_URL: opcional,
    // Banco "revgas" (chamadas à API e eventos para o Metabase). Vazio = não grava.
    DATABASE_URL: opcional,
    GEMINI_API_KEY: opcional,
    // O Google aposenta modelos com frequência: troque aqui sem mexer no código.
    // Lista separada por vírgula = reservas: se o primeiro falhar (ex.: 503 de sobrecarga), tenta o próximo.
    GEMINI_MODELO: z.string().trim().min(1).default('gemini-3.1-flash-lite'),
    NUMEROS_IA: z
      .string()
      .default('')
      // "*" = IA para todos os números (cenário da demo); a lista vazia desliga a IA.
      .transform((s) => (s.trim() === '*' ? ['*'] : s.split(',').map(chaveTelefone).filter(Boolean))),
    // Métricas não têm conteúdo de conversa; ainda assim, retenção curta reduz exposição.
    METRICAS_RETENCAO_DIAS: inteiroPositivo.default(90),
    VENDA_REAL: z
      .string()
      .default('false')
      .transform((s) => s.trim().toLowerCase() === 'true'),
    REVGAS_API_URL: z.string().url().default('https://api.revgas.com/v1'),
    REVGAS_API_KEY: opcional,
    REVGAS_CLIENTE_DEMO: inteiroOpcional,
    REVGAS_ESTABELECIMENTO: inteiroOpcional,
    // Painel "Pedido RevGás" (aba na conversa e "Pedidos de hoje" no menu): sem token, não existe.
    // Curto demais vira "painel desligado" com aviso (ver carregarConfig): é recurso opcional e
    // não pode impedir o bot de atender o WhatsApp.
    PAINEL_TOKEN: z.preprocess(vazioParaUndefined, z.string().trim().transform((t) => (tokenPainelValido(t) ? t : undefined)).optional()),
    PAINEL_ORIGENS: z
      .string()
      .default('http://localhost:3000,http://127.0.0.1:3000')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(/^https?:\/\/[^\s/;,'"]+$/, 'PAINEL_ORIGENS: só origens como http://localhost:3000')).min(1)),
  })
  .superRefine((c, ctx) => {
    if (!c.VENDA_REAL) return;
    for (const k of ['REVGAS_API_KEY', 'REVGAS_CLIENTE_DEMO', 'REVGAS_ESTABELECIMENTO'] as const) {
      if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} é obrigatório com VENDA_REAL=true` });
    }
  });

export type Config = z.infer<typeof esquema> & {
  /** Problemas que não impedem o bot de subir (o index.ts mostra no log). */
  avisos: string[];
};

export function carregarConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    // Mostra só o nome da variável e o problema, nunca o valor.
    const erros = r.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${erros}`);
  }
  const avisos: string[] = [];
  if (env.PAINEL_TOKEN?.trim() && !r.data.PAINEL_TOKEN) {
    avisos.push(`PAINEL_TOKEN tem menos de ${TOKEN_PAINEL_MINIMO} caracteres: o painel de pedidos ficou desligado.`);
  }
  return { ...r.data, avisos };
}
