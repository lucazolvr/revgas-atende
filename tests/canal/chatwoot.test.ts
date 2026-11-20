import { describe, expect, it, vi } from 'vitest';
import { ClienteChatwoot, extrairMensagem } from '../../src/canal/chatwoot.js';
import { webhook } from '../ajuda.js';

describe('extrairMensagem', () => {
  it('extrai conversa, telefone só com dígitos e texto', () => {
    expect(extrairMensagem(webhook(' oi '))).toEqual({ conversaId: 7, telefone: '5586999990000', texto: 'oi' });
  });

  it('ignora o que não é mensagem do cliente para o bot', () => {
    expect(extrairMensagem(webhook('oi', { message_type: 'outgoing' }))).toBeNull();
    expect(extrairMensagem(webhook('oi', { private: true }))).toBeNull();
    expect(extrairMensagem(webhook('oi', { event: 'conversation_created' }))).toBeNull();
    expect(extrairMensagem(webhook('oi', {}, { status: 'open' }))).toBeNull();
    expect(extrairMensagem(webhook(''))).toBeNull();
    expect(extrairMensagem(webhook('', { attachments: [{ file_type: 'audio' }] }))).toMatchObject({ texto: '' });
    expect(extrairMensagem(null)).toBeNull();
  });

  it('rejeita ID de conversa inválido antes de montar chamadas autenticadas', () => {
    expect(extrairMensagem(webhook('oi', {}, { id: '7' }))).toBeNull();
    expect(extrairMensagem(webhook('oi', {}, { id: -1 }))).toBeNull();
    expect(extrairMensagem(webhook('oi', {}, { id: 1.5 }))).toBeNull();
  });
});

describe('ClienteChatwoot', () => {
  it('transfere com prioridade urgente', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response('{}', { status: 200 }));
    const c = new ClienteChatwoot('http://cw:3000/', 1, 'TOKEN', f);
    await c.transferir(7, 'urgent');
    expect(f.mock.calls.map(([u, i]) => [u, JSON.parse(String(i?.body))])).toEqual([
      ['http://cw:3000/api/v1/accounts/1/conversations/7/toggle_status', { status: 'open' }],
      ['http://cw:3000/api/v1/accounts/1/conversations/7/toggle_priority', { priority: 'urgent' }],
    ]);
    expect(new Headers(f.mock.calls[0]![1]?.headers).get('api_access_token')).toBe('TOKEN');
  });

  it('nota é privada', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response('{}', { status: 200 }));
    await new ClienteChatwoot('http://cw', 1, 'T', f).nota(7, 'resumo');
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual({ content: 'resumo', message_type: 'outgoing', private: true });
  });

  it('atributos gravam os dados do pedido na conversa', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response('{}', { status: 200 }));
    await new ClienteChatwoot('http://cw', 1, 'T', f).atributos(7, { numero_venda: 30924027, total: 'R$ 220,00' });
    expect(f.mock.calls[0]![0]).toBe('http://cw/api/v1/accounts/1/conversations/7/custom_attributes');
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual({
      custom_attributes: { numero_venda: 30924027, total: 'R$ 220,00' },
    });
  });

  it('erro HTTP vira exceção', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 }));
    await expect(new ClienteChatwoot('http://cw', 1, 'T', f).responder(7, 'x')).rejects.toThrow('401');
  });
});
