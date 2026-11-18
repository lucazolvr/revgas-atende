/** `texto` vazio = só anexo (áudio, foto...). */
export type MensagemRecebida = { conversaId: number; telefone: string; texto: string };

/**
 * Filtra o webhook do Agent Bot: só mensagens de texto do cliente numa conversa que ainda
 * está com o bot (`pending`). Com status `open` um humano assumiu e o bot fica calado.
 */
export function extrairMensagem(payload: unknown): MensagemRecebida | null {
  const p = payload as {
    event?: string;
    message_type?: string;
    private?: boolean;
    content?: string | null;
    attachments?: unknown[];
    sender?: { phone_number?: string | null };
    conversation?: { id?: number; status?: string; meta?: { sender?: { phone_number?: string | null } } };
  } | null;
  if (!p || p.event !== 'message_created' || p.message_type !== 'incoming' || p.private) return null;
  const conversa = p.conversation;
  const conversaId = conversa?.id;
  // O corpo do webhook é externo: TypeScript não valida tipos em tempo de execução.
  // Nunca deixe um valor arbitrário virar parte da URL autenticada do Chatwoot.
  if (!conversa || typeof conversaId !== 'number' || !Number.isSafeInteger(conversaId) || conversaId <= 0 || conversa.status !== 'pending') return null;
  const texto = (p.content ?? '').trim();
  // Áudio, foto ou figurinha sem texto chegam como texto vazio: o servidor pede para escrever.
  if (!texto && !p.attachments?.length) return null;
  const telefone = (conversa.meta?.sender?.phone_number ?? p.sender?.phone_number ?? '').replace(/\D/g, '');
  return { conversaId, telefone, texto: texto.slice(0, 2000) };
}

export class ClienteChatwoot {
  private readonly base: string;

  constructor(
    url: string,
    accountId: number,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = `${url.replace(/\/+$/, '')}/api/v1/accounts/${accountId}/conversations`;
  }

  responder(id: number, texto: string) {
    return this.post(`${id}/messages`, { content: texto, message_type: 'outgoing', private: false });
  }

  nota(id: number, texto: string) {
    return this.post(`${id}/messages`, { content: texto, message_type: 'outgoing', private: true });
  }

  etiquetar(id: number, labels: string[]) {
    return this.post(`${id}/labels`, { labels });
  }

  /** Tira a conversa do bot (pending → open) para a fila dos atendentes. */
  async transferir(id: number, prioridade?: 'urgent' | 'high') {
    await this.post(`${id}/toggle_status`, { status: 'open' });
    if (prioridade) await this.post(`${id}/toggle_priority`, { priority: prioridade });
  }

  private async post(caminho: string, corpo: unknown): Promise<void> {
    const r = await this.fetchFn(`${this.base}/${caminho}`, {
      method: 'POST',
      headers: { api_access_token: this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Chatwoot respondeu ${r.status} em ${caminho.replace(/^\d+\//, ':id/')}`);
  }
}
