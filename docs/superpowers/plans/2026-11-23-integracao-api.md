# RevGás Atende v2 — Integração com a API: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer da máquina de estados o centro do bot, com pedido, acompanhamento e cancelamento ligados à API RevGás. A IA vira último recurso, as requisições ficam registradas no Postgres e aparecem no painel do Chatwoot e no Metabase.

**Architecture:** O cliente HTTP da API (`ApiRevGasHttp`) ganha consultas de vendas por telefone, histórico, produtos e situação da revenda, com cache de 5 min e um gancho que registra cada chamada. O servidor monta essas consultas por mensagem e as passa ao motor (`processar`) como dependências. O motor continua sem rede e testável com `ApiRevGasFalsa`. O Postgres recebe só dados sem informação pessoal (chamadas e eventos), que o Metabase lê com um usuário só leitura.

**Tech Stack:** Node 22, TypeScript (ESM), Fastify 5, ioredis, vitest. Novo: `pg` (gravar no Postgres) e o contêiner `metabase/metabase`.

**Spec:** `docs/superpowers/specs/2026-11-23-integracao-api-design.md`

## Equipe e ordem

| Bloco | Tarefas | Responsável | Depende de |
|---|---|---|---|
| Base | 0, 1 | **Lucas** | — (fazer primeiro, de preferência no 1º dia) |
| Conversa (menu, acompanhar, cancelar, estoque) | 3, 4 | **João Vitor** | 1 |
| Conversa sem IA (regras, FAQ, IA por último) | 5, 6 | **Eduardo** | — (só usa o motor; a 5 vem antes da 3 no `motor.ts`, combinar a ordem dos merges) |
| Persistência e painel do Chatwoot | 2, 7 | **Lucas** | 1 |
| Metabase, roteiro e relatório | 8, 9 | **Luiza** | 2 (para dados reais; a 8 pode começar com a tabela vazia) |

Fluxo de trabalho:
- Uma branch e um PR por tarefa, partindo da `main` depois que a Tarefa 1 entrar.
- O Lucas revisa os PRs.
- As tarefas 3 e 5 mexem no `motor.ts`: quem fizer o merge depois resolve o conflito.

## Global Constraints

- **1 req/s** à API pela fila do `ApiRevGasHttp`. Filas: `venda` (criar venda) passa na frente de `consulta` (todo o resto; hoje se chama `painel`, renomear).
- `GET /products` e `GET /establishments/{id}`: cache de **5 minutos** em memória.
- Busca de vendas por telefone: no máximo **2 páginas de `page_size=50`**. Comentário `shortcut:` até a liberação de `/customers`.
- Venda "do bot" = `establishment_id === REVGAS_ESTABELECIMENTO` **e** `observation` contém `RevGás Atende`.
- O cliente só vê ou cancela vendas cujo telefone na `observation` bate com o dele (`chaveTelefone`).
- "Cancelado" só é dito depois de HTTP 200/204 do `PUT /sales/{id}/cancel`.
- Preço e código só do `config/catalogo.json`. Da API vêm estoque, `inactive` e situação.
- Sem nome, telefone, endereço ou texto de mensagem em log, métricas, `revgas.chamadas_api` ou `revgas.eventos`.
- Falha de consulta à API ou do Postgres nunca trava o atendimento (melhor esforço, com aviso no log).
- Textos ao cliente em pt-BR, curtos e cordiais, todos em `src/conversa/mensagens.ts`.
- Tudo testado com `ApiRevGasFalsa`, sem rede: `npx tsc --noEmit -p .` e `npx vitest run` passando em todo PR.

## Review Focus

1. Produto esgota no meio do pedido (estoque 0 entre o menu e o resumo) → o bot pede outro produto, sem quebrar no resumo. Teste na Tarefa 4.
2. API fora do ar ou lenta ao listar ou cancelar → mensagem clara e transferência, nunca "cancelado". Teste na Tarefa 3.
3. Venda cancelada pelo atendente entre a lista e o "sim" do cliente → "Esse pedido já estava cancelado." Teste na Tarefa 3.
4. Cliente digita "3" no menu de cancelar sem ter pedido ativo, ou um número fora da lista → resposta clara e volta ao menu. Nenhuma chamada de cancelamento. Teste na Tarefa 3.
5. Mensagem com pedido completo e endereço sem IA ("2 botijão no pix pra Rua Nova, 10, Centro, Teresina") → preenche tudo e pula as perguntas. Teste na Tarefa 5.

---

### Task 0: Base da v2 (Lucas)

Já existe sem commit na `main` local:
- o reconhecimento de cliente (`clienteDaVenda`, `ultimoCliente`, `boasVindasDeVolta`, testes);
- a reserva de modelos de IA (`gerarComReserva`, `tests/ia/reserva.test.ts`).

- [ ] **Step 1:** Criar a branch `feat/v2-base`, rodar `npx tsc --noEmit -p .` e `npx vitest run` (esperado: 178 testes passando).
- [ ] **Step 2:** Commitar os dois blocos separados (`feat(vendas): reconhece cliente pelo histórico de vendas da API` e `feat(ia): modelos de reserva, inclusive OpenAI`), mais a spec e este plano (`docs: requisitos e plano da v2`). Abrir o PR.

### Task 1: Cliente da API v2 (Lucas)

**Files:**
- Modify: `src/vendas/api-revgas.ts`, `src/vendas/pedido.ts`
- Test: `tests/vendas/api-revgas.test.ts`

**Interfaces (Produces), em `src/vendas/api-revgas.ts`:**

```ts
export type VendaResumo = { id: number; data: string; status: string; total: number; endereco: string; pago: boolean; doBot: boolean };
export type HistoricoVenda = VendaResumo & { logs: { status: string; quando: string }[] };
export type ProdutoErp = { id: number; descricao: string; estoque: number; ativo: boolean };
export type SituacaoRevenda = { aceitaPedido: boolean; permiteCancelar: boolean };
export type ChamadaApi = { metodo: string; rota: string; status: number | null; ms: number; vendaId: number | null; fila: 'venda' | 'consulta' };

export interface BuscaCliente {
  ultimoCliente(telefone: string): Promise<Pick<Pedido, 'nome' | 'endereco'> | null>; // já existe
  /** Vendas ACTIVE do bot com esse telefone, mais recentes primeiro, no máximo 5. */
  vendasDoCliente(telefone: string): Promise<VendaResumo[]>;
}
export interface ConsultaVendas {
  detalharVenda(id: number): Promise<Resposta>;   // já existe
  cancelarVenda(id: number): Promise<Resposta>;   // já existe
  historico(id: number): Promise<HistoricoVenda | null>; // null = 404 ou não é do bot
  /** Vendas do bot cuja `date` cai no dia (AAAA-MM-DD, fuso America/Fortaleza), ativas e canceladas. */
  vendasDoBot(dia: string): Promise<VendaResumo[]>;
}
export interface ConsultaErp {
  produtos(): Promise<ProdutoErp[]>;      // cache 5 min
  situacao(): Promise<SituacaoRevenda>;   // cache 5 min
}
```

- `ApiRevGasHttp` ganha a opção `aoChamar?: (c: ChamadaApi) => void`, chamada em `enviar` com a rota sem query e com números trocados por `:id` (`/sales/30989017/cancel` → `/sales/:id/cancel`). Quando há timeout, `status` vai como `null`.
- `ApiRevGasFalsa` implementa as três interfaces, com os campos públicos `produtosErp: ProdutoErp[]` e `situacaoErp: SituacaoRevenda` para os testes. Uma venda cancelada passa a `CANCEL` no `historico`, e os `logs` começam com `OPEN`.
- Mapeamento de uma venda da API para `VendaResumo`: `id`, `date`, `status`, `total`, `short_address` (ou `display_address`), `paid` e `doBot` (regra das Global Constraints).

- [ ] **Step 1: Testes que falham** em `tests/vendas/api-revgas.test.ts`, com `fetch` falso:
  - `vendasDoCliente` só devolve vendas `ACTIVE`, do estabelecimento configurado, com a marca e o telefone (com ou sem o 9); no máximo 5, mais recentes primeiro. A primeira chamada é `GET /sales?status=ACTIVE&page_size=50&page=1`.
  - `historico` devolve `logs` como `{ status, quando }`. Venda de outro estabelecimento → `null`.
  - `vendasDoBot('2026-11-23')` inclui uma venda das 23h30 de 23/11 em Fortaleza (02:30Z do dia 24) e exclui as de 22/11.
  - `produtos()` duas vezes seguidas → **uma** chamada de `fetch`. Passados 5 min (relógio injetado com a opção `agora`) → nova chamada.
  - `aoChamar` recebe `{ metodo: 'PUT', rota: '/sales/:id/cancel', status: 204, vendaId: 7, fila: 'consulta' }`.
- [ ] **Step 2:** `npx vitest run tests/vendas/api-revgas.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. Renomear a fila `painel` para `consulta`.
- [ ] **Step 4:** Antes do merge, uma vez, rodar uma sonda **só leitura** com a chave real e listar os valores de `status` que aparecem nos `logs` das vendas recentes. Anotar no PR, porque a Tarefa 3 usa essa lista.
- [ ] **Step 5:** Testes e typecheck passando → commit `feat(vendas): consultas de vendas, histórico, produtos e situação da revenda`.

### Task 2: Registro no Postgres (Lucas)

**Files:**
- Create: `scripts/revgas-db.sql`, `src/dados/postgres.ts`, `tests/dados/postgres.test.ts`
- Modify: `docker-compose.yml`, `.env.example`, `src/metricas.ts`, `src/index.ts`, `package.json` (`pg` e `@types/pg`)

**Interfaces:**
- Consumes: `ChamadaApi` (Tarefa 1) e `Evento` (`src/metricas.ts`).
- Produces:
  - `criarRegistroPostgres(url: string): { chamada(c: ChamadaApi): void; evento(e: Evento): void; fechar(): Promise<void> }`. Cada chamada é um `INSERT` sem `await` para quem chama; um erro vira só um `console.warn`.
  - `configurarMetricas(dias: number, aoRegistrar?: (e: Evento) => void)`.
  - Os tipos de `Evento.tipo` ganham `'acompanhar' | 'cancelamento' | 'cliente_reconhecido'`.

**Banco** (`scripts/revgas-db.sql`, idempotente, roda no novo serviço de uma vez só `revgas-db`, no padrão do `chatwoot-ajustes`):
- `CREATE SCHEMA IF NOT EXISTS revgas`;
- `revgas.chamadas_api(id bigserial pk, em timestamptz default now(), metodo text, rota text, status int, ms int, venda_id bigint, fila text)`;
- `revgas.eventos(id bigserial pk, em timestamptz default now(), conversa_id int, tipo text, estado text, motivo text, resultado text, ms int, ia boolean)`;
- papel `revgas_bot` (senha `REVGAS_DB_SENHA`): `USAGE` no schema, mais `INSERT` e `SELECT` nas tabelas e sequências;
- papel `metabase_leitura` (senha `METABASE_DB_SENHA`): `USAGE` e só `SELECT` em `revgas`, sem nenhum acesso aos bancos do Chatwoot.

Em `servidor.ts`, quando `clienteAnterior` achar o cliente, registrar `tipo: 'cliente_reconhecido'`.

O bot recebe `DATABASE_URL=postgres://revgas_bot:${REVGAS_DB_SENHA}@postgres:5432/postgres`. Sem `DATABASE_URL`, o registro fica desligado. Ligar o `aoChamar` do `ApiRevGasHttp` e o `aoRegistrar` das métricas em `src/index.ts`.

- [ ] **Step 1: Teste que falha** `tests/dados/postgres.test.ts`, com um `Pool` falso (injetado como segundo parâmetro opcional): `chamada(...)` gera `INSERT INTO revgas.chamadas_api` com os 6 valores na ordem. Um `query` que rejeita não lança erro para quem chamou.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** `docker compose up -d --build`, fazer um pedido de teste e conferir com `docker compose exec postgres psql -U postgres -c "select rota, status from revgas.chamadas_api order by id desc limit 5"`. Deve mostrar `/sales` com 201.
- [ ] **Step 4:** Commit `feat(dados): chamadas à API e eventos no Postgres`.

### Task 3: Menu principal, acompanhar e cancelar (João Vitor)

**Files:**
- Modify: `src/conversa/motor.ts`, `src/conversa/mensagens.ts`, `src/servidor.ts`
- Test: `tests/conversa/motor.test.ts`, `tests/servidor.test.ts`

**Interfaces:**
- Consumes: `VendaResumo`, `HistoricoVenda`, `SituacaoRevenda` e `BuscaCliente`/`ConsultaVendas`/`ConsultaErp` (Tarefa 1).
- Produces:
  - `Estado` ganha `'MENU' | 'ACOMPANHAR' | 'CANCELAR' | 'CONFIRMA_CANCELAR' | 'DUVIDA'`.
  - `Sessao` ganha `opcoes?: number[]` (ids de venda listados) e `cancelarId?: number`.
  - `Deps` ganha:
    - `vendasDoCliente?: () => Promise<VendaResumo[]>`;
    - `historico?: (id: number) => Promise<HistoricoVenda | null>`;
    - `cancelar?: (id: number) => Promise<'ok' | 'ja_cancelada' | 'falha'>`;
    - `situacao?: SituacaoRevenda`.
  - O servidor amarra essas funções ao telefone da mensagem. O `cancelar` consulta o `historico` antes: se já estiver `CANCEL`, devolve `'ja_cancelada'`; se o `PUT` responder 200 ou 204, devolve `'ok'`; qualquer outra coisa, inclusive `TempoEsgotado`, devolve `'falha'`.
  - O servidor registra `tipo: 'acompanhar'` quando o motor chama `historico`, e `tipo: 'cancelamento', resultado: 'cliente'` quando `cancelar` devolve `'ok'`.
  - Novo `MotivoTransferencia`: `'erro_cancelamento'`, com a descrição "cancelamento não confirmado pela API — conferir no ERP".

**Regras:**
- **INICIO:**
  - mensagem com cara de pedido (`/gas|botij|bujao|p13|p45|agua|pedido|quero|manda/`, depois de `normalizar`) ou com algo extraído pelas regras da Tarefa 5 → fluxo de pedido, como hoje;
  - `/acompanh|status|cade|onde esta/` → ACOMPANHAR;
  - `pedeCancelar` → CANCELAR;
  - qualquer outra coisa → saudação (a de volta, se reconhecido) + `M.MENU_PRINCIPAL`, estado `MENU`.
- **MENU:** 1 pedido (próximo campo que falta) · 2 acompanhar · 3 cancelar · 4 `DUVIDA` ("Pode perguntar! 🙂") · 5 transferir `humano`.
- **Em qualquer estado**, `/^(menu|voltar)$/` → MENU.
- **Acompanhar:**
  - 0 vendas → `M.SEM_PEDIDO_ATIVO` + menu;
  - 1 venda → `M.detalhePedido(historico)`;
  - várias → `M.listaPedidos(vendas)`, estado `ACOMPANHAR`, guardando `opcoes`; o número escolhido dá o detalhe.
- **Cancelar:**
  - mesma lista;
  - com `situacao.permiteCancelar === false` → transferir `humano`;
  - escolha → `M.confirmaCancelar(venda)`, estado `CONFIRMA_CANCELAR`;
  - "1" → `cancelar(id)`: `'ok'` → `M.pedidoCancelado(id)`; `'ja_cancelada'` → `M.JA_CANCELADO`; `'falha'` → transferir `erro_cancelamento`;
  - "2" → menu.
- **Status em português** (`M.STATUS`): `OPEN` → "Recebido", `ACTIVE` → "Em andamento", `CANCEL` → "Cancelado". Os outros status vêm da sonda da Tarefa 1; um status desconhecido aparece como "Em andamento".

**Textos** (`mensagens.ts`):
- `MENU_PRINCIPAL = 'Como posso ajudar?\n1 - Fazer pedido\n2 - Acompanhar meu pedido\n3 - Cancelar um pedido\n4 - Tirar uma dúvida\n5 - Falar com um atendente'`
- `SEM_PEDIDO_ATIVO = 'Não encontrei pedido em aberto neste número.'`
- `JA_CANCELADO = 'Esse pedido já estava cancelado.'`
- `listaPedidos(v)`: `'Seus pedidos em aberto:\n' + v.map((x, i) => \`${i + 1} - nº ${x.id} · ${dataCurta} · ${reais} · ${x.endereco}\`)` + `'\nQual deles?'`
- `confirmaCancelar(v)`: `Cancelar o pedido nº ${v.id} (${reais})?\n1 - Sim\n2 - Não`
- `pedidoCancelado(id)`: `Pedido nº ${id} cancelado. ✅`

- [ ] **Step 1: Testes que falham** (`motor.test.ts`):
  - "oi" sem histórico → menu principal;
  - "2" com uma venda → detalhe com "Recebido";
  - "3", "1", "1" → `cancelar` chamado uma vez e "cancelado";
  - `cancelar` devolve `'ja_cancelada'` → `JA_CANCELADO`;
  - `'falha'` → ação `transferir` com motivo `erro_cancelamento` e nenhuma mensagem com "cancelado";
  - "3" sem vendas → `SEM_PEDIDO_ATIVO`, sem chamar `cancelar`;
  - "9" com 2 vendas listadas → não entendi, sem chamar `cancelar`;
  - "menu" no meio do pedido → menu principal, com o pedido preservado;
  - "quero 2 botijão" no INICIO → pergunta do próximo campo, sem menu.
- [ ] **Step 2:** FAIL → implementar → PASS. Ajustar os testes antigos que esperavam `BOAS_VINDAS` direto no "oi".
- [ ] **Step 3:** Teste no `servidor.test.ts`: depois de uma venda na conversa 7, "cancelar" na conversa 9 (mesmo telefone), seguido de "1" e "1", deixa `api.canceladas` com a venda 1.
- [ ] **Step 4:** Commit `feat(conversa): menu principal, acompanhar e cancelar pelo WhatsApp`.

### Task 4: Produtos, estoque e revenda aberta (João Vitor)

**Files:**
- Modify: `src/conversa/motor.ts`, `src/conversa/mensagens.ts`, `src/servidor.ts`, `config/catalogo.json`
- Test: `tests/conversa/motor.test.ts`

**Interfaces:**
- Consumes: `ConsultaErp.produtos/situacao` (Tarefa 1).
- Produces:
  - `Deps.estoque?: Record<string, number>` (código do catálogo → `stock_quantity`; código ausente = sem limite conhecido). O servidor monta isso a cada mensagem com `produtos()` (cache) e o `productId` do catálogo; produto `ativo: false` conta como estoque 0.
  - `Deps.situacao` já vem da Tarefa 3.

**Regras:**
- `M.menuProdutos` lista só os produtos com estoque maior que zero ou desconhecido. Nenhum disponível → `M.SEM_PRODUTOS` ("No momento estamos sem produtos disponíveis.") e transferir `humano`.
- Quantidade acima do estoque → `M.semEstoque(n)` (`Só temos ${n} em estoque. Quantas você quer?`), mantendo o estado `QUANTIDADE`.
- `proximoEstado`: um produto escolhido que ficou com estoque 0 é apagado do pedido, e o bot volta a `PRODUTO`.
- `situacao.aceitaPedido === false` ao escolher "fazer pedido" → `M.REVENDA_FECHADA` ("No momento a revenda não está recebendo pedidos pelo WhatsApp.") + menu.
- Catálogo: adicionar `{ "codigo": "P45", "productId": 23974, "nome": "Botijão de gás P45" }` e `{ "codigo": "AGUA20", "productId": 26255, "nome": "Água mineral 20L" }`, com o `precoCentavos` que a equipe definir.

- [ ] **Step 1: Testes que falham:**
  - estoque `{ P13: 0, P45: 3 }` → menu sem P13;
  - quantidade 5 com estoque 3 → "Só temos 3";
  - P13 escolhido e estoque passa a 0 antes do resumo → volta a "Qual produto?";
  - `aceitaPedido: false` → `REVENDA_FECHADA`;
  - todos com estoque 0 → transferir.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(conversa): produtos e estoque vindos da API`.

### Task 5: Regras antes da IA (Eduardo)

**Files:**
- Create: `src/conversa/regras.ts`, `tests/conversa/regras.test.ts`
- Modify: `src/conversa/motor.ts`

**Interfaces (Produces):**
- `extrairRegras(texto: string, cat: Produto[]): Partial<Pick<Pedido, 'produto' | 'quantidade' | 'pagamento' | 'trocoParaCentavos'>>`
- `separarEndereco(texto: string): Partial<Endereco> | null`: com 3 ou mais partes separadas por vírgula, a ordem é rua, número, bairro, cidade e UF opcional (reusar `separarCidadeUf`). Caso contrário, `null`.
- `numeroPorExtenso(palavra: string): number | null` (um/uma a dez).

**Regras do motor (nova ordem):**
1. `extrairRegras`. Se o estado for `ENDERECO` e for o primeiro campo, também `separarEndereco`.
2. `aplicarTexto` (o de hoje).
3. **Só se nada avançou** e houver `interpretador` → IA.
4. Senão → falha, como hoje.

Mensagem só com números nunca vai para a IA (já é assim).

- [ ] **Step 1: Testes que falham** (`regras.test.ts`):
  - `extrairRegras('2 botijão no pix')` → `{ produto: 'P13', quantidade: 2, pagamento: 'PIX' }`;
  - `'dois botijões, dinhero, troco pra 200'` → `{ produto: 'P13', quantidade: 2, pagamento: 'MONEY', trocoParaCentavos: 20000 }`;
  - `'cartao debito'` → `CARTAO_DE_DEBITO`;
  - `'cartão'` → sem pagamento;
  - `separarEndereco('Rua Nova, 10, Centro, Teresina')` → os 4 campos;
  - `separarEndereco('Rua Nova 10')` → `null`.
- [ ] **Step 2: Teste no motor:**
  - com um `InterpretadorFalso` que conta as chamadas, "2 botijão no pix pra Rua Nova, 10, Centro, Teresina" no INICIO (já com nome) leva ao resumo com **0** chamadas à IA;
  - "hmm sei lá" no `PRODUTO` chama a IA **1** vez.
- [ ] **Step 3:** FAIL → implementar → PASS → commit `feat(conversa): regras antes da IA (IA como último recurso)`.

### Task 6: Dúvidas por palavra-chave (Eduardo)

**Files:**
- Create: `src/conhecimento/palavras.ts`, `tests/conhecimento/palavras.test.ts`
- Modify: `src/servidor.ts` (ordem do `responderDuvida`), `src/conversa/motor.ts` (estado `DUVIDA` da Tarefa 3: responde e volta ao menu)

**Interfaces (Produces):** `responderFaq(texto: string, cat: Produto[]): string | null`. Lê `config/faq/*.md` uma vez.

Palavras-chave → arquivo:

| Palavras | Resposta |
|---|---|
| `preco\|valor\|quanto custa\|quanto ta` | Preços montados do catálogo |
| `horario\|abre\|fecha\|domingo\|feriado` | `horario.md` |
| `entrega\|bairro\|regiao\|atende onde\|taxa` | `area-entrega.md` |
| `pix\|cartao\|dinheiro\|pagamento\|troco` | `pagamento.md` |
| `vazamento\|seguranca\|cheiro` | `seguranca.md` (a emergência continua antes, no motor) |
| `troca\|vasilhame\|casco` | `troca-botijao.md` |

A resposta é o primeiro parágrafo do arquivo, sem o título.

No servidor, `responderDuvida` vira: `responderFaq` → se `null` e a IA estiver ligada → RAG → senão `M.DUVIDA_SEM_RESPOSTA`.

- [ ] **Step 1: Testes que falham:**
  - "qual o preço do gás?" contém "R$ 110,00";
  - "abre domingo?" contém "domingo";
  - "qual a capital da França" → `null`.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(conhecimento): dúvidas por palavra-chave antes da IA`.

### Task 7: Painel do Chatwoot com a API como fonte (Lucas)

**Files:**
- Modify: `src/painel/rotas.ts`, as páginas em `src/painel/publico/`, `src/index.ts`, `src/servidor.ts`
- Delete: `src/painel/pedidos.ts` e `tests/painel/pedidos.test.ts` (as chaves `pedidos:*` do Redis deixam de existir)
- Test: `tests/painel/rotas.test.ts`

**Interfaces:**
- Consumes: `historico`, `vendasDoBot`, `produtos` e `cancelarVenda` (Tarefa 1).
- Produces:
  - `GET /painel/api/pedidos?dia=` → `VendaResumo[]` (de `vendasDoBot`);
  - `GET /painel/api/estoque` → `{ codigo, nome, estoque }[]` (catálogo + `produtos()`);
  - a aba da conversa passa a incluir `logs` (de `historico`).
- `POST .../cancelar` só aceita uma venda com `doBot === true` e, na aba, só a venda da conversa (regra de hoje). Uma venda que não é do bot → 404.
- Sai do `DepsServidor` o campo `pedidos` e o `anotarPedido`.

- [ ] **Step 1: Testes que falham:**
  - lista do dia vinda da `ApiRevGasFalsa`;
  - cancelar uma venda com `doBot: false` → 404;
  - a aba mostra os `logs`;
  - estoque com os 3 produtos do catálogo.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Conferir no navegador:
  - a aba e o "Pedidos de hoje" no Chatwoot (`http://localhost:3000`);
  - cancelar uma venda de teste pelo painel → no histórico aparece `CANCEL`.
- [ ] **Step 4:** Commit `feat(painel): pedidos, histórico e estoque direto da API`.

### Task 8: Metabase (Luiza)

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `README.md`
- Create: `docs/metabase.md`

- [ ] **Step 1:** Serviço `metabase` com a imagem `metabase/metabase` **numa tag exata** (a última estável no Docker Hub no dia), `ports: ["127.0.0.1:3003:3000"]` e volume `metabase_dados:/metabase-data` com `MB_DB_FILE=/metabase-data/metabase.db`.
- [ ] **Step 2:** `docker compose up -d metabase` e abrir `http://localhost:3003`. Quem for o administrador cria a conta. Conectar ao Postgres com `host postgres`, banco `postgres`, usuário `metabase_leitura` e senha `METABASE_DB_SENHA`. Conferir que só o schema `revgas` aparece.
- [ ] **Step 3:** Criar o painel "Integração RevGás", com atualização automática a cada 1 min, e uma pergunta SQL por gráfico. Copiar cada SQL para `docs/metabase.md`:
  - requisições por rota e status (barras), de `chamadas_api`;
  - taxa de sucesso (`status between 200 and 299`) por hora;
  - tempo de resposta p50 e p95 por rota (`percentile_cont`);
  - vendas criadas por hora (`rota = '/sales' and metodo = 'POST' and status = 201`);
  - cancelamentos por origem (`eventos.tipo = 'cancelamento'` por `resultado`);
  - clientes reconhecidos por dia (`tipo = 'cliente_reconhecido'`);
  - transferências por motivo.
- [ ] **Step 4:** README: seção "Painel de análise", com como subir, URL e quem cria o administrador.
- [ ] **Step 5:** Commit `feat(infra): Metabase com o painel de integração`.

### Task 9: Roteiro da demonstração e relatório (Luiza)

**Files:** `docs/roteiro-demo.md`, `docs/relatorio/README.md`

- [ ] **Step 1:** Roteiro v2, seguindo os 5 critérios de aceite da spec (§6), com a tela dividida: WhatsApp, Chatwoot e Metabase.
- [ ] **Step 2:** Seção no relatório "v2: foco na integração", com:
  - os endpoints usados e os bloqueados (tabela da spec §2);
  - por que a IA virou último recurso;
  - o que foi reaproveitado da v1.
- [ ] **Step 3:** Ensaio completo com a IA desligada (`NUMEROS_IA=`) e registro do resultado no roteiro.
- [ ] **Step 4:** Commit `docs: roteiro e relatório da v2`.
