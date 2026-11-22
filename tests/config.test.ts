import { describe, expect, it } from 'vitest';
import { carregarConfig, chaveTelefone } from '../src/config.js';

const base = { CHATWOOT_URL: 'http://cw', CHATWOOT_ACCOUNT_ID: '1', CHATWOOT_BOT_TOKEN: 't', BOT_WEBHOOK_TOKEN: 'x'.repeat(32) };

describe('chaveTelefone', () => {
  it('trata com e sem o 9 extra como o mesmo número', () => {
    expect(chaveTelefone('+55 (86) 99999-0000')).toBe(chaveTelefone('558699990000'));
    expect(chaveTelefone('5586999990000')).toBe('558699990000');
  });

  it('não mexe em números de fora do Brasil ou fixos', () => {
    expect(chaveTelefone('14155550000')).toBe('14155550000');
    expect(chaveTelefone('558632220000')).toBe('558632220000');
  });
});

describe('carregarConfig', () => {
  it('normaliza NUMEROS_IA', () => {
    expect(carregarConfig({ ...base, NUMEROS_IA: '5586999990000, +55 86 98888-1111' }).NUMEROS_IA).toEqual([
      '558699990000',
      '558688881111',
    ]);
  });

  it('NUMEROS_IA=* liga a IA para todos', () => {
    expect(carregarConfig({ ...base, NUMEROS_IA: ' * ' }).NUMEROS_IA).toEqual(['*']);
    expect(carregarConfig(base).NUMEROS_IA).toEqual([]);
  });

  it('painel: desligado sem token, recusa token curto e lê as origens', () => {
    expect(carregarConfig(base).PAINEL_TOKEN).toBeUndefined();
    expect(carregarConfig(base).PAINEL_ORIGENS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    // Token curto não derruba o bot: só desliga o painel, com aviso (sem mostrar o valor).
    const curto = carregarConfig({ ...base, PAINEL_TOKEN: 'curto-demais' });
    expect(curto.PAINEL_TOKEN).toBeUndefined();
    expect(curto.avisos).toEqual([expect.stringContaining('PAINEL_TOKEN tem menos de 32 caracteres')]);
    expect(curto.avisos.join()).not.toContain('curto-demais');
    expect(carregarConfig(base).avisos).toEqual([]);
    expect(carregarConfig({ ...base, PAINEL_TOKEN: 'p'.repeat(32), PAINEL_ORIGENS: ' http://cw.local:3000 ' }).PAINEL_ORIGENS).toEqual([
      'http://cw.local:3000',
    ]);
    // Origem vira parte do cabeçalho CSP: nada de espaço, ; ou caminho.
    expect(() => carregarConfig({ ...base, PAINEL_ORIGENS: "http://x; script-src 'unsafe-inline'" })).toThrow('PAINEL_ORIGENS');
  });

  it('usa retenção segura de métricas por padrão', () => {
    expect(carregarConfig(base).METRICAS_RETENCAO_DIAS).toBe(90);
  });

  it('venda real exige chave e IDs, sem mostrar valores', () => {
    expect(() => carregarConfig({ ...base, VENDA_REAL: 'true', REVGAS_API_KEY: 'SEGREDO' })).toThrow(/REVGAS_CLIENTE_DEMO/);
    try {
      carregarConfig({ ...base, VENDA_REAL: 'true', REVGAS_API_KEY: 'SEGREDO' });
    } catch (e) {
      expect(String(e)).not.toContain('SEGREDO');
    }
  });
});
