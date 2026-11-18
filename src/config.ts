import { z } from 'zod';

/**
 * Só dígitos, sem o 9 extra do celular brasileiro: o WhatsApp identifica alguns números
 * como 55 DDD XXXXXXXX (12 dígitos) mesmo quando a pessoa usa 55 DDD 9XXXXXXXX (13).
 */
export function chaveTelefone(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  return d.length === 13 && d.startsWith('55') && d[4] === '9' ? d.slice(0, 4) + d.slice(5) : d;
}

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
    GEMINI_API_KEY: opcional,
    // O Google aposenta modelos com frequência: troque aqui sem mexer no código.
    GEMINI_MODELO: z.string().trim().min(1).default('gemini-3.1-flash-lite'),
    NUMEROS_IA: z
      .string()
      .default('')
      .transform((s) => s.split(',').map(chaveTelefone).filter(Boolean)),
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
  })
  .superRefine((c, ctx) => {
    if (!c.VENDA_REAL) return;
    for (const k of ['REVGAS_API_KEY', 'REVGAS_CLIENTE_DEMO', 'REVGAS_ESTABELECIMENTO'] as const) {
      if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} é obrigatório com VENDA_REAL=true` });
    }
  });

export type Config = z.infer<typeof esquema>;

export function carregarConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    // Mostra só o nome da variável e o problema, nunca o valor.
    const erros = r.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${erros}`);
  }
  return r.data;
}
