import { readFileSync } from 'node:fs';

export type FormaPagamento = 'PIX' | 'MONEY' | 'CARTAO_DE_DEBITO' | 'CARTAO_DE_CREDITO';

// Ordem do menu mostrado ao cliente.
export const FORMAS_PAGAMENTO: { codigo: FormaPagamento; rotulo: string }[] = [
  { codigo: 'PIX', rotulo: 'PIX' },
  { codigo: 'MONEY', rotulo: 'Dinheiro' },
  { codigo: 'CARTAO_DE_DEBITO', rotulo: 'Cartão de débito' },
  { codigo: 'CARTAO_DE_CREDITO', rotulo: 'Cartão de crédito' },
];

export type Produto = { codigo: string; productId: number; nome: string; precoCentavos: number };

export function carregarCatalogo(caminho = new URL('../../config/catalogo.json', import.meta.url)): Produto[] {
  const lista = JSON.parse(readFileSync(caminho, 'utf8')) as Produto[];
  for (const p of lista) {
    if (!p.codigo || !Number.isInteger(p.productId) || !Number.isInteger(p.precoCentavos) || p.precoCentavos <= 0) {
      throw new Error(`catálogo inválido: ${JSON.stringify(p)}`);
    }
  }
  return lista;
}
