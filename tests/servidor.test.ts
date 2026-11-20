import { describe, expect, it, vi } from 'vitest';
import { SessoesMemoria } from '../src/conversa/sessoes.js';
import { InterpretadorFalso } from '../src/ia/interpretacao.js';
import { criarServidor } from '../src/servidor.js';
import { ApiRevGasFalsa } from '../src/vendas/api-revgas.js';
import { carregarCatalogo } from '../src/vendas/catalogo.js';
import { corpoDaVenda } from '../src/vendas/pedido.js';
import { registrarVenda } from '../src/vendas/registrar.js';
import { webhook } from './ajuda.js';

const TOKEN = 'token-secreto-de-teste-123-456789';
const catalogo = carregarCatalogo();

function montar(
  numerosIa: string[] = [],
  limites?: { porConversa?: number; global?: number; janelaMs?: number; filasMaximas?: number },
  pedidos?: { adicionar: (p: never) => Promise<void> },
) {
  const api = new ApiRevGasFalsa();
  const chatwoot = {
    responder: vi.fn(async () => {}),
    nota: vi.fn(async () => {}),
    etiquetar: vi.fn(async () => {}),
    transferir: vi.fn(async () => {}),
    atributos: vi.fn(async (_id: number, _dados: Record<string, string | number>) => {}),
  };
  const ia = new InterpretadorFalso({});
  const interpretadorPara = vi.fn((tel: string) => (numerosIa.includes(tel) ? ia : null));
  const { app, ocioso } = criarServidor({
    webhookToken: TOKEN,
    chatwoot,
    sessoes: new SessoesMemoria(),
    catalogo,
    interpretadorPara,
    limites,
    pedidos,
    registrar: (p) => registrarVenda(api, corpoDaVenda(p, catalogo, { clienteId: 1, estabelecimentoId: 1 })),
  });
  const enviar = (texto: string, conversa: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/webhook/${TOKEN}`, payload: webhook(texto, {}, conversa) });
  return { app, ocioso, api, chatwoot, interpretadorPara, enviar };
}

describe('servidor', () => {
  it('token errado → 404', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/webhook/errado', payload: webhook('oi') });
    expect(r.statusCode).toBe(404);
  });

  it('saúde', async () => {
    const r = await montar().app.inject({ method: 'GET', url: '/saude' });
    expect(r.json()).toEqual({ ok: true });
  });

  it('dois "1" ao mesmo tempo no resumo criam uma venda só', async () => {
    const { ocioso, api, enviar } = montar();
    for (const m of ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1']) await enviar(m);
    await ocioso();
    await Promise.all([enviar('1'), enviar('1')]);
    await ocioso();
    expect(api.vendas).toHaveLength(1);
  });

  it('vazamento: nota, etiquetas urgentes e transferência', async () => {
    const { ocioso, chatwoot, enviar } = montar();
    await enviar('socorro, cheiro de gás');
    await ocioso();
    expect(chatwoot.etiquetar).toHaveBeenCalledWith(7, ['vazamento', 'urgente']);
    expect(chatwoot.transferir).toHaveBeenCalledWith(7, 'urgent');
    expect(chatwoot.nota).toHaveBeenCalledOnce();
  });

  it('conversa com humano (open) não recebe resposta do bot', async () => {
    const { ocioso, chatwoot, enviar } = montar();
    await enviar('oi', { status: 'open' });
    await ocioso();
    expect(chatwoot.responder).not.toHaveBeenCalled();
  });

  it('IA só para números da lista', async () => {
    const { ocioso, interpretadorPara, enviar } = montar(['5586999990000']);
    await enviar('oi');
    await ocioso();
    expect(interpretadorPara).toHaveBeenCalledWith('5586999990000');
    expect(interpretadorPara.mock.results[0]!.value).not.toBeNull();
  });

  it('áudio sem texto recebe pedido para escrever', async () => {
    const { ocioso, chatwoot, app } = montar();
    await app.inject({ method: 'POST', url: `/webhook/${TOKEN}`, payload: webhook('', { attachments: [{}] }) });
    await ocioso();
    expect(chatwoot.responder).toHaveBeenCalledWith(7, expect.stringContaining('texto'));
  });

  it('depois da transferência a conversa recomeça do início', async () => {
    const { ocioso, chatwoot, enviar } = montar();
    await enviar('oi');
    await enviar('Maria');
    await enviar('quero um atendente');
    await ocioso();
    chatwoot.responder.mockClear();
    await enviar('boa noite');
    await ocioso();
    expect(chatwoot.responder).toHaveBeenCalledWith(7, expect.stringContaining('Olá'));
  });

  it('limita rajadas por conversa sem reenfileirar mensagens excedentes', async () => {
    const { ocioso, chatwoot, enviar } = montar([], { porConversa: 1 });
    await Promise.all([enviar('oi'), enviar('oi')]);
    await ocioso();
    // Uma saudação válida gera boas-vindas e a pergunta de nome; a segunda foi descartada.
    expect(chatwoot.responder).toHaveBeenCalledTimes(2);
  });

  describe('dados do pedido na lateral do Chatwoot', () => {
    const PEDIDO = ['oi', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', 'PI', '1'];

    it('venda registrada grava número, total, pagamento, endereço e quantidade', async () => {
      const { ocioso, chatwoot, enviar } = montar();
      for (const m of PEDIDO) await enviar(m);
      await ocioso();
      expect(chatwoot.atributos).not.toHaveBeenCalled(); // ainda no resumo
      await enviar('1');
      await ocioso();
      expect(chatwoot.atributos).toHaveBeenCalledExactlyOnceWith(7, {
        numero_venda: 1,
        total: 'R$ 220,00',
        forma_pagamento: 'PIX',
        endereco: 'Rua Nova, 10 - Centro, Teresina/PI',
        quantidade: 2,
      });
      await enviar('1'); // "1" repetido não cria venda nem regrava
      await ocioso();
      expect(chatwoot.atributos).toHaveBeenCalledOnce();
    });

    it('venda registrada entra nos pedidos do dia (e falha ali não atrapalha)', async () => {
      const adicionar = vi.fn(async (_p: unknown) => {});
      const { ocioso, chatwoot, enviar } = montar([], undefined, { adicionar });
      for (const m of [...PEDIDO, '1']) await enviar(m);
      await ocioso();
      expect(adicionar).toHaveBeenCalledExactlyOnceWith({
        vendaId: 1,
        conversaId: 7,
        quando: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        nome: 'Maria',
        produto: 'Botijão de gás P13',
        quantidade: 2,
        total: 'R$ 220,00',
        pagamento: 'PIX',
        endereco: 'Rua Nova, 10 - Centro, Teresina/PI',
      });
      adicionar.mockRejectedValue(new Error('Redis fora'));
      for (const m of [...PEDIDO, '1']) await enviar(m, { id: 8 }); // outro cliente, outra conversa
      await ocioso();
      expect(chatwoot.responder).toHaveBeenLastCalledWith(8, expect.stringContaining('Pedido registrado'));
    });

    it('transferência grava o que já foi coletado', async () => {
      const { ocioso, chatwoot, enviar } = montar();
      for (const m of ['oi', 'Maria', '1', '3', 'quero um atendente']) await enviar(m);
      await ocioso();
      expect(chatwoot.atributos).toHaveBeenCalledExactlyOnceWith(7, { total: 'R$ 330,00', quantidade: 3 });
    });

    it('transferência sem nada coletado não apaga a lateral', async () => {
      const { ocioso, chatwoot, enviar } = montar();
      await enviar('socorro, cheiro de gás');
      await ocioso();
      expect(chatwoot.transferir).toHaveBeenCalled();
      expect(chatwoot.atributos).not.toHaveBeenCalled();
    });

    it('falha ao gravar os dados não atrapalha o atendimento', async () => {
      const { ocioso, chatwoot, enviar } = montar();
      chatwoot.atributos.mockRejectedValue(new Error('Chatwoot respondeu 500'));
      for (const m of [...PEDIDO, '1']) await enviar(m);
      await ocioso();
      expect(chatwoot.responder).toHaveBeenLastCalledWith(7, expect.stringContaining('Pedido registrado'));
      chatwoot.responder.mockClear();
      await enviar('1');
      await ocioso();
      expect(chatwoot.responder).toHaveBeenCalledWith(7, expect.stringContaining('já está registrado'));
    });
  });
});
