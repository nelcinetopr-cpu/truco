/* =========================================================
   POKER — Texas Hold'em sem limite (No-Limit), de 2 a 6 jogadores.
   Tudo em FICHAS: cada um tem uma carteira (100 fichas = R$ 1). A organização
   coloca fichas na carteira e paga os saques; nas mesas só circulam fichas.
   Dois tipos de mesa, criadas só pela organização:
   - Mesa de fichas: ao sentar, as fichas saem da carteira; ao levantar (ou
     quando a mesa fecha), o que sobrou volta para a carteira.
   - Sit & Go: a entrada sai da carteira, os blinds sobem com o tempo e o
     prêmio (1º, ou 1º e 2º) entra na carteira de quem ganhou.
   Cada entrada e saída de mesa, prêmio, depósito e saque fica registrado em
   "movimentos", para a organização conferir antes de pagar um saque.
   Treino contra robôs para qualquer um.

   Como não há servidor, quem dá as cartas numa mão ("anfitrião") embaralha no
   próprio aparelho, manda a cada jogador só as próprias cartas (num documento
   que só ele lê) e guarda o resto do baralho num documento que só ele lê.
   Ele revela flop, turn, river e o showdown. Se sumir no meio, a mão é anulada
   e as fichas voltam para cada um.

   Este arquivo é carregado antes do código principal e usa as funções dele
   (db, account, myId, esc, toast, $app, transact, avatarHtml, shout...).
   ========================================================= */
const PK = {
  ACT_MS: 25000,     // tempo de cada jogada
  GRACE: 2500,       // os outros esperam um pouco antes de agir pelo atrasado
  NEXT_MS: 5000,     // pausa entre uma mão e outra
  STUCK_MS: 15000,   // anfitrião sumido: a mão é anulada
  EMPTY_MS: 90000,   // mesa sem ninguém olhando: fecha e faz o acerto
  STREET_MS: 900,    // pausa entre flop, turn e river quando todos estão all-in
};
const PRANKS = '23456789TJQKA';
const PSUITS = ['p', 'c', 'e', 'o'];
const PK_CASH_BLINDS = [[5, 10], [10, 20], [25, 50], [50, 100], [100, 200], [250, 500]]; // em fichas
const PK_SNG_FEES = [500, 1000, 2000, 5000, 10000];               // entrada do Sit & Go, em fichas
const FICHAS_POR_REAL = 100;
const PK_SNG_LEVELS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [750, 1500], [1000, 2000], [1500, 3000]];
const PK_HAND_NAMES = ['Carta alta', 'Par', 'Dois pares', 'Trinca', 'Sequência', 'Flush', 'Full house', 'Quadra', 'Straight flush'];
const PK_BOT_NAMES = ['Tião', 'Zefa', 'Dito', 'Nena', 'Juca'];

let pk = null;               // mesa aberta: { code, st, solo, priv, myCards, unsub..., timer }
let pkLobby = null;          // listeners do saguão do poker

/* ---------------- baralho e avaliação das mãos ---------------- */
function pkDeck() {
  const d = [];
  for (const r of PRANKS) for (const s of PSUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = randInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const pkVal = c => PRANKS.indexOf(c[0]) + 2;
// melhor mão de 5 a 7 cartas -> [categoria, desempates...] (comparável com pkCmp)
function pkEval(cards) {
  const vals = cards.map(pkVal);
  const bySuit = {};
  cards.forEach(c => (bySuit[c[1]] ||= []).push(pkVal(c)));
  const straightTop = vs => {
    const u = [...new Set(vs)].sort((a, b) => b - a);
    if (u[0] === 14) u.push(1); // ás vale 1 na sequência A-2-3-4-5
    let run = 1;
    for (let i = 1; i < u.length; i++) {
      if (u[i] === u[i - 1] - 1) { if (++run >= 5) return u[i] + 4; } else run = 1;
    }
    return 0;
  };
  for (const s in bySuit) if (bySuit[s].length >= 5) { const sf = straightTop(bySuit[s]); if (sf) return [8, sf]; }
  const cnt = {};
  vals.forEach(v => (cnt[v] = (cnt[v] || 0) + 1));
  const g = Object.entries(cnt).map(([v, n]) => [+v, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const desc = arr => arr.sort((a, b) => b - a);
  if (g[0][1] === 4) return [7, g[0][0], Math.max(...vals.filter(v => v !== g[0][0]))];
  if (g[0][1] === 3 && g[1] && g[1][1] >= 2) return [6, g[0][0], g[1][0]];
  for (const s in bySuit) if (bySuit[s].length >= 5) return [5, ...desc(bySuit[s]).slice(0, 5)];
  const st = straightTop(vals); if (st) return [4, st];
  if (g[0][1] === 3) return [3, g[0][0], ...desc(vals.filter(v => v !== g[0][0])).slice(0, 2)];
  if (g[0][1] === 2 && g[1] && g[1][1] === 2) {
    const hp = g[0][0], lp = g[1][0];
    return [2, hp, lp, Math.max(...vals.filter(v => v !== hp && v !== lp))];
  }
  if (g[0][1] === 2) return [1, g[0][0], ...desc(vals.filter(v => v !== g[0][0])).slice(0, 3)];
  return [0, ...desc(vals).slice(0, 5)];
}
function pkCmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
const PK_RANK_WORD = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
function pkHandName(score) {
  const c = score[0], w = PK_RANK_WORD;
  if (c === 8) return score[1] === 14 ? 'Royal flush' : 'Straight flush';
  if (c === 7) return `Quadra de ${w[score[1]]}`;
  if (c === 6) return `Full house (${w[score[1]]} e ${w[score[2]]})`;
  if (c === 5) return 'Flush';
  if (c === 4) return `Sequência até ${w[score[1]]}`;
  if (c === 3) return `Trinca de ${w[score[1]]}`;
  if (c === 2) return `Dois pares (${w[score[1]]} e ${w[score[2]]})`;
  if (c === 1) return `Par de ${w[score[1]]}`;
  return `Carta alta ${w[score[1]]}`;
}

/* ---------------- regras da mão ---------------- */
const pkNow = () => Date.now();
function pkNext(st, from, pred) {
  for (let k = 1; k <= st.n; k++) { const s = (((from + k) % st.n) + st.n) % st.n; if (pred(s)) return s; }
  return -1;
}
// quem recebe cartas na próxima mão
function pkEligible(st) {
  const out = [];
  st.seats.forEach((k, s) => {
    if (!k || !(st.stacks[k] > 0)) return;
    if (st.type === 'cash' && st.away && st.away[k]) return;
    out.push(s);
  });
  return out;
}
function pkLevel(st) {
  if (st.type !== 'sng' || !st.sng.startedAt) return null;
  const i = Math.min(Math.floor((pkNow() - st.sng.startedAt) / (st.sng.levelMin * 60000)), PK_SNG_LEVELS.length - 1);
  return i;
}
// começa uma mão; devolve as cartas secretas (só o anfitrião guarda)
function pkStartHand(st, hostKey) {
  const players = pkEligible(st);
  if (players.length < 2) { st.phase = 'waiting'; st.hand = null; return null; }
  const lv = pkLevel(st);
  if (lv !== null) { st.sng.level = lv; [st.sb, st.bb] = PK_SNG_LEVELS[lv]; }
  st.button = pkNext(st, st.button ?? -1, s => players.includes(s));
  const order = []; // a partir de quem está à esquerda do botão
  for (let k = 1; k <= st.n; k++) { const s = (st.button + k) % st.n; if (players.includes(s)) order.push(s); }
  const deck = pkDeck(), hole = {};
  for (let r = 0; r < 2; r++) for (const s of order) (hole[s] ||= []).push(deck.pop());
  deck.pop(); const flop = [deck.pop(), deck.pop(), deck.pop()]; deck.pop(); const turn = deck.pop(); deck.pop(); const river = deck.pop();
  const hid = Math.random().toString(36).slice(2, 9);
  const h = {
    hid, host: hostKey, inHand: order, folded: {}, allin: {}, bets: {}, contrib: {}, acted: {}, board: [],
    street: 0, curBet: 0, minRaise: st.bb, toAct: -1, needStreet: false, needAt: 0, start: {},
  };
  for (const s of order) h.start[s] = st.stacks[st.seats[s]];
  const heads = order.length === 2;
  const sbSeat = heads ? st.button : order[0];
  const bbSeat = heads ? order.find(s => s !== st.button) : order[1];
  pkPut(st, h, sbSeat, Math.min(st.sb, st.stacks[st.seats[sbSeat]]));
  pkPut(st, h, bbSeat, Math.min(st.bb, st.stacks[st.seats[bbSeat]]));
  h.sbSeat = sbSeat; h.bbSeat = bbSeat;
  h.curBet = st.bb;
  st.hand = h; st.phase = 'hand'; st.result = null;
  st.turnAt = pkNow();
  const actors = order.filter(s => !h.allin[s]);
  const first = heads ? sbSeat : pkNext(st, bbSeat, s => actors.includes(s));
  if (actors.length === 0 || (actors.length === 1 && (h.bets[actors[0]] || 0) >= h.curBet)) { h.needStreet = true; h.needAt = pkNow(); }
  else h.toAct = first;
  st.handNo = (st.handNo || 0) + 1;
  return { hid, host: hostKey, hole, board: [...flop, turn, river] };
}
function pkPut(st, h, seat, x) {
  const k = st.seats[seat];
  x = Math.max(0, Math.min(x, st.stacks[k]));
  st.stacks[k] -= x;
  h.bets[seat] = (h.bets[seat] || 0) + x;
  h.contrib[seat] = (h.contrib[seat] || 0) + x;
  if (st.stacks[k] === 0) h.allin[seat] = true;
}
// uma jogada; devolve false se não vale
function pkAct(st, seat, a, to) {
  const h = st.hand;
  if (st.phase !== 'hand' || !h || h.toAct !== seat || h.needStreet) return false;
  const k = st.seats[seat], stack = st.stacks[k], bet = h.bets[seat] || 0, toCall = h.curBet - bet;
  if (a === 'fold') h.folded[seat] = true;
  else if (a === 'check') { if (toCall > 0) return false; }
  else if (a === 'call') { if (toCall <= 0) return false; pkPut(st, h, seat, Math.min(toCall, stack)); }
  else if (a === 'raise') {
    const maxTo = bet + stack;
    to = Math.min(Math.round(to), maxTo);
    if (to <= h.curBet) { if (to === maxTo && toCall > 0) { pkPut(st, h, seat, stack); } else return false; }
    else {
      const inc = to - h.curBet;
      if (inc < h.minRaise && to < maxTo) return false;
      pkPut(st, h, seat, to - bet);
      if (inc >= h.minRaise) { h.minRaise = inc; h.acted = {}; } // aumento completo reabre a ação
      h.curBet = to; h.aggr = seat;
    }
  } else return false;
  h.acted[seat] = true;
  h.last = { seat, a: h.folded[seat] ? 'fold' : a === 'raise' && h.allin[seat] ? 'allin' : a, amount: h.bets[seat] || 0, at: pkNow() };
  pkAdvance(st);
  return true;
}
function pkAdvance(st) {
  const h = st.hand;
  const live = h.inHand.filter(s => !h.folded[s]);
  if (live.length === 1) return pkUncontested(st, live[0]);
  const actors = live.filter(s => !h.allin[s]);
  const owes = s => (h.bets[s] || 0) < h.curBet;
  const done = actors.every(s => h.acted[s] && !owes(s)) || actors.length === 0 || (actors.length === 1 && !owes(actors[0]));
  if (done) { h.toAct = -1; h.needStreet = true; h.needAt = pkNow(); }
  else h.toAct = pkNext(st, h.toAct, s => actors.includes(s) && (!h.acted[s] || owes(s)));
  st.turnAt = pkNow();
}
// anfitrião: abre a próxima rua ou faz o showdown
function pkResolve(st, priv) {
  const h = st.hand;
  if (!h || !h.needStreet || !priv || priv.hid !== h.hid) return false;
  if (h.street === 3) return pkShowdown(st, priv);
  h.street++;
  h.board = priv.board.slice(0, h.street === 1 ? 3 : h.street === 2 ? 4 : 5);
  h.bets = {}; h.curBet = 0; h.minRaise = st.bb; h.acted = {}; h.needStreet = false; h.last = null;
  const actors = h.inHand.filter(s => !h.folded[s] && !h.allin[s]);
  if (actors.length <= 1) { h.toAct = -1; h.needStreet = true; h.needAt = pkNow(); h.runout = true; }
  else h.toAct = pkNext(st, st.button, s => actors.includes(s));
  st.turnAt = pkNow();
}
// potes: principal e paralelos (quando alguém está all-in com menos)
function pkPots(h) {
  const seats = Object.keys(h.contrib).map(Number);
  const levels = [...new Set(seats.filter(s => !h.folded[s]).map(s => h.contrib[s]))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const s of seats) amount += Math.max(0, Math.min(h.contrib[s], L) - prev);
    const eligible = seats.filter(s => !h.folded[s] && h.contrib[s] >= L);
    if (amount > 0) pots.push({ amount, eligible });
    prev = L;
  }
  let extra = 0;
  for (const s of seats) extra += Math.max(0, h.contrib[s] - prev);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}
const pkPotTotal = h => Object.values(h.contrib || {}).reduce((a, b) => a + b, 0);
function pkShowdown(st, priv) {
  const h = st.hand;
  const live = h.inHand.filter(s => !h.folded[s]);
  h.board = priv.board.slice(0, 5); h.street = 4;
  h.shown = {}; const score = {};
  for (const s of live) { h.shown[s] = priv.hole[s]; score[s] = pkEval([...priv.hole[s], ...h.board]); }
  const won = {}, names = {};
  for (const s of live) names[s] = pkHandName(score[s]);
  const result = { pots: [], won, names };
  for (const pot of pkPots(h)) {
    let best = null, winners = [];
    for (const s of pot.eligible) {
      const c = best ? pkCmp(score[s], best) : 1;
      if (c > 0) { best = score[s]; winners = [s]; } else if (c === 0) winners.push(s);
    }
    // ficha que sobra na divisão vai para o primeiro à esquerda do botão
    winners.sort((a, b) => ((a - st.button - 1 + st.n) % st.n) - ((b - st.button - 1 + st.n) % st.n));
    const each = Math.floor(pot.amount / winners.length);
    let rest = pot.amount - each * winners.length;
    for (const w of winners) { const v = each + (rest-- > 0 ? 1 : 0); won[w] = (won[w] || 0) + v; st.stacks[st.seats[w]] += v; }
    result.pots.push({ amount: pot.amount, winners, hand: names[winners[0]] });
  }
  st.result = result;
  pkEndHand(st);
}
function pkUncontested(st, seat) {
  const h = st.hand, total = pkPotTotal(h);
  st.stacks[st.seats[seat]] += total;
  st.result = { pots: [{ amount: total, winners: [seat] }], won: { [seat]: total }, names: {}, uncontested: true };
  h.toAct = -1; h.needStreet = false;
  pkEndHand(st);
}
// anfitrião sumiu: devolve o que cada um pôs
function pkVoid(st) {
  const h = st.hand;
  for (const s in h.contrib) { const k = st.seats[s]; if (k) st.stacks[k] += h.contrib[s]; }
  st.result = { void: true, pots: [], won: {}, names: {} };
  (st.away ||= {})[h.host] = true;
  h.toAct = -1; h.needStreet = false;
  pkEndHand(st);
}
function pkEndHand(st) {
  const h = st.hand;
  st.phase = 'handEnd'; st.endAt = pkNow(); st.turnAt = st.endAt;
  // Sit & Go: quem zerou sai; se zerarem juntos, quem começou a mão com mais fica na frente
  if (st.type === 'sng') {
    const busted = h.inHand.filter(s => st.stacks[st.seats[s]] === 0).sort((a, b) => h.start[a] - h.start[b]);
    for (const s of busted) { const k = st.seats[s]; if (!st.sng.out.includes(k)) st.sng.out.push(k); }
    const alive = st.seats.filter(k => k && st.stacks[k] > 0);
    if (alive.length <= 1) {
      st.phase = 'over'; st.sng.out.push(...alive); st.sng.endedAt = pkNow();
      const prize = pkSngPrizes(st);
      for (const k in prize) pkPayout(st, k, prize[k], 'premio');
    }
  } else {
    // dinheiro: quem pediu para levantar sai agora; quem zerou fica de fora até recomprar
    for (const k of Object.keys(st.leaving || {})) pkCashOut(st, k);
    st.seats.forEach(k => { if (k && st.stacks[k] === 0) (st.away ||= {})[k] = true; });
    if (st.closing) pkSettleState(st);
  }
}
// a carteira é creditada depois, por quem estiver com a mesa aberta (ver pkPayouts)
function pkPayout(st, key, fichas, tipo) {
  if (!(fichas > 0)) return;
  (st.payouts ||= []).push({ id: `${st.code}-${tipo}-${key}-${Math.random().toString(36).slice(2, 9)}`, key, fichas, tipo, at: pkNow() });
}
function pkCashOut(st, k) {
  const s = st.seats.indexOf(k);
  if (s < 0) return;
  st.ledger[k] = (st.ledger[k] || 0) + (st.stacks[k] || 0) - (st.bought[k] || 0);
  pkPayout(st, k, st.stacks[k] || 0, 'saida');
  st.seats[s] = null;
  delete st.stacks[k]; delete st.bought[k];
  if (st.leaving) delete st.leaving[k];
  if (st.away) delete st.away[k];
}
// tempo esgotado: passa se puder, senão desiste, e fica "ausente"
function pkTimeout(st) {
  const h = st.hand, s = h.toAct, k = st.seats[s];
  (st.away ||= {})[k] = true;
  return pkAct(st, s, (h.bets[s] || 0) >= h.curBet ? 'check' : 'fold');
}

/* ---------------- acerto: quem perdeu paga quem ganhou ---------------- */
// prêmio do Sit & Go em fichas: tudo para o 1º, ou 65% / 35% com 4 ou mais jogadores
function pkSngPrizes(st) {
  const order = [...st.sng.out].reverse();   // 1º, 2º, ...
  const pool = st.sng.fee * order.length, out = {};
  if (st.sng.prize === 2 && order.length >= 4) { const second = Math.floor(pool * 0.35); out[order[0]] = pool - second; out[order[1]] = second; }
  else if (order[0]) out[order[0]] = pool;
  return out;
}
// quanto cada um ganhou (+) ou perdeu (−) na mesa, em fichas
function pkNets(st) {
  const net = {};
  if (st.type === 'cash') {
    for (const k in st.ledger) net[k] = st.ledger[k];
    st.seats.forEach(k => { if (k) net[k] = (net[k] || 0) + (st.stacks[k] || 0) - (st.bought[k] || 0); });
  } else {
    const prize = pkSngPrizes(st);
    for (const k of st.sng.out) net[k] = (prize[k] || 0) - st.sng.fee;
  }
  return net;
}
function pkSettleState(st) {
  if (st.type === 'cash') st.seats.forEach(k => { if (k) pkCashOut(st, k); });
  st.phase = 'closed'; st.closedAt = pkNow(); st.settled = true; st.closing = false;
}
// grava o resultado da mesa no Lucro (em reais), uma vez, por quem fechou a mesa
async function pkRecordSettlement(st, net) {
  const delta = {};
  for (const k in net) if (net[k]) delta[k] = Math.round(net[k]) / FICHAS_POR_REAL;
  if (!Object.keys(delta).length) return;
  try {
    await db.doc('partidas/pk-' + st.code).set({ at: st.closedAt || pkNow(), table: st.code, value: 0, winners: [], losers: [], names: { ...st.names }, kind: 'poker', delta });
  } catch {}
}

async function pkClaimRecord(code) {
  let next = null;
  try { next = await transact('poker/' + code, st => (st && st.closedAt && st.settled && !st.recorded && !st.cancelled ? { ...st, recorded: true } : null)); } catch {}
  if (next) await pkRecordSettlement(next, pkNets(next));
}

/* =========================================================
   CARTEIRA DE FICHAS
   carteiras/{usuario}: { saldo, ids (últimos movimentos aplicados) }
   movimentos/{id}: cada entrada e saída, para a organização conferir.
   O "id" de cada movimento evita creditar duas vezes a mesma coisa.
   ========================================================= */
const fichasTxt = v => `${(v || 0).toLocaleString('pt-BR')} fichas`;
const reaisTxt = v => 'R$ ' + ((v || 0) / FICHAS_POR_REAL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MOV_NAMES = { deposito: 'Depósito da organização', ajuste: 'Ajuste da organização', entrada: 'Entrou na mesa', saida: 'Saiu da mesa', premio: 'Prêmio do Sit & Go', devolucao: 'Devolução', saque: 'Saque pedido', 'saque-volta': 'Saque recusado (voltou)' };
// soma (ou tira) fichas da carteira; devolve 'ok', 'repetido' ou 'sem-saldo'
async function walletMove(key, delta, info) {
  let res = 'erro', after = 0;
  await transact('carteiras/' + key, w => {
    w = w || { saldo: 0, ids: [], createdAt: pkNow() };
    if ((w.ids || []).includes(info.id)) { res = 'repetido'; return null; }
    if (delta < 0 && (w.saldo || 0) + delta < 0) { res = 'sem-saldo'; return null; }
    w.saldo = (w.saldo || 0) + delta;
    w.ids = [info.id, ...(w.ids || [])].slice(0, 80);
    w.updatedAt = pkNow();
    if (info.name) w.name = info.name;
    res = 'ok'; after = w.saldo;
    return w;
  });
  if (res === 'ok') {
    await db.doc('movimentos/' + info.id).set({ key, tipo: info.tipo, fichas: delta, saldo: after, table: info.table || '', by: myId || '', nota: info.nota || '', at: pkNow() }).catch(() => {});
  }
  return res;
}
// credita na carteira o que as mesas devolveram (fichas que sobraram, prêmios, devoluções)
async function pkPayouts(code, st) {
  const pend = (st.payouts || []).filter(x => !x.done);
  if (!pend.length) return;
  const done = [];
  for (const x of pend) {
    try { const r = await walletMove(x.key, x.fichas, { id: x.id, tipo: x.tipo, table: code, name: st.names[x.key] }); if (r === 'ok' || r === 'repetido') done.push(x.id); } catch {}
  }
  if (done.length) await transact('poker/' + code, t => {
    if (!t) return null;
    let changed = false;
    for (const x of t.payouts || []) if (done.includes(x.id) && !x.done) { x.done = true; changed = true; }
    if (!changed) return null;
    t.payouts = t.payouts.filter(x => !x.done || pkNow() - x.at < 3600e3); // guarda só a última hora dos já creditados
    return t;
  }).catch(() => {});
}

/* ---------------- dinheiro na tela ---------------- */
function pkMoney(st, v) {
  v = v || 0;
  if (st.unit === 'cents') {
    const r = v / 100;
    return '$ ' + r.toLocaleString('pt-BR', { minimumFractionDigits: v % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  return v.toLocaleString('pt-BR');
}
const pkBlindsLabel = st => `${pkMoney(st, st.sb)} / ${pkMoney(st, st.bb)}`;
function pkTypeLabel(t) {
  if (t.type === 'sng') return `Sit & Go · entrada ${fichasTxt(t.sng.fee)} (${reaisTxt(t.sng.fee)}) · começa com ${t.sng.stack.toLocaleString('pt-BR')} no torneio`;
  return `Fichas · blinds ${pkBlindsLabel(t)} · entra com ${pkMoney(t, t.buyMin)} a ${pkMoney(t, t.buyMax)}`;
}
function pkCard(c, cls = '') {
  const r = c[0] === 'T' ? '10' : c[0], red = c[1] === 'o' || c[1] === 'c';
  return `<span class="card ${red ? 'red' : ''} ${cls}" role="img" aria-label="${r}${SUIT_SYM[c[1]]}"><span class="rk">${r}<i>${SUIT_SYM[c[1]]}</i></span><span class="big">${SUIT_SYM[c[1]]}</span></span>`;
}

/* =========================================================
   SAGUÃO DO POKER
   ========================================================= */
function pokerLeave() {
  if (pk) {
    for (const u of ['unsub', 'unsubCards', 'unsubWallet']) if (pk[u]) pk[u]();
    clearInterval(pk.timer); clearInterval(pk.beat); clearTimeout(pk.botT);
    pk = null;
  }
  if (pkLobby) { for (const u of Object.values(pkLobby)) if (typeof u === 'function') u(); pkLobby = null; }
  document.querySelectorAll('.fx').forEach(e => e.remove());
}
function showPokerLobby() {
  pokerLeave();
  stopTourneyLobby();
  document.body.classList.remove('in-game');
  const logged = !!(account && db);
  $app.innerHTML = `
    ${logged ? '' : `<section class="panel"><h2>Entre para jogar</h2><p class="muted">As mesas de poker usam a mesma conta do truco.</p><div class="row"><button class="primary" id="pkLogin">Entrar ou criar conta</button></div></section>`}
    <div class="grid2">
      <section class="panel" id="pkWallet"><h2>Minha carteira</h2><p class="muted">Carregando…</p></section>
      <section class="panel" id="pkTables"><h2>Mesas de poker</h2><p class="muted">Carregando…</p></section>
    </div>
    <div class="grid2">
      <section class="panel" id="pkCreate"><h2>Criar mesa</h2><p class="muted">Carregando…</p></section>
      <section class="panel" id="pkBank" hidden></section>
    </div>
    <div class="grid2">
      <section class="panel">
        <h2>Treinar contra o computador</h2>
        <p class="muted">Texas Hold'em contra robôs, com fichas de mentira. Nada fica salvo.</p>
        <div class="row">
          <select id="pkSoloN" aria-label="Jogadores no treino" style="flex:1 1 180px">${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>Você + ${n - 1} ${n === 2 ? 'robô' : 'robôs'}</option>`).join('')}</select>
          <button class="primary" id="pkSolo">Jogar treino</button>
        </div>
      </section>
    </div>
    <section class="panel">${pkRulesHtml()}</section>`;
  const lg = document.getElementById('pkLogin');
  if (lg) lg.onclick = () => setGame('truco');
  document.getElementById('pkSolo').onclick = () => pkStartSolo(+document.getElementById('pkSoloN').value);
  pkLobby = {};
  if (!logged) { pkRenderTables([]); pkRenderCreate(); pkRenderWallet(); return; }
  pkLobby.org = db.doc('config/org').onSnapshot(s => { orgCfg = s.exists ? s.data() : null; pkRenderCreate(); pkWatchBank(); }, () => pkRenderCreate());
  pkLobby.wallet = db.doc('carteiras/' + myId).onSnapshot(s => { pkW.saldo = s.exists ? s.data().saldo || 0 : 0; pkW.loaded = true; pkRenderWallet(); }, () => {});
  pkLobby.saques = db.collection('saques').where('key', '==', myId).onSnapshot(s => { pkW.saques = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at); pkRenderWallet(); }, () => {});
  pkLobby.movs = db.collection('movimentos').where('key', '==', myId).onSnapshot(s => { pkW.movs = s.docs.map(d => d.data()).sort((a, b) => b.at - a.at).slice(0, 15); pkRenderWallet(); }, () => {});
  pkLobby.list = db.collection('poker').orderBy('updatedAt', 'desc').limit(30).onSnapshot(snap => {
    const list = snap.docs.map(d => d.data()).filter(Boolean);
    for (const t of list) if (!t.closedAt && pkNow() - (t.aliveAt || t.updatedAt || 0) > PK.EMPTY_MS) pkAutoClose(t.code);
    pkRenderTables(list.filter(t => !t.closedAt));
  }, () => pkRenderTables([]));
}
const pkW = { saldo: 0, loaded: false, saques: [], movs: [], bankSaques: [], hist: {} };
function pkMovRow(m) {
  const d = new Date(m.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `<li><span>${esc(MOV_NAMES[m.tipo] || m.tipo)}${m.table ? ` <span class="muted">· ${esc(m.table)}</span>` : ''}${m.nota ? ` <span class="muted">· ${esc(m.nota)}</span>` : ''}</span><b class="${m.fichas >= 0 ? 'pos' : 'neg'}">${m.fichas >= 0 ? '+' : '−'}${Math.abs(m.fichas).toLocaleString('pt-BR')}</b><small class="muted">${d}</small></li>`;
}
function pkRenderWallet() {
  const el = document.getElementById('pkWallet'); if (!el) return;
  if (!account || !db) { el.innerHTML = '<h2>Minha carteira</h2><p class="muted">Entre com seu usuário para ver suas fichas.</p>'; return; }
  if (!pkW.loaded) { el.innerHTML = '<h2>Minha carteira</h2><p class="muted">Carregando…</p>'; return; }
  const pend = pkW.saques.filter(x => x.status === 'pendente');
  const keep = document.getElementById('pkSaqueV'); const typed = keep ? keep.value : '';
  el.innerHTML = `<h2>Minha carteira</h2>
    <div class="wallet"><b>${fichasTxt(pkW.saldo)}</b><span class="muted">vale ${reaisTxt(pkW.saldo)} · 100 fichas = R$ 1</span></div>
    <p class="muted" style="font-size:13px">Para colocar fichas, combine com a organização. Para sacar, peça aqui: as fichas saem na hora e a organização paga o Pix na sua chave (cadastrada no saguão do truco).</p>
    <div class="row"><input id="pkSaqueV" type="number" inputmode="numeric" min="100" step="100" placeholder="Fichas para sacar" style="flex:1 1 140px" value="${esc(typed)}"><button id="pkSaque">Pedir saque</button></div>
    ${pend.length ? `<h3>Saques esperando pagamento</h3><ul class="movs">${pend.map(x => `<li><span>${fichasTxt(x.fichas)}</span><b>${reaisTxt(x.fichas)}</b><small class="muted">pedido em ${new Date(x.at).toLocaleDateString('pt-BR')}</small></li>`).join('')}</ul>` : ''}
    ${pkW.movs.length ? `<details><summary>Últimos movimentos</summary><ul class="movs">${pkW.movs.map(pkMovRow).join('')}</ul></details>` : ''}`;
  document.getElementById('pkSaque').onclick = pkRequestSaque;
}
async function pkRequestSaque() {
  const v = Math.floor(+document.getElementById('pkSaqueV').value || 0);
  if (v < 100) return toast('O saque mínimo é de 100 fichas (R$ 1).');
  if (v > pkW.saldo) return toast('Você não tem tudo isso na carteira.');
  if (!confirm(`Sacar ${fichasTxt(v)} (${reaisTxt(v)})? As fichas saem da carteira agora.`)) return;
  const sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = await walletMove(myId, -v, { id: 'saque-' + sid, tipo: 'saque', name: myNick }).catch(() => 'erro');
  if (r !== 'ok') return toast(r === 'sem-saldo' ? 'Saldo insuficiente.' : 'Não deu para pedir o saque agora.');
  try {
    await db.doc('saques/' + sid).set({ key: myId, name: myNick, fichas: v, status: 'pendente', at: pkNow() });
    document.getElementById('pkSaqueV').value = '';
    toast('Saque pedido. A organização vai pagar no seu Pix.');
  } catch {
    await walletMove(myId, v, { id: 'saque-volta-' + sid, tipo: 'saque-volta', name: myNick }).catch(() => {});
    toast('Não deu para pedir o saque. As fichas voltaram.');
  }
}
// ---- painel da organização: colocar fichas e pagar saques ----
function pkWatchBank() {
  const el = document.getElementById('pkBank'); if (!el) return;
  if (!isOrg()) { el.hidden = true; if (pkLobby && pkLobby.bank) { pkLobby.bank(); pkLobby.bank = null; } return; }
  el.hidden = false;
  if (!pkLobby.bank) pkLobby.bank = db.collection('saques').where('status', '==', 'pendente').onSnapshot(s => { pkW.bankSaques = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at); pkRenderBank(); }, () => {});
  pkRenderBank();
}
function pkRenderBank() {
  const el = document.getElementById('pkBank'); if (!el || el.hidden) return;
  const keepU = document.getElementById('pkDepU'), keepV = document.getElementById('pkDepV');
  const u = keepU ? keepU.value : '', v = keepV ? keepV.value : '';
  el.innerHTML = `<h2>Carteiras (organização)</h2>
    <h3>Colocar ou tirar fichas</h3>
    <div class="row">
      <input id="pkDepU" placeholder="Usuário" style="flex:1 1 120px" value="${esc(u)}">
      <input id="pkDepV" type="number" inputmode="numeric" step="100" placeholder="Fichas" style="flex:1 1 100px" value="${esc(v)}">
    </div>
    <div class="row"><button class="primary small" data-dep="1">Colocar</button><button class="small" data-dep="-1">Tirar</button><span class="muted" style="font-size:13px" id="pkDepHint"></span></div>
    <h3>Saques para pagar</h3>
    ${pkW.bankSaques.length ? pkW.bankSaques.map(x => `<div class="pay-row owe">
        <div><b>${esc(x.name || x.key)}</b> quer sacar <b>${fichasTxt(x.fichas)}</b> = <b>${reaisTxt(x.fichas)}</b><div class="muted" style="font-size:12px">pedido em ${new Date(x.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
        ${pixBlock(x.key, x.name || x.key)}
        <div class="row"><button class="small" data-hist="${esc(x.key)}">Conferir histórico</button><button class="primary small" data-paid="${esc(x.id)}">Paguei</button><button class="danger small" data-refuse="${esc(x.id)}">Recusar</button></div>
        <div class="hist" id="hist-${esc(x.id)}">${pkW.hist[x.key] ? pkHistHtml(pkW.hist[x.key]) : ''}</div>
      </div>`).join('') : '<p class="muted">Nenhum saque pendente.</p>'}`;
  const hint = () => { const n = Math.floor(+document.getElementById('pkDepV').value || 0); document.getElementById('pkDepHint').textContent = n ? `= ${reaisTxt(n)}` : ''; };
  document.getElementById('pkDepV').oninput = hint; hint();
  el.querySelectorAll('[data-dep]').forEach(b => (b.onclick = () => pkOrgDeposit(+b.dataset.dep)));
  el.querySelectorAll('[data-hist]').forEach(b => (b.onclick = () => pkLoadHist(b.dataset.hist)));
  el.querySelectorAll('[data-paid]').forEach(b => (b.onclick = () => pkPaySaque(b.dataset.paid, true)));
  el.querySelectorAll('[data-refuse]').forEach(b => (b.onclick = () => pkPaySaque(b.dataset.refuse, false)));
}
async function pkOrgDeposit(sign) {
  const key = userKey(document.getElementById('pkDepU').value || ''), n = Math.floor(+document.getElementById('pkDepV').value || 0);
  if (!key || n <= 0) return toast('Escreva o usuário e quantas fichas.');
  let name = key;
  try { const a = await db.doc('contas/' + key).get(); if (!a.exists) return toast('Esse usuário não existe.'); name = a.data().name || key; } catch {}
  if (!confirm(`${sign > 0 ? 'Colocar' : 'Tirar'} ${fichasTxt(n)} (${reaisTxt(n)}) ${sign > 0 ? 'na' : 'da'} carteira de ${name}?`)) return;
  const r = await walletMove(key, sign * n, { id: (sign > 0 ? 'dep-' : 'aj-') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: sign > 0 ? 'deposito' : 'ajuste', name, nota: 'por ' + myNick }).catch(() => 'erro');
  if (r === 'ok') { toast(`${sign > 0 ? 'Colocou' : 'Tirou'} ${fichasTxt(n)} ${sign > 0 ? 'na' : 'da'} carteira de ${name}.`); document.getElementById('pkDepV').value = ''; }
  else toast(r === 'sem-saldo' ? `${name} não tem tudo isso na carteira.` : 'Não deu agora. Tente de novo.');
}
// histórico do jogador para conferir antes de pagar
async function pkLoadHist(key) {
  try {
    const s = await db.collection('movimentos').where('key', '==', key).get();
    pkW.hist[key] = s.docs.map(d => d.data()).sort((a, b) => b.at - a.at);
    pkRenderBank();
  } catch { toast('Não deu para carregar o histórico.'); }
}
function pkHistHtml(list) {
  const sum = t => list.filter(m => t.includes(m.tipo)).reduce((a, m) => a + m.fichas, 0);
  const dep = sum(['deposito', 'ajuste']), mesas = sum(['entrada', 'saida', 'premio', 'devolucao']), saq = sum(['saque', 'saque-volta']);
  return `<div class="hist-sum"><span>Depósitos e ajustes <b>${dep.toLocaleString('pt-BR')}</b></span><span>Resultado nas mesas <b class="${mesas >= 0 ? 'pos' : 'neg'}">${mesas >= 0 ? '+' : '−'}${Math.abs(mesas).toLocaleString('pt-BR')}</b></span><span>Saques <b>${Math.abs(saq).toLocaleString('pt-BR')}</b></span></div>
    <ul class="movs">${list.slice(0, 40).map(pkMovRow).join('')}</ul>`;
}
async function pkPaySaque(id, paid) {
  const x = pkW.bankSaques.find(s => s.id === id); if (!x) return;
  if (!confirm(paid ? `Confirma que pagou ${reaisTxt(x.fichas)} para ${x.name || x.key}?` : `Recusar o saque de ${x.name || x.key}? As fichas voltam para a carteira dele.`)) return;
  try {
    const next = await transact('saques/' + id, s => (s && s.status === 'pendente' ? { ...s, status: paid ? 'pago' : 'recusado', paidAt: pkNow(), paidBy: myId } : null));
    if (!next) return toast('Esse saque já foi resolvido.');
    if (!paid) await walletMove(x.key, x.fichas, { id: 'saque-volta-' + id, tipo: 'saque-volta', nota: 'recusado por ' + myNick });
    toast(paid ? 'Saque marcado como pago.' : 'Saque recusado; as fichas voltaram.');
  } catch { toast('Não deu agora. Tente de novo.'); }
}

function pkRenderTables(list) {
  const el = document.getElementById('pkTables'); if (!el) return;
  el.innerHTML = `<h2>Mesas de poker</h2>${list.length ? `<div class="mesas-list">${list.map(t => {
    const filled = t.seats.filter(Boolean).length;
    const status = t.type === 'sng' ? (t.phase === 'over' ? 'terminou' : t.sng.startedAt ? 'em andamento' : `${filled}/${t.n} inscritos`) : `${filled}/${t.n} sentados`;
    return `<div class="mesa-item"><div><b>${esc(t.name)}</b> <span class="tag">${status}</span><div class="muted" style="font-size:13px">${esc(pkTypeLabel(t))}</div></div><button class="small" data-pkopen="${esc(t.code)}">Abrir</button></div>`;
  }).join('')}</div>` : '<p class="muted">Nenhuma mesa aberta agora. A organização cria as mesas.</p>'}`;
  el.querySelectorAll('[data-pkopen]').forEach(b => (b.onclick = () => openPokerTable(b.dataset.pkopen)));
}
function pkRenderCreate() {
  const el = document.getElementById('pkCreate'); if (!el) return;
  if (!account || !db) { el.innerHTML = '<h2>Criar mesa</h2><p class="muted">Entre com seu usuário.</p>'; return; }
  if (!isOrg()) { el.innerHTML = '<h2>Criar mesa</h2><p class="muted">Só a organização cria mesas de poker. Peça para alguém da organização abrir uma.</p>'; return; }
  if (el.dataset.ready === '1') return; // não refaz o formulário enquanto a pessoa preenche
  el.dataset.ready = '1';
  const blindOpts = PK_CASH_BLINDS.map(([s, b], i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${s} / ${b}</option>`).join('');
  el.innerHTML = `<h2>Criar mesa</h2>
    <div class="seg two" role="tablist" aria-label="Tipo de mesa">
      <button type="button" role="tab" data-pktype="cash" aria-selected="true">Mesa de fichas</button>
      <button type="button" role="tab" data-pktype="sng" aria-selected="false">Sit &amp; Go</button>
    </div>
    <div class="row">
      <label style="flex:2 1 160px">Nome<input id="pkName" maxlength="24" placeholder="Ex.: Mesa de sexta"></label>
      <label style="flex:1 1 90px">Lugares<select id="pkN">${[2, 3, 4, 5, 6].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="row" data-for="cash">
      <label style="flex:1 1 140px">Blinds<select id="pkBlinds">${blindOpts}</select></label>
      <p class="muted" style="font-size:13px;flex:1 1 100%" id="pkBuyHint"></p>
    </div>
    <div class="row" data-for="sng" hidden>
      <label style="flex:1 1 100px">Entrada<select id="pkFee">${PK_SNG_FEES.map(v => `<option value="${v}" ${v === 1000 ? 'selected' : ''}>${v.toLocaleString('pt-BR')} (${reaisTxt(v)})</option>`).join('')}</select></label>
      <label style="flex:1 1 100px">Fichas do torneio<select id="pkStack"><option>1000</option><option selected>1500</option><option>3000</option></select></label>
      <label style="flex:1 1 100px">Blinds sobem a cada<select id="pkLevel"><option value="3">3 min</option><option value="5" selected>5 min</option><option value="8">8 min</option><option value="10">10 min</option></select></label>
      <label style="flex:1 1 160px">Prêmio (soma das entradas)<select id="pkPrize"><option value="1">Tudo para o 1º</option><option value="2">1º 65% e 2º 35% (4+ jogadores)</option></select></label>
    </div>
    <div class="row"><button class="primary" id="pkCreateBtn">Criar mesa</button></div>`;
  let type = 'cash';
  const hint = () => { const [, b] = PK_CASH_BLINDS[+document.getElementById('pkBlinds').value]; document.getElementById('pkBuyHint').textContent = `Cada um entra com ${fichasTxt(b * 20)} a ${fichasTxt(b * 100)} da carteira (${reaisTxt(b * 20)} a ${reaisTxt(b * 100)}). Ao levantar ou quando a mesa fecha, o que sobrou volta para a carteira.`; };
  hint();
  document.getElementById('pkBlinds').onchange = hint;
  el.querySelectorAll('[data-pktype]').forEach(b => (b.onclick = () => {
    type = b.dataset.pktype;
    el.querySelectorAll('[data-pktype]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    el.querySelectorAll('[data-for]').forEach(x => (x.hidden = x.dataset.for !== type));
  }));
  document.getElementById('pkCreateBtn').onclick = () => pkCreateTable(type);
}
async function pkCreateTable(type) {
  const name = document.getElementById('pkName').value.trim().slice(0, 24) || (type === 'sng' ? 'Sit & Go' : 'Mesa de poker');
  const n = +document.getElementById('pkN').value;
  const code = 'P' + Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randInt(32)]).join('');
  const now = pkNow();
  const st = { code, name, type, n, seats: Array(n).fill(null), names: {}, stacks: {}, bought: {}, ledger: {}, away: {}, leaving: {}, phase: 'waiting', hand: null, button: -1, owner: myId, createdAt: now, updatedAt: now, aliveAt: now, v: 1 };
  if (type === 'cash') {
    const [sb, bb] = PK_CASH_BLINDS[+document.getElementById('pkBlinds').value];
    Object.assign(st, { unit: 'chips', sb, bb, buyMin: bb * 20, buyMax: bb * 100 });
  } else {
    Object.assign(st, { unit: 'chips', sb: PK_SNG_LEVELS[0][0], bb: PK_SNG_LEVELS[0][1], sng: { fee: +document.getElementById('pkFee').value, stack: +document.getElementById('pkStack').value, levelMin: +document.getElementById('pkLevel').value, prize: +document.getElementById('pkPrize').value, startedAt: 0, level: 0, out: [], paid: [] } });
  }
  try { await db.doc('poker/' + code).set(st); openPokerTable(code); }
  catch { toast('Não deu para criar a mesa. Só a organização pode criar.'); }
}
// mesa abandonada: fecha e faz o acerto (quem chegar primeiro no saguão faz)
async function pkAutoClose(code) {
  let closed = null;
  try {
    closed = await transact('poker/' + code, st => {
      if (!st || st.closedAt || pkNow() - (st.aliveAt || st.updatedAt || 0) <= PK.EMPTY_MS) return null;
      if (st.phase === 'hand' && st.hand) { for (const s in st.hand.contrib) st.stacks[st.seats[s]] += st.hand.contrib[s]; st.hand = null; }
      if (st.type === 'sng' && st.phase !== 'over') {
        // Sit & Go abandonado no meio: a entrada volta para todos
        for (const k of st.sng.paid || []) pkPayout(st, k, st.sng.fee, 'devolucao');
        st.phase = 'closed'; st.closedAt = pkNow(); st.settled = true; st.cancelled = true; return st;
      }
      pkSettleState(st);
      return st;
    });
  } catch {}
  if (closed) { await pkPayouts(code, closed); if (!closed.cancelled) await pkClaimRecord(code); }
}
function pkRulesHtml() {
  const hands = [['Royal flush', 'A K Q J 10 do mesmo naipe'], ['Straight flush', 'sequência do mesmo naipe'], ['Quadra', '4 cartas iguais'], ['Full house', 'trinca + par'], ['Flush', '5 do mesmo naipe'], ['Sequência', '5 em ordem'], ['Trinca', '3 iguais'], ['Dois pares', ''], ['Par', ''], ['Carta alta', '']];
  return `<h2>Como funciona</h2>
    <p class="muted">Texas Hold'em sem limite. Cada um recebe 2 cartas fechadas; na mesa saem 5 abertas (flop com 3, turn e river). Ganha quem fizer a melhor mão de 5 cartas juntando as suas com as da mesa, ou quem continuar quando todos desistirem.</p>
    <ol class="pk-ranks">${hands.map(([a, b]) => `<li><b>${a}</b>${b ? ` <span class="muted">— ${b}</span>` : ''}</li>`).join('')}</ol>
    <p class="muted" style="font-size:13px">Cada jogada tem ${PK.ACT_MS / 1000} segundos. Se o tempo acabar, o jogo passa (ou desiste, se tiver aposta) e você fica ausente até tocar em Voltar.</p>
    <p class="muted" style="font-size:13px">As mesas valem fichas da sua carteira (100 fichas = R$ 1). A organização coloca as fichas e paga os saques.</p>`;
}

/* =========================================================
   MESA DE POKER
   ========================================================= */
const pkMySeat = () => (pk && pk.st ? pk.st.seats.indexOf(pk.me) : -1);
function pkEnterTableView() {
  closeTournament(); stopChat(); leaveSolo(); stopTableTimers(); stopTourneyLobby();
  if (unsubTable) { unsubTable(); unsubTable = null; }
  if (unsubList) { unsubList(); unsubList = null; }
  if (unsubRank) { unsubRank(); unsubRank = null; }
  cur = null; code = null;
  document.getElementById('topRight').innerHTML = '';
}
function openPokerTable(c) {
  if (!db) return;
  pokerLeave();
  pkEnterTableView();
  if (currentGame !== 'poker') { currentGame = 'poker'; try { localStorage.setItem('jogo', 'poker'); } catch {} paintGameNav(); }
  history.replaceState(null, '', '#poker-' + c);
  $app.innerHTML = '<p class="muted">Procurando a mesa…</p>';
  const p = pk = { code: c, solo: false, me: myId, st: null, priv: null, myCards: null, lastKey: '' };
  p.unsub = db.doc('poker/' + c).onSnapshot(snap => {
    if (pk !== p) return;
    if (!snap.exists) { $app.innerHTML = `<div class="panel"><p>Mesa de poker <span class="code">${esc(c)}</span> não encontrada.</p><div class="row"><button id="back">Voltar</button></div></div>`; document.getElementById('back').onclick = showLobby; return; }
    const st = snap.data();
    const key = JSON.stringify({ ...st, aliveAt: 0 });
    p.st = st;
    pkLoadPriv();
    if (key === p.lastKey) return;
    p.lastKey = key;
    pkRender();
  }, () => toast('A conexão com a mesa caiu. Recarregue a página.'));
  if (myId) p.unsubCards = db.doc(`poker/${c}/cartas/${myId}`).onSnapshot(s => { if (pk !== p) return; p.myCards = s.exists ? s.data() : null; pkRender(); }, () => {});
  if (myId) p.unsubWallet = db.doc('carteiras/' + myId).onSnapshot(s => { if (pk !== p) return; p.saldo = s.exists ? s.data().saldo || 0 : 0; }, () => {});
  p.timer = setInterval(pkTick, 400);
  const beat = () => { if (pk === p && p.st && !p.st.closedAt) db.doc('poker/' + c).update({ aliveAt: pkNow() }).catch(() => {}); };
  beat(); p.beat = setInterval(beat, 10000);
}
// o anfitrião recupera o baralho depois de recarregar a página
function pkLoadPriv() {
  const p = pk, h = p && p.st && p.st.hand;
  if (!p || p.solo || !h || h.host !== p.me || (p.priv && p.priv.hid === h.hid) || p.loadingPriv) return;
  p.loadingPriv = true;
  db.doc(`poker/${p.code}/baralho/${p.me}`).get().then(s => { if (s.exists && s.data().hid === h.hid) p.priv = s.data(); }).catch(() => {}).finally(() => (p.loadingPriv = false));
}
async function pkCommit(fn) {
  const p = pk; if (!p) return null;
  if (p.solo) {
    const st = structuredClone(p.st);
    if (fn(st) === false) return null;
    st.v = (st.v || 0) + 1;
    p.st = st; pkRender(); pkSoloSchedule();
    return st;
  }
  if (p.busy) return null;
  p.busy = true;
  try {
    return await transact('poker/' + p.code, st => {
      if (!st) return null;
      if (fn(st) === false) return null;
      st.v = (st.v || 0) + 1; st.updatedAt = pkNow(); st.aliveAt = st.updatedAt;
      return st;
    });
  } catch { toast('Não deu para salvar a jogada. Tente de novo.'); return null; }
  finally { p.busy = false; }
}
// dar as cartas: quem conseguir primeiro vira o anfitrião desta mão
async function pkDeal() {
  const p = pk; if (!p || p.dealing) return;
  p.dealing = true;
  let priv = null;
  try {
    const next = await pkCommit(st => {
      const ready = (st.phase === 'handEnd' && pkNow() - st.endAt >= PK.NEXT_MS - 200) || st.phase === 'waiting';
      if (!ready || st.closedAt) return false;
      if (st.type === 'sng' && !st.sng.startedAt) return false;
      if (st.phase === 'waiting' && pkEligible(st).length < 2) return false;
      priv = pkStartHand(st, p.me);
      if (!priv && st.phase === 'waiting') return true; // ainda dá para salvar o "esperando"
    });
    if (next && next.hand && priv && next.hand.hid === priv.hid && next.hand.host === p.me) {
      p.priv = priv;
      if (!p.solo) {
        await db.doc(`poker/${p.code}/baralho/${p.me}`).set(priv).catch(() => {});
        await Promise.all(Object.entries(priv.hole).map(([s, cards]) => {
          const k = next.seats[s];
          return k && !/^bot\d$/.test(k) ? db.doc(`poker/${p.code}/cartas/${k}`).set({ hid: priv.hid, cards }).catch(() => {}) : null;
        }));
      } else p.myCards = { hid: priv.hid, cards: priv.hole[pkMySeat()] };
      pkRender();
    }
  } finally { p.dealing = false; }
}
function pkTick() {
  const p = pk; if (!p || !p.st) return;
  const st = p.st, now = pkNow(), me = pkMySeat();
  const clock = document.getElementById('pkClock');
  if (clock && st.phase === 'hand' && st.hand && st.hand.toAct >= 0) {
    const left = Math.max(0, Math.ceil((st.turnAt + PK.ACT_MS - now) / 1000));
    clock.textContent = left + 's'; clock.classList.toggle('low', left <= 5);
  }
  if (st.type === 'sng' && st.sng.startedAt && st.phase !== 'over') {
    const lv = document.getElementById('pkLevel');
    if (lv) { const i = pkLevel(st), nextAt = st.sng.startedAt + (i + 1) * st.sng.levelMin * 60000; lv.textContent = i < PK_SNG_LEVELS.length - 1 ? `sobe em ${Math.max(0, Math.ceil((nextAt - now) / 60000))} min` : 'nível máximo'; }
  }
  if (!p.solo && st.closedAt && st.settled && !st.recorded && !st.cancelled && !p.claiming) { p.claiming = true; pkClaimRecord(p.code).finally(() => (p.claiming = false)); }
  if (!p.solo && (st.payouts || []).some(x => !x.done) && !p.paying) { p.paying = true; pkPayouts(p.code, st).finally(() => (p.paying = false)); }
  if (st.closedAt || (me < 0 && !p.solo) || p.busy) return;
  const h = st.hand;
  if (st.phase === 'hand' && h) {
    if (h.needStreet) {
      if (h.host === p.me && p.priv && p.priv.hid === h.hid) {
        if (now - h.needAt >= (h.runout || h.street >= 1 && !h.inHand.some(s => !h.folded[s] && !h.allin[s]) ? PK.STREET_MS : 350)) pkCommit(s => (s.hand && s.hand.hid === h.hid && s.hand.needStreet ? pkResolve(s, p.priv) : false));
      } else if (now - h.needAt > PK.STUCK_MS) pkCommit(s => (s.hand && s.hand.hid === h.hid && s.hand.needStreet && pkNow() - s.hand.needAt > PK.STUCK_MS ? pkVoid(s) : false));
    } else if (h.toAct >= 0 && !p.solo) {
      const k = st.seats[h.toAct], waited = now - st.turnAt;
      const away = st.away && st.away[k] && waited > 1500;
      if (away || waited - PK.ACT_MS >= (k === p.me ? 0 : PK.GRACE)) {
        const t0 = st.turnAt;
        pkCommit(s => (s.phase === 'hand' && s.hand && s.hand.hid === h.hid && s.turnAt === t0 ? pkTimeout(s) : false));
      }
    }
  } else if (st.phase === 'handEnd' && now - st.endAt > PK.NEXT_MS) pkDeal();
  else if (st.phase === 'waiting' && pkEligible(st).length >= 2 && (st.type !== 'sng' || st.sng.startedAt)) pkDeal();
}

/* ---------------- ações do jogador ---------------- */
function pkDo(a, to) {
  const s = pkMySeat(); if (s < 0) return;
  const hid = pk.st.hand && pk.st.hand.hid;
  pkCommit(st => (st.hand && st.hand.hid === hid ? pkAct(st, s, a, to) : false));
}
function pkSit(i) {
  const st = pk.st;
  if (!account && !pk.solo) return toast('Entre com seu usuário para sentar.');
  if (st.type === 'cash') return pkBuyIn(i);
  if (pk.solo) return;
  pkSitSng(i);
}
async function pkSitSng(i) {
  const st = pk.st, fee = st.sng.fee;
  if ((pk.saldo || 0) < fee) return toast(`A entrada é ${fichasTxt(fee)} e você tem ${fichasTxt(pk.saldo)}. Peça fichas à organização.`);
  if (!confirm(`Entrar no Sit & Go por ${fichasTxt(fee)} (${reaisTxt(fee)})? Sai da sua carteira agora.`)) return;
  const id = `${st.code}-entrada-${pk.me}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await walletMove(pk.me, -fee, { id, tipo: 'entrada', table: st.code, name: myNick });
  if (r !== 'ok') return toast(r === 'sem-saldo' ? 'Saldo insuficiente.' : 'Não deu para entrar agora.');
  const next = await pkCommit(s => {
    if (s.seats[i] || s.seats.includes(pk.me) || s.sng.startedAt || s.closedAt) return false;
    s.seats[i] = pk.me; s.names[pk.me] = myNick || pk.me; s.stacks[pk.me] = s.sng.stack;
    (s.sng.paid ||= []).push(pk.me);
    if (s.seats.every(Boolean)) pkStartSng(s); // mesa cheia: começa
  });
  if (!next || !next.seats.includes(pk.me)) { await walletMove(pk.me, fee, { id: id + '-volta', tipo: 'devolucao', table: st.code, name: myNick }); toast('Não deu para sentar; a entrada voltou para a carteira.'); }
}
function pkStartSng(s) { s.sng.startedAt = pkNow(); s.sng.out = []; s.phase = 'waiting'; s.seats.forEach(k => { if (k) s.stacks[k] = s.sng.stack; }); }
function pkBuyIn(i, rebuy) {
  const st = pk.st, mine = st.stacks[pk.me] || 0, saldo = pk.solo ? Infinity : pk.saldo || 0;
  const cap = st.buyMax - (rebuy ? mine : 0), max = Math.min(cap, saldo), min = rebuy ? Math.max(st.bb, Math.min(st.buyMin, cap)) : st.buyMin;
  if (cap < min) return toast('Você já está com o máximo de fichas desta mesa.');
  if (max < min) return toast(`Para sentar precisa de ${fichasTxt(min)} e você tem ${fichasTxt(saldo)} na carteira. Peça fichas à organização.`);
  const step = st.bb;
  const box = document.createElement('div');
  box.className = 'pk-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = `<div class="pk-modal-card">
      <h2>${rebuy ? 'Recomprar fichas' : 'Comprar fichas'}</h2>
      <p class="muted">Escolha quanto vai ${rebuy ? 'adicionar' : 'levar para a mesa'}.${pk.solo ? '' : ` Sai da sua carteira (você tem ${fichasTxt(saldo)}); ao levantar, o que sobrar volta.`}</p>
      <div class="pk-buy"><input type="range" id="pkBuyR" min="${min}" max="${max}" step="${step}" value="${Math.min(max, Math.max(min, st.bb * 50))}"><b id="pkBuyV"></b></div>
      <div class="row"><button class="primary" id="pkBuyOk">Sentar</button><button id="pkBuyNo">Cancelar</button></div>
    </div>`;
  document.body.appendChild(box);
  const r = box.querySelector('#pkBuyR'), v = box.querySelector('#pkBuyV');
  const show = () => (v.textContent = pkMoney(st, +r.value));
  r.oninput = show; show();
  box.querySelector('#pkBuyOk').textContent = rebuy ? 'Recomprar' : 'Sentar';
  box.querySelector('#pkBuyNo').onclick = () => box.remove();
  box.querySelector('#pkBuyOk').onclick = async () => {
    const amt = +r.value; box.remove();
    // primeiro tira da carteira; se não conseguir sentar, devolve
    const id = `${st.code}-entrada-${pk.me}-${Math.random().toString(36).slice(2, 8)}`;
    if (!pk.solo) {
      const w = await walletMove(pk.me, -amt, { id, tipo: 'entrada', table: st.code, name: myNick });
      if (w !== 'ok') return toast(w === 'sem-saldo' ? 'Saldo insuficiente.' : 'Não deu para tirar da carteira agora.');
    }
    let added = 0;
    const next = await pkCommit(s => {
      if (rebuy) {
        const inHand = s.phase === 'hand' && s.hand && s.hand.inHand.includes(s.seats.indexOf(pk.me)) && !s.hand.folded[s.seats.indexOf(pk.me)];
        if (inHand || s.seats.indexOf(pk.me) < 0) return false;
        const add = Math.min(amt, s.buyMax - (s.stacks[pk.me] || 0)); if (add <= 0) return false;
        s.stacks[pk.me] += add; s.bought[pk.me] = (s.bought[pk.me] || 0) + add; delete s.away[pk.me];
        added = add;
        return;
      }
      if (s.seats[i] || s.seats.includes(pk.me) || s.closedAt) return false;
      s.seats[i] = pk.me; s.names[pk.me] = myNick || pk.me;
      s.stacks[pk.me] = amt; s.bought[pk.me] = (s.bought[pk.me] || 0) + amt;
      delete s.away[pk.me];
      added = amt;
    });
    // o que não entrou na mesa volta para a carteira
    const back = next ? amt - added : amt;
    if (!pk.solo && back > 0) { await walletMove(pk.me, back, { id: id + '-volta', tipo: 'devolucao', table: st.code, name: myNick }); if (!next) toast('Não deu para sentar; as fichas voltaram para a carteira.'); }
  };
}
function pkStandUp() {
  const s = pkMySeat(); if (s < 0) return;
  if (pk.st.type === 'sng' && pk.st.sng.startedAt) return toast('No Sit & Go não dá para levantar no meio. Se sair, suas fichas continuam pagando os blinds.');
  pkCommit(st => {
    const k = pk.me, seat = st.seats.indexOf(k); if (seat < 0) return false;
    if (st.type === 'sng') { st.seats[seat] = null; delete st.stacks[k]; st.sng.paid = (st.sng.paid || []).filter(x => x !== k); pkPayout(st, k, st.sng.fee, 'devolucao'); return; }
    const h = st.hand;
    if (st.phase === 'hand' && h && h.inHand.includes(seat) && !h.folded[seat]) {
      st.leaving[k] = true;
      if (h.toAct === seat) pkAct(st, seat, 'fold');
      return;
    }
    pkCashOut(st, k);
  });
}
function pkBack() { pkCommit(st => { if (!st.away || !st.away[pk.me]) return false; delete st.away[pk.me]; }); }
async function pkCloseTable() {
  if (!confirm('Encerrar a mesa? As fichas de quem está sentado voltam para as carteiras.')) return;
  const next = await pkCommit(st => {
    if (st.closedAt) return false;
    if (st.phase === 'hand') { st.closing = true; return; }
    pkSettleState(st);
  });
  if (next && !next.closedAt) toast('A mesa fecha quando esta mão acabar.');
}
async function pkSngFinish() {
  // fim do Sit & Go: grava o resultado uma vez
  await pkCommit(st => { if (st.phase !== 'over' || st.closedAt) return false; st.closedAt = pkNow(); st.settled = true; });
}

/* ---------------- desenho da mesa ---------------- */
function pkRender() {
  const p = pk; if (!p || !p.st) return;
  const st = p.st, me = pkMySeat(), seated = me >= 0, view = seated ? me : 0, h = st.hand;
  if (!p.solo && st.closedAt && st.settled && !p.shownEnd) p.shownEnd = true;
  document.body.classList.add('in-game');
  const pos = (s, rad) => {
    const k = (s - view + st.n) % st.n, ang = (90 - (k * 360) / st.n) * Math.PI / 180;
    return { x: 50 + rad[0] * Math.cos(ang), y: 50 + rad[1] * Math.sin(ang) };
  };
  const inHand = s => h && st.phase !== 'waiting' && h.inHand.includes(s);
  const shownAt = s => h && h.shown && h.shown[s];
  const myC = p.myCards && h && p.myCards.hid === h.hid ? p.myCards.cards : null;
  let seatsHtml = '';
  for (let s = 0; s < st.n; s++) {
    const k = st.seats[s];
    const q = pos(s, s === me ? [40, 37] : [42, 35]);
    if (!k) {
      const canSit = !seated && st.phase !== 'over' && !st.closedAt && !(st.type === 'sng' && st.sng.startedAt);
      seatsHtml += `<div class="pseat empty" style="left:${q.x}%;top:${Math.min(q.y, 88)}%">${canSit ? `<button class="small" data-pksit="${s}">Sentar</button>` : '<span class="muted">vazio</span>'}</div>`;
      continue;
    }
    const folded = h && h.folded[s], turn = st.phase === 'hand' && h && h.toAct === s;
    const cards = shownAt(s) ? shownAt(s).map(c => pkCard(c)).join('') : inHand(s) && !folded && s !== me ? '<span class="card back"></span><span class="card back"></span>' : '';
    const won = st.result && st.result.won && st.result.won[s];
    const tags = [st.button === s && st.phase !== 'waiting' ? '<span class="dbtn" title="Botão">D</span>' : '', st.away && st.away[k] ? '<span class="tag">ausente</span>' : '', h && h.allin[s] && !folded && st.phase === 'hand' ? '<span class="tag allin">all-in</span>' : ''].join('');
    seatsHtml += `<div class="pseat ${turn ? 'turn' : ''} ${folded ? 'folded' : ''} ${won ? 'won' : ''} ${s === me ? 'me' : ''}" data-key="${esc(k)}" style="left:${q.x}%;top:${Math.min(q.y, 88)}%">
        ${avatarHtml(k, st.names[k] || k)}
        <span class="name">${esc(st.names[k] || k)}${s === me ? ' (você)' : ''}</span>
        <span class="stack">${pkMoney(st, st.stacks[k])}</span>
        ${tags ? `<span class="ptags">${tags}</span>` : ''}
        ${cards && s !== me ? `<span class="pcards">${cards}</span>` : ''}
        ${st.result && st.result.names && st.result.names[s] && st.phase === 'handEnd' ? `<span class="phand">${esc(st.result.names[s])}</span>` : ''}
      </div>`;
    const bet = h && st.phase === 'hand' ? h.bets[s] || 0 : 0;
    if (bet) { const b = pos(s, s === me ? [24, 18] : [27, 21]); seatsHtml += `<div class="pbet" style="left:${b.x}%;top:${b.y}%"><i></i>${pkMoney(st, bet)}</div>`; }
  }
  // meio da mesa: cartas abertas e pote
  const board = h && st.phase !== 'waiting' ? h.board : [];
  const slots = Array.from({ length: 5 }, (_, i) => (board[i] ? pkCard(board[i], 'b' + i) : '<span class="card slot"></span>')).join('');
  const pot = h && st.phase === 'hand' ? pkPotTotal(h) : 0;
  let center = `<div class="pboard">${slots}</div>`;
  if (pot) center += `<div class="ppot">Pote ${pkMoney(st, pot)}</div>`;
  if (st.phase === 'handEnd' && st.result) center += `<div class="presult">${pkResultText(st)}</div>`;
  if (st.phase === 'waiting') center += `<div class="presult">${pkWaitingText(st)}</div>`;
  if (st.phase === 'over' || st.phase === 'closed') center += `<div class="presult">${pkEndText(st)}</div>`;

  // minha mão e ações
  let mine = '', acts = '', msg = '';
  if (seated) {
    const cs = shownAt(me) || myC;
    if (inHand(me) && !(h && h.folded[me])) {
      mine = cs ? cs.map(c => pkCard(c)).join('') : '<span class="card back"></span><span class="card back"></span>';
      if (cs && h.board.length) msg = `<span class="pmade">${esc(pkHandName(pkEval([...cs, ...h.board])))}</span>`;
    } else if (inHand(me) && myC) mine = myC.map(c => pkCard(c, 'mucked')).join('');
    const myTurn = st.phase === 'hand' && h && h.toAct === me && !h.needStreet;
    if (myTurn) acts = pkActionsHtml(st, me);
    else if (st.phase === 'hand' && h && h.toAct >= 0) msg = `Vez de <b>${esc(st.names[st.seats[h.toAct]] || '')}</b>.` + (msg ? ' ' + msg : '');
  } else if (!p.solo) msg = '<span class="muted">Você está assistindo.</span>';
  const clock = st.phase === 'hand' && h && h.toAct >= 0 && !p.solo ? `<span id="pkClock" class="clock">${Math.max(0, Math.ceil((st.turnAt + PK.ACT_MS - pkNow()) / 1000))}s</span> ` : '';
  const k = p.me;
  const extra = [];
  if (seated && st.away && st.away[k] && st.stacks[k] > 0) extra.push('<button class="primary small" data-pk="back">Voltar ao jogo</button>');
  if (seated && !p.solo && st.type === 'cash' && !st.closedAt && (st.stacks[k] || 0) < st.buyMax && !(st.phase === 'hand' && inHand(me) && !h.folded[me])) extra.push(`<button class="small" data-pk="rebuy">${st.stacks[k] ? 'Recomprar' : 'Comprar fichas'}</button>`);
  if (seated && !st.closedAt && !(st.type === 'sng' && st.sng.startedAt) && !p.solo) extra.push(`<button class="small" data-pk="stand">${st.leaving && st.leaving[k] ? 'Saindo no fim da mão…' : 'Levantar'}</button>`);
  if (st.type === 'sng' && !st.sng.startedAt && (isOrg() || seated) && st.seats.filter(Boolean).length >= 2 && !p.solo) extra.push('<button class="primary small" data-pk="startsng">Começar o Sit &amp; Go</button>');
  if (!p.solo && st.type === 'cash' && isOrg() && !st.closedAt) extra.push(`<button class="danger small" data-pk="close">${st.closing ? 'Fecha no fim da mão…' : 'Encerrar mesa'}</button>`);
  if (p.solo && st.stacks[k] === 0) extra.push('<button class="primary small" data-pk="solorebuy">Recomeçar com fichas</button>');
  const lvl = st.type === 'sng' && st.sng.startedAt ? `<span class="tag">blinds ${pkBlindsLabel(st)} · <span id="pkLevel"></span></span>` : `<span class="tag">blinds ${pkBlindsLabel(st)}</span>`;
  const bar = `<div class="tablebar">${p.solo ? '<span class="tag">Treino</span>' : `<span class="code">${esc(st.name || st.code)}</span>`} ${lvl}<button class="small" data-leave>Saguão</button></div>`;
  $app.innerHTML = `
  <div class="game poker">
    <div class="board">
      ${bar}
      <div class="mesa pmesa">${seatsHtml}<div class="pcenter">${center}</div></div>
      <div class="actions"><p class="msg">${clock}${msg}</p>${acts}${extra.length ? `<div class="row" style="justify-content:center">${extra.join('')}</div>` : ''}</div>
      <div class="hand phand-mine">${mine}</div>
    </div>
  </div>`;
  $app.querySelectorAll('[data-leave]').forEach(b => (b.onclick = () => { pokerLeave(); history.replaceState(null, '', location.pathname); showLobby(); }));
  $app.querySelectorAll('[data-pksit]').forEach(b => (b.onclick = () => pkSit(+b.dataset.pksit)));
  $app.querySelectorAll('[data-pk]').forEach(b => (b.onclick = () => {
    const a = b.dataset.pk;
    if (a === 'back') pkBack();
    else if (a === 'rebuy') pkBuyIn(me, true);
    else if (a === 'stand') pkStandUp();
    else if (a === 'close') pkCloseTable();
    else if (a === 'startsng') pkCommit(s => { if (s.sng.startedAt || s.seats.filter(Boolean).length < 2) return false; pkStartSng(s); });
    else if (a === 'solorebuy') pkCommit(s => { s.stacks[pk.me] = 2000; delete s.away[pk.me]; });
  }));
  pkBindActions(st, me);
  if (st.phase === 'over' && !st.closedAt && seated && !p.solo) pkSngFinish();
  pkAnimate(st);
  if (typeof placeMusic === 'function') placeMusic();
}
function pkResultText(st) {
  const r = st.result, name = s => esc(st.names[st.seats[s]] || '');
  if (r.void) return 'Mão anulada: quem deu as cartas saiu. As fichas voltaram.';
  if (r.uncontested) { const s = r.pots[0].winners[0]; return `<b>${name(s)}</b> levou ${pkMoney(st, r.pots[0].amount)}`; }
  return r.pots.map((pt, i) => `${r.pots.length > 1 ? (i ? 'Pote paralelo: ' : 'Pote principal: ') : ''}<b>${pt.winners.map(name).join(' e ')}</b> ${pt.winners.length > 1 ? 'dividem' : 'leva'} ${pkMoney(st, pt.amount)}${pt.hand ? ` com ${esc(pt.hand)}` : ''}`).join('<br>');
}
function pkWaitingText(st) {
  const n = st.seats.filter(Boolean).length;
  if (st.type === 'sng' && !st.sng.startedAt) return `Sit &amp; Go: ${n} de ${st.n} inscritos. Começa quando encher ou quando tocarem em Começar. Entrada ${fichasTxt(st.sng.fee)}.`;
  return n < 2 ? 'Esperando mais jogadores sentarem…' : 'Esperando jogadores com fichas…';
}
function pkEndText(st) {
  if (st.type === 'sng') {
    if (st.cancelled) return 'Sit &amp; Go cancelado.';
    const order = [...st.sng.out].reverse();
    const net = pkNets(st);
    const prize = pkSngPrizes(st);
    return `<b>Fim do Sit &amp; Go</b><br>${order.slice(0, 3).map((k, i) => `${i + 1}º ${esc(st.names[k] || k)}${prize[k] ? ` <b>+${prize[k].toLocaleString('pt-BR')} fichas</b>` : ''}`).join('<br>')}<br><span class="muted">O prêmio vai direto para a carteira.</span>`;
  }
  return 'Mesa encerrada. As fichas de cada um voltaram para a carteira.';
}
// barra de ações: desistir, passar/pagar e aumentar com a régua
function pkActionsHtml(st, me) {
  const h = st.hand, k = st.seats[me], stack = st.stacks[k], bet = h.bets[me] || 0, toCall = h.curBet - bet;
  const maxTo = bet + stack, minTo = Math.min(maxTo, h.curBet + h.minRaise);
  const canRaise = maxTo > h.curBet && h.inHand.some(s => s !== me && !h.folded[s] && !h.allin[s]);
  const pot = pkPotTotal(h);
  const raiseWord = h.curBet > 0 ? 'Aumentar' : 'Apostar';
  const quick = [];
  if (canRaise) {
    const potTo = Math.min(maxTo, h.curBet + pot + toCall);
    const half = Math.min(maxTo, Math.max(minTo, h.curBet + Math.round((pot + toCall) / 2)));
    if (half > minTo && half < maxTo) quick.push(`<button class="small" data-to="${half}">½ pote</button>`);
    if (potTo > minTo && potTo < maxTo) quick.push(`<button class="small" data-to="${potTo}">Pote</button>`);
    quick.push(`<button class="small" data-to="${maxTo}">Tudo</button>`);
  }
  return `<div class="pact">
      <button class="danger" data-pa="fold">Desistir</button>
      ${toCall > 0 ? `<button class="primary" data-pa="call">Pagar ${pkMoney(st, Math.min(toCall, stack))}${toCall >= stack ? ' (all-in)' : ''}</button>` : '<button class="primary" data-pa="check">Passar</button>'}
      ${canRaise ? `<button class="shout" data-pa="raise" id="pkRaiseBtn">${raiseWord}</button>` : ''}
    </div>
    ${canRaise ? `<div class="praise"><input type="range" id="pkRaise" min="${minTo}" max="${maxTo}" step="${Math.max(1, st.unit === 'cents' ? 5 : 5)}" value="${minTo}" aria-label="Valor"><b id="pkRaiseV"></b></div><div class="row pquick">${quick.join('')}</div>` : ''}`;
}
function pkBindActions(st, me) {
  const r = document.getElementById('pkRaise'), v = document.getElementById('pkRaiseV'), btn = document.getElementById('pkRaiseBtn');
  const h = st.hand;
  const label = () => {
    if (!r) return;
    const to = +r.value, all = to >= +r.max;
    v.textContent = pkMoney(st, to);
    btn.textContent = all ? 'All-in!' : `${h.curBet > 0 ? 'Aumentar' : 'Apostar'} ${pkMoney(st, to)}`;
  };
  if (r) { r.oninput = label; label(); }
  $app.querySelectorAll('[data-to]').forEach(b => (b.onclick = () => { r.value = b.dataset.to; label(); }));
  $app.querySelectorAll('[data-pa]').forEach(b => (b.onclick = () => {
    const a = b.dataset.pa;
    if (a === 'raise') { const to = +r.value; if (to >= +r.max) shout('All-in!', '', ''); pkDo('raise', to); }
    else pkDo(a);
  }));
}
// som e movimento: cartas da mesa virando e fichas
function pkAnimate(st) {
  const p = pk, h = st.hand;
  const key = h ? h.hid + ':' + h.board.length : '';
  const fresh = p.animKey === undefined;
  if (!fresh && key !== p.animKey && h && h.board.length > (p.animBoard || 0) && p.animHid === h.hid) {
    const from = p.animBoard || 0;
    for (let i = from; i < h.board.length; i++) {
      const el = $app.querySelector('.pboard .b' + i);
      setTimeout(() => cardSound(0.7), (i - from) * 120);
      if (el && el.animate && !calmMotion()) el.animate([{ transform: 'rotateY(90deg) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: (i - from) * 120, easing: SMOOTH, fill: 'backwards' });
    }
  }
  if (!fresh && h && p.animHid !== h.hid) {
    for (let i = 0; i < 2; i++) setTimeout(() => cardSound(0.6), 140 * i);
    $app.querySelectorAll('.phand-mine .card').forEach((el, i) => el.animate && !calmMotion() && el.animate([{ transform: 'translateY(-120px) rotate(-10deg) scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: 140 * i, easing: SMOOTH, fill: 'backwards' }));
  }
  const last = h && h.last;
  if (!fresh && last && last.at !== p.animLast) {
    if (last.a === 'allin') { if (st.seats[last.seat] !== p.me) shout('All-in!', st.names[st.seats[last.seat]] || '', ''); }
    else if (last.a === 'fold') {} else cardSound(0.35);
  }
  p.animKey = key; p.animBoard = h ? h.board.length : 0; p.animHid = h ? h.hid : null; p.animLast = last ? last.at : null;
}

/* =========================================================
   TREINO CONTRA ROBÔS
   ========================================================= */
function pkStartSolo(n) {
  pokerLeave();
  pkEnterTableView();
  const me = myId || 'voce';
  const seats = [me, ...Array.from({ length: n - 1 }, (_, i) => 'bot' + (i + 1))];
  const names = { [me]: myNick || 'Você' };
  seats.slice(1).forEach((k, i) => (names[k] = 'Robô ' + PK_BOT_NAMES[i]));
  const stacks = {}; seats.forEach(k => (stacks[k] = 2000));
  const st = { code: 'TREINO', name: 'Treino', type: 'cash', unit: 'chips', n, seats, names, stacks, bought: {}, ledger: {}, away: {}, leaving: {}, phase: 'waiting', hand: null, button: randInt(n) - 1, sb: 10, bb: 20, buyMin: 400, buyMax: 2000 };
  pk = { code: 'TREINO', solo: true, me, st, priv: null, myCards: null };
  pk.timer = setInterval(pkTick, 400);
  pkRender();
  pkDeal();
}
// robôs jogam, o anfitrião (você) abre as ruas e a próxima mão sai sozinha
function pkSoloSchedule() {
  const p = pk; if (!p || !p.solo) return;
  clearTimeout(p.botT);
  const st = p.st, h = st.hand;
  if (st.phase !== 'hand' || !h || h.needStreet || h.toAct < 0) return;
  const k = st.seats[h.toAct];
  if (k === p.me) return;
  p.botT = setTimeout(() => {
    if (pk !== p) return;
    const s = h.toAct;
    const d = pkBotDecide(p.st, s, p.priv.hole[s]);
    pkCommit(x => {
      if (!(x.hand && x.hand.hid === h.hid && x.hand.toAct === s)) return false;
      // se a escolha do robô não valer, ele paga/passa ou desiste
      return pkAct(x, s, d.a, d.to) || pkAct(x, s, (x.hand.bets[s] || 0) >= x.hand.curBet ? 'check' : 'call') || pkAct(x, s, 'fold');
    });
  }, 650 + Math.random() * 700);
}
function pkBotDecide(st, s, hole) {
  const h = st.hand, k = st.seats[s], stack = st.stacks[k], bet = h.bets[s] || 0, toCall = h.curBet - bet, pot = pkPotTotal(h);
  let strength;
  if (!h.board.length) {
    const [a, b] = hole.map(pkVal).sort((x, y) => y - x), suited = hole[0][1] === hole[1][1];
    strength = (a + b) / 28 * 0.55 + (a === b ? 0.35 + a / 60 : 0) + (suited ? 0.06 : 0) + (a - b === 1 ? 0.04 : 0);
  } else {
    const sc = pkEval([...hole, ...h.board]), boardSc = h.board.length >= 5 ? pkEval(h.board) : [-1];
    strength = [0.15, 0.45, 0.65, 0.78, 0.85, 0.88, 0.94, 0.98, 1][sc[0]] + (sc[0] === 1 ? (sc[1] - 8) / 40 : 0);
    if (pkCmp(sc, boardSc) <= 0) strength = 0.2; // a mesa faz tudo, eu não tenho nada
  }
  strength = Math.max(0, Math.min(1, strength + (Math.random() - 0.5) * 0.18));
  const odds = toCall / Math.max(1, pot + toCall);
  const minTo = Math.min(bet + stack, h.curBet + h.minRaise);
  const sizeTo = f => Math.min(bet + stack, Math.max(minTo, h.curBet + Math.round((pot + toCall) * f / st.bb) * st.bb));
  if (strength > 0.82 && Math.random() < 0.75) return { a: 'raise', to: sizeTo(0.6 + Math.random() * 0.6) };
  if (strength > 0.6 && toCall === 0 && Math.random() < 0.5) return { a: 'raise', to: sizeTo(0.5) };
  if (toCall === 0) return Math.random() < 0.08 ? { a: 'raise', to: sizeTo(0.5) } : { a: 'check' };
  if (strength > odds + 0.25 || (strength > 0.45 && odds < 0.25)) return { a: 'call' };
  return Math.random() < 0.05 ? { a: 'call' } : { a: 'fold' };
}

// botão "Sair" do topo também funciona nos saguões do poker e da cacheta
function pkBindLogout() { const b = document.getElementById('logout'); if (b) b.onclick = logout; }
