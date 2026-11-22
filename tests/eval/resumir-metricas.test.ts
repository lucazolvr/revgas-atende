import { describe, expect, it } from 'vitest';
import { resumirMetricas, type Registro } from '../../eval/resumir-metricas.js';

const ev = (conversaId: number, min: number, e: Partial<Registro>): Registro =>
  ({ conversaId, tipo: 'mensagem', em: new Date(Date.UTC(2026, 10, 20, 12, min)).toISOString(), ...e }) as Registro;

describe('resumirMetricas', () => {
  it('agrega por conversa: vendas, transferências, mensagens e tempos', () => {
    const r = resumirMetricas([
      ev(1, 0, { ia: true, ms: 2000 }), ev(1, 1, { ia: true, ms: 3000 }), ev(1, 2, { tipo: 'venda', resultado: 'ok' }), ev(1, 2, { ia: true, ms: 2500 }),
      ev(2, 0, { ia: false, ms: 100 }), ev(2, 1, { tipo: 'transferencia', motivo: 'vazamento' }), ev(2, 1, { ia: false, ms: 100 }),
    ]);
    expect(r).toMatchObject({ conversas: 2, comIa: 1, vendas: 1, transferencias: { vazamento: 1 }, erros: 0 });
    expect(r.mensagensAteVenda.comIa).toBe(3);
    expect(r.minutosAteVenda).toBe(2);
    expect(r.respostaBot.medianaMs).toBe(2000); // mediana de [100, 100, 2000, 2500, 3000]
  });
});
