# Como contribuir

1. **Pegue uma issue** e se atribua nela.
2. **Crie uma branch** a partir da `main`: `feat/<nº-da-issue>-descricao-curta` (ex.: `feat/3-rag-faq`).
3. **Commits** no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat: ...`, `fix: ...`, `test: ...`, `docs: ...`.
4. Antes de abrir o PR, rode:
   ```bash
   npm test
   npm run typecheck
   ```
5. **Abra o PR** com `Closes #<nº>` na descrição. Outra pessoa da equipe revisa antes do merge.

## Regras do projeto

- **A IA só entende; o código decide.** Preço, produto, total e criação da venda nunca vêm da IA.
- **Nada de segredo no git.** Chaves só no `.env`.
- **Nada de dado pessoal no log** (texto da mensagem, nome, telefone, endereço).
- Todo texto que o cliente vê fica em `src/conversa/mensagens.ts`.
- Lógica nova vem com teste em `tests/`.
