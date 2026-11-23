# Roteiro da demonstração do RevGás Atende

Base: [seção 9 do documento de design](superpowers/specs/2026-11-18-revgas-atende-design.md#9-demonstração-roteiro). Duração sugerida: 5–6 minutos.

## Checklist antes de apresentar

- [ ] Docker ligado e `docker compose up -d` no computador da demo.
- [ ] WhatsApp do chip da revenda conectado: QR em `http://127.0.0.1:3002/dashboard`, no computador da demo, com a sessão `default` em execução.
- [ ] No celular do chip, em Aparelhos conectados, **só o computador da demo**. Com dois computadores no mesmo chip, os dois bots respondem (aconteceu em 22/11).
- [ ] Número de quem vai fazer o pedido com IA incluído em `NUMEROS_IA`. Um segundo número, fora da lista, para o pedido pelo menu.
- [ ] Chatwoot aberto na caixa "WhatsApp RevGás", com o WhatsApp do celular espelhado ao lado. Defina quem apresenta e quem opera o painel como atendente. Deixe a lista de conversas em **“Pendentes” ou “Todas”**: enquanto o bot atende, a conversa fica pendente e não aparece no filtro padrão “Abertas”.
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
| 4:50–5:30 | Avaliação | Mostre os resultados medidos: intenção 100%, F1 de 97,2% e −45% de mensagens com IA (Wilcoxon p = 0,00014), e a síntese do teste com usuários: dez participantes, SUS médio de 99,0 (mediana de 100), oito pedidos concluídos com mediana de 9 mensagens, com a ressalva do efeito teto. |

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
| Data, computador e commit | 22/11/2026, notebook da Luiza (Windows 11, 7,8 GB de RAM, Docker Desktop 29.8 com WSL2, Node 22). Branch `feat/4-sus-demo-relatorio` com a `main` (`ede46a1`) mesclada. |
| Instalação do zero pelo README: onde travou | Instalação concluída: containers no ar, setup ok, WhatsApp conectado e bot respondendo a um “oi”. Seis pontos travaram ou confundiram; detalhes em [Instalação do zero](#instalação-do-zero-22112026). |
| Pedido com IA | ✅ 22/11, 04:45. Uma mensagem com produto, quantidade, endereço e pagamento; o bot deduziu PI de Teresina e só perguntou o nome. Resumo certo (2 × R$ 110,00 = R$ 220,00) e venda 30962358 criada após o “1”. |
| Pedido pelo menu | ✅ 22/11, 04:59. Fluxo completo pelo menu (nome, produto, quantidade, rua, número, bairro, cidade, pagamento e troco); “Teresina” sem estado virou Teresina/PI. Venda 30962359 (4 × R$ 110,00 = R$ 440,00) na aba e em “Pedidos de hoje”. Observação: a rua foi respondida em duas linhas (“Rua … / Sim, para entregar”), o bot guardou as duas como rua e o resumo com o erro foi confirmado. |
| Dúvida (FAQ) | ✅ 22/11, 05:17. “Vocês entregam no domingo?” → “Sim, realizamos entregas aos domingos das 8h às 13h” (dado de demonstração); em seguida o bot retomou o pedido. |
| Emergência e resposta pelo Chatwoot | ✅ 22/11, 05:20. Orientações de segurança na hora e aviso de atendente; no Chatwoot, conversa aberta para a equipe, prioridade urgente, etiquetas `vazamento` e `urgente` e nota-resumo. A resposta do atendente (05:24) chegou ao WhatsApp no mesmo minuto. Extra: mensagens de um grupo em que o chip está chegaram ao Chatwoot e o bot não respondeu (correção do PR #19 confirmada). |
| Vendas de teste canceladas | ✅ 30962358, 30962359 e 30962355 (esta de um teste anterior, R$ 1.980,00), com `npm run cancelar-venda`. |
| Vídeo gravado e reproduzido sem internet | ✅ 22/11, 06:00–06:35: os cinco cenários gravados em pares (tela do computador com o Chatwoot e tela do celular), salvos localmente fora do repositório. Cada dupla foi juntada lado a lado (as duas telas não ficaram perfeitamente sincronizadas), com um vídeo por cenário e um vídeo único com os cinco, na [pasta da equipe no Drive](https://drive.google.com/drive/folders/1aibjL-MMwX96KsxHaOeFSyhR_P0LWy3J?usp=drive_link). Para o cenário 2, o número de teste saiu de `NUMEROS_IA` durante a gravação e voltou em seguida. As vendas criadas na gravação foram canceladas. |
| Ajustes e responsáveis | Checklist da demo atualizado (um computador por chip; Chatwoot em “Pendentes”). README corrigido com os avisos da instalação (ver abaixo). A decidir com a equipe: tratar resposta de rua com várias linhas. Prints em [relatorio/ensaio-2026-11-22](relatorio/ensaio-2026-11-22/). |

### Instalação do zero (22/11/2026)

Seguindo o README como alguém novo na equipe, em Windows 11 com 7,8 GB de RAM:

1. **Download das imagens.** O primeiro `docker compose up -d` falhou com erro de rede ao falar com o Docker Hub; na segunda tentativa, o download do Chatwoot travou sem mostrar erro. Resolveu baixar uma imagem por vez (`docker pull`) e só depois rodar o `up`. Sugestão para o README: rodar `docker compose pull` antes do `up`.
2. **`.env` antigo.** O `.env` repassado pela equipe era da época da Evolution: tinha `EVOLUTION_API_KEY` e não tinha `WAHA_API_KEY`, `WAHA_DASHBOARD_PASSWORD` nem `PAINEL_TOKEN`. O `.env` foi montado a partir do `.env.example`, reaproveitando só Gemini, `NUMEROS_IA` e as credenciais da API de teste; os tokens do Chatwoot não servem de uma instalação para outra.
3. **`CHATWOOT_ACCOUNT_ID`.** O `.env.example` traz `1`, mas na instalação nova a conta criada no Chatwoot ficou com id `2`. Nem o README nem o `npm run setup` avisam. Sugestão: o setup descobrir o id pelo perfil do token ou o README mandar conferir.
4. **Bot reiniciando antes do setup.** No primeiro `docker compose up -d`, o bot fica em loop com `CHATWOOT_BOT_TOKEN: Too small`. É esperado (o token só existe depois do setup), mas o README não avisa e parece defeito.
5. **Sessão do WAHA em `FAILED`.** O `npm run setup` já inicia a sessão e gera o QR. Até a pessoa entrar no dashboard e colar a chave no Worker, os QR expiram (~3 min) e a sessão cai em `FAILED`. Resolveu com *Restart* na linha da sessão `default` (tabela Sessions, não a de Workers).
6. **“Verifique sua conexão” no celular** ao ler o QR. O WAHA não registrou tentativa de pareamento, então o problema estava no celular do chip; resolveu na nova tentativa.

Outros pontos:

- O `npm run setup` manda rodar `docker compose up -d --build bot`; o README, `docker compose up -d --build`. Foi usado o do README, que também roda o `chatwoot-config` com o token novo.
- Memória: o Docker com WSL2 fica limitado a metade da RAM (~3,7 GB neste notebook). Com tudo no ar, os containers usaram ~1,5 GB, então não foi preciso mudar o limite. Fechar outros programas ajudou, porque sobrava pouco para o Windows.
- Com `VENDA_REAL=true` (valor do `.env` da equipe), todo pedido confirmado no ensaio cria venda na API de teste e precisa ser cancelado depois.
