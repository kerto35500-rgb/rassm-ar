/* 🎲 لودو — المحرّك.
 *
 * محرّكٌ نقيّ: لا شبكة ولا مؤقّتات ولا ملفّات. يأخذ أفعالًا (رمي، تحريك،
 * اختيار) ويُخرج حالةً وأحداثًا. والخادم وحده يعرف الزمن والمقابس.
 *
 * ── القواعد الأساسيّة (من لعبة المرجع: Yalla Ludo 1.5.1) ──
 *   • تخرج القطعة من القاعدة بالرقم ٦ وحده.
 *   • **النردُ يتجمّع**: الستّةُ تُرمى بعدها رميةٌ أخرى **قبل** أيّ حركة، وتُحفظ
 *     الأرقامُ في «بِركة» الدور (٦ ثمّ ٦ ثمّ ٤ مثلًا)؛ وبعد أوّل رقمٍ غيرِ الستّة
 *     يُنفقها اللاعبُ رقمًا رقمًا: أيُّ قطعةٍ تمشي بأيّ رقم.
 *     (من كود المرجع: offLine.Service.turingNumber، والبركةُ فيه numArray،
 *     وفي بروتوكوله الأونلاين `repeated int32 diceNum // 骰子列表`.)
 *   • ثلاثُ ستّاتٍ متتالية في البركة تُلغي الدورَ كلَّه — والستّتان قبلها لم
 *     تُلعبا بعد، فتضيعان معها (المرجع: yalla.util.isThreeSix).
 *   • أكلُ قطعةٍ يمنح رميةً جديدة، **ودخولُ قطعةٍ المركزَ كذلك** — وما بقي في
 *     البركة يبقى ويُضاف إليه (المرجع: chessEvent.Fight / chessEvent.Win).
 *   • النردُ نردُ المرجع لا نردٌ عادل: ceil(r × 6.5) مقصوصًا عند ٦، فالستّةُ
 *     ٣ من ١٣ (≈٢٣٪) وكلُّ رقمٍ آخر ٢ من ١٣ (≈١٥٪). وإن كانت قطعُ اللاعب كلُّها
 *     في القاعدة وبركتُه فارغة فنصفُ الرميات ستّةٌ مضمونة (المرجع:
 *     offLine.Random.randomNum + isAllhome). هذا نردُ المرجع في لعبه ضدّ
 *     الكمبيوتر؛ نردُ أونلاينه على خوادمه ولا يظهر في التطبيق.
 *   • مربّعاتُ الانطلاق والنجوم آمنة: لا أكلَ فيها.
 *   • لا تجاوزَ للمركز: الرمية يجب ألّا تزيد على المسافة الباقية.
 *
 * ── الأوضاع (وضعٌ واحدٌ للغرفة) ──
 *   classic  الكلاسيكيّ: الفوز بإيصال الأربع.
 *   rush     السريع: الفوز بقطعةٍ واحدة، وقطعةٌ تبدأ على الطريق.
 *   master   الاحترافيّ: قطعتان لك في مربّعٍ واحدٍ = حاجزٌ لا يُتخطّى ولا يُؤكل؛
 *            ودخولُ المركز بالرقم المطابق وإلا ارتدّت القطعة.
 *   missions المهامّ السرّيّة: أوّلُ من يُنجز مهمّته يفوز.
 *   night    الظلام: لا ترى إلا ما حول قطعك؛ والفوز بقطعةٍ واحدة.
 *   king     الملك: ثلاثةُ حرّاسٍ وملك؛ الملك يمشي على ما مشاه حرّاسُه فقط.
 *
 * ── المعزّزات (اختياريّة مع أيّ وضع) ── وحدةٌ منفصلة أدناه: النرد الذهبيّ،
 *   قفزة الحظّ، درع الفقاعة، الرياح العكسيّة، تبديل الأماكن.
 *
 * ── الفرق ٢ ضدّ ٢ ── المقعدان المتقابلان فريق: (٠+٢) ضدّ (١+٣).
 *
 * ── الحلّ بطابور ──
 *   الحركة الواحدة قد تُطلق سلسلة: أكلٌ ثمّ معزّزٌ ثمّ قفزةٌ ثمّ أكلٌ آخر.
 *   وبعضُ حلقاتها تحتاج قرارًا من لاعبٍ آخر (التضحية بحارسٍ لحماية الملك)
 *   أو من اللاعب نفسه (أيَّ خصمٍ يبدّل معه). فالحلّ طابورُ مهامّ يتوقّف عند
 *   أيّ سؤالٍ ويستأنف من حيث وقف حين يأتي الجواب — لا استدعاءاتٌ متداخلة
 *   يضيع فيها مكانُ التوقّف.
 */
"use strict";

const G = require("./public/ludo/geom");
const { TRACK, LAST_TRACK, HOME_FIRST, FINISH, BASE, START, STARS, absOf } = G;

const DEAD = -2;                          /* ملكٌ أُكل، أو قطعةُ لاعبٍ خرج */
const SAFE = new Set([...START, ...STARS]);
const VISION = 4;                         /* نطاقُ الرؤية في الظلام (خطوات) */
const SACRIFICE_LOCK = 3;                 /* أدوارُ الحظر بعد التضحية */
const MAX_CHAIN = 3;                      /* أقصى تتابعٍ للمعزّزات في حركةٍ واحدة */
const MAX_ROLLS = 6000;                   /* صمّامٌ ضدّ مباراةٍ لا تنتهي */
const PITY_TURNS = 5;                     /* أدوارٌ بلا ستّة ثمّ تصير الستّةُ ٥٠٪ */

const MODES = ["classic", "rush", "master", "missions", "night", "king"];
const MODE_AR = {
  classic: "الكلاسيكيّ", rush: "السريع", master: "الاحترافيّ",
  missions: "المهامّ السرّيّة", night: "الظلام", king: "الملك"
};
const POWERS = ["gold", "jump", "bubble", "wind", "swap"];
const POWER_AR = {
  gold: "النرد الذهبيّ", jump: "قفزة الحظّ", bubble: "درع الفقاعة",
  wind: "الرياح العكسيّة", swap: "تبديل الأماكن"
};
const POWER_ICON = { gold: "🎲", jump: "🦘", bubble: "🫧", wind: "🌬️", swap: "🔄" };

const DEFAULTS = Object.freeze({
  mode: "classic", teams: false, sharedSafe: false, powerups: false, powerCount: 4,
  powerTypes: Object.freeze(POWERS.slice())
});

/** أنواعُ المعزّزات التي اختارها المضيف (بترتيب POWERS). غيرُ مُحدَّدة ⇒ كلُّها. */
function normTypes(t) {
  if (!Array.isArray(t)) return POWERS.slice();
  return POWERS.filter(p => t.includes(p));
}

function normRules(r) {
  r = r || {};
  const types = normTypes(r.powerTypes);
  return {
    mode: MODES.includes(r.mode) ? r.mode : "classic",
    teams: !!r.teams,
    sharedSafe: !!r.teams && !!r.sharedSafe,
    /* لا نوعَ مُختار ⇒ لا معزّزات (لا لوحةَ بمعزّزاتٍ لا يظهر منها شيء) */
    powerups: !!r.powerups && types.length > 0,
    powerCount: Math.max(3, Math.min(6, Math.round(+r.powerCount || 4))),
    powerTypes: types.length ? types : POWERS.slice()
  };
}

/* مولّدٌ قابلٌ للإعادة: البذرةُ نفسها تعطي المباراةَ نفسها — شرطٌ للاختبار */
function rngFrom(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const teamOf = s => s % 2;
const mateOf = s => (s + 2) % 4;

/* ══════════ المهامّ السرّيّة ══════════
   كلُّ مهمّةٍ تُقاس من الإحصاءات أو من الحالة، وكلُّها **ممكنةٌ دائمًا**:
   لا مهمّةَ تفشل نهائيًّا فيبقى صاحبُها عالقًا بلا أمل.

   والأهداف **معايَرة**: شغّلنا ٩٠٠ مباراةٍ بين البوتات وفوزُ المهامّ معطَّل،
   وقسنا متى كانت كلُّ مهمّةٍ ستكتمل لكلّ هدفٍ ممكن، ثمّ اخترنا لكلٍّ الهدفَ
   الذي يكتمل في نحو ٣٠ دورًا من أدوار صاحبه. قبل المعايرة كانت «اجمع قطعتين»
   تفوز في ٦٨٪ ممّا تُعطى فيه و«أدخِل ٣ قطع» في ٢٪ — أي أنّ الحظَّ في توزيع
   المهامّ كان يقرّر المباراة لا اللعب.
   وأُعيد القياسُ بعد نرد المرجع وبركة الستّات (الأدوارُ صارت أغنى بالحركات):
   المهامُّ كلُّها بين ٢١ و٣٦ دورًا مع لاعبين أو ثلاثة أو أربعة، بعد رفع
   «الستّات» من ٧ إلى ١٠ و«النزول على قطعتك» إلى ٤ لكلّ عدد. */
/* أرقامُ النصوص بالهنديّة كبقيّة الواجهة («٦ ١٠ مرّات» لا «٦ 10 مرّات») */
const arNum = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);

const MISSIONS = [
  /* الهدفُ دالّةٌ في عدد اللاعبين: مع خصمٍ واحدٍ لا تجد ما تأكله كما تجده
     مع ثلاثة، وفي الزحام تُقطَع الطريقُ إلى المركز أكثر. */
  { id: "eatColor", goal: () => 1, target: true,
    text: (g, t) => `كُل قطعةً للّاعب ${G.COLOR_AR[t]}`,
    prog: (m, s, t) => (m.stats[s].caps[t] || 0) },
  { id: "eat", goal: n => (n <= 2 ? 1 : 2),
    text: g => (g === 1 ? "كُل قطعةً لخصمك" : `كُل ${g === 2 ? "قطعتين" : arNum(g) + " قطع"} لخصومك`),
    prog: (m, s) => m.stats[s].capsTotal },
  /* مع أربعةٍ تكفي القطعةُ في مسار النهاية: الطريقُ إلى المركز في الزحام
     أطولُ من أن تُنافس بقيّةَ المهامّ */
  { id: "home", goal: () => 1,
    text: (g, t, n) => (n >= 4 ? "أدخِل قطعةً إلى مسار النهاية" : "أوصِل قطعةً إلى المركز"),
    prog: (m, s) => m.pieces[s].filter(pc => pc.p >= (m.seats.length >= 4 ? HOME_FIRST : FINISH)).length },
  /* أُعيدت معايرتُها مع نرد المرجع: الستّةُ صارت ٢٣٪ لا ١٧٪، ومعها ستّةُ
     القاعدة المضمونة نصفَ المرّات — فكان هدفُ السبع يكتمل في ١٨ دورًا والبقيّةُ
     في ٢٣–٣٥؛ والعشرُ تكتمل في ٢٦–٢٨ مع لاعبين أو ثلاثة أو أربعة */
  { id: "sixes", goal: () => 10, text: g => `ارمِ الرقم ٦ ${arNum(g)} مرّات`,
    prog: (m, s) => m.stats[s].sixes },
  /* تُعَدّ مرّاتُ الوقوف لا النجومُ المختلفة: النجومُ أربعٌ فقط، فكان الهدفُ
     يقفز بين «سهلٍ جدًّا» و«شبه مستحيل» ولا شيءَ بينهما */
  { id: "stars", goal: () => 3, text: g => `قِف على النجوم ${arNum(g)} مرّات`,
    prog: (m, s) => m.stats[s].starLands },
  /* البركةُ تُكثر الحركات في الدور فتكثر النزلاتُ على القطع: الثلاثُ صارت
     تكتمل في ٢١ دورًا مع لاعبين أو ثلاثة، والأربعُ في نحو ٢٩ — كبقيّة المهامّ */
  { id: "stack", goal: () => 4, text: g => `انزل بقطعةٍ على قطعةٍ لك ${arNum(g)} مرّات`,
    prog: (m, s) => m.stats[s].stackLands },
  { id: "nearEat", goal: () => 1, minPlayers: 3,
    text: () => "كُل قطعةً بقطعةٍ لم تبتعد عن قاعدتها ٦ خطوات",
    prog: (m, s) => m.stats[s].capNear },
  /* مهامُّ المعزّزات: لا تُعطى إلا إذا كانت المعزّزات مفعّلة. وتُعَدّ
     بالالتقاط لا بالنجاح: التبديلُ يخيب حين لا خصمَ في نطاقه، والرياح لا
     تدفع أحدًا حين يخلو ما خلفك — فلو عددنا النجاح وحده لصارت المهمّةُ
     رهينةَ مواقع الخصوم لا مهارةَ صاحبها. */
  /* ‏puType: مهمّةُ نوعٍ بعينه لا تُعطى إن منعه المضيف — وإلا كانت مستحيلة */
  { id: "puSwap", goal: () => 1, pu: true, puType: "swap", text: () => "التقط «تبديل الأماكن»",
    prog: (m, s) => (m.stats[s].power.swap || 0) },
  { id: "puAny", goal: () => 4, pu: true, text: g => `التقط ${arNum(g)} معزّزات`,
    prog: (m, s) => m.stats[s].powerTotal },
  { id: "puWind", goal: () => 1, pu: true, puType: "wind", text: () => "التقط «الرياح العكسيّة»",
    prog: (m, s) => (m.stats[s].power.wind || 0) },
  { id: "puGold", goal: () => 1, pu: true, puType: "gold", text: () => "التقط «النرد الذهبيّ»",
    prog: (m, s) => (m.stats[s].power.gold || 0) }
];
const MISSION_BY_ID = Object.fromEntries(MISSIONS.map(x => [x.id, x]));

function newStats() {
  return { caps: {}, capsTotal: 0, capNear: 0, sixes: 0, stars: new Set(),
           power: {}, powerTotal: 0, swaps: 0, windPush: 0, stackLands: 0, starLands: 0 };
}

/* ══════════════════════════════════════════════════════════════ */

class LudoMatch {
  /**
   * @param {object} rules   — انظر DEFAULTS
   * @param {number[]} seats — المقاعد المشاركة (٠..٣)؛ في الفرق الأربعة كلُّها
   * @param {number} seed
   */
  constructor(rules, seats, seed) {
    this.rules = normRules(rules);
    this.seats = [...new Set((seats || [0, 2]).map(Number))].filter(s => s >= 0 && s < 4).sort();
    if (this.rules.teams && this.seats.length !== 4) throw new Error("الفرق تحتاج أربعة مقاعد");
    if (this.seats.length < 2) throw new Error("اللودو لاعبان على الأقلّ");
    this.rng = rngFrom(seed == null ? (Date.now() ^ (Math.random() * 1e9)) : seed);

    const king = this.rules.mode === "king";
    this.pieces = {};
    this.stats = {};
    this.golden = {};
    this.visited = {};       /* وضع الملك: ما مشاه حرّاسُ كلّ مقعد */
    this.unlocked = {};      /* وضع الملك: هل فُكّ قفلُ الملك */
    this.out = {};           /* لاعبٌ خرج (أُكل ملكُه في اللعب الفرديّ) */
    this.reveal = {};        /* الظلام: انكشافُ اللوحة بعد الأكل حتى نهاية الدور */
    for (const s of this.seats) {
      this.pieces[s] = [0, 1, 2, 3].map(i => ({
        kind: king ? (i === 3 ? "king" : "guard") : "pawn",
        p: BASE, shield: 0, cooldown: 0
      }));
      this.stats[s] = newStats();
      this.golden[s] = false;
      this.visited[s] = new Set();
      this.unlocked[s] = false;
      this.out[s] = false;
      this.reveal[s] = false;
    }
    /* السريع: قطعةٌ على مربّع الانطلاق من البداية (من «Quick» في لعبة المرجع)
       — وإلا ضاعت الأدوار الأولى كلُّها في انتظار ستّة. */
    if (this.rules.mode === "rush") for (const s of this.seats) this.pieces[s][0].p = 0;

    this.events = [];
    this.powerups = [];
    this.missions = {};
    this.turn = this.seats[Math.floor(this.rng() * this.seats.length)];
    this.phase = "roll";
    this.dice = null;
    /* بركةُ الدور: الأرقامُ المرميّة التي لم تُنفَق بعد، بترتيب رميها.
       {v: الرقم، g: ذهبيّ؟} — الستّةُ الذهبيّة هديّةٌ لا تُحسَب في عقوبة الثلاث */
    this.pool = [];
    this.dry = {};           /* أدوارٌ متتالية بلا ستّة لكلّ مقعد (نظامُ التعويض) */
    this.sixTurn = false;    /* هل رمى صاحبُ الدور ستّةً في دوره هذا */
    this.legal = [];
    this.queue = [];
    this.prompt = null;
    this.after = null;
    this.winner = null;
    this.rolls = 0;
    this.moveNo = 0;

    if (this.rules.mode === "missions") this.assignMissions();
    if (this.rules.powerups) this.spawnPowers(this.rules.powerCount);
    this.ev({ t: "start", turn: this.turn, seats: this.seats.slice() });
    this.startOfTurn(this.turn);
  }

  /* ── أدوات ── */
  ev(e) { this.events.push(e); return e; }
  takeEvents() { const e = this.events; this.events = []; return e; }
  rnd(n) { return Math.floor(this.rng() * n); }
  isTeams() { return this.rules.teams; }
  allies(s) { return this.isTeams() ? [s, mateOf(s)].filter(x => this.seats.includes(x)) : [s]; }
  opponent(a, b) { return a !== b && !(this.isTeams() && teamOf(a) === teamOf(b)); }
  key(seat, p) { return p <= LAST_TRACK ? "t" + absOf(seat, p) : "h" + seat + "_" + (p - HOME_FIRST); }

  /** كلُّ القطع على مربّعٍ مطلقٍ من الطريق. */
  piecesOnAbs(abs) {
    const out = [];
    for (const s of this.seats) this.pieces[s].forEach((pc, idx) => {
      if (pc.p >= 0 && pc.p <= LAST_TRACK && absOf(s, pc.p) === abs) out.push({ seat: s, idx, pc });
    });
    return out;
  }

  /** الحاجز (الاحترافيّ): مقعدٌ له قطعتان فأكثر في مربّعٍ غيرِ آمن.
      وفي المربّع الآمن لا حاجز — من لعبة المرجع: «تنفصل القطع المتداخلة في
      المربّع الآمن». وإلا أغلق لاعبٌ مربّعَ انطلاق خصمه فحبسه في قاعدته. */
  blockadeAt(abs) {
    if (this.rules.mode !== "master" || SAFE.has(abs)) return null;
    const by = {};
    for (const o of this.piecesOnAbs(abs)) by[o.seat] = (by[o.seat] || 0) + 1;
    for (const s of Object.keys(by)) if (by[s] >= 2) return +s;
    return null;
  }

  /** الزوج المحميّ: مقعدٌ خصمٌ لِـmover له قطعتان فأكثر في مربّعٍ غيرِ آمن.
      لا يُنزَل عليه (ويُتخطّى) — من لعبة المرجع: MapEv.canMove يمنع الوصولَ إلى
      مربّعٍ فيه قطعتان فأكثر للونٍ آخر. كان الخصمُ ينزل عليهما فيأكلهما معًا.
      (في الاحترافيّ أشدّ: الحاجزُ لا يُتخطّى أيضًا — blockadeAt.) */
  pairAt(abs, mover) {
    if (SAFE.has(abs)) return null;
    const by = {};
    for (const o of this.piecesOnAbs(abs)) if (this.opponent(mover, o.seat)) by[o.seat] = (by[o.seat] || 0) + 1;
    for (const s of Object.keys(by)) if (by[s] >= 2) return +s;
    return null;
  }

  /** هل القطعةُ جزءٌ من زوجٍ لمقعدها في مربّعٍ غيرِ آمن؟ (لا تدفعها ريحٌ ولا تُبدَّل) */
  inPair(seat, idx) {
    const pc = this.pieces[seat][idx];
    if (!(pc.p >= 0 && pc.p <= LAST_TRACK)) return false;
    const abs = absOf(seat, pc.p);
    if (SAFE.has(abs)) return false;
    return this.pieces[seat].some((o, i) => i !== idx && o.p === pc.p);
  }

  /** آمنٌ: انطلاقٌ أو نجمة، أو (في الفرق مع «التأمين المشترك») مربّعٌ يقف
      فيه زميلان من مقعدين مختلفين. */
  isSafeAbs(abs) {
    if (SAFE.has(abs)) return true;
    if (this.isTeams() && this.rules.sharedSafe) {
      const seats = new Set(this.piecesOnAbs(abs).map(o => o.seat));
      for (const s of seats) if (seats.has(mateOf(s))) return true;
    }
    return false;
  }

  /** مسارُ الملك المؤمَّن: ما مشاه حرّاسُه، وحرّاسُ زميله على الطريق المشترك.
      (مسارُ النهاية خاصٌّ بكلّ لون، فلا يُعبّده إلا حرّاسُ صاحبه.) */
  secured(seat) {
    const own = this.visited[seat];
    if (!this.isTeams()) return own;
    const mate = this.visited[mateOf(seat)];
    if (!mate || !mate.size) return own;
    const all = new Set(own);
    for (const k of mate) if (k[0] === "t") all.add(k);
    return all;
  }

  /** من يحرّك هذا اللاعبُ قطعَه: نفسُه ما بقيت له قطعٌ في اللعب، وإلا —
      في الفرق — قطعُ زميله («رمي النرد للزميل»). */
  controlled(seat) {
    const live = s => this.pieces[s] && this.pieces[s].some(pc => pc.p >= BASE && pc.p < FINISH);
    if (this.out[seat]) return [];
    if (live(seat)) return [seat];
    if (this.isTeams()) { const m = mateOf(seat); if (this.seats.includes(m) && live(m)) return [m]; }
    return [];
  }

  /** مقعدٌ له قطعتان في مربّعٍ واحدٍ على الطريق (لمهمّة «اجمع قطعتين»). */
  stackOf(seat) {
    const seen = new Set();
    for (const pc of this.pieces[seat]) {
      if (pc.p < 0 || pc.p > LAST_TRACK) continue;
      const a = absOf(seat, pc.p);
      if (seen.has(a)) return true;
      seen.add(a);
    }
    return false;
  }

  /* ══════════ الحركة المشروعة ══════════ */

  /** تحريكُ قطعةٍ d خطوات — يرجع وصف الحركة أو null إن لم تكن مشروعة. */
  tryMove(owner, idx, d) {
    const pc = this.pieces[owner] && this.pieces[owner][idx];
    if (!pc || pc.p === DEAD || pc.p >= FINISH || !(d >= 1)) return null;
    const king = pc.kind === "king";

    if (pc.p === BASE) {
      if (d !== 6 || pc.cooldown > 0) return null;
      if (king && (!this.unlocked[owner] || !this.secured(owner).has(this.key(owner, 0)))) return null;
      return { owner, idx, from: BASE, to: 0, path: [0], bounce: false };
    }

    const path = [];
    let q = pc.p, bounce = false;
    for (let k = 0; k < d; k++) {
      let nx = bounce ? q - 1 : q + 1;
      if (!bounce && nx > FINISH) {
        /* الاحترافيّ وحده يرتدّ؛ بقيّةُ الأوضاع لا تتجاوز المركز أصلًا */
        if (this.rules.mode !== "master") return null;
        bounce = true; nx = q - 1;
      }
      q = nx; path.push(q);
    }

    /* الحواجز: لا تُتخطّى ولا يُنزَل عليها — إلا حاجزُ صاحب القطعة نفسه.
       والزميل محجوبٌ بحاجز زميله كغيره («للحفاظ على التوازن»). */
    if (this.rules.mode === "master") {
      for (const s of path) {
        if (s > LAST_TRACK) continue;
        const b = this.blockadeAt(absOf(owner, s));
        if (b !== null && b !== owner) return null;
      }
    }

    /* الملك لا يطأ إلا المسار المؤمَّن — كلَّ مربّعٍ في طريقه لا مربّعَ الوصول وحده */
    if (king) {
      const sec = this.secured(owner);
      for (const s of path) if (!sec.has(this.key(owner, s))) return null;
    }

    const t = q;
    /* زوجُ الخصم (قطعتان من لونٍ واحد) لا يُنزَل عليه — ويُتخطّى */
    if (t <= LAST_TRACK && this.pairAt(absOf(owner, t), owner) !== null) return null;
    /* الفرق بلا «تأمينٍ مشترك»: لا يقف زميلان في مربّعٍ واحدٍ غيرِ آمن */
    if (t <= LAST_TRACK && this.isTeams() && !this.rules.sharedSafe) {
      const abs = absOf(owner, t);
      if (!SAFE.has(abs) &&
          this.piecesOnAbs(abs).some(o => o.seat !== owner && teamOf(o.seat) === teamOf(owner))) return null;
    }
    return { owner, idx, from: pc.p, to: t, path, bounce };
  }

  /** الحركاتُ المشروعة: كلُّ قطعةٍ مع كلّ رقمٍ مختلفٍ في البركة (المرجع:
      Service.chooseItem يجمع getChessesByStep لكلّ رقمٍ في numArray). وكلُّ
      حركةٍ تحمل رقمَها `d` — فيُنفَق من البركة حين تُلعَب. ورقمٌ مكرّرٌ في
      البركة (٦ و٦) يُعرَض مرّةً: الحركتان متطابقتان. */
  computeLegal(actor, only) {
    const out = [];
    const values = only != null ? [only] : [...new Set(this.pool.map(x => x.v))];
    for (const d of values) {
      for (const owner of this.controlled(actor)) {
        let baseSeen = false;
        this.pieces[owner].forEach((pc, idx) => {
          /* قطعُ القاعدة متكافئة: نعرض أوّلها وحدها (إلا ملكًا أو حارسًا مقفلًا يختلف) */
          if (pc.p === BASE) {
            if (pc.kind === "pawn" && baseSeen) return;
            if (pc.kind === "pawn") baseSeen = true;
          }
          const mv = this.tryMove(owner, idx, d);
          if (mv) out.push({ ...mv, d });
        });
      }
    }
    return out.map((m, i) => ({ id: i, ...m }));
  }

  /** نردُ المرجع (Yalla Ludo 1.5.1، offLine.Random.randomNum):
      ceil(r × 6.5) ثمّ ما زاد على ٦ صار ستّة ⇒ P(6) = 3/13 وكلُّ رقمٍ آخر 2/13.
      وإن كانت قطعُ مَن يرمي كلُّها في القاعدة وبركتُه فارغة، فنصفُ الرميات
      ستّةٌ مضمونة قبل ذلك (`randomNum(Math.random() > .5)` مع isAllhome). */
  rollDie(seat) {
    const owners = this.controlled(seat);
    const allHome = owners.length > 0 && owners.every(o => this.pieces[o].every(pc => pc.p === BASE));
    const base = () => { const v = Math.ceil(this.rng() * 6.5); return v < 1 ? 1 : v > 6 ? 6 : v; };
    if (allHome && this.pool.length === 0) return this.rng() < 0.5 ? 6 : base();     /* ٦١٫٥٪ */
    /* نظامُ التعويض (طلبُ المستخدم): خمسةُ أدوارٍ متتالية بلا ستّة ⇒ الستّةُ
       نصفُ الرميات (٥٠٪، والبقيّةُ ١–٥ بالتساوي) حتى تأتي، ثمّ يُصفَّر العدّاد
       فورًا. (والقاعدةُ مع القاعدة الممتلئة أعلاه أسخى، فلا يُجمَع الاثنان.) */
    if ((this.dry[seat] || 0) >= PITY_TURNS) return this.rng() < 0.5 ? 6 : 1 + Math.floor(this.rng() * 5);
    return base();
  }

  /** ثلاثُ ستّاتٍ متتالية في البركة ⇒ يُلغى الدور — كلعبة المرجع حرفيًّا
      (yalla.util.isThreeSix يعدّ الستّاتِ المتتالية في numArray حتى آخر رقم):
      ستّتان باقيتان ثمّ ستّةُ المكافأة بعد الأكل ثلاثٌ متتالية ⇒ يُلغى.
      ولا يمنع ذلك أكثرَ من ثلاثة نرودٍ في الدور حين يفصل بين الستّات رقمٌ
      آخر: ٦ ٦ ٣ ← لُعبت ستّةٌ فأكلت ← بقي ٦ ٣ ← المكافأة ٦ ثمّ ٢ (مثالُ
      المستخدم). والستّةُ الذهبيّة (المعزّز) لا تُعَدّ ولا تقطع العدّ. */
  threeSix() {
    let n = 0;
    for (const x of this.pool) {
      if (x.g) continue;
      n = x.v === 6 ? n + 1 : 0;
    }
    return n >= 3;
  }

  /** بعد رقمٍ غير الستّة، أو بعد حركةٍ بقي في البركة بعدها شيء: نعرض ما
      يُلعَب بالبركة. لا شيء ⇒ ينتقل الدور (وتضيع الأرقامُ التي لا تُلعَب). */
  offerMoves(seat) {
    this.legal = this.computeLegal(seat);
    if (!this.legal.length) {
      this.ev({ t: "pass", seat, why: "noMove" });
      return this.nextTurn();
    }
    this.phase = "move";
  }

  /** المقعد الذي ننتظر فعله: صاحبُ السؤال إن وُجد سؤال، وإلا صاحبُ الدور. */
  actingSeat() {
    if (this.phase === "over") return null;
    if (this.prompt) return this.prompt.seat;
    if (this.phase === "roll" || this.phase === "move") return this.turn;
    return null;
  }

  /* ══════════ الأفعال ══════════ */

  roll(seat) {
    if (this.phase !== "roll" || seat !== this.turn) throw new Error("ليس دورك في الرمي");
    if (++this.rolls > MAX_ROLLS) return this.endGame({ seats: [], reason: "limit" });
    const golden = this.golden[seat];
    let v;
    if (golden) { v = 6; this.golden[seat] = false; }
    /* `_loaded`: نردٌ محمَّلٌ للاختبارات وحدها — لا يضبطه الخادم أبدًا */
    else if (this._loaded && this._loaded.length) v = this._loaded.shift();
    else v = this.rollDie(seat);
    this.pool.push({ v, g: !!golden });
    this.dice = v;
    /* ستّة ⇒ يُصفَّر عدّادُ التعويض فورًا */
    if (v === 6) { this.dry[seat] = 0; this.sixTurn = true; }
    this.ev({ t: "roll", seat, v, golden, pool: this.pool.map(x => x.v) });

    if (v === 6) this.stats[seat].sixes++;

    /* مهمّةُ «ارمِ ٦ كذا مرّة» قد تكتمل برميةٍ لا حركةَ بعدها — فالفوزُ يُفحَص
       هنا أيضًا لا بعد التحريك وحده */
    if (this.rules.mode === "missions") {
      const w = this.checkWin();
      if (w) return this.endGame(w);
    }

    if (v === 6) {
      /* ثلاثُ ستّات: يضيع الدورُ كلُّه بما في البركة */
      if (this.threeSix()) {
        this.ev({ t: "pass", seat, why: "three6" });
        return this.nextTurn();
      }
      /* الستّة: رميةٌ أخرى **قبل** أيّ حركة، والرقمُ محفوظٌ في البركة */
      this.phase = "roll";
      this.legal = [];
      this.ev({ t: "again", seat, why: "six" });
      return;
    }
    this.offerMoves(seat);
  }

  /** تحريكٌ بمعرّف الحركة من قائمة `legal`. */
  move(seat, moveId) {
    if (this.phase !== "move" || seat !== this.turn) throw new Error("ليس دورك في التحريك");
    const mv = this.legal.find(m => m.id === Number(moveId));
    if (!mv) throw new Error("حركةٌ غير مشروعة");
    this.moveNo++;
    /* يُنفَق رقمُ الحركة من البركة (المرجع: random.removeNum(chooseNum)) */
    const k = this.pool.findIndex(x => x.v === mv.d);
    if (k >= 0) this.pool.splice(k, 1);
    /* extra: دخولُ المركز (يُضبط في walk)؛ captured: الأكل. والستّةُ لم تعد
       تمنح رميةً بعد الحركة — منحتها قبلها */
    this.after = { actor: seat, extra: false, captured: false };
    this.phase = "resolving";
    this.legal = [];
    this.walk(mv, "move");
    this.queue.push({ k: "land", owner: mv.owner, idx: mv.idx, depth: 0, actor: seat });
    this.pump();
  }

  /** جوابُ سؤالٍ معلّق: تضحيةٌ بحارس، أو اختيارُ خصمٍ للتبديل. */
  choose(seat, choice) {
    const pr = this.prompt;
    if (!pr || pr.seat !== seat) throw new Error("لا سؤالَ لك الآن");
    this.prompt = null;
    this.phase = "resolving";
    if (pr.kind === "sacrifice") {
      const gi = Number(choice);
      if (choice != null && choice !== "none" && pr.options.includes(gi)) {
        const g = this.pieces[pr.seat][gi];
        g.p = BASE; g.shield = 0; g.cooldown = SACRIFICE_LOCK;
        this.ev({ t: "sacrifice", seat: pr.seat, guard: gi, king: pr.king, cell: pr.cell, by: pr.by });
        if (pr.reward) this.after.captured = true;
      } else this.killKing(pr.seat, pr.king, pr.by, pr.cell, pr.reward);
    } else if (pr.kind === "swap") {
      const pick = pr.options.find(o => o.id === Number(choice)) || pr.options[0];
      this.applySwap(pr.owner, pr.idx, pick, pr.actor);
    }
    this.pump();
  }

  /* ══════════ الحلّ ══════════ */

  pump() {
    while (this.queue.length && !this.prompt) {
      const task = this.queue.shift();
      if (task.k === "land") this.taskLand(task);
      else if (task.k === "capture") this.taskCapture(task);
      else if (task.k === "power") this.taskPower(task);
    }
    if (!this.prompt && !this.queue.length && this.phase === "resolving") this.finishMove();
  }

  /** نقلُ القطعة فعلًا على مسارٍ مشروع، مع آثار المشي (مسار الملك، الإحصاءات). */
  walk(mv, how) {
    const pc = this.pieces[mv.owner][mv.idx];
    const from = pc.p;
    pc.p = mv.to;
    const king = this.rules.mode === "king";
    if (king && pc.kind === "guard") {
      if (from === BASE) this.visited[mv.owner].add(this.key(mv.owner, 0));
      else for (const s of mv.path) this.visited[mv.owner].add(this.key(mv.owner, s));
      /* القفل يُفكّ حين يخرج حارسٌ ويخطو خطوةً واحدة على الأقلّ — ويبقى مفكوكًا */
      if (pc.p >= 1 && pc.p <= FINISH && !this.unlocked[mv.owner]) {
        this.unlocked[mv.owner] = true;
        this.ev({ t: "unlock", seat: mv.owner });
      }
    }
    const actor = this.after ? this.after.actor : this.turn;
    if (pc.p <= LAST_TRACK && pc.p >= 0 && mv.owner === actor) {
      const at = absOf(mv.owner, pc.p);
      if (STARS.includes(at)) { this.stats[actor].stars.add(at); this.stats[actor].starLands++; }
      if (this.pieces[mv.owner].some((o, i) => i !== mv.idx && o.p === pc.p)) this.stats[actor].stackLands++;
    }
    this.evPos({
      t: how, owner: mv.owner, idx: mv.idx, from, to: pc.p,
      path: from === BASE ? [0] : mv.path.slice(), bounce: !!mv.bounce
    }, mv.owner, (from === BASE ? [0] : mv.path).map(q => absOf(mv.owner, q)));
    if (pc.p === FINISH) {
      this.ev({ t: "finish", owner: mv.owner, idx: mv.idx });
      /* دخولُ المركز يمنح رميةً جديدة (المرجع: chessEvent.Win ⇒ THROW_START ما
         لم يكن آخرَ قطعة). وإن كان فوزًا فحصُ الفوز يسبق الرمية في finishMove */
      if (this.after) this.after.extra = true;
    }
  }

  /** وصولُ قطعةٍ إلى مربّع: أكلُ من فيه ثمّ التقاطُ المعزّز. */
  taskLand(task) {
    const pc = this.pieces[task.owner][task.idx];
    if (!(pc.p >= 0 && pc.p <= LAST_TRACK)) return;
    const abs = absOf(task.owner, pc.p);
    if (!this.isSafeAbs(abs)) {
      const victims = this.piecesOnAbs(abs).filter(o =>
        this.opponent(task.owner, o.seat) && !(o.pc.shield > 0));
      const near = pc.p <= 6;
      for (const v of victims)
        this.queue.push({ k: "capture", seat: v.seat, idx: v.idx, by: task.owner, cell: abs,
                          reward: true, near, actor: task.actor });
      /* حمايةُ الفقاعة تُحسَب «إنقاذًا» يظهر للّاعبين */
      for (const o of this.piecesOnAbs(abs))
        if (this.opponent(task.owner, o.seat) && o.pc.shield > 0)
          this.evPos({ t: "shielded", seat: o.seat, idx: o.idx, cell: abs }, task.owner, [abs]);
    }
    this.queue.push({ k: "power", owner: task.owner, idx: task.idx, depth: task.depth, actor: task.actor });
  }

  taskCapture(task) {
    const v = this.pieces[task.seat][task.idx];
    /* قد تكون القطعة غادرت المربّع بين الجدولة والتنفيذ (تضحيةٌ سابقة مثلًا) */
    if (!(v.p >= 0 && v.p <= LAST_TRACK) || absOf(task.seat, v.p) !== task.cell) return;
    if (v.kind === "king") {
      const guards = this.pieces[task.seat]
        .map((g, i) => ({ g, i }))
        .filter(o => o.g.kind === "guard" && o.g.p >= 0 && o.g.p < FINISH)
        .map(o => o.i);
      if (guards.length) {
        this.prompt = { seat: task.seat, kind: "sacrifice", king: task.idx, by: task.by,
                        cell: task.cell, options: guards, reward: task.reward };
        this.phase = "prompt";
        this.ev({ t: "ask", seat: task.seat, kind: "sacrifice" });
        return;
      }
      return this.killKing(task.seat, task.idx, task.by, task.cell, task.reward);
    }
    v.p = BASE; v.shield = 0;
    if (task.reward && this.after) {
      this.after.captured = true;
      const a = task.actor != null ? task.actor : this.after.actor;
      const st = this.stats[a];
      st.capsTotal++;
      st.caps[task.seat] = (st.caps[task.seat] || 0) + 1;
      if (task.near) st.capNear++;
      /* الظلام: من أكل انكشفت له اللوحة حتى نهاية دوره (من لعبة المرجع) */
      for (const s of this.allies(a)) this.reveal[s] = true;
    }
    this.ev({ t: "capture", seat: task.seat, idx: task.idx, cell: task.cell, by: task.by });
  }

  killKing(seat, idx, by, cell, reward) {
    this.pieces[seat][idx].p = DEAD;
    this.ev({ t: "kingDown", seat, by, cell });
    if (reward && this.after) {
      this.after.captured = true;
      const a = this.after.actor;
      this.stats[a].capsTotal++;
      this.stats[a].caps[seat] = (this.stats[a].caps[seat] || 0) + 1;
    }
    /* اللعب الفرديّ: من أُكل ملكُه خرج من اللعبة وأُزيلت قطعُه. وفي الفرق
       يبقى بحرّاسه يُعبّد الطريق لملك زميله — والفريقُ يخسر بسقوط الملكين. */
    if (!this.isTeams()) {
      this.out[seat] = true;
      for (const pc of this.pieces[seat]) pc.p = DEAD;
      this.ev({ t: "out", seat });
    }
  }

  /* ══════════ المعزّزات ══════════ */

  powerCells() {
    const busy = new Set(this.powerups.map(x => x.cell));
    const cells = [];
    for (let a = 0; a < TRACK; a++) {
      if (SAFE.has(a) || busy.has(a) || this.piecesOnAbs(a).length) continue;
      cells.push(a);
    }
    return cells;
  }

  spawnPowers(n) {
    for (let i = 0; i < n; i++) {
      const free = this.powerCells();
      if (!free.length) return;
      const cell = free[this.rnd(free.length)];
      /* من الأنواع التي اختارها المضيف وحدها */
      const types = this.rules.powerTypes;
      const type = types[this.rnd(types.length)];
      this.powerups.push({ cell, type });
      this.evPos({ t: "spawn", cell, type }, null, [cell]);
    }
  }

  taskPower(task) {
    const { owner, idx, depth } = task;
    const pc = this.pieces[owner][idx];
    if (!this.rules.powerups || !(pc.p >= 0 && pc.p <= LAST_TRACK)) return;
    const abs = absOf(owner, pc.p);
    const k = this.powerups.findIndex(x => x.cell === abs);
    if (k < 0) return;
    const { type } = this.powerups.splice(k, 1)[0];
    const actor = task.actor != null ? task.actor : this.turn;
    const st = this.stats[actor];
    st.power[type] = (st.power[type] || 0) + 1;
    st.powerTotal++;
    this.evPos({ t: "power", type, cell: abs, owner, idx, actor }, owner, [abs]);
    this.spawnPowers(1);

    if (type === "gold") {
      this.golden[actor] = true;
    } else if (type === "bubble") {
      pc.shield = 1;
    } else if (type === "jump") {
      const r = 1 + this.rnd(3);
      let s = r;
      while (s > 0 && !this.tryMove(owner, idx, s)) s--;
      /* في الظلام لا يعرف الخصمُ أنّ قطعةً مخفيّةً التقطت قفزة: الحدثُ يُرى
         من مربّعها وحده كبقيّة أحداث المكان */
      this.evPos({ t: "jumpRoll", owner, idx, want: r, got: s }, owner, [abs]);
      if (s > 0) {
        this.walk(this.tryMove(owner, idx, s), "jump");
        if (depth < MAX_CHAIN) this.queue.unshift({ k: "land", owner, idx, depth: depth + 1, actor });
      }
    } else if (type === "wind") {
      this.applyWind(owner, idx, depth, actor);
    } else if (type === "swap") {
      const opts = this.swapOptions(owner, idx);
      if (!opts.length) this.evPos({ t: "fizzle", type, owner, idx }, owner, [abs]);
      else if (opts.length === 1) this.applySwap(owner, idx, opts[0], actor);
      else {
        this.prompt = { seat: actor, kind: "swap", owner, idx, actor, options: opts };
        this.phase = "prompt";
        this.ev({ t: "ask", seat: actor, kind: "swap" });
      }
    }
  }

  /** الرياح العكسيّة المطوّرة: خصومُ المربّعات الثلاثة خلفك يرتدّون إلى
      المربّع الرابع؛ فإن اجتمع فيه خصمان أكل الأقربُ الأبعد. ولا أحد خلفك ⇒
      تتقدّم أنت خطوة. */
  applyWind(owner, idx, depth, actor) {
    const pc = this.pieces[owner][idx];
    const a = absOf(owner, pc.p);
    const pushed = [];
    for (let k = 1; k <= 3; k++) {
      const cell = (a - k + TRACK) % TRACK;
      const block = this.blockadeAt(cell);
      for (const o of this.piecesOnAbs(cell)) {
        if (!this.opponent(owner, o.seat)) continue;
        if (block !== null && block === o.seat) continue;   /* الحاجز راسخ لا تدفعه ريح */
        if (this.inPair(o.seat, o.idx)) continue;          /* والزوجُ المحميّ كذلك */
        pushed.push({ ...o, k });
      }
    }
    if (!pushed.length) {
      const one = this.tryMove(owner, idx, 1);
      this.evPos({ t: "wind", owner, idx, pushes: [], advance: !!one }, owner, [a]);
      if (one) {
        this.walk(one, "jump");
        if (depth < MAX_CHAIN) this.queue.unshift({ k: "land", owner, idx, depth: depth + 1, actor });
      }
      return;
    }
    const dest = (a - 4 + TRACK) % TRACK;
    const pushes = [];
    for (const o of pushed) {
      const back = 4 - o.k;
      const from = o.pc.p;
      o.pc.p = Math.max(0, from - back);     /* لا يرتدّ أحدٌ خلف مربّع انطلاقه */
      pushes.push({ seat: o.seat, idx: o.idx, from, to: o.pc.p });
    }
    this.stats[actor].windPush += pushed.length;
    this.evPos({ t: "wind", owner, idx, pushes, advance: false },
               null, [a, ...pushes.map(x => absOf(x.seat, x.from)), dest]);

    /* الاصطدام في المربّع الرابع (كما اتّفقنا):
       • لونان مختلفان ⇒ يأكل الأقربُ إليك (أصغرُ k) الأبعد.
       • لونٌ واحد ⇒ لا أكل: يقفان معًا زوجًا محميًّا (pairAt) لا يُنزَل عليه.
       ولا يأكل حليفَه، ولا يمسّ قطعَ صاحب الريح، ولا يأكل في مربّعٍ آمن أو
       محميًّا بفقاعة، ولا يأكل زوجًا (قطعتين للونٍ واحد) وجده هناك. */
    if (this.isSafeAbs(dest)) return;
    const landed = pushed.filter(o => o.pc.p >= 0 && o.pc.p <= LAST_TRACK && absOf(o.seat, o.pc.p) === dest)
                         .sort((x, y) => x.k - y.k);
    if (!landed.length) return;
    const surv = landed[0];
    const count = {};
    for (const o of this.piecesOnAbs(dest)) count[o.seat] = (count[o.seat] || 0) + 1;
    for (const o of this.piecesOnAbs(dest)) {
      if (o.seat === surv.seat && o.idx === surv.idx) continue;
      if (!this.opponent(owner, o.seat)) continue;
      if (!this.opponent(surv.seat, o.seat)) continue;
      if (o.pc.shield > 0) continue;
      if (count[o.seat] >= 2) continue;
      this.queue.unshift({ k: "capture", seat: o.seat, idx: o.idx, by: surv.seat, cell: dest, reward: false });
    }
  }

  /** خصومٌ في نطاق ٥ مربّعات أمامًا أو خلفًا يمكن التبديل معهم. */
  swapOptions(owner, idx) {
    const pc = this.pieces[owner][idx];
    if (!(pc.p >= 0 && pc.p <= LAST_TRACK)) return [];
    const a = absOf(owner, pc.p);
    const out = [];
    /* في الظلام لا تبدّل إلا مع ما تراه: النطاقُ خمسةٌ والرؤيةُ أربعة، فلولا
       هذا لكشف سؤالُ «مع من تبدّل؟» خصمًا مخفيًّا في المربّع الخامس. */
    const vis = this.rules.mode === "night" ? this.visibleSet(owner) : null;
    for (let d = -5; d <= 5; d++) {
      if (!d) continue;
      const np = pc.p + d;
      /* لا يتجاوز أحدٌ مدخلَ بيته بالتبديل فيلفّ الطريقَ مرّةً ثانية */
      if (np < 0 || np > LAST_TRACK) continue;
      const cell = (a + d + TRACK) % TRACK;
      if (vis && !vis.has(cell)) continue;
      const block = this.blockadeAt(cell);
      for (const o of this.piecesOnAbs(cell)) {
        if (!this.opponent(owner, o.seat) || o.pc.shield > 0) continue;
        if (block !== null && block === o.seat) continue;
        if (this.inPair(o.seat, o.idx)) continue;          /* الزوجُ المحميّ لا يُفكّ بالتبديل */
        const op = o.pc.p - d;
        if (op < 0 || op > LAST_TRACK) continue;
        out.push({ id: out.length, seat: o.seat, idx: o.idx, d, cell });
      }
    }
    return out;
  }

  applySwap(owner, idx, o, actor) {
    const me = this.pieces[owner][idx], him = this.pieces[o.seat][o.idx];
    const a = absOf(owner, me.p), b = absOf(o.seat, him.p);
    me.p += o.d; him.p -= o.d;
    this.stats[actor].swaps++;
    this.evPos({ t: "swap", owner, idx, seat: o.seat, sidx: o.idx, a, b }, null, [a, b]);
  }

  /* ══════════ نهاية الحركة والدور ══════════ */

  finishMove() {
    const w = this.checkWin();
    if (w) return this.endGame(w);
    const a = this.after;
    this.after = null;
    this.legal = [];
    /* أكلٌ أو دخولُ المركز ⇒ رميةٌ جديدة، وما بقي في البركة يبقى فيها ويُنفَق
       مع ما يأتي (المرجع: status = THROW_START دون random.clear) */
    if (a && (a.extra || a.captured)) {
      this.phase = "roll";
      this.ev({ t: "again", seat: this.turn, why: a.captured ? "capture" : "home" });
      return;
    }
    /* وإلا: ما بقي في البركة يُلعَب، فإن لم يبقَ ما يُلعَب انتقل الدور */
    if (this.pool.length) return this.offerMoves(this.turn);
    this.nextTurn();
  }

  startOfTurn(s) {
    /* الفقاعة تدوم دورةً واحدة: تنتهي حين يعود الدور إلى صاحبها */
    for (const pc of this.pieces[s]) if (pc.shield > 0) pc.shield--;
  }

  endOfTurn(s) {
    if (!this.pieces[s]) return;
    for (const pc of this.pieces[s]) if (pc.cooldown > 0 && pc.p === BASE) pc.cooldown--;
    for (const a of this.seats) this.reveal[a] = false;
  }

  nextTurn() {
    /* دورٌ انتهى بلا ستّة ⇒ يزيد عدّادُ صاحبه */
    if (!this.sixTurn) this.dry[this.turn] = (this.dry[this.turn] || 0) + 1;
    this.sixTurn = false;
    this.endOfTurn(this.turn);
    this.pool = [];
    this.phase = "roll";
    this.dice = null;
    this.legal = [];
    let s = this.turn;
    for (let i = 0; i < 4; i++) {
      const at = this.seats.indexOf(s);
      s = this.seats[(at + 1) % this.seats.length];
      if (!this.out[s] && this.controlled(s).length) break;
    }
    this.turn = s;
    this.startOfTurn(s);
    this.ev({ t: "turn", seat: s });
  }

  /* ══════════ الفوز ══════════ */

  missionProgress(s) {
    const ms = this.missions[s];
    if (!ms) return null;
    const def = MISSION_BY_ID[ms.id];
    return Math.min(ms.goal, def.prog(this, s, ms.target));
  }

  checkWin() {
    const mode = this.rules.mode;
    const groups = this.isTeams()
      ? [[0, 2], [1, 3]]
      : this.seats.filter(s => !this.out[s]).map(s => [s]);
    /* التعادل في لحظةٍ واحدة يحسمه صاحبُ الحركة: هو من صنع اللحظة */
    const mine = g => g.includes(this.turn) || g.some(s => this.allies(this.turn).includes(s));
    groups.sort((a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0));

    const fin = s => this.pieces[s].filter(pc => pc.p === FINISH).length;
    for (const g of groups) {
      if (mode === "king") {
        if (g.some(s => this.pieces[s].some(pc => pc.kind === "king" && pc.p === FINISH)))
          return { seats: g.slice(), reason: "kingHome" };
        continue;
      }
      if (mode === "rush" || mode === "night") {
        if (g.some(s => fin(s) > 0)) return { seats: g.slice(), reason: "first" };
        continue;
      }
      if (mode === "missions") {
        const done = g.find(s => this.missions[s] && this.missionProgress(s) >= this.missions[s].goal);
        if (done != null) return { seats: g.slice(), reason: "mission", by: done };
      }
      if (g.every(s => fin(s) === 4)) return { seats: g.slice(), reason: "allHome" };
    }
    if (mode === "king") {
      const alive = groups.filter(g => g.some(s => this.pieces[s].some(pc => pc.kind === "king" && pc.p !== DEAD)));
      if (alive.length === 1) return { seats: alive[0].slice(), reason: "lastKing" };
      if (!alive.length) return { seats: [], reason: "noKings" };
    }
    return null;
  }

  endGame(w) {
    this.winner = w;
    this.phase = "over";
    this.prompt = null;
    this.queue = [];
    this.legal = [];
    const missions = {};
    for (const s of this.seats) if (this.missions[s]) missions[s] = this.missionPublic(s);
    this.ev({ t: "win", seats: w.seats, reason: w.reason, by: w.by, missions });
  }

  /* ══════════ المهامّ ══════════ */

  assignMissions() {
    const n = this.seats.length;
    const pool = MISSIONS.filter(x => (!x.pu || (this.rules.powerups && (!x.puType || this.rules.powerTypes.includes(x.puType)))) &&
                                      n >= (x.minPlayers || 0));
    const bag = pool.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = this.rnd(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    /* لا مهمّتان متطابقتان على اللوحة كلّها، ومهمّةُ «كُل لونًا» لا تستهدف
       الزميل أبدًا — فلا يُطلَب من لاعبٍ أن يهدم فريقه. */
    let i = 0;
    for (const s of this.seats) {
      const def = bag[i++ % bag.length];
      const ms = { id: def.id, goal: def.goal(n), target: null };
      if (def.target) {
        const foes = this.seats.filter(o => this.opponent(s, o));
        ms.target = foes[this.rnd(foes.length)];
      }
      this.missions[s] = ms;
    }
  }

  missionPublic(s) {
    const ms = this.missions[s];
    if (!ms) return null;
    const def = MISSION_BY_ID[ms.id];
    return { id: ms.id, goal: ms.goal, target: ms.target, text: def.text(ms.goal, ms.target, this.seats.length),
             prog: this.missionProgress(s), pu: !!def.pu };
  }

  /* ══════════ الظلام: الرؤية والحجب ══════════ */

  visibleSet(viewer) {
    const all = new Set();
    const allies = this.allies(viewer);
    if (allies.some(s => this.reveal[s])) { for (let a = 0; a < TRACK; a++) all.add(a); return all; }
    for (const s of allies) {
      all.add(START[s]);                     /* مربّعُ انطلاقك مكشوفٌ دائمًا */
      for (const pc of this.pieces[s]) {
        if (!(pc.p >= 0 && pc.p <= LAST_TRACK)) continue;
        const a = absOf(s, pc.p);
        for (let d = -VISION; d <= VISION; d++) all.add((a + d + TRACK) % TRACK);
      }
    }
    return all;
  }

  /** يُلصق بالحدث من يراه من كلّ مقعد (في الظلام وحده). */
  evPos(e, owner, cells) {
    if (this.rules.mode === "night") {
      e._see = {};
      for (const v of this.seats) {
        if (owner != null && this.allies(v).includes(owner)) { e._see[v] = cells.map(() => true); continue; }
        const vis = this.visibleSet(v);
        e._see[v] = cells.map(c => c != null && vis.has(c));
      }
    }
    return this.ev(e);
  }

  /** أحداثُ مقعدٍ بعينه: في الظلام تُحذف أو تُقصّ ما لا يراه. */
  eventsFor(raw, seat) {
    const out = [];
    for (const e of raw) {
      if (!e._see) { out.push(e); continue; }
      const see = e._see[seat] || [];
      const copy = { ...e };
      delete copy._see;
      if (see.length && see.every(Boolean)) { out.push(copy); continue; }
      /* حركةٌ مكشوفةٌ جزئيًّا: نُرسل ما يُرى من مسارها فقط (فتظهر القطعة من
         الظلام أو تغيب فيه)، ونحجب المصدرَ والوجهةَ إن لم يُريا */
      if ((e.t === "move" || e.t === "jump") && see.some(Boolean)) {
        copy.path = e.path.map((q, i) => (see[i] ? q : null));
        if (!see[see.length - 1]) copy.to = null;
        copy.from = null;
        copy.partial = true;
        out.push(copy);
      }
    }
    return out;
  }

  /* ══════════ العرض لكلّ مقعد ══════════ */

  view(seat) {
    const night = this.rules.mode === "night" && !this.winner;
    const allies = this.allies(seat);
    const vis = night ? this.visibleSet(seat) : null;
    const pieces = {};
    for (const s of this.seats) {
      pieces[s] = this.pieces[s].map(pc => {
        const o = { k: pc.kind, p: pc.p };
        if (pc.shield > 0) o.sh = 1;
        if (pc.cooldown > 0) o.cd = pc.cooldown;
        if (night && !allies.includes(s) && pc.p >= 0 && pc.p < FINISH &&
            (pc.p > LAST_TRACK || !vis.has(absOf(s, pc.p)))) return { k: pc.kind, hidden: true };
        return o;
      });
    }
    const missions = {};
    if (this.rules.mode === "missions") {
      for (const s of this.seats) {
        missions[s] = (this.winner || allies.includes(s)) ? this.missionPublic(s) : { hidden: true };
      }
    }
    const pr = this.prompt;
    return {
      rules: { ...this.rules },
      seats: this.seats.slice(),
      me: seat,
      turn: this.turn,
      phase: this.phase,
      dice: this.dice,
      /* بركةُ الدور (للجميع: النردُ يُرمى أمام الطاولة كلّها) */
      pool: this.pool.map(x => x.v),
      pieces,
      powerups: night ? this.powerups.filter(x => vis.has(x.cell)) : this.powerups.slice(),
      legal: (this.phase === "move" && this.turn === seat) ? this.legal.map(m => ({
        id: m.id, owner: m.owner, idx: m.idx, from: m.from, to: m.to, path: m.path, bounce: m.bounce, d: m.d
      })) : [],
      prompt: pr ? (pr.seat === seat ? { ...pr } : { seat: pr.seat, kind: pr.kind }) : null,
      golden: !!this.golden[seat],
      unlocked: { ...this.unlocked },
      out: { ...this.out },
      secured: this.rules.mode === "king" ? [...this.secured(seat)] : null,
      visible: night ? [...vis] : null,
      missions,
      controlled: this.controlled(seat),
      winner: this.winner ? { ...this.winner } : null,
      moveNo: this.moveNo
    };
  }
}

module.exports = {
  LudoMatch, DEFAULTS, MODES, MODE_AR, POWERS, POWER_AR, POWER_ICON, MISSIONS,
  SAFE, VISION, PITY_TURNS, SACRIFICE_LOCK, DEAD, rngFrom, normRules, teamOf, mateOf, G
};
