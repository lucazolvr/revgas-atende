import { describe, expect, it } from 'vitest';
import { avaliarIa, carregarMensagens, relatorioMarkdown } from '../../eval/avaliar-ia.js';
import { InterpretadorFalso } from '../../src/ia/interpretacao.js';
import { carregarCatalogo } from '../../src/vendas/catalogo.js';
import { validarInterpretacao } from '../../src/ia/interpretacao.js';

describe('conjunto rotulado', () => {
  const mensagens = carregarMensagens();
  const cat = carregarCatalogo();

  it('tem 60 mensagens com ids únicos', () => {
    expect(mensagens).toHaveLength(60);
    expect(new Set(mensagens.map((m) => m.id)).size).toBe(60);
  });

  it('todo rótulo é uma interpretação válida pelo próprio validador do bot', () => {
    for (const m of mensagens) expect(validarInterpretacao(m.esperado, cat), `mensagem ${m.id}`).toEqual(m.esperado);
  });
});

describe('avaliarIa', () => {
  const mensagens = carregarMensagens().slice(0, 3);

  it('IA perfeita → 100%; IA muda → 0% e conta sem resposta', async () => {
    const perfeita = new InterpretadorFalso(Object.fromEntries(mensagens.map((m) => [m.texto, m.esperado])));
    const r1 = await avaliarIa(mensagens, perfeita);
    expect(r1.acuraciaIntencao).toBe(1);
    expect(r1.geral.fp + r1.geral.fn).toBe(0);

    const r2 = await avaliarIa(mensagens, new InterpretadorFalso({}));
    expect(r2.acuraciaIntencao).toBe(0);
    expect(r2.semResposta).toBe(3);
    expect(r2.geral.vp).toBe(0);

    const md = relatorioMarkdown(r2, { modelo: 'x', data: '2026-01-01', latencias: [100], indisponiveis: 0 });
    expect(md).toContain('acurácia 0,0%');
    expect(md).toContain('| 1 | INICIO |'); // erros listados
  });
});
