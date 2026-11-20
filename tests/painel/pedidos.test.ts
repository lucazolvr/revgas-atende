import { describe, expect, it } from 'vitest';
import { RegistroPedidosMemoria, diaDaRevenda, type PedidoRegistrado } from '../../src/painel/pedidos.js';

const pedido = (vendaId: number, quando: string): PedidoRegistrado => ({
  vendaId, conversaId: 7, quando, nome: 'Maria', produto: 'P13', quantidade: 1, total: 'R$ 110,00', pagamento: 'PIX', endereco: 'Rua Nova, 10',
});

describe('pedidos do dia', () => {
  it('o dia é o de Teresina (UTC−3), não o do servidor', () => {
    expect(diaDaRevenda(new Date('2026-11-21T02:59:00Z'))).toBe('2026-11-20');
    expect(diaDaRevenda(new Date('2026-11-21T03:00:00Z'))).toBe('2026-11-21');
  });

  it('filtra por dia e acha o pedido de uma venda', async () => {
    const r = new RegistroPedidosMemoria();
    await r.adicionar(pedido(1, '2026-11-20T23:00:00Z')); // 20h do dia 20
    await r.adicionar(pedido(2, '2026-11-21T12:00:00Z'));
    expect((await r.doDia('2026-11-21')).map((p) => p.vendaId)).toEqual([2]);
    expect((await r.doDia('2026-11-20')).map((p) => p.vendaId)).toEqual([1]);
    expect(await r.daVenda(2)).toMatchObject({ vendaId: 2 });
    expect(await r.daVenda(9)).toBeNull();
  });
});
