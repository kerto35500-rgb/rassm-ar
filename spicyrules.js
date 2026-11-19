/* 🌶️ «البسكويتة الحارّة» — القواعد (بلا شبكة ولا مؤقّتات: هذه في spicysrv.js).
 *
 * لعبةُ خداعٍ ومزايدة (على نسق Skull): لكلّ لاعبٍ أربعُ ماكارونات — ثلاثٌ
 * لذيذة (safe) وواحدةٌ حارّة (trap). في كلّ جولة:
 *   ١) الوضع: يضع كلٌّ ماكارونةً مقلوبةً أمامه (معًا، لا بالدور).
 *   ٢) الدور: بالترتيب، يضيف صاحبُ الدور ماكارونةً أخرى فوق كومته — أو يبدأ
 *      المزاد بعددٍ يتعهّد بقلبه دون أن يصادف حارّة (حتى مجموع ما على الطاولة).
 *   ٣) المزاد: لا إضافةَ بعدُ لأحد؛ كلٌّ بدوره يرفع العدد أو ينسحب، حتى يبقى
 *      أعلى مزايد (أو يبلغ أحدُهم مجموعَ الطاولة فيُحسم فورًا).
 *   ٤) الكشف: المتحدّي يقلب كومتَه هو كلَّها أوّلًا (القفل الذكيّ)، ثمّ من
 *      أعلى كوم الآخرين ما شاء — الأعلى قبل ما تحته. بلغ العددَ بلا حارّة ⇒
 *      نجمة ⭐ (نجمتان = فوز). صادف حارّة ⇒ يخسر ماكارونةً عشوائيّةً من
 *      ماكاروناته نهائيًّا، ولا يعرف أيَّها إلا هو؛ ومن نفدت ماكاروناته خرج.
 *   وآخرُ من بقي يفوز كذلك.
 *
 * كلُّ ماكارونةٍ لها معرّفٌ ثابت: «اليد» و«الكومة» قائمتا معرّفات، ونوعُها
 * في discs. والعرضُ لكلّ لاعبٍ يحجب ما لا يحقّ له: أنواعُ يد غيره وكومته
 * (إلا ما قُلب)، وما خسره غيرُه.
 */
"use strict";

const DISCS = 4, TRAPS = 1;
const WIN_STARS = 2;
const MIN_PLAYERS = 3, MAX_PLAYERS = 6;

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

class SpicyMatch {
  /**
   * @param players [{id, name}] بترتيب الجلوس (اتّجاهُ عقارب الساعة)
   * @param opts.rng مولّدٌ عشوائيّ
   */
  constructor(players, opts = {}) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error("من ٣ إلى ٦ لاعبين");
    this.rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    /* معرّفُ الماكارونة عشوائيّ: لو كان رقمَها (٠ = الحارّة) لفضحها المعرّفُ وحده */
    const used = new Set();
    const rid = () => { let r; do { r = Math.floor(this.rng() * 2176782336).toString(36); } while (used.has(r)); used.add(r); return r; };
    this.players = players.map((p, i) => {
      const discs = {};
      for (let k = 0; k < DISCS; k++) discs[rid()] = k < TRAPS ? "trap" : "safe";
      return { id: p.id, name: p.name, seat: i, discs, hand: Object.keys(discs), stack: [],
               stars: 0, status: "active", out: false, lost: [] };
    });
    this.round = 0;
    this.phase = "placement";
    this.turn = null;
    this.starter = this.players[Math.floor(this.rng() * this.players.length)].id;
    this.bid = null;            /* { id, amount } */
    this.revealed = [];         /* [{ owner, disc, t }] بترتيب القلب */
    this.result = null;
    this.winner = null;
    this.reason = null;
    this.elimOrder = [];
    this.events = [];
    this.startRound();
  }

  /* ══════════ أدوات ══════════ */
  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  p(id) { return this.players.find(x => x.id === id) || null; }
  alive() { return this.players.filter(x => !x.out); }
  total() { return this.alive().reduce((n, x) => n + x.stack.length, 0); }
  owned(x) { return Object.keys(x.discs).length; }
  /** التالي بعد id باتّجاه عقارب الساعة (يتخطّى الخارجين ومن لا يشمله الشرط) */
  nextOf(id, ok = () => true) {
    const n = this.players.length;
    const i = this.players.findIndex(x => x.id === id);
    for (let k = 1; k <= n; k++) {
      const x = this.players[(i + k) % n];
      if (!x.out && ok(x)) return x.id;
    }
    return null;
  }
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ══════════ الجولة ══════════ */
  startRound() {
    this.round++;
    this.phase = "placement";
    this.turn = null;
    this.bid = null;
    this.revealed = [];
    this.result = null;
    for (const x of this.players) {
      x.stack = [];
      x.hand = x.out ? [] : this.shuffle(Object.keys(x.discs));
      x.status = x.out ? "eliminated" : "active";
    }
    this.ev({ t: "round", round: this.round, starter: this.starter });
  }

  /* ١) الوضعُ الإجباريّ: كلٌّ يضع ماكارونةً — والمرحلةُ التالية حين يضع الجميع */
  place(id, discId) {
    const x = this.p(id);
    if (!x || x.out) throw new Error("لستَ في اللعب");
    if (this.phase === "placement") {
      if (x.stack.length) throw new Error("وضعتَ ماكارونتك — انتظر البقيّة");
    } else if (this.phase === "action") {
      if (this.turn !== id) throw new Error("ليس دورك");
    } else throw new Error("لا إضافةَ الآن");
    const k = x.hand.indexOf(discId);
    if (k < 0) throw new Error("ليست في يدك");
    x.hand.splice(k, 1);
    x.stack.push(discId);
    this.ev({ t: "placed", id, n: x.stack.length, phase: this.phase });
    if (this.phase === "placement") {
      if (this.alive().every(y => y.stack.length > 0)) {
        this.phase = "action";
        this.turn = this.p(this.starter) && !this.p(this.starter).out ? this.starter : this.nextOf(this.starter);
        this.ev({ t: "action", turn: this.turn });
      }
    } else {
      this.turn = this.nextOf(id);
      this.ev({ t: "turn", turn: this.turn });
    }
  }

  /* ٢–٣) المزايدة: أوّلُها يفتح المزاد ويُقفل الإضافةَ للجميع */
  raise(id, amount) {
    const x = this.p(id);
    if (!x || x.out) throw new Error("لستَ في اللعب");
    if (this.phase !== "action" && this.phase !== "auction") throw new Error("لا مزايدةَ الآن");
    if (this.turn !== id) throw new Error("ليس دورك");
    if (x.status === "passed") throw new Error("انسحبتَ من هذا المزاد");
    const n = Math.floor(Number(amount));
    const min = this.bid ? this.bid.amount + 1 : 1, max = this.total();
    if (!(n >= min)) throw new Error(this.bid ? "ارفع فوق " + this.bid.amount : "عددٌ من ١ فأكثر");
    if (n > max) throw new Error("أكثرُ ما يمكن: " + max + " (ما على الطاولة)");
    this.bid = { id, amount: n };
    if (this.phase === "action") { this.phase = "auction"; this.ev({ t: "auction", by: id, amount: n }); }
    else this.ev({ t: "raise", by: id, amount: n });
    /* بلغ مجموعَ الطاولة: لا رفعَ بعده — يُحسم فورًا */
    if (n === max) return this.startReveal();
    this.advanceAuction(id);
  }

  pass(id) {
    const x = this.p(id);
    if (!x || x.out) throw new Error("لستَ في اللعب");
    if (this.phase !== "auction") throw new Error("لا انسحابَ إلا في المزاد");
    if (this.turn !== id) throw new Error("ليس دورك");
    if (this.bid && this.bid.id === id) throw new Error("أنت أعلى مزايد");
    x.status = "passed";
    this.ev({ t: "pass", id });
    this.advanceAuction(id);
  }

  /** الدورُ للتالي ممّن لم ينسحب؛ فإن عاد إلى أعلى المزايدين فقد انسحب الباقون */
  advanceAuction(from) {
    const next = this.nextOf(from, y => y.status !== "passed");
    if (!next || next === this.bid.id) return this.startReveal();
    this.turn = next;
    this.ev({ t: "turn", turn: next });
  }

  /* ══════════ ٤) الكشف ══════════ */
  startReveal() {
    this.phase = "reveal";
    this.turn = this.bid.id;
    this.ev({ t: "reveal", by: this.bid.id, amount: this.bid.amount });
  }
  /** ما يجوز للمتحدّي قلبُه الآن: كومتُه هو أوّلًا (من الأعلى)، ثمّ أعلى كومة أيّ لاعب */
  flippable() {
    if (this.phase !== "reveal") return [];
    const me = this.p(this.bid.id);
    const done = new Set(this.revealed.map(r => r.disc));
    const top = x => { for (let i = x.stack.length - 1; i >= 0; i--) if (!done.has(x.stack[i])) return x.stack[i]; return null; };
    const mine = top(me);
    if (mine) return [{ owner: me.id, disc: mine }];
    return this.alive().filter(x => x.id !== me.id).map(x => ({ owner: x.id, disc: top(x) })).filter(o => o.disc);
  }
  flip(id, owner) {
    if (this.phase !== "reveal") throw new Error("ليس وقتَ الكشف");
    if (id !== this.bid.id) throw new Error("المتحدّي وحده يقلب");
    const ok = this.flippable();
    const o = ok.find(f => f.owner === owner);
    if (!o) throw new Error(ok.length && ok[0].owner === id ? "اقلب ماكاروناتك أنت أوّلًا 🔒" : "لا تُقلب هذه الآن");
    const t = this.p(owner).discs[o.disc];
    this.revealed.push({ owner, disc: o.disc, t });
    this.ev({ t: "flip", by: id, owner, disc: o.disc, kind: t, n: this.revealed.length });
    if (t === "trap") return this.fail(owner);
    if (this.revealed.length >= this.bid.amount) return this.success();
  }

  success() {
    const x = this.p(this.bid.id);
    x.stars++;
    this.result = { ok: true, by: x.id, amount: this.bid.amount, stars: x.stars };
    this.ev({ t: "success", by: x.id, stars: x.stars });
    if (x.stars >= WIN_STARS) return this.end(x.id, "stars");
    this.starter = x.id;
    this.phase = "result";
  }

  /** فشل: تعود الماكاروناتُ إلى أصحابها، ويخسر المتحدّي واحدةً عشوائيّةً من
      كلّ ما يملك — نهائيًّا، ولا يعرف أيَّها إلا هو. */
  fail(trapOwner) {
    const x = this.p(this.bid.id);
    const ids = Object.keys(x.discs);
    const gone = ids[Math.floor(this.rng() * ids.length)];
    const kind = x.discs[gone];
    delete x.discs[gone];
    x.lost.push({ disc: gone, t: kind, round: this.round });
    this.result = { ok: false, by: x.id, amount: this.bid.amount, trapOwner, left: this.owned(x) };
    /* الحدثُ العامّ بلا نوع؛ والنوعُ في حدثٍ خاصٍّ لصاحبه (يُفرز في eventsFor) */
    this.ev({ t: "fail", by: x.id, trapOwner, left: this.owned(x) });
    this.ev({ t: "lost", by: x.id, kind, _only: x.id });
    if (!this.owned(x)) {
      x.out = true; x.status = "eliminated"; x.hand = []; x.stack = [];
      this.elimOrder.push(x.id);
      this.ev({ t: "eliminated", id: x.id });
    }
    const alive = this.alive();
    if (alive.length === 1) return this.end(alive[0].id, "last");
    /* يبدأ الجولةَ التاليةَ المتحدّي؛ فإن خرج فصاحبُ الحارّة (إن لم يكن هو)، وإلا التالي */
    if (!x.out) this.starter = x.id;
    else if (trapOwner !== x.id && !this.p(trapOwner).out) this.starter = trapOwner;
    else this.starter = this.nextOf(x.id);
    this.phase = "result";
  }

  /** بعد عرض النتيجة: جولةٌ جديدة (يستدعيه الخادم بعد لحظات) */
  nextRound() {
    if (this.phase !== "result") return;
    this.startRound();
  }

  end(id, reason) {
    this.winner = id;
    this.reason = reason;
    this.phase = "over";
    this.turn = null;
    this.ev({ t: "over", winner: id, reason });
  }

  /** الترتيبُ النهائيّ: الفائز، ثمّ الباقون بالنجوم فعدد الماكارونات، ثمّ
      الخارجون (الأحدثُ خروجًا أعلى) */
  ranking() {
    const inGame = this.players.filter(x => !x.out && x.id !== this.winner)
      .sort((a, b) => b.stars - a.stars || this.owned(b) - this.owned(a));
    const list = [this.p(this.winner), ...inGame, ...this.elimOrder.slice().reverse().map(id => this.p(id))].filter(Boolean);
    return list.map((x, i) => ({ id: x.id, place: i + 1, stars: x.stars, discs: this.owned(x), out: x.out }));
  }

  /* ══════════ المهلة: فعلٌ عن صاحب الدور ══════════ */
  /** يُرجع من لم يفعل (لينقله الخادمُ إلى البوت) */
  timeout() {
    if (this.phase === "placement") {
      const late = this.alive().filter(x => !x.stack.length);
      for (const x of late) if (this.phase === "placement") this.place(x.id, x.hand[Math.floor(this.rng() * x.hand.length)]);
      return late.map(x => x.id);
    }
    const id = this.turn;
    if (!id) return [];
    const d = decide(this.view(id), this.rng, true);
    if (d) this.act(id, d);
    return [id];
  }
  act(id, d) {
    if (d.kind === "place") this.place(id, d.disc);
    else if (d.kind === "raise") this.raise(id, d.amount);
    else if (d.kind === "pass") this.pass(id);
    else if (d.kind === "flip") this.flip(id, d.owner);
  }

  /** من ينتظر منه فعلٌ الآن (الوضعُ: كلُّ من لم يضع) */
  waitingFor() {
    if (this.phase === "placement") return this.alive().filter(x => !x.stack.length).map(x => x.id);
    if (this.phase === "action" || this.phase === "auction" || this.phase === "reveal") return this.turn ? [this.turn] : [];
    return [];
  }

  /* ══════════ العرض: لكلّ لاعبٍ ما يحقّ له ══════════ */
  eventsFor(raw, id) {
    return raw.filter(e => !e._only || e._only === id).map(e => { const c = { ...e }; delete c._only; return c; });
  }
  view(id) {
    const shown = new Map(this.revealed.map(r => [r.disc, r.t]));
    const over = this.phase === "over";
    return {
      me: id, round: this.round, phase: this.phase, turn: this.turn, starter: this.starter,
      bid: this.bid ? { ...this.bid } : null, total: this.total(),
      flippable: this.phase === "reveal" && this.bid && this.bid.id === id ? this.flippable().map(f => f.owner) : [],
      revealed: this.revealed.map(r => ({ ...r })),
      result: this.result ? { ...this.result } : null,
      winner: over ? this.winner : null, reason: over ? this.reason : null,
      ranking: over ? this.ranking() : null,
      players: this.players.map(x => {
        const mine = x.id === id;
        return {
          id: x.id, name: x.name, seat: x.seat, stars: x.stars, status: x.status, out: x.out,
          owned: this.owned(x), handN: x.hand.length,
          /* يدي وأنواعها لي وحدي؛ ويدُ غيري عددٌ فقط */
          hand: mine ? x.hand.map(d => ({ id: d, t: x.discs[d] })) : null,
          /* كومتي أعرف ما فيها؛ وكومةُ غيري مقلوبةٌ إلا ما قُلب */
          /* (ومعرّفاتُ كومة غيري لا تُرسل أصلًا — لا يُستدلّ بها على شيء) */
          stack: x.stack.map(d => mine ? { id: d, t: x.discs[d], up: shown.has(d) }
                                       : { t: (shown.has(d) || over) ? (shown.get(d) || x.discs[d]) : null, up: shown.has(d) }),
          lost: mine ? x.lost.map(l => ({ ...l })) : x.lost.length
        };
      })
    };
  }
}

/* ══════════ البوت (وبديلُ المتأخّر) ══════════
   يعرف ما يعرفه لاعبٌ من عرضه وحده: يده وكومته، وعدد ماكارونات غيره. */
function decide(v, rng = Math.random, cautious = false) {
  const me = v.players.find(x => x.id === v.me);
  if (!me || me.out) return null;
  const R = () => rng();
  if (v.phase === "placement") {
    if (me.stack.length) return null;
    const trap = me.hand.find(d => d.t === "trap"), safe = me.hand.filter(d => d.t === "safe");
    /* أحيانًا تبدأ بالحارّة (خداع)، وغالبًا بلذيذة */
    const pick = trap && (!safe.length || R() < (cautious ? 0.2 : 0.3)) ? trap : safe[Math.floor(R() * safe.length)];
    return { kind: "place", disc: pick.id };
  }
  if (v.turn !== v.me) return null;
  const myTrapDown = me.stack.some(d => d.t === "trap");
  const mySafe = myTrapDown ? 0 : me.stack.length;
  if (v.phase === "action") {
    const canAdd = me.hand.length > 0;
    const safeIn = me.hand.filter(d => d.t === "safe");
    /* أضف ما دامت الطاولةُ صغيرةً — وإلا ابدأ المزاد بما تضمنه من كومتك */
    if (canAdd && !cautious && (v.total < v.players.filter(x => !x.out).length + 2 || R() < 0.35)) {
      const trap = me.hand.find(d => d.t === "trap");
      const pick = trap && R() < 0.25 ? trap : (safeIn.length ? safeIn[Math.floor(R() * safeIn.length)] : me.hand[0]);
      return { kind: "place", disc: pick.id };
    }
    if (canAdd && cautious && R() < 0.5) return { kind: "place", disc: (safeIn[0] || me.hand[0]).id };
    const n = Math.max(1, Math.min(v.total, mySafe + (R() < 0.5 ? 1 : 0)));
    return { kind: "raise", amount: n };
  }
  if (v.phase === "auction") {
    const cur = v.bid.amount;
    /* يجرؤ قليلًا فوق ما يضمنه — وإلا لم يُفشل أحدٌ أبدًا */
    const reach = mySafe + (R() < 0.55 ? 1 : 0) + (R() < 0.2 ? 1 : 0);
    if (!cautious && cur + 1 <= Math.min(v.total, reach)) return { kind: "raise", amount: cur + 1 };
    return { kind: "pass" };
  }
  if (v.phase === "reveal") {
    const opts = v.flippable || [];
    if (!opts.length) return null;
    if (opts.includes(v.me)) return { kind: "flip", owner: v.me };
    /* من كومته أقصر غالبًا أقلُّ خداعًا */
    const others = v.players.filter(x => opts.includes(x.id)).sort((a, b) => a.stack.filter(d => !d.up).length - b.stack.filter(d => !d.up).length);
    const pick = R() < 0.7 ? others[0] : others[Math.floor(R() * others.length)];
    return { kind: "flip", owner: pick.id };
  }
  return null;
}

module.exports = { SpicyMatch, decide, rngFrom, DISCS, WIN_STARS, MIN_PLAYERS, MAX_PLAYERS };
