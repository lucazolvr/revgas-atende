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

  it('descarta pedidos com mais de 2 dias (dados pessoais não ficam guardados além disso)', async () => {
    let agora = Date.parse('2026-11-21T12:00:00Z');
    const r = new RegistroPedidosMemoria(() => agora);
    await r.adicionar(pedido(1, '2026-11-21T11:00:00Z'));
    expect(await r.daVenda(1)).not.toBeNull();
    agora = Date.parse('2026-11-23T11:01:00Z'); // 2 dias e 1 minuto depois
    expect(await r.daVenda(1)).toBeNull();
    expect(await r.doDia('2026-11-21')).toEqual([]);
  });

  it('filtra por dia e acha o pedido de uma venda', async () => {
    const r = new RegistroPedidosMemoria(() => Date.parse('2026-11-21T13:00:00Z'));
    await r.adicionar(pedido(1, '2026-11-20T23:00:00Z')); // 20h do dia 20
    await r.adicionar(pedido(2, '2026-11-21T12:00:00Z'));
    expect((await r.doDia('2026-11-21')).map((p) => p.vendaId)).toEqual([2]);
    expect((await r.doDia('2026-11-20')).map((p) => p.vendaId)).toEqual([1]);
    expect(await r.daVenda(2)).toMatchObject({ vendaId: 2 });
    expect(await r.daVenda(9)).toBeNull();
  });
});
