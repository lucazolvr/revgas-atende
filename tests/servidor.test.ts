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
  comHistorico = false,
  responderDuvida?: (texto: string) => Promise<string | null>,
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
    responderDuvida,
    limites,
    registrar: (p, conversaId) => registrarVenda(api, corpoDaVenda(p, catalogo, { clienteId: 1, estabelecimentoId: 1, conversaId })),
    clienteAnterior: comHistorico ? (t) => api.ultimoCliente(t) : undefined,
    consultas: api,
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
    for (const m of ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1']) await enviar(m);
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

  it('responde palavras-chave antes do RAG e usa RAG como reserva para números habilitados', async () => {
    const rag = vi.fn(async () => 'Resposta da base sem palavra-chave.');
    const { ocioso, chatwoot, enviar } = montar(['5586999990000'], undefined, false, rag);
    await enviar('oi');
    await enviar('4');
    await enviar('qual o preço do gás?');
    await ocioso();
    expect(chatwoot.responder).toHaveBeenCalledWith(7, expect.stringContaining('R$ 110,00'));
    expect(rag).not.toHaveBeenCalled();

    await enviar('4');
    await enviar('qual a capital da França?');
    await ocioso();
    expect(rag).toHaveBeenCalledWith('qual a capital da França?');
    expect(chatwoot.responder).toHaveBeenLastCalledWith(7, expect.stringContaining('Resposta da base'));
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
    // Uma saudação gera a apresentação e o menu principal; a segunda foi descartada.
    expect(chatwoot.responder).toHaveBeenCalledTimes(2);
  });

  describe('dados do pedido na lateral do Chatwoot', () => {
    const PEDIDO = ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1'];

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

    it('a venda leva o número da conversa na observação (o painel liga a venda à conversa)', async () => {
      const { ocioso, api, enviar } = montar();
      for (const m of [...PEDIDO, '1']) await enviar(m, { id: 12 });
      await ocioso();
      expect(api.vendas[0]!.observation).toMatch(/Conversa 12\.$/);
    });

    it('cliente que volta em outra conversa não repete nome e endereço', async () => {
      const { ocioso, chatwoot, enviar } = montar([], undefined, true);
      for (const m of [...PEDIDO, '1']) await enviar(m);
      await ocioso();
      for (const m of ['oi', '1', '1', '1', '1']) await enviar(m, { id: 9 }); // menu "fazer pedido", P13, 1 unidade, PIX
      await ocioso();
      const respostas = (chatwoot.responder.mock.calls as unknown as [number, string][]).filter(([id]) => id === 9).map(([, t]) => t);
      expect(respostas[0]).toContain('Olá de novo, Maria');
      expect(respostas.join('\n')).toContain('Rua Nova, 10 - Centro, Teresina/PI');
      expect(respostas.join('\n')).not.toContain('Qual é o seu nome');
      expect(respostas.at(-1)).toContain('Confira seu pedido');
    });

    it('falha ao buscar o histórico só começa o pedido do zero', async () => {
      const { ocioso, api, chatwoot, enviar } = montar([], undefined, true);
      api.ultimoCliente = async () => { throw new Error('API fora'); };
      await enviar('oi');
      await enviar('1');
      await ocioso();
      expect(chatwoot.responder).toHaveBeenCalledWith(7, expect.stringContaining('Qual é o seu nome'));
    });

    it('transferência grava o que já foi coletado', async () => {
      const { ocioso, chatwoot, enviar } = montar();
      for (const m of ['oi', '1', 'Maria', '1', '3', 'quero um atendente']) await enviar(m);
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

  describe('acompanhar e cancelar pelo WhatsApp (Tarefa 3)', () => {
    const PEDIDO = ['oi', '1', 'Maria', '1', '2', 'Rua Nova', '10', 'Centro', 'Teresina', '1', '1'];
    const respostasDa = (chatwoot: ReturnType<typeof montar>['chatwoot'], id: number) =>
      (chatwoot.responder.mock.calls as unknown as [number, string][]).filter(([c]) => c === id).map(([, t]) => t).join('\n');

    it('cancela numa conversa nova do mesmo telefone, só depois de a API confirmar', async () => {
      const { ocioso, api, chatwoot, enviar } = montar();
      for (const m of PEDIDO) await enviar(m); // venda 1, na conversa 7
      await ocioso();
      expect(api.vendas).toHaveLength(1);
      for (const m of ['cancelar', '1', '1']) await enviar(m, { id: 9 });
      await ocioso();
      expect([...api.canceladas]).toEqual([1]);
      expect(respostasDa(chatwoot, 9)).toContain('Pedido nº 1 cancelado.');
    });

    it('outro telefone não vê nem cancela a venda', async () => {
      const { ocioso, api, chatwoot, app } = montar();
      for (const m of PEDIDO) await app.inject({ method: 'POST', url: `/webhook/${TOKEN}`, payload: webhook(m) });
      await ocioso();
      const outro = (texto: string) =>
        app.inject({ method: 'POST', url: `/webhook/${TOKEN}`, payload: webhook(texto, {}, { id: 20, meta: { sender: { phone_number: '+5586911112222' } } }) });
      for (const m of ['cancelar', '1', '1']) await outro(m);
      await ocioso();
      expect(api.canceladas.size).toBe(0);
      expect(respostasDa(chatwoot, 20)).toContain('Não encontrei pedido em aberto');
    });

    it('venda cancelada pelo atendente entre a lista e o "sim": avisa e não cancela de novo', async () => {
      const { ocioso, api, chatwoot, enviar } = montar();
      for (const m of PEDIDO) await enviar(m);
      await ocioso();
      for (const m of ['cancelar', '1']) await enviar(m, { id: 9 });
      await ocioso();
      api.canceladas.add(1); // o atendente cancelou pelo painel
      const cancelar = vi.spyOn(api, 'cancelarVenda');
      await enviar('1', { id: 9 });
      await ocioso();
      expect(cancelar).not.toHaveBeenCalled();
      expect(respostasDa(chatwoot, 9)).toContain('Esse pedido já estava cancelado.');
    });

    it('API recusa o cancelamento: transfere com erro_cancelamento e nunca diz "cancelado"', async () => {
      const { ocioso, api, chatwoot, enviar } = montar();
      for (const m of PEDIDO) await enviar(m);
      await ocioso();
      api.cancelarVenda = async () => ({ status: 500, dados: null });
      for (const m of ['cancelar', '1', '1']) await enviar(m, { id: 9 });
      await ocioso();
      expect(chatwoot.etiquetar).toHaveBeenCalledWith(9, ['erro-cancelamento']);
      expect(respostasDa(chatwoot, 9)).not.toMatch(/cancelado\./);
    });
  });

  it('menu de produtos com o estoque do ERP: produto inativo não aparece (Tarefa 4)', async () => {
    const { ocioso, api, chatwoot, enviar } = montar();
    api.produtosErp = [
      { id: 26717, descricao: 'GLP 13KG', estoque: 50, ativo: false }, // P13 inativo
      { id: 23974, descricao: 'GLP 45KG', estoque: 4, ativo: true },
    ];
    for (const m of ['oi', '1', 'Maria']) await enviar(m);
    await ocioso();
    const ultima = (chatwoot.responder.mock.calls.at(-1) as unknown as [number, string])[1];
    expect(ultima).toContain('1 - Botijão P45 (45kg)');
    expect(ultima).not.toContain('P13');
  });
});
