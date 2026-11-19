import { readdirSync, readFileSync } from 'node:fs';

export type TrechoConhecimento = { fonte: string; texto: string };

/** Carrega cada seção Markdown como um trecho independente para a busca vetorial. */
export function carregarFaq(diretorio = new URL('../../config/faq/', import.meta.url)): TrechoConhecimento[] {
  return readdirSync(diretorio, { withFileTypes: true })
    .filter((arquivo) => arquivo.isFile() && arquivo.name.endsWith('.md'))
    .flatMap((arquivo) => separarMarkdown(readFileSync(new URL(arquivo.name, diretorio), 'utf8'), `config/faq/${arquivo.name}`));
}

export function separarMarkdown(markdown: string, fonte: string): TrechoConhecimento[] {
  const secoes = markdown.trim().split(/(?=^#{1,3}\s)/m);
  return secoes
    .map((texto) => texto.trim())
    .filter(Boolean)
    .map((texto) => ({ fonte, texto }));
}
