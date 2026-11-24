// Central "Pedidos de hoje": as vendas do bot no dia, direto da API da RevGás, os números do dia
// e o estoque do ERP. Só funciona na janela aberta pelo item "Pedidos de hoje" do menu do Chatwoot
// (menu.js), que passa o token depois do # na URL. Dados do cliente entram sempre como texto.
'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
const $ = (id) => document.getElementById(id);
// Atualiza sozinha a cada minuto (uma listagem + estoque em cache): o pedido feito no WhatsApp
// aparece sem clicar. Pausa com a janela escondida.
const ATUALIZACAO_MS = 60_000;
const ESTOQUE_BAIXO = 20;

let pedidos = [];
let filtro = 'todas';
// Ids da última carga do mesmo dia, para destacar as vendas novas (null = não destacar).
let vistos = null;
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

const aberta = (v) => v.status !== 'CANCEL';

// --- Números do dia -------------------------------------------------------------------------

function numero(rotulo, valor, detalhe) {
  const div = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = rotulo;
  dd.textContent = valor;
  if (detalhe) {
    const small = document.createElement('small');
    small.textContent = detalhe;
    dd.append(small);
  }
  div.append(dt, dd);
  return div;
}

/** Soma "2x GLP 13KG, 1x AGUA 20L" por produto. */
function porProduto(lista) {
  const soma = new Map();
  for (const v of lista) {
    for (const parte of v.itens.split(', ')) {
      const m = parte.match(/^(\d+)x (.+)$/);
      if (m) soma.set(m[2], (soma.get(m[2]) || 0) + Number(m[1]));
    }
  }
  return [...soma].sort((a, b) => b[1] - a[1]);
}

function mostrarNumeros() {
  const abertas = pedidos.filter(aberta);
  const canceladas = pedidos.length - abertas.length;
  const total = abertas.reduce((s, v) => s + v.total, 0);
  const pagamentos = new Map();
  for (const v of abertas) pagamentos.set(v.pagamento, (pagamentos.get(v.pagamento) || 0) + 1);
  const topoPagamento = [...pagamentos].sort((a, b) => b[1] - a[1])[0];
  const topoProduto = porProduto(abertas)[0];
  $('numeros').replaceChildren(
    numero('Em aberto', String(abertas.length), reais(total)),
    numero('Canceladas', String(canceladas), pedidos.length ? `${Math.round((canceladas / pedidos.length) * 100)}% das vendas` : ''),
    numero('Ticket médio', abertas.length ? reais(total / abertas.length) : '—'),
    numero('Pagamento mais usado', topoPagamento ? nomePagamento(topoPagamento[0]) : '—', topoPagamento ? `${topoPagamento[1]} de ${abertas.length}` : ''),
    numero('Mais pedido', topoProduto ? topoProduto[0] : '—', topoProduto ? `${topoProduto[1]} un.` : ''),
  );
  $('numeros').hidden = pedidos.length === 0;
}

// --- Comandas -------------------------------------------------------------------------------

function pintar(comanda, venda, podeCancelar) {
  const classe = classeStatus(venda.status);
  comanda.className = `comanda ${classe}`;
  const selo = comanda.querySelector('.selo');
  selo.className = `selo ${classe}`;
  selo.textContent = statusVenda(venda.status);
  comanda.querySelector('.cancelar').hidden = !podeCancelar;
  if (venda.logs) mostrarHistorico(comanda.querySelector('.timeline'), venda.logs);
}

function montarComanda(v) {
  const comanda = $('modelo').content.firstElementChild.cloneNode(true);
  comanda.querySelector('.hora').textContent = horaRevenda(v.data);
  comanda.querySelector('.ha').textContent = haQuanto(v.data);
  comanda.querySelector('.numero').textContent = `Venda nº ${v.id}`;
  comanda.querySelector('.valor').textContent = reais(v.total);
  comanda.querySelector('.cliente').textContent = v.cliente || 'Cliente não informado';
  comanda.querySelector('.itens').textContent = `${v.itens || 'Itens não informados'} · ${nomePagamento(v.pagamento)}`;
  comanda.querySelector('.endereco').textContent = v.endereco || '';
  pintar(comanda, v, v.podeCancelar);
  if (vistos && !vistos.has(v.id)) comanda.classList.add('nova');

  const abrir = comanda.querySelector('.abrir');
  // Vendas de antes de o bot anotar a conversa na observação não têm o número da conversa.
  abrir.hidden = !v.conversaId;
  // O menu.js (na página do Chatwoot) abre a conversa no endereço em uso e fecha esta janela.
  abrir.addEventListener('click', () => {
    window.parent.postMessage({ tipo: 'revgas:abrir-conversa', conversa: v.conversaId }, '*'); // só o número
  });
  comanda.querySelector('.ver-historico').addEventListener('click', (e) => verHistorico(comanda, v.id, e.currentTarget));
  comanda.querySelector('.cancelar').addEventListener('click', () => cancelar(comanda, v));
  return comanda;
}

function mostrarLista() {
  const busca = $('busca').value.trim().toLowerCase();
  const visiveis = pedidos.filter((v) => {
    if (filtro === 'abertas' && !aberta(v)) return false;
    if (filtro === 'canceladas' && aberta(v)) return false;
    return !busca || String(v.id).includes(busca) || (v.cliente || '').toLowerCase().includes(busca);
  });
  $('lista').replaceChildren(...visiveis.map(montarComanda));
  if (!pedidos.length) aviso($('dia').selectedIndex === 0 ? 'Nenhuma venda do bot hoje ainda. Os pedidos confirmados no WhatsApp aparecem aqui.' : 'Nenhuma venda do bot neste dia.');
  else aviso(visiveis.length ? '' : 'Nenhuma venda com esse filtro.');
}

/** O histórico é uma consulta a mais na API (1 req/s): só quando o atendente pede. */
async function verHistorico(comanda, vendaId, botao) {
  const resultado = comanda.querySelector('.resultado');
  botao.disabled = true;
  try {
    const { venda, podeCancelar } = await chamar(`/painel/api/vendas/${vendaId}`);
    pintar(comanda, venda, podeCancelar);
    botao.hidden = true;
  } catch (e) {
    resultado.textContent = `Não deu para ver o histórico: ${e.message}.`;
  } finally {
    botao.disabled = false;
  }
}

async function cancelar(comanda, v) {
  if (!confirm(`Cancelar a venda nº ${v.id} (${reais(v.total)}) no ERP? Isso não pode ser desfeito.`)) return;
  const botao = comanda.querySelector('.cancelar');
  const resultado = comanda.querySelector('.resultado');
  botao.disabled = true;
  resultado.textContent = 'Cancelando…';
  try {
    const { venda, podeCancelar } = await chamar(`/painel/api/vendas/${v.id}/cancelar`, 'POST');
    Object.assign(v, { status: venda.status, podeCancelar });
    pintar(comanda, venda, podeCancelar);
    comanda.querySelector('.ver-historico').hidden = true;
    resultado.textContent = venda.conversaId ? 'Venda cancelada. Uma nota foi registrada na conversa.' : 'Venda cancelada.';
    mostrarNumeros();
  } catch (e) {
    resultado.textContent = `Não cancelou: ${e.message}.`;
  } finally {
    botao.disabled = false;
  }
}

// --- Estoque --------------------------------------------------------------------------------

function nivel(estoque) {
  if (estoque == null) return ['desconhecido', 'não informado'];
  if (estoque === 0) return ['esgotado', 'esgotado'];
  if (estoque < ESTOQUE_BAIXO) return ['baixo', 'estoque baixo'];
  return ['ok', 'disponível'];
}

async function carregarEstoque() {
  try {
    const { estoque } = await chamar('/painel/api/estoque');
    $('estoque').replaceChildren(
      ...estoque.map((p) => {
        const [classe, texto] = nivel(p.estoque);
        const li = document.createElement('li');
        li.className = classe;
        const botijao = document.createElement('span');
        botijao.className = 'botijao';
        botijao.setAttribute('aria-hidden', 'true');
        const info = document.createElement('div');
        const nome = document.createElement('span');
        const qtd = document.createElement('span');
        const situacao = document.createElement('span');
        nome.textContent = p.nome;
        qtd.className = 'qtd';
        qtd.textContent = p.estoque == null ? '—' : `${p.estoque.toLocaleString('pt-BR')} un.`;
        situacao.className = 'nivel';
        situacao.textContent = texto;
        info.append(nome, qtd, situacao);
        li.append(botijao, info);
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

// --- Carga ----------------------------------------------------------------------------------

function rotuloDia(dia, i) {
  const [a, m, d] = dia.split('-');
  const data = `${d}/${m}`;
  if (i === 0) return `Hoje, ${data}`;
  if (i === 1) return `Ontem, ${data}`;
  const semana = new Date(Date.UTC(+a, +m - 1, +d, 12)).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  return `${semana[0].toUpperCase()}${semana.slice(1)}, ${data}`;
}

async function carregar() {
  if (carregando) return;
  carregando = true;
  $('atualizar').disabled = true;
  const escolhido = $('dia').value;
  try {
    const r = await chamar(`/painel/api/pedidos${escolhido ? `?dia=${encodeURIComponent(escolhido)}` : ''}`);
    if (!$('dia').options.length) {
      $('dia').replaceChildren(...r.dias.map((d, i) => new Option(rotuloDia(d, i), d)));
    }
    pedidos = r.pedidos;
    const origem = r.modo === 'teste' ? 'API de teste da RevGás' : 'ERP de demonstração (em memória)';
    $('resumo').textContent = `${pedidos.length} ${pedidos.length === 1 ? 'venda' : 'vendas'} no dia, direto da ${origem}. Atualizado às ${horaRevenda(new Date().toISOString())}.`;
    mostrarNumeros();
    mostrarLista();
    vistos = new Set(pedidos.map((v) => v.id));
  } catch (e) {
    pedidos = [];
    $('lista').replaceChildren();
    $('numeros').hidden = true;
    aviso(`Não deu para carregar as vendas: ${e.message}. Tente "Atualizar" em instantes.`);
  } finally {
    // Uma chamada por vez: a API real da RevGás aceita 1 requisição por segundo.
    await carregarEstoque();
    carregando = false;
    $('atualizar').disabled = false;
  }
}

$('atualizar').addEventListener('click', carregar);
$('dia').addEventListener('change', () => {
  vistos = null;
  carregar();
});
$('busca').addEventListener('input', mostrarLista);
for (const botao of document.querySelectorAll('[data-filtro]')) {
  botao.addEventListener('click', () => {
    filtro = botao.dataset.filtro;
    for (const b of document.querySelectorAll('[data-filtro]')) b.setAttribute('aria-pressed', String(b === botao));
    mostrarLista();
  });
}

if (window.parent === window || !token) {
  // Aberta direto no navegador: sem acesso. A lista só funciona dentro do Chatwoot.
  aviso('Abra esta lista pelo item "Pedidos de hoje" no menu lateral do Chatwoot.');
  for (const el of ['atualizar', 'dia', 'secao-estoque']) $(el).hidden = true;
  document.querySelector('.filtros').hidden = true;
} else {
  carregar();
  setInterval(() => {
    if (document.visibilityState === 'visible') carregar();
  }, ATUALIZACAO_MS);
}
