import { describe, expect, it } from 'vitest';
import { gerarTema, lerEscala, mapaDeCores, mapaDeVariaveisEscuras, trocarCores } from '../scripts/marca.js';

const css = [
  ':root{--slate-1: 1 1 1;--blue-9: 39 129 246;--blue-10: 16 115 233}',
  '.dark{--blue-9: 39 129 246;--blue-10: 21 116 231}',
  '.bg-n-brand{--tw-bg-opacity: 1;background-color:#2781f6}',
  '.bg-n-brand\\/10{background-color:#2781f61a}',
  '.hover\\:bg-n-blue-10:hover{background-color:#1073e9;color:#fff}',
  '.accent{accent-color:rgb(39 129 246 / 1)}',
  '@media (min-width: 768px){.md\\:border-n-brand{border-color:#2781f6}.md\\:p-2{padding:.5rem}}',
  '.nao-mexe{color:#2781f6aa0;background:#12345678}',
  '.cinza{color:#272727}',
].join('');

describe('tema da marca', () => {
  const mapa = mapaDeCores({ claro: lerEscala(css, ':root'), escuro: lerEscala(css, '.dark') });
  const saida = trocarCores(css, mapa);

  it('lê a escala original', () => {
    expect(lerEscala(css, ':root')).toEqual({ 9: '39 129 246', 10: '16 115 233' });
    expect(lerEscala(css, '.dark')).toEqual({ 9: '39 129 246', 10: '21 116 231' });
  });

  it('troca a cor fixa mantendo a transparência', () => {
    expect(saida).toContain('.bg-n-brand{background-color:#fc692b}');
    expect(saida).toContain('.bg-n-brand\\/10{background-color:#fc692b1a}');
    expect(saida).toContain('.hover\\:bg-n-blue-10:hover{background-color:#ee5c1e}');
    expect(saida).toContain('.accent{accent-color:rgb(252 105 43 / 1)}');
  });

  it('mantém o @media e só leva as declarações com a cor', () => {
    expect(saida).toContain('@media (min-width: 768px){.md\\:border-n-brand{border-color:#fc692b}}');
    expect(saida).not.toContain('padding');
    expect(saida).not.toContain('--tw-bg-opacity');
  });

  it('não mexe em cores parecidas', () => {
    expect(saida).not.toContain('.nao-mexe');
    expect(saida).not.toContain('.cinza');
  });

  it('gera as variáveis laranja nos dois temas', () => {
    const tema = gerarTema(css);
    expect(tema).toMatch(/:root\{[^}]*--blue-9: 252 105 43;/);
    expect(tema).toMatch(/\.dark\{[^}]*--blue-9: 252 105 43;/);
  });

  describe('balão da mensagem enviada (--solid-blue) no modo escuro', () => {
    // Como no Chatwoot v4: no claro é o passo 4 da escala; no escuro, um tom fora da escala.
    // A classe tem cor fixa de reserva seguida da cor por variável. O modo escuro é `body.dark`.
    const cssBalao = [
      ':root{--blue-4: 218 236 255;--blue-9: 39 129 246;--solid-blue: 218 236 255}',
      '.dark{--blue-4: 10 49 99;--blue-9: 39 129 246;--solid-blue: 15 57 102}',
      '.bg-n-solid-blue{--tw-bg-opacity: 1;background-color:#daecff;background-color:rgb(var(--solid-blue) / var(--tw-bg-opacity, 1))}',
    ].join('');
    const tema = gerarTema(cssBalao);
    const original = { claro: lerEscala(cssBalao, ':root'), escuro: lerEscala(cssBalao, '.dark') };

    it('não copia a cor fixa de reserva, que passaria por cima da variável', () => {
      expect(tema).not.toContain('.bg-n-solid-blue');
    });

    it('a variável vira laranja nos dois temas', () => {
      expect(tema).toContain(':root{--solid-blue: 255 224 207}');
      expect(tema).toContain('.dark{--solid-blue: 79 31 12}');
      expect(mapaDeVariaveisEscuras(cssBalao, original).get('15 57 102')).toBe('79 31 12');
    });

    it('não mexe em variável escura que já está na escala nem nas próprias --blue-N', () => {
      expect([...mapaDeVariaveisEscuras(cssBalao, original).keys()]).toEqual(['15 57 102', '15,57,102']);
    });

    it('reconhece a cor escrita com vírgula e espaço', () => {
      const t = gerarTema(':root{--blue-9: 39 129 246;--border-blue: 39, 129, 246, .5}.dark{--blue-9: 39 129 246}');
      expect(t).toContain(':root{--border-blue: 252, 105, 43, .5}');
    });

    it('cor fixa sem variável depois continua sendo trocada', () => {
      expect(saida).toContain('.bg-n-brand{background-color:#fc692b}');
    });
  });
});
