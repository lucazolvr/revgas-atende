// Painel "Pedido RevGás" (Dashboard App do Chatwoot): a ficha do pedido da conversa aberta.
// O Chatwoot manda o contexto da conversa por postMessage; a página pede os dados ao bot com o
// token que está depois do # na URL. Dados do cliente entram sempre como texto (textContent).
'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
const $ = (id) => document.getElementById(id);
let conversaId = null;
let ocupado = false;
let ultimaCarga = 0;
// Ao voltar para a janela, só consulta o ERP de novo se a conversa mudou ou depois disto: a API
// real aceita 1 requisição por segundo. O botão "Atualizar" sempre consulta.
const RECARGA_MINIMA_MS = 60_000;

/** Atributos que o bot grava na conversa (lateral do Chatwoot). */
const ROTULOS = [
  ['numero_venda', 'Nº da venda'],
  ['total', 'Total'],
  ['forma_pagamento', 'Pagamento'],
  ['endereco', 'Endereço'],
  ['quantidade', 'Quantidade'],
];

function aviso(texto) {
  $('aviso').textContent = texto;
}

function pedirContexto() {
  window.parent.postMessage('chatwoot-dashboard-app:fetch-info', '*'); // só um pedido, sem dados
}

async function chamar(caminho, metodo = 'GET') {
  const r = await fetch(caminho, { method: metodo, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `erro ${r.status}`);
  return corpo;
}

// --- Comparação bot × ERP ---------------------------------------------------------------------

const simples = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numeroDe = (t) => Number(String(t ?? '').replace(/[^\d,]/g, '').replace(',', '.'));
const quantidadeDe = (itens) => (itens || '').split(', ').reduce((s, p) => s + (Number(p.match(/^(\d+)x/)?.[1]) || 0), 0);

/** [rótulo, valor do bot, valor do ERP, confere?] — o ERP abrevia o endereço (sem cidade/UF). */
function linhasComparacao(pedido, v) {
  return [
    ['Total', pedido.total, reais(v.total), numeroDe(pedido.total) === v.total],
    ['Pagamento', pedido.forma_pagamento, nomePagamento(v.pagamento), simples(pedido.forma_pagamento) === simples(nomePagamento(v.pagamento))],
    ['Quantidade', pedido.quantidade, v.itens, Number(pedido.quantidade) === quantidadeDe(v.itens)],
    ['Endereço', pedido.endereco, v.endereco, !!v.endereco && simples(pedido.endereco).includes(simples(v.endereco))],
  ].filter(([, bot, erp]) => bot != null && bot !== '' && erp);
}

function mostrarComparacao(pedido, v) {
  const linhas = linhasComparacao(pedido, v);
  $('comparacao').replaceChildren(
    ...linhas.map(([rotulo, bot, erp, confere]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = rotulo;
      const tdBot = document.createElement('td');
      tdBot.textContent = String(bot);
      const tdErp = document.createElement('td');
      tdErp.textContent = String(erp);
      const tdConfere = document.createElement('td');
      const marca = document.createElement('span');
      marca.className = `confere ${confere ? 'sim' : 'nao'}`;
      marca.textContent = confere ? '✓ confere' : '≠ diferente';
      tdConfere.append(marca);
      tr.append(th, tdBot, tdErp, tdConfere);
      return tr;
    }),
  );
  $('secao-comparacao').hidden = linhas.length === 0;
}

// --- Ficha ----------------------------------------------------------------------------------

function mostrarPedidoDoBot(pedido) {
  const dl = $('dados');
  dl.replaceChildren();
  for (const [chave, rotulo] of ROTULOS) {
    if (pedido[chave] == null) continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = rotulo;
    dd.textContent = String(pedido[chave]);
    dl.append(dt, dd);
  }
  $('pedido').hidden = dl.children.length === 0;
  return dl.children.length > 0;
}

function mostrar(d) {
  $('conversa').textContent = `Conversa nº ${d.conversa} · ${d.modo === 'teste' ? 'API de teste da RevGás' : 'ERP de demonstração'}`;
  const v = d.venda;
  const vendaOk = v && !('erro' in v);

  // Sem venda no ERP (ou sem acesso a ela): mostra o que o bot coletou até aqui.
  let temPedido = false;
  if (vendaOk) $('pedido').hidden = true;
  else temPedido = mostrarPedidoDoBot(d.pedido);
  aviso(v || temPedido ? '' : 'O bot ainda não coletou dados do pedido nesta conversa.');

  $('venda').hidden = !v;
  $('erro-venda').hidden = true;
  $('secao-comparacao').hidden = true;
  $('secao-historico').hidden = true;
  $('cancelar').hidden = !d.podeCancelar;
  $('acoes').hidden = !d.podeCancelar && !$('resultado').textContent;
  if (!v) return;

  $('numero').textContent = String(v.id);
  const selo = $('selo');
  if (!vendaOk) {
    selo.className = 'selo';
    selo.textContent = 'Sem dados do ERP';
    $('total').textContent = '';
    $('quando').textContent = '';
    $('erro-venda').textContent = `${v.erro.charAt(0).toUpperCase()}${v.erro.slice(1)}.`; // o motivo já diz o que houve
    $('erro-venda').hidden = false;
    return;
  }
  selo.className = `selo ${classeStatus(v.status)}`;
  selo.textContent = statusVenda(v.status);
  $('total').textContent = reais(v.total);
  $('quando').textContent = `Registrada às ${horaRevenda(v.data)} (${haQuanto(v.data)}) · ${v.pago ? 'pagamento recebido' : 'pagamento na entrega'}`;
  mostrarComparacao(d.pedido, v);
  $('modo').textContent = 'Os dados do ERP vêm da API da RevGás a cada abertura desta aba.';
  mostrarHistorico($('historico'), v.logs || []);
  $('secao-historico').hidden = $('historico').hidden;
}

async function carregar() {
  if (!conversaId || ocupado) return;
  ocupado = true;
  $('atualizar').disabled = true;
  try {
    mostrar(await chamar(`/painel/api/conversas/${conversaId}`));
    ultimaCarga = Date.now();
  } catch (e) {
    for (const id of ['pedido', 'venda', 'secao-comparacao', 'secao-historico', 'acoes']) $(id).hidden = true;
    aviso(`Não deu para carregar: ${e.message}. Tente "Atualizar".`);
  } finally {
    ocupado = false;
    $('atualizar').disabled = false;
  }
}

async function cancelar() {
  if (!conversaId || ocupado) return;
  if (!confirm(`Cancelar a venda nº ${$('numero').textContent} no ERP? Isso não pode ser desfeito.`)) return;
  ocupado = true;
  $('cancelar').disabled = true;
  $('resultado').textContent = 'Cancelando…';
  try {
    const d = await chamar(`/painel/api/conversas/${conversaId}/cancelar`, 'POST');
    $('resultado').textContent = 'Venda cancelada. Uma nota foi registrada na conversa.';
    mostrar(d);
  } catch (e) {
    $('resultado').textContent = `Não cancelou: ${e.message}.`;
  } finally {
    ocupado = false;
    $('cancelar').disabled = false;
  }
}

async function copiar() {
  try {
    await navigator.clipboard.writeText($('numero').textContent);
    $('copiar').textContent = 'Copiado';
  } catch {
    $('copiar').textContent = 'Não copiou';
  }
  setTimeout(() => ($('copiar').textContent = 'Copiar'), 1500);
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return; // só o Chatwoot que abriu esta aba
  let msg;
  try {
    msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  } catch {
    return;
  }
  if (!msg || msg.event !== 'appContext') return;
  const id = msg.data && msg.data.conversation && msg.data.conversation.id;
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const mudou = id !== conversaId;
  conversaId = id;
  if (mudou) $('resultado').textContent = '';
  if (mudou || Date.now() - ultimaCarga >= RECARGA_MINIMA_MS) carregar();
});

$('atualizar').addEventListener('click', () => (conversaId ? carregar() : pedirContexto()));
$('cancelar').addEventListener('click', cancelar);
$('copiar').addEventListener('click', copiar);
// Ao voltar para a aba, pergunta qual conversa está aberta (sem custo); o ERP só é consultado se
// a conversa mudou ou se a última consulta passou de RECARGA_MINIMA_MS.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pedirContexto();
});

if (window.parent === window) {
  aviso('Abra este painel pela aba "Pedido RevGás" dentro de uma conversa no Chatwoot.');
} else if (!token) {
  aviso('Painel sem token. Rode "npm run chatwoot:config" com o PAINEL_TOKEN no .env.');
} else {
  pedirContexto();
}
