// 🤖 بوت «بالوت» — يشتري ويضاعف ويلعب الورقة.
//
// ليس بحّاثًا في شجرة الاحتمالات، بل مجموعةُ قواعدَ يلعب بها لاعبٌ متوسّط:
// اشترِ إذا كانت يدك قويّة، اقتُل بأرخص ورقةٍ تكفي، ألقِ نقاطك على أكلة
// شريكك ولا تلقِها على أكلة الخصم. وهذا يكفي: البوت هنا ليملأ مقعدًا
// فارغًا لا ليهزم أحدًا — والمباراةُ التي فيها بوتٌ لا ذهب فيها أصلًا.
//
// الصعوبة ثلاث: ١ يشتري بحذر ويلعب بسيطًا، ٢ يوازن، ٣ يشتري أكثر ويحتفظ
// بالأوراق الغالية حين لا تُجدي.

"use strict";

const E = require("./balootrules");
const { rankOf, suitOf } = E;

/* تقديرُ قوّةِ يدٍ بالنقاط لا بالقيَم: الجَك في الحكم يساوي ثلاثين تقديرًا
   لا عشرين، لأن قيمته في اللعب أكبر من قيمته في الحساب. */
const SUN_W = { A: 14, "10": 9, K: 5, Q: 3, J: 2, "9": 1, "8": 0, "7": 0 };
const TRUMP_W = { J: 30, "9": 22, A: 14, "10": 10, K: 6, Q: 5, "8": 3, "7": 3 };
const SIDE_W = { A: 10, "10": 6, K: 3, Q: 1, J: 1, "9": 0, "8": 0, "7": 0 };

function handStrength(hand, mode, trump) {
  let s = 0;
  for (const c of hand) {
    const r = rankOf(c), su = suitOf(c);
    if (mode === "hokum") s += (su === trump ? TRUMP_W : SIDE_W)[r];
    else s += SUN_W[r];
  }
  if (mode === "hokum") s += hand.filter(c => suitOf(c) === trump).length * 4;
  return s;
}

function chooseBid(m, seat, difficulty = 1) {
  const opts = m.bidOptions(seat);
  if (!opts.length) return null;
  const opt = id => opts.find(o => o.id === id);
  const withCard = m.hands[seat].concat([m.bidCard]);
  const thr = 1 - 0.15 * (difficulty - 1);       /* الأصعب يشتري أكثر */
  const sunS = handStrength(withCard, "sun");

  if (opt("gahwa") && sunS >= 55) return { choice: "gahwa" };

  if (m.bidRound === 1) {
    const bidSuit = suitOf(m.bidCard);
    const hokumS = handStrength(withCard, "hokum", bidSuit);
    if (opt("sun") && sunS >= 40 * thr && (!m.hokumBid || sunS >= 46 * thr)) return { choice: "sun" };
    if (opt("hokum") && hokumS >= 62 * thr) return { choice: "hokum", suit: bidSuit };
    /* أشكل: الورقة تصلح حكمًا لكن يدي لا تحتمله — فليشترِ شريكي */
    if (opt("ashkal") && hokumS >= 50 * thr && hokumS < 62 * thr) return { choice: "ashkal", suit: bidSuit };
    return { choice: "pass" };
  }

  if (opt("sun") && sunS >= 36 * thr) return { choice: "sun" };
  let best = null;
  for (const o of opts) {
    if (o.id !== "hokum") continue;
    const s = handStrength(withCard, "hokum", o.suit);
    if (!best || s > best.s) best = { s, suit: o.suit };
  }
  if (best && best.s >= 56 * thr) return { choice: "hokum", suit: best.suit };
  return { choice: "pass" };
}

function chooseDouble(m, seat, difficulty = 1) {
  const opts = m.doubleOptions(seat);
  if (!opts.length) return null;
  const s = handStrength(m.hands[seat], "hokum", m.trump);
  const opp = (seat % 2) !== (m.buyerSeat % 2);
  const id = opts[0].id;
  const bump = (difficulty - 2) * 3;             /* الأصعب أجرأ قليلًا */
  if (id === "double" && opp && s >= 58 - bump) return { choice: "double" };
  if (id === "three" && s >= 66 - bump) return { choice: "three" };
  if (id === "four" && s >= 74 - bump) return { choice: "four" };
  return { choice: "pass" };
}

function chooseCard(m, seat, difficulty = 1) {
  const legal = m.legalMoves(seat);
  if (!legal.length) return null;
  const { mode, trump, trick } = m;
  const led = trick.length ? suitOf(trick[0].card) : null;
  const str = c => E.strength(c, mode, trump, led || suitOf(c));
  const val = c => E.cardValue(c, mode, trump);
  const declare = m.declarableProjects(seat).length > 0;
  const finish = card => ({ card, declare, baloot: m.canDeclareBaloot(seat, card) });

  /* الافتتاح: اخرج بورقةٍ أنت أعلى ما بقي منها، وإلا فبأرخص ما ليس حكمًا */
  if (!trick.length) {
    const hand = m.hands[seat];
    const played = new Set(m.tricks.flatMap(t => t.cards.map(c => c.card)));
    const isTop = c => {
      const s = suitOf(c);
      const order = (mode === "hokum" && s === trump) ? E.TRUMP_ORDER : E.SUN_ORDER;
      return order.slice(order.indexOf(rankOf(c)) + 1)
        .map(r => r + s).every(h => played.has(h) || hand.includes(h));
    };
    const tops = legal.filter(isTop);
    if (tops.length) {
      const trumps = tops.filter(c => suitOf(c) === trump);
      /* الشاري يسحب الحكم من أيدي الخصوم مبكّرًا */
      if (mode === "hokum" && trumps.length && (seat % 2) === (m.buyerSeat % 2)) return finish(trumps[0]);
      const side = tops.filter(c => suitOf(c) !== trump);
      if (side.length) return finish(side.sort((a, b) => val(b) - val(a))[0]);
      return finish(tops[0]);
    }
    const low = legal.filter(c => suitOf(c) !== trump).sort((a, b) => val(a) - val(b) || str(a) - str(b));
    return finish(low[0] || legal.slice().sort((a, b) => str(a) - str(b))[0]);
  }

  const winnerSeat = E.trickWinner(trick, mode, trump);
  const partnerWinning = (winnerSeat % 2) === (seat % 2);
  const bestStr = Math.max(...trick.map(t => E.strength(t.card, mode, trump, led)));
  const pts = trick.reduce((a, t) => a + val(t.card), 0);
  const winning = legal.filter(c => str(c) > bestStr);

  if (partnerWinning) {
    /* أكلةُ شريكي: ألقِ فيها نقاطي إن كانت مضمونة، وإلا فاحتفظ بها */
    const safe = legal.filter(c => str(c) <= bestStr || suitOf(c) !== led);
    const pool = safe.length ? safe : legal;
    const topRank = (mode === "hokum" && led === trump) ? "J" : "A";
    const sure = trick.length === 3 || bestStr >= 100 ||
                 rankOf(trick.find(t => t.seat === winnerSeat).card) === topRank;
    return finish(pool.sort((a, b) => sure ? (val(b) - val(a) || str(a) - str(b))
                                           : (val(a) - val(b) || str(a) - str(b)))[0]);
  }

  if (winning.length) {
    const cheapest = winning.slice().sort((a, b) => str(a) - str(b))[0];
    /* أكلةٌ فقيرة وورقتي غالية: لا أحرقها مبكّرًا إن كان بعدي لاعبون */
    if (difficulty >= 2 && trick.length < 3 && pts + val(cheapest) < 10 && val(cheapest) >= 10) {
      const cheap = legal.filter(c => !winning.includes(c)).sort((a, b) => val(a) - val(b) || str(a) - str(b));
      if (cheap.length) return finish(cheap[0]);
    }
    return finish(cheapest);
  }
  /* لا أستطيع أخذها: ألقِ أرخص ما عندي */
  return finish(legal.slice().sort((a, b) => val(a) - val(b) || str(a) - str(b))[0]);
}

/* فعلٌ واحدٌ مناسبٌ للطور الحاليّ — يستعملها الخادم بلا أن يعرف الأطوار */
function botAction(m, seat, difficulty = 2) {
  if (m.phase === "bidding" && m.bidTurn === seat) {
    const b = chooseBid(m, seat, difficulty);
    return b && { kind: "bid", ...b };
  }
  if (m.phase === "doubling" && (m.doubleTurn % 2) === (seat % 2) && m.doubleTurn === seat) {
    const d = chooseDouble(m, seat, difficulty);
    return d && { kind: "double", ...d };
  }
  if (m.phase === "playing" && m.turn === seat) {
    const c = chooseCard(m, seat, difficulty);
    return c && { kind: "play", ...c };
  }
  return null;
}

module.exports = { chooseBid, chooseDouble, chooseCard, botAction, handStrength };
