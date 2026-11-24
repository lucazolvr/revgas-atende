import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import type { Produto } from '../vendas/catalogo.js';
import { INTENCOES, validarInterpretacao, type Interpretacao, type Interpretador } from './interpretacao.js';

/**
 * `modelos` = "a, b, c": tenta `a`; se a chamada falhar (503 de sobrecarga, cota, modelo aposentado,
 * tempo esgotado), tenta `b`, depois `c`. Cada tentativa tem o próprio tempo limite.
 * "openai:<modelo>" vai para a OpenAI (OPENAI_API_KEY): reserva fora do Google, se ele cair inteiro.
 */
export async function gerarComReserva(
  ai: Pick<GoogleGenAI, 'models'>,
  modelos: string,
  timeoutMs: number,
  params: Omit<GenerateContentParameters, 'model'>,
  doFetch: typeof fetch = fetch,
): Promise<Pick<GenerateContentResponse, 'text'>> {
  let erro: unknown = new Error('nenhum modelo configurado');
  for (const model of modelos.split(',').map((m) => m.trim()).filter(Boolean)) {
    try {
      if (model.startsWith('openai:')) return await gerarOpenAi(model.slice(7), timeoutMs, params, doFetch);
      return await ai.models.generateContent({ ...params, model, config: { ...params.config, abortSignal: AbortSignal.timeout(timeoutMs) } });
    } catch (e) {
      erro = e;
    }
  }
  throw erro;
}

/** Mesma chamada (instrução, mensagem e esquema JSON) na API de chat da OpenAI, sem biblioteca. */
async function gerarOpenAi(
  model: string,
  timeoutMs: number,
  params: Omit<GenerateContentParameters, 'model'>,
  doFetch: typeof fetch,
): Promise<{ text: string | undefined }> {
  const chave = process.env.OPENAI_API_KEY; // shortcut: lida direto do ambiente, não do config.ts; mover para lá se a OpenAI virar principal
  if (!chave) throw new Error('OPENAI_API_KEY não definida');
  const r = await doFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: String(params.config?.systemInstruction ?? '') },
        { role: 'user', content: String(params.contents) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'resposta', schema: params.config?.responseJsonSchema, strict: false } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const corpo = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: corpo.choices?.[0]?.message?.content };
}

function instrucoes(cat: Produto[]): string {
  const produtos = cat.map((p) => `- ${p.codigo}: ${p.nome}`).join('\n');
  return `Você interpreta mensagens de clientes de uma revenda de gás de cozinha no WhatsApp (Brasil).
Responda só com o JSON pedido. Nunca invente dados: inclua uma entidade só se o cliente a disse.

Intenções:
- fazer_pedido: quer comprar gás.
- informar_dados: está respondendo dados do pedido (nome, endereço, quantidade, pagamento).
- duvida: pergunta sobre preço, horário, entrega, produtos.
- falar_com_humano: pede atendente/pessoa.
- emergencia_gas: cheiro de gás, vazamento, botijão chiando ou pegando fogo.
- confirmar / corrigir / cancelar: sobre o resumo do pedido.
- saudacao: só cumprimento. outro: nada acima.

Produtos (use o código):
${produtos}
"botijão", "gás", "bujão" sem tamanho = P13.

Pagamento: PIX, MONEY (dinheiro), CARTAO_DE_DEBITO, CARTAO_DE_CREDITO ("cartão" sem tipo: não preencha).
trocoParaCentavos: "troco pra 200" = 20000.
endereco.uf: sigla do estado (ex.: PI). Não preencha cidade/UF se o cliente não disse.
Se a etapa indicar "pergunta atual: <campo>", uma resposta curta (só um nome ou número) é o valor desse campo do endereço.`;
}

function esquema(cat: Produto[]) {
  const s = (descricao?: string) => ({ type: 'string', ...(descricao && { description: descricao }) });
  return {
    type: 'object',
    properties: {
      intencao: { type: 'string', enum: [...INTENCOES] },
      entidades: {
        type: 'object',
        properties: {
          nome: s('nome da pessoa'),
          produto: { type: 'string', enum: cat.map((p) => p.codigo) },
          quantidade: { type: 'integer' },
          pagamento: { type: 'string', enum: ['PIX', 'MONEY', 'CARTAO_DE_DEBITO', 'CARTAO_DE_CREDITO'] },
          trocoParaCentavos: { type: 'integer' },
          endereco: {
            type: 'object',
            properties: {
              logradouro: s('rua/avenida, sem número'),
              numero: s(),
              bairro: s(),
              cidade: s(),
              uf: s('sigla'),
              complemento: s(),
              referencia: s('ponto de referência'),
            },
          },
        },
      },
    },
    required: ['intencao', 'entidades'],
  };
}

export class InterpretadorGemini implements Interpretador {
  private readonly ai: GoogleGenAI;
  private readonly modelo: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    private readonly cat: Produto[],
    opts: { modelo?: string; timeoutMs?: number } = {},
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelo = opts.modelo ?? 'gemini-3.1-flash-lite';
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  /** Motivo do último `null` (só para a avaliação distinguir cota/instabilidade de erro da IA). */
  ultimoErro: string | null = null;

  async interpretar(texto: string, estado: string): Promise<Interpretacao | null> {
    this.ultimoErro = null;
    try {
      const r = await gerarComReserva(this.ai, this.modelo, this.timeoutMs, {
        contents: `Etapa atual do pedido: ${estado}\nMensagem do cliente: ${texto}`,
        config: {
          systemInstruction: instrucoes(this.cat),
          responseMimeType: 'application/json',
          responseJsonSchema: esquema(this.cat),
          temperature: 0,
        },
      });
      const valida = validarInterpretacao(JSON.parse(r.text ?? ''), this.cat);
      if (!valida) this.ultimoErro = 'resposta fora do esquema';
      return valida;
    } catch (e) {
      this.ultimoErro = e instanceof Error ? e.message.slice(0, 200) : 'erro desconhecido';
      return null; // sem IA o fluxo segue pelos menus
    }
  }
}
