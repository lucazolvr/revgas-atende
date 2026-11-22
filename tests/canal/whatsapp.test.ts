import { describe, expect, it } from 'vitest';
import { NOME_CAIXA, type ApiConta } from '../../src/canal/painel.js';
import { NOME_BOT, SESSAO, ligarWhatsApp, type ApiWaha } from '../../src/canal/whatsapp.js';

type Caixa = { id: number; name: string; inbox_identifier?: string; webhook_url?: string };
type App = { id: string; session: string; app: string; config: Record<string, unknown> };

const opcoes = { conta: 1, tokenAdmin: 'tok-admin', tokenWebhook: 'tok-webhook' };

/** Chatwoot e WAHA em memória, com as rotas e os formatos que o setup usa. */
function falsos(inicio: { caixas?: Caixa[]; apps?: App[]; sessao?: string | null; falharApp?: boolean } = {}) {
  const bots: { id: number; name: string; outgoing_url?: string; access_token: string }[] = [];
  const caixas: Caixa[] = structuredClone(inicio.caixas ?? []);
  const apps: App[] = structuredClone(inicio.apps ?? []);
  let sessao = inicio.sessao === undefined ? null : inicio.sessao;
  const chamadas: string[] = [];
  let proximo = 10;

  const cw: ApiConta = async <T,>(caminho: string, metodo = 'GET', corpo?: unknown) => {
    chamadas.push(`cw ${metodo} ${caminho}`);
    const c = corpo as Record<string, any>;
    if (caminho === '/agent_bots' && metodo === 'GET') return bots as T;
    if (caminho === '/agent_bots' && metodo === 'POST') {
      const b = { id: proximo++, access_token: 'tok-bot', ...c } as (typeof bots)[0];
      bots.push(b);
      return b as T;
    }
    if (caminho.startsWith('/agent_bots/')) return Object.assign(bots.find((b) => `/agent_bots/${b.id}` === caminho)!, c) as T;
    if (caminho === '/inboxes' && metodo === 'GET') return { payload: caixas } as T;
    if (caminho === '/inboxes' && metodo === 'POST') {
      const nova: Caixa = { id: proximo++, name: c.name, inbox_identifier: `ident-${proximo}`, webhook_url: c.channel.webhook_url };
      caixas.push(nova);
      return nova as T;
    }
    const m = caminho.match(/^\/inboxes\/(\d+)(\/set_agent_bot)?$/);
    const caixa = m && caixas.find((x) => x.id === Number(m[1]));
    if (caixa && m[2]) return null as T;
    if (caixa && metodo === 'PATCH') caixa.webhook_url = c.channel.webhook_url;
    if (caixa) return caixa as T;
    throw new Error(`rota desconhecida ${metodo} ${caminho}`);
  };

  const waha: ApiWaha = async <T,>(caminho: string, metodo = 'GET', corpo?: unknown, semErro404 = false) => {
    chamadas.push(`waha ${metodo} ${caminho}`);
    if (caminho === `/api/apps?session=${SESSAO}`) return structuredClone(apps) as T;
    if (caminho === '/api/apps' && metodo === 'POST') {
      if (inicio.falharApp) throw new Error('POST /api/apps → 500');
      apps.push(structuredClone(corpo) as App);
      return corpo as T;
    }
    const app = apps.findIndex((a) => caminho === `/api/apps/${a.id}`);
    if (app >= 0 && metodo === 'PUT') return (apps[app] = structuredClone(corpo) as App) as T;
    if (app >= 0 && metodo === 'DELETE') return apps.splice(app, 1) && (null as T);
    if (caminho === `/api/sessions/${SESSAO}`) {
      if (sessao === null && semErro404) return null as T;
      return { name: SESSAO, status: sessao } as T;
    }
    if (caminho === '/api/sessions' && metodo === 'POST') return (sessao = 'SCAN_QR_CODE') && (null as T);
    if (/\/(start|restart)$/.test(caminho)) return (sessao = 'STARTING') && (null as T);
    throw new Error(`rota desconhecida ${metodo} ${caminho}`);
  };

  return { cw, waha, bots, caixas, apps, chamadas, sessao: () => sessao };
}

const escritas = (chamadas: string[]) => chamadas.filter((c) => !c.includes(' GET ') && !c.endsWith('/set_agent_bot'));

describe('ligarWhatsApp', () => {
  it('instalação nova: cria bot, caixa, integração e sessão, tudo apontando um para o outro', async () => {
    const f = falsos();
    const { tokenBot } = await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(tokenBot).toBe('tok-bot');
    expect(f.bots).toMatchObject([{ name: NOME_BOT, outgoing_url: 'http://bot:3000/webhook/tok-webhook' }]);
    expect(f.caixas).toHaveLength(1);
    const [caixa] = f.caixas;
    expect(f.apps).toHaveLength(1);
    const [app] = f.apps;
    expect(app).toMatchObject({
      session: SESSAO,
      app: 'chatwoot',
      config: { accountId: 1, accountToken: 'tok-admin', inboxId: caixa!.id, inboxIdentifier: caixa!.inbox_identifier },
    });
    expect(caixa!.webhook_url).toBe(`http://waha:3000/webhooks/chatwoot/${SESSAO}/${app!.id}`);
    expect(f.sessao()).toBe('SCAN_QR_CODE');
  });

  it('rodar de novo não duplica nem mexe na integração (o WAHA reiniciaria a sessão)', async () => {
    const f = falsos();
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    f.chamadas.length = 0;
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(f.caixas).toHaveLength(1);
    expect(f.apps).toHaveLength(1);
    // Só o PATCH do webhook do bot, que é idempotente.
    expect(escritas(f.chamadas)).toEqual([`cw PATCH /agent_bots/${f.bots[0]!.id}`]);
  });

  it('vindo da Evolution: reaproveita a caixa e só troca o endereço dela', async () => {
    const f = falsos({ caixas: [{ id: 1, name: NOME_CAIXA, inbox_identifier: 'ident-1', webhook_url: 'http://evolution:8080/chatwoot/webhook/revgas' }] });
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(f.caixas).toHaveLength(1);
    expect(f.caixas[0]!.webhook_url).toBe(`http://waha:3000/webhooks/chatwoot/${SESSAO}/${f.apps[0]!.id}`);
    expect(f.apps[0]!.config).toMatchObject({ inboxId: 1, inboxIdentifier: 'ident-1' });
  });

  it('token trocado: atualiza a integração', async () => {
    const f = falsos();
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    const id = f.apps[0]!.id;
    f.chamadas.length = 0;
    await ligarWhatsApp(f.cw, f.waha, { ...opcoes, tokenAdmin: 'tok-novo' });
    expect(f.chamadas).toContain(`waha PUT /api/apps/${id}`);
    expect(f.apps).toMatchObject([{ id, config: { accountToken: 'tok-novo' } }]);
  });

  it('integração repetida (de teste, em outra caixa) é removida e fica a da caixa certa', async () => {
    const caixa = { id: 1, name: NOME_CAIXA, inbox_identifier: 'ident-1' };
    const outra = { id: 'app_teste', session: SESSAO, app: 'chatwoot', config: { inboxId: 2 } };
    const certa = { id: 'app_certa', session: SESSAO, app: 'chatwoot', config: { inboxId: 1 } };
    const f = falsos({ caixas: [caixa], apps: [outra, certa] });
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(f.apps.map((a) => a.id)).toEqual(['app_certa']);
    expect(f.caixas[0]!.webhook_url).toContain('/app_certa');
  });

  it('se a integração falha, a caixa não fica apontando para uma integração que não existe', async () => {
    const antigo = 'http://evolution:8080/chatwoot/webhook/revgas';
    const f = falsos({ caixas: [{ id: 1, name: NOME_CAIXA, inbox_identifier: 'ident-1', webhook_url: antigo }], falharApp: true });
    await expect(ligarWhatsApp(f.cw, f.waha, opcoes)).rejects.toThrow('/api/apps');
    expect(f.caixas[0]!.webhook_url).toBe(antigo);
  });

  it.each([
    ['STOPPED', 'start'],
    ['FAILED', 'restart'],
  ])('sessão %s é religada (%s)', async (status, acao) => {
    const f = falsos({ sessao: status });
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(f.chamadas).toContain(`waha POST /api/sessions/${SESSAO}/${acao}`);
  });

  it('sessão conectada não é mexida', async () => {
    const f = falsos({ sessao: 'WORKING' });
    await ligarWhatsApp(f.cw, f.waha, opcoes);
    expect(f.chamadas.some((c) => c.includes('/api/sessions') && !c.includes(' GET '))).toBe(false);
  });
});
