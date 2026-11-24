import { chaveTelefone } from '../config.js';
import type { FormaPagamento, Produto } from './catalogo.js';

export type Endereco = {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  complemento?: string;
  referencia?: string;
};

export type Pedido = {
  telefone: string;
  nome?: string;
  produto?: string;
  quantidade?: number;
  endereco?: Partial<Endereco>;
  pagamento?: FormaPagamento;
  trocoParaCentavos?: number;
};

export type CorpoVenda = {
  customer_id: number;
  establishment_id: number;
  location: string;
  number: string;
  neighborhood: string;
  city: string;
  state_federation: string;
  // A API recusa texto vazio (precisa de 1 a 255 caracteres): sem valor, o campo não vai.
  complement?: string;
  landmark?: string;
  observation: string;
  products: { product_id: number; quantity: number; value: number }[];
  payments: { payment_type: FormaPagamento; value: number }[];
  channel: 'WHATSAPP';
  origin: 'INTEGRATION';
  option: 'NORMAL';
  broadcast: 'NONE';
};

/** Fuso da revenda (Teresina, UTC−3): "hoje" é o dia de lá, não o do servidor. */
const FUSO_REVENDA = 'America/Fortaleza';

/** Dia (AAAA-MM-DD) de um instante no fuso da revenda. */
export function diaDaRevenda(quando: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_REVENDA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(quando);
}

export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export const CAMPOS_ENDERECO = ['logradouro', 'numero', 'bairro', 'cidade', 'uf'] as const;

export function formatarReais(centavos: number): string {
  return 'R$ ' + (centavos / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function produtoDo(p: Pedido, cat: Produto[]): Produto | undefined {
  return cat.find((x) => x.codigo === p.produto);
}

export function totalCentavos(p: Pedido, cat: Produto[]): number {
  const produto = produtoDo(p, cat);
  if (!produto || !p.quantidade) throw new Error('pedido sem produto ou quantidade');
  return produto.precoCentavos * p.quantidade;
}

/** Venda como a API devolve na listagem (só o que serve para reconhecer o cliente). */
export type VendaListada = {
  establishment_id?: number;
  observation?: string | null;
  location?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state_federation?: string;
};

/**
 * Nome e endereço do cliente numa venda criada pelo bot. O nome e o telefone estão na observação
 * (ver corpoDaVenda). `null` = a venda não é desse telefone.
 */
export function clienteDaVenda(v: VendaListada, telefone: string): Pick<Pedido, 'nome' | 'endereco'> | null {
  const m = v.observation?.match(/Cliente: (.+?) \+?(\d{10,13})\./);
  if (!m || chaveTelefone(m[2]!) !== chaveTelefone(telefone)) return null;
  const endereco = { logradouro: v.location, numero: v.number, bairro: v.neighborhood, cidade: v.city, uf: v.state_federation };
  return { nome: m[1]!.trim(), ...(CAMPOS_ENDERECO.every((c) => endereco[c]?.trim()) && { endereco: endereco as Endereco }) };
}

export function corpoDaVenda(
  p: Pedido,
  cat: Produto[],
  ids: { clienteId: number; estabelecimentoId: number; conversaId?: number },
): CorpoVenda {
  const produto = produtoDo(p, cat);
  const e = p.endereco ?? {};
  if (!produto || !p.quantidade || !p.pagamento || !p.nome || CAMPOS_ENDERECO.some((c) => !e[c])) {
    throw new Error('pedido incompleto');
  }
  const total = produto.precoCentavos * p.quantidade;
  const obs = [`Pedido via WhatsApp (RevGás Atende). Cliente: ${p.nome} ${p.telefone}.`];
  // O painel do Chatwoot liga a venda à conversa por aqui (a API é a fonte; o bot não guarda pedidos).
  if (ids.conversaId) obs.push(`Conversa ${ids.conversaId}.`);
  if (p.pagamento === 'MONEY' && p.trocoParaCentavos) obs.push(`Troco para ${formatarReais(p.trocoParaCentavos)}.`);
  return {
    customer_id: ids.clienteId,
    establishment_id: ids.estabelecimentoId,
    location: e.logradouro!,
    number: e.numero!,
    neighborhood: e.bairro!,
    city: e.cidade!,
    state_federation: e.uf!,
    ...(e.complemento?.trim() && { complement: e.complemento.trim().slice(0, 255) }),
    ...(e.referencia?.trim() && { landmark: e.referencia.trim().slice(0, 255) }),
    observation: obs.join(' '),
    // A API recebe reais como número JSON; centavos inteiros evitam erro de arredondamento até aqui.
    products: [{ product_id: produto.productId, quantity: p.quantidade, value: produto.precoCentavos / 100 }],
    payments: [{ payment_type: p.pagamento, value: total / 100 }],
    channel: 'WHATSAPP',
    origin: 'INTEGRATION',
    option: 'NORMAL',
    broadcast: 'NONE',
  };
}
