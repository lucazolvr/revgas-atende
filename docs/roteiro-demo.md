# Roteiro da demonstração do RevGás Atende

Base: [seção 9 do documento de design](superpowers/specs/2026-11-18-revgas-atende-design.md#9-demonstração-roteiro). Duração sugerida: 5–6 minutos.

## Checklist antes de apresentar

- [ ] Docker ligado e `docker compose up -d` no computador da demo.
- [ ] WhatsApp do chip da revenda conectado: QR em `http://127.0.0.1:3002/dashboard`, no computador da demo, com a sessão `default` em execução.
- [ ] Número de quem vai fazer o pedido com IA incluído em `NUMEROS_IA`. Um segundo número, fora da lista, para o pedido pelo menu.
- [ ] Chatwoot aberto na caixa "WhatsApp RevGás", com o WhatsApp do celular espelhado ao lado. Defina quem apresenta e quem opera o painel como atendente.
- [ ] Bot respondendo a um “oi” e atendente conseguindo devolver uma mensagem pelo painel.
- [ ] Se aparecer “não é possível conectar novos dispositivos”: no dashboard do WAHA, faça Logout, apague a sessão, rode `npm run setup` e leia o QR de novo. Foi o que resolveu em 21/11. Evite conectar e desconectar o número várias vezes seguidas.
- [ ] Conversas limpas para cada cenário, dados fictícios e notificações, contatos e credenciais ocultos.
- [ ] Vídeo do ensaio salvo localmente (abre sem internet) e tabela de resultados da avaliação aberta.

## Durante a demo

| Tempo | Cenário | O que fazer e mostrar |
| --- | --- | --- |
| 0:00–0:30 | Problema | Explique que os pedidos chegam pelo WhatsApp e são digitados à mão no ERP. Apresente o fluxo: conversa, confirmação, venda no ERP e atendimento humano. |
| 0:30–1:45 | Pedido em texto livre (IA) | Do número em `NUMEROS_IA`, envie “Boa tarde, quero 2 botijões pra Rua Nova 10, Centro, Teresina, pago no Pix”. O bot deduz o estado pela cidade (Teresina → PI) e pergunta só o que falta, como o nome. Aponte produto, quantidade, valor, endereço e pagamento no resumo. Confirme com `1` e mostre a venda na aba “Pedido RevGás” do Chatwoot. |
| 1:45–2:50 | Pedido pelo menu | Do número fora de `NUMEROS_IA`, inicie com “oi” e escolha as opções do menu. Informe os dados de demonstração, confira o resumo e confirme. Mostre que o caminho sem IA também chega à venda. |
| 2:50–3:30 | Dúvida frequente (RAG) | Pergunte “Vocês entregam no domingo?”. A FAQ de demonstração responde com o horário de domingo (8h às 13h, dado fictício). Mostre que a resposta vem da base de conhecimento. |
| 3:30–4:50 | Emergência simulada | Em conversa separada, envie “Tô sentindo cheiro de gás”. Mostre as orientações de segurança imediatas e a conversa no Chatwoot como urgente, com etiquetas de vazamento. O atendente responde pelo painel e a resposta chega ao WhatsApp. |
| 4:50–5:30 | Avaliação | Mostre os resultados medidos: intenção 100%, F1 de 97,2% e −45% de mensagens com IA (Wilcoxon p = 0,00014), e a síntese do teste com usuários (SUS). Identifique qualquer medição ainda pendente. |

Depois da demo, cancele as vendas de teste pela aba “Pedido RevGás” ou com `npm run cancelar-venda -- <id>`.

## Plano B

No ensaio, grave os quatro cenários com WhatsApp e Chatwoot visíveis, incluindo a venda de teste e a chegada da resposta humana no WhatsApp. Use dados fictícios, revise a gravação e salve uma cópia local que abra sem internet.

Se o WhatsApp cair durante a apresentação:

1. Tente reconectar uma vez pelo dashboard do WAHA (checklist acima).
2. Se não voltar, demonstre com o cliente simulado pelo Chatwoot, mostrando o fluxo do bot e o painel.
3. Se o ambiente inteiro falhar, siga com o vídeo do ensaio a partir da cena correspondente.

Registre em qual versão e ambiente o vídeo foi gravado.

## Ensaio e registro

| Item | Registro do ensaio |
| --- | --- |
| Data, computador e commit | A preencher |
| Instalação do zero pelo README: onde travou | A preencher |
| Pedido com IA | A preencher |
| Pedido pelo menu | A preencher |
| Dúvida (FAQ) | A preencher |
| Emergência e resposta pelo Chatwoot | A preencher |
| Vendas de teste canceladas | A preencher |
| Vídeo gravado e reproduzido sem internet | A preencher |
| Ajustes e responsáveis | A preencher |
