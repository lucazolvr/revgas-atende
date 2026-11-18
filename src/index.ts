import { ClienteChatwoot } from './canal/chatwoot.js';
import { carregarConfig } from './config.js';
import { SessoesMemoria, SessoesRedis } from './conversa/sessoes.js';
import { InterpretadorGemini } from './ia/gemini.js';
import { criarServidor } from './servidor.js';
import { ApiRevGasFalsa, ApiRevGasHttp, type ApiRevGas } from './vendas/api-revgas.js';
import { carregarCatalogo } from './vendas/catalogo.js';
import { corpoDaVenda } from './vendas/pedido.js';
import { registrarVenda } from './vendas/registrar.js';

const config = carregarConfig();
const catalogo = carregarCatalogo();

let api: ApiRevGas;
if (config.VENDA_REAL) {
  api = new ApiRevGasHttp(config.REVGAS_API_URL, config.REVGAS_API_KEY!);
  console.warn('\n⚠  VENDA REAL LIGADA: cada pedido confirmado cria uma venda de verdade no ERP RevGás.\n');
} else {
  api = new ApiRevGasFalsa();
  console.log('API RevGás de teste (em memória). Para vender de verdade: VENDA_REAL=true.');
}
const ids = { clienteId: config.REVGAS_CLIENTE_DEMO ?? 0, estabelecimentoId: config.REVGAS_ESTABELECIMENTO ?? 0 };

const gemini = config.GEMINI_API_KEY ? new InterpretadorGemini(config.GEMINI_API_KEY, catalogo) : null;
if (!gemini) console.log('Sem GEMINI_API_KEY: o bot atende só pelos menus.');

const { app, ocioso } = criarServidor({
  webhookToken: config.BOT_WEBHOOK_TOKEN,
  chatwoot: new ClienteChatwoot(config.CHATWOOT_URL, config.CHATWOOT_ACCOUNT_ID, config.CHATWOOT_BOT_TOKEN),
  sessoes: config.REDIS_URL ? new SessoesRedis(config.REDIS_URL) : new SessoesMemoria(),
  catalogo,
  // Cota grátis do Gemini pode usar os dados para treino: IA só para os números da equipe.
  interpretadorPara: (telefone) => (gemini && config.NUMEROS_IA.includes(telefone) ? gemini : null),
  registrar: (p) => registrarVenda(api, corpoDaVenda(p, catalogo, ids)),
});

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, async () => {
    await app.close();
    await ocioso();
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port: config.PORTA });
console.log(`RevGás Atende ouvindo na porta ${config.PORTA}.`);
