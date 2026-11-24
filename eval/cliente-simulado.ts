import { novaSessao, processar, type Acao, type Sessao } from '../src/conversa/motor.js';
import type { Interpretador } from '../src/ia/interpretacao.js';
import { FORMAS_PAGAMENTO, type FormaPagamento, type Produto } from '../src/vendas/catalogo.js';
import { CAMPOS_ENDERECO, type Endereco, type Pedido } from '../src/vendas/pedido.js';
import { achatar } from './estatistica.js';

/** Um cliente com um pedido em mente. `primeiraMensagem` é como ele escreveria livremente. */
export type Perfil = {
  id: number;
  nome: string;
  quantidade: number;
  endereco: Endereco;
  pagamento: FormaPagamento;
  /** Troco em centavos (só com MONEY); ausente = não precisa. */
  trocoPara?: number;
  primeiraMensagem: string;
};

export type Modo = 'menu' | 'ia';

export type ResultadoSimulacao = {
  perfil: number;
  modo: Modo;
  concluiu: boolean;
  correto: boolean;
  mensagens: number;
  caracteres: number;
  correcoes: number;
  msBot: number;
  transferencia?: string;
};

export const LIMITE_MENSAGENS = 25;

const PALAVRA_PAGAMENTO: Record<FormaPagamento, string> = {
  PIX: 'pix',
  MONEY: 'dinheiro',
  CARTAO_DE_DEBITO: 'débito',
  CARTAO_DE_CREDITO: 'crédito',
};

/** Primeiro grupo do menu "corrigir" (1 nome · 2 produto/qtd · 3 endereço · 4 pagamento) que diverge. */
export function divergencia(p: Pedido, perfil: Perfil): 1 | 2 | 3 | 4 | null {
  const a = achatar({ nome: p.nome, endereco: p.endereco });
  const b = achatar({ nome: perfil.nome, endereco: perfil.endereco });
  if (a.nome !== b.nome) return 1;
  if (p.produto !== 'P13' || p.quantidade !== perfil.quantidade) return 2;
  if (CAMPOS_ENDERECO.some((c) => a[`endereco.${c}`] !== b[`endereco.${c}`])) return 3;
  if (p.pagamento !== perfil.pagamento || (p.trocoParaCentavos || 0) !== (perfil.trocoPara ?? 0)) return 4;
  return null;
}

/** O que o cliente responde à pergunta da etapa atual (no menu, os números; com IA, palavras). */
export function responder(s: Sessao, perfil: Perfil, modo: Modo): string {
  const ia = modo === 'ia';
  switch (s.estado) {
    case 'NOME':
      return ia ? `meu nome é ${perfil.nome}` : perfil.nome;
    case 'PRODUTO':
      return ia ? 'botijão de 13kg' : '1';
    case 'QUANTIDADE':
      return String(perfil.quantidade);
    case 'ENDERECO':
      return perfil.endereco[CAMPOS_ENDERECO.find((c) => !s.pedido.endereco?.[c])!];
    case 'PAGAMENTO':
      return ia ? PALAVRA_PAGAMENTO[perfil.pagamento] : String(FORMAS_PAGAMENTO.findIndex((f) => f.codigo === perfil.pagamento) + 1);
    case 'TROCO':
      if (!perfil.trocoPara) return 'não';
      return ia ? `troco pra ${perfil.trocoPara / 100}` : String(perfil.trocoPara / 100);
    case 'RESUMO': {
      const d = divergencia(s.pedido, perfil);
      if (d === null) return ia ? 'pode confirmar' : '1';
      return ia ? 'quero corrigir' : '2';
    }
    case 'CORRIGIR':
      return String(divergencia(s.pedido, perfil) ?? 1);
    case 'MENU':
      return '1'; // menu principal (v2): "1 - Fazer pedido"
    default:
      return ia ? perfil.primeiraMensagem : 'oi';
  }
}

/**
 * Conversa completa entre o cliente simulado e o motor real do bot (sem Chatwoot e sem ERP).
 * Só a latência do bot é medida: o tempo que uma pessoa leva digitando não é simulado.
 */
export async function simular(
  perfil: Perfil,
  modo: Modo,
  deps: { catalogo: Produto[]; interpretador: Interpretador | null },
): Promise<ResultadoSimulacao> {
  let s = novaSessao(`55009${String(perfil.id).padStart(8, '0')}`);
  let registrado: Pedido | undefined;
  const r: ResultadoSimulacao = { perfil: perfil.id, modo, concluiu: false, correto: false, mensagens: 0, caracteres: 0, correcoes: 0, msBot: 0 };
  let texto = modo === 'ia' ? perfil.primeiraMensagem : 'oi';
  while (r.mensagens < LIMITE_MENSAGENS) {
    r.mensagens++;
    r.caracteres += texto.length;
    if (s.estado === 'RESUMO' && /^(2|quero corrigir)$/.test(texto)) r.correcoes++;
    const t0 = performance.now();
    const saida = await processar(s, texto, {
      catalogo: deps.catalogo,
      interpretador: modo === 'ia' ? deps.interpretador : null,
      registrar: async (p) => {
        registrado = structuredClone(p);
        return { tipo: 'ok', id: 1 };
      },
    });
    r.msBot += performance.now() - t0;
    s = saida.sessao;
    const transferiu = saida.acoes.find((a): a is Extract<Acao, { tipo: 'transferir' }> => a.tipo === 'transferir');
    if (transferiu) {
      r.transferencia = transferiu.motivo;
      return r;
    }
    if (s.estado === 'REGISTRADO' && registrado) {
      r.concluiu = true;
      r.correto = divergencia(registrado, perfil) === null;
      return r;
    }
    texto = responder(s, perfil, modo);
  }
  return r;
}
