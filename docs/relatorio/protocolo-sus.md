# Protocolo do teste de usabilidade

## Preparação

1. **Ambiente.** O bot roda no computador da equipe que estiver com o chip da revenda conectado ao WAHA (QR em `http://127.0.0.1:3002/dashboard`). As sessões só podem acontecer enquanto esse computador estiver ligado. Antes das sessões, faça um piloto com alguém da equipe e anote no relatório a data, o computador e o commit em execução.
2. **Modo de atendimento.** Os números dos participantes **não** entram em `NUMEROS_IA`: na cota grátis do Gemini, as mensagens podem ser usadas pelo Google. Todos os participantes são atendidos pelo **menu**, e o relatório deve dizer que o SUS avalia esse fluxo. Se o `.env` estiver com `NUMEROS_IA=*` (configuração da demo, que liga a IA para todos), troque pela lista da equipe antes das sessões e rode `docker compose up -d --force-recreate bot`.
3. **Vendas de teste.** Com `VENDA_REAL=true`, cada pedido confirmado cria uma venda na API de teste da RevGás (estabelecimento de demonstração 2580). Anote o número do pedido de cada sessão e cancele a venda depois, pela aba "Pedido RevGás" no Chatwoot ou com `npm run cancelar-venda -- <id>`.
4. **Participantes.** Convide de 5 a 8 pessoas para uma sessão individual e explique que a participação é voluntária. Use a mesma versão do bot e o mesmo cenário em todas as sessões. Identifique cada sessão com P01, P02 e assim por diante. Guarde o material bruto em local de acesso restrito à equipe.

## Instrução para cada pessoa

“Imagine que você precisa pedir um botijão P13 para entrega e quer pagar por Pix. Comece a conversa com o número do teste e siga até receber a confirmação. Use o nome e o endereço fictícios do cenário que vou te passar. Se tiver dificuldade, faça o que faria normalmente.”

Cenário fictício sugerido: nome “Maria Souza”, Rua Nova, 10, Centro, Teresina.

Observe sem antecipar respostas. Registre se houve confirmação, abandono ou transferência, além de tempo, pedidos de ajuda e pontos de dificuldade. Se houver intervenção, anote a etapa e o tipo de ajuda. Aplique o SUS imediatamente depois da tentativa e antes de comentar o desempenho, inclusive quando a pessoa não concluir.

## Registro de cada sessão

| Sessão | Data e hora | Concluiu? | Mensagens até concluir | Tempo | Onde travou | Precisou de ajuda? | Nº do pedido (cancelado?) |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| P01 | | | | | | | |

Depois das sessões, `npm run eval:metricas` resume o uso real a partir dos registros do bot (`dados/metricas*.jsonl`), sem texto das mensagens nem dados pessoais. Use esse resumo para conferir as mensagens e os tempos anotados.

## Formulário

O formulário está no Google Forms: “Avaliação do atendimento RevGás pelo WhatsApp”. A primeira seção é o termo de consentimento (Lei nº 13.709/2018, LGPD); sem o “Li e concordo”, o formulário não avança. A pessoa lê e aceita o termo **antes** de começar a conversa com o bot.

### Termo de consentimento (primeira seção do formulário)

> Você está sendo convidado(a) a participar de um teste de usabilidade do RevGás Atende, um atendente virtual de pedidos de gás pelo WhatsApp desenvolvido no Projeto de Extensão VI do curso de Engenharia de Software do iCEV.
>
> - A participação é voluntária, e você pode desistir a qualquer momento, sem precisar justificar.
> - Você fará um pedido fictício pelo WhatsApp, com nome e endereço que a equipe vai fornecer, e depois responderá a um questionário de cerca de 5 minutos.
> - As mensagens que você enviar ao número do teste podem ser processadas pelo Gemini, serviço de inteligência artificial do Google, na cota gratuita, na qual o Google pode usar o conteúdo para melhorar seus produtos. Por isso, não envie dados pessoais reais além do seu número de telefone, que fica visível para a equipe no painel de atendimento durante o teste.
> - O questionário não pede nome nem e-mail. Suas respostas são identificadas só por um código (P01 a P08) e aparecem no relatório sem identificação.
> - O material das sessões fica com acesso restrito à equipe e é apagado após a entrega do trabalho.
>
> ( ) Li e concordo em participar. *(obrigatório)*

### Questionário

- Código da sessão: P01 a P08, atribuído pela moderadora. A coleta de e-mail está desativada.
- SUS: as 10 afirmações da Tabela 1 da [versão brasileira de Lourenço, Valentim e Lopes (2022)](https://doi.org/10.5294/aqui.2022.22.2.8), na mesma ordem, com uma adaptação: “sistema” foi substituído por “atendimento”. Uma escolha obrigatória por item, de 1 (Discordo totalmente) a 5 (Concordo totalmente), com 3 como ponto neutro. Os itens ímpares são positivos e os pares, negativos.
- Perguntas abertas, após o SUS:
  1. Qual parte do pedido foi mais fácil? Por quê?
  2. Em que momento você teve dificuldade ou ficou sem saber o que fazer? O que aconteceu?
  3. Se pudesse mudar uma coisa no atendimento, o que mudaria?

## Pontuação SUS

Para cada sessão completa, subtraia 1 das respostas ímpares e subtraia as respostas pares de 5. Some as dez contribuições e multiplique por 2,5. A nota vai de 0 a 100 pontos. Informe quantas sessões têm respostas válidas e registre eventuais ausências sem preencher respostas por conta própria. Calcule média, mediana e intervalo observado. Exemplo didático: para 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, as dez contribuições valem 3, resultando em 75 pontos.

Para lançar as respostas no Excel em português, use A para o código e B:K para SUS1:SUS10. Na célula L2, insira a fórmula abaixo e copie para cada linha de participante. Configure as células B:K para aceitar somente números inteiros de 1 a 5.

```text
=SE(CONT.NÚM(B2:K2)<>10;"";((B2-1)+(5-C2)+(D2-1)+(5-E2)+(F2-1)+(5-G2)+(H2-1)+(5-I2)+(J2-1)+(5-K2))*2,5)
```

## Respostas abertas

Leia todas as respostas, destaque passagens relevantes e atribua códigos curtos. Agrupe códigos em temas e releia as respostas para revisar os agrupamentos. Uma sessão pode contribuir para mais de um tema. Conte pessoas distintas por tema e selecione exemplos desidentificados. Preserve também relatos que contradigam o padrão. Use os temas para propor ajustes no fluxo e informe o tamanho e o perfil geral da amostra.

| Tema | Códigos associados | Pessoas distintas | Evidência desidentificada | Ajuste proposto |
| --- | --- | ---: | --- | --- |
| A preencher após a coleta | | | | |

Fontes do método: [Brooke, 1996](https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf), [Lourenço, Valentim e Lopes, 2022](https://doi.org/10.5294/aqui.2022.22.2.8) e [Braun e Clarke, 2006](https://doi.org/10.1191/1478088706qp063oa).
