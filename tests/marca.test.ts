import { describe, expect, it } from 'vitest';
import { gerarTema, lerEscala, mapaDeCores, trocarCores } from '../scripts/marca.js';

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
});
