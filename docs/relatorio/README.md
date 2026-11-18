# RevGás Atende — relatório de extensão

Projeto de Extensão VI · Transformação Digital · 2026.2

**Versão para revisão.** Método planejado e resultados pendentes da execução.

## 1. Introdução e problema

A equipe identificou que os pedidos de gás recebidos pelo WhatsApp precisam ser transcritos para o ERP RevGás. Esse fluxo exige conferir informações em dois sistemas e pode gerar retrabalho ao corrigir dados incompletos. O projeto investiga como coletar e validar o pedido pelo próprio WhatsApp, registrar a venda após confirmação e transferir a conversa para um atendente quando necessário.

## 2. Revisão bibliográfica

Følstad e Skjuve (2019) entrevistaram usuários de chatbots de atendimento e observaram que respostas adequadas a dúvidas simples e um caminho claro para atendimento humano são importantes para a experiência. No RevGás Atende, isso fundamenta o uso do Chatwoot como destino para conversas que exigem intervenção.

Um estudo publicado na IEEE ICCT (2025) modela o atendimento como duas etapas, do chatbot ao agente humano, e considera o tempo de espera pela equipe. Isso oferece uma referência para registrar a continuidade do atendimento após a transferência.

Schick et al. (2023) exploram como modelos de linguagem podem selecionar ferramentas e usar suas respostas. Esse trabalho contextualiza o *tool calling*. No RevGás Atende, conforme o design, Gemini classifica a intenção e extrai dados em formato estruturado. A máquina de estados controla as ações que afetam o pedido, como calcular o total e registrar a venda após a confirmação.

Lewis et al. (2020) combinam geração de texto com recuperação de informação externa. Esse princípio embasa a estratégia proposta para a FAQ, que consulta uma base de conhecimento antes de produzir uma resposta. As respostas da demo devem ser comparadas com a FAQ que estiver em execução.

## 3. Arquitetura

O cliente conversa no WhatsApp. A Evolution API encaminha mensagens ao Chatwoot, que aciona o webhook do bot. O bot em Node.js e TypeScript executa o fluxo de pedido, guarda o estado no Redis e responde pelo Chatwoot. Gemini interpreta texto livre para os números configurados e o menu conduz os demais. O catálogo fornece produto e preço. A porta de vendas aceita um adaptador falso para os testes e o adaptador HTTP para o ambiente autorizado do ERP. Na transferência, a conversa é aberta para a equipe no Chatwoot, com contexto para continuidade. A FAQ com RAG faz parte do design e sua versão deve ser confirmada com Eduardo para o relatório final.

Referências internas: [README](../../README.md) e [documento de design](../superpowers/specs/2026-11-18-revgas-atende-design.md).

## 4. Método

### Avaliação quantitativa

Em conjunto com Lucas, registrar a versão do bot, ambiente, amostra e critérios de cada medição.

- Avaliação offline da IA: acurácia de intenção e precisão e revocação por tipo de entidade, usando mensagens rotuladas.
- Simulação ponta a ponta: pedidos concluídos sobre tentativas, quantidade de mensagens e tempo até o registro, com API falsa.
- Comparação com e sem IA: aplicar os mesmos cenários nas duas condições, usando sessões independentes e o mesmo critério de início e fim. Hipótese: a interpretação de texto livre reduz a quantidade de mensagens até a conclusão. Informar as tentativas que não concluíram e comparar tempo até o registro entre pedidos concluídos.
- Testes automatizados: reportar o comando, o número de testes executados e a cobertura quando disponível.

### Avaliação de usabilidade

Recrutar de 5 a 8 pessoas para fazer a jornada de pedido pelo WhatsApp com o bot em execução. Aplicar a escala SUS logo após a tentativa e coletar respostas abertas. A nota SUS resume a usabilidade percebida em pontos. A codificação temática descreve os motivos relatados para facilidades e dificuldades. O [protocolo de teste](protocolo-sus.md) detalha a tarefa, o instrumento, a pontuação e a análise. Relatar a amostra e o modo de atendimento, especialmente se os participantes forem atendidos pelo menu.

## 5. Resultados

| Medição | Resultado | Evidência ou informação a registrar |
| --- | --- | --- |
| Intenção e entidades | Pendente | Amostra, acurácia, precisão e revocação por entidade |
| Simulação ponta a ponta | Pendente | Conclusões/tentativas, mensagens, tempo e falhas |
| Comparação com e sem IA | Pendente | Pares comparáveis, versão, resumo por condição e diferença observada |
| Testes automatizados | Pendente | Comandos, execução e cobertura disponível |
| Avaliação pelo SUS | Pendente | Sessões válidas, média, mediana e intervalo |
| Respostas abertas | Pendente | Temas, pessoas por tema, evidências desidentificadas e ajustes propostos |

Quando os dados estiverem disponíveis, discuta se os resultados sustentam a hipótese quantitativa e em quais etapas ocorreram dificuldades de usabilidade. Informe falhas e resultados inconclusivos junto dos casos bem-sucedidos.

## 6. Limitações

O uso de um conector não oficial do WhatsApp torna a disponibilidade do canal dependente da sessão e traz risco de bloqueio do número. A cota gratuita do Gemini e a configuração de números autorizados limitam o alcance da avaliação do fluxo com IA. No modo de venda real, o cliente de demonstração no ERP limita o que o teste permite concluir sobre a identificação de clientes. Uma amostra pequena e de conveniência permite identificar dificuldades na jornada observada, com alcance limitado para generalizações.

## 7. Conclusão

A proposta conecta um fluxo de pedido no WhatsApp a regras de validação e a atendimento humano no Chatwoot. Após a coleta, completar a conclusão com o que funcionou na versão testada, as dificuldades observadas, o resultado da comparação com e sem IA e as melhorias que os dados sustentam.

## Referências

- BROOKE, J. SUS: A quick and dirty usability scale. In: *Usability Evaluation in Industry*. 1996. [Texto](https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf).
- BRAUN, V.; CLARKE, V. Using thematic analysis in psychology. *Qualitative Research in Psychology*, 2006. [DOI](https://doi.org/10.1191/1478088706qp063oa).
- FØLSTAD, A.; SKJUVE, M. B. Chatbots for Customer Service: User Experience and Motivation. *ACM CUI*, 2019. [DOI](https://doi.org/10.1145/3342775.3342784).
- The Analysis of Contact Center Model with Two Service Stages and Chatbot Service Time Taken into Account. *IEEE ICCT*, 2025. [DOI](https://doi.org/10.1109/ICCT67028.2025.11427476).
- LEWIS, P. et al. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. *NeurIPS*, 2020. [Anais](https://proceedings.neurips.cc/paper/2020/hash/6b493230-Abstract.html).
- SCHICK, T. et al. Toolformer: Language Models Can Teach Themselves to Use Tools. *NeurIPS*, 2023. [Anais](https://proceedings.neurips.cc/paper_files/paper/2023/hash/d842425e4bf79ba039352da0f658a906-Abstract-Conference.html).
- Tradução e adaptação transcultural da System Usability Scale para o português do Brasil. *Aquichan*, 2022. [DOI](https://doi.org/10.5294/aqui.2022.22.2.8).
