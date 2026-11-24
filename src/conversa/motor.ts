import type { Interpretacao, Interpretador } from '../ia/interpretacao.js';
import { FORMAS_PAGAMENTO, type Produto } from '../vendas/catalogo.js';
import { CAMPOS_ENDERECO, UFS, totalCentavos, type Pedido } from '../vendas/pedido.js';
import type { HistoricoVenda, SituacaoRevenda, VendaResumo } from '../vendas/api-revgas.js';
import type { ResultadoRegistro } from '../vendas/registrar.js';
import { ehEmergencia, normalizar, pedeCancelar, pedeHumano } from './emergencia.js';
import * as M from './mensagens.js';

export type Estado =
  | 'INICIO' | 'NOME' | 'PRODUTO' | 'QUANTIDADE' | 'ENDERECO' | 'PAGAMENTO' | 'TROCO' | 'RESUMO' | 'CORRIGIR' | 'REGISTRADO'
  | 'MENU' | 'ACOMPANHAR' | 'CANCELAR' | 'CONFIRMA_CANCELAR' | 'DUVIDA';

/** Etapas de montar um pedido: aqui "cancelar" só descarta o pedido em andamento (ainda não existe venda). */
const ETAPAS_DO_PEDIDO: Estado[] = ['NOME', 'PRODUTO', 'QUANTIDADE', 'ENDERECO', 'PAGAMENTO', 'TROCO', 'RESUMO', 'CORRIGIR'];
/** Etapas em que a resposta é um número de lista ou "sim/não": não gastam chamada de IA. */
const SEM_IA: Estado[] = ['ACOMPANHAR', 'CANCELAR', 'CONFIRMA_CANCELAR', 'DUVIDA'];

/**
 * `trocoParaCentavos === 0` significa "não precisa de troco".
 * `opcoes`: ids das vendas listadas para o cliente escolher (vêm da API, filtradas pelo telefone dele).
 * `cancelarId`: venda escolhida, esperando o "sim".
 */
export type Sessao = {
  estado: Estado;
  pedido: Pedido;
  falhas: number;
  vendaId?: number;
  correcoes?: number;
  opcoes?: number[];
  cancelarId?: number;
};

/** Pedidos de "corrigir" no resumo até transferir para humano (evita ciclos de correção). */
export const LIMITE_CORRECOES = 3;

export type MotivoTransferencia =
  | 'humano' | 'vazamento' | 'nao_entendi' | 'verificar_venda' | 'erro_venda' | 'correcoes' | 'erro_cancelamento' | 'erro_consulta';
export type Acao =
  | { tipo: 'responder'; texto: string }
  | { tipo: 'transferir'; motivo: MotivoTransferencia; resumo: string };

export type Deps = {
  catalogo: Produto[];
  interpretador: Interpretador | null;
  registrar: (p: Pedido) => Promise<ResultadoRegistro>;
  /** Gancho para a base de conhecimento (RAG). `null` = não sabe responder. */
  responderDuvida?: (texto: string) => Promise<string | null>;
  // Consultas à API RevGás, já presas ao telefone de quem escreveu (o servidor amarra).
  /** Vendas em aberto do cliente, mais recentes primeiro. */
  vendasDoCliente?: () => Promise<VendaResumo[]>;
  /** Status e histórico de uma venda. `null` = não existe ou não é do bot. `para` só serve às métricas. */
  historico?: (id: number, para: 'acompanhar' | 'cancelar') => Promise<HistoricoVenda | null>;
  /** Cancela na API. `'ok'` só depois de a API confirmar (200/204). */
  cancelar?: (id: number) => Promise<'ok' | 'ja_cancelada' | 'falha'>;
  /** Situação da revenda no ERP (consultada só quando precisa, com cache na API real). */
  situacao?: () => Promise<SituacaoRevenda>;
};

const DESCRICAO_MOTIVO: Record<MotivoTransferencia, string> = {
  humano: 'cliente pediu atendente',
  vazamento: '⚠️ POSSÍVEL VAZAMENTO DE GÁS',
  nao_entendi: 'o bot não entendeu o cliente',
  verificar_venda: 'a API não respondeu ao criar a venda — conferir no ERP se a venda existe antes de refazer',
  erro_venda: 'a API recusou a venda',
  correcoes: `o cliente pediu para corrigir o pedido ${LIMITE_CORRECOES} vezes`,
  erro_cancelamento: 'cancelamento não confirmado pela API — conferir no ERP',
  erro_consulta: 'a API não respondeu ao consultar os pedidos do cliente',
};

/** Mensagem que já é pedido: pula o menu. */
const parecePedido = (t: string) => /gas|botij|bujao|p13|p45|agua|pedido|quero|manda/.test(normalizar(t));
const querAcompanhar = (t: string) => /acompanh|status|cade|onde esta/.test(normalizar(t));
const pedeMenu = (t: string) => /^(menu|voltar)$/.test(normalizar(t).trim());
const ehCumprimento = (t: string) => /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite)\b/.test(normalizar(t).trim());

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
  /** Menu principal (o pedido em andamento fica guardado). `antes`: aviso na mesma mensagem. */
  const irMenu = (antes?: string) => {
    s.estado = 'MENU';
    s.falhas = 0;
    delete s.opcoes;
    delete s.cancelarId;
    responder(antes ? `${antes.trim()}\n\n${M.MENU_PRINCIPAL}` : M.MENU_PRINCIPAL);
    return fim();
  };
  /** Depois de uma resposta completa (detalhe, cancelado): fica no menu sem repetir as 5 opções. */
  const voltarAoMenu = (texto: string) => {
    s.estado = 'MENU';
    s.falhas = 0;
    delete s.opcoes;
    delete s.cancelarId;
    responder(`${texto}\n\n${M.VOLTAR_MENU}`);
    return fim();
  };
  const erroConsulta = () => {
    responder(M.ERRO_CONSULTA);
    return transferir('erro_consulta');
  };
  const historico = async (id: number, para: 'acompanhar' | 'cancelar') => {
    try {
      return { h: (await deps.historico?.(id, para)) ?? null };
    } catch {
      return null; // API fora do ar
    }
  };
  const mostrarDetalhe = async (id: number) => {
    const r = await historico(id, 'acompanhar');
    if (!r) return erroConsulta();
    return r.h ? voltarAoMenu(M.detalhePedido(r.h)) : irMenu(M.PEDIDO_NAO_ENCONTRADO);
  };
  const escolherParaCancelar = async (id: number) => {
    const r = await historico(id, 'cancelar');
    if (!r) return erroConsulta();
    if (!r.h) return irMenu(M.PEDIDO_NAO_ENCONTRADO);
    if (r.h.status === 'CANCEL') return irMenu(M.JA_CANCELADO);
    s.estado = 'CONFIRMA_CANCELAR';
    s.falhas = 0;
    s.cancelarId = id;
    delete s.opcoes;
    responder(M.confirmaCancelar(r.h));
    return fim();
  };
  /** Lista os pedidos em aberto do telefone, para acompanhar ou cancelar. */
  const consultarPedidos = async (para: 'ACOMPANHAR' | 'CANCELAR') => {
    if (!deps.vendasDoCliente) return transferir('humano'); // sem acesso à API: uma pessoa resolve
    if (para === 'CANCELAR' && deps.situacao) {
      const situacao = await deps.situacao().catch(() => null); // melhor esforço: sem resposta, tenta mesmo assim
      if (situacao?.permiteCancelar === false) return transferir('humano');
    }
    let vendas: VendaResumo[];
    try {
      vendas = await deps.vendasDoCliente();
    } catch {
      return erroConsulta();
    }
    if (!vendas.length) return irMenu(M.SEM_PEDIDO_ATIVO);
    if (para === 'ACOMPANHAR' && vendas.length === 1) return mostrarDetalhe(vendas[0]!.id);
    s.estado = para;
    s.falhas = 0;
    s.opcoes = vendas.map((v) => v.id);
    responder(M.listaPedidos(vendas));
    return fim();
  };
  const comecarPedido = () => {
    s.falhas = 0;
    completarUf(s.pedido);
    s.estado = proximoEstado(s.pedido, cat);
    responder(pergunta(s, cat));
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

  // "menu" ou "voltar" em qualquer etapa: o pedido em andamento fica guardado.
  if (pedeMenu(texto)) return irMenu();

  // Números de menu não gastam chamada de IA.
  // A IA precisa saber qual parte do endereço foi perguntada: sem isso, "Dirceu" (o bairro) virava a rua.
  const etapa = s.estado === 'ENDERECO' ? `ENDERECO (pergunta atual: ${CAMPOS_ENDERECO.find((c) => !s.pedido.endereco?.[c])})` : s.estado;
  let ia = deps.interpretador && !SEM_IA.includes(s.estado) && !/^\s*\d+\s*$/.test(texto)
    ? await deps.interpretador.interpretar(texto, etapa)
    : null;

  // "cartão" sem dizer o tipo: a IA chutava crédito (achado da avaliação da issue #2). O bot pergunta.
  const cartaoSemTipo = /\bcartao\b/.test(normalizar(texto)) && !/debito|credito/.test(normalizar(texto));
  if (ia && cartaoSemTipo && ia.entidades.pagamento?.startsWith('CARTAO')) {
    ia = { ...ia, entidades: { ...ia.entidades, pagamento: undefined } };
  }

  if (ia?.intencao === 'emergencia_gas') {
    responder(M.SEGURANCA);
    return transferir('vazamento');
  }
  if (ia?.intencao === 'falar_com_humano' || pedeHumano(texto)) return transferir('humano');

  // Confirmação do cancelamento. Vem antes do "cancelar" genérico: aqui "pode cancelar" é o "sim".
  if (s.estado === 'CONFIRMA_CANCELAR') {
    const n = normalizar(texto).trim();
    if (/^(1|sim|s|pode|confirmo|confirma|isso|cancela|cancelar)\b/.test(n)) {
      const id = s.cancelarId!;
      const r = deps.cancelar ? await deps.cancelar(id).catch(() => 'falha' as const) : 'falha';
      if (r === 'ok') return voltarAoMenu(M.pedidoCancelado(id));
      if (r === 'ja_cancelada') return irMenu(M.JA_CANCELADO);
      // Nunca diz "cancelado" sem a API confirmar: uma pessoa confere no ERP.
      responder(M.ERRO_CANCELAMENTO);
      return transferir('erro_cancelamento');
    }
    if (/^(2|nao|n|deixa|manter|mantem|mantenha)\b/.test(n)) return irMenu(M.PEDIDO_MANTIDO);
    return falhou(M.NAO_ENTENDI + M.RESPONDA_SIM_NAO);
  }

  const querCancelar = pedeCancelar(texto) || ia?.intencao === 'cancelar';
  // "cancelar" no meio do pedido descarta o rascunho (ainda não há venda; antes só valia no resumo).
  if (ETAPAS_DO_PEDIDO.includes(s.estado) && querCancelar) {
    s = novaSessao(s.pedido.telefone);
    responder(M.CANCELADO);
    return fim();
  }
  // Fora do pedido, "cancelar" é cancelar uma venda que já existe: pela API.
  if (querCancelar) return consultarPedidos('CANCELAR');

  // Escolha na lista de pedidos (os ids vêm da sessão, nunca do texto do cliente).
  if (s.estado === 'ACOMPANHAR' || s.estado === 'CANCELAR') {
    const n = numero(texto);
    const id = n ? s.opcoes?.[n - 1] : undefined;
    if (!id) return irMenu(M.NAO_ENTENDI + (n ? M.FORA_DA_LISTA : ''));
    return s.estado === 'ACOMPANHAR' ? mostrarDetalhe(id) : escolherParaCancelar(id);
  }

  if (s.estado === 'DUVIDA') {
    return voltarAoMenu((await deps.responderDuvida?.(texto)) ?? M.DUVIDA_SEM_RESPOSTA);
  }

  if (s.estado === 'INICIO' || s.estado === 'MENU') {
    const noMenu = s.estado === 'MENU';
    const n = noMenu ? numero(texto) : null;
    if (n === 2 || (n === null && querAcompanhar(texto))) return consultarPedidos('ACOMPANHAR');
    if (n === 3) return consultarPedidos('CANCELAR');
    if (n === 4) {
      s.estado = 'DUVIDA';
      s.falhas = 0;
      responder(M.PODE_PERGUNTAR);
      return fim();
    }
    if (n === 5) return transferir('humano');
    const extraiu = ia ? aplicarEntidades(s.pedido, ia.entidades) : false;
    if (n === 1 || extraiu || ia?.intencao === 'fazer_pedido' || (n === null && parecePedido(texto))) {
      if (!noMenu) responder(s.pedido.nome ? M.boasVindasDeVolta(s.pedido) : M.BOAS_VINDAS);
      else if (s.pedido.nome && M.avisoMesmoEndereco(s.pedido)) responder(M.avisoMesmoEndereco(s.pedido)!);
      return comecarPedido();
    }
    if (ia?.intencao === 'duvida') {
      responder((await deps.responderDuvida?.(texto)) ?? M.DUVIDA_SEM_RESPOSTA);
      return irMenu();
    }
    // Cumprimento de novo com o menu aberto: só repete o menu, sem contar como "não entendi".
    if (noMenu && (ia?.intencao === 'saudacao' || ehCumprimento(texto))) return irMenu();
    if (noMenu) return falhou(M.NAO_ENTENDI + M.MENU_PRINCIPAL);
    responder(s.pedido.nome ? M.saudacaoDeVolta(s.pedido) : M.SAUDACAO);
    return irMenu();
  }

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
      s.correcoes = (s.correcoes ?? 0) + 1;
      if (s.correcoes >= LIMITE_CORRECOES) return transferir('correcoes');
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

  if (s.estado === 'PAGAMENTO' && cartaoSemTipo && !ia?.entidades.pagamento) {
    responder(M.PERGUNTA_CARTAO); // esclarecimento, não conta como "não entendi"
    return fim();
  }

  // Daqui em diante: as etapas do pedido (NOME ... TROCO).
  let avancou = ia ? aplicarEntidades(s.pedido, ia.entidades) : false;
  if (!avancou) {
    const r = aplicarTexto(s, texto, cat);
    if (typeof r === 'string') return falhou(r);
    avancou = r;
  }

  if (!avancou && ia?.intencao === 'duvida') {
    responder((await deps.responderDuvida?.(texto)) ?? M.DUVIDA_SEM_RESPOSTA);
    responder(pergunta(s, cat));
    return fim();
  }

  if (!avancou) return falhou(M.NAO_ENTENDI + pergunta(s, cat));
  return comecarPedido();
}

/** Cidades da área de entrega (config/faq/area-entrega.md): o estado sai da cidade, sem perguntar. */
const UF_DA_CIDADE: Record<string, string> = { teresina: 'PI', timon: 'MA' };
/** Estado escrito por extenso na resposta "cidade e estado" (só os da área de entrega). */
const UF_POR_NOME: Record<string, string> = { piaui: 'PI', maranhao: 'MA' };

function completarUf(p: Pedido) {
  const cidade = p.endereco?.cidade;
  const uf = cidade && !p.endereco?.uf ? UF_DA_CIDADE[normalizar(cidade)] : undefined;
  if (uf) p.endereco = { ...p.endereco, uf };
}

/** "Teresina PI", "Teresina - PI", "Parnaíba/Piauí" → cidade e UF; só "Teresina" → só a cidade. */
export function separarCidadeUf(texto: string): { cidade: string; uf?: string } {
  const partes = texto.trim().split(/[\s,/–-]+/).filter(Boolean);
  const ultima = partes.at(-1) ?? '';
  const uf = UFS.includes(ultima.toUpperCase()) ? ultima.toUpperCase() : UF_POR_NOME[normalizar(ultima)];
  if (partes.length > 1 && uf) {
    // tira a UF do fim e a pontuação que sobrar ("Teresina - PI")
    const cidade = texto.trim().slice(0, texto.trim().lastIndexOf(ultima)).replace(/[\s,/–-]+$/, '');
    return { cidade, uf };
  }
  return { cidade: texto.trim() };
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
    case 'ENDERECO': {
      const campo = CAMPOS_ENDERECO.find((c) => !s.pedido.endereco?.[c])!;
      // Faltando os dois, uma pergunta só (a UF quase sempre sai da cidade, ver completarUf)
      return campo === 'cidade' && !s.pedido.endereco?.uf ? M.PERGUNTA_CIDADE_UF : M.PERGUNTA_ENDERECO[campo]!;
    }
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
      if (campo === 'cidade' && !p.endereco?.uf) {
        const { cidade, uf } = separarCidadeUf(t);
        if (cidade.length < 2 || cidade.length > 120) return false;
        p.endereco = { ...p.endereco, cidade, ...(uf && { uf }) };
        return true;
      }
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
