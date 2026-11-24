/* =========================================================
   JOGAR AGORA (mesa automática) E AMIGOS
   - Procurar partida: escolhe o modo e o valor; o servidor junta quem procura o mesmo,
     cria a mesa e a partida já começa. Enquanto procura, o site avisa "estou aqui" a cada 15 s.
   - Amigos: adiciona pelo usuário, o outro aceita. Dá para chamar um amigo para jogar
     em dupla (2x2 ou 3x3): os dois caem no mesmo time.
   Tudo é gravado pelo servidor; aqui o site só lê o que é seu (amizades e fila).
   ========================================================= */
const MODOS = { 2: '1x1', 4: '2x2', 6: '3x3' };
const ACHOU_MS_SITE = 3 * 60 * 1000;
const soc = { amigos: [], fila: [], unsubA: null, unsubF: null, ping: null, relogio: null, n: 2, stake: 5, parceiro: '', avisados: new Set(), abertas: new Set() };
try { Object.assign(soc, JSON.parse(localStorage.getItem('truco.jogar') || '{}')); } catch {}
try { soc.abertas = new Set(JSON.parse(sessionStorage.getItem('truco.filaMesas') || '[]')); } catch {}
const salvaPrefs = () => { try { localStorage.setItem('truco.jogar', JSON.stringify({ n: soc.n, stake: soc.stake, parceiro: soc.parceiro })); } catch {} };

function startSocial() {
  stopSocial();
  if (!account || localMode || !window.firebase || !firebase.apps.length) { renderJogar(); renderAmigos(); return; }
  const fs = firebase.firestore();
  soc.unsubA = fs.collection('amizades').where('membros', 'array-contains', account.key).onSnapshot(q => {
    soc.amigos = q.docs.map(d => ({ id: d.id, ...d.data() }));
    avisaPedidos(); renderAmigos(); renderJogar();
  }, () => {});
  soc.unsubF = fs.collection('fila').where('membros', 'array-contains', account.key).onSnapshot(q => {
    soc.fila = q.docs.map(d => ({ id: d.id, ...d.data() }));
    onFila();
  }, () => {});
}
function stopSocial() {
  if (soc.unsubA) soc.unsubA(); if (soc.unsubF) soc.unsubF();
  soc.unsubA = soc.unsubF = null; soc.amigos = []; soc.fila = [];
  clearInterval(soc.ping); soc.ping = null;
}

/* ---------- fila ---------- */
function meuGrupo() {
  const agora = Date.now();
  const vivos = soc.fila.filter(g => g.status === 'convite' || g.status === 'procurando');
  return vivos.find(g => g.status === 'procurando') || vivos[0]
    || soc.fila.find(g => g.status === 'achou' && agora - (g.achouEm || 0) < ACHOU_MS_SITE && !soc.abertas.has(g.mesa))
    || null;
}
function onFila() {
  const g = meuGrupo(), me = account && account.key;
  // achou a mesa: abre (uma vez só)
  if (g && g.status === 'achou' && g.mesa && !soc.abertas.has(g.mesa)) {
    soc.abertas.add(g.mesa);
    try { sessionStorage.setItem('truco.filaMesas', JSON.stringify([...soc.abertas].slice(-20))); } catch {}
    if (code !== g.mesa) { toast('Partida encontrada! Abrindo a mesa…', 4000); openTable(g.mesa); }
  }
  // um amigo me chamou para jogar em dupla
  for (const x of soc.fila) {
    if (x.status === 'convite' && x.lider !== me && !soc.avisados.has('c' + x.lider + x.at)) {
      soc.avisados.add('c' + x.lider + x.at);
      toast(`${x.names[x.lider] || x.lider} te chamou para jogar em dupla (${MODOS[x.n]}). Responda em Jogar agora.`, 7000);
    }
    if (x.status === 'semSaldo' && !soc.avisados.has('s' + x.id + x.at)) {
      soc.avisados.add('s' + x.id + x.at);
      toast('Você saiu da fila: alguém do grupo ficou sem saldo para a entrada.', 7000);
    }
  }
  // procurando: avisa "estou aqui" a cada 15 s (quem fecha a página sai da busca)
  const procurando = g && g.status === 'procurando';
  if (procurando && !soc.ping) soc.ping = setInterval(pingFila, 15000);
  if (!procurando && soc.ping) { clearInterval(soc.ping); soc.ping = null; }
  renderJogar();
}
async function pingFila() {
  if (document.visibilityState === 'hidden') return; // aba escondida não conta como presente
  const r = await callServer('filaPing', {}, { quiet: true });
  if (r && r.mesa && !soc.abertas.has(r.mesa)) onFila();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && soc.ping) pingFila(); });

async function procurar() {
  const parceiro = soc.n > 2 ? soc.parceiro : '';
  const btn = document.getElementById('jgBuscar'); if (btn) btn.disabled = true;
  const r = await callServer('filaEntrar', { n: soc.n, stake: soc.stake, parceiro: parceiro || null });
  if (btn) btn.disabled = false;
  if (!r) return;
  if (r.status === 'convite') toast('Convite mandado. Quando seu amigo aceitar, a busca começa.', 5000);
}
async function sairFila() { await callServer('filaSair', {}); }
async function responderDupla(lider, aceitar) { const r = await callServer('filaResponder', { lider, aceitar }); if (r && !aceitar) toast('Convite recusado.'); }

function renderJogar() {
  const el = document.getElementById('jogarPanel'); if (!el) return;
  clearInterval(soc.relogio); soc.relogio = null;
  const titulo = '<h2>Jogar agora</h2>';
  if (!account) { el.innerHTML = `${titulo}<p class="muted">Entre com sua conta para procurar uma partida.</p>`; return; }
  const me = account.key, g = meuGrupo(), valor = v => (v ? `R$ ${v}` : 'grátis');
  if (g && g.status === 'convite' && g.lider !== me) {
    el.innerHTML = `${titulo}<div class="jg-box"><p><b>${esc(g.names[g.lider] || g.lider)}</b> te chamou para jogar em dupla: <b>${MODOS[g.n]}</b>, entrada <b>${valor(g.stake)}</b>.</p>
      <div class="row"><button class="primary" data-jg="aceitar">Aceitar e procurar</button><button class="danger" data-jg="recusar">Recusar</button></div></div>`;
  } else if (g && g.status === 'convite') {
    const amigo = g.membros.find(k => k !== me);
    el.innerHTML = `${titulo}<div class="jg-box"><p class="jg-busca"><span class="jg-spin" aria-hidden="true"></span><span>Esperando <b>${esc(g.names[amigo] || amigo)}</b> aceitar o convite (${MODOS[g.n]}, ${valor(g.stake)})…</span></p>
      <div class="row"><button data-jg="sair">Cancelar</button></div></div>`;
  } else if (g && g.status === 'procurando') {
    const outros = g.membros.filter(k => k !== me).map(k => g.names[k] || k);
    el.innerHTML = `${titulo}<div class="jg-box"><p class="jg-busca"><span class="jg-spin" aria-hidden="true"></span><span>Procurando ${MODOS[g.n]}${outros.length ? ` com <b>${esc(outros.join(', '))}</b>` : ''} · ${valor(g.stake)} · <span id="jgTempo">0:00</span></span></p>
      <p class="muted" style="font-size:13px;margin:0">Deixe o site aberto. Quando a mesa fechar, a partida começa sozinha${g.stake ? ' e a entrada sai do saldo' : ''}.</p>
      <div class="row"><button data-jg="sair">Parar de procurar</button></div></div>`;
    const t0 = g.at || Date.now(), tick = () => { const s = Math.max(0, Math.floor((Date.now() - t0) / 1000)), x = document.getElementById('jgTempo'); if (x) x.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    tick(); soc.relogio = setInterval(tick, 1000);
  } else {
    const amigos = soc.amigos.filter(a => a.status === 'amigos').map(a => a.membros.find(k => k !== me))
      .sort((a, b) => (amigoOnline(b) - amigoOnline(a)) || a.localeCompare(b));
    if (soc.parceiro && !amigos.includes(soc.parceiro)) soc.parceiro = '';
    el.innerHTML = `${titulo}
      <div class="seg" role="tablist" aria-label="Modo">${[2, 4, 6].map(n => `<button type="button" role="tab" aria-selected="${soc.n === n}" data-jgn="${n}">${MODOS[n]}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <label style="flex:1 1 130px">Entrada por jogador<select id="jgStake">${CHIP_VALUES.map(v => `<option value="${v}" ${v === soc.stake ? 'selected' : ''}>${v ? `R$ ${v}` : 'Grátis'}</option>`).join('')}</select></label>
        ${soc.n > 2 ? `<label style="flex:2 1 170px">Parceiro<select id="jgParceiro"><option value="">Sozinho (o site acha um parceiro)</option>${amigos.map(k => `<option value="${esc(k)}" ${k === soc.parceiro ? 'selected' : ''}>${amigoOnline(k) ? '● ' : ''}${esc(nomeAmigo(k))}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="row"><button class="primary" id="jgBuscar">${soc.n > 2 && soc.parceiro ? 'Chamar amigo e procurar' : 'Procurar partida'}</button></div>
      <p class="muted" style="font-size:13px;margin:0">O site junta você com quem está procurando o mesmo modo e valor e a partida começa sozinha.${soc.n > 2 ? ' Com um amigo, vocês ficam no mesmo time.' : ''}</p>`;
    el.querySelectorAll('[data-jgn]').forEach(b => (b.onclick = () => { soc.n = +b.dataset.jgn; salvaPrefs(); renderJogar(); }));
    document.getElementById('jgStake').onchange = e => { soc.stake = +e.target.value; salvaPrefs(); };
    const pc = document.getElementById('jgParceiro'); if (pc) pc.onchange = e => { soc.parceiro = e.target.value; salvaPrefs(); renderJogar(); };
    document.getElementById('jgBuscar').onclick = procurar;
  }
  el.querySelectorAll('[data-jg]').forEach(b => (b.onclick = () => {
    const a = b.dataset.jg;
    if (a === 'sair') return sairFila();
    if (a === 'aceitar' || a === 'recusar') return responderDupla(g.lider, a === 'aceitar');
  }));
}

/* ---------- amigos ---------- */
const amigoOnline = k => !!(typeof online !== 'undefined' && online.keys && online.keys.has(k));
function nomeAmigo(k) { const a = soc.amigos.find(x => x.membros.includes(k)); return (a && a.names && a.names[k]) || k; }
function avisaPedidos() {
  const me = account && account.key;
  for (const a of soc.amigos) if (a.status === 'pedido' && a.para === me && !soc.avisados.has('a' + a.id)) {
    soc.avisados.add('a' + a.id);
    if (Date.now() - (a.at || 0) < 10 * 60e3) toast(`${a.names[a.de] || a.de} quer ser seu amigo. Veja em Amigos.`, 6000);
  }
}
function renderAmigos() {
  const el = document.getElementById('amigosPanel'); if (!el) return;
  if (!account) { el.innerHTML = '<h2>Amigos</h2><p class="muted">Entre com sua conta para adicionar amigos.</p>'; return; }
  const me = account.key, outro = a => a.membros.find(k => k !== me);
  const recebidos = soc.amigos.filter(a => a.status === 'pedido' && a.para === me);
  const enviados = soc.amigos.filter(a => a.status === 'pedido' && a.de === me);
  const amigos = soc.amigos.filter(a => a.status === 'amigos').map(outro).sort((a, b) => (amigoOnline(b) - amigoOnline(a)) || nomeAmigo(a).localeCompare(nomeAmigo(b)));
  const nOn = amigos.filter(amigoOnline).length;
  const keep = document.getElementById('amAdd'), val = keep ? keep.value : '', foco = keep && document.activeElement === keep;
  el.innerHTML = `<h2>Amigos${amigos.length ? ` <span class="muted" style="font-size:14px;font-weight:400">${nOn} online</span>` : ''}</h2>
    <form class="row" id="amForm"><input id="amAdd" maxlength="16" placeholder="Usuário do amigo" autocapitalize="off" autocomplete="off" spellcheck="false" style="flex:1 1 150px" aria-label="Usuário do amigo"><button class="small primary" type="submit">Adicionar</button></form>
    ${recebidos.length ? `<h3>Pedidos para você</h3>${recebidos.map(a => `<div class="seat-row"><span><b>${esc(a.names[a.de] || a.de)}</b> <span class="muted">@${esc(a.de)}</span></span><span class="row" style="margin:0;gap:6px"><button class="small primary" data-amok="${esc(a.de)}">Aceitar</button><button class="small danger" data-amno="${esc(a.de)}">Recusar</button></span></div>`).join('')}` : ''}
    <div class="amigos-lista">${amigos.length ? amigos.map(k => `<div class="seat-row"><span><span class="am-dot${amigoOnline(k) ? ' on' : ''}" title="${amigoOnline(k) ? 'online' : 'offline'}"></span><b>${esc(nomeAmigo(k))}</b> <span class="muted">@${esc(k)}</span></span>
        <span class="row" style="margin:0;gap:6px"><button class="small" data-amjoga="${esc(k)}">Jogar em dupla</button><button class="small danger" data-amdel="${esc(k)}" aria-label="Remover ${esc(nomeAmigo(k))}">×</button></span></div>`).join('')
      : '<p class="muted">Nenhum amigo ainda. Adicione pelo usuário.</p>'}</div>
    ${enviados.length ? `<p class="muted" style="font-size:13px">Esperando aceitar: ${enviados.map(a => `${esc(a.names[a.para] || a.para)} <button class="small" data-amdel="${esc(a.para)}">cancelar</button>`).join(' · ')}</p>` : ''}`;
  const inp = document.getElementById('amAdd'); if (val) inp.value = val; if (foco) inp.focus();
  document.getElementById('amForm').onsubmit = async e => {
    e.preventDefault();
    const u = inp.value.trim(); if (!u) return toast('Digite o usuário do seu amigo.');
    const r = await callServer('amigoPedir', { usuario: u });
    if (r) { inp.value = ''; toast(r.status === 'amigos' ? 'Agora vocês são amigos!' : 'Pedido mandado. Quando ele aceitar, aparece aqui.'); }
  };
  el.querySelectorAll('[data-amok]').forEach(b => (b.onclick = () => callServer('amigoResponder', { usuario: b.dataset.amok, aceitar: true }).then(r => r && toast('Agora vocês são amigos!'))));
  el.querySelectorAll('[data-amno]').forEach(b => (b.onclick = () => callServer('amigoResponder', { usuario: b.dataset.amno, aceitar: false })));
  el.querySelectorAll('[data-amdel]').forEach(b => (b.onclick = () => confirmInline(b, 'Remover?', () => callServer('amigoRemover', { usuario: b.dataset.amdel }))));
  el.querySelectorAll('[data-amjoga]').forEach(b => (b.onclick = () => {
    soc.parceiro = b.dataset.amjoga; if (soc.n === 2) soc.n = 4; salvaPrefs(); renderJogar();
    const j = document.getElementById('jogarPanel'); if (j) j.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}
