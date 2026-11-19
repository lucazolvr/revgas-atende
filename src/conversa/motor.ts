import type { Interpretacao, Interpretador } from '../ia/interpretacao.js';
import { FORMAS_PAGAMENTO, type Produto } from '../vendas/catalogo.js';
import { CAMPOS_ENDERECO, UFS, totalCentavos, type Pedido } from '../vendas/pedido.js';
import type { ResultadoRegistro } from '../vendas/registrar.js';
import { ehEmergencia, normalizar, pedeHumano } from './emergencia.js';
import * as M from './mensagens.js';

export type Estado =
  | 'INICIO' | 'NOME' | 'PRODUTO' | 'QUANTIDADE' | 'ENDERECO' | 'PAGAMENTO' | 'TROCO' | 'RESUMO' | 'CORRIGIR' | 'REGISTRADO';

/** `trocoParaCentavos === 0` significa "não precisa de troco". */
export type Sessao = { estado: Estado; pedido: Pedido; falhas: number; vendaId?: number };

export type MotivoTransferencia = 'humano' | 'vazamento' | 'nao_entendi' | 'verificar_venda' | 'erro_venda';
export type Acao =
  | { tipo: 'responder'; texto: string }
  | { tipo: 'transferir'; motivo: MotivoTransferencia; resumo: string };

export type Deps = {
  catalogo: Produto[];
  interpretador: Interpretador | null;
  registrar: (p: Pedido) => Promise<ResultadoRegistro>;
  /** Gancho para a base de conhecimento (RAG). `null` = não sabe responder. */
  responderDuvida?: (texto: string) => Promise<string | null>;
};

const DESCRICAO_MOTIVO: Record<MotivoTransferencia, string> = {
  humano: 'cliente pediu atendente',
  vazamento: '⚠️ POSSÍVEL VAZAMENTO DE GÁS',
  nao_entendi: 'o bot não entendeu o cliente',
  verificar_venda: 'a API não respondeu ao criar a venda — conferir no ERP se a venda existe antes de refazer',
  erro_venda: 'a API recusou a venda',
};

export function novaSessao(telefone: string, base: Partial<Pedido> = {}): Sessao {
  return { estado: 'INICIO', pedido: { ...base, telefone }, falhas: 0 };
}

export async function processar(anterior: Sessao, texto: string, deps: Deps): Promise<{ sessao: Sessao; acoes: Acao[] }> {
  let s: Sessao = structuredClone(anterior);
  const cat = deps.catalogo;
  const acoes: Acao[] = [];
  const responder = (t: string) => acoes.push({ tipo: 'responder', texto: t });
  const fim = () => ({ sessao: s, acoes });
  const transferir = (motivo: MotivoTransferencia) => {
    acoes.push({ tipo: 'transferir', motivo, resumo: M.resumoParaAtendente(DESCRICAO_MOTIVO[motivo], s.pedido, cat) });
    return fim();
  };
  const falhou = (mensagem: string) => {
    s.falhas++;
    if (s.falhas >= 2) return transferir('nao_entendi');
    responder(mensagem);
    return fim();
  };

  // 1. Emergência antes de tudo, sem depender da IA.
  if (ehEmergencia(texto)) {
    responder(M.SEGURANCA);
    return transferir('vazamento');
  }

  // Pedido já registrado: "1" repetido não cria outra venda; outra mensagem começa um novo pedido.
  if (s.estado === 'REGISTRADO') {
    if (escolha(texto, null) === 1) {
      responder(M.jaRegistrado(s.vendaId!));
      return fim();
    }
    const { nome, endereco } = s.pedido; // cliente que volta não precisa repetir nome e endereço
    s = novaSessao(s.pedido.telefone, { nome, endereco });
  }

  // Números de menu não gastam chamada de IA.
  // A IA precisa saber qual parte do endereço foi perguntada: sem isso, "Dirceu" (o bairro) virava a rua.
  const etapa = s.estado === 'ENDERECO' ? `ENDERECO (pergunta atual: ${CAMPOS_ENDERECO.find((c) => !s.pedido.endereco?.[c])})` : s.estado;
  const ia = deps.interpretador && !/^\s*\d+\s*$/.test(texto) ? await deps.interpretador.interpretar(texto, etapa) : null;

  if (ia?.intencao === 'emergencia_gas') {
    responder(M.SEGURANCA);
    return transferir('vazamento');
  }
  if (ia?.intencao === 'falar_com_humano' || pedeHumano(texto)) return transferir('humano');

  if (s.estado === 'RESUMO') {
    const opcao = escolha(texto, ia);
    if (opcao === 1) {
      if (s.vendaId) {
        responder(M.jaRegistrado(s.vendaId));
        return fim();
      }
      const r = await deps.registrar(s.pedido);
      if (r.tipo === 'ok') {
        s.vendaId = r.id;
        s.estado = 'REGISTRADO';
        responder(M.registrado(r.id));
        return fim();
      }
      return transferir(r.tipo === 'incerta' ? 'verificar_venda' : 'erro_venda');
    }
    if (opcao === 2) {
      s.estado = 'CORRIGIR';
      s.falhas = 0;
      responder(M.MENU_CORRIGIR);
      return fim();
    }
    if (opcao === 3) {
      s = novaSessao(s.pedido.telefone);
      responder(M.CANCELADO);
      return fim();
    }
    return falhou(M.NAO_ENTENDI + M.resumo(s.pedido, cat));
  }

  if (s.estado === 'CORRIGIR') {
    const n = numero(texto);
    const limpar: Record<number, (keyof Pedido)[]> = {
      1: ['nome'],
      2: ['produto', 'quantidade'],
      3: ['endereco'],
      4: ['pagamento', 'trocoParaCentavos'],
    };
    if (!n || !limpar[n]) return falhou(M.NAO_ENTENDI + M.MENU_CORRIGIR);
    for (const campo of limpar[n]) delete s.pedido[campo];
    if (n === 2) delete s.pedido.trocoParaCentavos; // o total mudou, o troco pode não servir mais
    s.estado = proximoEstado(s.pedido, cat);
    s.falhas = 0;
    responder(pergunta(s, cat));
    return fim();
  }

  const inicio = s.estado === 'INICIO';
  let avancou = ia ? aplicarEntidades(s.pedido, ia.entidades) : false;
  if (!avancou && !inicio) {
    const r = aplicarTexto(s, texto, cat);
    if (typeof r === 'string') return falhou(r);
    avancou = r;
  }

  if (!avancou && ia?.intencao === 'duvida') {
    responder((await deps.responderDuvida?.(texto)) ?? M.DUVIDA_SEM_RESPOSTA);
    if (!inicio) {
      responder(pergunta(s, cat));
      return fim();
    }
  }

  if (inicio) {
    if (ia?.intencao !== 'duvida') responder(M.BOAS_VINDAS);
  } else if (!avancou) {
    return falhou(M.NAO_ENTENDI + pergunta(s, cat));
  }

  s.falhas = 0;
  s.estado = proximoEstado(s.pedido, cat);
  responder(pergunta(s, cat));
  return fim();
}

/** Primeiro campo que falta, na ordem em que o pedido é perguntado. */
export function proximoEstado(p: Pedido, cat: Produto[]): Estado {
  if (!p.nome) return 'NOME';
  if (!p.produto) return 'PRODUTO';
  if (!p.quantidade) return 'QUANTIDADE';
  if (CAMPOS_ENDERECO.some((c) => !p.endereco?.[c])) return 'ENDERECO';
  if (!p.pagamento) return 'PAGAMENTO';
  if (p.pagamento === 'MONEY') {
    const t = p.trocoParaCentavos;
    if (t === undefined || (t > 0 && t <= totalCentavos(p, cat))) return 'TROCO';
  }
  return 'RESUMO';
}

function pergunta(s: Sessao, cat: Produto[]): string {
  switch (s.estado) {
    case 'NOME': return M.PERGUNTA_NOME;
    case 'PRODUTO': return M.menuProdutos(cat);
    case 'QUANTIDADE': return M.PERGUNTA_QUANTIDADE;
    case 'ENDERECO': return M.PERGUNTA_ENDERECO[CAMPOS_ENDERECO.find((c) => !s.pedido.endereco?.[c])!]!;
    case 'PAGAMENTO': return M.menuPagamento();
    case 'TROCO': return M.PERGUNTA_TROCO;
    case 'RESUMO': return M.resumo(s.pedido, cat);
    case 'CORRIGIR': return M.MENU_CORRIGIR;
    default: return '';
  }
}

function aplicarEntidades(p: Pedido, e: Interpretacao['entidades']): boolean {
  let mudou = false;
  for (const campo of ['nome', 'produto', 'quantidade', 'pagamento', 'trocoParaCentavos'] as const) {
    if (e[campo] !== undefined && e[campo] !== p[campo]) {
      (p as Record<string, unknown>)[campo] = e[campo];
      mudou = true;
    }
  }
  if (e.endereco) {
    const novo = { ...p.endereco, ...e.endereco };
    if (JSON.stringify(novo) !== JSON.stringify(p.endereco ?? {})) {
      p.endereco = novo;
      mudou = true;
    }
  }
  return mudou;
}

/** Usa a resposta crua como valor do campo perguntado. String = mensagem de erro específica. */
function aplicarTexto(s: Sessao, texto: string, cat: Produto[]): boolean | string {
  const p = s.pedido;
  const t = texto.trim();
  const n = normalizar(t);
  switch (s.estado) {
    case 'NOME': {
      // "meu nome é Ana" sem IA não pode virar o nome "meu nome é Ana"
      const nome = t.replace(/^(meu nome (é|e)|me chamo|aqui (é|e)( (o|a))?|sou (o|a)|(é|e) (o|a))\s+/i, '').trim();
      if (nome.length < 2 || nome.length > 80 || !/\p{L}/u.test(nome)) return false;
      p.nome = nome;
      return true;
    }
    case 'PRODUTO': {
      const i = numero(t);
      const produto =
        (i ? cat[i - 1] : undefined) ??
        cat.find((x) => n.includes(normalizar(x.nome)) || n.split(' ').includes(x.codigo.toLowerCase())) ??
        (cat.length === 1 && /botij|bujao|\bgas\b/.test(n) ? cat[0] : undefined);
      if (!produto) return false;
      p.produto = produto.codigo;
      return true;
    }
    case 'QUANTIDADE': {
      const q = numero(t);
      if (!q || q < 1 || q > 20) return false;
      p.quantidade = q;
      return true;
    }
    case 'ENDERECO': {
      const campo = CAMPOS_ENDERECO.find((c) => !p.endereco?.[c])!;
      let valor = t;
      if (campo === 'uf') {
        valor = t.toUpperCase();
        if (!UFS.includes(valor)) return false;
      } else if (t.length < 1 || t.length > 120 || (campo !== 'numero' && t.length < 2)) {
        return false;
      }
      p.endereco = { ...p.endereco, [campo]: valor };
      return true;
    }
    case 'PAGAMENTO': {
      const i = numero(t);
      const porPalavra: [RegExp, string][] = [
        [/\bpix\b/, 'PIX'],
        [/dinheiro|especie/, 'MONEY'],
        [/debito/, 'CARTAO_DE_DEBITO'],
        [/credito/, 'CARTAO_DE_CREDITO'],
      ];
      const codigo = (i ? FORMAS_PAGAMENTO[i - 1]?.codigo : undefined) ?? porPalavra.find(([r]) => r.test(n))?.[1];
      if (!codigo) return false;
      p.pagamento = codigo as Pedido['pagamento'];
      return true;
    }
    case 'TROCO': {
      if (/^(nao|n|sem troco|nao precisa|nao preciso)\b/.test(n)) {
        p.trocoParaCentavos = 0;
        return true;
      }
      const m = n.match(/(\d+(?:[.,]\d{1,2})?)/);
      if (!m) return false;
      const centavos = Math.round(parseFloat(m[1]!.replace(',', '.')) * 100);
      const total = totalCentavos(p, cat);
      if (centavos <= total) return M.trocoInvalido(total);
      p.trocoParaCentavos = centavos;
      return true;
    }
    default:
      return false;
  }
}

function numero(texto: string): number | null {
  const m = texto.trim().match(/^\D{0,15}?(\d{1,3})\D{0,15}$/);
  return m ? Number(m[1]) : null;
}

/** 1 confirmar · 2 corrigir · 3 cancelar · null não entendi. */
function escolha(texto: string, ia: Interpretacao | null): 1 | 2 | 3 | null {
  const n = normalizar(texto).replace(/^(quero|pode|vou|pra|para|da pra|tem como) /, ''); // "quero corrigir", "pode confirmar"
  if (/^(1|sim|s|confirmo|confirmar|confirma|ok|pode ser|isso)\b/.test(n) || ia?.intencao === 'confirmar') return 1;
  if (/^(2|corrigir|corrige|alterar|mudar)\b/.test(n) || ia?.intencao === 'corrigir') return 2;
  if (/^(3|cancelar|cancela|desistir)\b/.test(n) || ia?.intencao === 'cancelar') return 3;
  return null;
}
