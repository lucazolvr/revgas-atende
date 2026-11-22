import { Redis } from 'ioredis';
import { ClienteChatwoot } from './canal/chatwoot.js';
import { carregarConfig, chaveTelefone } from './config.js';
import { SessoesMemoria, SessoesRedis } from './conversa/sessoes.js';
import { InterpretadorGemini } from './ia/gemini.js';
import { ConhecimentoGemini } from './conhecimento/gemini.js';
import { criarServidor } from './servidor.js';
import { configurarMetricas } from './metricas.js';
import { RegistroPedidosMemoria, RegistroPedidosRedis } from './painel/pedidos.js';
import { registrarPainel } from './painel/rotas.js';
import { ApiRevGasFalsa, ApiRevGasHttp, type ApiRevGas, type ConsultaVendas } from './vendas/api-revgas.js';
import { carregarCatalogo } from './vendas/catalogo.js';
import { corpoDaVenda } from './vendas/pedido.js';
import { registrarVenda } from './vendas/registrar.js';

const config = carregarConfig();
for (const aviso of config.avisos) console.warn(`⚠  ${aviso}`);
configurarMetricas(config.METRICAS_RETENCAO_DIAS);
const catalogo = carregarCatalogo();

let api: ApiRevGas & ConsultaVendas;
if (config.VENDA_REAL) {
  api = new ApiRevGasHttp(config.REVGAS_API_URL, config.REVGAS_API_KEY!);
  console.warn('\n⚠  VENDA REAL LIGADA: cada pedido confirmado cria uma venda de verdade no ERP RevGás.\n');
} else {
  api = new ApiRevGasFalsa();
  console.log('API RevGás de teste (em memória). Para vender de verdade: VENDA_REAL=true.');
}
const ids = { clienteId: config.REVGAS_CLIENTE_DEMO ?? 0, estabelecimentoId: config.REVGAS_ESTABELECIMENTO ?? 0 };

const gemini = config.GEMINI_API_KEY ? new InterpretadorGemini(config.GEMINI_API_KEY, catalogo, { modelo: config.GEMINI_MODELO }) : null;
const conhecimento = config.GEMINI_API_KEY
  ? await ConhecimentoGemini.criar(config.GEMINI_API_KEY, catalogo, { modelo: config.GEMINI_MODELO }).catch((erro: unknown) => {
    console.warn(`FAQ sem IA: ${erro instanceof Error ? erro.message : 'falha ao indexar'}`);
    return null;
  })
  : null;
if (!gemini) console.log('Sem GEMINI_API_KEY: o bot atende só pelos menus.');
const iaParaTodos = config.NUMEROS_IA.includes('*');
if (gemini && iaParaTodos) console.warn('⚠  IA PARA TODOS OS NÚMEROS (NUMEROS_IA=*): na cota grátis, o Google pode usar as mensagens.');

// Uma conexão só com o Redis, dividida entre as sessões e o registro de pedidos do painel.
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL) : null;
const chatwoot = new ClienteChatwoot(config.CHATWOOT_URL, config.CHATWOOT_ACCOUNT_ID, config.CHATWOOT_BOT_TOKEN);
// Pedidos do dia (nome e endereço): só guardados se o painel que os mostra estiver ligado.
// Com o ERP de demonstração (em memória), o registro também fica em memória: os dois zeram juntos
// quando o bot reinicia. No Redis, a "venda 1" de antes do reinício se misturava com a nova venda 1.
const pedidos = config.PAINEL_TOKEN
  ? config.VENDA_REAL && redis
    ? new RegistroPedidosRedis(redis)
    : new RegistroPedidosMemoria()
  : undefined;
const { app, ocioso } = criarServidor({
  webhookToken: config.BOT_WEBHOOK_TOKEN,
  chatwoot,
  sessoes: redis ? new SessoesRedis(redis) : new SessoesMemoria(),
  catalogo,
  // Cota grátis do Gemini pode usar os dados para treino: a lista limita a IA (ou "*" para todos).
  interpretadorPara: (telefone) =>
    gemini && (iaParaTodos || config.NUMEROS_IA.includes(chaveTelefone(telefone))) ? gemini : null,
  responderDuvida: (texto) => conhecimento?.responder(texto) ?? Promise.resolve(null),
  registrar: (p) => registrarVenda(api, corpoDaVenda(p, catalogo, ids)),
  pedidos,
});

if (config.PAINEL_TOKEN && pedidos) {
  registrarPainel(app, {
    token: config.PAINEL_TOKEN,
    origensChatwoot: config.PAINEL_ORIGENS,
    chatwoot,
    pedidos,
    vendas: api,
    estabelecimentoId: ids.estabelecimentoId,
    modo: config.VENDA_REAL ? 'teste' : 'memoria',
  });
  console.log('Painel "Pedido RevGás" ligado: aba nas conversas e "Pedidos de hoje" no menu do Chatwoot.');
}

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, async () => {
    await app.close();
    await ocioso();
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port: config.PORTA });
console.log(`RevGás Atende ouvindo na porta ${config.PORTA}.`);
