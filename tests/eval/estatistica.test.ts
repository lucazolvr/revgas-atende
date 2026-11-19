import { describe, expect, it } from 'vitest';
import { compararEntidades, mediana, percentil, precisaoRevocacao, somar, wilcoxonPareado } from '../../eval/estatistica.js';

describe('compararEntidades', () => {
  it('acerto, erro de valor, falta e sobra', () => {
    const r = compararEntidades(
      { nome: 'Ana', quantidade: 2, endereco: { logradouro: 'Av. Frei Serafim', bairro: 'Centro' } },
      { nome: 'Ana Clara', quantidade: 2, pagamento: 'PIX', endereco: { logradouro: 'av frei serafim' } },
    );
    expect(r.quantidade).toEqual({ vp: 1, fp: 0, fn: 0 });
    expect(r['endereco.logradouro']).toEqual({ vp: 1, fp: 0, fn: 0 }); // ignora caixa e pontuação
    expect(r.nome).toEqual({ vp: 0, fp: 1, fn: 1 }); // valor errado
    expect(r.pagamento).toEqual({ vp: 0, fp: 1, fn: 0 }); // inventou
    expect(r['endereco.bairro']).toEqual({ vp: 0, fp: 0, fn: 1 }); // esqueceu
    expect(r.produto).toEqual({ vp: 0, fp: 0, fn: 0 });
  });

  it('abreviações de endereço contam como iguais, sem estragar palavras', () => {
    const r = compararEntidades(
      { endereco: { logradouro: 'Rua Olavo Bilac', bairro: 'Centro Norte', complemento: 'apartamento 201' } },
      { endereco: { logradouro: 'R. Olavo Bilac', bairro: 'Centro/Norte', complemento: 'apto 201' } },
    );
    expect(r['endereco.logradouro'].vp + r['endereco.bairro'].vp + r['endereco.complemento'].vp).toBe(3);
    expect(compararEntidades({ endereco: { bairro: 'Regeneração' } }, { endereco: { bairro: 'Rua Regeneração' } })['endereco.bairro'].vp).toBe(0);
  });

  it('precisão, revocação e F1', () => {
    const m = precisaoRevocacao(somar([{ vp: 8, fp: 2, fn: 0 }, { vp: 0, fp: 0, fn: 2 }]));
    expect(m.precisao).toBeCloseTo(0.8);
    expect(m.revocacao).toBeCloseTo(0.8);
    expect(m.f1).toBeCloseTo(0.8);
    expect(m.suporte).toBe(10);
  });
});

describe('estatística descritiva', () => {
  it('mediana e percentil', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(percentil([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48);
  });
});

describe('wilcoxonPareado', () => {
  it('confere com scipy.stats.wilcoxon (approx, correction=True)', () => {
    // diferenças 1..10, todas positivas: scipy → p ≈ 0,005922
    const a = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const b = a.map((x, i) => x - (i + 1));
    const r = wilcoxonPareado(a, b);
    expect(r).toMatchObject({ n: 10, wMais: 55, wMenos: 0 });
    expect(r.p).toBeCloseTo(0.005922, 4);
  });

  it('descarta empates zero e trata postos empatados', () => {
    const r = wilcoxonPareado([5, 5, 6, 4, 7, 3], [5, 5, 5, 5, 5, 5]);
    expect(r.n).toBe(4); // dois zeros descartados
    expect(r.wMais).toBe(r.wMenos); // simétrico
    expect(r.p).toBe(1);
  });

  it('exige amostras do mesmo tamanho', () => {
    expect(() => wilcoxonPareado([1], [1, 2])).toThrow();
  });
});
