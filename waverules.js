/* 📡 «التخاطر» — القواعد (بلا شبكة ولا مؤقّتات: هذه في wavesrv.js).
 *
 * فريقان يتناوبان. في كلّ جولة يلعب فريقٌ واحد: منه «وسيطٌ» يتناوب، والبقيّةُ
 * «محلّلون»، والفريقُ الآخر «خصم».
 *   ١) التلميح: الوسيطُ وحده يرى منطقةَ الهدف على نصف الدائرة (مركزُها زاويةٌ
 *      عشوائيّة بين ٢٠ و١٦٠)، فيكتب تلميحًا يربطها بطرفَي البطاقة.
 *   ٢) المؤشر: المحلّلون يحرّكون المؤشر (حيًّا للجميع) ثمّ يوافق كلُّ حاضرٍ
 *      منهم — وأيُّ تحريكٍ يُسقط الموافقات — فيُثبَّت.
 *   ٣) الخصم يصوّت: الهدفُ يسارَ المؤشر أم يمينَه؟ بالأغلبيّة (والتعادلُ لأوّل
 *      من صوّت).
 *   ٤) الكشف: |الهدف − المؤشر| ≤ ٣ ⇒ ٤ نقاط، ≤ ٨ ⇒ ٣، ≤ ١٥ ⇒ ٢، وإلا ٠. وإن
 *      لم يصب الفريقُ المركز وأصاب الخصمُ الاتّجاه ⇒ نقطةٌ للخصم.
 * أوّلُ فريقٍ يبلغ ١٠ يفوز (وإن بلغاها معًا فالأعلى، والتعادلُ يُكمل اللعب).
 *
 * الزاويةُ ٠ عند الطرف الأيسر للبطاقة و١٨٠ عند الأيمن.
 */
"use strict";

const ZONES = [{ pts: 4, half: 3 }, { pts: 3, half: 8 }, { pts: 2, half: 15 }];
const MIN_T = 20, MAX_T = 160;
const WIN = 10;
const REROLLS = 2;
const MAX_CLUE = 60;

const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
const round1 = a => Math.round(a * 10) / 10;
/** نقاطُ المؤشر من مركز الهدف */
function scoreOf(target, dial) {
  const d = Math.abs(target - dial);
  for (const z of ZONES) if (d <= z.half) return z.pts;
  return 0;
}

class WaveMatch {
  /**
   * @param players [{id, name, team: 0|1}] بترتيب الجلوس
   * @param opts.deal (used:Set) => {left, right}  ·  opts.key (card) => مفتاحُها
   * @param opts.rng مولّدٌ عشوائيّ  ·  opts.win هدفُ النقاط (١٠)
   */
  constructor(players, opts = {}) {
    this.rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    this.deal = typeof opts.deal === "function" ? opts.deal : () => ({ left: "بارد", right: "حار" });
    this.cardKey = typeof opts.key === "function" ? opts.key : c => c.left + "|" + c.right;
    this.win = opts.win || WIN;
    this.players = players.map(p => ({ id: p.id, name: p.name, team: p.team === 1 ? 1 : 0, on: true }));
    for (let t = 0; t < 2; t++) if (this.members(t).length < 2) throw new Error("كلُّ فريقٍ يحتاج لاعبَين على الأقلّ");
    this.teams = [0, 1].map(t => ({ players: this.members(t).map(p => p.id), score: 0, at: -1 }));
    this.used = new Set();
    this.round = 0;
    this.turnTeam = this.rng() < 0.5 ? 0 : 1;
    this.phase = "clue";
    this.cur = null;
    this.history = [];
    this.ready = new Set();
    this.winner = undefined;
    this.events = [];
    this.startRound(true);
  }

  /* ══════════ أدوات ══════════ */
  ev(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  member(id) { return this.players.find(p => p.id === id) || null; }
  members(t) { return this.players.filter(p => p.team === t); }
  teamOf(id) { const p = this.member(id); return p ? p.team : -1; }
  onlineIn(t) { return this.members(t).filter(p => p.on).length; }
  setOnline(id, on) {
    const p = this.member(id);
    if (!p) return;
    p.on = !!on;
    /* غيابُ من لم يوافق أو لم يصوّت قد يُكمل ما ينتظره الحاضرون */
    if (this.phase === "dial") this.tryLock();
    else if (this.phase === "guess") this.tryResolve();
    else if (this.phase === "reveal") this.maybeNext();
  }
  isPsychic(id) { return !!this.cur && this.cur.psychic === id; }
  /** المحلّلون: فريقُ الدور بلا الوسيط */
  analysts() { return this.members(this.cur.team).filter(p => p.id !== this.cur.psychic).map(p => p.id); }
  opponents() { return this.members(1 - this.cur.team).map(p => p.id); }

  /* ══════════ الجولة ══════════ */
  /** الوسيطُ التالي من فريق الدور — ويُتخطّى الغائبُ إن وُجد حاضر */
  nextPsychic(t) {
    const T = this.teams[t], ids = T.players;
    for (let k = 1; k <= ids.length; k++) {
      const i = (T.at + k) % ids.length;
      if (this.member(ids[i]).on) { T.at = i; return ids[i]; }
    }
    T.at = (T.at + 1) % ids.length;
    return ids[T.at];
  }
  newCard() {
    const c = this.deal(this.used);
    this.used.add(this.cardKey(c));
    return { left: c.left, right: c.right };
  }
  startRound(first) {
    this.round++;
    if (!first) this.turnTeam = 1 - this.turnTeam;
    this.phase = "clue";
    this.ready = new Set();
    const t = this.turnTeam;
    this.cur = {
      team: t, psychic: this.nextPsychic(t), card: this.newCard(),
      target: round1(MIN_T + this.rng() * (MAX_T - MIN_T)), clue: null, rerolls: 0,
      dial: 90, ok: new Set(), locked: null, votes: [], guess: null, result: null
    };
    this.ev({ t: "round", round: this.round, team: t, psychic: this.cur.psychic });
  }

  /** الوسيطُ غاب قبل أن يكتب: يتسلّم زميلٌ حاضر (بهدفٍ جديد — رآه الأوّل) */
  reassignPsychic() {
    if (this.phase !== "clue") return false;
    const old = this.cur.psychic;
    if (this.member(old).on) return false;
    const T = this.teams[this.cur.team], before = T.at;
    const id = this.nextPsychic(this.cur.team);
    if (id === old || !this.member(id).on) { T.at = before; return false; }
    this.cur.psychic = id;
    this.cur.target = round1(MIN_T + this.rng() * (MAX_T - MIN_T));
    this.ev({ t: "psychic", id, was: old });
    return true;
  }

  /* ١) التلميح */
  reroll(id) {
    if (this.phase !== "clue" || !this.isPsychic(id)) throw new Error("الوسيطُ وحده يبدّل البطاقة");
    if (this.cur.rerolls >= REROLLS) throw new Error("بدّلت البطاقةَ مرّتين — لا ثالثة");
    this.cur.rerolls++;
    this.cur.card = this.newCard();
    this.ev({ t: "reroll", n: this.cur.rerolls });
  }
  submitClue(id, text) {
    if (this.phase !== "clue") throw new Error("ليس وقتَ التلميح");
    if (!this.isPsychic(id)) throw new Error("الوسيطُ وحده يكتب التلميح");
    const c = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_CLUE);
    if (!c) throw new Error("اكتب تلميحًا");
    this.cur.clue = c;
    this.phase = "dial";
    this.cur.dial = 90;
    this.ev({ t: "clue", clue: c });
  }

  /* ٢) المؤشر: يحرّكه المحلّلون، ويُثبَّت بموافقة الحاضرين منهم جميعًا */
  canDial(id) { return this.phase === "dial" && this.analysts().includes(id); }
  setDial(id, angle) {
    if (!this.canDial(id)) throw new Error("المحلّلون وحدهم يحرّكون المؤشر");
    const a = round1(clamp(Number(angle), 0, 180));
    if (!Number.isFinite(a)) throw new Error("زاويةٌ غير صالحة");
    if (a === this.cur.dial) return false;
    this.cur.dial = a;
    if (this.cur.ok.size) { this.cur.ok.clear(); this.ev({ t: "unagree" }); }   /* حُرّك ⇒ وافقوا على غيره */
    return true;
  }
  agree(id, on = true) {
    if (!this.canDial(id)) throw new Error("المحلّلون وحدهم يثبّتون المؤشر");
    if (on) this.cur.ok.add(id); else this.cur.ok.delete(id);
    this.ev({ t: "agree", id, on: !!on });
    this.tryLock();
  }
  tryLock() {
    if (this.phase !== "dial") return;
    const on = this.analysts().filter(id => this.member(id).on);
    if (on.length && on.every(id => this.cur.ok.has(id))) this.lockDial();
  }
  lockDial(auto) {
    this.cur.locked = this.cur.dial;
    this.phase = "guess";
    this.ev({ t: "locked", angle: this.cur.locked, auto: !!auto });
    /* لا خصمَ حاضرًا: لا تخمين — الكشفُ فورًا */
    if (!this.onlineIn(1 - this.cur.team)) this.resolve();
  }

  /* ٣) الخصم: يسارَ المؤشر أم يمينَه — بالأغلبيّة */
  vote(id, side) {
    if (this.phase !== "guess") throw new Error("ليس وقتَ التخمين");
    if (!this.opponents().includes(id)) throw new Error("الفريقُ الخصم وحده يخمّن الاتّجاه");
    if (side !== "left" && side !== "right") throw new Error("يسار أو يمين");
    this.cur.votes = this.cur.votes.filter(v => v.id !== id).concat([{ id, side }]);
    this.ev({ t: "vote", id, side });
    this.tryResolve();
  }
  tryResolve() {
    if (this.phase !== "guess") return;
    const on = this.opponents().filter(id => this.member(id).on);
    if (!on.length || on.every(id => this.cur.votes.some(v => v.id === id))) this.resolve();
  }
  /** الأغلبيّة — والتعادلُ لأوّل من صوّت */
  majority() {
    const v = this.cur.votes;
    if (!v.length) return null;
    const L = v.filter(x => x.side === "left").length, R = v.length - L;
    return L > R ? "left" : R > L ? "right" : v[0].side;
  }

  /* ٤) الكشف والنقاط */
  resolve() {
    const C = this.cur;
    C.guess = this.majority();
    const pts = scoreOf(C.target, C.locked);
    const truth = C.target < C.locked ? "left" : C.target > C.locked ? "right" : null;
    const opp = pts < 4 && C.guess && truth && C.guess === truth ? 1 : 0;
    this.teams[C.team].score += pts;
    this.teams[1 - C.team].score += opp;
    C.result = { pts, opp, truth, diff: round1(Math.abs(C.target - C.locked)) };
    this.phase = "reveal";
    this.ready = new Set();
    this.history.push({ round: this.round, team: C.team, psychic: C.psychic, card: { ...C.card }, clue: C.clue,
                        target: C.target, dial: C.locked, guess: C.guess, ...C.result });
    this.ev({ t: "reveal", ...C.result, target: C.target, dial: C.locked, guess: C.guess });
    this.checkEnd();
  }
  checkEnd() {
    const [a, b] = this.teams.map(T => T.score);
    if (a < this.win && b < this.win) return;
    if (a === b) return;                  /* بلغاها متعادلَين: يُكمل اللعبُ حتى يتقدّم أحدهما */
    this.winner = a > b ? 0 : 1;
    this.phase = "over";
    this.ev({ t: "over", winner: this.winner });
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

  /** انقضاءُ المهلة */
  timeout() {
    if (this.phase === "clue") {
      /* الوسيطُ لم يكتب: تضيع جولةُ فريقه (بلا نقاط) */
      this.ev({ t: "timeout", phase: "clue" });
      this.cur.result = { pts: 0, opp: 0, truth: null, skipped: true };
      this.history.push({ round: this.round, team: this.cur.team, psychic: this.cur.psychic, card: { ...this.cur.card },
                          clue: null, skipped: true, pts: 0, opp: 0 });
      this.phase = "reveal";
      this.ready = new Set();
    } else if (this.phase === "dial") { this.ev({ t: "timeout", phase: "dial" }); this.lockDial(true); }
    else if (this.phase === "guess") { this.ev({ t: "timeout", phase: "guess" }); this.resolve(); }
    else if (this.phase === "reveal") this.startRound();
  }

  /* ══════════ العرض: لكلّ لاعبٍ ما يحقّ له ══════════ */
  view(id) {
    const C = this.cur, my = this.teamOf(id);
    const shown = this.phase === "reveal" || this.phase === "over";
    const psy = C && C.psychic === id;
    return {
      me: id, myTeam: my, round: this.round, phase: this.phase, win: this.win,
      scores: this.teams.map(T => T.score),
      players: this.players.map(p => ({
        id: p.id, name: p.name, team: p.team, on: p.on,
        role: !C ? "" : p.id === C.psychic ? "psychic" : p.team === C.team ? "analyst" : "opponent",
        ok: !!C && C.ok.has(p.id), ready: this.ready.has(p.id)
      })),
      cur: C ? {
        team: C.team, psychic: C.psychic, card: { ...C.card }, clue: C.clue, rerolls: C.rerolls, rerollsLeft: REROLLS - C.rerolls,
        /* الهدفُ للوسيط وحده قبل أن يكتب — ثمّ تُغلق الستارةُ عليه أيضًا — وللجميع عند الكشف */
        target: (shown || (psy && this.phase === "clue")) ? C.target : null,
        dial: C.locked != null ? C.locked : C.dial, locked: C.locked,
        ok: [...C.ok], votes: C.votes.map(v => ({ ...v })), guess: C.guess, result: C.result ? { ...C.result } : null
      } : null,
      winner: this.phase === "over" ? this.winner : undefined,
      history: this.phase === "over" ? this.history.map(h => ({ ...h })) : null
    };
  }
}

module.exports = { WaveMatch, scoreOf, ZONES, MIN_T, MAX_T, WIN, REROLLS };
