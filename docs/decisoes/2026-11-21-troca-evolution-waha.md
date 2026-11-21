# Decisão: trocar a Evolution API pelo WAHA

- **Data:** 21/11/2026
- **Status:** adotada (PR #17, issue #15)
- **Quem:** equipe RevGás Atende (troca técnica: João Vitor; testes com chip real: Lucas e João Vitor)

## Contexto

O RevGás Atende precisa de uma **ponte entre o WhatsApp e o Chatwoot**: ela recebe as mensagens do cliente, cria as conversas na caixa "WhatsApp RevGás" e entrega ao WhatsApp as respostas do bot e dos atendentes. O bot em si só fala com o Chatwoot (Agent Bot), então a ponte é uma peça trocável.

No design (18/11), a ponte escolhida foi a **Evolution API**, por ter integração gratuita com o Chatwoot.

## O problema

Nos testes com **chip real** (20 e 21/11/2026), cada versão da Evolution falhou de um jeito diferente:

| Versão | O que aconteceu | Referência |
|---|---|---|
| **2.3.7** | O WhatsApp recusava o QR code: *"não é possível conectar novos dispositivos no momento"*. O mesmo número conectava normalmente no WhatsApp Web do navegador | [evolution-api#2696](https://github.com/evolution-foundation/evolution-api/issues/2696) |
| **2.3.6** | Conectava, mas **as mensagens dos clientes não chegavam ao Chatwoot**: `error in handling message` com remetentes `@lid` (novo formato de identificação do WhatsApp) | [#2281](https://github.com/EvolutionAPI/evolution-api/issues/2281), [#1872](https://github.com/evolution-foundation/evolution-api/issues/1872) |
| **2.4.0-rc2** | Passou a exigir **licença registrada** no servidor da Evolution Foundation: sem ativação, toda chamada responde `503 LICENSE_REQUIRED` | [releases](https://github.com/evolution-foundation/evolution-api/releases) |

Não havia versão da Evolution que **conectasse, entregasse mensagens e não exigisse licença** ao mesmo tempo.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| Registrar a licença da Evolution 2.4 | Mantém a ponte já integrada | Termos da licença não ficaram claros; **cada integrante** registraria a própria instalação; dependência de um servidor externo; versão ainda candidata (rc), sem garantia de correção do `@lid` |
| **WAHA Core** (escolhida) | **Grátis e open source, sem licença**; integração com o Chatwoot pronta (app "ChatWoot"); 1 número por instalação, exatamente o nosso caso | Também é **conector não oficial** (mesmo risco de bloqueio do número); a versão grátis tem só 1 sessão |
| WhatsApp Cloud API (oficial, Meta) | Oficial, sem risco de bloqueio; o Chatwoot tem o canal pronto | Exige conta comercial na Meta e **endereço público** (túnel ou servidor), e o projeto roda local; bem mais configuração |
| Fork do Chatwoot ou ponte própria | Controle total | Fora do escopo e do prazo |

## Decisão

Usar o **[WAHA](https://waha.devlike.pro/) Core**, imagem `devlikeapro/waha:gows-2026.10.1`, com o **motor GOWS**: conversa com o WhatsApp sem navegador e lida com remetentes `@lid`.

- Serviço `waha` no `docker-compose.yml`, publicado só em `127.0.0.1:3002`. O compose **recusa subir** sem `WAHA_API_KEY` e `WAHA_DASHBOARD_PASSWORD`.
- O `npm run setup` (`src/canal/whatsapp.ts`) cria ou reaproveita a caixa "WhatsApp RevGás", liga o Agent Bot, cria a integração WAHA ↔ Chatwoot e a sessão do WhatsApp. Ele é idempotente e reaproveita a caixa e o histórico de quem vinha da Evolution.
- O banco `evolution` do Postgres e o volume da Evolution saíram.

## Resultado (21/11/2026)

Teste de ponta a ponta com WhatsApp real (número pessoal, só para o teste):
- Mensagem do cliente → conversa no Chatwoot → resposta do bot no WhatsApp em **0,2 a 1,4 s**. No teste lado a lado do João, foram ~0,05 s do Chatwoot até o WhatsApp, contra **21 a 69 s** de travamento na Evolution.
- Com IA, o pedido inteiro saiu de **uma mensagem**, e o bot perguntou só o que faltava. A venda foi criada na API de teste da RevGás, e a transferência por "cheiro de gás" funcionou.
- Remetentes `@lid` foram atendidos normalmente.

## Consequências e cuidados

- **Defeito encontrado no teste e corrigido:** o WAHA repassa ao Chatwoot também mensagens de **grupos**, e o bot respondia dentro deles. Desde o PR #19, o bot ignora conversas de grupo (`@g.us`) e só atende no privado.
- **"Não é possível conectar novos dispositivos":** também apareceu com o WAHA, depois de várias conexões seguidas. Zerar a sessão (logout, stop, delete) e reiniciar o WAHA resolveu na hora. Evite conectar e desconectar o número muitas vezes seguidas.
- **Continua não oficial:** o risco de bloqueio do número segue igual ao da Evolution. Use um **chip dedicado**, nunca um número pessoal: com o bot ligado, qualquer pessoa que escrever para o número recebe a resposta do bot.
- **Uma sessão por instalação:** cada computador da equipe lê o próprio QR. Para a demo, o chip fica conectado no computador que vai apresentar.
- **Caminho para produção:** a WhatsApp Cloud API (oficial) elimina o risco de bloqueio, mas exige conta comercial e endereço público.
