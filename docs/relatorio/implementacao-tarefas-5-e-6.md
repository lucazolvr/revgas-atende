# Relatório de implementação — tarefas 5 e 6 da v2

**Projeto:** RevGás Atende  
**Escopo:** entendimento de pedidos sem IA e respostas determinísticas para dúvidas frequentes  
**Data do relatório:** 25/11/2026

## 1. Objetivo

Este documento registra as mudanças feitas para as tarefas 5 e 6 do plano de integração da v2. A tarefa 5 amplia o entendimento por regras locais e posiciona a IA como último recurso durante a coleta do pedido. A tarefa 6 responde dúvidas conhecidas por palavras-chave e consulta o RAG apenas quando não há resposta determinística e a IA está habilitada para o cliente.

## 2. Tarefa 5 — regras locais antes da IA

### 2.1 Regras de extração

Foi criado `src/conversa/regras.ts`, que expõe três funções:

- `extrairRegras(texto, cat)` reconhece produto, quantidade, pagamento e valor de troco na mesma mensagem;
- `numeroPorExtenso(palavra)` converte formas de um a dez, incluindo variações de gênero, para números;
- `separarEndereco(texto)` separa logradouro, número, bairro e cidade, com UF quando disponível.

A normalização remove diferenças de acentuação e caixa. As formas de pagamento aceitam variações comuns como “dinhero” e “cartao debito”. O preço não é inferido por essas regras: os produtos são identificados a partir do catálogo, que continua sendo a fonte desses dados.

### 2.2 Integração com o motor

O motor de conversa foi ajustado para aproveitar os campos reconhecidos pelas regras nas etapas de coleta. Se a mensagem corresponde à resposta esperada ou as regras avançam o pedido, a IA não é chamada. Se nenhuma regra ou interpretação direta resolve a mensagem, o interpretador pode ser chamado antes da falha padrão.

Os números de opções continuam tendo o significado definido pelo estado atual. Por exemplo, um número digitado no menu de produtos é tratado como posição do produto, não como quantidade. Números já preenchidos também não são substituídos por números incidentais de etapas posteriores, como o número da residência.

O caminho de pedido completo em uma mensagem foi coberto com um teste que verifica que o motor chega ao resumo sem chamadas à IA. Também há teste para garantir uma chamada à IA diante de mensagem incompreensível na etapa de produto.

### 2.3 Arquivos e testes

- `src/conversa/regras.ts` — extração de campos e separação de endereço.
- `src/conversa/motor.ts` — uso das regras durante a conversa e controle do último recurso de IA.
- `tests/conversa/regras.test.ts` — testes de quantidades, pagamentos, troco, endereço e números por extenso.
- `tests/conversa/motor.test.ts` — cobertura da chamada à IA e dos fluxos de coleta existentes.

## 3. Tarefa 6 — dúvidas frequentes por palavra-chave

### 3.1 Respostas sem IA

Foi criado `src/conhecimento/palavras.ts`, que carrega os arquivos Markdown de FAQ uma vez e seleciona uma resposta pelo assunto identificado. Para os temas com texto de FAQ, a resposta usa o primeiro parágrafo após o título. As categorias cobertas são:

| Assunto | Palavras-chave principais | Fonte |
| --- | --- | --- |
| Preços | preço, valor, quanto custa, quanto tá | `config/catalogo.json` |
| Horário | horário, abre, fecha, domingo, feriado | `config/faq/horario.md` |
| Entrega | entrega, bairro, região, atende onde, taxa | `config/faq/area-entrega.md` |
| Pagamento | PIX, cartão, dinheiro, pagamento, troco | `config/faq/pagamento.md` |
| Segurança | vazamento, segurança, cheiro | `config/faq/seguranca.md` |
| Troca | troca, vasilhame, casco | `config/faq/troca-botijao.md` |

Os preços são formatados no momento da resposta a partir do catálogo carregado pelo servidor; não são copiados para a FAQ. A verificação de emergência existente no motor continua ocorrendo antes do fluxo normal de dúvidas.

### 3.2 Ordem de resposta no servidor

O servidor agora aplica a seguinte sequência:

1. Procura uma resposta por palavra-chave.
2. Se não houver correspondência, consulta o RAG quando existe interpretador habilitado para aquele cliente.
3. Se nenhum método responder, o motor usa a mensagem existente de dúvida sem resposta.

Essa ordem permite responder aos assuntos conhecidos sem depender de disponibilidade ou chamadas da IA. As restrições de habilitação da IA por telefone continuam sendo aplicadas pelo servidor.

### 3.3 Arquivos e testes

- `src/conhecimento/palavras.ts` — palavras-chave, carregamento dos parágrafos de FAQ e preços do catálogo.
- `src/servidor.ts` — composição da resposta por palavra-chave e do RAG de reserva.
- `tests/conhecimento/palavras.test.ts` — preço, horário e pergunta sem correspondência.
- `tests/servidor.test.ts` — comprova que uma palavra-chave precede o RAG e que o RAG atende uma pergunta desconhecida quando habilitado.

## 4. Verificações realizadas

Com as dependências instaladas (`npm ci`), foram executados:

```powershell
npm test -- --run tests/conhecimento/palavras.test.ts tests/servidor.test.ts tests/conversa/motor.test.ts
npm run typecheck
npm test
git diff --check
```

Resultados observados:

- Testes direcionados: **87 passaram**.
- Suíte completa: **242 passaram, 1 ignorado**.
- Typecheck: passou sem erros.
- `git diff --check`: passou sem erros de whitespace.

## 5. Resultado

As duas tarefas reduzem a dependência da IA nos caminhos previsíveis. Na coleta de pedidos, regras determinísticas reconhecem mais de um campo por mensagem e evitam chamada à IA quando há avanço. Nas dúvidas, respostas de preço e FAQ vêm de fontes locais e o RAG permanece disponível como reserva para perguntas não reconhecidas.

## 6. Estado das alterações

As mudanças foram feitas no workspace e não foram commitadas. O workspace também contém alterações da tarefa 5 já presentes durante a implementação da tarefa 6. Este relatório descreve o resultado combinado das tarefas 5 e 6.
