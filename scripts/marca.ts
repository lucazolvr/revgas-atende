/**
 * Aplica a marca RevGás no painel do Chatwoot:  npm run marca   (com o docker compose no ar)
 *
 * 1. Lê o CSS compilado do Chatwoot (dentro do container) e gera marca/tema.css, trocando a
 *    escala azul da marca (--blue-1..12, e as cores fixas que o Tailwind compilou a partir dela)
 *    pelo laranja da RevGás. Rodar de novo ao atualizar a versão do Chatwoot.
 * 2. Roda scripts/aplicar-marca.rb: logo, ícone, nome e a injeção do tema.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Escala = Record<number, string>; // passo → "r g b"

// Laranja RevGás (#FC692B = 252 105 43) no passo 9, como o azul original do Chatwoot.
export const LARANJA: { claro: Escala; escuro: Escala } = {
  claro: {
    1: '255 252 250', 2: '255 247 242', 3: '255 237 226', 4: '255 224 207', 5: '254 208 184', 6: '252 188 155',
    7: '250 163 120', 8: '247 134 82', 9: '252 105 43', 10: '238 92 30', 11: '200 72 18', 12: '92 36 12',
  },
  escuro: {
    1: '24 14 10', 2: '33 18 12', 3: '58 26 14', 4: '79 31 12', 5: '96 40 18', 6: '115 52 27',
    7: '143 67 37', 8: '186 86 47', 9: '252 105 43', 10: '240 96 34', 11: '255 156 112', 12: '255 224 207',
  },
};

const hex = (rgb: string) => '#' + rgb.split(' ').map((n) => Number(n).toString(16).padStart(2, '0')).join('');

/** Lê a escala --blue-N do bloco `seletor{...}` (ex.: ":root" ou ".dark"). */
export function lerEscala(css: string, seletor: string): Escala {
  const escala: Escala = {};
  const bloco = css.match(new RegExp(`(?:^|})${seletor.replace('.', '\\.')}\\{([^}]*--blue-\\d+:[^}]*)}`))?.[1] ?? '';
  for (const [, n, rgb] of bloco.matchAll(/--blue-(\d+):\s*(\d+ \d+ \d+)/g)) escala[Number(n)] = rgb!;
  return escala;
}

/** Mapa cor original → cor nova, nas três grafias que aparecem no CSS compilado. */
export function mapaDeCores(original: { claro: Escala; escuro: Escala }): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const tema of ['escuro', 'claro'] as const) {
    // o claro vem por último e vence colisões: as classes compiladas usam os valores do :root
    for (const [n, rgb] of Object.entries(original[tema])) {
      const novo = LARANJA[tema][Number(n)];
      if (!novo) continue;
      mapa.set(hex(rgb), hex(novo));
      mapa.set(rgb, novo);
      mapa.set(rgb.replaceAll(' ', ','), novo.replaceAll(' ', ','));
      mapa.set(rgb.replaceAll(' ', ', '), novo.replaceAll(' ', ', ')); // ex.: --border-blue: 39, 129, 246, .5
    }
  }
  return mapa;
}

/** Declarações `--var: r g b` dos blocos exatamente `seletor{...}` (o último valor vence). */
function lerVariaveis(css: string, seletor: string): Map<string, string> {
  const vars = new Map<string, string>();
  const re = new RegExp(`(?:^|})${seletor.replace('.', '\\.')}\\{([^}]*)}`, 'g');
  for (const [, bloco] of css.matchAll(re)) {
    for (const [, nome, rgb] of bloco!.matchAll(/(--[\w-]+):\s*(\d+ \d+ \d+)/g)) vars.set(nome!, rgb!);
  }
  return vars;
}

/**
 * Variáveis derivadas da escala (ex.: --solid-blue, o balão da mensagem enviada) usam no claro um
 * passo exato da escala, mas no escuro um tom próprio, que o mapa não reconhecia: o balão ficava
 * com a cor do tema claro no modo escuro. Aqui o tom escuro vira o mesmo passo do laranja escuro.
 */
export function mapaDeVariaveisEscuras(css: string, original: { claro: Escala; escuro: Escala }): Map<string, string> {
  const mapa = new Map<string, string>();
  const passoClaro = new Map(Object.entries(original.claro).map(([n, rgb]) => [rgb, Number(n)]));
  const tonsEscuros = new Set(Object.values(original.escuro));
  const escuras = lerVariaveis(css, '.dark');
  for (const [nome, rgbClaro] of lerVariaveis(css, ':root')) {
    const passo = passoClaro.get(rgbClaro);
    const rgbEscuro = escuras.get(nome);
    if (/^--blue-\d+$/.test(nome) || !passo || !rgbEscuro || tonsEscuros.has(rgbEscuro)) continue;
    const novo = LARANJA.escuro[passo];
    if (!novo) continue;
    mapa.set(rgbEscuro, novo);
    mapa.set(rgbEscuro.replaceAll(' ', ','), novo.replaceAll(' ', ','));
  }
  return mapa;
}

/**
 * Devolve só as declarações que usam alguma cor do mapa, já trocadas, dentro dos mesmos
 * seletores e @media/@supports. Sobrescreve o CSS original por vir depois na página.
 */
export function trocarCores(css: string, mapa: Map<string, string>): string {
  const chaves = [...mapa.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'));
  if (!chaves.length) return '';
  // a cor sozinha ou com 2 dígitos de transparência (#2781f61a); nunca pedaço de outra cor
  const re = new RegExp(`(?<![0-9a-f])(${chaves.join('|')})(?=(?:[0-9a-f]{2})?(?![0-9a-f]))`, 'gi');
  const usa = new RegExp(re.source, 'i');
  const saida: string[] = [];
  const pilha: string[] = [];
  let buffer = '';
  for (const ch of css) {
    if (ch === '{') {
      pilha.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      const corpo = buffer;
      buffer = '';
      const seletor = pilha.pop() ?? '';
      if (seletor.startsWith('@') || !usa.test(corpo)) continue;
      const todas = corpo.split(';');
      const propriedade = (d: string) => d.split(':')[0]!.trim();
      // O Tailwind compila `cor fixa; cor por variável` (ex.: .bg-n-solid-blue{background-color:#daecff;
      // background-color:rgb(var(--solid-blue) / 1)}). A fixa é só reserva: copiá-la para este tema,
      // que vem depois, passaria por cima da variável e travaria a cor do tema claro no modo escuro
      // (balão da mensagem enviada ilegível). Essa cor já muda pelas variáveis trocadas acima.
      const reservaDeVariavel = (d: string, i: number) =>
        todas.slice(i + 1).some((p) => propriedade(p) === propriedade(d) && p.includes('var(--') && !usa.test(p));
      const decls = todas
        .filter((d, i) => usa.test(d) && !/^\s*--blue-\d+\s*:/.test(d) && !reservaDeVariavel(d, i)) // --blue-N vão no bloco próprio
        .map((d) => d.replace(re, (c) => mapa.get(c.toLowerCase()) ?? mapa.get(c) ?? c));
      if (!decls.length) continue;
      let regra = `${seletor}{${decls.join(';')}}`;
      for (const envoltorio of [...pilha].reverse()) regra = `${envoltorio}{${regra}}`;
      saida.push(regra);
    } else {
      buffer += ch;
    }
  }
  return [...new Set(saida)].join('\n');
}

export function gerarTema(css: string): string {
  const original = { claro: lerEscala(css, ':root'), escuro: lerEscala(css, '.dark') };
  if (!original.claro[9]) throw new Error('não achei a escala --blue-* no CSS do Chatwoot');
  const variaveis = (escala: Escala) => Object.entries(escala).map(([n, rgb]) => `--blue-${n}: ${rgb};`).join(' ');
  return [
    '/* Gerado por scripts/marca.ts a partir do CSS do Chatwoot. Não edite: rode npm run marca. */',
    `:root{${variaveis(LARANJA.claro)}}`,
    `.dark{${variaveis(LARANJA.escuro)}}`,
    trocarCores(css, new Map([...mapaDeVariaveisEscuras(css, original), ...mapaDeCores(original)])),
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const docker = (args: string[], entrada?: string) =>
    execFileSync('docker', ['compose', 'exec', '-T', 'chatwoot', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: entrada,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
  const css = docker(['sh', '-c', 'cat /app/public/vite/assets/*.css']);
  const tema = gerarTema(css);
  writeFileSync('marca/tema.css', tema + '\n');
  console.log(`✓ marca/tema.css gerado (${tema.split('\n').length - 3} regras trocadas)`);
  const ruby = readFileSync('scripts/aplicar-marca.rb', 'utf8');
  console.log(docker(['bundle', 'exec', 'rails', 'runner', ruby]).split('\n').filter((l) => /✓|Marca/.test(l)).join('\n'));
}
