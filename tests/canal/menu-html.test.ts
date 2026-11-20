import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A tag do menu é montada em Ruby (scripts/menu-html.rb), dentro do Chatwoot. Este teste roda o
// scripts/menu-html.test.rb na mesma imagem do Chatwoot do docker-compose.yml. Sem Docker, pula.
const imagem = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8').match(/image: (chatwoot\/chatwoot:\S+)/)?.[1];
const temDocker = (() => {
  try {
    execFileSync('docker', ['image', 'inspect', imagem ?? ''], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('tag do menu "Pedidos de hoje" (Ruby)', () => {
  it.skipIf(!temDocker)('escapa o token e só aceita http(s)', () => {
    // fileURLToPath: no Windows, .pathname dá /C:/... e o docker -v não aceita.
    const scripts = fileURLToPath(new URL('../../scripts', import.meta.url));
    const saida = execFileSync('docker', ['run', '--rm', '-v', `${scripts}:/s:ro`, '--entrypoint', 'ruby', imagem!, '/s/menu-html.test.rb'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(saida).toMatch(/4 runs, \d+ assertions, 0 failures, 0 errors/);
  }, 130_000);
});
