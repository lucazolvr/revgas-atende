# 🔥 RevGás Atende

**Atendente virtual de pedidos de gás no WhatsApp, com central de atendimento humano (Chatwoot) e venda registrada direto no ERP RevGás.**

Projeto de Extensão VI · Transformação Digital · 2026.2

![Node](https://img.shields.io/badge/Node-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Chatwoot](https://img.shields.io/badge/Chatwoot-1F93FF?logo=chatwoot&logoColor=white)
![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white)
![Gemini](https://img.shields.io/badge/IA-Gemini-8E75B2?logo=googlegemini&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

## O que faz

- 🛒 **Pedido completo na conversa:** nome, produto, quantidade, endereço e pagamento (com troco). Aceita menus numerados **ou** texto livre: *"manda 2 botijão pra Rua Nova 10, Centro, Teresina PI, pago no pix"*.
- ✅ **Só vende com confirmação:** mostra o resumo com o preço do catálogo e cria a venda (`POST /v1/sales`) só depois do "1 - Confirmar". Nunca duplica.
- 🙋 **Humano de verdade:** "quero falar com um atendente", dúvida que o bot não entende ou falha na API → a conversa vai para a fila do Chatwoot com uma **nota-resumo** e **etiquetas**.
- 🚨 **Vazamento de gás:** orientações de segurança na hora e conversa marcada como **urgente** no painel.
- 🧠 **A IA só entende, quem decide é o código:** preço, produto e criação da venda nunca dependem da IA. Sem IA, tudo funciona pelos menus.

## Arquitetura

```mermaid
flowchart LR
    C([Cliente]) <--> WA[WhatsApp]
    WA <--> EVO[Evolution API]
    EVO <--> CW[Chatwoot]
    CW -- webhook Agent Bot --> BOT[Bot RevGás Atende]
    BOT -- responde / nota / etiqueta / transfere --> CW
    BOT --> IA[Gemini]
    BOT --> ERP{{API RevGás}}
    BOT --> R[(Redis)]
    AT([Atendente]) <--> CW
```

| Pasta | O que tem |
|---|---|
| `src/canal/` | Webhook e cliente da API do Chatwoot |
| `src/conversa/` | Motor da conversa (máquina de estados), textos, emergência, sessões |
| `src/ia/` | Interpretação de texto livre (Gemini) e validação da resposta |
| `src/vendas/` | Catálogo, pedido, porta da API RevGás (falsa e real) |
| `config/` | Catálogo de produtos e orientações de segurança |
| `scripts/setup.ts` | Liga Evolution ↔ Chatwoot ↔ bot |
| `scripts/chatwoot-config.ts` | Etiquetas, respostas prontas, atributos, horário e aba "Pedido RevGás" (definições em `src/canal/painel.ts`) |
| `scripts/chatwoot-ajustes.rb` | Marca RevGás, menu "Pedidos de hoje" e cache do painel (dentro do Chatwoot) |
| `src/painel/` | Aba "Pedido RevGás" na conversa e lista "Pedidos de hoje" no menu: venda no ERP e cancelamento de venda de teste |
| `docs/` | Design, plano e (em breve) relatório e roteiro de demo |

Detalhes e decisões: [documento de design](docs/superpowers/specs/2026-11-18-revgas-atende-design.md).

**Avaliação da IA:** intenção 100%, extração F1 97,2% e −45% de mensagens com IA (Wilcoxon p < 0,001). Estudo completo em [docs/relatorio/avaliacao-ia](docs/relatorio/avaliacao-ia/README.md).

## Como rodar

### Só os testes (sem Docker)

```bash
npm install
npm test
```

### Tudo, com WhatsApp

Precisa de **Docker Desktop** (≈ 4 GB de RAM livres) e de um **chip separado** (a Evolution não é a API oficial do WhatsApp; o número pode ser bloqueado).

1. `cp .env.example .env` e preencha `POSTGRES_PASSWORD`, `SECRET_KEY_BASE`, `EVOLUTION_API_KEY`, `BOT_WEBHOOK_TOKEN` e `PAINEL_TOKEN` com valores aleatórios (os tokens com 32+ caracteres).
2. `docker compose up -d` (a primeira vez demora: baixa as imagens e prepara o banco).
3. Abra **http://localhost:3000**, crie a conta de administrador e copie o token de acesso do seu perfil para `CHATWOOT_ADMIN_TOKEN`.
4. `npm install` e `npm run setup`: ele cria o Agent Bot, a instância do WhatsApp e a caixa de entrada.
5. Coloque o `CHATWOOT_BOT_TOKEN` que o setup mostrou no `.env` e rode `docker compose up -d --build`. A partir daqui, **todo `docker compose up` configura o painel sozinho** (veja abaixo).
6. Abra **http://127.0.0.1:8080/manager**, entre na instância `revgas` e leia o QR code com o celular do chip (WhatsApp → Aparelhos conectados).
7. Mande "oi" para o número do chip. 🎉

### Painel configurado automaticamente

A cada `docker compose up`, dois serviços rodam uma vez e terminam (podem rodar de novo sem duplicar nada):

- **`chatwoot-config`** (`scripts/chatwoot-config.ts`, pela API do Chatwoot): etiquetas com cor, respostas prontas (`/saiu`, `/endereco`, `/seguranca`, `/horario`, `/obrigado`), dados do pedido na lateral da conversa, horário de atendimento da caixa e a aba **Pedido RevGás** em cada conversa (o pedido, a venda no ERP e "Cancelar venda de teste").
- **`chatwoot-ajustes`** (`scripts/chatwoot-ajustes.rb`, dentro do Chatwoot): marca RevGás (logo, ícone, nome e cores laranja), item **Pedidos de hoje** no menu lateral (abre por cima do Chatwoot a lista de todos os pedidos do dia) e renovação do cache do painel.

Antes da primeira instalação (sem `CHATWOOT_ADMIN_TOKEN` ou sem o `npm run setup`), o `chatwoot-config` só avisa no log e não trava nada. A aba e o menu só aparecem com `PAINEL_TOKEN` (32+ caracteres) e apontam para o painel em `http://127.0.0.1:3001`; se publicar o painel em outro endereço, defina `PAINEL_URL`. As páginas do painel só funcionam dentro do Chatwoot, a porta dele só existe em `127.0.0.1` e a API exige o token. Para rodar à mão: `docker compose run --rm chatwoot-config` e `docker compose run --rm chatwoot-ajustes` (ou `npm run chatwoot:config`, de fora do Docker).

### Marca RevGás no painel

O Chatwoot é open source (MIT), e a marca personaliza o painel **sem fork e sem tocar no código pago (Enterprise)**:

- **Logo, ícone e nome:** grava as configurações do núcleo do Chatwoot (`scripts/aplicar-marca.rb`, aplicado sozinho pelo serviço `chatwoot-ajustes`). Os arquivos ficam em `marca/` e são servidos pelo próprio Chatwoot em `/marca/`.
- **Cores:** `scripts/marca.ts` lê o CSS compilado do Chatwoot e gera `marca/tema.css`, trocando a escala azul da marca pelo laranja RevGás (#FC692B), nos modos claro e escuro. O arquivo gerado fica no repositório.

Ao atualizar a versão do Chatwoot, rode `npm run marca` para gerar o `marca/tema.css` de novo e faça commit dele.

**IA:** coloque `GEMINI_API_KEY` (cota grátis do [Google AI Studio](https://aistudio.google.com/)) e os números da equipe em `NUMEROS_IA`. Na cota grátis o Google pode usar as mensagens, então os outros números são atendidos pelos menus.

**Segurança:** mantenha o bot apenas na rede interna do Docker, use um `BOT_WEBHOOK_TOKEN` aleatório com ao menos 32 caracteres e troque-o se ele aparecer em logs ou configurações expostas. O bot limita rajadas de mensagens e as métricas sem conteúdo de conversa expiram em 90 dias por padrão (`METRICAS_RETENCAO_DIAS`).

**Venda no ERP (API de teste da RevGás):** a RevGás liberou, em parceria com a faculdade, uma **API de teste** (`api.revgas.com`, estabelecimento de demonstração 2580), separada da produção. Com `VENDA_REAL=true`, `REVGAS_API_KEY`, `REVGAS_CLIENTE_DEMO=5700355` e `REVGAS_ESTABELECIMENTO=2580`, cada pedido confirmado cria a venda nesse ambiente, sem avisar entregadores. Para limpar depois de testar: `npm run cancelar-venda -- <id>`.

## Equipe

| | Responsável por |
|---|---|
| **Lucas Oliveira** | Base técnica, avaliação da IA e experimento com/sem IA |
| **Eduardo** | Base de conhecimento (RAG) para dúvidas frequentes |
| **João Vitor** | Venda real no ERP e deploy |
| **Luiza** | Teste com usuários (SUS), roteiro da demo e relatório |

As tarefas de cada um estão nas issues do GitHub. Veja [CONTRIBUTING.md](CONTRIBUTING.md).
