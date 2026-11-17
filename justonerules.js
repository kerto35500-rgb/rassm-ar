/* 🔤 «كلمة واحدة فقط» — المحرّك.
 *
 * محرّكٌ نقيّ (كمحرّك لودو): أفعالٌ تدخل، وحالةٌ وأحداثٌ تخرج. لا مؤقّتات
 * ولا مقابس — الخادمُ يملك الزمن ويستدعي timeout().
 *
 * ── اللعبة (Just One، Repos Production 2018؛ وتطبيقُ Board Game Arena) ──
 *   تعاونيّة، ٣–٧ لاعبين، ١٣ بطاقة. في كلّ جولةٍ واحدٌ «مخمّن» والبقيّةُ
 *   «يلمّحون»، والدورُ يتناوب.
 *   ١) اختيار الكلمة: المخمّنُ يختار رقمًا من ١ إلى ٥ دون أن يرى البطاقة،
 *      فتصير الكلمةُ بذلك الرقم هي السرّيّة (كما في اللعبة الأصليّة).
 *      ومن لا يعرف الكلمة من الملمّحين يقول «ما أعرفها» فيختار المخمّنُ رقمًا آخر.
 *   ٢) التلميح: كلُّ ملمّحٍ يكتب كلمةً واحدةً سرًّا (وكلمتين مع ثلاثة لاعبين).
 *   ٣) الحذف الآليّ (public/justone/norm.js): المتطابقان بعد التطبيع يُحذفان
 *      معًا، وما كان الكلمةَ نفسها أو من عائلتها يُحذف، وما زاد على كلمةٍ يُحذف.
 *   ٤) المراجعة بالتصويت: ما لا تعرفه الآلة (الترجمة، الجمع المكسَّر، العائلة
 *      البعيدة) يشطبه الملمّحون — ويُحذف ما شطبه أكثرُ من نصفهم.
 *   ٥) التخمين: يرى المخمّنُ ما نجا، فيخمّن أو يتخطّى.
 *   النقاط: إصابةٌ = +١. خطأٌ = تضيع البطاقةُ والتي بعدها (وإن كانت الأخيرة
 *   خُصمت نقطة). تخطٍّ = تضيع البطاقةُ وحدها.
 */
"use strict";

const N = require("./public/justone/norm");

const CARDS = 13;
const MAX_CLUE = 24;           /* أطولُ تلميح (حرفًا) */
const MAX_UNKNOWN = 3;         /* «ما أعرفها» في الجولة الواحدة — كي لا تُعطَّل بلا نهاية */

/* تصنيفُ الفريق في النهاية (من وثيقة التصميم) */
const RATINGS = [
  { min: 13, id: "legend", ar: "أسطوري", icon: "🏆", line: "١٣ من ١٣ — تفاهمٌ لا يُصدَّق!" },
  { min: 10, id: "amazing", ar: "مذهل", icon: "🌟", line: "فريقٌ يقرأ أفكارَ بعضه" },
  { min: 7, id: "good", ar: "جيّد", icon: "👍", line: "بداية حلوة — والمرّة الجاية أحسن" },
  { min: 0, id: "try", ar: "حاولوا التفاهم بشكلٍ أفضل", icon: "🤝", line: "التلميحُ فنّ… جرّبوا مرّةً ثانية" }
];
const rating = s => RATINGS.find(r => s >= r.min);

/* أسبابُ الحذف كما تُعرض للّاعبين */
const OUT_AR = {
  dup: "مكرّر", target: "الكلمة نفسها أو من عائلتها", multi: "أكثر من كلمة",
  empty: "فارغ", vote: "شطبه الفريق"
};

class JustOneMatch {
  /**
   * @param {{id:string,name:string}[]} players — بترتيب الجلوس
   * @param {{deal:(used:Set<string>)=>string[], rng?:()=>number, cards?:number}} opts
   */
  constructor(players, opts = {}) {
    if (!Array.isArray(players) || players.length < 3) throw new Error("اللعبة تحتاج ٣ لاعبين على الأقلّ");
    if (players.length > 7) throw new Error("سبعةُ لاعبين على الأكثر");
    if (typeof opts.deal !== "function") throw new Error("لا بنكَ كلمات");
    this.players = players.map(p => ({ id: String(p.id), name: String(p.name), on: true }));
    this.rng = opts.rng || Math.random;
    this.dealFn = opts.deal;
    this.cardsTotal = opts.cards || CARDS;
    this.deckLeft = this.cardsTotal;   /* بطاقاتٌ لم تُسحب بعد */
    this.score = 0;
    this.round = 0;
    this.used = new Set();             /* تطبيعاتُ كلّ كلمةٍ ظهرت — لا تتكرّر بطاقة */
    this.history = [];
    this.events = [];
    this.gi = Math.floor(this.rng() * this.players.length) - 1;   /* يتقدّم في startRound */
    this.phase = "idle";
    this.startRound();
  }

  /* ── أدوات ── */
  ev(e) { this.events.push(e); return e; }
  takeEvents() { const e = this.events; this.events = []; return e; }
  player(pid) { return this.players.find(p => p.id === String(pid)); }
  get guesser() { return this.players[this.gi]; }
  isGuesser(pid) { return !!this.guesser && this.guesser.id === String(pid); }
  givers() { return this.players.filter(p => p.id !== this.guesser.id && p.on); }
  isGiver(pid) { const p = this.player(pid); return !!p && p.on && !this.isGuesser(pid); }
  onlineCount() { return this.players.filter(p => p.on).length; }

  draw() {
    const card = this.dealFn(this.used);
    for (const w of card) this.used.add(N.norm(w));
    return card;
  }

  /* ══════════ الجولة ══════════ */

  startRound() {
    if (this.deckLeft <= 0) return this.finish();
    this.deckLeft--;
    this.round++;
    /* المخمّنُ التالي ممّن هو حاضر */
    for (let k = 0; k < this.players.length; k++) {
      this.gi = (this.gi + 1) % this.players.length;
      if (this.players[this.gi].on) break;
    }
    /* مع ثلاثة لاعبين (أو أقلّ حاضرين) يكتب كلُّ ملمّحٍ تلميحين — القاعدةُ الرسميّة */
    this.cluesPer = this.onlineCount() <= 3 ? 2 : 1;
    this.card = this.draw();
    this.disabled = [];
    this.unknowns = 0;
    this.pickNo = null;
    this.secret = null;
    this.clues = [];
    this.submitted = new Set();
    this.votes = {};
    this.ready = new Set();
    this.guess = null;
    this.result = null;
    this.order = null;
    this.phase = "pick";
    this.ev({ t: "round", round: this.round, guesser: this.guesser.id });
  }

  /** المخمّنُ يختار رقمًا من ١ إلى ٥ وهو لا يرى البطاقة. */
  pick(pid, n) {
    if (this.phase !== "pick") throw new Error("ليس وقتَ اختيار الرقم");
    if (!this.isGuesser(pid)) throw new Error("المخمّنُ وحده يختار الرقم");
    n = Number(n);
    if (!(n >= 1 && n <= 5) || this.disabled.includes(n)) throw new Error("رقمٌ غير متاح");
    this.pickNo = n;
    this.secret = this.card[n - 1];
    this.phase = "clues";
    this.ev({ t: "picked", no: n });
  }

  /** ملمّحٌ لا يعرف الكلمة: يُعاد الاختيار برقمٍ آخر (والرقمُ هذا يُعطَّل). */
  unknown(pid) {
    if (this.phase !== "clues") throw new Error("ليس الآن");
    if (!this.isGiver(pid)) throw new Error("للملمّحين وحدهم");
    if (this.unknowns >= MAX_UNKNOWN) throw new Error("كفى تغييرًا في هذه الجولة");
    this.unknowns++;
    this.disabled.push(this.pickNo);
    /* البطاقةُ كلُّها مجهولة؟ بطاقةٌ جديدةٌ لا تُحسَب من الثلاث عشرة */
    if (this.disabled.length >= 5) { this.card = this.draw(); this.disabled = []; }
    this.pickNo = null; this.secret = null;
    this.clues = []; this.submitted = new Set();
    this.phase = "pick";
    this.ev({ t: "unknown", by: String(pid) });
  }

  /** تلميحاتُ ملمّح (واحدٌ، أو اثنان مع ثلاثة لاعبين). تُكتب سرًّا وتُستبدَل
      إن أعاد الإرسال ما دامت المرحلةُ مفتوحة. */
  submit(pid, list) {
    if (this.phase !== "clues") throw new Error("ليس وقتَ التلميح");
    if (!this.isGiver(pid)) throw new Error("المخمّنُ لا يلمّح");
    const arr = (Array.isArray(list) ? list : [list]).map(x => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, MAX_CLUE));
    const texts = arr.filter(Boolean).slice(0, this.cluesPer);
    if (!texts.length) throw new Error("اكتب تلميحًا");
    this.clues = this.clues.filter(c => c.pid !== String(pid));
    texts.forEach(t => this.clues.push({ id: 0, pid: String(pid), text: t, n: N.norm(t), out: null }));
    this.clues.forEach((c, i) => { c.id = i; });
    this.submitted.add(String(pid));
    this.ev({ t: "submitted", by: String(pid) });
    if (this.givers().every(g => this.submitted.has(g.id))) this.closeClues();
  }

  /** الحذف الآليّ (القسم الثاني من وثيقة التصميم). */
  closeClues() {
    const target = this.secret;
    for (const c of this.clues) {
      if (N.isMulti(c.text)) c.out = "multi";
      else if (!c.n) c.out = "empty";
      else if (N.related(c.text, target)) c.out = "target";
    }
    /* التطابقُ ١٠٠٪ بعد التطبيع ⇒ يُحذف الجميع — حتى تلميحا لاعبٍ واحد */
    const groups = {};
    for (const c of this.clues) if (c.n) (groups[c.n] = groups[c.n] || []).push(c);
    for (const k in groups) if (groups[k].length > 1) for (const c of groups[k]) if (!c.out) c.out = "dup";
    /* تنبيهٌ للمصوّتين لا حذف: متشابهان (مفردٌ وجمع، عائلة)، أو حروفٌ لاتينيّة (قد تكون ترجمة) */
    const alive = this.clues.filter(c => !c.out);
    for (const c of alive) {
      c.sim = alive.some(o => o !== c && N.similar(o.text, c.text));
      c.latin = /[a-z]/i.test(c.text);
    }
    this.ev({ t: "filtered", removed: this.clues.filter(c => c.out).length, kept: alive.length });
    if (!alive.length) return this.reveal("empty");
    this.votes = {};
    this.ready = new Set();
    this.phase = "review";
  }

  /** ملمّحٌ يشطب تلميحًا (أو يتراجع عن شطبه). */
  strike(pid, clueId) {
    if (this.phase !== "review") throw new Error("ليس وقتَ المراجعة");
    if (!this.isGiver(pid)) throw new Error("للملمّحين وحدهم");
    const c = this.clues[Number(clueId)];
    if (!c || c.out) throw new Error("تلميحٌ غير موجود");
    const s = this.votes[c.id] = this.votes[c.id] || new Set();
    if (s.has(String(pid))) s.delete(String(pid)); else s.add(String(pid));
    this.ready.delete(String(pid));     /* غيّر رأيه ⇒ لم يعد «جاهزًا» */
  }

  reviewReady(pid) {
    if (this.phase !== "review") throw new Error("ليس وقتَ المراجعة");
    if (!this.isGiver(pid)) throw new Error("للملمّحين وحدهم");
    this.ready.add(String(pid));
    if (this.givers().every(g => this.ready.has(g.id))) this.closeReview();
  }

  /** يُحذف ما شطبه أكثرُ من نصف الملمّحين الحاضرين. */
  closeReview() {
    const need = Math.floor(this.givers().length / 2) + 1;
    for (const c of this.clues) {
      if (c.out) continue;
      const v = this.votes[c.id];
      if (v && [...v].filter(id => this.isGiver(id)).length >= need) c.out = "vote";
    }
    const alive = this.clues.filter(c => !c.out);
    this.ev({ t: "reviewed", struck: this.clues.filter(c => c.out === "vote").length, kept: alive.length });
    if (!alive.length) return this.reveal("empty");
    /* بطاقاتٌ مبعثرة: ترتيبٌ عشوائيٌّ ثابتٌ للجولة — لا يُفصح عن ترتيب الجلوس */
    this.order = alive.map(c => c.id);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.phase = "guess";
  }

  guessWord(pid, text) {
    if (this.phase !== "guess") throw new Error("ليس وقتَ التخمين");
    if (!this.isGuesser(pid)) throw new Error("المخمّنُ وحده يخمّن");
    const g = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_CLUE);
    if (!g) throw new Error("اكتب تخمينك");
    this.guess = g;
    return this.reveal(N.guessOK(g, this.secret) ? "correct" : "wrong");
  }

  skip(pid) {
    if (this.phase !== "guess") throw new Error("ليس وقتَ التخمين");
    if (!this.isGuesser(pid)) throw new Error("المخمّنُ وحده يتخطّى");
    return this.reveal("skip");
  }

  /** النتيجة (القسم الثالث): الإصابةُ نقطة؛ والخطأُ يُضيّع البطاقةَ التالية — أو
      نقطةً إن لم تبقَ بطاقة؛ والتخطّي يُضيّع البطاقةَ الحاليّة وحدها. */
  reveal(result) {
    this.result = result;
    let burned = false, lost = false;
    if (result === "correct") this.score++;
    else if (result === "wrong") {
      if (this.deckLeft > 0) { this.deckLeft--; burned = true; }
      else if (this.score > 0) { this.score--; lost = true; }
    }
    this.history.push({
      round: this.round, guesser: this.guesser.id, secret: this.secret, guess: this.guess, result,
      clues: this.clues.map(c => ({ by: c.pid, text: c.text, out: c.out }))
    });
    this.phase = "reveal";
    this.ev({ t: "result", result, burned, lost, score: this.score });
  }

  /** بعد كشف النتيجة: الجولةُ التالية أو النهاية. */
  next() {
    if (this.phase !== "reveal") throw new Error("ليس الآن");
    if (this.deckLeft <= 0) return this.finish();
    this.startRound();
  }

  finish() {
    this.phase = "over";
    const r = rating(this.score);
    this.ev({ t: "over", score: this.score, rating: r.id });
  }

  /** انقضاءُ وقت المرحلة: ما لم يُفعل يُكمَل بأرحم وجه. */
  timeout() {
    switch (this.phase) {
      case "pick": {
        const free = [1, 2, 3, 4, 5].filter(n => !this.disabled.includes(n));
        const n = free[Math.floor(this.rng() * free.length)];
        this.pick(this.guesser.id, n);
        this.ev({ t: "timeout", phase: "pick" });
        break;
      }
      case "clues": this.ev({ t: "timeout", phase: "clues" }); this.closeClues(); break;
      case "review": this.ev({ t: "timeout", phase: "review" }); this.closeReview(); break;
      case "guess": this.ev({ t: "timeout", phase: "guess" }); this.reveal("skip"); break;
      case "reveal": this.next(); break;
      default: break;
    }
  }

  /** حضورُ لاعبٍ وغيابه. غيابُ ملمّحٍ قد يُكمل مرحلةً كانت تنتظره. */
  setOnline(pid, on) {
    const p = this.player(pid);
    if (!p || p.on === !!on) return;
    p.on = !!on;
    if (this.phase === "clues" && this.givers().length && this.givers().every(g => this.submitted.has(g.id))) this.closeClues();
    else if (this.phase === "review" && this.givers().length && this.givers().every(g => this.ready.has(g.id))) this.closeReview();
  }

  /* ══════════ العرض لكلّ لاعب — المخمّنُ لا يرى الكلمة ولا التلميحات قبل وقتها ══════════ */

  view(pid) {
    pid = String(pid);
    const me = this.player(pid);
    const guesser = this.isGuesser(pid);
    const open = this.phase === "reveal" || this.phase === "over";
    const seesWord = !guesser || open;
    const clueOut = c => ({ id: c.id, text: c.text, by: c.pid, out: c.out, outAr: c.out ? OUT_AR[c.out] : null,
                            sim: !!c.sim, latin: !!c.latin,
                            votes: this.votes[c.id] ? this.votes[c.id].size : 0,
                            mine: !!(this.votes[c.id] && this.votes[c.id].has(pid)) });
    let clues = null;
    if (open) clues = this.clues.map(clueOut);
    else if (this.phase === "clues") clues = guesser ? null : this.clues.filter(c => c.pid === pid).map(clueOut);
    else if (this.phase === "review") clues = guesser ? null : this.clues.map(clueOut);
    else if (this.phase === "guess") {
      clues = guesser
        ? this.order.map(id => this.clues[id]).map(c => ({ id: c.id, text: c.text, by: c.pid }))
        : this.clues.map(clueOut);
    }
    return {
      phase: this.phase,
      round: this.round,
      cardsTotal: this.cardsTotal,
      deckLeft: this.deckLeft,
      score: this.score,
      me: pid,
      guesser: this.guesser ? this.guesser.id : null,
      isGuesser: guesser,
      cluesPer: this.cluesPer,
      players: this.players.map(p => ({
        id: p.id, name: p.name, on: p.on,
        role: this.guesser && p.id === this.guesser.id ? "guesser" : "giver",
        done: this.phase === "clues" ? this.submitted.has(p.id) : this.phase === "review" ? this.ready.has(p.id) : false
      })),
      disabled: this.disabled.slice(),
      unknownsLeft: MAX_UNKNOWN - (this.unknowns || 0),
      pickNo: this.phase === "pick" ? null : this.pickNo,
      card: seesWord ? this.card.slice() : null,
      secret: seesWord ? this.secret : null,
      clues,
      clueCount: this.clues.length,
      kept: this.phase === "guess" ? this.order.length : null,
      guess: open ? this.guess : null,
      result: open ? this.result : null,
      history: this.phase === "over" ? this.history.map(h => ({ ...h, clues: h.clues.map(c => ({ ...c })) })) : null,
      rating: this.phase === "over" ? rating(this.score) : null,
      online: !!(me && me.on)
    };
  }
}

module.exports = { JustOneMatch, CARDS, RATINGS, rating, OUT_AR, MAX_CLUE, MAX_UNKNOWN };
