// Rótulos comuns à aba e à lista "Pedidos de hoje".
'use strict';

// Status de venda vistos na API de teste da RevGás (24/11/2026). A tradução é literal: o significado
// exato de cada um não foi confirmado com a RevGás, por isso o código original aparece junto.
const NOMES_STATUS = {
  OPEN: 'Aberta',
  ACTIVE: 'Ativa',
  CONFIRM: 'Confirmada',
  RECEIVED: 'Recebida',
  CHECK: 'Em conferência',
  WARNING: 'Alerta',
  IGNORED: 'Ignorada',
  CANCEL: 'Cancelada',
};

const NOMES_PAGAMENTO = {
  PIX: 'PIX',
  MONEY: 'Dinheiro',
  CARTAO_DE_DEBITO: 'Cartão de débito',
  CARTAO_DE_CREDITO: 'Cartão de crédito',
};

window.statusVenda = (codigo) => (NOMES_STATUS[codigo] ? `${NOMES_STATUS[codigo]} (${codigo})` : String(codigo));
window.nomePagamento = (codigo) => NOMES_PAGAMENTO[codigo] || codigo || '—';
window.reais = (valor) => (valor == null ? '' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
window.horaRevenda = (iso, comDia = false) =>
  new Date(iso).toLocaleString('pt-BR', {
    ...(comDia && { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Fortaleza',
  });

/** Preenche uma <ol> com o histórico da venda (status e hora), sempre como texto. */
window.mostrarHistorico = (ol, logs) => {
  ol.replaceChildren(
    ...logs.map((l) => {
      const li = document.createElement('li');
      li.textContent = `${window.horaRevenda(l.quando, true)} · ${window.statusVenda(l.status)}`;
      return li;
    }),
  );
  ol.hidden = logs.length === 0;
};
