// 🂡 محرّك قواعد «بالوت» — منطقٌ خالصٌ بلا شبكةٍ ولا رسم.
//
// أصلُ هذا المحرّك نسخةٌ محلّيّة كتبها صاحب الموقع (lib/engine.js)، وكان
// سليمًا في جوهره: آلةُ حالاتٍ كاملة للشراء والمضاعفة والمشاريع والتسجيل.
// نُقِل هنا بثلاث زياداتٍ لا غنى عنها للّعب أونلاين:
//
//   • عشوائيّةٌ قابلة للحقن — فتُعاد المباراة حرفًا بحرف في الاختبار.
//   • `view(m, seat)` — لكلّ لاعبٍ منظورُه، وأوراقُ غيره أعدادٌ لا أوراق.
//     من دون هذا يكفي أن يفتح خصمُك أدوات المطوّر ليرى يدك كاملة.
//   • `events` — سجلُّ ما جرى في هذه الخطوة، تبني عليه الواجهةُ الحركة:
//     ورقةٌ طارت، أكلةٌ جُمعت، مشروعٌ أُعلن. من دونه تُخمِّن الواجهةُ بالفرق
//     بين حالتين، وتخطئ حين تتلاحق خطوتان.
//
// المقاعد ٠..٣ عكس عقارب الساعة، والفريق = المقعد ٪ ٢ (٠و٢ فريق، ١و٣ فريق).

"use strict";

const SUITS = ["S", "H", "D", "C"];                  /* ♠ ♥ ♦ ♣ */
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const SUIT_AR = { S: "بستوني", H: "كُبّة", D: "ديمن", C: "شيريا" };
const SUIT_SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };

/* قيَم الأوراق: في الصنّ لا امتياز لنوع، وفي الحكم نوعُ الحكم وحده يقلب الترتيب */
const SUN_VALUES = { A: 11, "10": 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 };
const TRUMP_VALUES = { J: 20, "9": 14, A: 11, "10": 10, K: 4, Q: 3, "8": 0, "7": 0 };
const SUN_ORDER = ["7", "8", "9", "J", "Q", "K", "10", "A"];
const TRUMP_ORDER = ["7", "8", "Q", "K", "10", "A", "9", "J"];
const SEQ_ORDER = ["7", "8", "9", "10", "J", "Q", "K", "A"];   /* للتسلسل في المشاريع */

/* مجموع النقاط الخام في اليد الواحدة — ثابتٌ نتحقّق به من سلامة كلّ يد */
const RAW_TOTAL = { sun: 130, hokum: 162 };

const DEFAULTS = {
  targetScore: 152,           /* نهاية الصكّة */
  sunTotal: 26,               /* أبناط الصنّ */
  hokumTotal: 16,             /* أبناط الحكم */
  sunCapot: 44,               /* كبوت صنّ */
  hokumCapot: 25,             /* كبوت حكم */
  allowAshkal: true,          /* أشكل */
  ashkalOnAce: false,         /* أشكل ولو كانت ورقة الشراء أكة */
  round2HokumSameSuit: false, /* حكم في اللفة الثانية بنوع ورقة الشراء */
  allowDouble: true,          /* دبل / ثري / فور */
  allowGahwa: true,           /* قهوة */
  gahwaMinScore: 100,         /* أقلّ نقاطٍ تُجيز القهوة */
  projects: true,             /* المشاريع */
  balootProject: true,        /* بلوت (شايب + بنت الحكم) */
  fourOfKind: true,           /* مية / أربعمية */
  mustOvertrump: true,        /* إجبار القطع بالأعلى */
  partnerWinningNoTrump: true,/* لا تُجبَر على القطع إذا الشريك آخذها */
  tieGoesToOpponents: true,   /* التعادل خسارةٌ على الشاري */
  turnSeconds: 20,            /* وقت لعب الورقة */
  bidSeconds: 15              /* وقت الشراء */
};

/* ── عشوائيّةٌ قابلة للحقن ──
   الخادم يستعمل Math.random، والاختبار يحقن مولّدًا ثابتًا فتصير كلّ مباراةٍ
   قابلةً للإعادة. لا اختبار جدّيّ للعبةِ ورقٍ بلا هذا. */
function rngFrom(seed) {
  if (typeof seed === "function") return seed;
  let s = (seed >>> 0) || 123456789;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

const rankOf = c => c.slice(0, -1);
const suitOf = c => c.slice(-1);
const cardAr = c => rankOf(c) + SUIT_SYM[suitOf(c)];

function cardValue(card, mode, trump) {
  const r = rankOf(card);
  if (mode === "hokum" && suitOf(card) === trump) return TRUMP_VALUES[r];
  return SUN_VALUES[r];
}
/* قوّةٌ مقارنةٌ لا مطلقة: الحكم فوق المئة، ثمّ نوع الافتتاح، وما عداه لا يفوز */
function strength(card, mode, trump, ledSuit) {
  const r = rankOf(card), s = suitOf(card);
  if (mode === "hokum" && s === trump) return 100 + TRUMP_ORDER.indexOf(r);
  if (s === ledSuit) return 10 + SUN_ORDER.indexOf(r);
  return -1;
}
function trickWinner(trick, mode, trump) {
  const led = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (strength(trick[i].card, mode, trump, led) > strength(trick[best].card, mode, trump, led)) best = i;
  }
  return trick[best].seat;
}

/* ── الأوراق المسموح بها ──
   الترتيب مقصود: اتّبع النوع، فإن عجزت فالحكم واجبٌ إلا أن يكون شريكُك
   آخذَها، وإن سبقك قاطعٌ فعليك أن تعلوه أو تتحلّل. */
function legalMoves(hand, trick, mode, trump, rules = DEFAULTS, seat) {
  if (!trick.length) return hand.slice();
  const led = suitOf(trick[0].card);
  const follow = hand.filter(c => suitOf(c) === led);
  if (mode === "sun") return follow.length ? follow : hand.slice();

  const winnerSeat = trickWinner(trick, mode, trump);
  const bestStr = Math.max(...trick.map(t => strength(t.card, mode, trump, led)));
  const trumps = hand.filter(c => suitOf(c) === trump);

  if (led === trump) {
    if (!follow.length) return hand.slice();
    const higher = follow.filter(c => strength(c, mode, trump, led) > bestStr);
    return (rules.mustOvertrump && higher.length) ? higher : follow;
  }
  if (follow.length) return follow;
  if (!trumps.length) return hand.slice();

  const partnerWinning = seat !== undefined && (winnerSeat % 2) === (seat % 2);
  if (partnerWinning && rules.partnerWinningNoTrump) return hand.slice();

  /* سبقك قاطع: إمّا أن تعلوه، وإلا فأنت حُرّ — لا معنى لإجبارك على حكمٍ خاسر */
  if (bestStr >= 100) {
    const higherTrumps = trumps.filter(c => strength(c, mode, trump, led) > bestStr);
    if (!higherTrumps.length) return hand.slice();
    return rules.mustOvertrump ? higherTrumps : trumps;
  }
  return trumps;
}

/* ── المشاريع ── */
const PROJECT_RANK = { sira: 1, khamsin: 2, miya: 3, arbaamiya: 4 };
const PROJECT_AR = { sira: "سرا", khamsin: "خمسين", miya: "مية", arbaamiya: "أربعمية", baloot: "بلوت" };
const PROJECT_RAW = { sira: 20, khamsin: 50, miya: 100, arbaamiya: 200, baloot: 20 };

function findProjects(hand, mode, rules = DEFAULTS) {
  const projects = [];
  if (!rules.projects) return projects;

  for (const s of SUITS) {
    const idx = hand.filter(c => suitOf(c) === s)
      .map(c => SEQ_ORDER.indexOf(rankOf(c))).sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const top = run[run.length - 1];
        const type = run.length === 3 ? "sira" : run.length === 4 ? "khamsin" : "miya";
        projects.push({ type, suit: s, top: SEQ_ORDER[top], cards: run.map(i => SEQ_ORDER[i] + s), rank: PROJECT_RANK[type], topIdx: top });
      }
      run = [];
    };
    for (let i = 0; i < idx.length; i++) {
      if (run.length && idx[i] !== run[run.length - 1] + 1) flush();
      run.push(idx[i]);
    }
    flush();
  }
  if (rules.fourOfKind) {
    for (const r of ["A", "K", "Q", "J", "10"]) {
      const cs = hand.filter(c => rankOf(c) === r);
      if (cs.length === 4) {
        const type = (mode === "sun" && r === "A") ? "arbaamiya" : "miya";
        projects.push({ type, suit: null, top: r, cards: cs, rank: PROJECT_RANK[type], topIdx: 20 + SEQ_ORDER.indexOf(r) });
      }
    }
  }
  return projects;
}
const projectRaw = p => PROJECT_RAW[p.type] || 0;

/* الأعلى مشروعًا يأخذ فريقُه كلَّ مشاريعه، ومشاريعُ الخصم تسقط جميعًا */
function resolveProjects(declared, firstSeat) {
  let best = null;
  for (let k = 0; k < 4; k++) {
    const seat = (firstSeat + k) % 4;
    for (const p of (declared[seat] || [])) {
      if (p.type === "baloot") continue;
      if (!best || p.rank > best.p.rank || (p.rank === best.p.rank && p.topIdx > best.p.topIdx)) best = { seat, p };
    }
  }
  if (!best) return { team: null, counted: [] };
  const team = best.seat % 2;
  const counted = [];
  for (let seat = 0; seat < 4; seat++) {
    if (seat % 2 !== team) continue;
    for (const p of (declared[seat] || [])) if (p.type !== "baloot") counted.push({ seat, project: p });
  }
  return { team, counted };
}

/* ── التسجيل ── */
const rawToAbnat = (raw, mode) => mode === "sun" ? raw * 2 / 10 : raw / 10;
const roundAbnat = x => Math.round(x);

function scoreHand(h, rules = DEFAULTS) {
  const mode = h.mode;
  const buyerTeam = h.buyerSeat % 2, oppTeam = 1 - buyerTeam;
  const raw = [h.rawPoints[0], h.rawPoints[1]];
  const projRaw = [0, 0];
  for (const c of h.projectsCounted) projRaw[c.seat % 2] += projectRaw(c.project);
  if (h.balootTeam !== null && h.balootTeam !== undefined) projRaw[h.balootTeam] += PROJECT_RAW.baloot;

  const total = mode === "sun" ? rules.sunTotal : rules.hokumTotal;
  const withProjects = [0, 1].map(t => raw[t] + projRaw[t]);
  const projAbnat = t => roundAbnat(rawToAbnat(projRaw[t], mode));
  const balootAbnat = roundAbnat(rawToAbnat(PROJECT_RAW.baloot, mode));

  const result = {
    mode, buyerTeam, raw, projRaw, abnat: [0, 0],
    buyerWon: null, capot: null, gahwa: !!h.gahwa, multiplier: h.multiplier || 1
  };

  const tricksBy = [0, 0];
  for (const t of h.tricks) tricksBy[t.winner % 2]++;
  const capotTeam = tricksBy[0] === 8 ? 0 : tricksBy[1] === 8 ? 1 : null;
  result.capot = capotTeam;

  if (capotTeam !== null) {
    const capot = mode === "sun" ? rules.sunCapot : rules.hokumCapot;
    result.abnat[capotTeam] = capot + projAbnat(capotTeam);
    result.abnat[1 - capotTeam] = 0;
    /* البلوت لا يسقط بالكبوت: هو إعلانٌ لا كسب */
    if (h.balootTeam === 1 - capotTeam) result.abnat[1 - capotTeam] += balootAbnat;
    result.buyerWon = capotTeam === buyerTeam;
  } else {
    const buyerWon = withProjects[buyerTeam] > withProjects[oppTeam] ||
      (!rules.tieGoesToOpponents && withProjects[buyerTeam] === withProjects[oppTeam]);
    result.buyerWon = buyerWon;
    if (buyerWon) {
      const b = roundAbnat(rawToAbnat(raw[buyerTeam], mode));
      result.abnat[buyerTeam] = b + projAbnat(buyerTeam);
      result.abnat[oppTeam] = (total - b) + projAbnat(oppTeam);
    } else {
      result.abnat[oppTeam] = total + projAbnat(oppTeam) + projAbnat(buyerTeam);
      result.abnat[buyerTeam] = 0;
      if (h.balootTeam === buyerTeam) {
        result.abnat[buyerTeam] += balootAbnat;
        result.abnat[oppTeam] -= balootAbnat;
      }
    }
  }
  /* المضاعفة تجمع كلّ شيءٍ للفائز ثمّ تضربه — لا تُقسَم */
  const mult = h.multiplier || 1;
  if (mult > 1) {
    const winner = result.buyerWon ? buyerTeam : oppTeam;
    const sum = result.abnat[0] + result.abnat[1];
    result.abnat = [0, 0];
    result.abnat[winner] = sum * mult;
  }
  return result;
}

/* ── آلة حالات المباراة ── */
class BalootMatch {
  constructor(rules = {}, seed) {
    this.rules = Object.assign({}, DEFAULTS, rules);
    this.rng = rngFrom(seed === undefined ? Math.random : seed);
    this.scores = [0, 0];
    this.dealer = 3;            /* أوّل موزّعٍ ٣، فيكون أوّل لاعبٍ المقعد ٠ */
    this.handNo = 0;
    this.history = [];
    this.finished = false;
    this.winnerTeam = null;
    this.phase = "idle";        /* idle · bidding · redeal · doubling · playing · handover · finished */
    this.events = [];
  }

  ev(e) { this.events.push(e); return e; }
  /* الخادم يسحب الأحداث بعد كلّ فعلٍ ثمّ يفرغها — فلا يُبَثّ حدثٌ مرّتين */
  takeEvents() { const e = this.events; this.events = []; return e; }

  /* ── التوزيع ── */
  startHand() {
    this.handNo++;
    this.phase = "bidding";
    this.events = [];
    const deck = shuffle(makeDeck(), this.rng);
    this.deck = deck;
    this.hands = [[], [], [], []];
    const first = (this.dealer + 1) % 4;
    let p = 0;
    /* ثلاثٌ ثمّ اثنتان، من يمين الموزّع — هكذا تُوزَّع البالوت */
    for (const round of [3, 2]) {
      for (let k = 0; k < 4; k++) {
        const seat = (first + k) % 4;
        for (let i = 0; i < round; i++) this.hands[seat].push(deck[p++]);
      }
    }
    this.bidCard = deck[p++];
    this.restIndex = p;
    this.bidRound = 1;
    this.bidTurn = first;
    this.firstSeat = first;
    this.hokumBid = null;
    this.ashkal = false;
    this.mode = null; this.trump = null; this.buyerSeat = null; this.callerSeat = null;
    this.multiplier = 1; this.gahwa = false; this.doubleTurn = null; this.doubleHistory = [];
    this.trick = []; this.tricks = []; this.trickNo = 0; this.leader = first; this.turn = null;
    this.lastTrick = null; this.lastTrickWinner = null;
    this.declared = {}; this.projectsCounted = []; this.projectsTeam = null;
    this.projectsShown = false; this.balootTeam = null; this.balootDeclared = [false, false];
    this.rawPoints = [0, 0];
    this.bidLog = [];
    this.lastResult = null;
    for (let s = 0; s < 4; s++) this.hands[s].sort((a, b) => cmpCard(a, b));

    this.ev({ t: "deal", hand: this.handNo, dealer: this.dealer, first, counts: [5, 5, 5, 5] });
    this.ev({ t: "bidcard", card: this.bidCard });
    return this;
  }

  /* ── الشراء ── */
  bidOptions(seat) {
    if (this.phase !== "bidding" || seat !== this.bidTurn) return [];
    const r = this.rules, opts = [];
    const gahwaOK = r.allowGahwa && this.scores[seat % 2] >= r.gahwaMinScore;
    if (this.bidRound === 1) {
      if (!this.hokumBid) {
        opts.push({ id: "sun", label: "صن" });
        opts.push({ id: "hokum", label: "حكم", suit: suitOf(this.bidCard) });
        if (r.allowAshkal && seat === this.firstSeat && (r.ashkalOnAce || rankOf(this.bidCard) !== "A")) {
          opts.push({ id: "ashkal", label: "أشكل", suit: suitOf(this.bidCard) });
        }
      } else {
        opts.push({ id: "sun", label: "صن" });   /* الصنّ يعلو على الحكم */
      }
    } else {
      opts.push({ id: "sun", label: "صن" });
      for (const s of SUITS) {
        if (r.round2HokumSameSuit || s !== suitOf(this.bidCard)) {
          opts.push({ id: "hokum", label: "حكم " + SUIT_AR[s], suit: s });
        }
      }
    }
    if (gahwaOK) opts.push({ id: "gahwa", label: "قهوة" });
    opts.push({ id: "pass", label: "بس" });
    return opts;
  }

  bid(seat, choice, suit) {
    if (this.phase !== "bidding") throw new Error("ليس وقت الشراء");
    if (seat !== this.bidTurn) throw new Error("ليس دورك");
    const opts = this.bidOptions(seat);
    const opt = opts.find(o => o.id === choice && (o.suit === undefined || suit === undefined || o.suit === suit));
    if (!opt) throw new Error("شراءٌ غير مسموح");
    this.bidLog.push({ seat, choice, suit: opt.suit });
    this.ev({ t: "bid", seat, choice, suit: opt.suit || null });

    if (choice === "pass") {
      if (this.hokumBid && this.bidRound === 1) {
        /* قيل حكم: من بعده يختار الصنّ أو يمرّ، حتى الموزّع */
        if (seat === this.dealer) return this._finishBidding(this.hokumBid.seat, "hokum", this.hokumBid.suit);
        this.bidTurn = (seat + 1) % 4;
        return this;
      }
      if (seat === this.dealer) {
        if (this.bidRound === 1) { this.bidRound = 2; this.bidTurn = this.firstSeat; this.ev({ t: "bidround", round: 2 }); return this; }
        this.phase = "redeal";
        this.dealer = (this.dealer + 1) % 4;
        this.ev({ t: "redeal" });
        return this;
      }
      this.bidTurn = (seat + 1) % 4;
      return this;
    }
    if (choice === "gahwa") {
      this.gahwa = true;
      const mode = suit ? "hokum" : "sun";
      return this._finishBidding(seat, mode, suit || null);
    }
    if (choice === "sun") return this._finishBidding(seat, "sun", null);
    if (choice === "ashkal") {
      this.ashkal = true;
      /* أشكل: يشتري الشريك، والمعلن هو صاحب الكلمة */
      return this._finishBidding((seat + 2) % 4, "hokum", opt.suit, seat);
    }
    if (choice === "hokum") {
      if (this.bidRound === 1) {
        this.hokumBid = { seat, suit: opt.suit };
        if (seat === this.dealer) return this._finishBidding(seat, "hokum", opt.suit);
        this.bidTurn = (seat + 1) % 4;
        return this;
      }
      return this._finishBidding(seat, "hokum", opt.suit);
    }
    throw new Error("شراءٌ غير معروف");
  }

  _finishBidding(buyerSeat, mode, trump, callerSeat) {
    this.mode = mode; this.trump = trump; this.buyerSeat = buyerSeat;
    this.callerSeat = callerSeat === undefined ? buyerSeat : callerSeat;
    this.bidTurn = null;

    /* ورقة الشراء للشاري، ثمّ الإكمال: الشاري اثنتان والباقي ثلاث */
    this.hands[buyerSeat].push(this.bidCard);
    let p = this.restIndex;
    const dealt = [[], [], [], []];
    for (let k = 0; k < 4; k++) {
      const seat = (this.firstSeat + k) % 4;
      const n = seat === buyerSeat ? 2 : 3;
      for (let i = 0; i < n; i++) { const c = this.deck[p++]; this.hands[seat].push(c); dealt[seat].push(c); }
    }
    for (let s = 0; s < 4; s++) this.hands[s].sort((a, b) => cmpCard(a, b, mode, trump));

    this.ev({ t: "buy", seat: buyerSeat, mode, trump, ashkal: this.ashkal, caller: this.callerSeat, gahwa: this.gahwa });
    this.ev({ t: "complete", buyer: buyerSeat, counts: dealt.map(d => d.length) });

    if (mode === "hokum" && this.rules.allowDouble && !this.gahwa) {
      this.phase = "doubling";
      this.doubleTurn = this._nextDoubler(1 - (buyerSeat % 2));
      this.ev({ t: "phase", phase: "doubling", seat: this.doubleTurn });
    } else {
      this._startPlay();
    }
    return this;
  }

  _nextDoubler(team) {
    for (let k = 0; k < 4; k++) { const s = (this.firstSeat + k) % 4; if (s % 2 === team) return s; }
    return team;
  }

  doubleOptions(seat) {
    if (this.phase !== "doubling") return [];
    if (seat % 2 !== this.doubleTurn % 2) return [];
    const m = this.multiplier, opts = [];
    if (m === 1) opts.push({ id: "double", label: "دبل" });
    else if (m === 2) opts.push({ id: "three", label: "ثري" });
    else if (m === 3) opts.push({ id: "four", label: "فور" });
    if (this.rules.allowGahwa && m >= 4) opts.push({ id: "gahwa", label: "قهوة" });
    opts.push({ id: "pass", label: "بس" });
    return opts;
  }

  double(seat, choice) {
    if (this.phase !== "doubling") throw new Error("ليس وقت المضاعفة");
    if (seat % 2 !== this.doubleTurn % 2) throw new Error("ليس دور فريقك");
    if (!this.doubleOptions(seat).some(o => o.id === choice)) throw new Error("خيارٌ غير مسموح");
    this.doubleHistory.push({ seat, choice });
    this.ev({ t: "double", seat, choice });

    if (choice === "pass") { this._startPlay(); return this; }
    if (choice === "gahwa") { this.gahwa = true; this._startPlay(); return this; }
    this.multiplier = choice === "double" ? 2 : choice === "three" ? 3 : 4;
    this.doubleTurn = this._nextDoubler(1 - (seat % 2));
    if (this.multiplier === 4 && !this.rules.allowGahwa) this._startPlay();
    return this;
  }

  _startPlay() {
    this.phase = "playing";
    this.leader = this.firstSeat;
    this.turn = this.firstSeat;
    this.trick = [];
    this.trickNo = 0;
    this.available = {};
    for (let s = 0; s < 4; s++) this.available[s] = findProjects(this.hands[s], this.mode, this.rules);
    this.ev({ t: "phase", phase: "playing", turn: this.turn });
  }

  legalMoves(seat) {
    if (this.phase !== "playing" || seat !== this.turn) return [];
    return legalMoves(this.hands[seat], this.trick, this.mode, this.trump, this.rules, seat);
  }
  /* المشاريع تُعلَن في الأكلة الأولى وحدها — بعدها تسقط */
  declarableProjects(seat) {
    if (this.phase !== "playing" || this.trickNo !== 0 || this.declared[seat]) return [];
    return this.available[seat] || [];
  }
  canDeclareBaloot(seat, card) {
    if (!this.rules.balootProject || this.mode !== "hokum") return false;
    if (this.balootDeclared[seat % 2]) return false;
    const r = rankOf(card), s = suitOf(card);
    if (s !== this.trump || (r !== "K" && r !== "Q")) return false;
    const other = (r === "K" ? "Q" : "K") + s;
    const playedByMe = this.tricks.some(t => t.cards.some(c => c.seat === seat && c.card === other)) ||
                       this.trick.some(c => c.seat === seat && c.card === other);
    return this.hands[seat].includes(other) || playedByMe;
  }

  play(seat, card, opts = {}) {
    if (this.phase !== "playing") throw new Error("ليس وقت اللعب");
    if (seat !== this.turn) throw new Error("ليس دورك");
    if (!this.legalMoves(seat).includes(card)) throw new Error("ورقةٌ غير مسموحة");

    if (this.trickNo === 0) {
      if (opts.declare && this.rules.projects) {
        this.declared[seat] = (this.available[seat] || []).slice();
        if (this.declared[seat].length) {
          this.ev({ t: "project", seat, projects: this.declared[seat].map(pubProject) });
        }
      } else this.declared[seat] = this.declared[seat] || [];
    }
    if (opts.baloot && this.canDeclareBaloot(seat, card)) {
      this.balootDeclared[seat % 2] = true;
      this.balootTeam = seat % 2;
      this.bidLog.push({ seat, choice: "baloot" });
      this.ev({ t: "baloot", seat });
    }

    this.hands[seat] = this.hands[seat].filter(c => c !== card);
    this.trick.push({ seat, card });
    this.ev({ t: "play", seat, card, n: this.hands[seat].length });

    if (this.trick.length === 4) {
      const winner = trickWinner(this.trick, this.mode, this.trump);
      let pts = this.trick.reduce((a, t) => a + cardValue(t.card, this.mode, this.trump), 0);
      this.trickNo++;
      if (this.trickNo === 8) pts += 10;          /* آخر أكلة */
      this.rawPoints[winner % 2] += pts;
      this.tricks.push({ winner, cards: this.trick.slice(), points: pts });
      this.lastTrick = this.trick.slice();
      this.lastTrickWinner = winner;
      this.ev({ t: "trick", winner, no: this.trickNo, points: pts, cards: this.lastTrick });
      this.trick = [];
      this.leader = winner; this.turn = winner;

      if (this.trickNo === 1) {
        const res = resolveProjects(this.declared, this.firstSeat);
        this.projectsCounted = res.counted;
        this.projectsTeam = res.team;
        this.projectsShown = true;
        if (res.team !== null) this.ev({ t: "projects", team: res.team, counted: res.counted.map(c => ({ seat: c.seat, project: pubProject(c.project) })) });
      }
      if (this.trickNo === 8) this._finishHand();
    } else {
      this.turn = (seat + 1) % 4;
    }
    return this;
  }

  _finishHand() {
    this.phase = "handover";
    this.turn = null;
    const res = scoreHand({
      mode: this.mode, trump: this.trump, buyerSeat: this.buyerSeat,
      multiplier: this.multiplier, gahwa: this.gahwa, tricks: this.tricks,
      rawPoints: this.rawPoints, projectsCounted: this.projectsCounted, balootTeam: this.balootTeam
    }, this.rules);
    this.lastResult = res;

    if (this.gahwa) {
      /* القهوة: من صدق أخذ الصكّة كلَّها، ومن كذب أعطاها */
      const winner = res.buyerWon ? this.buyerSeat % 2 : 1 - (this.buyerSeat % 2);
      this.scores[winner] = Math.max(this.scores[winner], this.rules.targetScore);
    } else {
      this.scores[0] += res.abnat[0];
      this.scores[1] += res.abnat[1];
    }
    this.history.push({
      hand: this.handNo, mode: this.mode, trump: this.trump, buyer: this.buyerSeat,
      multiplier: this.multiplier, gahwa: this.gahwa, abnat: res.abnat.slice(),
      raw: res.raw.slice(), projRaw: res.projRaw.slice(), capot: res.capot,
      buyerWon: res.buyerWon, scores: this.scores.slice()
    });
    this.ev({ t: "handend", result: res, scores: this.scores.slice() });

    const t = this.rules.targetScore;
    if (this.scores[0] >= t || this.scores[1] >= t) {
      this.finished = true;
      this.phase = "finished";
      this.winnerTeam = this.scores[0] === this.scores[1]
        ? this.buyerSeat % 2
        : (this.scores[0] > this.scores[1] ? 0 : 1);
      this.ev({ t: "matchend", team: this.winnerTeam, scores: this.scores.slice() });
    }
    this.dealer = (this.dealer + 1) % 4;
    return res;
  }

  /* من عليه الدور الآن، أيًّا كان الطور — يحتاجها الخادم للمؤقّت والبوت */
  actingSeat() {
    if (this.phase === "bidding") return this.bidTurn;
    if (this.phase === "doubling") return this.doubleTurn;
    if (this.phase === "playing") return this.turn;
    return null;
  }
}

const pubProject = p => ({ type: p.type, label: PROJECT_AR[p.type], cards: p.cards, suit: p.suit || null });

/* ترتيب اليد على الشاشة: بالنوع ثمّ بالقوّة داخل النوع */
function cmpCard(a, b, mode, trump) {
  const sa = suitOf(a), sb = suitOf(b);
  if (sa !== sb) return SUITS.indexOf(sa) - SUITS.indexOf(sb);
  const order = (mode === "hokum" && sa === trump) ? TRUMP_ORDER : (mode ? SUN_ORDER : SEQ_ORDER);
  return order.indexOf(rankOf(a)) - order.indexOf(rankOf(b));
}

/* ── المنظور ──
   ما يراه صاحب المقعد `seat` ولا شيء غيره. أوراق الآخرين أعدادٌ لا أوراق،
   وورقةُ الشراء تختفي بعد انتهاء الشراء، والمشاريع لا تُكشَف أوراقُها إلا
   بعد أن تُحسَم في نهاية الأكلة الأولى. `seats` اختياريّة يمرّرها الخادم
   ليضمّ بيانات اللاعبين (الاسم والصورة) إلى المنظور نفسه. */
function view(m, seat, seats) {
  const playing = m.phase === "playing" || m.phase === "doubling" || m.phase === "handover" || m.phase === "finished";
  const declaredPub = {};
  for (const [s, ps] of Object.entries(m.declared || {})) {
    declaredPub[s] = (ps || []).map(p => m.projectsShown ? pubProject(p) : { type: p.type, label: PROJECT_AR[p.type] });
  }
  return {
    phase: m.phase, handNo: m.handNo, dealer: m.dealer, firstSeat: m.firstSeat,
    scores: m.scores.slice(), rules: m.rules,
    bidCard: m.phase === "bidding" ? m.bidCard : (playing ? m.bidCard : null),
    bidRound: m.bidRound, bidTurn: m.bidTurn, hokumBid: m.hokumBid, bidLog: m.bidLog || [],
    mode: m.mode, trump: m.trump, buyerSeat: m.buyerSeat, callerSeat: m.callerSeat, ashkal: m.ashkal,
    multiplier: m.multiplier, gahwa: m.gahwa, doubleTurn: m.doubleTurn,
    trick: (m.trick || []).slice(), trickNo: m.trickNo || 0, turn: m.turn, leader: m.leader,
    lastTrick: m.lastTrick, lastTrickWinner: m.lastTrickWinner,
    handCounts: m.hands ? m.hands.map(h => h.length) : [0, 0, 0, 0],
    rawPoints: (m.rawPoints || [0, 0]).slice(),
    tricksWon: m.tricks ? [m.tricks.filter(t => t.winner % 2 === 0).length, m.tricks.filter(t => t.winner % 2 === 1).length] : [0, 0],
    declared: declaredPub, projectsTeam: m.projectsTeam ?? null, balootTeam: m.balootTeam ?? null,
    lastResult: m.lastResult || null, history: m.history || [],
    finished: !!m.finished, winnerTeam: m.winnerTeam,
    me: seat == null ? null : {
      seat,
      hand: m.hands ? m.hands[seat].slice() : [],
      legal: m.legalMoves ? m.legalMoves(seat) : [],
      bidOptions: m.bidOptions ? m.bidOptions(seat) : [],
      doubleOptions: m.doubleOptions ? m.doubleOptions(seat) : [],
      projects: m.declarableProjects ? m.declarableProjects(seat).map(pubProject) : [],
      balootCards: (m.phase === "playing" && m.hands) ? m.hands[seat].filter(c => m.canDeclareBaloot(seat, c)) : []
    },
    players: seats || null
  };
}

module.exports = {
  BalootMatch, DEFAULTS, RAW_TOTAL,
  SUITS, RANKS, SUIT_AR, SUIT_SYM, PROJECT_AR, PROJECT_RANK, PROJECT_RAW,
  SUN_VALUES, TRUMP_VALUES, SUN_ORDER, TRUMP_ORDER, SEQ_ORDER,
  makeDeck, shuffle, rngFrom, rankOf, suitOf, cardAr, cmpCard,
  cardValue, strength, trickWinner, legalMoves,
  findProjects, projectRaw, resolveProjects, scoreHand, rawToAbnat, view, pubProject
};
