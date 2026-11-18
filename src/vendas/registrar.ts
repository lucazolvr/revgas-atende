import { TempoEsgotado, type ApiRevGas } from './api-revgas.js';
import type { CorpoVenda } from './pedido.js';

export type ResultadoRegistro =
  | { tipo: 'ok'; id: number }
  | { tipo: 'invalida'; detalhe: string }
  | { tipo: 'incerta' }
  | { tipo: 'erro'; status: number };

/** Uma única tentativa: repetir um POST de venda às cegas pode duplicar a venda. */
export async function registrarVenda(api: ApiRevGas, corpo: CorpoVenda): Promise<ResultadoRegistro> {
  let r;
  try {
    r = await api.criarVenda(corpo);
  } catch (e) {
    if (e instanceof TempoEsgotado) return { tipo: 'incerta' };
    throw e;
  }
  if (r.status === 201 || r.status === 200) {
    const d = r.dados as { id?: number; data?: { id?: number } } | null;
    const id = d?.data?.id ?? d?.id;
    return typeof id === 'number' ? { tipo: 'ok', id } : { tipo: 'incerta' };
  }
  if (r.status === 422) return { tipo: 'invalida', detalhe: JSON.stringify(r.dados ?? {}).slice(0, 300) };
  return { tipo: 'erro', status: r.status };
}
