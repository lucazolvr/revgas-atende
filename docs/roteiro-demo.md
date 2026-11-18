# Roteiro da demonstração do RevGás Atende

Base: [seção 9 do documento de design](superpowers/specs/2026-11-18-revgas-atende-design.md#9-demonstração-roteiro). Duração sugerida: 5–6 minutos.

## Antes de apresentar

- Abra o Chatwoot e espelhe o WhatsApp lado a lado. Defina quem apresenta e quem opera o painel como atendente.
- Confira se o bot responde a um “oi”, se a caixa de entrada está conectada e se o atendente consegue devolver uma mensagem pelo painel.
- Separe uma conversa limpa para cada cenário. Use um número da equipe habilitado em `NUMEROS_IA` para texto livre e para a dúvida e outro número para o menu. Combine com Eduardo qual pergunta consta na FAQ da versão da demo.
- Use dados de demonstração e confirme o modo de venda antes de começar. Com a API falsa, mostre o registro de demonstração. Só mostre uma venda no ERP em ambiente autorizado e previamente combinado com João Vitor.
- Deixe abertos o vídeo local de reserva e a tabela de resultados medidos. Oculte notificações, contatos, números, credenciais e dados de clientes.

## Durante a demo

| Tempo | Cenário | O que fazer e mostrar |
| --- | --- | --- |
| 0:00–0:30 | Problema | Explique que pedidos chegam pelo WhatsApp e apresente o fluxo de conversa, confirmação e atendimento humano. |
| 0:30–1:45 | Pedido em texto livre | Envie “Boa tarde, quero 2 botijões pra Rua Nova 10, Centro, Teresina–PI, pago no Pix”. Preencha o nome fictício e qualquer campo que o bot solicitar. Aponte produto, quantidade, valor, endereço e pagamento no resumo. Confirme com `1` quando a opção aparecer e mostre a confirmação e o registro no modo escolhido. |
| 1:45–2:50 | Pedido por menu | No número sem IA, inicie com “oi” e selecione as opções que o bot mostrar. Informe os dados de demonstração quando solicitados, confira o resumo e confirme. Mostre que o fluxo alternativo também chega ao registro. |
| 2:50–3:30 | Dúvida frequente | Pergunte “Vocês entregam no domingo?” se a FAQ validada tiver essa resposta. Caso contrário, use uma pergunta coberta pela FAQ da versão em execução. Mostre a resposta e sua correspondência com a base. |
| 3:30–4:50 | Emergência simulada | Em conversa separada, envie “Tô sentindo cheiro de gás”. Mostre a orientação automática e a conversa aberta no Chatwoot com prioridade alta e etiquetas de emergência. O atendente responde pelo painel e a apresentação mostra a chegada da mensagem no WhatsApp. Use um texto curto para confirmar o recebimento do atendimento de teste. |
| 4:50–5:30 | Avaliação | Mostre as métricas verificadas com Lucas e a síntese da avaliação de usabilidade. Identifique qualquer medição que ainda esteja pendente. |

## Plano B

No ensaio, grave os quatro cenários com WhatsApp e Chatwoot visíveis. Inclua a confirmação da venda de teste e a chegada da resposta humana no WhatsApp. Use dados fictícios, revise a gravação e salve uma cópia local que abra sem internet. Se o WhatsApp cair durante a apresentação, informe que a demonstração seguirá com a gravação do ensaio e continue pela cena correspondente. Registre em qual versão e ambiente o vídeo foi gravado.

## Ensaio e registro

| Item | Registro do ensaio |
| --- | --- |
| Data, versão e modo de venda | A preencher |
| Texto livre, menu, FAQ e emergência | A preencher |
| Vídeo gravado e reproduzido sem internet | A preencher |
| Ajustes e responsáveis | A preencher |
