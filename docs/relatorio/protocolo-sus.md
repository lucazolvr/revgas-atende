# Protocolo do teste de usabilidade

## Preparação

1. Combine com João Vitor um número de demonstração com o bot em execução. Faça um piloto com a equipe. O objetivo é concluir a jornada no WhatsApp, usando o adaptador de venda de teste se a equipe não tiver autorizado um pedido real no ERP. Registre a configuração aplicada no relatório.
2. Convide de 5 a 8 pessoas para uma sessão individual e explique que a participação é voluntária. Teste com a mesma versão e o mesmo cenário. Números fora de `NUMEROS_IA` usam o menu no ambiente descrito pelo projeto. Registre o modo de cada sessão antes de interpretar os resultados.
3. Crie um formulário com a escala SUS da referência abaixo e as três perguntas abertas. Desative a captura automática de e-mail. Identifique cada sessão com P01, P02 e assim por diante. Guarde o material bruto em local de acesso restrito à equipe.

## Instrução para cada pessoa

“Imagine que você precisa pedir um botijão P13 para entrega e quer pagar por Pix. Comece a conversa com o número do teste e siga até receber a confirmação. Use o nome e o endereço fictícios do cenário que vou te passar. Se tiver dificuldade, faça o que faria normalmente.”

Observe sem antecipar respostas. Registre se houve confirmação, abandono ou transferência, além de tempo, pedidos de ajuda e pontos de dificuldade. Se houver intervenção, anote a etapa e o tipo de ajuda. Aplique o SUS imediatamente depois da tentativa e antes de comentar o desempenho, inclusive quando a pessoa não concluir.

## Formulário

- Título: Avaliação do atendimento RevGás pelo WhatsApp.
- Introdução: “Avalie o atendimento automatizado que você acabou de usar pelo WhatsApp. Responda com base na sua experiência nessa tarefa.”
- Código da sessão: P01 a P08, atribuído pela moderadora.
- SUS: copie as 10 afirmações da Tabela 1 da [versão brasileira publicada em Aquichan](https://doi.org/10.5294/aqui.2022.22.2.8), na mesma ordem. Apresente uma escolha obrigatória por item, de 1 (Discordo totalmente) a 5 (Concordo totalmente), com 3 como ponto neutro.
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

Fontes do método: [Brooke, 1996](https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf), [escala brasileira](https://doi.org/10.5294/aqui.2022.22.2.8) e [Braun e Clarke, 2006](https://doi.org/10.1191/1478088706qp063oa).
