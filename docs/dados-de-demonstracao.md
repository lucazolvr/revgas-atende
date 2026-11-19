# Dados de demonstração (fictícios)

O RevGás Atende roda em **ambiente de teste** (demo e teste com usuários do Projeto de Extensão). Para simular atendimentos realistas, a equipe **inventou os dados de cenário da revenda**. Eles **não são informações da RevGás** e precisam ser trocados pelos dados confirmados antes de qualquer uso real.

## O que é fictício

| Arquivo | Dados simulados |
|---|---|
| `config/faq/horario.md` | Atendimento e entrega de segunda a sábado, das 7h às 20h; domingos e feriados, das 8h às 13h; último pedido até 30 min antes de fechar |
| `config/faq/area-entrega.md` | Bairros atendidos em Teresina (PI) e Timon (MA); prazo médio de 30–50 min (até 1h30 no pico das 11h às 13h) |
| `config/faq/pagamento.md` | Troco para até R$ 200,00; sem taxa de entrega nem no cartão; sem parcelamento |
| `config/faq/troca-botijao.md` | Venda do botijão completo para quem não tem casco; não aceita casco amassado, enferrujado ou com válvula danificada |

## O que é real

- **Métricas e resultados** da avaliação ([docs/relatorio/avaliacao-ia](relatorio/avaliacao-ia/README.md)): medidos de verdade, com o Gemini real.
- **Integração com a API RevGás** (`POST /v1/sales`): chamada de verdade, na **API de teste** que a RevGás liberou em parceria com a faculdade (estabelecimento de demonstração 2580, cliente 5700355). Validada em 19/11/2026 com uma venda de teste criada, conferida e cancelada ([issue #3](https://github.com/lucazolvr/revgas-atende/issues/3)).
- **Preço** do catálogo (`config/catalogo.json`), baseado nas vendas reais consultadas na API (precisa de confirmação da revenda).
- As **orientações de segurança** para vazamento de gás (`config/faq/seguranca.md` e `config/seguranca.md`).

## Por que este aviso fica aqui, e não na pasta da FAQ

O bot carrega **todos** os arquivos `.md` de `config/faq/` e os envia à IA. Se este aviso ficasse lá, a IA poderia repetir para o cliente algo como "esses dados são fictícios". Em `docs/` ele não é lido pelo bot.
