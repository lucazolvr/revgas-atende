import { readFileSync } from 'node:fs';
import { FORMAS_PAGAMENTO, type Produto } from '../vendas/catalogo.js';
import { formatarReais, produtoDo, totalCentavos, type Pedido } from '../vendas/pedido.js';
import type { ChaveAtributo } from '../canal/painel.js';
import { HORARIO_REVENDA } from './horario.js';

// Todos os textos que o cliente vê ficam aqui, para revisar o tom num lugar só.

export const SEGURANCA = readFileSync(new URL('../../config/seguranca.md', import.meta.url), 'utf8').trim();

export const BOAS_VINDAS = 'Olá! 👋 Sou o atendente virtual da revenda. Vou anotar seu pedido de gás rapidinho.';
export const PERGUNTA_NOME = 'Qual é o seu nome?';
export const PERGUNTA_QUANTIDADE = 'Quantas unidades? (de 1 a 20)';
export const PERGUNTA_ENDERECO: Record<string, string> = {
  logradouro: 'Qual a rua (ou avenida) para a entrega?',
  numero: 'Qual o número? (se não tiver, responda "s/n")',
  bairro: 'Qual o bairro?',
  cidade: 'Qual a cidade?',
  uf: 'Qual o estado? (a sigla, ex.: PI)',
};
export const PERGUNTA_CARTAO = 'No cartão de débito ou de crédito?';
export const PERGUNTA_TROCO = 'Vai precisar de troco? Responda o valor (ex.: 200) ou "não".';
export const MENU_CORRIGIR = 'O que você quer corrigir?\n1 - Nome\n2 - Produto e quantidade\n3 - Endereço\n4 - Pagamento';
export const CANCELADO = 'Tudo bem, pedido cancelado. Quando quiser, é só mandar uma mensagem. 🙂';
export const TRANSFERINDO = 'Um atendente vai falar com você agora. Só um instante. 🙋';
export const SO_TEXTO = 'Por enquanto só consigo ler mensagens de texto. Pode escrever, por favor? 🙏';
export const NAO_ENTENDI = 'Desculpe, não entendi. ';
export const DUVIDA_SEM_RESPOSTA =
  'Ainda não sei responder essa dúvida. Posso anotar seu pedido ou, se preferir, digite "atendente".';

export function menuProdutos(cat: Produto[]): string {
  return 'Qual produto?\n' + cat.map((p, i) => `${i + 1} - ${p.nome} (${formatarReais(p.precoCentavos)})`).join('\n');
}

export function menuPagamento(): string {
  return 'Qual a forma de pagamento?\n' + FORMAS_PAGAMENTO.map((f, i) => `${i + 1} - ${f.rotulo}`).join('\n');
}

export function trocoInvalido(totalCentavos: number): string {
  return `O troco precisa ser para um valor maior que o total (${formatarReais(totalCentavos)}). Para quanto?`;
}

function linhaEndereco(p: Pedido): string {
  const e = p.endereco ?? {};
  const base = `${e.logradouro ?? '?'}, ${e.numero ?? '?'} - ${e.bairro ?? '?'}, ${e.cidade ?? '?'}/${e.uf ?? '?'}`;
  return [base, e.complemento, e.referencia && `Ref.: ${e.referencia}`].filter(Boolean).join(' · ');
}

function rotuloPagamento(p: Pedido): string {
  const f = FORMAS_PAGAMENTO.find((x) => x.codigo === p.pagamento);
  if (!f) return '?';
  return p.pagamento === 'MONEY' && p.trocoParaCentavos ? `${f.rotulo} (troco para ${formatarReais(p.trocoParaCentavos)})` : f.rotulo;
}

export function resumo(p: Pedido, cat: Produto[]): string {
  const produto = produtoDo(p, cat)!;
  return [
    '*Confira seu pedido:*',
    `👤 ${p.nome}`,
    `🛢️ ${p.quantidade}x ${produto.nome} — ${formatarReais(produto.precoCentavos)} cada`,
    `💰 Total: *${formatarReais(totalCentavos(p, cat))}*`,
    `📍 ${linhaEndereco(p)}`,
    `💳 ${rotuloPagamento(p)}`,
    '',
    '1 - Confirmar\n2 - Corrigir\n3 - Cancelar',
  ].join('\n');
}

export function registrado(id: number): string {
  return `✅ Pedido registrado! Número *${id}*.\nJá vamos separar e sair para a entrega. Obrigado!`;
}

export function jaRegistrado(id: number): string {
  return `Seu pedido nº *${id}* já está registrado. 👍`;
}

/** Nota privada para o atendente no Chatwoot: o que já foi coletado. */
export function resumoParaAtendente(motivo: string, p: Pedido, cat: Produto[]): string {
  const produto = produtoDo(p, cat);
  return [
    `🤖 Transferido pelo bot — motivo: ${motivo}`,
    `Nome: ${p.nome ?? '—'}`,
    `Produto: ${produto ? `${p.quantidade ?? '?'}x ${produto.nome}` : '—'}`,
    `Endereço: ${p.endereco ? linhaEndereco(p) : '—'}`,
    `Pagamento: ${p.pagamento ? rotuloPagamento(p) : '—'}`,
  ].join('\n');
}

/** Dados do pedido para a lateral da conversa no Chatwoot. Só vai o que já foi coletado. */
export function atributosDoPedido(p: Pedido, cat: Produto[], vendaId?: number): Partial<Record<ChaveAtributo, string | number>> {
  const a: Partial<Record<ChaveAtributo, string | number>> = {};
  if (vendaId) a.numero_venda = vendaId;
  if (produtoDo(p, cat) && p.quantidade) a.total = formatarReais(totalCentavos(p, cat));
  if (p.pagamento) a.forma_pagamento = rotuloPagamento(p);
  if (p.endereco) a.endereco = linhaEndereco(p);
  if (p.quantidade) a.quantidade = p.quantidade;
  return a;
}

/**
 * Respostas prontas do painel: o atendente digita "/" + código (ex.: /saiu).
 * `npm run chatwoot:config` grava estes textos no Chatwoot.
 */
export const RESPOSTAS_PRONTAS: Record<string, string> = {
  saiu: 'Seu pedido saiu para entrega! 🛵',
  endereco: 'Pode me passar o endereço completo, com rua, número, bairro e ponto de referência?',
  seguranca: SEGURANCA,
  // Gerado de HORARIO_REVENDA, a mesma fonte do horário da caixa no Chatwoot.
  horario:
    `Nosso horário de atendimento e entrega é de segunda a sábado, das ${HORARIO_REVENDA.semana.abre}h às ${HORARIO_REVENDA.semana.fecha}h. ` +
    `Aos domingos e feriados, das ${HORARIO_REVENDA.domingo.abre}h às ${HORARIO_REVENDA.domingo.fecha}h. 🕗`,
  obrigado: 'Obrigado pela preferência! 😊 Se precisar de mais alguma coisa, é só chamar aqui.',
};
