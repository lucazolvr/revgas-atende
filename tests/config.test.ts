import { describe, expect, it } from 'vitest';
import { carregarConfig, chaveTelefone } from '../src/config.js';

const base = { CHATWOOT_URL: 'http://cw', CHATWOOT_ACCOUNT_ID: '1', CHATWOOT_BOT_TOKEN: 't', BOT_WEBHOOK_TOKEN: 'x'.repeat(16) };

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

  it('venda real exige chave e IDs, sem mostrar valores', () => {
    expect(() => carregarConfig({ ...base, VENDA_REAL: 'true', REVGAS_API_KEY: 'SEGREDO' })).toThrow(/REVGAS_CLIENTE_DEMO/);
    try {
      carregarConfig({ ...base, VENDA_REAL: 'true', REVGAS_API_KEY: 'SEGREDO' });
    } catch (e) {
      expect(String(e)).not.toContain('SEGREDO');
    }
  });
});
