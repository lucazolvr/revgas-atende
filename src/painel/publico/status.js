// Rótulos e utilitários comuns à aba e à central "Pedidos de hoje".
'use strict';

// Status de venda vistos na API de teste da RevGás (24/11/2026). A tradução é literal: o significado
// exato de cada um não foi confirmado com a RevGás, por isso o código original aparece junto.
const STATUS = {
  OPEN: ['Aberta', 'ativa'],
  ACTIVE: ['Ativa', 'ativa'],
  CONFIRM: ['Confirmada', 'andamento'],
  RECEIVED: ['Recebida', 'andamento'],
  CHECK: ['Em conferência', 'andamento'],
  WARNING: ['Alerta', 'alerta'],
  IGNORED: ['Ignorada', 'alerta'],
  CANCEL: ['Cancelada', 'cancelada'],
};

const NOMES_PAGAMENTO = {
  PIX: 'PIX',
  MONEY: 'Dinheiro',
  CARTAO_DE_DEBITO: 'Cartão de débito',
  CARTAO_DE_CREDITO: 'Cartão de crédito',
};

const FUSO = 'America/Fortaleza';

window.statusVenda = (codigo) => (STATUS[codigo] ? `${STATUS[codigo][0]} (${codigo})` : String(codigo));
/** Classe de cor do status: ativa, andamento, alerta, cancelada ou '' (desconhecido). */
window.classeStatus = (codigo) => (STATUS[codigo] ? STATUS[codigo][1] : '');
window.nomePagamento = (codigo) => NOMES_PAGAMENTO[codigo] || codigo || '—';
window.reais = (valor) => (valor == null ? '' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
window.horaRevenda = (iso, comDia = false) =>
  new Date(iso).toLocaleString('pt-BR', {
    ...(comDia && { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO,
  });

/** "agora", "há 12 min", "há 3 h", "há 2 dias". */
window.haQuanto = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
};

/** Preenche uma <ol class="timeline"> com o histórico da venda, sempre como texto. */
window.mostrarHistorico = (ol, logs) => {
  ol.replaceChildren(
    ...logs.map((l) => {
      const li = document.createElement('li');
      const quando = document.createElement('span');
      quando.className = 'quando';
      quando.textContent = window.horaRevenda(l.quando, true);
      li.append(quando, window.statusVenda(l.status));
      return li;
    }),
  );
  ol.hidden = logs.length === 0;
};
