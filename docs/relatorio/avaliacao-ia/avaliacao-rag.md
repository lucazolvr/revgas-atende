# Avaliação do RAG híbrido: busca vetorial × híbrida

**RevGás Atende** · Projeto de Extensão VI · Transformação Digital · 2026.2
Entrega da issue [#27](https://github.com/lucazolvr/revgas-atende/issues/27) · Responsável: João Vitor · Execução: 22/11/2026
Implementação avaliada: PR [#28](https://github.com/lucazolvr/revgas-atende/pull/28) (issue #26)

---

## Resumo

Comparamos as duas formas de o bot achar a resposta na FAQ, com as mesmas 27 perguntas rotuladas e os mesmos vetores do Gemini:

- **vetorial** (como era antes): só a similaridade de cosseno entre a pergunta e cada trecho;
- **híbrida** (a do bot hoje): cosseno **mais** palavras-chave com BM25, com os dois rankings juntados por Reciprocal Rank Fusion (RRF).

**Com os limiares que o bot usa hoje, o híbrido não melhorou a resposta em 1º lugar.**

| Modo | Acerto@1 | Acerto@3 | Recusa correta | Respostas indevidas |
|---|---:|---:|---:|---:|
| Vetorial (antes) | **85,0%** (17/20) | 90,0% (18/20) | 57,1% (4/7) | 3 |
| Híbrido (bot hoje) | 80,0% (16/20) | **95,0%** (19/20) | 57,1% (4/7) | 3 |

Os dois modos discordaram em **uma pergunta só**, e a diferença não é estatisticamente significativa (McNemar exato, p = 1,0). O resultado é praticamente um empate.

O achado mais útil está em outro lugar. Os dois modos erram as mesmas perguntas de fora da FAQ (3 de 7 recebem trecho), porque os vetores do Gemini dão **cosseno entre 0,65 e 0,75 para quase qualquer pergunta sobre gás**. O limiar de 0,65 fica no meio desse ruído.

É aí que o híbrido mostra valor. Subindo o limiar do cosseno para 0,70:
- o **vetorial desaba**: acerto@1 cai para 50% e 8 perguntas da FAQ ficam sem resposta;
- o **híbrido segura** 75% de acerto@1 e **recusa todas as perguntas de fora** (7/7), porque o BM25 resgata as perguntas com palavra rara ("pix", "domingo", "timon").

Esse ajuste não foi aplicado: com 27 perguntas, escolher o limiar por esta tabela seria ajustar o bot ao próprio teste (seção 6).

---

## 1. Objetivo

Medir se o RAG híbrido (técnica do slide 11 da aula 00), implementado na #26, acha o trecho certo da FAQ mais vezes que a busca só vetorial, e se ele recusa melhor as perguntas que a FAQ não cobre. O resultado entra no relatório mesmo que o híbrido não ganhe.

## 2. Método

### 2.1 Perguntas rotuladas

O arquivo é `eval/perguntas-faq.jsonl`: 27 perguntas escritas e rotuladas **antes** de rodar qualquer um dos modos, para não puxar o resultado.

- **20 perguntas da FAQ**, de 2 a 4 por assunto: área de entrega, horário, pagamento, preço, segurança e troca de botijão. Cada uma traz a fonte esperada. As de preço aceitam duas fontes certas, o catálogo (`config/catalogo.json`, que tem o valor do P13) ou a `preco.md`.
- **7 perguntas fora da FAQ**, em que o certo é **não responder**: água mineral, time de futebol, venda de fogão, vaga de emprego, CNPJ, conserto de fogão e previsão do tempo.
- **Escrita de cliente:** sem acento, abreviações ("vcs", "qto", "hj") e sem pontuação.
- **Equilíbrio:** perguntas com palavra rara da FAQ ("aceita pix?", "entrega em timon") favorecem o BM25. Perguntas que só batem pelo sentido ("preciso devolver o vazio?", "ta caro o gas ai?") favorecem o vetor. As duas entraram, para não favorecer nenhum modo.

### 2.2 O que foi rodado

O script é `eval/avaliar-rag.ts` (`npm run eval:rag`).

- **Trechos:** os mesmos 7 do bot, ou seja, os 6 arquivos da FAQ e o trecho de preços do catálogo, montados com o mesmo código (`carregarFaq` e `trechoCatalogo`).
- **Embeddings:** `gemini-embedding-001`, com a mesma classe do bot (`EmbeddingsGemini`). Os vetores são calculados **uma vez** e guardados, e os dois modos usam exatamente os mesmos números. Assim, a diferença medida vem só da forma de buscar. A rodada inteira fez **1 chamada** ao Gemini.
- **Só a busca:** o script chama `BaseConhecimento.buscar`, sem gerar resposta. Até 3 trechos por pergunta, como no bot.
- **Limiares do bot:** cosseno ≥ 0,65 (nos dois modos); no híbrido, também BM25 ≥ 1,5 (um trecho entra se passar em **um** dos dois).

### 2.3 Métricas

| Métrica | Definição |
|---|---|
| Acerto@1 | Pergunta da FAQ em que a fonte certa veio em 1º lugar |
| Acerto@3 | Pergunta da FAQ em que a fonte certa está entre os 3 trechos |
| FAQ sem resposta | Pergunta da FAQ que ficou sem nenhum trecho (o bot diria que não sabe) |
| Recusa correta | Pergunta fora da FAQ que ficou sem trecho |
| Resposta indevida | Pergunta fora da FAQ que recebeu trecho (o bot tentaria responder) |
| Acerto geral | Acerto@1 na FAQ + recusa correta fora dela |

Para comparar os dois modos nas mesmas perguntas, usamos o **teste de McNemar exato**, que olha só as perguntas em que um modo acertou e o outro errou.

## 3. Resultados

Os resultados completos, pergunta a pergunta, estão em `eval/resultados/rag-2026-11-22.md` e `.json`.

### 3.1 Vetorial × híbrido (limiares do bot)

| Modo | Acerto@1 | Acerto@3 | FAQ sem resposta | Recusa correta | Respostas indevidas | Acerto geral |
|---|---:|---:|---:|---:|---:|---:|
| Vetorial (antes) | 17/20 (85,0%) | 18/20 (90,0%) | 0 | 4/7 (57,1%) | 3 | 21/27 (77,8%) |
| **Híbrido (bot hoje)** | 16/20 (80,0%) | 19/20 (95,0%) | 0 | 4/7 (57,1%) | 3 | 20/27 (74,1%) |

- No acerto geral, só o vetorial acertou 1 pergunta e só o híbrido acertou 0. McNemar exato: p = 1,0, com n = 1 discordância.

### 3.2 Onde os modos diferiram

| # | Pergunta | Vetorial | Híbrido |
|---:|---|---|---|
| 14 | "qual o valor do botijao hoje" | ✓ catálogo em 1º (cos 0,75) | ✗ troca de botijão em 1º (BM25 2,46), catálogo em 2º |
| 5 | "tem gás no domingo?" | ✗ horário **fora** dos 3 | ✗ horário em 3º (BM25 2,18), mas entre os 3: conta no acerto@3 |

- **Pergunta 14 (o híbrido perdeu):** a palavra "botijão" aparece três vezes no texto da troca de botijão. Numa FAQ de 7 trechos, isso basta para o BM25 dar nota alta (2,46) a uma palavra que, para o cliente, é genérica. O RRF põe esse trecho em 1º.
- **Pergunta 5 (o híbrido ganhou só no acerto@3):** "domingo" é palavra rara e só aparece no horário (BM25 2,18). O vetor, porém, deixa o horário fora dos 3 primeiros (cosseno 0,68, abaixo de preço, catálogo e troca). O RRF soma as **posições**, não as notas, então o 1º lugar no BM25 não basta para passar os trechos que o vetor pôs no topo.

### 3.3 Erros que os dois modos cometem

| # | Pergunta | O que veio em 1º (nos dois) |
|---:|---|---|
| 3 | "quanto tempo demora pra chegar o gas" | `preco` (cos 0,71); a área de entrega não aparece |
| 5 | "tem gás no domingo?" | `preco` (cos 0,71) |
| 8 | "posso pedir umas 19h50 ainda?" | área de entrega (0,70), com o horário em 2º (0,69) |
| 23 | "vcs vendem fogao?" | catálogo (0,69): resposta indevida |
| 26 | "vcs consertam fogão?" | segurança (0,68): resposta indevida |
| 27 | "vai chover amanha em teresina?" | área de entrega (0,65; "teresina" dá BM25 1,29): resposta indevida |

### 3.4 Sensibilidade aos limiares

| Modo | Acerto@1 | Acerto@3 | FAQ sem resposta | Recusa correta | Acerto geral |
|---|---:|---:|---:|---:|---:|
| vetorial, cosseno ≥ 0,60 | 85,0% | 90,0% | 0 | 1/7 | 66,7% |
| **vetorial, cosseno ≥ 0,65 (antes)** | 85,0% | 90,0% | 0 | 4/7 | 77,8% |
| vetorial, cosseno ≥ 0,70 | 50,0% | 50,0% | **8** | 7/7 | 63,0% |
| híbrido, cosseno ≥ 0,60 ou BM25 ≥ 1,5 | 75,0% | 100,0% | 0 | 1/7 | 59,3% |
| **híbrido, cosseno ≥ 0,65 ou BM25 ≥ 1,5 (bot hoje)** | 80,0% | 95,0% | 0 | 4/7 | 74,1% |
| híbrido, cosseno ≥ 0,70 ou BM25 ≥ 1,0 | 75,0% | 95,0% | 1 | 6/7 | 77,8% |
| híbrido, cosseno ≥ 0,70 ou BM25 ≥ 1,5 | 75,0% | 85,0% | 2 | **7/7** | **81,5%** |

A tabela completa, com os 12 cenários, está em `eval/resultados/rag-2026-11-22.md`. O limiar do BM25 (1,0, 1,5 ou 2,0) quase não muda nada; o que pesa é o limiar do cosseno.

## 4. Discussão

1. **O problema principal é a recusa, não o modo.** Com o `gemini-embedding-001`, qualquer pergunta sobre o assunto do bot dá cosseno de 0,65 a 0,75 com quase todos os trechos. O limiar de 0,65 deixa passar "vcs vendem fogao?" (0,69) e "vai chover amanha em teresina?" (0,65). Isso acontece **igual nos dois modos**, porque o híbrido mantém o mesmo limiar de cosseno.
2. **O valor do híbrido aparece quando o cosseno fica mais exigente.** Com cosseno ≥ 0,70, o vetorial perde 8 das 20 perguntas da FAQ. O híbrido perde só 2, porque o BM25 resgata as perguntas com palavra rara, e recusa todas as de fora. O BM25 funciona como **rede de segurança** para um limiar de cosseno mais alto, e é aí que a técnica se justifica neste projeto.
3. **O BM25 é instável numa base tão pequena.** Com 7 trechos, a raridade de uma palavra (IDF) depende de poucas ocorrências. "Botijão" virou palavra "rara" no trecho da troca e tirou o 1º lugar do catálogo na pergunta 14.
4. **O RRF olha só a posição.** Ele não usa a nota do BM25 nem a do cosseno, só a posição em cada lista. Na pergunta 5, ser o 1º no BM25 com nota 2,18 vale o mesmo que ser o 1º com 1,6. Uma fusão ponderada pelas notas poderia ajudar, mas também precisaria de mais perguntas para calibrar.
5. **O trecho `preco.md` atrai perguntas que não são dele.** O texto é curto e genérico ("o preço do gás está no catálogo") e ficou em 1º lugar nas perguntas 3 e 5, que são de entrega e horário. Juntar esse aviso ao trecho do catálogo, ou tirá-lo da busca, deve melhorar os dois modos.
6. **Recuperar um trecho não é responder errado.** Esta avaliação mede só a busca. No bot, o Gemini ainda gera a resposta a partir dos trechos e passa por uma validação (`validarRespostaRag`). Com o trecho do catálogo, por exemplo, "vcs vendem fogao?" pode virar "só vendemos o botijão P13", que não é errado. A qualidade da resposta final não foi medida aqui.

## 5. Recomendações (não aplicadas neste PR)

1. **Ampliar as perguntas** com as do teste com usuários (#4), antes de mexer em limiar. Com mais perguntas, testar o cosseno ≥ 0,70 no híbrido, que foi o melhor cenário aqui (81,5% de acerto geral e 100% de recusa correta).
2. **Juntar o `preco.md` ao trecho do catálogo**, ou tirá-lo da busca, e medir de novo.
3. **Opcional:** testar uma fusão que use as notas, e não só as posições, depois de ampliar as perguntas.

## 6. Limitações e ameaças à validade

- **Perguntas escritas pela equipe**, imitando clientes, e não mensagens reais.
- **Poucos dados:** 27 perguntas (20 da FAQ e 7 de fora). Uma pergunta muda o acerto@1 em 5 pontos percentuais, e o teste estatístico tem pouco poder: p alto não prova que os modos são iguais.
- **FAQ pequena e fictícia:** 7 trechos, um por assunto. O BM25 e o RRF costumam ajudar mais em bases grandes, com muitos trechos parecidos.
- **Rótulo com uma fonte por assunto:** algumas perguntas são de fronteira. Por exemplo, "posso pedir umas 19h50 ainda?" é de horário, mas a área de entrega fala de prazo.
- **Limiares calibrados na mesma FAQ:** o 1,5 do BM25 foi escolhido no PR #28 olhando a FAQ, e a tabela de sensibilidade usa as mesmas perguntas. Ela serve para entender o comportamento, não para escolher o valor.
- **Resultado de um dia:** os vetores do `gemini-embedding-001` podem mudar se o Google atualizar o modelo.

## 7. Como reproduzir

Requer `GEMINI_API_KEY` no `.env`. A rodada faz 1 chamada de embeddings, com cota quase zero.

```bash
npm run eval:rag    # → eval/resultados/rag-<data>.{md,json}
```

| Arquivo | Conteúdo |
|---|---|
| `eval/perguntas-faq.jsonl` | As 27 perguntas rotuladas |
| `eval/avaliar-rag.ts` | O script: os dois modos, as métricas e a sensibilidade aos limiares |
| `eval/estatistica.ts` | `mcnemarExato`, o teste para os dois modos nas mesmas perguntas |
| `tests/eval/avaliar-rag.test.ts` | Testes do script, sem rede |
| `eval/resultados/rag-2026-11-22.{md,json}` | Esta rodada |
