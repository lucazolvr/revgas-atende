import { readFileSync } from 'node:fs';
import { normalizar } from '../conversa/emergencia.js';
import type { Produto } from '../vendas/catalogo.js';
import { formatarReais } from '../vendas/pedido.js';

const DIRETORIO = new URL('../../config/faq/', import.meta.url);

/** Carrega o primeiro parágrafo útil de cada FAQ uma vez, removendo o título Markdown. */
const FAQ = Object.fromEntries(
  ['area-entrega', 'horario', 'pagamento', 'seguranca', 'troca-botijao'].map((arquivo) => {
    const markdown = readFileSync(new URL(`${arquivo}.md`, DIRETORIO), 'utf8');
    const paragrafo = markdown
      .replace(/^\s*#{1,3}[^\n]*\n+/u, '')
      .trim()
      .split(/\r?\n\s*\r?\n/u)[0]!
      .trim();
    return [arquivo, paragrafo];
  }),
) as Record<string, string>;

const REGRAS: [RegExp, string][] = [
  [/\b(preco|valor|quanto custa|quanto ta)\b/, 'preco'],
  [/\b(horario|abre|fecha|domingo|feriado)\b/, 'horario'],
  [/\b(entrega|bairro|regiao|atende onde|taxa)\b/, 'area-entrega'],
  [/\b(pix|cartao|dinheiro|pagamento|troco)\b/, 'pagamento'],
  [/\b(vazamento|seguranca|cheiro)\b/, 'seguranca'],
  [/\b(troca|vasilhame|casco)\b/, 'troca-botijao'],
];

/** Responde dúvidas conhecidas por palavra-chave sem chamar a IA. */
export function responderFaq(texto: string, cat: Produto[]): string | null {
  const pergunta = normalizar(texto);
  const regra = REGRAS.find(([palavras]) => palavras.test(pergunta));
  if (!regra) return null;
  if (regra[1] === 'preco') {
    return cat.map((produto) => `${produto.nome}: ${formatarReais(produto.precoCentavos)}.`).join('\n');
  }
  return FAQ[regra[1]] ?? null;
}
