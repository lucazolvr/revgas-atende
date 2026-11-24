// Painel "Pedido RevGás" (Dashboard App do Chatwoot).
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

function mostrar(d) {
  $('conversa').textContent = `Conversa nº ${d.conversa}`;
  const dl = $('dados');
  dl.replaceChildren();
  for (const [chave, rotulo] of ROTULOS) {
    if (d.pedido[chave] == null) continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = rotulo;
    dd.textContent = String(d.pedido[chave]);
    dl.append(dt, dd);
  }
  const temPedido = dl.children.length > 0;
  $('pedido').hidden = !temPedido;
  aviso(temPedido ? '' : 'O bot ainda não coletou dados do pedido nesta conversa.');

  const v = d.venda;
  $('venda').hidden = !v;
  $('cancelar').hidden = !d.podeCancelar;
  $('erro-venda').hidden = true;
  $('venda-dados').replaceChildren();
  $('titulo-historico').hidden = true;
  $('historico').hidden = true;
  if (!v) return;
  $('modo').textContent = d.modo === 'teste' ? 'API de teste da RevGás' : 'ERP de demonstração (em memória)';
  const selo = $('selo');
  if ('erro' in v) {
    selo.className = 'selo';
    selo.textContent = `Venda nº ${v.id}`;
    $('erro-venda').textContent = `Não deu para consultar: ${v.erro}.`;
    $('erro-venda').hidden = false;
    return;
  }
  const cancelada = v.status === 'CANCEL';
  selo.className = `selo ${cancelada ? 'cancelada' : 'ok'}`;
  selo.textContent = `${statusVenda(v.status)} · nº ${v.id}${v.total != null ? ` · ${reais(v.total)}` : ''}`;
  // Tudo abaixo vem do ERP (a API da RevGás é a fonte), não do que o bot coletou.
  const dados = [
    ['Itens', v.itens],
    ['Pagamento', nomePagamento(v.pagamento)],
    ['Pago', v.pago ? 'Sim' : 'Não'],
    ['Endereço', v.endereco],
  ];
  for (const [rotulo, valor] of dados) {
    if (!valor) continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = rotulo;
    dd.textContent = valor;
    $('venda-dados').append(dt, dd);
  }
  mostrarHistorico($('historico'), v.logs || []);
  $('titulo-historico').hidden = $('historico').hidden;
}

async function carregar() {
  if (!conversaId || ocupado) return;
  ocupado = true;
  $('atualizar').disabled = true;
  try {
    mostrar(await chamar(`/painel/api/conversas/${conversaId}`));
    ultimaCarga = Date.now();
  } catch (e) {
    $('pedido').hidden = true;
    $('venda').hidden = true;
    aviso(`Não deu para carregar: ${e.message}.`);
  } finally {
    ocupado = false;
    $('atualizar').disabled = false;
  }
}

async function cancelar() {
  if (!conversaId || ocupado) return;
  if (!confirm('Cancelar esta venda de teste no ERP? Isso não pode ser desfeito.')) return;
  ocupado = true;
  $('cancelar').disabled = true;
  $('resultado').textContent = 'Cancelando…';
  try {
    mostrar(await chamar(`/painel/api/conversas/${conversaId}/cancelar`, 'POST'));
    $('resultado').textContent = 'Venda cancelada. Uma nota foi registrada na conversa.';
  } catch (e) {
    $('resultado').textContent = `Não cancelou: ${e.message}.`;
  } finally {
    ocupado = false;
    $('cancelar').disabled = false;
  }
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
