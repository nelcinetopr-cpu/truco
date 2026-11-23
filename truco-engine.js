/* =========================================================
   MOTOR DO TRUCO — Truco Paulista (baralho de 40 cartas, com vira)
   Só regras, sem tela e sem banco: o mesmo arquivo roda no navegador
   (window.TrucoEngine) e no servidor/testes (require).
   Toda mudança de estado passa por applyAction() ou timeoutMove(),
   que devolvem false quando a jogada não vale.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrucoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
  const SUITS = ['o', 'e', 'c', 'p']; // ouros < espadas < copas < paus (zap), ordem das manilhas
  const SUIT_SYM = { o: '♦', e: '♠', c: '♥', p: '♣' };
  const RAISE_NAME = { 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' };
  const NEXT_VALUE = { 1: 3, 3: 6, 6: 9, 9: 12 };
  const team = s => s % 2;

  function manilhaRank(vira) { return RANKS[(RANKS.indexOf(vira[0]) + 1) % RANKS.length]; }
  function isManilha(c, vira) { return c[0] === manilhaRank(vira); }
  function strength(c, vira) { return isManilha(c, vira) ? 100 + SUITS.indexOf(c[1]) : RANKS.indexOf(c[0]); }
  function cardLabel(c) { return c[0] + SUIT_SYM[c[1]]; }

  // sorteio: inteiro de 0 a n-1 (criptográfico por padrão; os testes passam um sorteio fixo)
  function randInt(n) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; }
  function newDeck(rng = randInt) {
    const d = [];
    for (const r of RANKS) for (const s of SUITS) d.push(r + s);
    for (let i = d.length - 1; i > 0; i--) { const j = rng(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function nextOfTeam(from, t, n) { for (let i = 1; i <= n; i++) { const s = (from + i) % n; if (team(s) === t) return s; } return from; }
  function firstOfTeamFrom(start, t, n) { for (let i = 0; i < n; i++) { const s = (start + i) % n; if (team(s) === t) return s; } return start; }
  function nick(st, seat) { const id = st.seats[seat]; return (id && st.names[id]) || 'Jogador ' + (seat + 1); }
  function teamLabel(t) { return t === 0 ? 'Time 1' : 'Time 2'; }
  function addLog(st, text) { st.log = [text, ...(st.log || [])].slice(0, 10); }

  function deal(st, rng = randInt) {
    const n = st.n, deck = newDeck(rng);
    const hands = [];
    for (let s = 0; s < n; s++) hands.push(deck.splice(0, 3));
    const vira = deck.pop();
    const mao = (st.dealer + 1) % n;
    const [a, b] = st.score;
    const ferro = a === 11 && b === 11;
    const onzeTeam = !ferro && (a === 11 || b === 11) ? (a === 11 ? 0 : 1) : -1;
    st.hand = {
      hid: Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rng(36)]).join(''), // identifica a mão (animações)
      vira, hands, played: [[]], rw: [], turn: mao, mao, value: 1, lastRaise: -1, pending: null,
      ferro, onzeTeam, onzeDecider: onzeTeam >= 0 ? firstOfTeamFrom(mao, onzeTeam, n) : -1,
    };
    st.result = null;
    st.phase = onzeTeam >= 0 ? 'onze' : 'play';
    addLog(st, `${nick(st, st.dealer)} deu as cartas. Vira ${cardLabel(vira)}, manilha é ${manilhaRank(vira)}.`);
    if (ferro) addLog(st, 'Mão de ferro: ninguém vê as cartas do parceiro, vale 1 e sem truco.');
    if (onzeTeam >= 0) addLog(st, `Mão de onze para o ${teamLabel(onzeTeam)}.`);
  }

  // Quem leva a mão a partir dos resultados das vazas (-1 = empate/cangou).
  // Retorna o time vencedor, -1 se empatou tudo, ou null se a mão continua.
  // raiser = time que fez o último pedido aceito (truco, seis...), ou -1 se ninguém pediu.
  // Quem pediu precisa ganhar: se as vazas só empatam, quem pediu perde
  // (na segunda vaza empatada depois da primeira empatada, ou com as três empatadas).
  function decideHand(rw, raiser = -1) {
    const [a, b, c] = rw;
    if (rw.length < 2) return null;
    if (rw.length === 2) {
      if (a === -1 && b !== -1) return b;
      if (a !== -1 && b === -1) return a;
      if (a !== -1 && a === b) return a;
      if (a === -1 && b === -1 && raiser >= 0) return 1 - raiser;
      return null;
    }
    if (c === -1) { if (a !== -1) return a; if (b !== -1) return b; return raiser >= 0 ? 1 - raiser : -1; }
    return c;
  }

  function endHand(st, winner, points, reason) {
    const h = st.hand;
    h.pending = null;
    if (winner >= 0) st.score[winner] += points;
    st.result = { winner, points, reason };
    addLog(st, winner >= 0 ? `${teamLabel(winner)} fez ${points} ${points === 1 ? 'tento' : 'tentos'} (${reason}).` : 'Empatou tudo, ninguém marca.');
    const champ = st.score[0] >= 12 ? 0 : st.score[1] >= 12 ? 1 : -1;
    if (champ < 0) { st.phase = 'handEnd'; return; }
    st.phase = 'gameEnd';
    const delta = {};
    st.seats.forEach((id, s) => { if (id) delta[id] = (delta[id] || 0) + (team(s) === champ ? st.stake : -st.stake); });
    st.balances = st.balances || {};
    for (const id in delta) st.balances[id] = (st.balances[id] || 0) + delta[id];
    st.games = [{ n: st.gameNo, winner: champ, score: [...st.score], at: Date.now(), delta }, ...(st.games || [])].slice(0, 50);
    addLog(st, `${teamLabel(champ)} ganhou a partida ${st.gameNo} por ${Math.min(st.score[champ], 12)} a ${st.score[1 - champ]}. Cada um do time leva ${st.stake} ${st.stake === 1 ? 'ficha' : 'fichas'}.`);
  }

  function playCard(st, seat, idx, covered) {
    const h = st.hand;
    const card = h.hands[seat].splice(idx, 1)[0];
    const r = h.rw.length;
    h.played[r].push({ seat, card, covered: !!covered });
    if (h.played[r].length < st.n) { h.turn = (seat + 1) % st.n; return; }
    const plays = h.played[r];
    const str = p => (p.covered ? -1 : strength(p.card, h.vira));
    const best = Math.max(...plays.map(str));
    const top = plays.filter(p => str(p) === best);
    const teams = new Set(top.map(p => team(p.seat)));
    let w = teams.size === 1 ? team(top[0].seat) : -1;
    let lead = top[0], bySuit = false;
    // Três empates sem truco: na última vaza ganha o naipe mais forte (paus > copas > espadas > ouros).
    if (w === -1 && r === 2 && h.rw[0] === -1 && h.rw[1] === -1 && h.lastRaise < 0) {
      const open = top.filter(p => !p.covered);
      if (open.length) {
        lead = open.reduce((x, y) => (SUITS.indexOf(y.card[1]) > SUITS.indexOf(x.card[1]) ? y : x));
        w = team(lead.seat); bySuit = true;
      }
    }
    h.rw.push(w);
    addLog(st, w >= 0 ? `Vaza ${r + 1}: ${nick(st, lead.seat)} fez com ${lead.covered ? 'carta coberta' : cardLabel(lead.card)}${bySuit ? ' pelo naipe' : ''}.` : `Vaza ${r + 1} cangou (empate).`);
    const dec = decideHand(h.rw, h.lastRaise);
    const onlyTies = h.rw.every(x => x === -1);
    if (dec !== null) return endHand(st, dec, h.value, bySuit ? 'empatou as três: ganhou o naipe mais forte' : onlyTies && dec >= 0 ? 'empatou com truco: quem pediu tinha que ganhar' : 'nas vazas');
    h.played.push([]);
    h.turn = lead.seat;
  }

  function canCallTruco(st, seat) {
    const h = st.hand;
    return st.phase === 'play' && h.turn === seat && !h.ferro && h.onzeTeam < 0 && h.value < 12 && h.lastRaise !== team(seat);
  }

  // Quem precisa agir agora, ou -1. Na hora de dar as cartas é o próximo a dar.
  function currentActor(st) {
    const h = st.hand;
    if (!h) return -1;
    if (st.phase === 'play') return h.turn;
    if (st.phase === 'truco') return h.pending.responder;
    if (st.phase === 'onze') return h.onzeDecider;
    if (st.phase === 'handEnd') return (st.dealer + 1) % st.n;
    return -1;
  }

  function lowestCardIndex(cards, vira) {
    let low = 0;
    cards.forEach((c, i) => { if (strength(c, vira) < strength(cards[low], vira)) low = i; });
    return low;
  }

  // Uma jogada do jogador da cadeira `seat`. Devolve true se valeu, false se não vale.
  // action: { type: 'play', index, covered } | { type: 'truco' | 'accept' | 'run' | 'raise' |
  //          'onzePlay' | 'onzeRun' | 'next' | 'newGame' }
  // opts.allowNewGame: nova partida na mesma mesa (só no treino); opts.rng: sorteio das cartas.
  function applyAction(st, seat, action, opts = {}) {
    const h = st.hand, p = h && h.pending, type = action && action.type;
    const rng = opts.rng || randInt;
    switch (type) {
      case 'play': {
        if (st.phase !== 'play' || !h || h.turn !== seat) return false;
        const i = action.index;
        if (!Number.isInteger(i) || i < 0 || i >= h.hands[seat].length) return false;
        playCard(st, seat, i, !!action.covered && h.rw.length >= 1); // coberta só a partir da segunda vaza
        return true;
      }
      case 'truco':
        if (!h || !canCallTruco(st, seat)) return false;
        h.pending = { to: NEXT_VALUE[h.value], by: team(seat), caller: seat, responder: nextOfTeam(seat, 1 - team(seat), st.n) };
        st.phase = 'truco';
        addLog(st, `${nick(st, seat)} pediu ${RAISE_NAME[h.pending.to].toLowerCase()}!`);
        return true;
      case 'accept':
        if (st.phase !== 'truco' || p.responder !== seat) return false;
        h.value = p.to; h.lastRaise = p.by; h.pending = null; st.phase = 'play';
        addLog(st, `${nick(st, seat)} aceitou. Valendo ${h.value}.`);
        return true;
      case 'run':
        if (st.phase !== 'truco' || p.responder !== seat) return false;
        addLog(st, `${nick(st, seat)} correu.`);
        endHand(st, p.by, h.value, 'o outro time correu');
        return true;
      case 'raise':
        if (st.phase !== 'truco' || p.responder !== seat || p.to >= 12) return false;
        h.value = p.to; h.lastRaise = p.by;
        h.pending = { to: NEXT_VALUE[p.to], by: team(seat), caller: seat, responder: p.caller };
        addLog(st, `${nick(st, seat)} pediu ${RAISE_NAME[h.pending.to].toLowerCase()}!`);
        return true;
      case 'onzePlay':
        if (st.phase !== 'onze' || h.onzeDecider !== seat) return false;
        h.value = 3; st.phase = 'play';
        addLog(st, `${teamLabel(team(seat))} vai jogar a mão de onze.`);
        return true;
      case 'onzeRun':
        if (st.phase !== 'onze' || h.onzeDecider !== seat) return false;
        addLog(st, `${teamLabel(team(seat))} correu da mão de onze.`);
        endHand(st, 1 - team(seat), 1, 'correram da mão de onze');
        return true;
      case 'next':
        if (st.phase !== 'handEnd') return false;
        st.dealer = (st.dealer + 1) % st.n;
        deal(st, rng);
        return true;
      case 'newGame':
        if (st.phase !== 'gameEnd' || !opts.allowNewGame) return false;
        st.score = [0, 0]; st.gameNo++; st.dealer = (st.dealer + 1) % st.n;
        addLog(st, `Começou a partida ${st.gameNo}.`);
        deal(st, rng);
        return true;
      default:
        return false;
    }
  }

  // Tempo esgotado: joga a menor carta; truco sem resposta = correu; mão de onze sem
  // decisão = correu; fim da mão = dá as cartas. Determinística (a mesma para todos).
  function timeoutMove(st, opts = {}) {
    const h = st.hand, actor = currentActor(st);
    if (actor < 0) return false;
    if (st.phase === 'play') {
      addLog(st, `Tempo esgotado: ${nick(st, actor)} jogou a menor carta.`);
      playCard(st, actor, lowestCardIndex(h.hands[actor], h.vira), false);
    } else if (st.phase === 'truco') {
      addLog(st, `Tempo esgotado: ${nick(st, actor)} não respondeu e correu.`);
      endHand(st, h.pending.by, h.value, 'tempo esgotado: o outro time correu');
    } else if (st.phase === 'onze') {
      addLog(st, `Tempo esgotado na mão de onze: ${teamLabel(team(actor))} correu.`);
      endHand(st, 1 - team(actor), 1, 'tempo esgotado na mão de onze');
    } else if (st.phase === 'handEnd') {
      st.dealer = actor;
      deal(st, opts.rng || randInt);
    } else return false;
    return true;
  }

  return {
    RANKS, SUITS, SUIT_SYM, RAISE_NAME, NEXT_VALUE, team,
    manilhaRank, isManilha, strength, cardLabel, randInt, newDeck,
    nextOfTeam, firstOfTeamFrom, nick, teamLabel, addLog,
    deal, decideHand, endHand, playCard, canCallTruco, currentActor, lowestCardIndex,
    applyAction, timeoutMove,
  };
});
