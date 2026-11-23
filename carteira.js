/* =========================================================
   CARTEIRA (saldo em reais, ou fictício no modo fichas)
   Depósito por Pix (Mercado Pago) e saque pedido aqui; a organização paga o
   saque e confere tudo no painel. Quem mexe no saldo é só o servidor
   (functions/lib/carteira-server.js); esta tela só pede e mostra.
   Carregado antes do código principal: usa callServer, fns, db, account, esc, toast...
   ========================================================= */
const cart = { r: null, tab: 'depositar', dep: null, unsubDep: null, poll: null, admin: null, extrato: null };
try { const t = localStorage.getItem('truco.carteiraTab'); if (['depositar', 'sacar', 'extrato'].includes(t)) cart.tab = t; } catch {}

const brl = c => 'R$ ' + ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moedaTxt = (c, moeda) => (moeda === 'FICHA' ? `${brl(c)} <small class="muted">(teste)</small>` : brl(c));
const reaisParaCentavos = s => {
  const n = Number(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const quando = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS_DEP = { aguardando: 'esperando o Pix', creditado: 'creditado', conferir: 'a organização vai conferir', devolver: 'pago por outro CPF: será devolvido', devolvido: 'devolvido', expirado: 'expirou', cancelado: 'cancelado', erro: 'erro ao gerar', criando: 'gerando' };
const STATUS_SAQ = { pendente: 'esperando pagamento', pago: 'pago', recusado: 'recusado (valor voltou)' };
const TIPO_LANC = { deposito: 'Depósito', 'saque-pedido': 'Saque pedido', 'saque-estornado': 'Saque recusado (estorno)', 'saque-pago': 'Saque pago', 'taxa-bancaria': 'Taxa bancária', 'credito-da-casa': 'Saldo dado pela casa', 'entrada-mesa': 'Entrada de mesa', 'premio-mesa': 'Prêmio de mesa', 'devolucao-mesa': 'Entrada devolvida' };

function stopCarteira() {
  if (cart.unsubDep) cart.unsubDep();
  clearInterval(cart.poll);
  cart.unsubDep = null; cart.poll = null;
}

async function loadCarteira() {
  const el = document.getElementById('walletPanel'); if (!el) return;
  if (!fns || !account) { cart.r = null; renderCarteira(); return; }
  const r = await callServer('carteiraResumo', {}, { quiet: true });
  cart.r = r; renderCarteira();
  if (r && r.regras && r.regras.taxaPartida != null) {
    window.TAXA_PARTIDA = r.regras.taxaPartida;
    const t = document.getElementById('taxaPartida'); if (t) t.textContent = String(r.regras.taxaPartida).replace('.', ',');
  }
  const pend = r && r.depositos.find(d => d.status === 'aguardando' && (!d.expiraEm || d.expiraEm > Date.now()));
  if (pend && (!cart.dep || cart.dep.id !== pend.id)) watchDeposito(pend.id);
}

function renderCarteira() {
  const el = document.getElementById('walletPanel'); if (!el) return;
  if (!fns) { el.innerHTML = '<h2>Carteira</h2><p class="muted">A carteira só funciona no site publicado (com o servidor).</p>'; return; }
  if (!account) { el.innerHTML = '<h2>Carteira</h2><p class="muted">Entre com seu usuário para ver seu saldo.</p>'; return; }
  const r = cart.r;
  if (!r) { el.innerHTML = '<h2>Carteira</h2><p class="muted">Carregando…</p>'; return; }
  const teste = r.moeda === 'FICHA';
  if (!r.cpf) {
    el.innerHTML = `<h2>Carteira</h2>
      ${teste ? '<p class="tag">modo de teste: saldo fictício</p>' : ''}
      <p class="muted">Para depositar e sacar, cadastre seu CPF (uma conta por CPF, só maiores de 18 anos). O saque vai sempre para a chave Pix do seu CPF.</p>
      <form id="cpfForm" class="row" novalidate>
        <label style="flex:2 1 160px">CPF<input id="cpfNum" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label>
        <label style="flex:1 1 140px">Nascimento<input id="cpfNasc" type="date"></label>
        <div class="row" style="flex:1 1 100%"><button class="primary" type="submit">Cadastrar CPF</button></div>
      </form>`;
    document.getElementById('cpfForm').onsubmit = async e => {
      e.preventDefault();
      const out = await callServer('carteiraCpf', { cpf: document.getElementById('cpfNum').value, nascimento: document.getElementById('cpfNasc').value });
      if (out) { toast('CPF cadastrado.'); loadCarteira(); }
    };
    return;
  }
  const tabs = [['depositar', 'Depositar'], ['sacar', 'Sacar'], ['extrato', 'Extrato']];
  let body = '';
  if (cart.tab === 'depositar') body = depositoHtml(r);
  else if (cart.tab === 'sacar') body = saqueHtml(r);
  else body = extratoHtml(r);
  el.innerHTML = `<h2>Carteira</h2>
    <div class="wallet"><b>${moedaTxt(r.saldo, r.moeda)}</b><span class="muted">${teste ? 'modo de teste: saldo fictício, não vale dinheiro' : `CPF ${esc(r.cpf)}`}</span></div>
    <div class="seg" role="tablist" aria-label="Carteira">${tabs.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === cart.tab}" data-ctab="${k}">${t}</button>`).join('')}</div>
    ${body}`;
  el.querySelectorAll('[data-ctab]').forEach(b => (b.onclick = () => {
    cart.tab = b.dataset.ctab;
    try { localStorage.setItem('truco.carteiraTab', cart.tab); } catch {}
    if (cart.tab === 'extrato') loadExtrato(); else renderCarteira();
  }));
  bindCarteira(r);
}

function depositoHtml(r) {
  const d = cart.dep;
  if (d && d.status === 'aguardando') {
    return `<div class="pixbox">
      <p><b>Pague ${brl(d.valor)} pelo Pix</b> — o saldo entra sozinho assim que o banco confirmar.</p>
      ${d.qrBase64 ? `<img class="pixqr" alt="QR Code do Pix" src="data:image/png;base64,${esc(d.qrBase64)}">` : ''}
      ${d.qr ? `<div class="pix-key"><span class="key-text pixcode">${esc(d.qr)}</span><button type="button" class="small primary" data-copy="${esc(d.qr)}">Copiar Pix</button></div>` : ''}
      <p class="muted" style="font-size:13px">Pague <b>com uma conta no seu CPF</b>: Pix de outro CPF não entra no saldo e é devolvido. ${d.expiraEm ? `Vale até ${quando(d.expiraEm)}.` : ''}</p>
      <p class="muted" id="depStatus">Esperando o pagamento…</p>
      <div class="row"><button class="small" data-depcheck>Já paguei, conferir</button><button class="small" data-depnew>Novo depósito</button></div>
    </div>`;
  }
  const min = r.regras.depositoMinimo;
  const recentes = r.depositos.filter(x => x.status !== 'criando').slice(0, 5);
  return `<p class="muted" style="font-size:13px">Depósito mínimo de ${brl(min)}. O Pix tem de sair de uma conta no seu CPF.</p>
    <form id="depForm" class="row" novalidate>
      <label style="flex:1 1 140px">Valor (R$)<input id="depValor" inputmode="decimal" placeholder="${(min / 100).toFixed(2).replace('.', ',')}"></label>
      <div class="row" style="flex:1 1 100%"><button class="primary" type="submit">Gerar Pix</button></div>
    </form>
    ${recentes.length ? `<h3>Últimos depósitos</h3><ul class="movs">${recentes.map(x => `<li><span>${brl(x.valor)}</span><b class="${x.status === 'creditado' ? 'pos' : x.status === 'devolver' ? 'neg' : 'muted'}">${esc(STATUS_DEP[x.status] || x.status)}</b><small class="muted">${quando(x.criadoEm)}</small></li>`).join('')}</ul>` : ''}`;
}

function saqueHtml(r) {
  const bloq = r.regras.saquesBloqueados;
  const recentes = r.saques.slice(0, 5);
  return `${bloq ? '<p class="form-error">Saques suspensos temporariamente para conferência.</p>' : ''}
    <p class="muted" style="font-size:13px">O Pix vai para a chave <b>CPF ${esc(r.cpf)}</b> (o seu cadastro). ${r.regras.saquesPorDia} saque por dia, mínimo de ${brl(r.regras.saqueMinimo)}. O valor sai do saldo na hora e a organização faz o Pix.
    ${r.tarifaSeSacarAgora ? `<br>Tarifa de ${brl(r.tarifaSeSacarAgora)}: sem custo quando você já tiver jogado em entradas o valor que depositou.` : '<br>Sem tarifa.'}</p>
    <form id="saqForm" class="row" novalidate>
      <label style="flex:1 1 140px">Valor (R$)<input id="saqValor" inputmode="decimal" placeholder="0,00" ${bloq ? 'disabled' : ''}></label>
      <div class="row" style="flex:1 1 100%"><button class="primary" type="submit" ${bloq ? 'disabled' : ''}>Pedir saque</button></div>
    </form>
    ${recentes.length ? `<h3>Seus saques</h3><ul class="movs">${recentes.map(x => `<li><span>${brl(x.valor)}${x.tarifa ? ` <span class="muted">(recebe ${brl(x.liquido)})</span>` : ''}</span><b class="${x.status === 'pago' ? 'pos' : 'muted'}">${esc(STATUS_SAQ[x.status] || x.status)}</b><small class="muted">${quando(x.criadoEm)}</small></li>`).join('')}</ul>` : ''}`;
}

function extratoHtml() {
  const ex = cart.extrato;
  if (!ex) return '<p class="muted">Carregando…</p>';
  if (!ex.length) return '<p class="muted">Nenhum movimento ainda.</p>';
  return `<ul class="movs">${ex.map(l => `<li><span>${esc(TIPO_LANC[l.tipo] || l.tipo)}</span><b class="${l.valor >= 0 ? 'pos' : 'neg'}">${l.valor >= 0 ? '+' : '−'}${brl(Math.abs(l.valor))}</b><small class="muted">${quando(l.at)}${l.moeda === 'FICHA' ? ' · teste' : ''}</small></li>`).join('')}</ul>`;
}
async function loadExtrato() {
  cart.extrato = null; renderCarteira();
  const out = await callServer('carteiraExtrato', {}, { quiet: true });
  cart.extrato = (out && out.lancamentos.filter(l => l.valor)) || [];
  renderCarteira();
}

function bindCarteira(r) {
  const df = document.getElementById('depForm');
  if (df) df.onsubmit = async e => {
    e.preventDefault();
    const v = reaisParaCentavos(document.getElementById('depValor').value);
    if (!(v > 0)) return toast('Escreva o valor do depósito.');
    const btn = df.querySelector('button'); btn.disabled = true; btn.textContent = 'Gerando…';
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
  if (!fns || !account || typeof isOrg !== 'function' || !isOrg()) { el.hidden = true; return; }
  el.hidden = false;
  const out = await callServer('adminPainel', {}, { quiet: true });
  cart.admin = out; renderBankAdmin();
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
      <p class="muted" style="font-size:13px;margin:6px 0 0">Receita ${brl(t.ganhos)} − taxas bancárias ${brl(t.taxas)}</p>
    </div>
    <table class="ledger"><tbody>
      <tr><td>Taxa das partidas (${String(L.taxaPartida).replace('.', ',')}% · ${t.mesas} ${t.mesas === 1 ? 'mesa' : 'mesas'})</td><td class="pos">${brl(t.partidas)}</td></tr>
      <tr><td>Tarifas de saque</td><td class="pos">${brl(t.tarifas)}</td></tr>
      <tr><td><b>Receita</b></td><td><b>${brl(t.ganhos)}</b></td></tr>
      <tr><td>Taxas bancárias (Pix recebidos)</td><td class="neg">− ${brl(t.taxas)}</td></tr>
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
    ${L.meses.length ? `<table class="ledger"><thead><tr><td>Mês</td><td>Receita</td><td>Taxas</td><td>Lucro</td></tr></thead><tbody>${L.meses.map(m => `<tr><td>${nomeMes(m.mes)}</td><td>${brl(m.ganhos)}</td><td>${brl(m.taxas)}</td><td class="${cor(m.lucro)}">${brl(m.lucro)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ainda não tem movimento.</p>'}`;
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
  el.innerHTML = `<h2>Banco (organização)</h2>${bankTabs()}
    <div class="conf ${c.ok ? 'ok' : 'bad'}">
      <b>${c.ok ? 'Contas batendo' : 'As contas NÃO batem — saques suspensos'}</b>
      <span>Em custódia <b>${brl(c.custodia)}</b> · saldos dos jogadores <b>${brl(c.jogadores)}</b> · saques a pagar <b>${brl(c.reservado)}</b> · receita <b>${brl(c.receita)}</b> · caixa da casa <b>${brl(c.capital || 0)}</b> · taxas bancárias <b>${brl(c.taxas)}</b></span>
      <small class="muted">${teste ? 'Modo de teste (saldo fictício).' : 'Reais (Mercado Pago).'} Conferido ${quando(c.at)}.</small>
      <div class="row"><button class="small" data-badm="conf">Conferir agora</button></div>
    </div>
    <h3>Saques para pagar (${a.saques.length})</h3>
    ${a.saques.length ? a.saques.map(s => `<div class="pay-row owe">
        <div><b>${esc(s.name || s.key)}</b> pediu ${brl(s.valor)} → pagar <b>${brl(s.liquido)}</b><div class="muted" style="font-size:12px">${quando(s.criadoEm)}${s.tarifa ? ` · tarifa ${brl(s.tarifa)}` : ''}</div></div>
        <dl class="pix"><dt>Chave</dt><dd class="pix-key"><span class="key-text">CPF ${esc(s.cpf)}</span><button type="button" class="small primary" data-copy="${esc(s.cpf)}">Copiar</button></dd></dl>
        <div class="row"><input placeholder="ID da transação do Pix" data-txid="${esc(s.id)}" style="flex:1 1 160px"><button class="small primary" data-saqpago="${esc(s.id)}">Paguei</button><button class="small danger" data-saqrecusa="${esc(s.id)}">Recusar</button></div>
      </div>`).join('') : '<p class="muted">Nenhum saque esperando.</p>'}
    <h3>Depósitos para conferir</h3>
    ${a.depositos.length ? a.depositos.map(d => `<div class="pay-row">
        <div><b>${esc(d.name || d.key)}</b> ${brl(d.valorPago || d.valor)} · ${esc(STATUS_DEP[d.status] || d.status)}<div class="muted" style="font-size:12px">${quando(d.criadoEm)}${d.nomePagador ? ` · pagou: ${esc(d.nomePagador)}` : ''}${d.cpfPagador ? ` · CPF de quem pagou: ${esc(d.cpfPagador)}` : ''}</div></div>
        ${d.status === 'conferir'
          ? `<div class="row"><input placeholder="CPF de quem pagou (do extrato)" data-depcpf="${esc(d.id)}" style="flex:1 1 160px"><button class="small primary" data-depok="${esc(d.id)}">Conferir</button></div>`
          : `<div class="row"><input placeholder="ID do Pix de devolução" data-devtx="${esc(d.id)}" style="flex:1 1 160px"><button class="small" data-devok="${esc(d.id)}">Devolvido</button><button class="small primary" data-depcred="${esc(d.id)}">Era dele: creditar</button></div>`}
      </div>`).join('') : '<p class="muted">Nada para conferir.</p>'}
    <h3>Alertas (${a.alertas.length})</h3>
    ${a.alertas.length ? `<ul class="movs">${a.alertas.map(x => `<li><span>${esc(x.texto || x.tipo)}</span><button class="small" data-alerta="${esc(x.id)}">Visto</button><small class="muted">${quando(x.at)}</small></li>`).join('')}</ul>` : '<p class="muted">Nenhum alerta.</p>'}
    <h3>Extrato de um jogador</h3>
    <div class="row"><input id="admExtUser" placeholder="Usuário" style="flex:1 1 140px"><button class="small" data-badm="ext">Ver</button></div>
    <div id="admExt"></div>
    ${dono ? `<details><summary>Caixa da casa e dar saldo (organização)</summary>
      <p class="muted" style="font-size:13px">O <b>caixa da casa</b> é o seu dinheiro deixado no Mercado Pago para garantir os saques. Hoje: <b>${brl(c.capital || 0)}</b>. Para dar saldo a alguém (inclusive a você), o valor sai do caixa da casa.</p>
      <div class="row">
        <label style="flex:1 1 150px">Movimento<select id="cxTipo"><option value="entrada">Coloquei dinheiro no Mercado Pago</option><option value="retirada">Tirei dinheiro do Mercado Pago</option></select></label>
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
    ${dono ? `<details><summary>Configuração (organização)</summary>
      <div class="row">
        <label style="flex:1 1 140px">Modo<select id="cfgMoeda"><option value="FICHA" ${teste ? 'selected' : ''}>Fichas (teste, saldo fictício)</option><option value="BRL" ${teste ? '' : 'selected'}>Reais (Mercado Pago)</option></select></label>
        ${[['depositoMinimo', 'Depósito mínimo'], ['saqueMinimo', 'Saque mínimo'], ['tarifaSaque', 'Tarifa de saque'], ['limiteDiarioDeposito', 'Limite diário de depósito'], ['limiteDiarioSaque', 'Limite diário de saque']].map(([k, t]) => `<label style="flex:1 1 140px">${t} (R$)<input data-cfg="${k}" inputmode="decimal" value="${((cfg[k] || 0) / 100).toFixed(2).replace('.', ',')}"></label>`).join('')}
        <label style="flex:1 1 100px">Saques por dia<input id="cfgSpd" inputmode="numeric" value="${cfg.saquesPorDia}"></label>
        <label style="flex:1 1 100px">Taxa por partida (%)<input id="cfgTaxa" inputmode="decimal" value="${String(cfg.taxaPartida ?? 2).replace('.', ',')}"></label>
        <label style="flex:1 1 140px"><span><input type="checkbox" id="cfgBloq" ${cfg.saquesBloqueados ? 'checked' : ''}> Saques suspensos</span></label>
      </div>
      <div class="row"><button class="primary small" data-badm="cfg">Salvar configuração</button></div>
    </details>` : ''}`;
  bindBankAdmin();
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
    if (a === 'caixa') {
      const v = reaisParaCentavos(document.getElementById('cxValor').value), tipo = document.getElementById('cxTipo').value;
      if (!(v > 0)) return toast('Escreva o valor.');
      const txt = { entrada: 'entrou no Mercado Pago', retirada: 'saiu do Mercado Pago', receita: 'vai da receita para o caixa' }[tipo];
      if (!confirm(`Confirma: ${brl(v)} ${txt}?`)) return;
      return run('adminCaixa', { tipo, valor: v, motivo: document.getElementById('cxMotivo').value.trim() }, 'Caixa atualizado.');
    }
    if (a === 'creditar') {
      const v = reaisParaCentavos(document.getElementById('crValor').value), key = document.getElementById('crUser').value.trim();
      if (!key || !(v > 0)) return toast('Escreva o usuário e o valor.');
      if (!confirm(`Dar ${brl(v)} de saldo para ${key}? O valor sai do caixa da casa.`)) return;
      return run('adminCreditar', { key, valor: v, motivo: document.getElementById('crMotivo').value.trim() }, 'Saldo adicionado.');
    }
    if (a === 'cfg') {
      const novo = { moeda: document.getElementById('cfgMoeda').value, saquesPorDia: Number(document.getElementById('cfgSpd').value), saquesBloqueados: document.getElementById('cfgBloq').checked, taxaPartida: Number(document.getElementById('cfgTaxa').value.replace(',', '.')) };
      el.querySelectorAll('[data-cfg]').forEach(i => (novo[i.dataset.cfg] = reaisParaCentavos(i.value)));
      if (novo.moeda === 'BRL' && cart.admin.config.moeda !== 'BRL' && !confirm('Ligar o dinheiro de verdade? A partir daqui os depósitos são Pix reais pelo Mercado Pago.')) return;
      run('adminConfig', novo, 'Configuração salva.');
    }
  }));
}
