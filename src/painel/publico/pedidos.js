// Lista "Pedidos de hoje": as vendas do bot no dia, direto da API da RevGás, e o estoque do ERP.
// Só funciona na janela aberta pelo item "Pedidos de hoje" do menu do Chatwoot (menu.js), que passa
// o token depois do # na URL. Dados do cliente entram sempre como texto (textContent).
'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
const $ = (id) => document.getElementById(id);
let carregando = false;

function aviso(texto) {
  $('aviso').textContent = texto;
}

async function chamar(caminho, metodo = 'GET') {
  const r = await fetch(caminho, { method: metodo, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `erro ${r.status}`);
  return corpo;
}

function mostrarVenda(cartao, venda, podeCancelar) {
  const selo = cartao.querySelector('.selo');
  const cancelada = venda.status === 'CANCEL';
  selo.className = `selo ${cancelada ? 'cancelada' : 'ok'}`;
  selo.textContent = `${statusVenda(venda.status)} · ${reais(venda.total)}`;
  cartao.classList.toggle('apagado', cancelada);
  cartao.querySelector('.cancelar').hidden = !podeCancelar;
  if (venda.logs) mostrarHistorico(cartao.querySelector('.historico'), venda.logs);
}

function montarCartao(v) {
  const cartao = $('modelo').content.firstElementChild.cloneNode(true);
  cartao.querySelector('.titulo').textContent = `${horaRevenda(v.data)} · Venda nº ${v.id}`;
  const campos = { nome: v.cliente, itens: v.itens, pagamento: nomePagamento(v.pagamento), endereco: v.endereco };
  for (const [campo, valor] of Object.entries(campos)) cartao.querySelector(`[data-campo="${campo}"]`).textContent = valor || '—';
  mostrarVenda(cartao, v, v.podeCancelar);
  const abrir = cartao.querySelector('.abrir');
  // Vendas de antes de o bot anotar a conversa na observação não têm o número da conversa.
  abrir.hidden = !v.conversaId;
  // O menu.js (na página do Chatwoot) abre a conversa no endereço em uso e fecha esta janela.
  abrir.addEventListener('click', () => {
    window.parent.postMessage({ tipo: 'revgas:abrir-conversa', conversa: v.conversaId }, '*'); // só o número
  });
  cartao.querySelector('.ver-historico').addEventListener('click', (e) => verHistorico(cartao, v.id, e.currentTarget));
  cartao.querySelector('.cancelar').addEventListener('click', () => cancelar(cartao, v.id));
  return cartao;
}

/** O histórico é uma consulta a mais na API (1 req/s): só quando o atendente pede. */
async function verHistorico(cartao, vendaId, botao) {
  const resultado = cartao.querySelector('.resultado');
  botao.disabled = true;
  try {
    const { venda, podeCancelar } = await chamar(`/painel/api/vendas/${vendaId}`);
    mostrarVenda(cartao, venda, podeCancelar);
    botao.hidden = true;
  } catch (e) {
    resultado.textContent = `Não deu para ver o histórico: ${e.message}.`;
  } finally {
    botao.disabled = false;
  }
}

async function cancelar(cartao, vendaId) {
  if (!confirm(`Cancelar a venda de teste nº ${vendaId} no ERP? Isso não pode ser desfeito.`)) return;
  const botao = cartao.querySelector('.cancelar');
  const resultado = cartao.querySelector('.resultado');
  botao.disabled = true;
  resultado.textContent = 'Cancelando…';
  try {
    const { venda, podeCancelar } = await chamar(`/painel/api/vendas/${vendaId}/cancelar`, 'POST');
    mostrarVenda(cartao, venda, podeCancelar);
    cartao.querySelector('.ver-historico').hidden = true;
    resultado.textContent = venda.conversaId ? 'Venda cancelada. Uma nota foi registrada na conversa.' : 'Venda cancelada.';
  } catch (e) {
    resultado.textContent = `Não cancelou: ${e.message}.`;
  } finally {
    botao.disabled = false;
  }
}

async function carregarEstoque() {
  try {
    const { estoque } = await chamar('/painel/api/estoque');
    $('estoque').replaceChildren(
      ...estoque.map((p) => {
        const li = document.createElement('li');
        const nome = document.createElement('span');
        const qtd = document.createElement('strong');
        nome.textContent = p.nome;
        qtd.textContent = p.estoque == null ? 'não informado' : `${p.estoque.toLocaleString('pt-BR')} un.`;
        if (p.estoque === 0) li.className = 'esgotado';
        li.append(nome, qtd);
        return li;
      }),
    );
    $('erro-estoque').hidden = true;
  } catch (e) {
    $('estoque').replaceChildren();
    $('erro-estoque').textContent = `Não deu para consultar o estoque: ${e.message}.`;
    $('erro-estoque').hidden = false;
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
    const ativas = pedidos.filter((p) => p.status !== 'CANCEL');
    const total = ativas.reduce((s, p) => s + p.total, 0);
    $('resumo').textContent =
      `${d}/${m}/${a} · ${pedidos.length} ${pedidos.length === 1 ? 'venda' : 'vendas'}` +
      ` (${ativas.length} em aberto, ${reais(total)}) · ${origem}`;
    $('lista').replaceChildren(...pedidos.map(montarCartao));
    aviso(pedidos.length ? '' : 'Nenhuma venda do bot hoje ainda.');
  } catch (e) {
    $('lista').replaceChildren();
    aviso(`Não deu para carregar: ${e.message}.`);
  } finally {
    // Uma chamada por vez: a API real da RevGás aceita 1 requisição por segundo.
    await carregarEstoque();
    carregando = false;
    $('atualizar').disabled = false;
  }
}

$('atualizar').addEventListener('click', carregar);

if (window.parent === window || !token) {
  // Aberta direto no navegador: sem acesso. A lista só funciona dentro do Chatwoot.
  aviso('Abra esta lista pelo item "Pedidos de hoje" no menu lateral do Chatwoot.');
  $('atualizar').hidden = true;
  $('secao-estoque').hidden = true;
} else {
  carregar();
}
