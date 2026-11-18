import { describe, expect, it, vi } from 'vitest';
import { SessoesMemoria } from '../src/conversa/sessoes.js';
import { InterpretadorFalso } from '../src/ia/interpretacao.js';
import { criarServidor } from '../src/servidor.js';
import { ApiRevGasFalsa } from '../src/vendas/api-revgas.js';
import { carregarCatalogo } from '../src/vendas/catalogo.js';
import { corpoDaVenda } from '../src/vendas/pedido.js';
import { registrarVenda } from '../src/vendas/registrar.js';
import { webhook } from './ajuda.js';

const TOKEN = 'token-secreto-de-teste-123';
const catalogo = carregarCatalogo();

function montar(numerosIa: string[] = []) {
  const api = new ApiRevGasFalsa();
  const chatwoot = {
    responder: vi.fn(async () => {}),
    nota: vi.fn(async () => {}),
    etiquetar: vi.fn(async () => {}),
    transferir: vi.fn(async () => {}),
  };
  const ia = new InterpretadorFalso({});
  const interpretadorPara = vi.fn((tel: string) => (numerosIa.includes(tel) ? ia : null));
  const { app, ocioso } = criarServidor({
    webhookToken: TOKEN,
    chatwoot,
    sessoes: new SessoesMemoria(),
    catalogo,
    interpretadorPara,
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
});
