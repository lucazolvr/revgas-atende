# Atualizar o ambiente local (guia para o Claude de cada integrante)

> **Para quem é:** o assistente (Claude Code) de cada integrante da equipe. Cole no chat:
> *"Siga o `docs/atualizar-ambiente.md` para atualizar meu ambiente do RevGás Atende."*
>
> **Estado de referência:** `main` de 22/11/2026, com WAHA no lugar da Evolution (PR #17), o bot ignorando grupos (PR #19), a pergunta combinada de cidade e estado (PR #18) e o "cancelar" valendo em qualquer etapa (PR #22).

## Regras antes de começar

- **Nunca** cole tokens ou chaves no chat, em issues ou em commits. O `.env` não vai para o Git.
- **Nunca** conecte um número pessoal ao WAHA: com o bot ligado, qualquer pessoa que escrever recebe resposta do bot.
- **Um computador por vez no chip da revenda.** Se dois computadores estiverem conectados ao mesmo chip, os **dois bots respondem** ao cliente. Em 22/11 isso aconteceu: uma instalação desatualizada respondia "Qual o estado? (a sigla, ex.: PI)" e transferia para atendente, enquanto a atual fazia o pedido certo. Só conecte o chip no computador que vai testar ou apresentar, e desconecte depois.
- Vendas confirmadas vão para a **API de teste** da RevGás (estabelecimento 2580). Cancele as que criar (passo 7).
- Não faça commit, push ou merge sem o integrante pedir.

## 1. Código

```bash
git checkout main
git pull
npm install
```

Confira que o último commit da `main` inclui o PR #22 (`git log --oneline -5`).

## 2. `.env`

Compare o `.env` com o `.env.example` **sem imprimir os valores** (só os nomes das variáveis):

```bash
# nomes que estão no exemplo e faltam no .env
grep -oE '^[A-Z_]+' .env.example | sort -u > /tmp/ex.txt
grep -oE '^[A-Z_]+' .env | sort -u > /tmp/env.txt
comm -23 /tmp/ex.txt /tmp/env.txt
```

- **Obrigatórias novas (WAHA):** `WAHA_API_KEY` e `WAHA_DASHBOARD_PASSWORD`, com valores aleatórios. Sem elas o `docker compose` **recusa subir**. `WAHA_DASHBOARD_USERNAME` é opcional.
- **Obrigatórias novas (banco `revgas`, desde a #34):** `REVGAS_DB_SENHA` e `METABASE_DB_SENHA`, com valores aleatórios **só em hexadecimal** (vão numa URL de conexão). Sem elas o `docker compose` **recusa subir**. O serviço `revgas-db` cria o banco, as tabelas `revgas.chamadas_api` e `revgas.eventos` e os papéis `revgas_bot` (o bot grava) e `metabase_leitura` (só lê, sem acesso ao banco do Chatwoot).
- `BOT_WEBHOOK_TOKEN` e `PAINEL_TOKEN`: **32+ caracteres** aleatórios. Com `PAINEL_TOKEN` curto, a aba "Pedido RevGás" fica desligada.
- Variáveis da Evolution (`EVOLUTION_*`), se ainda existirem: podem ser apagadas, não são mais usadas.
- `NUMEROS_IA=*`: a IA atende todos os números (cenário da demo, desde 22/11). Uma lista de números (com DDI e DDD) limita a IA a eles; vazio = só menus.
- `VENDA_REAL=true` só com `REVGAS_API_KEY`, `REVGAS_CLIENTE_DEMO=5700355` e `REVGAS_ESTABELECIMENTO=2580`. Peça a chave ao Lucas por mensagem privada se não tiver.

Para gerar um valor aleatório: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

## 3. Imagens e containers

Com o Docker Desktop ligado:

```bash
docker compose pull --ignore-buildable      # imagens novas (WAHA, Chatwoot, Postgres, Redis)
docker compose up -d --build --remove-orphans
```

- `--build` recria o bot com o código novo. **Sem isso, o bot continua com a versão antiga**, mesmo depois do `git pull`.
- `--remove-orphans` remove o container da Evolution, que senão continua ligado ao número.

Confira: `docker compose ps` deve mostrar `bot`, `chatwoot`, `chatwoot-sidekiq`, `postgres` (healthy), `redis` e `waha` como `Up`. `chatwoot-migrar`, `chatwoot-config` e `chatwoot-ajustes` rodam uma vez e terminam (`Exited (0)` é normal).

## 4. Setup do WhatsApp

```bash
npm run setup
```

Ele é idempotente: cria ou reaproveita o Agent Bot, a caixa "WhatsApp RevGás", a integração WAHA ↔ Chatwoot e a sessão `default`. Quem vinha da Evolution mantém as conversas antigas.

Se o setup mostrar um `CHATWOOT_BOT_TOKEN` novo, coloque no `.env` e rode `docker compose up -d --build bot`.

## 5. Conectar o chip (só no computador que vai testar)

1. Abra **http://127.0.0.1:3002/dashboard** (usuário e senha do `.env`). Na primeira vez, cole a `WAHA_API_KEY` no "Worker" (ícone de lápis).
2. Na sessão `default`, leia o QR com o celular do chip: **WhatsApp → Aparelhos conectados → Conectar aparelho**. O QR expira em ~1 min.
3. Sessão `FAILED` (QR expirou): clique em *Restart* e leia o QR novo.
4. **"Não é possível conectar novos dispositivos no momento":** no dashboard, *Logout* → *Stop* → apagar a sessão → `npm run setup` → ler o QR de novo. Evite conectar e desconectar muitas vezes seguidas.
5. No celular do chip, em **Aparelhos conectados**, confira que **só este computador** está na lista.

Status pela API (sem expor a chave no chat):

```bash
curl -s -H "X-Api-Key: $(grep '^WAHA_API_KEY=' .env | cut -d= -f2-)" http://127.0.0.1:3002/api/sessions/default
```

`"status":"WORKING"` = conectado.

## 6. Verificar

```bash
npm test                 # todos os testes passando
npx tsc --noEmit         # sem erros de tipo
```

No WhatsApp, de outro celular, para o número do chip:

| Mensagem | Esperado |
|---|---|
| `oi` | Boas-vindas e "Qual é o seu nome?" |
| pedido inteiro numa mensagem, ex.: *"quero um gás na Rua Nova 10, Centro, Teresina, pago no pix"* | O bot preenche tudo (o estado PI sai de Teresina) e pergunta só o que falta |
| `cancelar` no meio do pedido | "Tudo bem, pedido cancelado." |
| `cheiro de gás` | Orientações de segurança e conversa marcada como urgente |
| mensagem num **grupo** onde o chip está | O bot **não** responde |

Se aparecer uma resposta que o bot atual não daria (como "Qual o estado? (a sigla, ex.: PI)"), **há outro computador conectado ao chip** (veja as regras no topo).

O bot só responde conversas com status **pendente** no Chatwoot. Se um atendente assumir (status "aberta"), o bot fica calado até a conversa ser resolvida.

## 7. Depois de testar

- Cancele as vendas de teste: aba **Pedido RevGás** na conversa, menu **Pedidos de hoje** ou `npm run cancelar-venda -- <id>`.
- **Zerar o atendimento de um número** para testar de novo (troque `<id>` pelo número da conversa no Chatwoot):

  ```bash
  docker compose exec -T redis redis-cli -n 2 DEL sessao:<id>
  ```

  E no Chatwoot: resolver a conversa e tirar etiquetas e prioridade que sobraram de testes anteriores (ex.: "urgente", "vazamento").
- Ao terminar: desconecte o chip (dashboard do WAHA → *Logout*) se outra pessoa for usar, e `docker compose stop`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `docker compose up` falha pedindo `WAHA_API_KEY` | `.env` antigo | Passo 2 |
| Mensagem chega no Chatwoot, bot não responde | Bot antigo (sem `--build`), token errado ou conversa "aberta" | `docker compose up -d --build bot`; confira `docker compose logs bot`; resolva a conversa |
| Mensagem nem chega no Chatwoot | Sessão não está `WORKING` ou o setup não rodou | Passos 4 e 5 |
| Dois bots respondendo | Outro computador conectado ao chip | Desconecte os outros aparelhos no celular do chip |
| IA não entende, só menus | `NUMEROS_IA` sem `*` (ou sem o número) ou cota do Gemini esgotada | Confira o `.env`; a cota grátis volta no dia seguinte |
| Painel sem a cor laranja ou sem "Pedidos de hoje" | `chatwoot-ajustes` não rodou | `docker compose run --rm chatwoot-ajustes` |
