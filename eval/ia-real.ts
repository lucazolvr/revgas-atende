import { InterpretadorGemini } from '../src/ia/gemini.js';
import type { Interpretacao, Interpretador } from '../src/ia/interpretacao.js';
import { carregarCatalogo } from '../src/vendas/catalogo.js';

/** Erros que não são culpa da IA: cota (429), sobrecarga (503) e tempo esgotado. */
const TRANSITORIO = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand|aborted|timeout/i;

/**
 * Interpretador para a avaliação: respeita a cota grátis (intervalo entre chamadas), tenta de
 * novo em erro transitório e mede a latência. Erro transitório persistente vira `indisponivel`,
 * que o relatório separa de "a IA errou".
 */
export class IaAvaliada implements Interpretador {
  readonly modelo: string;
  private readonly ia: InterpretadorGemini;
  private ultima = 0;
  latencias: number[] = [];
  indisponiveis = 0;

  constructor(private readonly intervaloMs = 4500) {
    try {
      process.loadEnvFile('.env');
    } catch {
      /* variáveis podem vir do ambiente */
    }
    const chave = process.env.GEMINI_API_KEY?.trim();
    if (!chave) throw new Error('Falta GEMINI_API_KEY no .env');
    this.modelo = process.env.GEMINI_MODELO?.trim() || 'gemini-3.1-flash-lite';
    this.ia = new InterpretadorGemini(chave, carregarCatalogo(), { modelo: this.modelo, timeoutMs: 15000 });
  }

  async interpretar(texto: string, estado: string): Promise<Interpretacao | null> {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const espera = this.ultima + this.intervaloMs * (tentativa ? 3 * tentativa : 1) - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      this.ultima = Date.now();
      const r = await this.ia.interpretar(texto, estado);
      // Cota do dia esgotada não volta com espera: para logo em vez de esperar horas em silêncio.
      if (this.ia.ultimoErro && /free_tier_requests|per ?day|PerDay/i.test(this.ia.ultimoErro)) {
        throw new Error(`Cota diária grátis do Gemini esgotada (${this.modelo}). Rode de novo depois que ela zerar (meia-noite do Pacífico).`);
      }
      if (r || !this.ia.ultimoErro || !TRANSITORIO.test(this.ia.ultimoErro)) {
        this.latencias.push(Date.now() - this.ultima);
        return r;
      }
    }
    this.indisponiveis++;
    return null;
  }
}
