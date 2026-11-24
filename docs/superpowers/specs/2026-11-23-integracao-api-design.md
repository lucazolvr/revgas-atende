# RevGás Atende v2 — Integração com a API RevGás: Documento de Requisitos

Projeto de Extensão VI · Transformação Digital · 2026.2
Data: 2026-11-23 · Status: **rascunho para a equipe revisar** · Substitui, no que conflitar, o [design de 18/11](2026-11-18-revgas-atende-design.md)

---

## 1. Intenção (o porquê)

Na apresentação de 23/11, o professor deixou claro que o ponto principal é a **conexão com a API da RevGás**. A v1 já cria vendas, mas a conversa gira em torno da IA (Gemini) e usa só um endpoint da API de verdade (`POST /sales`).

A v2 inverte o foco:
- **A máquina de estados é o produto.** O cliente faz pedido, acompanha e cancela por menus, e cada etapa conversa com a API.
- **A API é a fonte da verdade.** Cliente, pedido, status, produto e estoque vêm do ERP, não de cópias nossas.
- **A IA vira último recurso.** Só entra quando os menus e as regras não entendem a mensagem.
- **A integração fica visível.** Um painel mostra os pedidos e as requisições à API acontecendo.

Grande parte da v1 é reaproveitada: o motor de conversa, o cliente da API (fila de 1 req/s), o Chatwoot, o WAHA, o Docker, o painel "Pedido RevGás" e os testes.

## 2. O que a chave da API permite (sondado em 23/11/2026)

| Endpoint | Uso na v2 |
|---|---|
| `POST /sales` | Criar a venda (já existe) |
| `GET /sales?page=&page_size=&status=` | Reconhecer o cliente pelo telefone, listar os pedidos ativos dele e montar a lista do dia. `page_size` vai até pelo menos 50; o filtro `status` aceita `ACTIVE` e `CANCEL`. O filtro por data **não** funciona. |
| `GET /sales/{id}` | Status, total, endereço, se foi paga e o **histórico** (`logs`: status + data) |
| `PUT /sales/{id}/cancel` | Cancelar (pelo cliente no WhatsApp ou pelo atendente no painel) |
| `GET /products` (`page_size`) | Catálogo do ERP: `id`, `description`, `stock_quantity` e `inactive`. **Não traz preço.** |
| `GET /establishments/{id}` | `accept_order` (aceita pedidos), `allow_cancel_sale` (permite cancelar) e `ignore_stock_check` |

Sem acesso (403): `/customers`, `/payments`, `/payment-types`, `/deliverers`, `/cities`, `/neighborhoods`, `/orders` e `/vehicles`. Por isso:
- o cliente continua sendo o **cliente de demonstração** (`REVGAS_CLIENTE_DEMO`), com nome e telefone na `observation`, no formato `Pedido via WhatsApp (RevGás Atende). Cliente: <nome> <telefone>.`;
- o **preço** continua no `config/catalogo.json`.

## 3. Requisitos funcionais

### RF1 — Cliente reconhecido pela API (feito em 23/11, sem commit)
Na primeira mensagem de uma conversa, o bot procura a venda mais recente daquele telefone e reaproveita nome e endereço: "Olá de novo, Maria! … Vou entregar no mesmo endereço do último pedido: …". O telefone é comparado com e sem o 9 extra (`chaveTelefone`).

### RF2 — Menu principal
Uma saudação sem pedido claro abre o menu:

```
1 - Fazer pedido
2 - Acompanhar meu pedido
3 - Cancelar um pedido
4 - Tirar uma dúvida
5 - Falar com um atendente
```

- Uma mensagem que já é um pedido ("quero 2 botijões") pula o menu e vai direto para o pedido, como na v1.
- "menu" ou "voltar", em qualquer etapa, volta ao menu.

### RF3 — Pedido com produtos e estoque da API
- O menu de produtos mostra só os itens do `config/catalogo.json` que, no `GET /products`, estão ativos e têm estoque maior que zero. O preço vem do catálogo.
- Se a quantidade pedida passar do estoque: "Só temos N em estoque. Quantas você quer?". O ERP de teste tem `ignore_stock_check: true`; a validação é do bot.
- O catálogo passa a ter também o P45 (`23974`, "GLP 45KG MA") e a Água 20L (`26255`), com preços definidos pela equipe.

### RF4 — Revenda aceitando pedidos
Se `accept_order` for `false`, o bot não abre pedido: "No momento a revenda não está recebendo pedidos pelo WhatsApp." e oferece o atendente.

### RF5 — Acompanhar pedido
- O bot lista os pedidos ativos do telefone (`GET /sales?status=ACTIVE`), no máximo 5, os mais recentes primeiro: número, data, total e endereço curto.
- Com um só pedido, mostra o detalhe direto. Com vários, o cliente escolhe pelo número do menu.
- O detalhe vem de `GET /sales/{id}`: status atual traduzido e histórico (`logs`) com hora.
- Sem pedido ativo: "Não encontrei pedido em aberto neste número." e volta ao menu.

### RF6 — Cancelar pedido pelo WhatsApp
- A mesma lista do RF5. O cliente escolhe e o bot pede confirmação: "Cancelar o pedido nº X (R$ Y)? 1 - Sim · 2 - Não". Só então chama `PUT /sales/{id}/cancel`.
- Só aparecem vendas **do próprio telefone**, do nosso estabelecimento e com status `ACTIVE`. O cliente nunca digita um número de venda livre.
- Se `allow_cancel_sale` for `false`, o pedido vai para o atendente.
- Venda já cancelada entre a lista e o "sim": "Esse pedido já estava cancelado."
- Erro ou falta de resposta da API: o bot **nunca** diz "cancelado". Ele transfere para o atendente com a nota "cancelamento não confirmado pela API".

### RF7 — Dúvidas sem IA
As perguntas sobre preço, horário, área de entrega, pagamento, segurança e troca de botijão são respondidas por **palavra-chave** a partir de `config/faq/*.md`, com o preço vindo do catálogo. O RAG com IA só entra se nenhuma palavra-chave casar e a IA estiver ligada.

### RF8 — Entender mais sem IA
Sem IA, o bot também entende:
- várias informações numa mensagem só ("2 botijão no pix", "quero um P13, troco pra 200");
- o endereço inteiro de uma vez ("Rua Nova, 10, Centro, Teresina");
- números por extenso de um a dez ("dois");
- pequenas variações ("dinhero", "cartao debito").

### RF9 — IA como último recurso
O interpretador (Gemini, com reserva na OpenAI) só é chamado quando as regras **não** entenderam a mensagem, antes de contar a falha. Mensagens numéricas e palavras-chave nunca vão para a IA. Com a IA desligada (`NUMEROS_IA` vazio), o fluxo completo funciona.

### RF10 — Registro das requisições e eventos (persistência local para análise)
- Toda chamada à API RevGás grava uma linha em `revgas.chamadas_api` (Postgres): método, rota normalizada (`/sales/:id`), status HTTP, tempo em ms, id da venda e fila (`venda` = criar venda, cliente esperando; `consulta` = todo o resto).
- Os eventos de atendimento (os mesmos de `dados/metricas-*.jsonl`, mais `acompanhar`, `cancelamento` e `cliente_reconhecido`) vão para `revgas.eventos`.
- Nenhuma das duas tabelas guarda nome, telefone, endereço ou texto de mensagem. Os dados do cliente ficam na API.

### RF11 — Painel de operação (Chatwoot, evolui o "Pedido RevGás")
- **Aba na conversa:** a venda da conversa, com o status e o **histórico** vindos da API, e o botão cancelar (como hoje).
- **"Pedidos de hoje":** passa a vir de `GET /sales`, filtrando vendas do nosso estabelecimento, com a marca "RevGás Atende" na observação e com data de hoje (fuso `America/Fortaleza`). Mostra ativas e canceladas.
- **Novo bloco "Estoque":** os produtos do catálogo com o estoque atual do ERP.
- O registro local de pedidos no Redis (`RegistroPedidos`) é **removido**: a lista vem da API e nada pessoal fica guardado por nós.

### RF12 — Painel de análise (Metabase)
- Novo serviço `metabase` no `docker-compose.yml`, publicado só em `127.0.0.1:3003`.
- O Metabase lê o Postgres com um usuário **só leitura do schema `revgas`**, sem acesso ao banco do Chatwoot.
- Painel "Integração RevGás", com atualização automática a cada 1 minuto:
  - requisições por endpoint;
  - taxa de sucesso;
  - tempo de resposta (p50/p95);
  - pedidos por hora;
  - cancelamentos (cliente × atendente);
  - clientes reconhecidos;
  - transferências por motivo.
- As consultas SQL de cada gráfico ficam versionadas em `docs/metabase.md`, porque a configuração do Metabase vive no banco dele.

## 4. Requisitos não funcionais

- **1 requisição por segundo** à API, pela fila que já existe. As vendas passam na frente.
- `GET /products` e `GET /establishments` ficam **5 minutos em cache** na memória do bot.
- A busca de vendas por telefone varre no máximo 2 páginas de 50 (as 100 mais recentes). É solução provisória até a liberação de `/customers`.
- Falha da API em consulta (reconhecer, produtos, estabelecimento) **não trava** o atendimento: o bot usa o catálogo local e começa o pedido do zero. Falha em **criar ou cancelar** é sempre comunicada e transferida.
- Falha ao gravar no Postgres **nunca** afeta o cliente. É melhor esforço, com aviso no log.
- Sem dados pessoais em log, métrica, `chamadas_api` ou `eventos`.
- Todos os fluxos novos com testes no `vitest`, usando `ApiRevGasFalsa`, sem rede.

## 5. Fora do escopo

Um ERP próprio ou cadastro de clientes paralelo (a RevGás já é o ERP), pagamento online, rastreio do entregador, hospedagem em nuvem e acesso remoto ao painel.

## 6. Critérios de aceite (para a demonstração)

1. Com a IA desligada, um cliente novo faz um pedido completo só por menus, e a venda aparece no ERP.
2. O mesmo telefone volta e é reconhecido ("Olá de novo"), sem repetir nome e endereço.
3. O cliente acompanha o pedido e vê o status e o histórico vindos da API.
4. O cliente cancela pelo WhatsApp, a venda fica `CANCEL` na API, e o painel do Chatwoot e o Metabase mostram isso em até 1 minuto.
5. O Metabase mostra cada requisição feita durante a demonstração.
