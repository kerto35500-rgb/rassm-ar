/* 🔐 «فكّ الشفرة» — القواعد (بلا شبكة ولا مؤقّتات: هذه في decryptosrv.js).
 *
 * فريقان (أزرق ووردي)، لكلٍّ أربعُ كلماتٍ سرّيّةٍ مرقّمة ١–٤ لا يراها الخصم.
 * في كلّ جولة: لكلّ فريقٍ «مُشفِّر» يتناوب، يأخذ شفرةً من ثلاثة أرقامٍ مختلفة
 * (٣-١-٤ مثلًا) فيكتب ثلاثةَ تلميحات — كلمةً لكلّ رقم. تُبثّ التلميحات للجميع،
 * ثمّ يحاول كلُّ فريقٍ أمرين معًا:
 *   • فكَّ شفرة زميله (المُشفِّرُ لا يشارك) — الخطأ ⇒ «سوءُ فهم» ❌ على الفريق.
 *   • اعتراضَ شفرة الخصم (من الجولة الثانية) — الإصابة ⇒ «اعتراض» ✅ للفريق.
 * اعتراضان ⇒ فوز؛ سوءا فهمٍ ⇒ خسارة؛ وبعد الجولة الثامنة: الأكثرُ اعتراضًا،
 * ثمّ الأقلُّ سوءَ فهم، وإلا فتعادل.
 *
 * التخمين ورقةٌ مشتركةٌ للفريق: كلُّ من يحقّ له يغيّر خانةً فيراها زملاؤه
 * حيّةً، ثمّ يضغط كلٌّ منهم «موافق» — وتُقفل الورقةُ حين يوافق الحاضرون جميعًا.
 * وأيُّ تغييرٍ يُسقط الموافقات (وافقوا على شيءٍ غير هذا).
 *
 * وسجلُّ التلميحات (cluesLog) يُبنى هنا: بعد كلّ كشفٍ تُضاف الجولةُ بشفرتها،
 * فتفرز الواجهةُ تلميحاتِ كلّ فريقٍ تحت أرقامها — «ورقةُ المحقّق» جاهزة.
 */
"use strict";

const N = require("./public/justone/norm");

const TEAMS = 2;
const WORDS = 4;
const CODE_LEN = 3;
const MAX_ROUNDS = 8;
const WIN_TOKENS = 2;
const MAX_CLUE = 24;
const TEAM_AR = ["الأزرق", "الوردي"];

/** كلُّ الشفرات الممكنة: ثلاثةُ أرقامٍ مختلفة من ١–٤ (٢٤ شفرة) */
const ALL_CODES = [];
for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) for (let c = 1; c <= 4; c++)
  if (a !== b && b !== c && a !== c) ALL_CODES.push([a, b, c]);

const same = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i]);
const complete = d => Array.isArray(d) && d.length === CODE_LEN && d.every(v => v >= 1 && v <= WORDS) && new Set(d).size === CODE_LEN;
const cleanClue = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, MAX_CLUE);

class DecryptoMatch {
  /**
   * @param players [{id, name, team: 0|1}] بترتيب الجلوس (يحدّد دورَ المُشفِّر)
   * @param opts.deal  (n) => n كلماتٍ مختلفة (من بنك «كلمة واحدة فقط»)
   * @param opts.rng   مولّدٌ عشوائيّ (للاختبارات)
   */
  constructor(players, opts = {}) {
    this.rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    this.players = players.map(p => ({ id: p.id, name: p.name, team: p.team === 1 ? 1 : 0, on: true }));
    for (let t = 0; t < TEAMS; t++)
      if (this.members(t).length < 2) throw new Error("كلُّ فريقٍ يحتاج لاعبَين على الأقلّ");
    const words = typeof opts.deal === "function" ? opts.deal(TEAMS * WORDS) : null;
    if (!Array.isArray(words) || words.length < TEAMS * WORDS) throw new Error("لا تكفي الكلمات");
    this.teams = [0, 1].map(t => ({
      players: this.members(t).map(p => p.id),
      secretWords: words.slice(t * WORDS, t * WORDS + WORDS),
      tokens: { intercept: 0, miscommunication: 0 },
      cluesLog: [],
      encAt: -1
    }));
    this.round = 0;
    this.phase = "clues";
    this.cur = null;
    this.history = [];
    this.ready = new Set();
    this.winner = undefined;     /* ٠ أو ١، أو null للتعادل — undefined: لم تنتهِ */
    this.reason = null;
    this.events = [];
    this.startRound();
  }

  /* ══════════ أدوات ══════════ */
  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  member(id) { return this.players.find(p => p.id === id) || null; }
  members(t) { return this.players.filter(p => p.team === t); }
  teamOf(id) { const p = this.member(id); return p ? p.team : -1; }
  other(t) { return 1 - t; }
  onlineCount() { return this.players.filter(p => p.on).length; }
  onlineIn(t) { return this.members(t).filter(p => p.on).length; }
  setOnline(id, on) {
    const p = this.member(id);
    if (!p) return;
    p.on = !!on;
    /* غيابُ موافقٍ قد يُكمل الموافقة (الحاضرون وحدهم يوافقون) */
    if (this.phase === "guess") { this.tryLockAll(); this.maybeReveal(); }
    if (this.phase === "reveal") this.maybeNext();
  }
  isEncryptor(id) {
    const t = this.teamOf(id);
    return t >= 0 && !!this.cur && this.cur[t].encryptor === id;
  }
  /** هل يُعترض في هذه الجولة؟ (الأولى بلا معلوماتٍ سابقة فلا اعتراض) */
  intercepting() { return this.round >= 2; }

  /* ══════════ الجولة ══════════ */
  /** المُشفِّرُ التالي في الفريق بالترتيب — ويُتخطّى الغائبُ إن وُجد حاضر */
  nextEncryptor(t) {
    const T = this.teams[t];
    const ids = T.players;
    for (let k = 1; k <= ids.length; k++) {
      const i = (T.encAt + k) % ids.length;
      const p = this.member(ids[i]);
      if (p && p.on) { T.encAt = i; return ids[i]; }
    }
    T.encAt = (T.encAt + 1) % ids.length;
    return ids[T.encAt];
  }

  sheet() { return { draft: [null, null, null], ok: new Set(), locked: false, final: null, auto: false }; }

  startRound() {
    this.round++;
    this.phase = "clues";
    this.ready = new Set();
    this.cur = [0, 1].map(t => ({
      encryptor: this.nextEncryptor(t),
      code: ALL_CODES[Math.floor(this.rng() * ALL_CODES.length)].slice(),
      clues: null,
      autoClues: false,
      dec: this.sheet(),
      int: this.sheet()
    }));
    this.ev({ t: "round", round: this.round, enc: this.cur.map(c => c.encryptor) });
  }

  /** المُشفِّرُ غاب ولم يرسل: يتسلّم الدورَ زميلٌ حاضر (الشفرةُ نفسُها) */
  reassignEncryptor(t) {
    if (this.phase !== "clues" || !this.cur || this.cur[t].clues) return false;
    const old = this.cur[t].encryptor;
    const op = this.member(old);
    if (op && op.on) return false;
    const T = this.teams[t];
    const before = T.encAt;
    const id = this.nextEncryptor(t);
    if (id === old || !this.member(id).on) { T.encAt = before; return false; }
    this.cur[t].encryptor = id;
    this.ev({ t: "encryptor", team: t, id, was: old });
    return true;
  }

  /* ══════════ ١) التلميحات ══════════ */
  /** يُرجع سببَ الرفض أو null — يقرؤه الخادمُ والاختبار، والواجهةُ تنبّه بمثله */
  clueProblem(t, list) {
    if (!Array.isArray(list) || list.length !== CODE_LEN) return "ثلاثةُ تلميحات — واحدٌ لكلّ رقم";
    const seen = new Set();
    const used = new Set();
    for (const e of this.teams[t].cluesLog) for (const c of e.clues) used.add(N.norm(c));
    for (const raw of list) {
      const c = cleanClue(raw);
      if (!c) return "اكتب التلميحات الثلاثة كلَّها";
      if (N.isMulti(c) || /\s/.test(c)) return "كلُّ تلميحٍ كلمةٌ واحدة — بلا مسافات";
      const n = N.norm(c);
      if (!n) return "اكتب حروفًا لا رموزًا";
      if (this.teams[t].secretWords.some(w => N.related(c, w))) return `«${c}» هي إحدى كلماتكم أو من عائلتها`;
      if (seen.has(n)) return "التلميحاتُ الثلاثة مختلفة";
      if (used.has(n)) return `«${c}» استُعملت في جولةٍ سابقة`;
      seen.add(n);
    }
    return null;
  }

  submitClues(id, list) {
    if (this.phase !== "clues") throw new Error("ليس وقتَ التلميحات");
    const t = this.teamOf(id);
    if (t < 0 || this.cur[t].encryptor !== id) throw new Error("المُشفِّرُ وحده يكتب التلميحات");
    if (this.cur[t].clues) throw new Error("أرسلتَ التلميحات");
    const why = this.clueProblem(t, list);
    if (why) throw new Error(why);
    this.cur[t].clues = list.map(cleanClue);
    this.ev({ t: "sent", team: t });
    this.maybeGuess();
  }

  sentCount() { return this.cur ? this.cur.filter(c => c.clues).length : 0; }

  maybeGuess() {
    if (this.phase !== "clues" || this.sentCount() < TEAMS) return;
    this.phase = "guess";
    this.ev({ t: "guess", round: this.round });
  }

  /* ══════════ ٢) التخمين: ورقتان لكلّ فريق ══════════ */
  sheetsOf(t) { return this.intercepting() ? ["dec", "int"] : ["dec"]; }
  /** من يحقّ له تعبئةُ الورقة: «dec» زملاءُ المُشفِّر بلا المُشفِّر، و«int» الفريقُ كلُّه */
  editors(t, kind) {
    const enc = this.cur[t].encryptor;
    return this.members(t).filter(p => kind === "int" || p.id !== enc).map(p => p.id);
  }
  canEdit(id, kind) {
    const t = this.teamOf(id);
    if (t < 0 || this.phase !== "guess") return false;
    if (!this.sheetsOf(t).includes(kind)) return false;
    return this.editors(t, kind).includes(id);
  }

  /** خانةٌ واحدة: الرقمُ إن كان في خانةٍ أخرى تبادلتا (لا يتكرّر رقمٌ في شفرة) */
  setSlot(id, kind, slot, value) {
    if (!this.canEdit(id, kind)) throw new Error("ليست ورقتك");
    const S = this.cur[this.teamOf(id)][kind];
    if (S.locked) throw new Error("أُقفلت الإجابة");
    const i = Number(slot), v = value == null || value === "" ? null : Number(value);
    if (!(i >= 0 && i < CODE_LEN)) throw new Error("خانةٌ غير موجودة");
    if (v !== null && !(v >= 1 && v <= WORDS)) throw new Error("رقمٌ من ١ إلى ٤");
    const old = S.draft[i];
    if (old === v) return;
    if (v !== null) {
      const j = S.draft.indexOf(v);
      if (j >= 0 && j !== i) S.draft[j] = old;
    }
    S.draft[i] = v;
    S.ok.clear();                     /* وافقوا على غير هذا */
    this.ev({ t: "draft", team: this.teamOf(id), kind, by: id });
  }

  confirm(id, kind, on = true) {
    if (!this.canEdit(id, kind)) throw new Error("ليست ورقتك");
    const t = this.teamOf(id);
    const S = this.cur[t][kind];
    if (S.locked) return;
    if (on && !complete(S.draft)) throw new Error("أكملوا الأرقام الثلاثة أوّلًا");
    if (on) S.ok.add(id); else S.ok.delete(id);
    this.tryLock(t, kind);
    this.maybeReveal();
  }

  /** تُقفل حين يوافق كلُّ حاضرٍ يحقّ له — ولا يُكتفى بلا أحد (انقطاعٌ قصيرٌ
      لا يُقفلها فارغة: تلك للمهلة، أو لـ lockOrphans حين يُزال الغائب) */
  tryLock(t, kind) {
    const S = this.cur[t][kind];
    if (S.locked) return;
    const on = this.editors(t, kind).filter(id => this.member(id).on);
    if (on.length && complete(S.draft) && on.every(id => S.ok.has(id))) this.lock(t, kind, false);
  }
  /** ورقةٌ لم يبقَ حاضرٌ يحقّ له تعبئتُها (غاب صاحبُها نهائيًّا): تُقفل بما فيها */
  lockOrphans() {
    if (this.phase !== "guess") return;
    for (let t = 0; t < TEAMS; t++) for (const k of this.sheetsOf(t)) {
      const S = this.cur[t][k];
      if (!S.locked && !this.editors(t, k).some(id => this.member(id).on)) this.lock(t, k, true);
    }
    this.maybeReveal();
  }
  lock(t, kind, auto) {
    const S = this.cur[t][kind];
    S.locked = true; S.auto = !!auto;
    S.final = S.draft.slice();
    this.ev({ t: "locked", team: t, kind, auto: !!auto });
  }
  tryLockAll() {
    if (this.phase !== "guess") return;
    for (let t = 0; t < TEAMS; t++) for (const k of this.sheetsOf(t)) this.tryLock(t, k);
  }
  allLocked() {
    for (let t = 0; t < TEAMS; t++) for (const k of this.sheetsOf(t)) if (!this.cur[t][k].locked) return false;
    return true;
  }
  maybeReveal() {
    if (this.phase === "guess" && this.allLocked()) this.reveal();
  }

  /* ══════════ ٣) الكشف والنقاط ══════════ */
  reveal() {
    this.phase = "reveal";
    this.ready = new Set();
    const res = [0, 1].map(t => {
      const o = this.other(t), C = this.cur[t];
      const decOK = same(C.dec.final, C.code);
      /* اعتراضُ الفريق t: ورقتُه «int» على شفرة الخصم */
      const intOK = this.intercepting() && same(C.int.final, this.cur[o].code);
      return { decOK, intOK };
    });
    for (let t = 0; t < TEAMS; t++) {
      if (!res[t].decOK) this.teams[t].tokens.miscommunication++;
      if (res[t].intOK) this.teams[t].tokens.intercept++;
      this.teams[t].cluesLog.push({ round: this.round, code: this.cur[t].code.slice(), clues: this.cur[t].clues.slice() });
    }
    this.history.push({
      round: this.round,
      teams: [0, 1].map(t => ({
        encryptor: this.cur[t].encryptor, code: this.cur[t].code.slice(), clues: this.cur[t].clues.slice(),
        autoClues: this.cur[t].autoClues,
        dec: this.cur[t].dec.final, decOK: res[t].decOK,
        int: this.intercepting() ? this.cur[t].int.final : null, intOK: res[t].intOK
      }))
    });
    this.ev({ t: "reveal", round: this.round, res });
    this.checkEnd();
  }

  /** نهايةُ الجولة: فوزٌ باعتراضين، أو خسارةٌ بسوءَي فهم (فيفوز الخصم)، أو
      انتهاءُ الجولات الثماني. وإن فاز الفريقان معًا (أو انتهت الجولات): الأكثرُ
      اعتراضًا، ثمّ الأقلُّ سوءَ فهم، وإلا فتعادل. */
  checkEnd() {
    const k = this.teams.map(T => T.tokens);
    const won = [0, 1].map(t => k[t].intercept >= WIN_TOKENS || k[1 - t].miscommunication >= WIN_TOKENS);
    if (won[0] !== won[1]) {
      const w = won[0] ? 0 : 1;
      return this.end(w, k[w].intercept >= WIN_TOKENS ? "intercept" : "miscommunication");
    }
    if (won[0] && won[1]) return this.end(this.tieBreak(), "both");
    if (this.round >= MAX_ROUNDS) return this.end(this.tieBreak(), "rounds");
  }
  tieBreak() {
    const [a, b] = this.teams.map(T => T.tokens);
    if (a.intercept !== b.intercept) return a.intercept > b.intercept ? 0 : 1;
    if (a.miscommunication !== b.miscommunication) return a.miscommunication < b.miscommunication ? 0 : 1;
    return null;
  }
  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
    this.phase = "over";
    this.ev({ t: "over", winner, reason });
  }
  /** فريقٌ غاب كلُّه: يفوز الآخر */
  forfeit(t) {
    if (this.phase === "over") return;
    this.end(this.other(t), "forfeit");
  }

  /** «التالي» بعد الكشف: تبدأ الجولةُ حين يضغطه الحاضرون جميعًا */
  readyNext(id) {
    if (this.phase !== "reveal" || !this.member(id)) return;
    this.ready.add(id);
    this.maybeNext();
  }
  maybeNext() {
    if (this.phase !== "reveal") return;
    const on = this.players.filter(p => p.on);
    if (on.length && on.every(p => this.ready.has(p.id))) this.startRound();
  }

  /* ══════════ انقضاءُ المهلة ══════════ */
  timeout() {
    if (this.phase === "clues") {
      /* من لم يرسل: تلميحاتٌ فارغة — تمضي الجولة (وفريقُه غالبًا لن يفكّها) */
      for (let t = 0; t < TEAMS; t++) if (!this.cur[t].clues) {
        this.cur[t].clues = ["—", "—", "—"];
        this.cur[t].autoClues = true;
        this.ev({ t: "timeout", phase: "clues", team: t });
      }
      this.maybeGuess();
    } else if (this.phase === "guess") {
      for (let t = 0; t < TEAMS; t++) for (const k of this.sheetsOf(t))
        if (!this.cur[t][k].locked) this.lock(t, k, true);
      this.ev({ t: "timeout", phase: "guess" });
      this.maybeReveal();
    } else if (this.phase === "reveal") {
      this.startRound();
    }
  }

  /* ══════════ العرض: لكلّ لاعبٍ ما يحقّ له ══════════ */
  view(id) {
    const my = this.teamOf(id);
    const over = this.phase === "over";
    const shown = this.phase === "reveal" || over;
    const C = this.cur;
    const sheetPub = (S, mine) => mine
      ? { draft: S.draft.slice(), ok: [...S.ok], locked: S.locked, final: S.final, auto: S.auto }
      : { locked: S.locked, final: shown ? S.final : null, auto: shown ? S.auto : false };
    return {
      me: id, myTeam: my, round: this.round, maxRounds: MAX_ROUNDS, phase: this.phase,
      intercepting: this.intercepting(),
      players: this.players.map(p => ({ id: p.id, name: p.name, team: p.team, on: p.on,
                                       enc: !!C && C[p.team].encryptor === p.id, ready: this.ready.has(p.id) })),
      teams: this.teams.map((T, t) => ({
        tokens: { ...T.tokens },
        /* كلماتُ الفريق لأصحابه وحدهم — وللجميع في النهاية */
        words: (t === my || over) ? T.secretWords.slice() : null,
        log: T.cluesLog.map(e => ({ round: e.round, code: e.code.slice(), clues: e.clues.slice() }))
      })),
      cur: C ? C.map((c, t) => ({
        encryptor: c.encryptor,
        sent: !!c.clues,
        /* التلميحاتُ تُبثّ للفريقين معًا حين يرسل المُشفِّران كلاهما */
        clues: (this.phase !== "clues" || c.encryptor === id) ? (c.clues ? c.clues.slice() : null) : null,
        autoClues: this.phase !== "clues" ? c.autoClues : false,
        /* الشفرةُ لمُشفِّرها وحده حتى الكشف */
        code: (shown || c.encryptor === id) ? c.code.slice() : null,
        dec: sheetPub(c.dec, t === my),
        int: this.intercepting() ? sheetPub(c.int, t === my) : null,
        editors: { dec: this.editors(t, "dec"), int: this.editors(t, "int") }
      })) : null,
      result: shown && this.history.length ? this.history[this.history.length - 1] : null,
      winner: over ? this.winner : undefined,
      reason: over ? this.reason : null,
      history: over ? this.history : null
    };
  }
}

module.exports = { DecryptoMatch, ALL_CODES, MAX_ROUNDS, WIN_TOKENS, CODE_LEN, WORDS, TEAM_AR, MAX_CLUE, complete, same };
