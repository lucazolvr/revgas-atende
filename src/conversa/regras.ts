import { normalizar } from './emergencia.js';
import { separarCidadeUf } from './motor.js';
import type { Produto } from '../vendas/catalogo.js';
import type { Endereco, Pedido } from '../vendas/pedido.js';

type CamposRegra = Partial<Pick<Pedido, 'produto' | 'quantidade' | 'pagamento' | 'trocoParaCentavos'>>;

const QUANTIDADES: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

export function numeroPorExtenso(palavra: string): number | null {
  return QUANTIDADES[normalizar(palavra).trim()] ?? null;
}

export function extrairRegras(texto: string, cat: Produto[]): CamposRegra {
  const n = normalizar(texto);
  const resultado: CamposRegra = {};
  const quantidade = n.match(/\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/);
  if (quantidade) {
    const q = /^\d+$/.test(quantidade[1]!) ? Number(quantidade[1]) : numeroPorExtenso(quantidade[1]!);
    if (q && q <= 20) resultado.quantidade = q;
  }

  const produto = cat.find((p) => {
    const codigo = normalizar(p.codigo);
    const nome = normalizar(p.nome);
    const tamanho = p.codigo.match(/^P(\d+)$/i)?.[1];
    return new RegExp(`\\b${codigo}\\b`, 'i').test(n) || n.includes(nome) ||
      (!!tamanho && new RegExp(`\\b${tamanho}\\s?(kg|quilos?)?\\b`).test(n)) ||
      (p.codigo.startsWith('AGUA') && /\b(agua|galao)\b/.test(n));
  });
  if (produto) resultado.produto = produto.codigo;
  else if (resultado.quantidade && /botij|bujao|\bgas\b/.test(n)) {
    const gas = cat.filter((p) => /^P\d+$/i.test(p.codigo));
    if (gas.length) resultado.produto = gas.find((p) => p.codigo.toUpperCase() === 'P13')?.codigo ?? gas[0]!.codigo;
  }

  if (/\bpix\b/.test(n)) resultado.pagamento = 'PIX';
  else if (/dinheir|dinhero|especie/.test(n)) resultado.pagamento = 'MONEY';
  else if (/cartao\s+(?:de\s+)?debito/.test(n)) resultado.pagamento = 'CARTAO_DE_DEBITO';
  else if (/cartao\s+credito/.test(n)) resultado.pagamento = 'CARTAO_DE_CREDITO';

  const troco = n.match(/\btroco\s+(?:pra|para)\s+(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/);
  if (troco) resultado.trocoParaCentavos = Math.round(Number(troco[1]!.replace(',', '.')) * 100);
  return resultado;
}

export function separarEndereco(texto: string): Partial<Endereco> | null {
  const partes = texto.split(',').map((p) => p.trim()).filter(Boolean);
  if (partes.length < 3) return null;
  const [logradouro, numero, bairro, ...cidadePartes] = partes;
  if (!logradouro || !numero || !bairro || !cidadePartes.length) return null;
  const ultima = separarCidadeUf(cidadePartes.join(', '));
  if (ultima.cidade.length < 2) return null;
  const uf = ultima.uf ?? ({ teresina: 'PI', timon: 'MA' }[normalizar(ultima.cidade)]);
  return { logradouro, numero, bairro, cidade: ultima.cidade, ...(uf && { uf }) };
}
