import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';

export type Evento = {
  conversaId: number;
  tipo: 'mensagem' | 'transferencia' | 'venda' | 'erro' | 'acompanhar' | 'cancelamento' | 'cliente_reconhecido';
  estado?: string;
  motivo?: string;
  resultado?: string;
  ms?: number;
  ia?: boolean;
};

const DIRETORIO = new URL('../dados/', import.meta.url);
let retencaoDias = 90;
let ultimaLimpeza = 0;

let aoRegistrar: ((e: Evento) => void) | undefined;

/** `aoRegistrar` recebe cada evento também (ex.: gravar no Postgres para o Metabase). */
export function configurarMetricas(dias: number, destino?: (e: Evento) => void): void {
  retencaoDias = dias;
  aoRegistrar = destino;
}

// Nunca grava texto, nome, telefone ou endereço: só o que serve para as métricas do relatório.
export function registrarEvento(e: Evento): void {
  if (process.env.VITEST) return;
  aoRegistrar?.(e);
  const agora = new Date();
  const dia = agora.toISOString().slice(0, 10);
  const linha = JSON.stringify({ em: agora.toISOString(), ...e }) + '\n';
  mkdir(DIRETORIO, { recursive: true })
    .then(async () => {
      await appendFile(new URL(`metricas-${dia}.jsonl`, DIRETORIO), linha);
      if (Date.now() - ultimaLimpeza > 86_400_000) await limparMetricasAntigas();
    })
    .catch(() => undefined);
}

async function limparMetricasAntigas(): Promise<void> {
  ultimaLimpeza = Date.now();
  const limite = new Date(Date.now() - retencaoDias * 86_400_000).toISOString().slice(0, 10);
  const arquivos = await readdir(DIRETORIO);
  await Promise.all(arquivos
    .filter((nome) => /^metricas-\d{4}-\d{2}-\d{2}\.jsonl$/.test(nome) && nome.slice(10, 20) < limite)
    .map((nome) => rm(new URL(nome, DIRETORIO))));
}
