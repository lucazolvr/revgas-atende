/** Payload mínimo do webhook de Agent Bot do Chatwoot (message_created). */
export function webhook(texto: string, extra: Record<string, unknown> = {}, conversa: Record<string, unknown> = {}) {
  return {
    event: 'message_created',
    message_type: 'incoming',
    private: false,
    content: texto,
    conversation: { id: 7, status: 'pending', meta: { sender: { phone_number: '+55 86 99999-0000' } }, ...conversa },
    ...extra,
  };
}
