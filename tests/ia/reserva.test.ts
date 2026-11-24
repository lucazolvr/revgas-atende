import { describe, expect, it } from 'vitest';
import { gerarComReserva } from '../../src/ia/gemini.js';

function aiFalsa(falham: string[]) {
  const chamados: string[] = [];
  const ai = {
    models: {
      generateContent: async ({ model }: { model: string }) => {
        chamados.push(model);
        if (falham.includes(model)) throw new Error(`503 ${model}`);
        return { text: model };
      },
    },
  } as never;
  return { ai, chamados };
}

describe('gerarComReserva', () => {
  it('usa o primeiro modelo quando ele responde', async () => {
    const { ai, chamados } = aiFalsa([]);
    const r = await gerarComReserva(ai, 'a, b', 1000, { contents: 'x' });
    expect(r.text).toBe('a');
    expect(chamados).toEqual(['a']);
  });

  it('passa para a reserva quando o modelo falha', async () => {
    const { ai, chamados } = aiFalsa(['a']);
    const r = await gerarComReserva(ai, 'a,b,c', 1000, { contents: 'x' });
    expect(r.text).toBe('b');
    expect(chamados).toEqual(['a', 'b']);
  });

  it('"openai:<modelo>" chama a OpenAI quando o Gemini falha', async () => {
    const { ai } = aiFalsa(['a']);
    process.env.OPENAI_API_KEY = 'teste';
    let corpo: { model?: string; messages?: { content: string }[] } = {};
    const doFetch = (async (_url: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    }) as typeof fetch;
    const r = await gerarComReserva(ai, 'a, openai:mini', 1000, { contents: 'oi', config: { systemInstruction: 'regras' } }, doFetch);
    expect(r.text).toBe('{"ok":true}');
    expect(corpo.model).toBe('mini');
    expect(corpo.messages?.map((m) => m.content)).toEqual(['regras', 'oi']);
    delete process.env.OPENAI_API_KEY;
  });

  it('repassa o último erro quando todos falham', async () => {
    const { ai } = aiFalsa(['a', 'b']);
    await expect(gerarComReserva(ai, 'a,b', 1000, { contents: 'x' })).rejects.toThrow('503 b');
  });
});
