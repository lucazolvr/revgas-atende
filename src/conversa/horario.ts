/**
 * Horário de atendimento e entrega da revenda: fonte única. Daqui saem o horário da caixa no
 * Chatwoot (src/canal/painel.ts) e a resposta pronta /horario (mensagens.ts). A FAQ
 * (config/faq/horario.md) é texto livre para a IA; um teste confere que ela diz o mesmo.
 */
export const HORARIO_REVENDA = {
  /** Segunda a sábado. */
  semana: { abre: 7, fecha: 20 },
  /** Domingo (o Chatwoot não tem feriados; na FAQ, feriado segue o domingo). */
  domingo: { abre: 8, fecha: 13 },
} as const;
