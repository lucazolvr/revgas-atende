// Item "Pedidos de hoje" no menu lateral do Chatwoot. Carregado em todas as telas do painel pelo
// DASHBOARD_SCRIPTS (npm run chatwoot:config), com o token em data-token. Abre a lista numa janela
// por cima do Chatwoot. Sem fork: se uma versão nova mudar o menu, vira um botão flutuante.
(() => {
  'use strict';
  const eu = document.currentScript;
  if (!eu || window.__revgasMenu) return;
  window.__revgasMenu = true;

  const token = eu.dataset.token || '';
  const origem = new URL(eu.src).origin; // o bot (http://127.0.0.1:3001)
  const urlLista = `${origem}/painel/pedidos#token=${encodeURIComponent(token)}`;
  const ROTULO = 'Pedidos de hoje';
  const ICONE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/>' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/></svg>';

  // --- Janela com a lista -----------------------------------------------------------------------
  let janela = null;
  let quadro = null;

  // "Abrir conversa" na lista: abre no próprio Chatwoot, no endereço em uso (localhost ou
  // 127.0.0.1), sem recarregar. Só aceita o pedido vindo da lista que esta janela abriu.
  window.addEventListener('message', (e) => {
    if (!quadro || e.source !== quadro.contentWindow || e.origin !== origem) return;
    const d = e.data;
    if (!d || d.tipo !== 'revgas:abrir-conversa' || !Number.isSafeInteger(d.conversa) || d.conversa <= 0) return;
    const conta = location.pathname.match(/\/app\/accounts\/(\d+)\//)?.[1];
    if (!conta) return;
    fechar();
    history.pushState({}, '', `/app/accounts/${conta}/conversations/${d.conversa}`);
    dispatchEvent(new PopStateEvent('popstate')); // o roteador do Chatwoot (Vue) segue o novo endereço
  });

  function escuro() {
    return document.body.classList.contains('dark');
  }

  function fechar() {
    if (!janela) return;
    janela.remove();
    janela = null;
    quadro = null;
    document.removeEventListener('keydown', aoTeclar, true);
  }

  function aoTeclar(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      fechar();
    }
  }

  function abrir() {
    if (janela) return;
    const cor = escuro()
      ? { fundo: '#18191b', borda: '#2e3135', texto: '#edeef0' }
      : { fundo: '#ffffff', borda: '#e3e3e8', texto: '#1c2024' };
    janela = document.createElement('div');
    janela.setAttribute('role', 'dialog');
    janela.setAttribute('aria-modal', 'true');
    janela.setAttribute('aria-label', ROTULO);
    janela.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    janela.addEventListener('click', (e) => {
      if (e.target === janela) fechar();
    });

    const caixa = document.createElement('div');
    caixa.style.cssText = `width:min(1100px,100%);height:min(860px,100%);background:${cor.fundo};color:${cor.texto};border:1px solid ${cor.borda};border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)`;

    const barra = document.createElement('div');
    barra.style.cssText = `display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid ${cor.borda};font:600 14px system-ui,sans-serif`;
    const titulo = document.createElement('span');
    titulo.textContent = ROTULO;
    titulo.style.flex = '1';
    const fecharBotao = document.createElement('button');
    fecharBotao.type = 'button';
    fecharBotao.textContent = '✕';
    fecharBotao.title = 'Fechar (Esc)';
    fecharBotao.setAttribute('aria-label', 'Fechar');
    fecharBotao.style.cssText = `background:none;border:1px solid ${cor.borda};color:${cor.texto};border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:14px`;
    fecharBotao.addEventListener('click', fechar);
    barra.append(titulo, fecharBotao);

    quadro = document.createElement('iframe');
    quadro.src = urlLista;
    quadro.title = ROTULO;
    quadro.referrerPolicy = 'no-referrer';
    quadro.style.cssText = 'flex:1;width:100%;border:0';

    caixa.append(barra, quadro);
    janela.append(caixa);
    document.body.append(janela);
    document.addEventListener('keydown', aoTeclar, true);
    fecharBotao.focus();
  }

  // --- Item no menu lateral ---------------------------------------------------------------------
  // Mesmas classes dos itens do Chatwoot (SidebarGroup/SidebarGroupHeader), para ter a mesma cara.
  function criarItem(recolhido) {
    const li = document.createElement('li');
    li.dataset.revgasMenu = recolhido ? 'recolhido' : 'aberto';
    li.className = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.title = ROTULO;
    botao.setAttribute('aria-label', ROTULO);
    botao.className = recolhido
      ? 'flex items-center justify-center size-10 rounded-lg text-n-slate-11 hover:bg-n-alpha-2'
      : 'flex items-center gap-2 px-1.5 py-1 rounded-lg h-8 min-w-0 text-n-slate-11 hover:bg-n-alpha-2 w-full text-start';
    botao.innerHTML = ICONE; // constante deste arquivo, sem dado externo
    if (!recolhido) {
      const texto = document.createElement('span');
      texto.className = 'truncate text-body-main';
      texto.textContent = ROTULO;
      botao.append(texto);
    }
    botao.addEventListener('click', abrir);
    li.append(botao);
    return li;
  }

  function listaDoMenu() {
    return document.querySelector('aside nav > ul');
  }

  let botaoFlutuante = null;

  function colocar() {
    const ul = listaDoMenu();
    if (!ul) return false;
    const recolhido = ul.classList.contains('items-center');
    const atual = ul.querySelector(':scope > li[data-revgas-menu]');
    if (atual && atual.dataset.revgasMenu === (recolhido ? 'recolhido' : 'aberto')) return true;
    atual?.remove();
    const contatos = [...ul.children].find((li) => li.querySelector('a[href*="/contacts"]'));
    const item = criarItem(recolhido);
    if (contatos) contatos.after(item);
    else ul.append(item);
    botaoFlutuante?.remove();
    botaoFlutuante = null;
    return true;
  }

  function flutuante() {
    if (botaoFlutuante || listaDoMenu()) return;
    botaoFlutuante = document.createElement('button');
    botaoFlutuante.type = 'button';
    botaoFlutuante.title = ROTULO;
    botaoFlutuante.innerHTML = ICONE;
    const texto = document.createElement('span');
    texto.textContent = ROTULO;
    botaoFlutuante.append(texto);
    botaoFlutuante.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147482000;display:flex;gap:8px;align-items:center;padding:8px 14px;border:0;border-radius:999px;background:#c84812;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    botaoFlutuante.querySelector('svg').style.cssText = 'width:16px;height:16px';
    botaoFlutuante.addEventListener('click', abrir);
    document.body.append(botaoFlutuante);
  }

  // O Chatwoot remonta o menu ao trocar de tela ou recolher: recoloca o item quando ele some.
  // Vigia só o menu lateral (<aside>), não a página inteira, que muda a cada mensagem.
  let agendado = false;
  const observador = new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      colocar();
    });
  });
  let vigiado = null;
  function vigiarMenu() {
    const aside = document.querySelector('aside');
    if (aside === vigiado) return;
    observador.disconnect();
    vigiado = aside;
    if (aside) observador.observe(aside, { childList: true, subtree: true });
    colocar();
  }
  // Checagem leve: o <aside> pode ainda não existir ou ser trocado inteiro pelo Chatwoot.
  setInterval(vigiarMenu, 2000);

  vigiarMenu();
  setTimeout(() => colocar() || flutuante(), 8000); // menu não apareceu: botão flutuante
})();
