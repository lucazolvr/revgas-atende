export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Determinístico de propósito: emergência não pode depender da IA estar no ar.
const SINAIS = [/cheiro (de|do) gas/, /vazament/, /vazando/, /\bvaza\b/, /chiando/, /pegando fogo/, /\bincendio\b/];

export function ehEmergencia(texto: string): boolean {
  const t = normalizar(texto);
  return SINAIS.some((r) => r.test(t));
}

export function pedeHumano(texto: string): boolean {
  return /\b(atendente|humano|pessoa de verdade|falar com alguem)\b/.test(normalizar(texto));
}

/** A mensagem começa pedindo para cancelar ("cancelar", "quero desistir"); "3" só vale no resumo. */
export function pedeCancelar(texto: string): boolean {
  return /^(quero |pode )?(cancelar|cancela|desistir|desisto)\b/.test(normalizar(texto).trim());
}
