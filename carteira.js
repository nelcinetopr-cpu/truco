/* =========================================================
   CARTEIRA (saldo em reais, ou fictício no modo fichas)
   Depósito por Pix (Mercado Pago) e saque pedido aqui; a organização paga o
   saque e confere tudo no painel. Quem mexe no saldo é só o servidor
   (functions/lib/carteira-server.js); esta tela só pede e mostra.
   Carregado antes do código principal: usa callServer, fns, db, account, esc, toast...
   ========================================================= */
const cart = { r: null, tab: 'sacar', ext: 'pix', aberta: false, sheet: null, dep: null, unsubDep: null, poll: null, admin: null, extrato: null };
try {
  const t = localStorage.getItem('truco.carteiraTab'); if (['sacar', 'extrato'].includes(t)) cart.tab = t;
  const x = localStorage.getItem('truco.extratoTab'); if (['pix', 'jogos'].includes(x)) cart.ext = x;
} catch {}
const guarda = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const brl = c => 'R$ ' + ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moedaTxt = (c, moeda) => (moeda === 'FICHA' ? `${brl(c)} <small class="muted">(teste)</small>` : brl(c));
const reaisParaCentavos = s => {
  const n = Number(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const quando = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS_DEP = { aguardando: 'esperando o Pix', creditado: 'creditado', conferir: 'a organização vai conferir', devolver: 'pago por outro CPF: será devolvido', devolvido: 'devolvido', expirado: 'expirou', cancelado: 'cancelado', erro: 'erro ao gerar', criando: 'gerando' };
const STATUS_SAQ = { pendente: 'esperando pagamento', pago: 'pago', recusado: 'recusado (valor voltou)' };
const TIPO_LANC = { deposito: 'Depósito', 'saque-pedido': 'Saque pedido', 'saque-estornado': 'Saque recusado (estorno)', 'saque-pago': 'Saque pago', 'taxa-bancaria': 'Taxa bancária', 'credito-da-casa': 'Saldo dado pela casa', 'entrada-mesa': 'Entrada de mesa', 'premio-mesa': 'Prêmio de mesa', 'devolucao-mesa': 'Entrada devolvida', 'bonus-indicacao': 'Bônus (indicação)', 'caixa-rendimento': 'Rendimento do Mercado Pago' };
const TIPOS_JOGO = ['entrada-mesa', 'premio-mesa', 'devolucao-mesa'];

function stopCarteira() {
  stopMpVivo();
  if (cart.unsubDep) cart.unsubDep();
  clearInterval(cart.poll);
  cart.unsubDep = null; cart.poll = null;
}

async function loadCarteira() {
  const el = document.getElementById('walletPanel'); if (!el) return;
  if (!fns || !account) { cart.r = null; renderCarteira(); return; }
  const r = await callServer('carteiraResumo', {}, { quiet: true });
  cart.r = r; renderCarteira();
  if (cart.aberta && cart.tab === 'extrato') loadExtrato();
  if (r && r.regras && r.regras.taxaPartida != null) {
    window.TAXA_PARTIDA = r.regras.taxaPartida;
    const t = document.getElementById('taxaPartida'); if (t) t.textContent = String(r.regras.taxaPartida).replace('.', ',');
  }
  const pend = r && r.depositos.find(d => d.status === 'aguardando' && (!d.expiraEm || d.expiraEm > Date.now()));
  if (pend && (!cart.dep || cart.dep.id !== pend.id)) watchDeposito(pend.id);
}

// formulário do CPF (aparece na carteira e na janela de depósito enquanto não houver CPF)
const cpfFormHtml = () => `<p class="muted" style="font-size:13px">Para depositar e sacar, cadastre seu CPF (uma conta por CPF, só maiores de 18 anos). O saque vai sempre para a chave Pix do seu CPF.</p>
  <form class="row cpfForm" novalidate>
    <label style="flex:2 1 160px">CPF<input name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label>
    <label style="flex:1 1 140px">Nascimento<input name="nasc" type="date"></label>
    <div class="row" style="flex:1 1 100%"><button class="primary" type="submit">Cadastrar CPF</button></div>
  </form>`;

// topo da página: saldo e Depositar, perto do nome do jogador
function paintTopCarteira() {
  const el = document.getElementById('topCart'); if (!el) return;
  if (!fns || !account) { el.innerHTML = ''; return; }
  const r = cart.r;
  el.innerHTML = `${r ? `<button type="button" class="small top-saldo" data-topwallet title="Abrir a carteira">${brl(r.saldo)}</button>` : ''}
    <button type="button" class="small primary" data-topsheet="depositar">Depositar</button>`;
  el.querySelectorAll('[data-topsheet]').forEach(b => (b.onclick = () => abrirSheet(b.dataset.topsheet)));
  const w = el.querySelector('[data-topwallet]');
  if (w) w.onclick = () => {
    const p = document.getElementById('walletPanel'); if (!p) return;
    if (!cart.aberta) toggleCarteira();
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

function toggleCarteira() {
  cart.aberta = !cart.aberta;
  renderCarteira();
  if (cart.aberta && cart.tab === 'extrato' && !cart.extrato) loadExtrato();
}

function renderCarteira() {
  paintTopCarteira();
  if (cart.sheet) renderSheet();
  renderConvite();
  const el = document.getElementById('walletPanel'); if (!el) return;
  if (!fns) { el.innerHTML = '<h2>Carteira</h2><p class="muted">A carteira só funciona no site publicado (com o servidor).</p>'; return; }
  if (!account) { el.innerHTML = '<h2>Carteira</h2><p class="muted">Entre com seu usuário para ver seu saldo.</p>'; return; }
  const r = cart.r;
  if (!r) { el.innerHTML = '<h2>Carteira</h2><p class="muted">Carregando…</p>'; return; }
  const teste = r.moeda === 'FICHA';
  if (!r.cpf) {
    el.innerHTML = `<h2>Carteira</h2>${teste ? '<p class="tag">modo de teste: saldo fictício</p>' : ''}${cpfFormHtml()}`;
    bindCarteira(r);
    return;
  }
  const trav = r.bonus && r.bonus.travado;
  const tabs = [['sacar', 'Sacar'], ['extrato', 'Extrato']];
  el.innerHTML = `<h2>Carteira</h2>
    <button type="button" class="wallet" data-wallet aria-expanded="${cart.aberta}">
      <span class="wallet-label">Saldo</span>
      <b>${moedaTxt(r.saldo, r.moeda)}</b>
      ${trav ? `<span class="bonus-line">🎁 ${brl(trav)} é bônus · jogue para liberar o saque</span>` : ''}
      <span class="wallet-foot"><span>${teste ? 'modo de teste: não vale dinheiro' : `CPF ${esc(r.cpf)}`}</span><span class="wallet-more">${cart.aberta ? 'Fechar ▴' : 'Saque e extrato ▾'}</span></span>
    </button>
    ${cart.aberta ? `<div class="seg two" role="tablist" aria-label="Carteira">${tabs.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === cart.tab}" data-ctab="${k}">${t}</button>`).join('')}</div>
    <div class="wallet-body">${cart.tab === 'sacar' ? saqueHtml(r) : extratoHtml()}</div>` : ''}`;
  el.querySelector('[data-wallet]').onclick = toggleCarteira;
  el.querySelectorAll('[data-ctab]').forEach(b => (b.onclick = () => {
    cart.tab = b.dataset.ctab; guarda('truco.carteiraTab', cart.tab);
    if (cart.tab === 'extrato') loadExtrato(); else renderCarteira();
  }));
  el.querySelectorAll('[data-etab]').forEach(b => (b.onclick = () => {
    cart.ext = b.dataset.etab; guarda('truco.extratoTab', cart.ext); renderCarteira();
  }));
  bindCarteira(r);
}

// widget de convite, separado da carteira
function renderConvite() {
  const el = document.getElementById('invitePanel'); if (!el) return;
  const r = cart.r;
  if (!fns || !account || !r) { el.hidden = true; return; }
  el.hidden = false;
  const digitado = (document.getElementById('indCod') || {}).value;
  el.innerHTML = `<h2>Convide a turma</h2>${convidarHtml(r)}`;
  if (digitado) document.getElementById('indCod').value = digitado;
}

// janela por cima da página: Depositar
function abrirSheet(qual) {
  cart.sheet = qual;
  renderSheet();
  if (!cart.r) loadCarteira();
}
function fecharSheet() {
  cart.sheet = null;
  const ov = document.getElementById('cartSheet'); if (ov) ov.remove();
  document.removeEventListener('keydown', escSheet);
}
function escSheet(e) { if (e.key === 'Escape') fecharSheet(); }
function renderSheet() {
  let ov = document.getElementById('cartSheet');
  if (!cart.sheet) { if (ov) ov.remove(); return; }
  const novo = !ov;
  // guarda o que a pessoa já digitou (a janela é redesenhada quando o saldo muda)
  const digitado = {};
  if (ov) ov.querySelectorAll('input[id], input[name]').forEach(i => (digitado[i.id || i.name] = i.value));
  if (novo) {
    ov = document.createElement('div');
    ov.id = 'cartSheet'; ov.className = 'sheet-ov';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.onclick = e => { if (e.target === ov) fecharSheet(); };
    document.body.appendChild(ov);
    document.addEventListener('keydown', escSheet);
  }
  const r = cart.r, dep = cart.sheet === 'depositar';
  const corpo = !r ? '<p class="muted">Carregando…</p>' : dep ? (r.cpf ? depositoHtml(r) : cpfFormHtml()) : convidarHtml(r);
  ov.setAttribute('aria-label', dep ? 'Depositar' : 'Convidar');
  ov.innerHTML = `<div class="sheet">
      <div class="sheet-head"><h2>${dep ? 'Depositar' : 'Convidar a turma'}</h2><button type="button" class="small" data-sheetclose aria-label="Fechar">✕</button></div>
      ${r && dep ? `<p class="sheet-saldo">Saldo atual <b>${brl(r.saldo)}</b></p>` : ''}
      ${corpo}
    </div>`;
  ov.querySelectorAll('input[id], input[name]').forEach(i => { const v = digitado[i.id || i.name]; if (v) i.value = v; });
  ov.querySelector('[data-sheetclose]').onclick = fecharSheet;
  if (r) bindCarteira(r);
  if (novo) { const f = ov.querySelector('input:not([type=date])'); if (f && window.matchMedia('(hover: hover)').matches) f.focus(); }
}

function depositoHtml(r) {
  const d = cart.dep;
  if (d && d.status === 'aguardando') {
    return `<div class="pixbox">
      <p><b>Pague ${brl(d.valor)} pelo Pix</b> — o saldo entra sozinho assim que o banco confirmar.</p>
      ${d.qrBase64 ? `<img class="pixqr" alt="QR Code do Pix" src="data:image/png;base64,${esc(d.qrBase64)}">` : ''}
      ${d.qr ? `<div class="pix-key"><span class="key-text pixcode">${esc(d.qr)}</span><button type="button" class="small primary" data-copy="${esc(d.qr)}" data-copied="Código Pix copiado.">Copiar Pix</button></div>` : ''}
      <p class="muted" style="font-size:13px">Pague <b>com uma conta no seu CPF</b>: Pix de outro CPF não entra no saldo e é devolvido. ${d.expiraEm ? `Vale até ${quando(d.expiraEm)}.` : ''}</p>
      <p class="muted" id="depStatus">Esperando o pagamento…</p>
      <div class="row"><button class="small" data-depcheck>Já paguei, conferir</button><button class="small" data-depnew>Novo depósito</button></div>
    </div>`;
  }
  const min = r.regras.depositoMinimo;
  const recentes = r.depositos.filter(x => x.status !== 'criando').slice(0, 5);
  const rapidos = [2000, 5000, 10000].filter(v => v >= min);
  return `<form id="depForm" class="dep-form" novalidate>
      <label>Valor (R$)<input id="depValor" inputmode="decimal" placeholder="${(min / 100).toFixed(2).replace('.', ',')}"></label>
      <div class="chips">${rapidos.map(v => `<button type="button" class="small" data-depval="${v}">${brl(v)}</button>`).join('')}</div>
      <button class="primary" type="submit">Gerar Pix</button>
      <p class="muted" style="font-size:12px;margin:0">Mínimo de ${brl(min)}. O Pix tem de sair de uma conta no seu CPF (${esc(r.cpf)}).</p>
    </form>
    ${recentes.length ? `<h3>Últimos depósitos</h3><ul class="movs">${recentes.map(x => `<li><span>${brl(x.valor)}</span><b class="${x.status === 'creditado' ? 'pos' : x.status === 'devolver' ? 'neg' : 'muted'}">${esc(STATUS_DEP[x.status] || x.status)}</b><small class="muted">${quando(x.criadoEm)}</small></li>`).join('')}</ul>` : ''}`;
}

function saqueHtml(r) {
  const bloq = r.regras.saquesBloqueados;
  const recentes = r.saques.slice(0, 5);
  return `${bloq ? '<p class="form-error">Saques suspensos temporariamente para conferência.</p>' : ''}
    <p class="muted" style="font-size:13px;margin:0">O Pix vai para a chave <b>CPF ${esc(r.cpf)}</b>. ${r.regras.saquesPorDia} saque por dia, mínimo de ${brl(r.regras.saqueMinimo)}. O valor sai do saldo na hora e a organização faz o Pix.
    ${r.tarifaSeSacarAgora ? `<br>Tarifa de ${brl(r.tarifaSeSacarAgora)}: sem custo quando você já tiver jogado em entradas o valor que depositou.` : '<br>Sem tarifa.'}</p>
    ${r.bonus && r.bonus.travado ? `<p class="notice" style="font-size:13px">Disponível para saque agora: <b>${brl(r.disponivelSaque)}</b>. ${brl(r.bonus.travado)} do seu saldo é bônus e libera quando você jogar o que falta (veja em Convide a turma).</p>` : ''}
    <form id="saqForm" class="dep-form" novalidate>
      <label>Valor (R$)<input id="saqValor" inputmode="decimal" placeholder="0,00" ${bloq ? 'disabled' : ''}></label>
      <button class="primary" type="submit" ${bloq ? 'disabled' : ''}>Pedir saque</button>
    </form>
    ${recentes.length ? `<h3>Seus saques</h3><ul class="movs">${recentes.map(x => `<li><span>${brl(x.valor)}${x.tarifa ? ` <span class="muted">(recebe ${brl(x.liquido)})</span>` : ''}</span><b class="${x.status === 'pago' ? 'pos' : 'muted'}">${esc(STATUS_SAQ[x.status] || x.status)}</b><small class="muted">${quando(x.criadoEm)}</small></li>`).join('')}</ul>` : ''}`;
}

// convite: link, regras, quem você convidou, e o código de quem te convidou
function convidarHtml(r) {
  const c = r.convites || {}, ind = r.indicacao || {}, x = ind.x || 5;
  const link = `${location.origin}${location.pathname}#convite-${encodeURIComponent(c.codigo || '')}`;
  const jaDepositou = (r.depositos || []).some(d => d.status === 'creditado');
  const bonusLista = (r.bonus && r.bonus.lista) || [];
  if (ind.ativa === false) return '<p class="muted">O programa de indicação está pausado no momento.</p>';
  return `<div class="convite-hero"><b>Ganhe ${brl(ind.valor)}</b><span>por amigo que fizer o primeiro depósito. Ele ganha <b>${ind.pct}%</b> do depósito de bônus.</span></div>
    <div class="pix-key"><span class="key-text">${esc(link)}</span></div>
    <div class="row"><button type="button" class="small primary" data-copy="${esc(link)}" data-copied="Link copiado.">Copiar link</button>${navigator.share ? `<button type="button" class="small" data-share="${esc(link)}">Enviar pelo WhatsApp…</button>` : ''}</div>
    <p class="muted" style="font-size:12px;margin:0">Seu código: <b>${esc(c.codigo || '')}</b>. Os bônus valem nas mesas na hora e podem ser sacados depois de jogar ${x}x o valor deles em entradas.</p>
    ${bonusLista.length ? `<h3>Seus bônus</h3><ul class="movs">${bonusLista.map(b => `<li><span>${esc(b.texto || 'Bônus')} · ${brl(b.valor)}</span><b class="${b.liberado ? 'pos' : 'muted'}">${b.liberado ? 'liberado para saque' : `jogou ${brl(b.jogou)} de ${brl(b.meta)}`}</b><small class="muted">${b.liberado ? '' : `falta ${brl(b.meta - b.jogou)}`}</small></li>`).join('')}</ul>` : ''}
    <h3>Quem você convidou</h3>
    ${(c.convidados || []).length ? `<ul class="movs">${c.convidados.map(v => `<li><span>${esc(v.nome)}</span><b class="${v.status === 'pago' ? 'pos' : 'muted'}">${v.status === 'pago' ? `+${brl(v.bonus)} de bônus` : 'esperando o 1º depósito'}</b><small class="muted">${quando(v.at)}</small></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Ninguém ainda. Mande o seu link.</p>'}
    ${c.indicadoPor ? `<p class="muted" style="font-size:13px">Você foi convidado por <b>${esc(c.indicadoPor.nome || c.indicadoPor.key)}</b>.</p>`
      : jaDepositou ? '' : `<h3>Alguém te convidou?</h3>
    <form id="indForm" class="row" novalidate>
      <label style="flex:2 1 160px">Código de quem te convidou<input id="indCod" autocapitalize="off" autocomplete="off" placeholder="nome de usuário"></label>
      <div class="row" style="flex:1 1 100%"><button class="small primary" type="submit">Usar código</button></div>
    </form>
    <p class="muted" style="font-size:12px">Só vale antes do primeiro depósito.</p>`}`;
}

// extrato em duas listas: dinheiro que entrou e saiu (Pix) e o que aconteceu nas mesas
function extratoHtml() {
  const abas = `<div class="seg two mini" role="tablist" aria-label="Extrato">${[['pix', 'Depósitos e saques'], ['jogos', 'Jogos']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === cart.ext}" data-etab="${k}">${t}</button>`).join('')}</div>`;
  const ex = cart.extrato;
  if (!ex) return abas + '<p class="muted">Carregando…</p>';
  const jogos = cart.ext === 'jogos';
  const lista = ex.filter(l => TIPOS_JOGO.includes(l.tipo) === jogos);
  if (!lista.length) return abas + `<p class="muted">${jogos ? 'Nenhuma partida valendo saldo ainda.' : 'Nenhum depósito ou saque ainda.'}</p>`;
  const soma = lista.reduce((s, l) => s + l.valor, 0);
  const total = jogos
    ? `<p class="ext-total">Resultado nas mesas: <b class="${soma >= 0 ? 'pos' : 'neg'}">${soma >= 0 ? '+' : '−'}${brl(Math.abs(soma))}</b></p>`
    : `<p class="ext-total">Entrou <b class="pos">${brl(lista.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0))}</b> · saiu <b class="neg">${brl(-lista.filter(l => l.valor < 0).reduce((s, l) => s + l.valor, 0))}</b></p>`;
  return `${abas}${total}<ul class="movs">${lista.map(l => `<li><span>${esc(TIPO_LANC[l.tipo] || l.tipo)}</span><b class="${l.valor >= 0 ? 'pos' : 'neg'}">${l.valor >= 0 ? '+' : '−'}${brl(Math.abs(l.valor))}</b><small class="muted">${quando(l.at)}${l.moeda === 'FICHA' ? ' · teste' : ''}</small></li>`).join('')}</ul>`;
}
async function loadExtrato() {
  cart.extrato = null; renderCarteira();
  const out = await callServer('carteiraExtrato', {}, { quiet: true });
  cart.extrato = (out && out.lancamentos.filter(l => l.valor && (!cart.r || !l.moeda || l.moeda === cart.r.moeda))) || [];
  renderCarteira();
}

function bindCarteira(r) {
  document.querySelectorAll('form.cpfForm').forEach(f => (f.onsubmit = async e => {
    e.preventDefault();
    const out = await callServer('carteiraCpf', { cpf: f.elements.cpf.value, nascimento: f.elements.nasc.value });
    if (out) { toast('CPF cadastrado.'); loadCarteira(); }
  }));
  const inf = document.getElementById('indForm');
  if (inf) inf.onsubmit = async e => {
    e.preventDefault();
    const out = await callServer('carteiraIndicacao', { codigo: document.getElementById('indCod').value });
    if (out) { toast(`Pronto: ${out.nomePor} te convidou. O bônus entra no seu primeiro depósito.`, 6000); loadCarteira(); }
  };
  document.querySelectorAll('#invitePanel [data-share]').forEach(b => (b.onclick = () => {
    navigator.share({ title: 'TRUCO', text: `Vem jogar truco comigo! Entra pelo meu convite e ganha ${r.indicacao ? r.indicacao.pct : 50}% de bônus no primeiro depósito:`, url: b.dataset.share }).catch(() => {});
  }));
  document.querySelectorAll('[data-depval]').forEach(b => (b.onclick = () => {
    const i = document.getElementById('depValor'); if (i) i.value = (b.dataset.depval / 100).toFixed(2).replace('.', ',');
  }));
  const df = document.getElementById('depForm');
  if (df) df.onsubmit = async e => {
    e.preventDefault();
    const v = reaisParaCentavos(document.getElementById('depValor').value);
    if (!(v > 0)) return toast('Escreva o valor do depósito.');
    const btn = df.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Gerando…';
    const out = await callServer('carteiraDepositar', { valor: v });
    btn.disabled = false; btn.textContent = 'Gerar Pix';
    if (!out) return;
    if (out.moeda === 'FICHA') { toast(`${brl(out.valor)} de teste na carteira.`); return loadCarteira(); }
    cart.dep = { id: out.id, valor: out.valor, qr: out.qr, qrBase64: out.qrBase64, expiraEm: out.expiraEm, status: 'aguardando' };
    renderCarteira();
    watchDeposito(out.id);
  };
  const ck = document.querySelector('[data-depcheck]');
  if (ck) ck.onclick = () => checkDeposito(true);
  const nw = document.querySelector('[data-depnew]');
  if (nw) nw.onclick = () => { stopCarteira(); cart.dep = null; renderCarteira(); };
  const sf = document.getElementById('saqForm');
  if (sf) sf.onsubmit = async e => {
    e.preventDefault();
    const v = reaisParaCentavos(document.getElementById('saqValor').value);
    if (!(v > 0)) return toast('Escreva o valor do saque.');
    const tarifa = r.tarifaSeSacarAgora || 0;
    if (!confirm(`Sacar ${brl(v)}${tarifa ? ` (tarifa ${brl(tarifa)}, você recebe ${brl(v - tarifa)})` : ''} para a chave Pix CPF ${r.cpf}? O valor sai do saldo agora.`)) return;
    const out = await callServer('carteiraSacar', { valor: v });
    if (out) { toast('Saque pedido. A organização vai fazer o Pix.'); loadCarteira(); }
  };
}

// acompanha um depósito: o aviso do banco atualiza o pedido; enquanto isso, confere a cada 6 s
function watchDeposito(id) {
  stopCarteira();
  cart.dep = cart.dep && cart.dep.id === id ? cart.dep : { id, status: 'aguardando' };
  cart.unsubDep = db.doc('depositosPix/' + id).onSnapshot(s => {
    if (!s.exists) return;
    const d = s.data();
    cart.dep = { id, ...d };
    if (d.status !== 'aguardando') {
      stopCarteira();
      if (d.status === 'creditado') toast(`Depósito de ${brl(d.valorPago || d.valor)} creditado!`, 5000);
      else if (d.status === 'devolver') toast('O Pix veio de outro CPF: não entrou no saldo e será devolvido.', 7000);
      else if (d.status === 'conferir') toast('Pix recebido. A organização vai conferir e liberar.', 6000);
      cart.dep = null;
      loadCarteira();
    } else renderCarteira();
  }, () => {});
  let n = 0;
  cart.poll = setInterval(() => { if (++n > 300) return stopCarteira(); checkDeposito(false); }, 6000);
}
async function checkDeposito(manual) {
  if (!cart.dep) return;
  const out = await callServer('carteiraConferirDeposito', { id: cart.dep.id }, { quiet: !manual });
  if (manual && out && out.status === 'aguardando') toast('O pagamento ainda não chegou. Pode levar alguns segundos.');
}

/* ---------------- painel da organização ---------------- */
async function loadBankAdmin() {
  const el = document.getElementById('bankAdmin'); if (!el) return;
  if (!fns || !account || typeof isOrg !== 'function' || !isOrg()) { el.hidden = true; stopMpVivo(); return; }
  el.hidden = false;
  const out = await callServer('adminPainel', {}, { quiet: true });
  cart.admin = out; renderBankAdmin();
  if (out && out.config) watchMpVivo(out.config.moeda);
}

/* ---------- saldo no Mercado Pago ao vivo ----------
   O Mercado Pago não deixa o site ler o saldo da conta. Mas todo centavo que entra
   ou sai passa pelo livro-caixa, e a conta "custodia" é o que deveria estar lá.
   Aqui o painel escuta os saldos do livro-caixa e muda na hora, sem recarregar. */
const mpVivo = { moeda: null, unsub: null, contas: null, at: 0, ultimo: null, erro: false };
function stopMpVivo() {
  if (mpVivo.unsub) mpVivo.unsub();
  Object.assign(mpVivo, { moeda: null, unsub: null, contas: null, at: 0, ultimo: null, erro: false });
}
function watchMpVivo(moeda) {
  // lê direto do Firestore: os saldos são gravados pelo servidor, fora do formato do db do site
  if (typeof firebase === 'undefined' || !firebase.apps.length || !moeda || (mpVivo.unsub && mpVivo.moeda === moeda)) { renderMpVivo(); return; }
  stopMpVivo();
  mpVivo.moeda = moeda;
  mpVivo.unsub = firebase.firestore().collection('saldos').where('moeda', '==', moeda).onSnapshot(qs => {
    const contas = {}; let at = 0;
    qs.forEach(d => { const x = d.data(); contas[x.conta] = x.saldo || 0; at = Math.max(at, x.atualizadoEm || 0); });
    mpVivo.contas = contas; mpVivo.at = at; mpVivo.erro = false;
    renderMpVivo();
  }, () => { mpVivo.erro = true; renderMpVivo(); });
}
function mpVivoResumo(contas) {
  const r = { custodia: 0, jogadores: 0, potes: 0, reservado: 0, devolver: 0, capital: 0, receita: 0, taxas: 0, promocoes: 0 };
  for (const [c, v] of Object.entries(contas)) {
    if (c.startsWith('jogador:')) r.jogadores += v;
    else if (c.startsWith('pote:')) r.potes += v;
    else if (c === 'saque:reservado') r.reservado += v;
    else if (c in r) r[c] += v;
  }
  r.lucro = r.receita - r.taxas - r.promocoes;            // o que a casa ganhou e ainda não tirou
  r.livre = r.capital + r.lucro;                           // dá para tirar sem mexer no dos jogadores
  r.soma = r.jogadores + r.potes + r.reservado + r.devolver + r.capital + r.lucro;
  return r;
}
// O Mercado Pago credita rendimento do saldo parado por conta própria, então o app mostra
// um pouco mais que o livro-caixa. O dono digita o saldo do app e a diferença vira rendimento.
async function acertarRendimento() {
  const inp = document.getElementById('mpApp');
  const app = reaisParaCentavos(inp && inp.value);
  if (!(app >= 0) || !inp.value.trim()) return toast('Escreva o saldo que aparece no app do Mercado Pago.');
  if (!mpVivo.contas) return toast('Espere o saldo ao vivo carregar.');
  const dif = app - mpVivoResumo(mpVivo.contas).custodia;
  if (dif === 0) return toast('Está batendo certinho.');
  if (dif < 0) return toast(`O app mostra ${brl(-dif)} a menos que o site. Isso não é rendimento: confira se alguma retirada ou saque ficou sem registrar.`, 8000);
  if (!confirm(`O app tem ${brl(dif)} a mais. Registrar ${brl(dif)} como rendimento do Mercado Pago?`)) return;
  const out = await callServer('adminCaixa', { tipo: 'rendimento', valor: dif, motivo: 'acerto com o app' });
  if (out) { inp.value = ''; toast(`Rendimento de ${brl(dif)} registrado.`); }
}
function renderMpVivo() {
  const el = document.getElementById('mpVivo'); if (!el) return;
  if (mpVivo.erro) { el.innerHTML = '<p class="muted" style="margin:0">Não consegui ler o saldo ao vivo (as regras novas do Firebase já foram publicadas?).</p>'; return; }
  if (!mpVivo.contas) { el.innerHTML = '<p class="muted" style="margin:0">Ligando o saldo ao vivo…</p>'; return; }
  const r = mpVivoResumo(mpVivo.contas), teste = mpVivo.moeda === 'FICHA';
  const mudou = mpVivo.ultimo != null && mpVivo.ultimo !== r.custodia;
  mpVivo.ultimo = r.custodia;
  const linha = (t, v, cls = '') => `<tr><td>${t}</td><td class="${cls}">${brl(v)}</td></tr>`;
  el.innerHTML = `
    <p class="muted" style="margin:0"><span class="live-dot" aria-hidden="true"></span> Saldo no Mercado Pago, ao vivo${teste ? ' · modo fichas (teste)' : ''}</p>
    <p class="mp-total${mudou ? ' flash' : ''}" aria-live="polite">${brl(r.custodia)}</p>
    <table class="ledger"><tbody>
      ${linha('Dos jogadores (saldos)', r.jogadores)}
      ${r.potes ? linha('Em mesas jogando agora', r.potes) : ''}
      ${linha('Saques a pagar', r.reservado)}
      ${r.devolver ? linha('A devolver (Pix de outro CPF)', r.devolver) : ''}
      ${linha('Caixa da casa', r.capital)}
      ${linha('Lucro da casa ainda não retirado', r.lucro, r.lucro < 0 ? 'neg' : '')}
      <tr><td><b>Seu, pode tirar sem mexer no dos jogadores</b></td><td class="${r.livre < 0 ? 'neg' : 'pos'}"><b>${brl(r.livre)}</b></td></tr>
    </tbody></table>
    ${r.soma !== r.custodia ? `<p class="neg" style="margin:0;font-size:13px">As partes somam ${brl(r.soma)}, diferente do total. Toque em “Conferir agora”.</p>` : ''}
    <small class="muted">${mpVivo.at ? `Último movimento ${quando(mpVivo.at)}. ` : ''}Calculado pelo livro-caixa do site. Se o app do Mercado Pago mostrar <b>menos</b> que isso, avise.</small>`;
}
// abas do painel: Banco (o dia a dia) e Lucros (o que a casa ganhou)
const bankTabs = () => `<div class="seg two" role="tablist" aria-label="Banco">${[['banco', 'Banco'], ['lucros', 'Lucros']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${(cart.bankTab || 'banco') === k}" data-btab="${k}">${t}</button>`).join('')}</div>`;
function bindBankTabs(el) {
  el.querySelectorAll('[data-btab]').forEach(b => (b.onclick = () => {
    cart.bankTab = b.dataset.btab;
    if (cart.bankTab === 'lucros') loadLucros(); else renderBankAdmin();
  }));
}
async function loadLucros() {
  cart.lucros = null; renderBankAdmin();
  cart.lucros = await callServer('adminLucros', {}, { quiet: true });
  renderBankAdmin();
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
function renderLucros(el) {
  const L = cart.lucros, dono = isOrg(); // dono e organizadores mexem
  if (!L) { el.innerHTML = `<h2>Banco (organização)</h2>${bankTabs()}<p class="muted">Carregando…</p>`; bindBankTabs(el); return; }
  const t = L.total, cor = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  el.innerHTML = `<h2>Banco (organização)</h2>${bankTabs()}
    <div class="pay-row" style="display:block">
      <p class="muted" style="margin:0 0 4px">Lucro da casa (desde o começo)${L.moeda === 'FICHA' ? ' · modo fichas (teste)' : ''}</p>
      <p class="pay-amount ${cor(t.lucro)}" style="margin:0">${brl(t.lucro)}</p>
      <p class="muted" style="font-size:13px;margin:6px 0 0">Receita ${brl(t.ganhos)} − taxas bancárias ${brl(t.taxas)} − bônus ${brl(t.promocoes || 0)}</p>
    </div>
    <table class="ledger"><tbody>
      <tr><td>Taxa das partidas (${String(L.taxaPartida).replace('.', ',')}% · ${t.mesas} ${t.mesas === 1 ? 'mesa' : 'mesas'})</td><td class="pos">${brl(t.partidas)}</td></tr>
      <tr><td>Tarifas de saque</td><td class="pos">${brl(t.tarifas)}</td></tr>
      ${t.rendimentos ? `<tr><td>Rendimento do Mercado Pago</td><td class="pos">${brl(t.rendimentos)}</td></tr>` : ''}
      <tr><td><b>Receita</b></td><td><b>${brl(t.ganhos)}</b></td></tr>
      <tr><td>Taxas bancárias (Pix recebidos)</td><td class="neg">− ${brl(t.taxas)}</td></tr>
      <tr><td>Bônus dados (indicação)</td><td class="neg">− ${brl(t.promocoes || 0)}</td></tr>
      <tr><td><b>Lucro</b></td><td class="${cor(t.lucro)}"><b>${brl(t.lucro)}</b></td></tr>
      <tr><td>Já retirado por você</td><td>− ${brl(t.retirado)}</td></tr>
      <tr><td>Reinvestido no caixa da casa</td><td>− ${brl(t.reinvestido)}</td></tr>
      <tr><td><b>Disponível para retirar</b></td><td class="${cor(t.disponivel)}"><b>${brl(t.disponivel)}</b></td></tr>
    </tbody></table>
    ${dono ? `<div class="row">
      <label style="flex:1 1 120px">Valor (R$)<input id="lcValor" inputmode="decimal" placeholder="${(Math.max(0, t.disponivel) / 100).toFixed(2).replace('.', ',')}"></label>
      <label style="flex:2 1 160px">Observação<input id="lcMotivo" maxlength="120" placeholder="opcional"></label>
    </div>
    <div class="row"><button class="small primary" data-lc="retirar">Retirar lucro</button><button class="small" data-lc="reinvestir">Reinvestir no caixa</button></div>
    <p class="muted" style="font-size:12px">Retirar lucro = você transferiu esse valor da conta do Mercado Pago para você. Reinvestir = o valor fica no Mercado Pago como caixa da casa, para garantir saques ou dar saldo.</p>` : ''}
    <h3>Por mês</h3>
    ${L.meses.length ? `<table class="ledger"><thead><tr><td>Mês</td><td>Receita</td><td>Taxas + bônus</td><td>Lucro</td></tr></thead><tbody>${L.meses.map(m => `<tr><td>${nomeMes(m.mes)}</td><td>${brl(m.ganhos)}</td><td>${brl(m.taxas + (m.promocoes || 0))}</td><td class="${cor(m.lucro)}">${brl(m.lucro)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ainda não tem movimento.</p>'}`;
  bindBankTabs(el);
  el.querySelectorAll('[data-lc]').forEach(b => (b.onclick = async () => {
    const v = reaisParaCentavos(document.getElementById('lcValor').value), retirar = b.dataset.lc === 'retirar';
    if (!(v > 0)) return toast('Escreva o valor.');
    if (!confirm(retirar ? `Registrar que você tirou ${brl(v)} de lucro da conta do Mercado Pago?` : `Passar ${brl(v)} do lucro para o caixa da casa?`)) return;
    const out = await callServer('adminCaixa', { tipo: retirar ? 'lucro' : 'receita', valor: v, motivo: document.getElementById('lcMotivo').value.trim() });
    if (out) { toast(retirar ? 'Retirada registrada.' : 'Reinvestido no caixa.'); loadLucros(); loadBankAdmin(); }
  }));
}
function renderBankAdmin() {
  const el = document.getElementById('bankAdmin'); if (!el || el.hidden) return;
  if (cart.bankTab === 'lucros') return renderLucros(el);
  const a = cart.admin;
  if (!a) { el.innerHTML = '<h2>Banco (organização)</h2><p class="muted">Carregando…</p>'; return; }
  const c = a.conferencia, cfg = a.config, teste = cfg.moeda === 'FICHA';
  const dono = isOrg(); // dono e organizadores mexem nas configurações
  // seções fechadas até o dono abrir; lembra quais estavam abertas quando o painel se redesenha
  const folds = (cart.folds ||= new Set()), aberto = k => (folds.has(k) ? ' open' : '');
  const qtd = n => `<span class="fold-n${n ? ' tem' : ''}">${n}</span>`;
  el.innerHTML = `<h2>Banco (organização)</h2>${bankTabs()}
    <div class="conf mp-vivo"><div id="mpVivo"></div>
      ${dono ? `<div class="row" style="align-items:flex-end">
        <label style="flex:1 1 150px">Saldo que o app do Mercado Pago mostra<input id="mpApp" inputmode="decimal" placeholder="0,00"></label>
        <button class="small" data-mpapp>Acertar rendimento</button>
      </div>` : ''}
    </div>
    <div class="conf ${c.ok ? 'ok' : 'bad'}">
      <b>${c.ok ? 'Contas batendo' : 'As contas NÃO batem — saques suspensos'}</b>
      <span>Em custódia <b>${brl(c.custodia)}</b> · saldos dos jogadores <b>${brl(c.jogadores)}</b> · saques a pagar <b>${brl(c.reservado)}</b> · receita <b>${brl(c.receita)}</b> · caixa da casa <b>${brl(c.capital || 0)}</b> · taxas bancárias <b>${brl(c.taxas)}</b></span>
      <small class="muted">${teste ? 'Modo de teste (saldo fictício).' : 'Reais (Mercado Pago).'} Conferido ${quando(c.at)}.</small>
      <div class="row"><button class="small" data-badm="conf">Conferir agora</button></div>
    </div>
    <details class="fold" data-fold="saques"${aberto('saques')}><summary>Saques para pagar ${qtd(a.saques.length)}</summary>
    ${a.saques.length ? a.saques.map(s => `<div class="pay-row owe">
        <div><b>${esc(s.name || s.key)}</b> pediu ${brl(s.valor)} → pagar <b>${brl(s.liquido)}</b><div class="muted" style="font-size:12px">${quando(s.criadoEm)}${s.tarifa ? ` · tarifa ${brl(s.tarifa)}` : ''}</div></div>
        <dl class="pix"><dt>Chave</dt><dd class="pix-key"><span class="key-text">CPF ${esc(s.cpf)}</span><button type="button" class="small primary" data-copy="${esc(s.cpf)}">Copiar</button></dd></dl>
        <div class="row"><input placeholder="ID da transação do Pix" data-txid="${esc(s.id)}" style="flex:1 1 160px"><button class="small primary" data-saqpago="${esc(s.id)}">Paguei</button><button class="small danger" data-saqrecusa="${esc(s.id)}">Recusar</button></div>
      </div>`).join('') : '<p class="muted">Nenhum saque esperando.</p>'}
    </details>
    <details class="fold" data-fold="depositos"${aberto('depositos')}><summary>Depósitos para conferir ${qtd(a.depositos.length)}</summary>
    ${a.depositos.length ? a.depositos.map(d => `<div class="pay-row">
        <div><b>${esc(d.name || d.key)}</b> ${brl(d.valorPago || d.valor)} · ${esc(STATUS_DEP[d.status] || d.status)}<div class="muted" style="font-size:12px">${quando(d.criadoEm)}${d.nomePagador ? ` · pagou: ${esc(d.nomePagador)}` : ''}${d.cpfPagador ? ` · CPF de quem pagou: ${esc(d.cpfPagador)}` : ''}</div></div>
        ${d.status === 'conferir'
          ? `<div class="row"><input placeholder="CPF de quem pagou (do extrato)" data-depcpf="${esc(d.id)}" style="flex:1 1 160px"><button class="small primary" data-depok="${esc(d.id)}">Conferir</button></div>`
          : `<div class="row"><input placeholder="ID do Pix de devolução" data-devtx="${esc(d.id)}" style="flex:1 1 160px"><button class="small" data-devok="${esc(d.id)}">Devolvido</button><button class="small primary" data-depcred="${esc(d.id)}">Era dele: creditar</button></div>`}
      </div>`).join('') : '<p class="muted">Nada para conferir.</p>'}
    </details>
    <details class="fold" data-fold="avisos"${aberto('avisos')}><summary>Avisos no Telegram</summary>
    ${avisosHtml(a.aviso || {})}
    </details>
    <details class="fold" data-fold="alertas"${aberto('alertas')}><summary>Alertas ${qtd(a.alertas.length)}</summary>
    ${a.alertas.length ? `<ul class="movs">${a.alertas.map(x => `<li><span>${esc(x.texto || x.tipo)}</span><button class="small" data-alerta="${esc(x.id)}">Visto</button><small class="muted">${quando(x.at)}</small></li>`).join('')}</ul>` : '<p class="muted">Nenhum alerta.</p>'}
    </details>
    <details class="fold" data-fold="extrato"${aberto('extrato')}><summary>Extrato de um jogador</summary>
    <div class="row"><input id="admExtUser" placeholder="Usuário" style="flex:1 1 140px"><button class="small" data-badm="ext">Ver</button></div>
    <div id="admExt"></div>
    </details>
    ${dono ? `<details class="fold" data-fold="caixa"${aberto('caixa')}><summary>Caixa da casa e dar saldo</summary>
      <p class="muted" style="font-size:13px">O <b>caixa da casa</b> é o seu dinheiro deixado no Mercado Pago para garantir os saques. Hoje: <b>${brl(c.capital || 0)}</b>. Para dar saldo a alguém (inclusive a você), o valor sai do caixa da casa.</p>
      <div class="row">
        <label style="flex:1 1 150px">Movimento<select id="cxTipo"><option value="entrada">Coloquei dinheiro no Mercado Pago</option><option value="retirada">Tirei dinheiro do Mercado Pago</option><option value="rendimento">Rendimento que o Mercado Pago creditou</option></select></label>
        <label style="flex:1 1 110px">Valor (R$)<input id="cxValor" inputmode="decimal" placeholder="0,00"></label>
        <label style="flex:2 1 160px">Observação<input id="cxMotivo" maxlength="120" placeholder="opcional"></label>
      </div>
      <div class="row"><button class="small primary" data-badm="caixa">Registrar no caixa</button></div>
      <div class="row">
        <label style="flex:1 1 140px">Usuário<input id="crUser" placeholder="ex.: benttin"></label>
        <label style="flex:1 1 110px">Valor (R$)<input id="crValor" inputmode="decimal" placeholder="0,00"></label>
        <label style="flex:2 1 160px">Motivo<input id="crMotivo" maxlength="120" placeholder="opcional"></label>
      </div>
      <div class="row"><button class="small primary" data-badm="creditar">Dar saldo</button></div>
    </details>` : ''}
    ${dono ? `<details class="fold" data-fold="convite"${aberto('convite')}><summary>Ligar convite</summary>
      <p class="muted" style="font-size:13px">Quando alguém entrou pelo convite mas não apareceu na lista de quem convidou. Só vale antes do primeiro depósito do convidado; o bônus entra quando ele depositar.</p>
      <div class="row">
        <label style="flex:1 1 140px">Convidado (usuário)<input id="liConvidado" autocapitalize="off" placeholder="ex.: borg3ss"></label>
        <label style="flex:1 1 140px">Quem convidou (usuário)<input id="liPor" autocapitalize="off" placeholder="ex.: benttin"></label>
      </div>
      <div class="row"><button class="small primary" data-badm="ligarconvite">Ligar convite</button></div>
    </details>` : ''}
    ${dono ? `<details class="fold" data-fold="config"${aberto('config')}><summary>Configuração</summary>
      <div class="row">
        <label style="flex:1 1 140px">Modo<select id="cfgMoeda"><option value="FICHA" ${teste ? 'selected' : ''}>Fichas (teste, saldo fictício)</option><option value="BRL" ${teste ? '' : 'selected'}>Reais (Mercado Pago)</option></select></label>
        ${[['depositoMinimo', 'Depósito mínimo'], ['saqueMinimo', 'Saque mínimo'], ['tarifaSaque', 'Tarifa de saque'], ['limiteDiarioDeposito', 'Limite diário de depósito'], ['limiteDiarioSaque', 'Limite diário de saque']].map(([k, t]) => `<label style="flex:1 1 140px">${t} (R$)<input data-cfg="${k}" inputmode="decimal" value="${((cfg[k] || 0) / 100).toFixed(2).replace('.', ',')}"></label>`).join('')}
        <label style="flex:1 1 100px">Saques por dia<input id="cfgSpd" inputmode="numeric" value="${cfg.saquesPorDia}"></label>
        <label style="flex:1 1 140px">Indicação: quem convida ganha (R$)<input data-cfg="indicacaoValor" inputmode="decimal" value="${((cfg.indicacaoValor ?? 2000) / 100).toFixed(2).replace('.', ',')}"></label>
        <label style="flex:1 1 120px">Bônus do convidado (% do 1º depósito)<input id="cfgBonusPct" inputmode="numeric" value="${cfg.bonusDepositoPct ?? 50}"></label>
        <label style="flex:1 1 120px">Jogar quantas vezes o bônus para sacar<input id="cfgRollover" inputmode="numeric" value="${cfg.rolloverX ?? 5}"></label>
        <label style="flex:1 1 140px"><span><input type="checkbox" id="cfgIndAtiva" ${cfg.indicacaoAtiva === false ? '' : 'checked'}> Indicação ligada</span></label>
        <label style="flex:1 1 100px">Taxa por partida (%)<input id="cfgTaxa" inputmode="decimal" value="${String(cfg.taxaPartida ?? 2).replace('.', ',')}"></label>
        <label style="flex:1 1 140px"><span><input type="checkbox" id="cfgBloq" ${cfg.saquesBloqueados ? 'checked' : ''}> Saques suspensos</span></label>
      </div>
      <div class="row"><button class="primary small" data-badm="cfg">Salvar configuração</button></div>
    </details>` : ''}`;
  bindBankAdmin();
  renderMpVivo();
  el.querySelectorAll('details[data-fold]').forEach(d => (d.ontoggle = () => (d.open ? folds.add(d.dataset.fold) : folds.delete(d.dataset.fold))));
  const mpBtn = el.querySelector('[data-mpapp]');
  if (mpBtn) mpBtn.onclick = acertarRendimento;
  // veio pelo link do WhatsApp: mostra o saque e já deixa o campo do ID do Pix pronto
  if (window.SAQUE_ALVO) {
    const alvo = el.querySelector(`[data-txid="${CSS.escape(window.SAQUE_ALVO)}"]`);
    if (alvo) { const f = alvo.closest('details'); if (f) { f.open = true; folds.add(f.dataset.fold); } alvo.closest('.pay-row')?.classList.add('destaque'); alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => alvo.focus(), 400); }
    else toast('Esse saque já foi resolvido ou não está mais esperando.', 6000);
    window.SAQUE_ALVO = null;
  }
}
// pedidos de saque no Telegram: cadastrar o bot (uma vez) e conectar o Telegram de cada organizador
function avisosHtml(v) {
  if (!v.bot) return `<details><summary>Receber os pedidos de saque no Telegram</summary>
      <ol class="muted" style="font-size:13px;padding-left:18px">
        <li>Instale o Telegram e abra a conversa com <a href="https://t.me/BotFather" target="_blank" rel="noopener"><b>@BotFather</b></a>.</li>
        <li>Mande <b>/newbot</b>, escolha um nome (ex.: Banco do Truco) e um usuário terminado em <b>bot</b> (ex.: bancodotruco_bot).</li>
        <li>Ele responde com o <b>token</b> (parecido com 123456789:AAH…). Copie e cole aqui.</li>
      </ol>
      <div class="row"><label style="flex:1 1 220px">Token do bot<input id="tgToken" autocomplete="off" spellcheck="false" placeholder="123456789:AAH..."></label></div>
      <div class="row"><button class="small primary" data-badm="tgbot">Salvar bot</button></div>
    </details>`;
  if (!v.conectado) return `<p class="muted" style="font-size:13px">Bot <b>@${esc(v.bot)}</b> cadastrado. Agora conecte o <b>seu</b> Telegram (cada organizador conecta o dele):</p>
      <div class="row"><button class="small primary" data-badm="tgconecta">1. Conectar meu Telegram</button><button class="small" data-badm="tgconfirma">2. Já toquei em Iniciar</button></div>
      <p class="muted" style="font-size:12px">O botão 1 abre o Telegram no bot: toque em <b>INICIAR</b> lá e volte aqui para o botão 2.</p>
      <div class="row"><button class="small" data-badm="tgtroca">Trocar o bot</button></div>`;
  return `<p class="muted" style="font-size:13px">Os pedidos de saque chegam no Telegram de <b>${esc(v.nome || '')}</b> pelo bot <b>@${esc(v.bot)}</b>, com nome, CPF e valor, e um link para marcar como pago.</p>
      <div class="row"><button class="small" data-badm="tgteste">Enviar teste</button><button class="small danger" data-badm="tgsai">Parar de receber</button></div>`;
}
function bindBankAdmin() {
  const el = document.getElementById('bankAdmin');
  bindBankTabs(el);
  const run = async (name, data, msg) => { const out = await callServer(name, data); if (out) { if (msg) toast(msg); loadBankAdmin(); loadCarteira(); } return out; };
  el.querySelectorAll('[data-saqpago]').forEach(b => (b.onclick = () => {
    const id = b.dataset.saqpago, tx = el.querySelector(`[data-txid="${id}"]`).value.trim();
    if (tx.length < 4) return toast('Cole o ID da transação do Pix que você fez.');
    run('adminSaque', { id, pago: true, txId: tx }, 'Saque marcado como pago.');
  }));
  el.querySelectorAll('[data-saqrecusa]').forEach(b => (b.onclick = () => {
    if (!confirm('Recusar este saque? O valor volta inteiro para o saldo do jogador.')) return;
    run('adminSaque', { id: b.dataset.saqrecusa, pago: false, motivo: 'recusado pela organização' }, 'Saque recusado; o valor voltou.');
  }));
  el.querySelectorAll('[data-depok]').forEach(b => (b.onclick = () => run('adminDeposito', { id: b.dataset.depok, cpfPagador: el.querySelector(`[data-depcpf="${b.dataset.depok}"]`).value }, 'Depósito conferido.')));
  el.querySelectorAll('[data-devok]').forEach(b => (b.onclick = () => run('adminDeposito', { id: b.dataset.devok, devolvidoTxId: el.querySelector(`[data-devtx="${b.dataset.devok}"]`).value.trim() }, 'Devolução registrada.')));
  el.querySelectorAll('[data-depcred]').forEach(b => (b.onclick = () => {
    if (!confirm('Você conferiu no extrato do Mercado Pago que esse Pix saiu de uma conta no CPF do jogador? O valor entra no saldo dele.')) return;
    run('adminDeposito', { id: b.dataset.depcred, creditar: true }, 'Depósito creditado ao jogador.');
  }));
  el.querySelectorAll('[data-alerta]').forEach(b => (b.onclick = () => run('adminAlerta', { id: b.dataset.alerta })));
  el.querySelectorAll('[data-badm]').forEach(b => (b.onclick = async () => {
    const a = b.dataset.badm;
    if (a === 'conf') return run('adminConferencia', {}, 'Conferência feita.');
    if (a === 'ext') {
      const out = await callServer('adminExtrato', { key: document.getElementById('admExtUser').value.trim() });
      if (!out) return;
      document.getElementById('admExt').innerHTML = `<p><b>${esc(out.key)}</b> · CPF ${esc(out.cpf || 'não cadastrado')} · saldo ${brl(out.saldo)} · depositou ${brl(out.depositado)} · jogou ${brl(out.apostado)}</p>
        <ul class="movs">${out.lancamentos.map(l => `<li><span>${esc(TIPO_LANC[l.tipo] || l.tipo)} <span class="muted">${esc(l.moeda)}</span></span><b>${l.linhas.map(x => `${x.lado} ${esc(x.conta)} ${brl(x.valor)}`).join(' / ')}</b><small class="muted">${quando(l.at)}</small></li>`).join('') || '<li><span class="muted">Sem lançamentos.</span></li>'}</ul>`;
      return;
    }
    if (a === 'tgbot' || a === 'tgtroca') {
      const token = a === 'tgtroca' ? prompt('Cole o token do novo bot (os organizadores vão precisar conectar de novo):') : document.getElementById('tgToken').value;
      if (!token) return;
      const out = await callServer('adminAvisos', { acao: 'bot', token: token.trim() });
      if (out) { toast(`Bot @${out.bot} cadastrado. Agora conecte o seu Telegram.`, 6000); loadBankAdmin(); }
      return;
    }
    if (a === 'tgconecta') {
      const w = window.open('', '_blank');
      const out = await callServer('adminAvisos', { acao: 'conectar' });
      if (!out) { if (w) w.close(); return; }
      if (w) w.location.href = out.link; else location.href = out.link;
      return toast('No Telegram, toque em INICIAR e depois volte aqui e toque em "Já toquei em Iniciar".', 8000);
    }
    if (a === 'tgconfirma') {
      const out = await callServer('adminAvisos', { acao: 'confirmar' });
      if (out) { toast(`Telegram de ${out.nome} conectado. Chegou uma mensagem lá.`, 6000); loadBankAdmin(); }
      return;
    }
    if (a === 'tgteste') {
      const t = await callServer('adminAvisos', { acao: 'teste' });
      return t && toast(t.ok ? 'Teste enviado. Confira o Telegram.' : `O teste não chegou${t.resposta ? ': ' + t.resposta : ''}.`, 7000);
    }
    if (a === 'tgsai') {
      if (!confirm('Parar de receber os pedidos de saque no Telegram?')) return;
      return run('adminAvisos', { acao: 'sair' }, 'Você não vai mais receber os avisos.');
    }
    if (a === 'caixa') {
      const v = reaisParaCentavos(document.getElementById('cxValor').value), tipo = document.getElementById('cxTipo').value;
      if (!(v > 0)) return toast('Escreva o valor.');
      const txt = { entrada: 'entrou no Mercado Pago', retirada: 'saiu do Mercado Pago', receita: 'vai da receita para o caixa', rendimento: 'de rendimento entrou no Mercado Pago' }[tipo];
      if (!confirm(`Confirma: ${brl(v)} ${txt}?`)) return;
      return run('adminCaixa', { tipo, valor: v, motivo: document.getElementById('cxMotivo').value.trim() }, 'Caixa atualizado.');
    }
    if (a === 'ligarconvite') {
      const convidado = document.getElementById('liConvidado').value.trim(), por = document.getElementById('liPor').value.trim();
      if (!convidado || !por) return toast('Escreva os dois usuários.');
      const out = await callServer('adminIndicacao', { convidado, por });
      if (out) toast(`Pronto: ${convidado} agora aparece como convidado de ${out.nomePor}.`, 6000);
      return;
    }
    if (a === 'creditar') {
      const v = reaisParaCentavos(document.getElementById('crValor').value), key = document.getElementById('crUser').value.trim();
      if (!key || !(v > 0)) return toast('Escreva o usuário e o valor.');
      if (!confirm(`Dar ${brl(v)} de saldo para ${key}? O valor sai do caixa da casa.`)) return;
      return run('adminCreditar', { key, valor: v, motivo: document.getElementById('crMotivo').value.trim() }, 'Saldo adicionado.');
    }
    if (a === 'cfg') {
      const novo = { moeda: document.getElementById('cfgMoeda').value, saquesPorDia: Number(document.getElementById('cfgSpd').value), saquesBloqueados: document.getElementById('cfgBloq').checked, taxaPartida: Number(document.getElementById('cfgTaxa').value.replace(',', '.')), bonusDepositoPct: Number(document.getElementById('cfgBonusPct').value), rolloverX: Number(document.getElementById('cfgRollover').value), indicacaoAtiva: document.getElementById('cfgIndAtiva').checked };
      el.querySelectorAll('[data-cfg]').forEach(i => (novo[i.dataset.cfg] = reaisParaCentavos(i.value)));
      if (novo.moeda === 'BRL' && cart.admin.config.moeda !== 'BRL' && !confirm('Ligar o dinheiro de verdade? A partir daqui os depósitos são Pix reais pelo Mercado Pago.')) return;
      run('adminConfig', novo, 'Configuração salva.');
    }
  }));
}
