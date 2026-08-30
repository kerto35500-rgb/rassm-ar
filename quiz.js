// 🏆 «قمّة الهرم» — لعبة مسابقات جماعية
// منطق مستقل تماماً على namespace "/quiz" — لا يتداخل مع الرسم أو القنبلة.
const crypto = require("crypto");
const qbank = require("./qbank");
const { nameFromSocket } = require("./account");
const mod = require("./moderation");

// ====== ثوابت ======
// وضع الاختبار السريع (يُفعّل بمتغير بيئة فقط — لا يؤثر على اللعب الحقيقي)
const FAST = process.env.QUIZ_TEST_FAST === "1";

const BASE_POINTS = 100;      // نقاط الإجابة الصحيحة
const SPEED_POINTS = 100;     // أقصى مكافأة سرعة
const CHALLENGE_POINTS = 25;  // نقاط كل عنصر صحيح في جولات التحدي
const REVEAL_MS = FAST ? 300 : 4500;        // مدة عرض النتيجة
const PY_INTRO_MS = FAST ? 300 : 4000;      // مقدمة الهرم
const PY_REVEAL_MS = FAST ? 300 : 3200;     // كشف حركة الهرم
const EFFECT_MS = FAST ? 400 : 4000;        // أقصى مدة لتأثير القوة
const RECONNECT_MS = 180000;   // ٣ دقائق: تبديل التطبيقات في الجوال لا يطرد اللاعب
// تُضبط لتصل المرحلة التالية للاعب لحظة وميض العبور تماماً (لا فراغ بعد الزوم)
const SPIN_MS = FAST ? 300 : 2850;      // روليت كسر التعادل + حركة المصراعين
const ZOOM_MS = FAST ? 300 : 1350;      // حركة المصراعين فقط (بلا تعادل)
const AR_MS = FAST ? 300 : 2600;        // شاشة الفضح «فلان ألقى عليك…»
const READY_MS = FAST ? 300 : 2000;     // «جاهزون للسؤال؟»
const BET_POINTS = 100;                 // مكسب الرهان الصائب
const PY_MAX_Q = 24;          // سقف أسئلة الهرم

// الحدود الدنيا للمؤقتات (تُخفَّض في وضع الاختبار فقط)
const MIN_Q = FAST ? 1 : 8, MIN_V = FAST ? 1 : 4, MIN_A = FAST ? 1 : 3, MIN_P = FAST ? 1 : 4;

// (أُلغيت قدرة «الخلط» من اللعبة)
const POWERS = ["freeze", "gloop", "bombs", "nibble", "double", "bet"];
// القوى التخريبية فقط — تُستعمل لفخاخ درجات الهرم العشوائية
const SABOTAGE = ["freeze", "gloop", "bombs", "nibble"];
const POWER_AR = {
  freeze: "تجميد ❄️", gloop: "وحل 🟢", bombs: "قنابل 💣",
  nibble: "أكلة الحروف 👾", shuffle: "خلط 🔀", double: "مضاعفة النقاط ✨",
  bet: "رهان 🎲"
};
// قوى تُستعمل على النفس لا على الخصم
const SELF_POWERS = new Set(["double"]);

const COLORS = ["#e5541e", "#1e88e5", "#2e9e5b", "#7c4dff", "#ffb300", "#e91e63", "#00acc1", "#8d6e63"];

const DEFAULTS = {
  questionTime: 15,     // ثواني السؤال (10/15/20)
  voteTime: 8,          // ثواني التصويت على الفئة
  attackTime: 60,       // ثواني اختيار بطاقة الفخ (دقيقة كاملة افتراضياً)
  length: "normal",     // short(6 أسئلة) | normal(9) | long(12)
  challenges: true,     // تفعيل جولتي الربط والتصنيف
  powers: true,         // تفعيل القوى الهجومية
  powerUses: 4,         // عدد استخدامات القوة لكل لاعب
  powerChoices: 3,      // كم بطاقة مكشوفة تُعرض لكل لاعب في كل جولة
  allowedPowers: POWERS.slice(),
  pyramid: true,        // تفعيل النهائي
  pyramidHeight: 12,
  pyramidTime: 7,       // ثواني سؤال الهرم
  pyramidPenalty: false,// الإجابة الخاطئة تُنزل درجة (مطفأ = لا تحرّك)
  headStart: true,      // بداية متدرجة حسب النقاط
  cats: [],             // الفئات المفعّلة (فارغ = الكل)
  difficulty: 0,        // 0 تلقائي متدرج · 1 سهل · 2 متوسط · 3 صعب
  maxPlayers: 8,
  visibility: "private",
  password: ""
};

function clampInt(v, lo, hi, d) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

function sanitize(s = {}, old = DEFAULTS) {
  const o = { ...old };
  if (s.questionTime !== undefined) o.questionTime = clampInt(s.questionTime, MIN_Q, 30, old.questionTime);
  if (s.voteTime !== undefined) o.voteTime = clampInt(s.voteTime, MIN_V, 15, old.voteTime);
  if (s.attackTime !== undefined) o.attackTime = clampInt(s.attackTime, MIN_A, 60, old.attackTime);
  if (s.length !== undefined) o.length = ["short", "normal", "long"].includes(s.length) ? s.length : old.length;
  if (s.challenges !== undefined) o.challenges = !!s.challenges;
  if (s.powers !== undefined) o.powers = !!s.powers;
  if (s.powerUses !== undefined) o.powerUses = clampInt(s.powerUses, 0, 12, old.powerUses);
  if (s.powerChoices !== undefined) o.powerChoices = clampInt(s.powerChoices, 1, 6, old.powerChoices);
  if (Array.isArray(s.allowedPowers)) {
    const list = s.allowedPowers.filter(p => POWERS.includes(p));
    o.allowedPowers = list.length ? list : POWERS.slice();
  }
  if (s.pyramid !== undefined) o.pyramid = !!s.pyramid;
  if (s.pyramidHeight !== undefined) o.pyramidHeight = clampInt(s.pyramidHeight, 6, 20, old.pyramidHeight);
  if (s.pyramidTime !== undefined) o.pyramidTime = clampInt(s.pyramidTime, MIN_P, 15, old.pyramidTime);
  if (s.pyramidPenalty !== undefined) o.pyramidPenalty = !!s.pyramidPenalty;
  if (s.headStart !== undefined) o.headStart = !!s.headStart;
  if (Array.isArray(s.cats)) o.cats = s.cats.filter(c => qbank.categories().includes(c));
  if (s.difficulty !== undefined) o.difficulty = clampInt(s.difficulty, 0, 3, old.difficulty);
  if (s.maxPlayers !== undefined) o.maxPlayers = clampInt(s.maxPlayers, 2, 8, old.maxPlayers);
  if (s.visibility !== undefined) o.visibility = s.visibility === "public" ? "public" : "private";
  if (s.password !== undefined) o.password = String(s.password || "").slice(0, 24);
  return o;
}

const LENGTHS = { short: 6, normal: 9, long: 12 };

function setupQuiz(io, deps) {
  const { store, hashPass, publicStats, getAdmin } = deps;
  const nsp = io.of("/quiz");
  const rooms = new Map();

  // ====== أدوات ======
  function makeRoomId() {
    let id;
    do { id = String(Math.floor(10000 + Math.random() * 90000)); } while (rooms.has(id));
    return id;
  }

  function liveStats() {
    let online = 0; const list = [];
    rooms.forEach(r => {
      const c = r.players.filter(p => p.connected).length;
      online += c;
      if (c) list.push({ id: r.id, state: r.state, players: c });
    });
    return { online, rooms: list };
  }

  function publicRooms() {
    const out = [];
    rooms.forEach(r => {
      if (r.settings.visibility !== "public") return;
      const c = r.players.filter(p => p.connected).length;
      if (!c) return;
      out.push({
        id: r.id, players: c, max: r.settings.maxPlayers,
        state: r.state, locked: !!r.settings.password,
        owner: r.players.find(p => p.id === r.ownerId)?.name || "—"
      });
    });
    return out.sort((a, b) => b.players - a.players).slice(0, 30);
  }

  function alive(room) { return room.players.filter(p => !p.spectator); }

  function ranked(room) {
    return alive(room).slice().sort((a, b) => b.score - a.score);
  }

  function playerView(p) {
    return {
      id: p.id, name: p.name, score: p.score, color: p.color,
      connected: p.connected, spectator: p.spectator,
      powersLeft: p.powersLeft, answered: p.answered,
      lastGain: p.lastGain, pyPos: p.pyPos, doubleNext: !!p.doubleNext, registered: !!p.userName
    };
  }

  function state(room) {
    return {
      id: room.id, state: room.state, phase: room.phase,
      ownerId: room.ownerId, settings: room.settings,
      players: room.players.map(playerView),
      stage: room.stageIdx + 1, totalStages: room.stages.length,
      stageKind: room.stages[room.stageIdx] || null,
      phaseEndsAt: room.phaseEndsAt, serverNow: Date.now(),
      phaseDur: room.phaseDur,
      catOptions: room.catOptions,
      votes: room.voteCount,
      question: room.pubQuestion,
      link: room.pubLink,
      sort: room.pubSort,
      pyramidHeight: room.settings.pyramidHeight,
      pyramidQ: room.pyQIndex,
      powerMenu: room.powerMenu || [],
      winner: room.winner,
      bankSize: qbank.countAll()
    };
  }

  function broadcast(room) { nsp.to(room.id).emit("state", state(room)); }
  function sys(room, text, cls = "system") { nsp.to(room.id).emit("chat", { system: true, cls, text }); }

  function clearTimers(room) {
    clearTimeout(room.phaseTimer); room.phaseTimer = null;
  }

  function setPhase(room, phase, seconds, next) {
    clearTimers(room);
    room.phase = phase;
    room.phaseDur = seconds;
    room.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : 0;
    if (seconds && next) room.phaseTimer = setTimeout(() => { try { next(); } catch (e) { console.error("quiz phase:", e); } }, seconds * 1000 + 250);
  }

  // ====== بناء جدول المباراة ======
  function buildStages(s) {
    const n = LENGTHS[s.length] || 9;
    const st = [];
    for (let i = 0; i < n; i++) st.push("q");
    if (s.challenges) { st.push("link"); st.push("sort"); }
    if (s.pyramid) st.push("pyramid");
    return st;
  }

  // ====== بدء المباراة ======
  function startGame(room) {
    if (room.state === "playing") return;
    if (alive(room).length < 2) { sys(room, "نحتاج لاعبَين على الأقل", "warn"); return; }
    const a = getAdmin && getAdmin();
    if (a && a.trackGame) a.trackGame();

    room.players.forEach((p, i) => {
      p.score = 0; p.spectator = false; p.answered = false;
      p.lastGain = 0; p.powersLeft = room.settings.powers ? room.settings.powerUses : 0;
      p.pyPos = 0; p.effects = []; p.lastTarget = null; p.doubleNext = false;
      p.lastPower = null; p.menu = null;
      p.color = COLORS[i % COLORS.length];
    });
    room.state = "playing";
    room.stages = buildStages(room.settings);
    room.stageIdx = -1;
    room.usedQ = new Set();
    room.usedLink = new Set();
    room.usedSort = new Set();
    room.lastCats = [];
    room.bets = [];
    room.winner = null;
    room.pyQIndex = 0;
    sys(room, "بدأت المباراة! 🏆", "good");
    nextStage(room);
  }

  function nextStage(room) {
    room.stageIdx++;
    if (room.stageIdx >= room.stages.length) return finish(room);
    const kind = room.stages[room.stageIdx];
    if (kind === "q") beginVote(room);
    else if (kind === "link") beginLink(room);
    else if (kind === "sort") beginSort(room);
    else if (kind === "pyramid") beginPyramid(room);
    else finish(room);
  }

  // ====== مرحلة التصويت على الفئة ======
  function beginVote(room) {
    room.pubQuestion = null; room.pubLink = null; room.pubSort = null;
    room.votes = {}; room.voteCount = {};
    const allowed = room.settings.cats.length ? room.settings.cats : qbank.categories();
    const pool = allowed.filter(c => qbank.poolOf(c).length > 0);
    const exclude = pool.length > 5 ? room.lastCats.slice(-2) : [];
    const avail = pool.filter(c => !exclude.includes(c));
    room.catOptions = qbank.shuffle(avail.length >= 4 ? avail : pool).slice(0, 4);
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; });
    setPhase(room, "vote", room.settings.voteTime, () => resolveVote(room));
    broadcast(room);
  }

  function resolveVote(room) {
    const tally = {};
    room.catOptions.forEach(c => tally[c] = 0);
    Object.values(room.votes).forEach(c => { if (tally[c] !== undefined) tally[c]++; });
    const max = Math.max(...room.catOptions.map(c => tally[c]));
    const tied = room.catOptions.filter(c => tally[c] === max);
    // الفائز يُختار عشوائياً (RNG) من المتعادلين — والروليت البصري في الواجهة يتوقف عليه
    const best = tied[Math.floor(Math.random() * tied.length)];
    room.chosenCat = best;
    room.lastCats.push(best);
    nsp.to(room.id).emit("voteResult", { cat: best, tally, tie: tied.length > 1 ? tied : null });
    // مرحلة عرض النتيجة: روليت (عند التعادل) ثم زوم الدخول عبر الباب
    const ms = tied.length > 1 ? SPIN_MS : ZOOM_MS;
    const canAttack = room.settings.powers && room.stageIdx >= 3 &&
      alive(room).length >= 2 && alive(room).some(p => p.powersLeft > 0);
    setPhase(room, "spin", ms / 1000, () => { canAttack ? beginAttack(room) : beginReady(room); });
    broadcast(room);
  }

  // ── قائمة بطاقات مكشوفة لكل لاعب، بأوزان احتمالية ──
  // قبل أول تحدٍّ: القوة المختارة في الجولة السابقة يقل احتمال تكرارها.
  // بعد أول تحدٍّ: يرتفع احتمال ظهور المضاعفة والرهان.
  function menuFor(room, p) {
    let pool = room.settings.allowedPowers.filter(x => POWERS.includes(x));
    if (alive(room).length < 3) pool = pool.filter(x => x !== "bet");  // الرهان يحتاج ٣ لاعبين
    const n = Math.max(1, Math.min(room.settings.powerChoices, pool.length));
    const chIdx = room.stages.findIndex(k => k === "link" || k === "sort");
    const afterCh = chIdx >= 0 && room.stageIdx > chIdx;
    const w = {};
    pool.forEach(x => w[x] = 1);
    if (!afterCh && p.lastPower && w[p.lastPower]) w[p.lastPower] = 0.3;
    if (afterCh) { if (w.double) w.double *= 2.2; if (w.bet) w.bet *= 2.2; }
    const items = pool.slice(), out = [];
    while (out.length < n && items.length) {
      let tot = items.reduce((s, x) => s + w[x], 0), r = Math.random() * tot, k = 0;
      while (k < items.length - 1 && (r -= w[items[k]]) > 0) k++;
      out.push(items.splice(k, 1)[0]);
    }
    return out;
  }

  // ====== مرحلة اختيار الهجوم ======
  // إذا اختار كل من يملك استخداماً ⇒ لا داعي لانتظار بقية الدقيقة.
  // ومن لم يختر حتى انتهاء الوقت يمرّ بلا فخ (سلوك المهلة الطبيعي).
  function maybeEndAttack(room) {
    if (room.phase !== "attack") return;
    const waiting = alive(room).filter(p => p.powersLeft > 0 && !p.pendingAttack);
    if (waiting.length) return;
    clearTimers(room);
    setTimeout(() => { if (room.phase === "attack") beginAttackReveal(room); }, FAST ? 50 : 900);
  }

  function beginAttack(room) {
    room.attacks = [];
    room.bets = room.bets || [];
    room.players.forEach(p => { p.pendingAttack = null; });
    room.powerMenu = [];   // لم تعد قائمة موحّدة — لكل لاعب قائمته الخاصة
    alive(room).forEach(p => {
      if (p.powersLeft > 0) {
        p.menu = menuFor(room, p);
        nsp.to(p.id).emit("powerMenu", { menu: p.menu });
      } else p.menu = null;
    });
    setPhase(room, "attack", room.settings.attackTime, () => beginAttackReveal(room));
    broadcast(room);
  }

  // ── شاشة الفضح: خطوة إجبارية قبل السؤال — يعرف كل لاعب من استهدفه وبأي مقلب ──
  function beginAttackReveal(room) {
    if (!(room.attacks || []).length) return beginReady(room);
    nsp.to(room.id).emit("attackReveal", {
      hits: room.attacks.map(a => ({ from: a.from, fromName: a.fromName, to: a.to, toName: a.toName, power: a.power }))
    });
    setPhase(room, "attackReveal", AR_MS / 1000, () => beginReady(room));
    broadcast(room);
  }

  // ── شاشة الاستعداد الوسيطة: «جاهزون للسؤال؟» — ثانيتان بالضبط ──
  function beginReady(room) {
    setPhase(room, "ready", READY_MS / 1000, () => beginRead(room));
    broadcast(room);
  }

  // ── مرحلة قراءة السؤال: النص وحده — الخيارات لا تُرسل إطلاقاً في هذه المرحلة ──
  function beginRead(room) {
    const q = qbank.draw(room.chosenCat, room.usedQ, autoDifficulty(room));
    if (!q) { sys(room, "لا توجد أسئلة في هذه الفئة", "warn"); return nextStage(room); }
    room.usedQ.add(q.id);
    room.currentQ = q;                 // فيه الإجابة الصحيحة — لا يُرسل أبداً
    room.pubQuestion = { text: q.text, options: null, cat: q.cat, diff: q.diff, reading: true };
    room.answers = {};
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    // مدة القراءة تتناسب مع طول السؤال (وتسمح لاحقاً بربط قراءة صوتية)
    const words = String(q.text).split(/\s+/).length;
    const secs = FAST ? 0.3 : Math.min(7, Math.max(3.5, 2 + words * 0.38));
    setPhase(room, "read", secs, () => beginQuestion(room));
    broadcast(room);
  }

  // ====== السؤال ======
  function autoDifficulty(room) {
    if (room.settings.difficulty) return room.settings.difficulty;
    const t = room.stages.filter(s => s === "q").length;
    const i = room.stageIdx;
    if (i < t * 0.4) return 1;
    if (i < t * 0.8) return 2;
    return 3;
  }

  function beginQuestion(room) {
    // مرحلة الإجابة: الخيارات وحدها تملأ الشاشة — السؤال قُرئ في المرحلة السابقة
    const q = room.currentQ;
    if (!q) return nextStage(room);
    room.pubQuestion = { text: q.text, options: q.options, cat: q.cat, diff: q.diff };

    // تطبيق الهجمات المعلّقة
    (room.attacks || []).forEach(at => {
      const target = room.players.find(p => p.id === at.to);
      if (!target || target.spectator) return;
      target.effects.push(at.power);
      nsp.to(at.to).emit("attacked", { power: at.power, from: at.fromName, ms: EFFECT_MS });
    });
    if ((room.attacks || []).length) {
      nsp.to(room.id).emit("attackLog", room.attacks.map(a => ({ from: a.fromName, to: a.toName, power: a.power })));
    }
    room.attacks = [];

    room.qSentAt = Date.now();
    setPhase(room, "question", room.settings.questionTime, () => reveal(room));
    broadcast(room);
  }

  function scoreFor(room, elapsedMs) {
    const limit = room.settings.questionTime * 1000;
    const frac = Math.max(0, Math.min(1, 1 - elapsedMs / limit));
    return BASE_POINTS + Math.round(SPEED_POINTS * frac);
  }

  function submitAnswer(room, p, idx) {
    if (room.phase !== "question" || p.spectator) return;
    if (p.answered) return;
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    p.answered = true;
    // تعويض زمن الشبكة: نخصم نصف زمن الذهاب والإياب
    const elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
    const correct = idx === room.currentQ.correct;
    let gain = correct ? scoreFor(room, elapsed) : 0;
    // مضاعفة النقاط: تُستهلك في هذا السؤال سواء أصاب أم أخطأ
    let doubled = false;
    if (p.doubleNext) {
      p.doubleNext = false;
      if (correct) { gain *= 2; doubled = true; }
    }
    room.answers[p.id] = { idx, correct, gain, elapsed, doubled };
    p.score += gain;
    p.lastGain = gain;
    nsp.to(p.id).emit("answerAck", { locked: true });
    broadcast(room);
    // إذا أجاب الجميع، ننهي مبكراً
    if (alive(room).every(x => x.answered)) {
      clearTimers(room);
      setTimeout(() => { if (room.phase === "question") reveal(room); }, 400);
    }
  }

  function reveal(room) {
    clearTimers(room);
    // ── حسم الرهانات: من راهن على أسرع مجيب صحيح يكسب ──
    if ((room.bets || []).length) {
      const fastCorrect = alive(room)
        .filter(p => room.answers[p.id] && room.answers[p.id].correct)
        .sort((a, b) => room.answers[a.id].elapsed - room.answers[b.id].elapsed)[0];
      const fastestId = fastCorrect ? fastCorrect.id : null;
      room.bets.forEach(b => {
        const by = room.players.find(p => p.id === b.by);
        if (!by || by.spectator) return;
        const won = !!fastestId && b.on === fastestId;
        if (won) { by.score += BET_POINTS; by.lastGain = (by.lastGain || 0) + BET_POINTS; }
        nsp.to(b.by).emit("betResult", { on: b.onName, won, points: won ? BET_POINTS : 0 });
      });
      room.bets = [];
    }
    const res = alive(room).map(p => {
      const a = room.answers[p.id];
      return {
        id: p.id, name: p.name, color: p.color,
        idx: a ? a.idx : -1, correct: a ? a.correct : false,
        gain: a ? a.gain : 0, ms: a ? Math.round(a.elapsed) : null, doubled: !!(a && a.doubled),
        score: p.score
      };
    }).sort((a, b) => (b.correct - a.correct) || ((a.ms ?? 1e9) - (b.ms ?? 1e9)));
    nsp.to(room.id).emit("reveal", {
      correct: room.currentQ.correct,
      correctText: room.currentQ.options[room.currentQ.correct],
      results: res
    });
    setPhase(room, "reveal", 0, null);
    room.phaseEndsAt = Date.now() + REVEAL_MS;
    room.phaseDur = REVEAL_MS / 1000;
    broadcast(room);
    room.phaseTimer = setTimeout(() => nextStage(room), REVEAL_MS);
  }

  // ====== جولة الربط ======
  function beginLink(room) {
    const L = qbank.drawLink(room.usedLink);
    room.usedLink.add(L.id);
    room.currentLink = L;
    room.pubLink = { title: L.title, left: L.left, right: L.right };
    room.pubQuestion = null; room.pubSort = null;
    room.answers = {};
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    room.qSentAt = Date.now();
    const t = Math.round(room.settings.questionTime * 1.6);
    setPhase(room, "link", t, () => revealChallenge(room, "link"));
    broadcast(room);
  }

  function submitLink(room, p, arr) {
    if (room.phase !== "link" || p.answered || p.spectator) return;
    if (!Array.isArray(arr) || arr.length !== 4) return;
    p.answered = true;
    const ans = room.currentLink.answer;
    let hits = 0;
    arr.forEach((v, i) => { if (Number(v) === ans[i]) hits++; });
    const elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
    let gain = hits * CHALLENGE_POINTS;
    if (hits === 4) gain += Math.round(SPEED_POINTS * Math.max(0, 1 - elapsed / (room.phaseDur * 1000)));
    room.answers[p.id] = { hits, gain, elapsed, picks: arr };
    p.score += gain; p.lastGain = gain;
    nsp.to(p.id).emit("answerAck", { locked: true, hits });
    broadcast(room);
    if (alive(room).every(x => x.answered)) {
      clearTimers(room);
      setTimeout(() => { if (room.phase === "link") revealChallenge(room, "link"); }, 400);
    }
  }

  // ====== جولة التصنيف ======
  function beginSort(room) {
    const S = qbank.drawSort(room.usedSort);
    room.usedSort.add(S.id);
    room.currentSort = S;
    room.pubSort = { a: S.a, b: S.b, items: S.items };
    room.pubQuestion = null; room.pubLink = null;
    room.answers = {};
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    room.qSentAt = Date.now();
    const t = Math.round(room.settings.questionTime * 1.6);
    setPhase(room, "sort", t, () => revealChallenge(room, "sort"));
    broadcast(room);
  }

  function submitSort(room, p, arr) {
    if (room.phase !== "sort" || p.answered || p.spectator) return;
    if (!Array.isArray(arr) || arr.length !== 8) return;
    p.answered = true;
    const ans = room.currentSort.answer;
    let hits = 0;
    arr.forEach((v, i) => { if (Number(v) === ans[i]) hits++; });
    const elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
    let gain = hits * CHALLENGE_POINTS;
    if (hits === 8) gain += Math.round(SPEED_POINTS * Math.max(0, 1 - elapsed / (room.phaseDur * 1000)));
    room.answers[p.id] = { hits, gain, elapsed, picks: arr };
    p.score += gain; p.lastGain = gain;
    nsp.to(p.id).emit("answerAck", { locked: true, hits });
    broadcast(room);
    if (alive(room).every(x => x.answered)) {
      clearTimers(room);
      setTimeout(() => { if (room.phase === "sort") revealChallenge(room, "sort"); }, 400);
    }
  }

  function revealChallenge(room, kind) {
    clearTimers(room);
    const src = kind === "link" ? room.currentLink : room.currentSort;
    const res = alive(room).map(p => {
      const a = room.answers[p.id];
      return {
        id: p.id, name: p.name, color: p.color,
        hits: a ? a.hits : 0, gain: a ? a.gain : 0, score: p.score,
        picks: a ? a.picks : null
      };
    }).sort((a, b) => b.hits - a.hits || b.gain - a.gain);
    nsp.to(room.id).emit("revealChallenge", { kind, answer: src.answer, results: res });
    setPhase(room, "reveal", 0, null);
    room.phaseEndsAt = Date.now() + REVEAL_MS + 1500;
    room.phaseDur = (REVEAL_MS + 1500) / 1000;
    broadcast(room);
    room.phaseTimer = setTimeout(() => nextStage(room), REVEAL_MS + 1500);
  }

  // ====== النهائي: الهرم ======
  function beginPyramid(room) {
    room.pubQuestion = null; room.pubLink = null; room.pubSort = null;
    const list = ranked(room);
    const H = room.settings.pyramidHeight;
    const maxStart = Math.max(0, Math.min(4, Math.floor(H * 0.35)));
    list.forEach((p, i) => {
      p.pyPos = room.settings.headStart
        ? Math.round(maxStart * (1 - i / Math.max(1, list.length - 1)))
        : 0;
    });
    room.pyQIndex = 0;
    room.state = "playing";
    sys(room, "🔺 النهائي: تسلّق الهرم! أول من يصل القمة يفوز", "good");
    setPhase(room, "pyramidIntro", 0, null);
    room.phaseEndsAt = Date.now() + PY_INTRO_MS;
    room.phaseDur = PY_INTRO_MS / 1000;
    broadcast(room);
    room.phaseTimer = setTimeout(() => pyramidQuestion(room), PY_INTRO_MS);
  }

  function pyramidQuestion(room) {
    if (room.pyQIndex >= PY_MAX_Q) return finish(room);
    room.pyQIndex++;
    const cats = room.settings.cats.length ? room.settings.cats : qbank.categories();
    const cat = cats[Math.floor(Math.random() * cats.length)];
    const q = qbank.draw(cat, room.usedQ, 0);
    if (!q) return finish(room);
    room.usedQ.add(q.id);
    room.currentQ = q;
    room.pubQuestion = { text: q.text, options: q.options, cat: q.cat, diff: q.diff };
    room.answers = {};
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });

    // فخاخ الدرجات: احتمال بسيط لإطلاق قوة عشوائية
    if (room.settings.powers) {
      alive(room).forEach(p => {
        if (p.pyPos > 0 && Math.random() < 0.16) {
          const sab = room.settings.allowedPowers.filter(x => SABOTAGE.includes(x));
          if (!sab.length) return;
          const pw = sab[Math.floor(Math.random() * sab.length)];
          p.effects.push(pw);
          nsp.to(p.id).emit("attacked", { power: pw, from: "فخّ الدرجة", ms: EFFECT_MS });
        }
      });
    }

    room.qSentAt = Date.now();
    setPhase(room, "pyramid", room.settings.pyramidTime, () => pyramidReveal(room));
    broadcast(room);
  }

  function submitPyramid(room, p, idx) {
    if (room.phase !== "pyramid" || p.answered || p.spectator) return;
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    p.answered = true;
    const elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
    const correct = idx === room.currentQ.correct;
    room.answers[p.id] = { idx, correct, elapsed };
    nsp.to(p.id).emit("answerAck", { locked: true });
    broadcast(room);
    if (alive(room).every(x => x.answered)) {
      clearTimers(room);
      setTimeout(() => { if (room.phase === "pyramid") pyramidReveal(room); }, 400);
    }
  }

  function pyramidReveal(room) {
    clearTimers(room);
    const H = room.settings.pyramidHeight;
    const corrects = alive(room)
      .filter(p => room.answers[p.id] && room.answers[p.id].correct)
      .sort((a, b) => room.answers[a.id].elapsed - room.answers[b.id].elapsed);
    const fastest = corrects[0] ? corrects[0].id : null;

    const moves = [];
    alive(room).forEach(p => {
      const a = room.answers[p.id];
      let d = 0;
      if (a && a.correct) d = (p.id === fastest) ? 2 : 1;
      else if (room.settings.pyramidPenalty) d = -1;
      const before = p.pyPos;
      p.pyPos = Math.max(0, Math.min(H, p.pyPos + d));
      moves.push({ id: p.id, name: p.name, color: p.color, from: before, to: p.pyPos, d, correct: !!(a && a.correct) });
    });

    nsp.to(room.id).emit("pyramidReveal", {
      correct: room.currentQ.correct,
      correctText: room.currentQ.options[room.currentQ.correct],
      fastest, moves
    });

    const reached = alive(room).filter(p => p.pyPos >= H);
    setPhase(room, "reveal", 0, null);
    room.phaseEndsAt = Date.now() + PY_REVEAL_MS;
    room.phaseDur = PY_REVEAL_MS / 1000;
    broadcast(room);

    if (reached.length) {
      // إن وصل أكثر من واحد، الأسرع في هذا السؤال يفوز
      let win = reached[0];
      if (reached.length > 1) {
        const f = reached.find(p => p.id === fastest);
        win = f || reached.sort((a, b) => b.score - a.score)[0];
      }
      room.phaseTimer = setTimeout(() => finish(room, win), PY_REVEAL_MS);
    } else {
      room.phaseTimer = setTimeout(() => pyramidQuestion(room), PY_REVEAL_MS);
    }
  }

  // ====== النهاية ======
  function finish(room, forcedWinner) {
    clearTimers(room);
    room.state = "ended";
    room.phase = "finished";
    room.phaseEndsAt = 0;
    let win = forcedWinner;
    if (!win) {
      const usePy = room.settings.pyramid && room.stages.includes("pyramid") && room.pyQIndex > 0;
      const list = alive(room).slice().sort((a, b) =>
        usePy ? (b.pyPos - a.pyPos || b.score - a.score) : (b.score - a.score));
      win = list[0] || null;
    }
    room.winner = win ? { id: win.id, name: win.name, color: win.color, score: win.score } : null;
    room.finalTable = alive(room).slice()
      .sort((a, b) => (b.pyPos - a.pyPos) || (b.score - a.score))
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, color: p.color, score: p.score, pyPos: p.pyPos }));
    if (win) sys(room, `🏆 الفائز: ${win.name}`, "good");
    nsp.to(room.id).emit("finish", { winner: room.winner, table: room.finalTable });
    saveStats(room, win);
    broadcast(room);
  }

  async function saveStats(room, winner) {
    try {
      const prev = (await store.getKV("quizStats")) || {};
      let changed = false;
      for (const p of alive(room)) {
        if (!p.userName) continue;
        const s = prev[p.userName] || { games: 0, wins: 0, points: 0 };
        s.games++; s.points += p.score;
        if (winner && winner.id === p.id) s.wins++;
        prev[p.userName] = s;
        changed = true;
      }
      if (changed) await store.saveKV("quizStats", prev);
    } catch (e) { console.error("quiz stats:", e.message); }
  }

  // ====== الاتصال ======
  nsp.on("connection", (socket) => {
    let room = null, player = null;

    // الحساب المشترك من الصفحة الرئيسية (كوكي)
    socket.userName = nameFromSocket(socket) || null;

    socket.emit("hello", {
      cats: qbank.categories(),
      bankSize: qbank.countAll(),
      defaults: DEFAULTS,
      powers: POWERS,
      powerNames: POWER_AR
    });

    // قياس زمن الشبكة
    socket.on("pong2", (t) => {
      if (player && typeof t === "number") {
        const rtt = Date.now() - t;
        player.rtt = player.rtt ? Math.round(player.rtt * 0.6 + rtt * 0.4) : rtt;
      }
    });
    const pingTimer = setInterval(() => socket.emit("ping2", Date.now()), 5000);

    function makePlayer(name) {
      return {
        id: socket.id,
        token: crypto.randomBytes(8).toString("hex"),
        name: socket.userName || String(name || "").trim().slice(0, 20) || "لاعب",
        userName: socket.userName || null,
        score: 0, connected: true, spectator: false,
        powersLeft: 0, effects: [], answered: false, lastGain: 0,
        pyPos: 0, rtt: 0, disconnectedAt: 0, lastTarget: null, pendingAttack: null, doubleNext: false,
        color: COLORS[0]
      };
    }

    function leave(hard) {
      if (!room || !player) return;
      const r = room, p = player;
      if (hard) r.players = r.players.filter(x => x.id !== p.id);
      else { p.connected = false; p.disconnectedAt = Date.now(); }
      socket.leave(r.id);
      if (r.ownerId === p.id) {
        const nx = r.players.find(x => x.connected);
        if (nx) { r.ownerId = nx.id; sys(r, `👑 ${nx.name} صار مدير الغرفة`, "system"); }
      }
      if (!r.players.length) { clearTimers(r); rooms.delete(r.id); }
      else {
        if (r.state === "playing" && alive(r).length < 2) finish(r);
        else broadcast(r);
      }
      room = null; player = null;
    }

    // ---- الحسابات ----
    socket.on("register", async (data, cb) => {
      if (typeof cb !== "function") return;
      try {
        const name = String(data?.name || "").trim().slice(0, 20);
        const pass = String(data?.pass || "");
        if (name.length < 2) return cb({ ok: false, error: "الاسم قصير جدًا" });
        if (pass.length < 4) return cb({ ok: false, error: "كلمة المرور قصيرة (4 أحرف على الأقل)" });
        if (await store.getUser(name)) return cb({ ok: false, error: "الاسم مستخدم، جرب تسجيل الدخول" });
        const salt = crypto.randomBytes(16).toString("hex");
        await store.createUser(name, salt, hashPass(pass, salt));
        const a = getAdmin && getAdmin();
        if (a && a.trackNewUser) a.trackNewUser();
        socket.userName = name;
        cb({ ok: true, stats: { name, wins: 0, games: 0, totalScore: 0 }, quiz: { games: 0, wins: 0, points: 0 } });
      } catch (e) { cb({ ok: false, error: "خطأ في الخادم" }); }
    });

    socket.on("login", async (data, cb) => {
      if (typeof cb !== "function") return;
      try {
        const name = String(data?.name || "").trim().slice(0, 20);
        const pass = String(data?.pass || "");
        const u = await store.getUser(name);
        if (!u) return cb({ ok: false, error: "الحساب غير موجود" });
        if (hashPass(pass, u.salt) !== u.hash) return cb({ ok: false, error: "كلمة المرور خاطئة" });
        socket.userName = name;
        const qs = (await store.getKV("quizStats")) || {};
        cb({ ok: true, stats: publicStats(u), quiz: qs[name] || { games: 0, wins: 0, points: 0 } });
      } catch (e) { cb({ ok: false, error: "خطأ في الخادم" }); }
    });

    socket.on("leaderboard", async (cb) => {
      if (typeof cb !== "function") return;
      try {
        const qs = (await store.getKV("quizStats")) || {};
        cb({ ok: true, top: Object.entries(qs)
          .map(([name, s]) => ({ name, wins: s.wins || 0, games: s.games || 0, points: s.points || 0 }))
          .sort((a, b) => b.wins - a.wins || b.points - a.points).slice(0, 10) });
      } catch (e) { cb({ ok: true, top: [] }); }
    });

    socket.on("publicRooms", cb => { if (typeof cb === "function") cb({ ok: true, rooms: publicRooms() }); });

    // ---- الغرف ----
    socket.on("createRoom", ({ name, settings } = {}, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const id = makeRoomId();
      const r = {
        id, players: [], state: "lobby", phase: "lobby", ownerId: socket.id,
        settings: sanitize(settings || {}, DEFAULTS),
        stages: [], stageIdx: -1, phaseEndsAt: 0, phaseDur: 0, phaseTimer: null,
        catOptions: [], votes: {}, voteCount: {}, answers: {}, attacks: [],
        usedQ: new Set(), usedLink: new Set(), usedSort: new Set(), lastCats: [],
        currentQ: null, pubQuestion: null, pubLink: null, pubSort: null,
        pyQIndex: 0, winner: null, finalTable: null, qSentAt: 0
      };
      player = makePlayer(name);
      player.color = COLORS[0];
      r.players.push(player);
      rooms.set(id, r); room = r;
      socket.join(id);
      cb({ ok: true, roomId: id, you: player.id, token: player.token });
      broadcast(r);
    });

    socket.on("joinRoom", ({ name, roomId, password } = {}, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(String(roomId || "").trim());
      if (!r) return cb({ ok: false, error: "الغرفة غير موجودة" });
      if (r.settings.password && String(password || "") !== r.settings.password)
        return cb({ ok: false, error: "كلمة مرور الغرفة خاطئة", needPass: true });
      if (r.players.filter(p => p.connected).length >= r.settings.maxPlayers)
        return cb({ ok: false, error: "الغرفة ممتلئة" });
      if (mod.isBanned(r, { name })) return cb({ ok: false, error: "أنت محظور من هذه الغرفة" });
      if (room) leave(true);
      player = makePlayer(name);
      player.color = COLORS[r.players.length % COLORS.length];
      if (r.state === "playing") { player.spectator = true; }
      r.players.push(player);
      room = r; socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: player.id, token: player.token });
      sys(r, `${player.name} انضم${player.spectator ? " (متفرج)" : ""} 👋`);
      broadcast(r);
    });

    socket.on("rejoin", ({ roomId, token } = {}, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(String(roomId || "").trim());
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const p = r.players.find(x => x.token === token);
      if (!p) return cb({ ok: false, error: "انتهت جلستك" });
      const old = p.id;
      p.id = socket.id; p.connected = true; p.disconnectedAt = 0;
      if (r.ownerId === old) r.ownerId = socket.id;
      room = r; player = p; socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: p.id, token: p.token });
      // عاد أثناء مرحلة البطاقات؟ نعيد إرسال قائمته الشخصية
      if (r.phase === "attack" && p.menu && p.menu.length && p.powersLeft > 0 && !p.pendingAttack)
        socket.emit("powerMenu", { menu: p.menu });
      broadcast(r);
    });

    socket.on("leaveRoom", () => leave(true));

    socket.on("updateSettings", (s) => {
      if (!room || !player || room.ownerId !== player.id || room.state === "playing") return;
      room.settings = sanitize(s || {}, room.settings);
      broadcast(room);
    });

    socket.on("startGame", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      startGame(room);
    });

    socket.on("backToLobby", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      clearTimers(room);
      room.state = "lobby"; room.phase = "lobby";
      room.winner = null; room.finalTable = null;
      room.pubQuestion = null; room.pubLink = null; room.pubSort = null;
      room.stageIdx = -1; room.stages = []; room.pyQIndex = 0;
      room.players.forEach(p => { p.spectator = false; p.score = 0; p.pyPos = 0; p.effects = []; });
      broadcast(room);
    });

    /* نظام الإشراف المشترك: طرد / حظر / تصويت طرد / بلاغ */
    mod.attach(nsp, socket, {
      getRoom:   () => room,
      getPlayer: () => player,
      broadcast, sys
    });

    // ---- اللعب ----
    socket.on("vote", (cat) => {
      if (!room || !player || room.phase !== "vote") return;
      if (!room.catOptions.includes(cat)) return;
      room.votes[player.id] = cat;
      room.voteCount = {};
      room.catOptions.forEach(c => room.voteCount[c] = 0);
      Object.values(room.votes).forEach(c => { if (room.voteCount[c] !== undefined) room.voteCount[c]++; });
      broadcast(room);
      if (alive(room).every(p => room.votes[p.id])) {
        clearTimers(room);
        setTimeout(() => { if (room.phase === "vote") resolveVote(room); }, 350);
      }
    });

    socket.on("attack", ({ to, power } = {}) => {
      if (!room || !player || room.phase !== "attack") return;
      if (!room.settings.powers || player.powersLeft <= 0) return;
      if (!room.settings.allowedPowers.includes(power)) return;
      if (player.menu && player.menu.length && !player.menu.includes(power)) return;
      if (player.pendingAttack) return;

      // ── قوة تُستعمل على النفس (مضاعفة النقاط) ──
      if (SELF_POWERS.has(power)) {
        player.pendingAttack = { to: player.id, power };
        player.powersLeft--;
        player.lastPower = power;
        if (power === "double") player.doubleNext = true;
        nsp.to(player.id).emit("attackAck", { to: "نفسك", power, self: true });
        broadcast(room);
        maybeEndAttack(room);
        return;
      }

      const target = room.players.find(p => p.id === to);
      if (!target || target.id === player.id || target.spectator) return;

      // ── الرهان: لا يضر الهدف — تراهن أنه سيجيب صح أولاً ──
      if (power === "bet") {
        player.pendingAttack = { to, power };
        player.powersLeft--;
        player.lastPower = power;
        (room.bets = room.bets || []).push({ by: player.id, byName: player.name, on: to, onName: target.name });
        nsp.to(player.id).emit("attackAck", { to: target.name, power, bet: true });
        broadcast(room);
        maybeEndAttack(room);
        return;
      }
      // لا تضرب نفس الشخص مرتين متتاليتين — إلا إذا لم يكن هناك خصم آخر أصلاً
      // (في مباراة لاعبَين تعطّل هذه القاعدة القوى نهائياً بعد أول استخدام)
      const others = alive(room).filter(p => p.id !== player.id).length;
      if (others > 1 && player.lastTarget === to) return;
      player.pendingAttack = { to, power };
      player.lastTarget = to;
      player.lastPower = power;
      player.powersLeft--;
      room.attacks.push({ from: player.id, fromName: player.name, to, toName: target.name, power });
      nsp.to(player.id).emit("attackAck", { to: target.name, power });
      broadcast(room);
      maybeEndAttack(room);
    });

    socket.on("answer", (idx) => {
      if (!room || !player) return;
      if (room.phase === "question") submitAnswer(room, player, Number(idx));
      else if (room.phase === "pyramid") submitPyramid(room, player, Number(idx));
    });

    socket.on("linkAnswer", (arr) => { if (room && player) submitLink(room, player, arr); });
    socket.on("sortAnswer", (arr) => { if (room && player) submitSort(room, player, arr); });

    socket.on("chat", (text) => {
      if (!room || !player) return;
      const t = String(text || "").trim().slice(0, 200);
      if (!t) return;
      nsp.to(room.id).emit("chat", { name: player.name, color: player.color, text: t });
    });

    socket.on("disconnect", () => {
      clearInterval(pingTimer);
      if (!room || !player) return;
      const r = room, p = player;
      p.connected = false; p.disconnectedAt = Date.now();
      if (r.ownerId === p.id) {
        const nx = r.players.find(x => x.connected);
        if (nx) r.ownerId = nx.id;
      }
      broadcast(r);
      setTimeout(() => {
        if (p.connected) return;
        r.players = r.players.filter(x => x !== p);
        if (!r.players.length) { clearTimers(r); rooms.delete(r.id); return; }
        if (r.ownerId === p.id) r.ownerId = r.players[0].id;
        if (r.state === "playing" && alive(r).length < 2) finish(r);
        else broadcast(r);
      }, RECONNECT_MS);
      room = null; player = null;
    });
  });

  // تنظيف الغرف الميتة
  setInterval(() => {
    const now = Date.now();
    rooms.forEach((r, id) => {
      if (!r.players.some(p => p.connected) &&
          r.players.every(p => now - (p.disconnectedAt || now) > RECONNECT_MS)) {
        clearTimers(r); rooms.delete(id);
      }
    });
  }, 30000);

  return { liveStats, publicRooms, rooms };
}

module.exports = { setupQuiz, DEFAULTS, POWERS, POWER_AR };
