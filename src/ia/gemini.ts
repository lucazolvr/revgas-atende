import { GoogleGenAI } from '@google/genai';
import type { Produto } from '../vendas/catalogo.js';
import { INTENCOES, validarInterpretacao, type Interpretacao, type Interpretador } from './interpretacao.js';

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
endereco.uf: sigla do estado (ex.: PI). Não preencha cidade/UF se o cliente não disse.`;
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

  async interpretar(texto: string, estado: string): Promise<Interpretacao | null> {
    try {
      const r = await this.ai.models.generateContent({
        model: this.modelo,
        contents: `Etapa atual do pedido: ${estado}\nMensagem do cliente: ${texto}`,
        config: {
          systemInstruction: instrucoes(this.cat),
          responseMimeType: 'application/json',
          responseJsonSchema: esquema(this.cat),
          temperature: 0,
          abortSignal: AbortSignal.timeout(this.timeoutMs),
        },
      });
      return validarInterpretacao(JSON.parse(r.text ?? ''), this.cat);
    } catch {
      return null; // sem IA o fluxo segue pelos menus
    }
  }
}
