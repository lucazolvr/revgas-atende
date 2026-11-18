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
  complement: string;
  landmark: string;
  observation: string;
  products: { product_id: number; quantity: number; value: number }[];
  payments: { payment_type: FormaPagamento; value: number }[];
  channel: 'WHATSAPP';
  origin: 'INTEGRATION';
  option: 'NORMAL';
  broadcast: 'NONE';
};

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

export function corpoDaVenda(
  p: Pedido,
  cat: Produto[],
  ids: { clienteId: number; estabelecimentoId: number },
): CorpoVenda {
  const produto = produtoDo(p, cat);
  const e = p.endereco ?? {};
  if (!produto || !p.quantidade || !p.pagamento || !p.nome || CAMPOS_ENDERECO.some((c) => !e[c])) {
    throw new Error('pedido incompleto');
  }
  const total = produto.precoCentavos * p.quantidade;
  const obs = [`Pedido via WhatsApp (RevGás Atende). Cliente: ${p.nome} ${p.telefone}.`];
  if (p.pagamento === 'MONEY' && p.trocoParaCentavos) obs.push(`Troco para ${formatarReais(p.trocoParaCentavos)}.`);
  return {
    customer_id: ids.clienteId,
    establishment_id: ids.estabelecimentoId,
    location: e.logradouro!,
    number: e.numero!,
    neighborhood: e.bairro!,
    city: e.cidade!,
    state_federation: e.uf!,
    complement: e.complemento ?? '',
    landmark: e.referencia ?? '',
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
