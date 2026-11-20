// Lista "Pedidos de hoje": todos os pedidos confirmados no dia, com a venda no ERP.
// Só funciona na janela aberta pelo item "Pedidos de hoje" do menu do Chatwoot (menu.js), que passa
// o token depois do # na URL. Dados do cliente entram sempre como texto (textContent).
'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
const $ = (id) => document.getElementById(id);
let carregando = false;

function aviso(texto) {
  $('aviso').textContent = texto;
}

function reais(valor) {
  return valor == null ? '' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function chamar(caminho, metodo = 'GET') {
  const r = await fetch(caminho, { method: metodo, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `erro ${r.status}`);
  return corpo;
}

function mostrarVenda(cartao, { venda, podeCancelar }) {
  const selo = cartao.querySelector('.selo');
  const erro = cartao.querySelector('.erro');
  cartao.querySelector('.cancelar').hidden = !podeCancelar;
  erro.hidden = true;
  if ('erro' in venda) {
    selo.className = 'selo';
    selo.textContent = 'Sem resposta do ERP';
    erro.textContent = `Não deu para consultar: ${venda.erro}.`;
    erro.hidden = false;
    return;
  }
  const cancelada = venda.status === 'CANCEL';
  selo.className = `selo ${cancelada ? 'cancelada' : 'ok'}`;
  selo.textContent = `${cancelada ? 'Cancelada' : 'Registrada'}${venda.total != null ? ` · ${reais(venda.total)}` : ''}`;
  cartao.classList.toggle('apagado', cancelada);
  if (!venda.doEstabelecimento) {
    erro.textContent = 'Venda de outro estabelecimento: o painel não pode cancelar.';
    erro.hidden = false;
  }
}

function montarCartao(p) {
  const cartao = $('modelo').content.firstElementChild.cloneNode(true);
  const hora = new Date(p.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
  cartao.querySelector('.titulo').textContent = `${hora} · Venda nº ${p.vendaId}`;
  const campos = { nome: p.nome, itens: `${p.quantidade}x ${p.produto}`, total: p.total, pagamento: p.pagamento, endereco: p.endereco };
  for (const [campo, valor] of Object.entries(campos)) cartao.querySelector(`[data-campo="${campo}"]`).textContent = valor || '—';
  // O menu.js (na página do Chatwoot) abre a conversa no endereço em uso e fecha esta janela.
  cartao.querySelector('.abrir').addEventListener('click', () => {
    window.parent.postMessage({ tipo: 'revgas:abrir-conversa', conversa: p.conversaId }, '*'); // só o número
  });
  cartao.querySelector('.cancelar').addEventListener('click', () => cancelar(cartao, p.vendaId));
  return cartao;
}

async function cancelar(cartao, vendaId) {
  if (!confirm(`Cancelar a venda de teste nº ${vendaId} no ERP? Isso não pode ser desfeito.`)) return;
  const botao = cartao.querySelector('.cancelar');
  const resultado = cartao.querySelector('.resultado');
  botao.disabled = true;
  resultado.textContent = 'Cancelando…';
  try {
    mostrarVenda(cartao, await chamar(`/painel/api/vendas/${vendaId}/cancelar`, 'POST'));
    resultado.textContent = 'Venda cancelada. Uma nota foi registrada na conversa.';
  } catch (e) {
    resultado.textContent = `Não cancelou: ${e.message}.`;
  } finally {
    botao.disabled = false;
  }
}

async function carregar() {
  if (carregando) return;
  carregando = true;
  $('atualizar').disabled = true;
  try {
    const { dia, modo, pedidos } = await chamar('/painel/api/pedidos');
    const [a, m, d] = dia.split('-');
    const origem = modo === 'teste' ? 'API de teste da RevGás' : 'ERP de demonstração (em memória)';
    $('resumo').textContent = `${d}/${m}/${a} · ${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} · ${origem}`;
    const cartoes = pedidos.map(montarCartao);
    $('lista').replaceChildren(...cartoes);
    aviso(pedidos.length ? '' : 'Nenhum pedido confirmado hoje ainda.');
    // Uma consulta por vez: a API real da RevGás aceita 1 requisição por segundo.
    for (let i = 0; i < pedidos.length; i++) {
      try {
        mostrarVenda(cartoes[i], await chamar(`/painel/api/vendas/${pedidos[i].vendaId}`));
      } catch (e) {
        mostrarVenda(cartoes[i], { venda: { id: pedidos[i].vendaId, erro: e.message }, podeCancelar: false });
      }
    }
  } catch (e) {
    $('lista').replaceChildren();
    aviso(`Não deu para carregar: ${e.message}.`);
  } finally {
    carregando = false;
    $('atualizar').disabled = false;
  }
}

$('atualizar').addEventListener('click', carregar);

if (window.parent === window || !token) {
  // Aberta direto no navegador: sem acesso. A lista só funciona dentro do Chatwoot.
  aviso('Abra esta lista pelo item "Pedidos de hoje" no menu lateral do Chatwoot.');
  $('atualizar').hidden = true;
} else {
  carregar();
}
