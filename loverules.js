/* 💌 «رسالة حب» — القواعد (بلا شبكة ولا مؤقّتات: هذه في lovesrv.js).
 *
 * لعبةُ استنتاجٍ وخداعٍ قصيرة بستّ عشرة بطاقة (على نسق Love Letter الكلاسيكيّة):
 *   الحارس ١ ×٥ · الكاهن ٢ ×٢ · البارون ٣ ×٢ · الخادمة ٤ ×٢ · الأمير ٥ ×٢ ·
 *   الملك ٦ ×١ · الكونتيسة ٧ ×١ · الأميرة ٨ ×١
 *
 * الجولة: تُخلط البطاقات وتُحرق واحدةٌ سرًّا (ومع لاعبَين تُكشف ثلاثٌ أخرى
 * وتُبعد)، ولكلٍّ بطاقة. في دورك تسحب فتصير معك اثنتان، وتلعب إحداهما مكشوفةً
 * فتنفّذ قدرتها. تنتهي الجولة إذا بقي لاعبٌ واحد، أو إذا نفدت الكومة بعد دورٍ
 * (فتُكشف الأيدي، والأعلى يكسب — والتعادلُ بمجموع ما رماه كلٌّ، ثمّ يكسبون
 * جميعًا). والفوزُ بالنجوم: ٧ للاعبَين، و٥ لثلاثة، و٤ لأربعة.
 *
 * البطاقاتُ قيمٌ (١–٨) لا معرّفات: النسختان من الحارس سواءٌ تمامًا. والعرضُ لكلّ
 * لاعبٍ يحجب يدَ غيره والكومةَ والمحروقة، إلا ما عرفه هو بالكاهن أو البارون أو
 * الملك (في «known»، ويسقط حين تتغيّر تلك اليد).
 */
"use strict";

const COPIES = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1 };
const NAMES = { 1: "الحارس", 2: "الكاهن", 3: "البارون", 4: "الخادمة", 5: "الأمير", 6: "الملك", 7: "الكونتيسة", 8: "الأميرة" };
const MIN_PLAYERS = 2, MAX_PLAYERS = 4;
const TARGET = { 2: 7, 3: 5, 4: 4 };
/** بطاقاتٌ تحتاج هدفًا (الأميرُ يجوز على نفسك) */
const NEEDS_TARGET = new Set([1, 2, 3, 5, 6]);

/** مولّدٌ عشوائيٌّ حتميٌّ للاختبارات (mulberry32) */
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fullDeck() {
  const d = [];
  for (const v of Object.keys(COPIES)) for (let i = 0; i < COPIES[v]; i++) d.push(+v);
  return d;
}

class LoveMatch {
  /**
   * @param players [{id, name}] بترتيب الجلوس
   * @param opts.rng مولّدٌ عشوائيّ
   */
  constructor(players, opts = {}) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error("من لاعبَين إلى ٤ لاعبين");
    this.rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    this.players = players.map((p, i) => ({ id: p.id, name: p.name, seat: i, hand: [], discards: [], stars: 0,
                                            out: false, protected: false }));
    this.target = TARGET[players.length];
    this.round = 0;
    this.phase = "turn";
    this.turn = null;
    this.deck = [];
    this.burned = null;
    this.faceUp = [];
    this.log = [];
    this.result = null;
    this.winner = null;
    this.events = [];
    this.know = {};              /* know[a][b] = قيمةُ ما يعرفه a في يد b */
    this.starter = this.players[Math.floor(this.rng() * this.players.length)].id;
    this.startRound();
  }

  /* ══════════ أدوات ══════════ */
  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  p(id) { return this.players.find(x => x.id === id) || null; }
  alive() { return this.players.filter(x => !x.out); }
  nextOf(id) {
    const n = this.players.length;
    const i = this.players.findIndex(x => x.id === id);
    for (let k = 1; k <= n; k++) { const x = this.players[(i + k) % n]; if (!x.out) return x.id; }
    return null;
  }
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* المعرفة: من يعرف ماذا في يد من */
  learn(a, b, v) { if (a !== b) (this.know[a] = this.know[a] || {})[b] = v; }
  forgetAbout(b) { for (const a of Object.keys(this.know)) delete this.know[a][b]; }

  /* ══════════ الجولة ══════════ */
  startRound() {
    this.round++;
    this.deck = this.shuffle(fullDeck());
    this.burned = this.deck.pop();
    this.faceUp = this.players.length === 2 ? [this.deck.pop(), this.deck.pop(), this.deck.pop()] : [];
    this.log = [];
    this.know = {};
    this.result = null;
    for (const x of this.players) { x.out = false; x.protected = false; x.discards = []; x.hand = [this.deck.pop()]; }
    this.phase = "turn";
    this.ev({ t: "round", round: this.round, starter: this.starter, faceUp: this.faceUp.slice() });
    this.beginTurn(this.starter);
  }

  /** بداية الدور: تسقط حمايةُ الخادمة، ويسحب صاحبُ الدور تلقائيًّا */
  beginTurn(id) {
    const x = this.p(id);
    this.turn = id;
    x.protected = false;
    const c = this.deck.pop();
    x.hand.push(c);
    this.ev({ t: "turn", turn: id, deckN: this.deck.length });
    this.ev({ t: "drew", card: c, _only: id });
  }

  /** الكونتيسةُ مع الملك أو الأمير: لا تُلعب غيرُها */
  forced(x) { return x.hand.includes(7) && (x.hand.includes(5) || x.hand.includes(6)); }
  playable(x) { return this.forced(x) ? [7] : [...new Set(x.hand)]; }
  /** الأهدافُ الجائزة لبطاقة: خصومٌ في الجولة غيرُ محميّين (والأميرُ يضيفك) */
  targetsFor(id, card) {
    if (!NEEDS_TARGET.has(card)) return [];
    const others = this.alive().filter(y => y.id !== id && !y.protected).map(y => y.id);
    return card === 5 ? [...others, id] : others;
  }

  /**
   * لعبُ بطاقة
   * @param d.target هدفُها (إن احتاجت)، ‎d.guess‎ تخمينُ الحارس (٢–٨)
   */
  play(id, card, d = {}) {
    if (this.phase !== "turn") throw new Error("ليس وقتَ اللعب");
    if (this.turn !== id) throw new Error("ليس دورك");
    const x = this.p(id);
    card = Math.floor(Number(card));
    if (!x.hand.includes(card)) throw new Error("ليست في يدك");
    if (!this.playable(x).includes(card)) throw new Error("الكونتيسةُ مع الملك أو الأمير: لا بدّ أن تلعبها 🌹");
    const tg = this.targetsFor(id, card);
    let target = d.target == null || d.target === "" ? null : String(d.target);
    let guess = null;
    if (NEEDS_TARGET.has(card)) {
      if (tg.length) {
        if (!target || !tg.includes(target)) throw new Error(target && this.p(target) && this.p(target).protected ? "محميٌّ بالخادمة 🫖" : "اختر هدفًا");
      } else target = null;            /* الكلُّ محميّ: تُلعب بلا أثر */
      if (card === 1 && target) {
        guess = Math.floor(Number(d.guess));
        if (!(guess >= 2 && guess <= 8)) throw new Error("خمّن بطاقةً من ٢ إلى ٨ (لا تخمين للحارس)");
      }
    } else target = null;

    /* تُرمى مكشوفة */
    x.hand.splice(x.hand.indexOf(card), 1);
    x.discards.push(card);
    for (const a of Object.keys(this.know)) if (this.know[a][id] === card) delete this.know[a][id];
    const entry = { n: this.log.length + 1, by: id, card, target, guess };
    const after = [];

    if (target || card === 4 || card === 7 || card === 8) {
      const t = target ? this.p(target) : null;
      switch (card) {
        case 1: {
          entry.hit = t.hand[0] === guess;
          if (entry.hit) after.push(() => this.eliminate(t, "guard", id));
          break;
        }
        case 2: {
          this.learn(id, t.id, t.hand[0]);
          after.push(() => this.ev({ t: "peek", target: t.id, card: t.hand[0], _only: id }));
          break;
        }
        case 3: {
          const a = x.hand[0], b = t.hand[0];
          this.learn(id, t.id, b); this.learn(t.id, id, a);
          entry.loser = a < b ? id : b < a ? t.id : null;
          if (entry.loser) entry.loserCard = entry.loser === id ? a : b;      /* تُكشف بخروجه */
          after.push(() => {
            this.ev({ t: "baron", by: id, vs: t.id, mine: a, theirs: b, _only: id });
            this.ev({ t: "baron", by: id, vs: t.id, mine: b, theirs: a, _only: t.id });
            if (entry.loser) this.eliminate(this.p(entry.loser), "baron", entry.loser === id ? t.id : id);
          });
          break;
        }
        case 4: x.protected = true; break;
        case 5: {
          const old = t.hand.pop();
          t.discards.push(old);
          entry.discarded = old;
          this.forgetAbout(t.id);
          if (old === 8) after.push(() => this.eliminate(t, "prince", id));
          else {
            let nw;
            if (this.deck.length) nw = this.deck.pop();
            else { nw = this.burned; this.burned = null; entry.fromBurn = true; }
            t.hand = [nw];
            after.push(() => this.ev({ t: "drew", card: nw, by: "prince", _only: t.id }));
          }
          break;
        }
        case 6: {
          const mine = x.hand[0], theirs = t.hand[0];
          x.hand = [theirs]; t.hand = [mine];
          /* من كان يعرف يدَ أحدهما صار يعرفها عند الآخر (التبديلُ علنيّ) */
          for (const a of Object.keys(this.know)) {
            const K = this.know[a], kx = K[id], kt = K[t.id];
            delete K[id]; delete K[t.id];
            if (kx != null) K[t.id] = kx;
            if (kt != null) K[id] = kt;
          }
          this.learn(id, t.id, mine); this.learn(t.id, id, theirs);
          after.push(() => {
            this.ev({ t: "swap", by: id, vs: t.id, got: theirs, gave: mine, _only: id });
            this.ev({ t: "swap", by: id, vs: t.id, got: mine, gave: theirs, _only: t.id });
          });
          break;
        }
        case 7: break;
        case 8: after.push(() => this.eliminate(x, "princess", null)); break;
      }
    } else entry.noEffect = true;

    this.log.push(entry);
    this.ev({ t: "play", ...entry });
    for (const f of after) f();
    this.endTurn(id);
  }

  /** خروجٌ من الجولة: تُكشف يدُه (تُرمى)، وتُنسى المعرفةُ بها */
  eliminate(x, why, by) {
    if (x.out) return;
    x.out = true;
    x.protected = false;
    const shown = x.hand.slice();
    x.discards.push(...shown);
    x.hand = [];
    this.forgetAbout(x.id);
    delete this.know[x.id];
    this.ev({ t: "out", id: x.id, why, by, cards: shown });
  }

  endTurn(id) {
    const alive = this.alive();
    if (alive.length === 1) return this.roundOver([alive[0].id], "last");
    if (!this.deck.length) {
      /* الكومةُ فرغت: تُكشف الأيدي، والأعلى يكسب؛ والتعادلُ بمجموع المرميّ */
      const best = Math.max(...alive.map(y => y.hand[0]));
      let top = alive.filter(y => y.hand[0] === best);
      let tie = false;
      if (top.length > 1) {
        const sum = y => y.discards.reduce((a, b) => a + b, 0);
        const bs = Math.max(...top.map(sum));
        top = top.filter(y => sum(y) === bs);
        tie = true;
      }
      return this.roundOver(top.map(y => y.id), "deck", tie);
    }
    this.beginTurn(this.nextOf(id));
  }

  roundOver(winners, reason, tie = false) {
    for (const w of winners) this.p(w).stars++;
    const hands = {};
    for (const y of this.alive()) hands[y.id] = y.hand[0];
    this.result = { winners, reason, tie, hands, burned: this.burned, round: this.round };
    this.turn = null;
    this.ev({ t: "roundEnd", ...this.result, stars: Object.fromEntries(this.players.map(y => [y.id, y.stars])) });
    this.starter = winners[Math.floor(this.rng() * winners.length)];
    /* الفوز: من بلغ النجوم المطلوبة (فإن بلغها اثنان معًا بعددٍ واحدٍ استمرّ اللعب) */
    const best = Math.max(...this.players.map(y => y.stars));
    const top = this.players.filter(y => y.stars === best);
    if (best >= this.target && top.length === 1) return this.end(top[0].id);
    this.phase = "result";
  }

  /** بعد عرض النتيجة: جولةٌ جديدة (يستدعيه الخادم بعد لحظات) */
  nextRound() {
    if (this.phase !== "result") return;
    this.startRound();
  }

  end(id) {
    this.winner = id;
    this.phase = "over";
    this.turn = null;
    this.ev({ t: "over", winner: id });
  }

  ranking() {
    const list = this.players.slice().sort((a, b) => (b.id === this.winner) - (a.id === this.winner) || b.stars - a.stars || a.seat - b.seat);
    return list.map((x, i) => ({ id: x.id, place: i + 1, stars: x.stars }));
  }

  /* ══════════ المهلة: لعبٌ عن صاحب الدور ══════════ */
  timeout() {
    const id = this.turn;
    if (this.phase !== "turn" || !id) return [];
    const d = decide(this.view(id), this.rng);
    if (d) this.act(id, d);
    return [id];
  }
  act(id, d) { this.play(id, d.card, d); }
  waitingFor() { return this.phase === "turn" && this.turn ? [this.turn] : []; }

  /* ══════════ العرض: لكلّ لاعبٍ ما يحقّ له ══════════ */
  eventsFor(raw, id) {
    return raw.filter(e => !e._only || e._only === id).map(e => { const c = { ...e }; delete c._only; return c; });
  }
  view(id) {
    const me = this.p(id);
    const reveal = this.phase === "result" || this.phase === "over";
    const myTurn = this.phase === "turn" && this.turn === id && me && !me.out;
    const K = (this.know[id]) || {};
    const known = {};
    for (const b of Object.keys(K)) { const y = this.p(b); if (y && !y.out && y.hand.includes(K[b])) known[b] = K[b]; }
    return {
      me: id, round: this.round, phase: this.phase, turn: this.turn, starter: this.starter, target: this.target,
      deckN: this.deck.length, faceUp: this.faceUp.slice(),
      log: this.log.map(e => ({ ...e })),
      result: this.result ? { ...this.result, hands: { ...this.result.hands } } : null,
      winner: this.phase === "over" ? this.winner : null,
      ranking: this.phase === "over" ? this.ranking() : null,
      known,
      legal: myTurn ? {
        cards: this.playable(me),
        forced: this.forced(me),
        targets: Object.fromEntries([...new Set(me.hand)].map(c => [c, this.targetsFor(id, c)]))
      } : null,
      players: this.players.map(x => ({
        id: x.id, name: x.name, seat: x.seat, stars: x.stars, out: x.out, protected: x.protected,
        handN: x.hand.length,
        hand: x.id === id ? x.hand.slice() : (reveal && this.result && this.result.hands[x.id] != null ? [this.result.hands[x.id]] : null),
        discards: x.discards.slice()
      }))
    };
  }
}

/* ══════════ البوت (وبديلُ المتأخّر) ══════════
   يعرف ما يعرفه لاعبٌ من عرضه وحده: يده، وكلَّ ما رُمي مكشوفًا، وما عرفه
   بالكاهن أو البارون أو الملك. يعدّ البطاقات الباقية ويخمّن على أساسها. */
function unseenOf(v) {
  const u = { ...COPIES };
  const sub = c => { if (u[c] > 0) u[c]--; };
  for (const x of v.players) for (const c of x.discards) sub(c);
  for (const c of v.faceUp || []) sub(c);
  const me = v.players.find(x => x.id === v.me);
  for (const c of (me && me.hand) || []) sub(c);
  return u;
}
function decide(v, rng = Math.random) {
  const me = v.players.find(x => x.id === v.me);
  if (!me || me.out || v.phase !== "turn" || v.turn !== v.me || !v.legal) return null;
  const R = () => rng();
  const hand = me.hand;
  const U = unseenOf(v);
  /* ما في يد كلّ خصمٍ يُحتمل: المعروفُ، وإلا توزيعُ الباقي */
  const pool = Object.keys(U).reduce((n, k) => n + U[k], 0) || 1;
  const pLow = k => { let n = 0; for (const c in U) if (+c < k) n += U[c]; return n / pool; };
  const pHigh = k => { let n = 0; for (const c in U) if (+c > k) n += U[c]; return n / pool; };
  const lead = ids => {
    const list = v.players.filter(x => ids.includes(x.id));
    const best = Math.max(...list.map(x => x.stars));
    const top = list.filter(x => x.stars === best);
    return top[Math.floor(R() * top.length)].id;
  };
  const late = v.deckN <= 2;
  let best = null;
  for (const c of v.legal.cards) {
    const rest = hand.slice(); rest.splice(rest.indexOf(c), 1);
    const k = rest[0];
    const tg = v.legal.targets[c] || [];
    let score = k * (late ? 4 : 1.5), target = null, guess = null;
    switch (c) {
      case 1: {
        if (!tg.length) { score += 2; break; }
        const kn = tg.find(t => v.known[t] && v.known[t] !== 1);
        if (kn) { target = kn; guess = v.known[kn]; score += 100; break; }
        target = lead(tg);
        let g = 2, gp = -1;
        for (let x = 2; x <= 8; x++) { const q = (U[x] || 0) + R() * 0.3; if (q > gp) { gp = q; g = x; } }
        guess = g;
        score += 15 + 40 * ((U[g] || 0) / pool);
        break;
      }
      case 2: {
        if (!tg.length) { score += 2; break; }
        const unk = tg.filter(t => !v.known[t]);
        target = unk.length ? lead(unk) : lead(tg);
        score += unk.length ? 22 : 4;
        break;
      }
      case 3: {
        if (!tg.length) { score += 2; break; }
        const win = tg.find(t => v.known[t] && v.known[t] < k);
        if (win) { target = win; score += 90; break; }
        const safe = tg.filter(t => !(v.known[t] && v.known[t] > k));
        if (!safe.length) { target = tg[0]; score -= 60; break; }
        target = lead(safe);
        score += 10 + 60 * (pLow(k) - pHigh(k));
        break;
      }
      case 4: score += 24 + (k >= 6 ? 26 : 0); break;
      case 5: {
        const pr = tg.find(t => t !== v.me && v.known[t] === 8);
        if (pr) { target = pr; score += 95; break; }
        const others = tg.filter(t => t !== v.me);
        if (others.length) { target = lead(others); score += 18 + (v.known[target] >= 6 ? 20 : 0); }
        else { target = v.me; score += k === 8 ? -1000 : (k <= 3 ? 10 : -20); }
        break;
      }
      case 6: {
        if (!tg.length) { score += 2; break; }
        const rich = tg.find(t => v.known[t] && v.known[t] > k);
        target = rich || lead(tg);
        score += rich ? 55 : (k <= 3 ? 14 : -12);
        if (k === 8) score -= 40;            /* لا تعطِ الأميرة */
        break;
      }
      case 7: score += 12; break;
      case 8: score -= 1000; break;
    }
    score += R() * 6;
    if (!best || score > best.score) best = { score, card: c, target, guess };
  }
  if (!best) return null;
  const d = { card: best.card };
  if (best.target) d.target = best.target;
  if (best.guess) d.guess = best.guess;
  return d;
}

module.exports = { LoveMatch, decide, unseenOf, rngFrom, fullDeck, COPIES, NAMES, TARGET, MIN_PLAYERS, MAX_PLAYERS, NEEDS_TARGET };
