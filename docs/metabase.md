# Painel de análise: Metabase "Integração RevGás"

O painel mostra, ao vivo, o que o bot faz na API da RevGás: cada requisição, a taxa de sucesso, o tempo de resposta, as vendas, os cancelamentos, os clientes reconhecidos e as transferências para atendente. Ele atende ao RF12 dos [requisitos da v2](superpowers/specs/2026-11-23-integracao-api-design.md) e ao critério de aceite 5 ("o Metabase mostra cada requisição feita durante a demonstração").

A configuração do Metabase (conta, conexão, perguntas e painel) fica no banco interno dele, no volume `metabase_dados`, e não vai para o Git. Por isso, o SQL de cada gráfico está versionado aqui: se o volume for apagado ou outra pessoa montar o painel, é só recriar as perguntas a partir deste arquivo.

## De onde vêm os dados

O bot grava no Postgres, no banco `revgas`, schema `revgas` (Tarefa 2, issue #34, `scripts/revgas-db.sql`):

| Tabela | Uma linha por | Colunas |
|---|---|---|
| `revgas.chamadas_api` | requisição à API RevGás | `em`, `metodo`, `rota` (normalizada, ex.: `/sales/:id`), `status` (vazio quando a API não respondeu), `ms`, `venda_id`, `fila` (`venda` ou `consulta`) |
| `revgas.eventos` | evento de atendimento | `em`, `conversa_id`, `tipo`, `estado`, `motivo`, `resultado`, `ms`, `ia` |

Tipos de evento: `mensagem`, `transferencia` (com `motivo`), `venda` (com `resultado`), `erro`, `acompanhar`, `cancelamento` (com a origem em `resultado`) e `cliente_reconhecido`.

Nenhuma das duas tabelas guarda nome, telefone, endereço ou texto de mensagem. O Metabase entra com o usuário `metabase_leitura`, que só conecta no banco `revgas`, só tem `SELECT` nas tabelas dele e não enxerga o banco do Chatwoot.

## Subir e configurar (uma vez por computador)

1. Suba o serviço: `docker compose up -d metabase`. Na primeira vez, o Metabase leva de 1 a 2 minutos para iniciar.
2. Abra **http://127.0.0.1:3003** e crie a conta de administrador. Quem sobe o Metabase no próprio computador é o administrador dele; a conta fica só nesse computador. Na etapa "Adicionar seus dados", escolha **"Vou adicionar meus dados mais tarde"**.

### Jeito automático (recomendado)

3. Crie uma chave de API: **Admin → Configurações → Autenticação → Chaves de API → Criar chave**, com o nome `painel` e o grupo **Administradores**. Copie a chave (ela só aparece uma vez).
4. Coloque a chave no `.env`: `METABASE_API_KEY=<a chave>`. Ela dá acesso de administrador ao Metabase: trate como as outras chaves e nunca a cole em chat, issue ou commit.
5. Rode `npm run metabase:painel`. O script (`scripts/metabase-painel.ts`) lê este arquivo e cria ou atualiza a conexão com o `metabase_leitura`, a coleção, as oito perguntas e o painel. Pode rodar de novo sem duplicar nada: depois de mudar um SQL aqui, rode outra vez para atualizar.
6. Abra o link que o script mostra. Ele termina em `#refresh=60`, que atualiza o painel a cada 1 minuto.
7. Confira em **Admin → Tabelas** que só aparecem `chamadas_api` e `eventos`.

### Jeito manual

3. Em **Admin → Bancos de dados → Adicionar banco de dados**, escolha **PostgreSQL** e preencha:

   | Campo | Valor |
   |---|---|
   | Nome de exibição | `RevGás (integração)` |
   | Host | `postgres` |
   | Porta | `5432` |
   | Nome do banco de dados | `revgas` |
   | Nome de usuário | `metabase_leitura` |
   | Senha | o valor de `METABASE_DB_SENHA` no `.env` |
   | Schemas | "Somente estes…": `revgas` |

4. Confira em **Admin → Tabelas** que só aparecem `chamadas_api` e `eventos`. Se aparecer qualquer tabela do Chatwoot, a conexão está com o banco ou o usuário errado: corrija antes de seguir.
5. Para cada consulta abaixo: **Novo → Consulta SQL**, escolha o banco "RevGás (integração)", cole o SQL, escolha a visualização indicada e salve com o nome do título. (O comentário `<!-- metabase: ... -->` de cada consulta é o que o script usa para escolher o gráfico; ele não aparece no GitHub.)
6. Crie o painel **Novo → Painel → "Integração RevGás"**, adicione as oito perguntas e, no ícone de relógio do painel, ligue a **atualização automática a cada 1 minuto**.

Os gráficos por hora olham as últimas 24 horas, no fuso da revenda (`America/Fortaleza`). Para a demonstração, isso mostra o dia inteiro de testes; para outro período, troque o `interval '24 hours'`.

## Consultas

### 1. Requisições recentes (tabela)

<!-- metabase: {"display":"table"} -->

Mostra cada requisição, a mais recente primeiro. É o gráfico que acompanha a demonstração ao vivo.

```sql
select to_char(em at time zone 'America/Fortaleza', 'HH24:MI:SS') as hora,
       metodo,
       rota,
       status,
       ms,
       fila,
       venda_id
from revgas.chamadas_api
order by em desc, id desc
limit 30;
```

### 2. Requisições por rota e status (barras empilhadas)

<!-- metabase: {"display":"bar","dimensoes":["rota","status"],"metricas":["requisicoes"],"empilhado":true} -->

Eixo X: `rota`; série: `status`; valor: `requisicoes`.

```sql
select metodo || ' ' || rota as rota,
       coalesce(status::text, 'sem resposta') as status,
       count(*)              as requisicoes
from revgas.chamadas_api
where em >= now() - interval '24 hours'
group by 1, 2
order by 1, 2;
```

### 3. Taxa de sucesso por hora (linha)

<!-- metabase: {"display":"line","dimensoes":["hora"],"metricas":["sucesso_pct"]} -->

Sucesso é qualquer resposta HTTP de 200 a 299.

```sql
select date_trunc('hour', em at time zone 'America/Fortaleza') as hora,
       round(100.0 * count(*) filter (where status between 200 and 299) / count(*), 1) as sucesso_pct,
       count(*) as requisicoes
from revgas.chamadas_api
where em >= now() - interval '24 hours'
group by 1
order by 1;
```

### 4. Tempo de resposta p50 e p95 por rota (barras agrupadas)

<!-- metabase: {"display":"bar","dimensoes":["rota"],"metricas":["p50_ms","p95_ms"]} -->

```sql
select metodo || ' ' || rota as rota,
       round(percentile_cont(0.5)  within group (order by ms)::numeric) as p50_ms,
       round(percentile_cont(0.95) within group (order by ms)::numeric) as p95_ms,
       count(*) as requisicoes
from revgas.chamadas_api
where em >= now() - interval '24 hours'
  and ms is not null
group by 1
order by p95_ms desc;
```

### 5. Vendas criadas por hora (barras)

<!-- metabase: {"display":"bar","dimensoes":["hora"],"metricas":["vendas"]} -->

Conta só as vendas que a API confirmou (`POST /sales` com HTTP 201).

```sql
select date_trunc('hour', em at time zone 'America/Fortaleza') as hora,
       count(*) as vendas
from revgas.chamadas_api
where metodo = 'POST'
  and rota = '/sales'
  and status = 201
  and em >= now() - interval '24 hours'
group by 1
order by 1;
```

### 6. Cancelamentos por origem (pizza ou barras)

<!-- metabase: {"display":"pie","dimensoes":["origem"],"metricas":["cancelamentos"]} -->

A origem (cliente pelo WhatsApp ou atendente pelo painel) fica em `resultado`.

```sql
select coalesce(resultado, '(sem origem)') as origem,
       count(*) as cancelamentos
from revgas.eventos
where tipo = 'cancelamento'
  and em >= now() - interval '24 hours'
group by 1
order by 2 desc;
```

### 7. Clientes reconhecidos por dia (barras)

<!-- metabase: {"display":"bar","dimensoes":["dia"],"metricas":["conversas_com_cliente_reconhecido"]} -->

Conversas em que o bot achou uma venda anterior do mesmo telefone e reaproveitou nome e endereço.

```sql
select (date_trunc('day', em at time zone 'America/Fortaleza'))::date as dia,
       count(distinct conversa_id) as conversas_com_cliente_reconhecido
from revgas.eventos
where tipo = 'cliente_reconhecido'
group by 1
order by 1;
```

### 8. Transferências para atendente por motivo (barras)

<!-- metabase: {"display":"bar","dimensoes":["motivo"],"metricas":["transferencias"]} -->

```sql
select coalesce(motivo, '(sem motivo)') as motivo,
       count(*) as transferencias
from revgas.eventos
where tipo = 'transferencia'
  and em >= now() - interval '24 hours'
group by 1
order by 2 desc;
```

## Conferir pelo terminal

Sem abrir o Metabase, dá para ver se o bot está gravando:

```bash
docker compose exec postgres psql -U postgres -d revgas -c "select rota, status, ms from revgas.chamadas_api order by id desc limit 5"
```

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `http://127.0.0.1:3003` não abre | O Metabase ainda está iniciando | Aguarde 1 a 2 minutos; `docker compose logs -f metabase` mostra "Metabase Initialization COMPLETE" |
| Conexão recusada: "password authentication failed for user metabase_leitura" | Senha diferente da do `.env`, ou o usuário ainda não foi criado | Confira `METABASE_DB_SENHA` e rode `docker compose up -d revgas-db`, que cria o usuário e reaplica a senha |
| "database revgas does not exist" ou "relation revgas.chamadas_api does not exist" | O banco da Tarefa 2 ainda não foi criado neste computador | Rode `docker compose up -d revgas-db` |
| Gráficos vazios | Nenhum pedido de teste nas últimas 24 horas | Faça um pedido pelo WhatsApp e espere a atualização de 1 minuto |
| O painel não se atualiza sozinho | A atualização automática não foi ligada | Ícone de relógio no painel → 1 minuto |
