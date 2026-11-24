-- Banco "revgas": chamadas à API RevGás e eventos de atendimento, para o Metabase (issue #34).
-- Sem dados pessoais: nome, telefone, endereço e texto de mensagem ficam na API da RevGás.
-- Idempotente: roda a cada `docker compose up` (serviço revgas-db) e só cria o que falta.
-- Uso: psql -v senha_bot=... -v senha_metabase=... -f revgas-db.sql
\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE revgas' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'revgas') \gexec

-- Papéis: o bot grava, o Metabase só lê. As senhas são reaplicadas a cada execução (trocar no .env basta).
SELECT 'CREATE ROLE revgas_bot LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'revgas_bot') \gexec
SELECT 'CREATE ROLE metabase_leitura LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_leitura') \gexec
SELECT format('ALTER ROLE revgas_bot PASSWORD %L', :'senha_bot') \gexec
SELECT format('ALTER ROLE metabase_leitura PASSWORD %L', :'senha_metabase') \gexec

-- Os dois papéis só entram no banco revgas: o do Chatwoot (conversas, contatos) fica fora de alcance.
-- O Chatwoot usa o superusuário postgres, que não depende de CONNECT.
REVOKE CONNECT ON DATABASE chatwoot FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE revgas FROM PUBLIC;
GRANT CONNECT ON DATABASE revgas TO revgas_bot, metabase_leitura;

\connect revgas

CREATE SCHEMA IF NOT EXISTS revgas;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE TABLE IF NOT EXISTS revgas.chamadas_api (
  id       bigserial PRIMARY KEY,
  em       timestamptz NOT NULL DEFAULT now(),
  metodo   text NOT NULL,
  rota     text NOT NULL,          -- normalizada: /sales/:id/cancel
  status   int,                    -- null = a API não respondeu
  ms       int NOT NULL,
  venda_id bigint,
  fila     text NOT NULL           -- venda | consulta
);
CREATE INDEX IF NOT EXISTS chamadas_api_em ON revgas.chamadas_api (em);

CREATE TABLE IF NOT EXISTS revgas.eventos (
  id          bigserial PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  conversa_id int NOT NULL,
  tipo        text NOT NULL,       -- mensagem | venda | transferencia | erro | acompanhar | cancelamento | cliente_reconhecido
  estado      text,
  motivo      text,
  resultado   text,
  ms          int,
  ia          boolean
);
CREATE INDEX IF NOT EXISTS eventos_em ON revgas.eventos (em);

GRANT USAGE ON SCHEMA revgas TO revgas_bot, metabase_leitura;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA revgas TO revgas_bot;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA revgas TO revgas_bot;
GRANT SELECT ON ALL TABLES IN SCHEMA revgas TO metabase_leitura;
