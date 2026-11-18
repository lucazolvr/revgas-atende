# RevGás Atende — Base Técnica: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot de pedidos de gás no WhatsApp (via Evolution → Chatwoot) que conduz o pedido, cria a venda na API RevGás e transfere para humano, rodando com `docker compose up`.

**Architecture:** Servidor Fastify recebe o webhook de Agent Bot do Chatwoot, carrega a sessão (Redis), passa o texto por um motor de conversa determinístico (que usa o Gemini só para interpretar) e devolve ações (responder, transferir) executadas pelo cliente do Chatwoot. Vendas passam por uma porta `ApiRevGas` com adaptador falso (padrão) e HTTP real.

**Tech Stack:** Node 22, TypeScript (ESM), Fastify 5, zod, @google/genai, ioredis, vitest, tsx. Docker: Chatwoot v4, Postgres pgvector, Redis 7, Evolution API v2.

**Spec:** `docs/superpowers/specs/2026-11-18-revgas-atende-design.md`

## Global Constraints

- Dinheiro em **centavos inteiros** internamente; vira número com 2 casas só no corpo JSON (`110.00` → `110`).
- Preço e `product_id` **só do catálogo** (`config/catalogo.json`), nunca da IA.
- Formas de pagamento: `PIX`, `MONEY`, `CARTAO_DE_DEBITO`, `CARTAO_DE_CREDITO`.
- Venda: `channel: "WHATSAPP"`, `origin: "INTEGRATION"`, `option: "NORMAL"`, `broadcast: "NONE"`.
- `Authorization: <REVGAS_API_KEY>` sem "Bearer"; 1 req/s; POST nunca repetido após timeout.
- Venda real só com `VENDA_REAL=true`; padrão é `ApiRevGasFalsa`.
- IA só para números em `NUMEROS_IA`; timeout 8 s; sem IA → menus numerados.
- Log (`dados/metricas.jsonl`) sem texto de mensagem, nome, telefone ou endereço.
- Textos ao cliente em pt-BR, curtos, cordiais.

## Review Focus

1. Cliente manda "1" duas vezes rápido no resumo (webhook duplicado) → só **uma** venda.
2. Mensagem chega numa conversa que já está com humano (`status: open`) → bot fica calado.
3. Gemini devolve JSON fora do schema ou quantidade absurda (0, 500) → tratado como "não entendi", não quebra.
4. "cheiro de gás" no meio do pedido (qualquer estado) → orientações + transferência urgente.
5. API RevGás timeout → nenhuma repetição, transfere com `verificar-venda`.

---

### Task 1: Esqueleto do projeto + catálogo e pedido

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `config/catalogo.json`, `config/seguranca.md`
- Create: `src/vendas/catalogo.ts`, `src/vendas/pedido.ts`
- Test: `tests/vendas/pedido.test.ts`

**Interfaces — Produces:**
- `type FormaPagamento = 'PIX'|'MONEY'|'CARTAO_DE_DEBITO'|'CARTAO_DE_CREDITO'`; `FORMAS_PAGAMENTO: {codigo: FormaPagamento, rotulo: string}[]` (ordem do menu)
- `type Produto = { codigo: string; productId: number; nome: string; precoCentavos: number }`; `carregarCatalogo(caminho?: string): Produto[]`
- `type Endereco = { logradouro: string; numero: string; bairro: string; cidade: string; uf: string; complemento?: string; referencia?: string }`
- `type Pedido = { telefone: string; nome?: string; produto?: string; quantidade?: number; endereco?: Partial<Endereco>; pagamento?: FormaPagamento; trocoParaCentavos?: number }`
- `totalCentavos(p: Pedido, cat: Produto[]): number`
- `corpoDaVenda(p: Pedido, cat: Produto[], ids: { clienteId: number; estabelecimentoId: number }): CorpoVenda` (formato da §6 do spec)
- `formatarReais(centavos: number): string` → `"R$ 220,00"`

- [ ] Testes: `totalCentavos` de 2 × botijão (11000) = 22000; `corpoDaVenda` gera `products:[{product_id:26717,quantity:2,value:110}]`, `payments:[{payment_type:"PIX",value:220}]`, os quatro campos fixos, `state_federation:"PI"`, e `observation` contendo nome, telefone e "Troco para R$ 200,00" quando `MONEY`; `formatarReais(22000) === "R$ 220,00"`.
- [ ] Rodar `npx vitest run tests/vendas` → falha; implementar; passa.
- [ ] Commit `feat: catálogo, pedido e corpo da venda`.

### Task 2: Porta ApiRevGas (falsa + HTTP) e registro da venda

**Files:**
- Create: `src/vendas/api-revgas.ts`, `src/vendas/registrar.ts`
- Test: `tests/vendas/api-revgas.test.ts`, `tests/vendas/registrar.test.ts`

**Interfaces — Produces:**
- `type Resposta = { status: number; dados: unknown }`; `class TempoEsgotado extends Error`
- `interface ApiRevGas { criarVenda(corpo: CorpoVenda): Promise<Resposta> }`
- `class ApiRevGasFalsa implements ApiRevGas` — guarda `vendas: CorpoVenda[]`, devolve 201 `{data:{id}}` com ids 1,2,3…; `proximaResposta?: Resposta | 'timeout'` para testes.
- `class ApiRevGasHttp implements ApiRevGas` — `constructor(url: string, chave: string, opts?: { fetch?: typeof fetch; intervaloMs?: number; timeoutMs?: number })` (padrões 1000 / 15000); `redirect: 'manual'`; espaça chamadas em ≥ `intervaloMs`.
- `type ResultadoRegistro = { tipo:'ok'; id:number } | { tipo:'invalida'; detalhe:string } | { tipo:'incerta' } | { tipo:'erro'; status:number }`
- `registrarVenda(api: ApiRevGas, corpo: CorpoVenda): Promise<ResultadoRegistro>` — 201 → ok (id de `dados.data.id` ou `dados.id`); 422 → invalida; `TempoEsgotado` → incerta; resto → erro. **Uma única chamada**, sem retry.

- [ ] Testes: Http envia `Authorization` cru e `Content-Type: application/json` para `${url}/sales` (fetch falso); duas chamadas seguidas com `intervaloMs: 50` têm ≥ 50 ms entre si; fetch que rejeita/aborta → `TempoEsgotado`; `registrarVenda` mapeia 201/422/timeout/500 e chama a API **uma vez** no timeout.
- [ ] Falha → implementar → passa. Commit `feat: porta ApiRevGas e registro de venda`.

### Task 3: Interpretação por IA (Gemini) com schema

**Files:**
- Create: `src/ia/interpretacao.ts`, `src/ia/gemini.ts`
- Test: `tests/ia/interpretacao.test.ts`

**Interfaces — Produces:**
- `INTENCOES = ['fazer_pedido','informar_dados','duvida','falar_com_humano','emergencia_gas','confirmar','corrigir','cancelar','saudacao','outro'] as const`; `type Intencao`
- `type Interpretacao = { intencao: Intencao; entidades: { nome?: string; produto?: string; quantidade?: number; endereco?: Partial<Endereco>; pagamento?: FormaPagamento; trocoParaCentavos?: number } }`
- `esquemaInterpretacao` (zod): quantidade inteira 1–20; produto ∈ códigos do catálogo; pagamento ∈ `FormaPagamento`.
- `validarInterpretacao(bruto: unknown, cat: Produto[]): Interpretacao | null` — campo inválido é **descartado**, não invalida o resto; intenção inválida → `null`.
- `interface Interpretador { interpretar(texto: string, estado: Estado): Promise<Interpretacao | null> }`
- `class InterpretadorGemini implements Interpretador` — `constructor(apiKey: string, cat: Produto[], opts?: { modelo?: string; timeoutMs?: number })` (padrões `gemini-2.5-flash`, 8000); `responseMimeType: 'application/json'` + `responseSchema`; qualquer erro/timeout → `null`.
- `class InterpretadorFalso implements Interpretador` — `constructor(respostas: Record<string, Interpretacao>)`.

- [ ] Testes de `validarInterpretacao`: JSON correto passa; `quantidade: 500` é descartada mantendo o endereço; `pagamento:"BITCOIN"` descartado; `intencao:"xyz"` → `null`; produto fora do catálogo descartado.
- [ ] Falha → implementar → passa. Commit `feat: interpretação de texto livre com Gemini`.

### Task 4: Motor da conversa

**Files:**
- Create: `src/conversa/mensagens.ts` (todos os textos), `src/conversa/emergencia.ts`, `src/conversa/motor.ts`
- Test: `tests/conversa/motor.test.ts`, `tests/conversa/emergencia.test.ts`

**Interfaces — Produces:**
- `type Estado = 'INICIO'|'NOME'|'PRODUTO'|'QUANTIDADE'|'ENDERECO'|'PAGAMENTO'|'TROCO'|'RESUMO'|'CORRIGIR'|'REGISTRADO'`
- `type Sessao = { estado: Estado; pedido: Pedido; falhas: number; vendaId?: number; registrando?: boolean }`; `novaSessao(telefone: string): Sessao`
- `type Acao = { tipo:'responder'; texto:string } | { tipo:'transferir'; motivo:'humano'|'vazamento'|'nao_entendi'|'verificar_venda'; resumo:string }`
- `type Deps = { catalogo: Produto[]; interpretador: Interpretador | null; registrar: (p: Pedido) => Promise<ResultadoRegistro> }`
- `processar(s: Sessao, texto: string, deps: Deps): Promise<{ sessao: Sessao; acoes: Acao[] }>`
- `ehEmergencia(texto: string): boolean` — normaliza acento/caixa; casa "cheiro de gas", "vazamento", "vazando", "ta vazando".
- `resumoParaAtendente(p: Pedido, cat: Produto[]): string`

Regras (ordem dentro de `processar`):
1. `ehEmergencia` **ou** intenção `emergencia_gas` → responder `config/seguranca.md` + transferir `vazamento`.
2. Intenção `falar_com_humano` ou texto "atendente"/"humano" → transferir `humano`.
3. Aplicar entidades da IA ao pedido; depois aplicar a entrada do estado atual (menu numerado ou texto).
4. Ir para o **primeiro campo faltante** (nome → produto → quantidade → endereço [logradouro, número, bairro, cidade, uf] → pagamento → troco se MONEY) ou `RESUMO`.
5. Entrada não aproveitada → `falhas++`; com `falhas >= 2` → transferir `nao_entendi`; qualquer avanço zera `falhas`.
6. `RESUMO`: "1"/confirmar → se `vendaId` ou `registrando` já existe, só repete o número; senão `registrar` → ok: `vendaId`, estado `REGISTRADO`, mensagem com nº; incerta: transferir `verificar_venda`; invalida/erro: transferir `nao_entendi`. "2" → `CORRIGIR` (menu: 1 nome, 2 produto/quantidade, 3 endereço, 4 pagamento → limpa o campo e volta ao passo 4). "3" → cancela e volta a `INICIO`.
7. `REGISTRADO` + nova mensagem → nova sessão (novo pedido).

- [ ] Testes (com `InterpretadorFalso` e `registrar` espião):
  - fluxo por menu completo até `REGISTRADO`, `registrar` chamado 1×;
  - texto livre "manda 2 botijão pra Rua Nova 10, Centro, Teresina PI, pago no pix" preenche tudo e só pede o nome;
  - "1" duas vezes no resumo → `registrar` chamado 1×;
  - "tô sentindo cheiro de gás" no estado `ENDERECO` → acao `transferir` `vazamento`;
  - duas entradas inválidas seguidas em `QUANTIDADE` → `transferir` `nao_entendi`;
  - `registrar` devolve `incerta` → `transferir` `verificar_venda`;
  - `interpretador: null` funciona com menus;
  - `ehEmergencia("CHEIRO DE GÁS")` true; `ehEmergencia("quero gás")` false.
- [ ] Falha → implementar → passa. Commit `feat: motor da conversa`.

### Task 5: Canal Chatwoot, sessões e servidor

**Files:**
- Create: `src/config.ts`, `src/canal/chatwoot.ts`, `src/conversa/sessoes.ts`, `src/metricas.ts`, `src/servidor.ts`, `src/index.ts`
- Test: `tests/canal/chatwoot.test.ts`, `tests/servidor.test.ts`

**Interfaces — Produces:**
- `carregarConfig(env = process.env): Config` (zod): `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_BOT_TOKEN`, `BOT_WEBHOOK_TOKEN`, `REDIS_URL?`, `GEMINI_API_KEY?`, `NUMEROS_IA` (csv, só dígitos), `VENDA_REAL` (bool, padrão false), `REVGAS_API_URL` (padrão `https://api.revgas.com/v1`), `REVGAS_API_KEY`/`REVGAS_CLIENTE_DEMO`/`REVGAS_ESTABELECIMENTO` **obrigatórios quando `VENDA_REAL`**.
- `extrairMensagem(payload: unknown): { conversaId: number; telefone: string; texto: string } | null` — só `event === 'message_created'`, `message_type === 'incoming'`, `private !== true`, `conversation.status === 'pending'`, texto não vazio; telefone de `conversation.meta.sender.phone_number ?? sender.phone_number`, só dígitos.
- `class ClienteChatwoot` — `constructor(url, accountId, token, fetchFn = fetch)`; `responder(id, texto)`; `nota(id, texto)` (`private: true`); `etiquetar(id, labels: string[])`; `transferir(id, prioridade?: 'urgent'|'high')` (`toggle_status` → `open`, e `toggle_priority` se dada). Header `api_access_token`.
- `interface Sessoes { obter(id: number): Promise<Sessao | null>; salvar(id: number, s: Sessao): Promise<void> }`; `SessoesMemoria`, `SessoesRedis(url, ttlSegundos = 7200)`.
- `registrarEvento(e: { conversaId: number; tipo: string; estado?: Estado; ms?: number; ia?: boolean }): void` → `dados/metricas.jsonl`.
- `criarServidor(deps: { config, chatwoot, sessoes, catalogo, interpretadorPara(telefone): Interpretador|null, api: ApiRevGas }): FastifyInstance` — `GET /saude` → `{ok:true}`; `POST /webhook/:token` → 404 se token errado; responde 200 **imediatamente** e processa em fila **por conversa** (promessa encadeada por `conversaId`, evita corrida do item 1 do Review Focus).
- Ação `transferir`: `nota(resumo)` → `etiquetar` (`vazamento`+`urgente` / `humano` / `pedido-incompleto` / `verificar-venda`) → `transferir` (`urgent` para vazamento) → responder "Um atendente vai falar com você agora."

- [ ] Testes: `extrairMensagem` ignora outgoing, private, status `open`, evento diferente; `ClienteChatwoot.transferir(7,'urgent')` faz os dois POSTs certos; servidor com `fastify.inject`: token errado → 404; duas mensagens "1" simultâneas no resumo → `ApiRevGasFalsa.vendas.length === 1`; IA só ativa para número em `NUMEROS_IA`.
- [ ] `src/index.ts`: monta tudo, imprime **`⚠ VENDA REAL LIGADA`** quando aplicável, escuta `0.0.0.0:3000` (só exposto na rede do Docker).
- [ ] Falha → implementar → passa. `npx tsc --noEmit` limpo. Commit `feat: canal Chatwoot, sessões e servidor`.

### Task 6: Docker Compose, setup e README

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `scripts/setup.ts`, `README.md`, `CONTRIBUTING.md`

- `docker-compose.yml`: `postgres` (`pgvector/pgvector:pg16`), `redis` (`redis:7-alpine`), `chatwoot` + `chatwoot-sidekiq` (`chatwoot/chatwoot:v4.x` fixada), `evolution` (`evoapicloud/evolution-api:v2.x` fixada), `bot` (build local). Portas no host só em `127.0.0.1` (Chatwoot 3000→`127.0.0.1:3000`, Evolution `127.0.0.1:8080`); bot sem porta publicada.
- `scripts/setup.ts` (`npm run setup`, idempotente): cria Agent Bot "RevGás Atende" com `outgoing_url = http://bot:3000/webhook/$BOT_WEBHOOK_TOKEN`; cria instância Evolution `revgas`; chama `POST /chatwoot/set/revgas` com `conversationPending: true`, `autoCreate: true`, `nameInbox: "WhatsApp RevGás"`; liga o Agent Bot à caixa (`set_agent_bot`); imprime o token do bot para o `.env`.
- README: o que é, arquitetura (mermaid do spec), como rodar (passo a passo do QR code), roteiro da demo, equipe (Lucas, Eduardo, João Vitor, Luiza).
- CONTRIBUTING: branch por issue (`feat/<nº>-nome`), Conventional Commits, PR com `npm test` verde.
- [ ] `docker compose config` sem erro (quando houver Docker); `npm test` e `npx tsc --noEmit` verdes. Commit `chore: docker compose, setup e documentação`.

### Fora deste plano (viram issues da equipe)

- **Eduardo** — RAG da FAQ (`src/conhecimento/`, intenção `duvida`).
- **Lucas** — conjunto rotulado + `npm run eval` + simulação ponta a ponta + experimento com/sem IA.
- **Luiza** — teste com usuários (SUS), roteiro da demo, relatório.
- **João Vitor** — validação da venda real com os IDs confirmados + deploy opcional em VPS.
