import { appendFile, mkdir } from 'node:fs/promises';

export type Evento = {
  conversaId: number;
  tipo: 'mensagem' | 'transferencia' | 'venda' | 'erro';
  estado?: string;
  motivo?: string;
  resultado?: string;
  ms?: number;
  ia?: boolean;
};

const ARQUIVO = new URL('../dados/metricas.jsonl', import.meta.url);

// Nunca grava texto, nome, telefone ou endereço: só o que serve para as métricas do relatório.
export function registrarEvento(e: Evento): void {
  if (process.env.VITEST) return;
  const linha = JSON.stringify({ em: new Date().toISOString(), ...e }) + '\n';
  mkdir(new URL('.', ARQUIVO), { recursive: true })
    .then(() => appendFile(ARQUIVO, linha))
    .catch(() => undefined);
}
