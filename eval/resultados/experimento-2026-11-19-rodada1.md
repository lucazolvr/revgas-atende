# Experimento: pedido pelo menu × pedido com IA (2026-11-19)

**H1:** com interpretação por IA, o cliente conclui o pedido com **menos mensagens** do que pelo menu numerado.  
**H0:** não há diferença no número de mensagens.  
**Desenho:** pareado. 20 perfis de cliente (`eval/perfis.json`) fazem o mesmo pedido pelos dois caminhos, contra o motor real do bot; um cliente simulado responde às perguntas e confere o resumo antes de confirmar. IA: `gemini-3.1-flash-lite`.  
**Teste:** Wilcoxon de postos sinalizados, bicaudal, α = 0,05.

## Resultados

| Métrica | Menu (controle) | IA (tratamento) |
|---|---:|---:|
| Pedidos concluídos | 18/20 (90%) | 17/20 (85%) |
| Pedidos registrados corretos | 18/20 (90%) | 17/20 (85%) |
| Precisaram corrigir no resumo | 0/20 (0%) | 1/20 (5%) |
| Transferidos para humano | 2/20 (10%) | 2/20 (10%) |
| Mensagens do cliente — média | 11,3 | 7,0 |
| Mensagens do cliente — mediana [Q1–Q3] | 11,0 [11,0–12,0] | 6,0 [3,8–9,0] |
| Mensagens do cliente — mín–máx | 11–12 | 2–25 |
| Caracteres digitados — mediana | 57 | 112 |
| Tempo de processamento do bot por pedido — mediana | 0,00 s | 33,95 s |

## Teste de hipótese

| Variável | n (pares ≠ 0) | W+ | W− | z | p |
|---|---:|---:|---:|---:|---:|
| Mensagens | 20 | 190 | 20 | 3,16 | 0,0016 |
| Caracteres | 20 | 0 | 210 | 3,90 | < 0,001 |

Redução da mediana de mensagens com IA: **45%**. **H0 rejeitada** (p < 0,05): a IA reduz o número de mensagens.

## Por perfil

| Perfil | Menu: msgs | IA: msgs | IA: correções | IA: correto | IA: transferido |
|---:|---:|---:|---:|:---:|---|
| 1 | 11 | 3 | 0 | ✅ | — |
| 2 | 12 | 3 | 0 | ✅ | — |
| 3 | 11 | 2 | 0 | ✅ | — |
| 4 | 11 | 9 | 0 | ✅ | — |
| 5 | 12 | 25 | 2 | ❌ | — |
| 6 | 11 | 5 | 0 | ✅ | — |
| 7 | 11 | 4 | 0 | ✅ | — |
| 8 | 12 | 6 | 0 | ✅ | — |
| 9 | 11 | 2 | 0 | ✅ | — |
| 10 | 11 | 10 | 0 | ✅ | — |
| 11 | 11 | 6 | 0 | ✅ | — |
| 12 | 12 | 7 | 0 | ❌ | nao_entendi |
| 13 | 11 | 8 | 0 | ✅ | — |
| 14 | 12 | 9 | 0 | ✅ | — |
| 15 | 11 | 2 | 0 | ✅ | — |
| 16 | 11 | 9 | 0 | ✅ | — |
| 17 | 11 | 6 | 0 | ✅ | — |
| 18 | 12 | 5 | 0 | ❌ | nao_entendi |
| 19 | 11 | 8 | 0 | ✅ | — |
| 20 | 11 | 10 | 0 | ✅ | — |

> Limitações: clientes simulados a partir de perfis escritos pela equipe; o tempo que uma pessoa leva para ler e digitar não foi simulado (só o processamento do bot). O teste com usuários reais (SUS) complementa esta parte.
