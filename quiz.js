// 🏆 «قمّة الهرم» — لعبة مسابقات جماعية
// منطق مستقل تماماً على namespace "/quiz" — لا يتداخل مع الرسم أو القنبلة.
const crypto = require("crypto");
const qbank = require("./qbank");
const { nameFromSocket } = require("./account");
const mod = require("./moderation");
const voc = require("./vo");

// ====== ثوابت ======
// وضع الاختبار السريع (يُفعّل بمتغير بيئة فقط — لا يؤثر على اللعب الحقيقي)
const FAST = process.env.QUIZ_TEST_FAST === "1";

const BASE_POINTS = 100;      // (إرث — لم يعد يُستعمل في الأسئلة)
const SPEED_POINTS = 100;     // (إرث)
// نقاط المراكز: النقاط = (عدد اللاعبين − المركز + 1) × 100
// خمسة لاعبين: الأول 500 والأخير 100. تتكيف تلقائيًا مع حجم الغرفة.
const RANK_UNIT = 100;
const TRAP_INTRO_S = 7.8;   // أطول نسختي فيلم الفخاخ (الجوال 7.64ث) مع هامش
function rankPoints(playersN, rank) { return Math.max(0, (playersN - rank + 1) * RANK_UNIT); }
const CHALLENGE_POINTS = 25;  // نقاط كل عنصر صحيح في جولات التحدي
const REVEAL_MS = FAST ? 300 : 7500;        // مدة الكشف: اصطفاف الأيقونات + الإنارة + النقاط + الجدول
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
const PARTY_MS = 1600;        // مراسم كل حفلة نقاط
const BET_MS   = 1900;        // كشف الرهان بعدها
// فيلم المقدمة: نسخة الجوال 48.79ث والكمبيوتر 46.76ث — نأخذ الأطول وهامشًا
const OPENING_MS = FAST ? 300 : 49300;

// الحدود الدنيا للمؤقتات (تُخفَّض في وضع الاختبار فقط)
const MIN_Q = FAST ? 1 : 8, MIN_V = FAST ? 1 : 4, MIN_A = FAST ? 1 : 3, MIN_P = FAST ? 1 : 4;

const RANDOM_DOOR = "عشوائي";   // باب لا فئة له: يكشف فئته الحقيقية بعد الدخول
// (أُلغيت قدرة «الخلط» من اللعبة)
const POWERS = ["freeze", "gloop", "bombs", "nibble", "double", "bet"];
// القوى التخريبية فقط — تُستعمل لفخاخ درجات الهرم العشوائية
const SABOTAGE = ["freeze", "gloop", "bombs", "nibble"];
const POWER_AR = {
  freeze: "تجميد ❄️", gloop: "وحل 🟢", bombs: "قنابل 💣",
  nibble: "أكلة الحروف 👾", shuffle: "خلط 🔀", double: "حفلة النقاط ✨",
  bet: "رهان 🎲"
};
// قوى تُستعمل على النفس لا على الخصم
const SELF_POWERS = new Set(["double"]);

const COLORS = ["#e5541e", "#1e88e5", "#2e9e5b", "#7c4dff", "#ffb300", "#e91e63", "#00acc1", "#8d6e63"];

// 🎭 الشخصيات السبع — الصور في public/chars/<id>.webp
// لا يجوز أن يختار لاعبان الشخصية نفسها، ومن لم يختر تُوزَّع له واحدة عند البدء.
const CHARS = [
  { id: "granny", name: "الحاجّة",     desc: "خبرة سنين وذاكرة ما تخون",  tint: "#1b2a52" },
  { id: "prof",   name: "البروفيسور",  desc: "عبقري مجنون… أغلب الوقت",   tint: "#0d4030" },
  { id: "beast",  name: "الوحش",       desc: "عضلات وثقة زايدة",          tint: "#5c1220" },
  { id: "pizza",  name: "أبو بيتزا",   desc: "جوعان دائمًا وسعيد دائمًا", tint: "#7a3a08" },
  { id: "nerd",   name: "المثقّف",     desc: "يقرأ كل شيء ويحفظه",        tint: "#0a3742" },
  { id: "trendy", name: "العصرية",     desc: "سريعة البديهة وحاضرة",      tint: "#2e1a5e" },
  { id: "boss",   name: "المديرة",     desc: "تخطط بهدوء وتفوز بثقة",     tint: "#3d1428" }
];
const CHAR_IDS = CHARS.map(c => c.id);

const DEFAULTS = {
  questionTime: 15,     // ثواني السؤال (10/15/20)
  voteTime: 8,          // ثواني التصويت على الفئة
  attackTime: 30,       // ثواني اختيار بطاقة الفخ
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
  images: true,         // السماح بأسئلة الصور
  intros: true,         // شاشة شرح قبل كل لعبة (مرة واحدة لكل غرفة)
  opening: true,        // فيلم المقدمة عند بداية المباراة
  voice: true,          // قراءة السؤال بصوت مسموع
  // لهجة المعلّق. المسجَّل حاليًا مصري فقط، فالخيار مقفل في الواجهة
  // إلى أن تُسجَّل مقاطع الفصحى؛ المنطق جاهز ولا يحتاج غير رفع الملفات.
  dialect: "eg",        // eg مصري · ar فصحى
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
  if (s.images !== undefined) o.images = !!s.images;
  if (s.intros !== undefined) o.intros = !!s.intros;
  if (s.opening !== undefined) o.opening = !!s.opening;
  if (s.voice !== undefined) o.voice = !!s.voice;
  // لا نقبل إلا لهجة متوفّرة فعلًا، حتى لا يصمت المعلّق لأن ملفاتها غير موجودة
  if (s.dialect !== undefined) o.dialect = DIALECTS_READY.includes(s.dialect) ? s.dialect : old.dialect;
  if (s.maxPlayers !== undefined) o.maxPlayers = clampInt(s.maxPlayers, 2, 8, old.maxPlayers);
  if (s.visibility !== undefined) o.visibility = s.visibility === "public" ? "public" : "private";
  if (s.password !== undefined) o.password = String(s.password || "").slice(0, 24);
  return o;
}

// اللهجات المسجَّلة فعلًا. أضف "ar" هنا فور رفع مقاطع الفصحى إلى public/vo/ar/
const DIALECTS = [
  { id: "eg", name: "مصرية" },
  { id: "ar", name: "عربية فصحى" }
];
const DIALECTS_READY = ["eg"];

const LENGTHS = { short: 6, normal: 9, long: 12 };

function setupQuiz(io, deps) {
  const { store, hashPass, publicStats, getAdmin } = deps;
  const getTts = deps.tts || (() => null);
  const VOICE_LEAD_IN = 1;  // مهلة بدء النطق: تحميل المقطع + انتقال المشهد
  const VOICE_TAIL = 1;     // صمت بعد آخر كلمة قبل عرض الخيارات
  // معرّف مقطع قراءة السؤال (null لو الصوت مطفأ أو المقطع غير مولَّد بعد)
  function voiceOf(room, text) {
    if (!room.settings.voice) return null;
    const t = getTts();
    try { return t && t.idFor ? t.idFor(text) : null; } catch (e) { return null; }
  }
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
      lastGain: p.lastGain, pyPos: p.pyPos, doubleNext: !!p.doubleNext, registered: !!p.userName,
      charId: p.charId, ready: !!p.ready
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
      // من صوّت لأي باب — لعرض أيقونات المصوّتين على البوابة
      voters: room.phase === "vote"
        ? Object.entries(room.votes || {}).map(([id, cat]) => {
            const p = room.players.find(x => x.id === id);
            return p ? { id, cat, name: p.name, color: p.color, charId: p.charId } : null;
          }).filter(Boolean)
        : [],
      question: room.pubQuestion,
      link: room.pubLink,
      sort: room.pubSort,
      intro: room.pubIntro,
      vo: room.pubVo,
      hurry: room.pubHurry,
      chars: CHARS,
      dialects: DIALECTS, dialectsReady: DIALECTS_READY,
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

  // مراحل الإجابة التي يُستعجَل فيها اللاعبون قبل انتهاء العدّاد بخمس ثوانٍ.
  // الميزانية 4.6ث = ما يتبقى فعليًا من العدّاد لحظة التشغيل، فلا يُقطع التعليق.
  const HURRY_AT = { question: 1, link: 1, sort: 1, pyramid: 1 };

  function setPhase(room, phase, seconds, next) {
    clearTimers(room);
    room.phase = phase;
    // الخادم يختار تعليق الاستعجال مرة واحدة للمرحلة، فيسمع اللاعبون كلهم التسجيل نفسه
    if (HURRY_AT[phase]) room.pubHurry = voc.pick("hurry", 4.6);
    room.phaseDur = seconds;
    room.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : 0;
    if (seconds && next) room.phaseTimer = setTimeout(() => { try { next(); } catch (e) { console.error("quiz phase:", e); } }, seconds * 1000 + 250);
  }

  // ====== بناء جدول المباراة ======
  // الهيكل النهائي للمسابقة: كتلة أسئلة → التصنيف → كتلة → التوصيل → كتلة → الهرم.
  // «طول المباراة» يضبط حجم الكتلة: قصيرة ٢، عادية ٣، طويلة ٤.
  function buildStages(s) {
    const blk = { short: 2, normal: 3, long: 4 }[s.length] || 3;
    const q = n => Array(n).fill("q");
    const st = s.challenges
      ? [...q(blk), "sort", ...q(blk), "link", ...q(blk)]
      : q(blk * 3);
    if (s.pyramid) st.push("pyramid");
    return st;
  }

  // ====== بدء المباراة ======
  function startGame(room) {
    if (room.state === "playing") return;
    if (alive(room).length < 2) { sys(room, "نحتاج لاعبَين على الأقل", "warn"); return; }
    const a = getAdmin && getAdmin();
    if (a && a.trackGame) a.trackGame();

    // من لم يختر شخصية يأخذ واحدة عشوائية من غير المحجوزة — فلا يبدأ أحد بلا وجه
    {
      const taken = new Set(room.players.map(p => p.charId).filter(Boolean));
      const free = qbank.shuffle(CHAR_IDS.filter(id => !taken.has(id)));
      room.players.forEach(p => {
        if (!p.charId && free.length) { p.charId = free.pop(); taken.add(p.charId); }
      });
      room.players.forEach(p => { p.ready = true; });
    }

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
    room.bets = []; room.partyCount = 0; room.partyN = 0;
    room.winner = null;
    room.pyQIndex = 0;
    sys(room, "بدأت المباراة! 🏆", "good");
    // فيلم المقدمة يُعرض مرة واحدة في أول المباراة، ثم تبدأ الجولات
    if (room.settings.opening && !room.openingDone) {
      room.openingDone = true; room.openingSkipped = false;
      room.introKind = "opening";
      setPhase(room, "opening", OPENING_MS / 1000, () => nextStage(room));
      broadcast(room);
      return;
    }
    nextStage(room);
  }

  // ====== شاشة الشرح ======
  // تُعرض مرة واحدة فقط لكل غرفة قبل كل نوع لعبة، ويقدر المضيف يتخطاها.
  const INTRO = {
    pyramid: { secs: 28, title: "هرم المعرفة", vo: "pyramid_intro",
      text: "الآن يبدأ النهائي! كل إجابة صحيحة ترفعك درجة على الهرم، وأول من يبلغ القمة يفوز باللقب. لا مجال للتردد — السرعة والدقة معًا." },
    sort: { secs: 17, title: "لعبة التصنيف", vo: "sort_intro",
      text: "سترى مجموعة عناصر وعليك وضع كل عنصر في تصنيفه الصحيح قبل انتهاء الوقت. كل عنصر في مكانه يعني نقاطًا إضافية." },
    link: { secs: 14, title: "لعبة التوصيل", vo: "link_intro",
      text: "أمامك عمودان، وعليك توصيل كل طرف بما يقابله. الوقت محدود، فركّز واربط بسرعة." }
  };

  function startStage(room) {
    const kind = room.stages[room.stageIdx];
    if (kind === "q") beginVote(room);
    else if (kind === "link") beginLink(room);
    else if (kind === "sort") beginSort(room);
    else if (kind === "pyramid") beginPyramid(room);
    else finish(room);
  }

  function nextStage(room) {
    room.stageIdx++;
    if (room.stageIdx >= room.stages.length) return finish(room);
    const kind = room.stages[room.stageIdx];
    const intro = INTRO[kind];
    if (intro && room.settings.intros && !room.introDone[kind]) {
      room.introDone[kind] = true;
      room.introKind = kind;
      room.pubIntro = { kind, title: intro.title, text: intro.text, vo: voc.pick(intro.vo) };
      setPhase(room, "intro", FAST ? 0.3 : intro.secs, () => { room.pubIntro = null; startStage(room); });
      broadcast(room);
      return;
    }
    startStage(room);
  }

  // المضيف يتخطى الشرح: نُعلم الجميع ليشغّلوا تعليق التخطي ثم ننتقل فورًا
  function skipIntro(room) {
    // تخطي فيلم المقدمة: ننتقل فورًا لأول جولة
    if (room.phase === "opening") {
      if (room.openingSkipped) return;   // نقرة مزدوجة لا تجدول انتقالين
      room.openingSkipped = true;
      clearTimeout(room.phaseTimer);
      const ov = voc.pick("skip");
      nsp.to(room.id).emit("introSkipped", { kind: "opening", vo: ov });
      // ننتظر خاتمة الفيلم والتعليق معًا (OP_TAIL في العميل = 7.8ث)، فتبدأ
      // الجولة لحظة الوميض الأبيض تمامًا على كل الأجهزة مهما اختلف طول نسختها.
      const tail = Math.max(7.8, ov ? ov.dur + 0.4 : 0);
      const w = FAST ? 100 : Math.round(tail * 1000 + 150);
      setTimeout(() => { if (room.state === "playing") nextStage(room); }, w);
      return;
    }
    if (room.phase !== "intro" || !room.pubIntro) return;
    const kind = room.introKind;
    const sv = voc.pick(kind === "pyramid" ? ["pyramid_skip", "skip"] : ["minigame_skip", "skip"]);
    nsp.to(room.id).emit("introSkipped", { kind, vo: sv });
    room.pubIntro = null;
    clearTimeout(room.phaseTimer);
    const wait = FAST ? 100 : Math.max(1200, sv ? sv.dur * 1000 + 400 : 0);
    setTimeout(() => { if (room.state === "playing") startStage(room); }, wait);
  }

  // ====== مرحلة التصويت على الفئة ======
  function beginVote(room) {
    room.pubQuestion = null; room.pubLink = null; room.pubSort = null;
    room.votes = {}; room.voteCount = {};
    const allowed = room.settings.cats.length ? room.settings.cats : qbank.categories();
    const pool = allowed.filter(c => qbank.poolOf(c).length > 0);
    const exclude = pool.length > 5 ? room.lastCats.slice(-2) : [];
    const avail = pool.filter(c => !exclude.includes(c));
    // ثلاثة أبواب حقيقية + «الباب العشوائي» الذي يكشف فئته بعد الدخول
    room.catOptions = qbank.shuffle(avail.length >= 3 ? avail : pool).slice(0, 3);
    room.catOptions.push(RANDOM_DOOR);
    room.catOptions = qbank.shuffle(room.catOptions);
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; });
    // تعليق المعلّق: نختاره هنا لنعرف مدّته فنمنح المرحلة وقتًا يكفيه
    const first = !room.voDone.door;
    room.voDone.door = true;
    room.pubVo = voc.pick(first ? "first_door" : "door");
    if (room.pubVo) room.pubVo.at = "vote";
    // أول تصويت في المباراة أطول: اللاعبون يستوعبون الشاشة لأول مرة
    const baseVt = first ? Math.max(30, room.settings.voteTime) : room.settings.voteTime;
    const vt = Math.max(baseVt, room.pubVo ? room.pubVo.dur + 1.2 : 0);
    setPhase(room, "vote", FAST ? room.settings.voteTime : vt, () => resolveVote(room));
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
    // الباب العشوائي: يفوز كباب، ثم تُسحب فئته الحقيقية سرّاً وتُكشف بعد الدخول
    let real = best;
    if (best === RANDOM_DOOR) {
      const allowed = room.settings.cats.length ? room.settings.cats : qbank.categories();
      const pool = allowed.filter(c => c !== RANDOM_DOOR && qbank.poolOf(c).length > 0);
      const fresh = pool.filter(c => !room.lastCats.slice(-2).includes(c));
      const src = fresh.length ? fresh : pool;
      real = src[Math.floor(Math.random() * src.length)];
    }
    room.chosenCat = real;
    room.lastCats.push(real);
    const tie = tied.length > 1;
    const sv = voc.pick(tie ? "tie_roulette" : "door_enter");
    nsp.to(room.id).emit("voteResult", { cat: best, tally, tie: tie ? tied : null, vo: sv });
    // مرحلة عرض النتيجة: روليت (عند التعادل) ثم زوم الدخول عبر الباب،
    // ولا ننتقل قبل أن يُكمل المعلّق جملته.
    // التعليق يُنطق كاملاً أولاً ثم تبدأ حركة القرعة/الدخول — لا تداخل بينهما،
    // فمدّة المرحلة = مدّة الصوت + مدّة الحركة + هامش.
    const base = tie ? SPIN_MS : ZOOM_MS;
    const ms = FAST ? base : (sv ? sv.dur * 1000 + 150 : 0) + base + 350;
    // الفخاخ تُفتح من السؤال الثالث — أي قبل أول تحدٍّ بسؤال واحد
    const canAttack = room.settings.powers && room.stageIdx >= 2 &&
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
    const firstP = !room.voDone.powers;
    room.voDone.powers = true;
    room.pubVo = voc.pick(firstP ? "first_powers" : "powers_intro");
    if (room.pubVo) room.pubVo.at = "attack";
    // شرح القدرات أول مرة طويل، فلا نقفل الاختيار قبل أن يُنهي المعلّق كلامه
    // فيلم التلفزيون يسبق ظهور البطاقات، فنزيده على الطور ليبقى للاعب وقت اختياره كاملًا
    const at = FAST ? room.settings.attackTime
      : Math.max(room.settings.attackTime, room.pubVo ? room.pubVo.dur + 1.5 : 0) + TRAP_INTRO_S;
    setPhase(room, "attack", at, () => beginAttackReveal(room));
    broadcast(room);
  }

  // ── شاشة الفضح: خطوة إجبارية قبل السؤال — يعرف كل لاعب من استهدفه وبأي مقلب ──
  function beginAttackReveal(room) {
    if (!(room.attacks || []).length) return beginReady(room);
    // نوع التعليق يتبع المقلب الذي أصاب اللاعب (يختلف بحسب حالته)، أما رقم
    // التسجيل داخل النوع فيختاره الخادم — فمن أصابه المقلب نفسه يسمع التسجيل نفسه.
    const tvo = {};
    ["trap_freeze", "trap_gloop", "trap_bombs", "trap_nibble",
     "trap_double", "trap_bet", "trap_multi"].forEach(k => {
      const p = voc.pick(k); if (p) tvo[k] = p.i;
    });
    nsp.to(room.id).emit("attackReveal", {
      hits: room.attacks.map(a => ({ from: a.from, fromName: a.fromName, to: a.to, toName: a.toName, power: a.power })),
      vo: tvo
    });
    // العميل يختار التعليق حسب المقلب الذي أصاب لاعبه، فنمنح المرحلة أطول احتمال
    const arMs = FAST ? AR_MS : Math.max(AR_MS, voc.maxOf("trap_freeze", "trap_gloop",
      "trap_bombs", "trap_nibble", "trap_double", "trap_bet", "trap_multi") * 1000 + 500);
    setPhase(room, "attackReveal", arMs / 1000, () => beginReady(room));
    broadcast(room);
  }

  // ── شاشة الاستعداد الوسيطة: «جاهزون للسؤال؟» — ثانيتان بالضبط ──
  function beginReady(room) {
    setPhase(room, "ready", READY_MS / 1000, () => beginRead(room));
    broadcast(room);
  }

  // ── مرحلة قراءة السؤال: النص وحده — الخيارات لا تُرسل إطلاقاً في هذه المرحلة ──
  function beginRead(room) {
    const q = qbank.draw(room.chosenCat, room.usedQ, 0, room.settings.images);
    if (!q) { sys(room, "لا توجد أسئلة في هذه الفئة", "warn"); return nextStage(room); }
    room.usedQ.add(q.id);
    room.currentQ = q;                 // فيه الإجابة الصحيحة — لا يُرسل أبداً
    const vid = voiceOf(room, q.text);
    // هل هذه جولة «حفلة نقاط»؟ تُستهلك هنا وتظهر لكل اللاعبين مع السؤال
    room.party = !!room.partyNext; room.partyNext = false;
    room.partyN = room.party ? (room.partyCount || 1) : 0;
    room.partyCount = 0;
    room.pubQuestion = { text: q.text, options: null, cat: q.cat, diff: q.diff, img: q.img || null, reading: true, voice: vid, party: room.party };
    room.answers = {};
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    // مدة القراءة: ثانية قبل بدء النطق (تحميل المقطع وانتقال المشهد) + مدّة الصوت
    // + ثانية صمت بعد آخر كلمة قبل الانتقال للخيارات. بلا حدّ أدنى ثابت، فالسؤال
    // القصير ينتقل بسرعة والطويل يأخذ حقّه. (وإن غاب الصوت: تقدير بالكلمات)
    const words = String(q.text).split(/\s+/).length;
    let secs = FAST ? 0.3 : Math.min(7, Math.max(3.5, 2 + words * 0.38));
    if (!FAST && vid) {
      const t = getTts();
      const d = t && t.durationOf ? t.durationOf(q.text) : 0;
      if (d) secs = Math.min(16, VOICE_LEAD_IN + d + VOICE_TAIL);
    }
    setPhase(room, "read", secs, () => beginQuestion(room));
    broadcast(room);
  }

  // ====== السؤال ======
  function beginQuestion(room) {
    // مرحلة الإجابة: الخيارات وحدها تملأ الشاشة — السؤال قُرئ في المرحلة السابقة
    const q = room.currentQ;
    if (!q) return nextStage(room);
    room.pubQuestion = { text: q.text, options: q.options, cat: q.cat, diff: q.diff, img: q.img || null, voice: voiceOf(room, q.text), party: room.party };

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
    // لا نقاط الآن: المركز يتحدد عند الكشف بترتيب المصيبين حسب السرعة
    room.answers[p.id] = { idx, correct, gain: 0, elapsed, doubled: false };
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
    // الرهان يبقى سرًّا في حالة الخادم طوال الجولة، ويُكشف علنًا هنا فقط —
    // في شريط النتائج، بعد احتساب نقاط الجولة الأساسية.
    // ── نقاط المراكز: المصيبون وحدهم يُرتَّبون بالسرعة، الأسرع ينال العلامة الكاملة ──
    const N = alive(room).length;
    const winners = alive(room)
      .filter(p => room.answers[p.id] && room.answers[p.id].correct)
      .sort((a, b) => room.answers[a.id].elapsed - room.answers[b.id].elapsed);
    winners.forEach((p, i) => {
      const a = room.answers[p.id];
      a.rank = i + 1;
      a.gain = rankPoints(N, a.rank);
      // النقاط الأساسية تُحفظ قبل المضاعفة — الرهان يأخذها وحدها
      a.base = a.gain;
      // كل حفلة تضيف مثلَ الأساس: حفلة = ×٢ · حفلتان = ×٣
      const parties = room.partyN || (p.doubleNext ? 1 : 0);
      if (parties > 0) { a.gain = a.base * (1 + parties); a.doubled = true; a.parties = parties; }
      p.doubleNext = false;
      p.score += a.gain; p.lastGain = a.gain;
    });
    alive(room).forEach(p => {
      const a = room.answers[p.id];
      if (!a || !a.correct) p.lastGain = 0;
    });
    // ── الرهان: المراهن ينال نقاطًا مطابقة تمامًا لمركز من راهن عليه ──
    const betsOut = [];
    if ((room.bets || []).length) {
      room.bets.forEach(b => {
        const by = room.players.find(p => p.id === b.by);
        if (!by || by.spectator) return;
        const ta = room.answers[b.on];
        // نقاط المركز الأساسية فقط — بلا ما أضافته حفلة النقاط
        const pts = ta && ta.correct ? (ta.base != null ? ta.base : ta.gain) : 0;
        if (pts) { by.score += pts; by.lastGain = (by.lastGain || 0) + pts; }
        betsOut.push({ byName: b.byName, onName: b.onName, won: pts > 0, points: pts });
        nsp.to(b.by).emit("betResult", { on: b.onName, won: pts > 0, points: pts });
      });
      room.bets = [];
    }
    const res = alive(room).map(p => {
      const a = room.answers[p.id];
      return {
        id: p.id, name: p.name, color: p.color, charId: p.charId,
        idx: a ? a.idx : -1, correct: a ? a.correct : false,
        gain: a ? a.gain : 0, base: a ? (a.base != null ? a.base : a.gain) : 0,
        rank: a ? a.rank || 0 : 0,
        ms: a ? Math.round(a.elapsed) : null, doubled: !!(a && a.doubled),
        score: p.score
      };
    }).sort((a, b) => (b.correct - a.correct) || ((a.ms ?? 1e9) - (b.ms ?? 1e9)));
    nsp.to(room.id).emit("reveal", {
      correct: room.currentQ.correct,
      correctText: room.currentQ.options[room.currentQ.correct],
      results: res,
      bets: betsOut,
      party: !!room.party,
      partyN: room.partyN || 0,
      vo: voc.pick("reveal")
    });
    room.party = false; room.partyN = 0;
    setPhase(room, "reveal", 0, null);
    // الكشف يطول بقدر مراسمه: حفلات ثم رهانات
    const ms = REVEAL_MS + (room.partyN || 0) * PARTY_MS + (betsOut.length ? BET_MS : 0);
    room.phaseEndsAt = Date.now() + ms;
    room.phaseDur = ms / 1000;
    broadcast(room);
    room.phaseTimer = setTimeout(() => nextStage(room), ms);
  }

  // ====== جولة الربط ======
  function beginLink(room) {
    const L = qbank.drawLink(room.usedLink);
    room.usedLink.add(L.id);
    room.currentLink = L;
    room.pubLink = { title: L.title, total: L.pairs.length };
    room.pubQuestion = null; room.pubSort = null;
    room.answers = {};
    // لوحة مستقلة لكل لاعب: ٣ خانات يمين × ٣ يسار تُضخّ من الأزواج الـ١٥
    room.linkProg = {};
    alive(room).forEach(p => {
      const st = { done: new Set(), hits: 0, fin: 0, r: [], l: [], tokR: {}, tokL: {} };
      room.linkProg[p.id] = st;
      linkFill(room, st);
    });
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    room.qSentAt = Date.now();
    const t = Math.max(45, Math.round(L.pairs.length * 4.5));
    setPhase(room, "link", t, () => revealChallenge(room, "link"));
    broadcast(room);
    // اللوحات تُرسل بعد البثّ: العميل يرفض أي لوحة تصله قبل أن تصير مرحلته "link"
    alive(room).forEach(p => sendBoard(room, p, room.linkProg[p.id]));
  }

  // ملء الخانات الفارغة عشوائيًا بشرط حتمي: توصيلة صحيحة واحدة على الأقل
  // واثنتان كحدّ أقصى معروضتان في اللوحة الحالية (ما دام ذلك ممكنًا رياضيًا)
  function linkFill(room, st) {
    const total = room.currentLink.pairs.length;
    const remain = [];
    for (let i = 0; i < total; i++) if (!st.done.has(i)) remain.push(i);
    // نمط عشوائي لكل لوحة: ١–٣ أسئلة × ١–٣ أجوبة، والقاعدة الوحيدة
    // ألّا يتجاوز جانبٌ ثلاثًا. ١×١ مستثناة لأنها توصيلة جاهزة بلا تفكير.
    let capR, capL;
    do { capR = 1 + Math.floor(Math.random() * 3); capL = 1 + Math.floor(Math.random() * 3); }
    while (capR === 1 && capL === 1);
    // ما زاد عن نمط اللوحة الجديدة يُشذَّب عشوائيًا
    const trim = (side, cap) => { while (st[side].length > cap) st[side].splice(Math.floor(Math.random() * st[side].length), 1); };
    trim("r", capR); trim("l", capL);
    const draw = (side, other, CAP) => {
      while (st[side].length < Math.min(CAP, remain.length ? CAP : 0)) {
        const cand = remain.filter(i => !st[side].includes(i));
        if (!cand.length) break;
        const matches = st.r.filter(i => st.l.includes(i)).length;
        // نفضّل مرشحًا يُبقي التطابقات بين ١ و٢
        let pool2 = cand;
        if (matches >= 2) pool2 = cand.filter(i => !st[other].includes(i));
        else if (matches === 0) {
          const mk = cand.filter(i => st[other].includes(i));
          if (mk.length) pool2 = mk;
        }
        if (!pool2.length) pool2 = cand;
        st[side].push(pool2[Math.floor(Math.random() * pool2.length)]);
      }
    };
    draw("r", "l", capR); draw("l", "r", capL);
    // ضمانة أخيرة: لا لوحة بلا توصيلة صحيحة واحدة
    const matches = st.r.filter(i => st.l.includes(i));
    if (!matches.length && st.r.length) {
      const pick = st.r[Math.floor(Math.random() * st.r.length)];
      const swap = st.l.findIndex(i => !st.r.includes(i));
      if (swap >= 0) st.l[swap] = pick; else if (st.l.length < capL) st.l.push(pick);
    }
    // رموز عشوائية لكل خانة: العميل لا يرى أرقام الأزواج فلا يطابقها غشًّا
    st.tokR = {}; st.tokL = {};
    st.r.forEach(i => st.tokR[crypto.randomBytes(4).toString("hex")] = i);
    st.l.forEach(i => st.tokL[crypto.randomBytes(4).toString("hex")] = i);
  }

  function sendBoard(room, p, st) {
    const P = room.currentLink.pairs;
    nsp.to(p.id).emit("linkBoard", {
      title: room.currentLink.title,
      total: P.length, hits: st.hits,
      r: Object.entries(st.tokR).map(([k, i]) => ({ k, txt: P[i][0] })),
      l: Object.entries(st.tokL).map(([k, i]) => ({ k, txt: P[i][1] }))
    });
  }

  // محاولة توصيل: خطأٌ لا يُفقد شيئًا — يُعاد المحاولة بلا عقوبة
  function linkPick(room, p, data) {
    if (room.phase !== "link" || p.spectator) return;
    const st = room.linkProg && room.linkProg[p.id];
    if (!st || st.fin) return;
    const ri = st.tokR[data && data.r], li = st.tokL[data && data.l];
    if (ri === undefined || li === undefined) return;
    const correct = ri === li;
    nsp.to(p.id).emit("linkFb", { correct, r: data.r, l: data.l });
    if (!correct) return;
    st.done.add(ri); st.hits++;
    st.r = st.r.filter(i => i !== ri);
    st.l = st.l.filter(i => i !== li);
    const total = room.currentLink.pairs.length;
    if (st.hits >= total) {
      st.fin = 1;
      st.elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
      p.answered = true;
      st.tokR = {}; st.tokL = {};
      sendBoard(room, p, st);        // لوحة فارغة = «أكملت، بانتظار البقية»
      broadcast(room);
      if (alive(room).every(x => x.answered)) {
        clearTimers(room);
        setTimeout(() => { if (room.phase === "link") revealChallenge(room, "link"); }, 400);
      }
      return;
    }
    linkFill(room, st);
    sendBoard(room, p, st);
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
    room.pubSort = { a: S.a, b: S.b, items: S.items, total: S.items.length };
    room.pubQuestion = null; room.pubLink = null;
    room.answers = {};
    // تقدّم كل لاعب: مؤشر العنصر الحالي وعدد الإصابات — الخادم مصدر الحقيقة
    room.sortProg = {};
    alive(room).forEach(p => { room.sortProg[p.id] = { idx: 0, hits: 0, fin: 0 }; });
    room.players.forEach(p => { p.answered = false; p.lastGain = 0; p.effects = []; });
    room.qSentAt = Date.now();
    // ثانيتان للعنصر — إيقاع سريع كما طلب اللاعبون
    const t = Math.max(20, S.items.length * 2);
    setPhase(room, "sort", t, () => revealChallenge(room, "sort"));
    broadcast(room);
  }

  // سحب عنصر واحد يمينًا أو يسارًا — الرد فوري: صح أو خطأ، بلا تراجع
  function sortPick(room, p, data) {
    if (room.phase !== "sort" || p.spectator) return;
    const st = room.sortProg && room.sortProg[p.id];
    if (!st || st.fin) return;
    const i = Number(data && data.i), side = Number(data && data.side);
    if (i !== st.idx) return;                       // ترتيب صارم — لا قفز
    if (side !== 0 && side !== 1) return;
    const ans = room.currentSort.answer;
    if (i < 0 || i >= ans.length) return;
    const correct = ans[i] === side;
    if (correct) st.hits++;
    st.idx++;
    nsp.to(p.id).emit("sortFb", { i, correct, side });
    if (st.idx >= ans.length) {
      st.fin = 1;
      st.elapsed = Math.max(0, Date.now() - room.qSentAt - (p.rtt || 0) / 2);
      p.answered = true;
      broadcast(room);
      if (alive(room).every(x => x.answered)) {
        clearTimers(room);
        setTimeout(() => { if (room.phase === "sort") revealChallenge(room, "sort"); }, 400);
      }
    }
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
    let res, raceMs = 0;
    if (kind === "sort" || kind === "link") {
      // النقاط تُمنح هنا من التقدّم المتتبَّع (من لم يُكمل يأخذ عن إصاباته فقط)
      const dur = (Date.now() - room.qSentAt);
      const progMap = kind === "sort" ? room.sortProg : room.linkProg;
      res = alive(room).map(p => {
        const st = (progMap || {})[p.id] || { idx: 0, hits: 0 };
        return {
          id: p.id, name: p.name, color: p.color, charId: p.charId,
          hits: st.hits, done: kind === "sort" ? st.idx : st.hits, gain: 0, score: p.score,
          ms: st.fin ? Math.round(st.elapsed) : null
        };
      // التعادل يُحسم بالسرعة: من أنهى قائمته في زمن أقل يتقدّم
      }).sort((a, b) => b.hits - a.hits || ((a.ms ?? 1e9) - (b.ms ?? 1e9)));
      // نقاط المراكز بعد اكتمال الترتيب — من لم يُصب شيئًا لا يُكافأ على مركزه
      const NP = res.length;
      res.forEach((r, i) => {
        r.gain = r.hits > 0 ? rankPoints(NP, i + 1) : 0;
        const pl = room.players.find(x => x.id === r.id);
        if (pl) { pl.score += r.gain; pl.lastGain = r.gain; r.score = pl.score; }
      });
      const maxHits = res.length ? res[0].hits : 0;
      raceMs = maxHits * 450 + 3500;   // مدة سباق الصعود في العميل
    } else {
      res = alive(room).map(p => {
        const a = room.answers[p.id];
        return {
          id: p.id, name: p.name, color: p.color,
          hits: a ? a.hits : 0, gain: a ? a.gain : 0, score: p.score,
          picks: a ? a.picks : null
        };
      }).sort((a, b) => b.hits - a.hits || b.gain - a.gain);
    }
    nsp.to(room.id).emit("revealChallenge", { kind, results: res,
      total: kind === "sort" ? src.answer.length : src.pairs.length });
    // تعليق «انتهى الوقت» طويل نسبيًا، فنمدّ الكشف حتى يكتمل
    room.pubVo = voc.pick(kind === "sort" ? "sort_timeup" : "link_timeup");
    if (room.pubVo) room.pubVo.at = "reveal";
    const cms = FAST ? REVEAL_MS + 1500
      : Math.max(REVEAL_MS + 1500, (room.pubVo ? room.pubVo.dur * 1000 + 800 : 0), raceMs);
    setPhase(room, "reveal", 0, null);
    room.phaseEndsAt = Date.now() + cms;
    room.phaseDur = cms / 1000;
    broadcast(room);
    room.phaseTimer = setTimeout(() => nextStage(room), cms);
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
    room.pubQuestion = { text: q.text, options: q.options, cat: q.cat, diff: q.diff, img: q.img || null, voice: voiceOf(room, q.text) };
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

    // «اقتراب لاعب من القمة»: يقرّره الخادم مرة واحدة لكل مباراة، فيسمعه الجميع معًا
    let nearVo = null;
    const top = Math.max(0, ...alive(room).map(p => p.pyPos || 0));
    if (!room.voDone.near_top && top >= H - 2 && top < H) {
      room.voDone.near_top = true;
      nearVo = voc.pick("near_top");
    }
    nsp.to(room.id).emit("pyramidReveal", {
      correct: room.currentQ.correct,
      correctText: room.currentQ.options[room.currentQ.correct],
      fastest, moves, nearVo
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
    nsp.to(room.id).emit("finish", { winner: room.winner, table: room.finalTable, vo: voc.pick("winner") });
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
        color: COLORS[0],
        charId: null,      // الشخصية المختارة
        ready: false       // ضغط «مستعد» فحُجزت له
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
        pyQIndex: 0, winner: null, finalTable: null, qSentAt: 0,
        introDone: {}, introKind: null, pubIntro: null, pubVo: null, pubHurry: null, voDone: {}, openingDone: false, openingSkipped: false
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

    // اختيار الشخصية: مسموح في اللوبي فقط، ولا يجوز أن يأخذها اثنان
    socket.on("pickChar", (id) => {
      if (!room || !player || room.state !== "lobby") return;
      if (player.ready) return;                       // حجزها بالفعل
      if (id === null) { player.charId = null; broadcast(room); return; }
      if (!CHAR_IDS.includes(id)) return;
      if (room.players.some(p => p !== player && p.charId === id)) return;  // محجوزة لغيره
      player.charId = id;
      broadcast(room);
    });

    socket.on("readyChar", (on) => {
      if (!room || !player || room.state !== "lobby") return;
      if (on) {
        if (!player.charId) return;                   // لا استعداد بلا شخصية
        // فحص أخير قبل الحجز: قد يكون أحدهم سبقه في اللحظة نفسها
        if (room.players.some(p => p !== player && p.ready && p.charId === player.charId)) {
          player.charId = null; broadcast(room); return;
        }
        player.ready = true;
      } else player.ready = false;
      broadcast(room);
    });

    socket.on("startGame", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      startGame(room);
    });

    socket.on("skipIntro", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      skipIntro(room);
    });

    socket.on("backToLobby", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      clearTimers(room);
      room.state = "lobby"; room.phase = "lobby";
      room.winner = null; room.finalTable = null;
      room.pubQuestion = null; room.pubLink = null; room.pubSort = null;
      room.stageIdx = -1; room.stages = []; room.pyQIndex = 0;
      room.introDone = {}; room.introKind = null; room.pubIntro = null; room.pubVo = null; room.pubHurry = null; room.voDone = {};
      room.openingDone = false; room.openingSkipped = false;
      // بقايا الجولة السابقة: فخاخ ورهانات وحفلات وأسئلة مستهلكة
      room.attacks = []; room.bets = [];
      room.party = false; room.partyNext = false; room.partyN = 0; room.partyCount = 0;
      room.votes = {}; room.voteCount = {}; room.catOptions = []; room.answers = {};
      room.sortProg = {}; room.linkProg = {}; room.currentQ = null;
      room.currentLink = null; room.currentSort = null;
      room.usedQ = new Set(); room.usedLink = new Set(); room.usedSort = new Set();
      room.lastCats = []; room.chosenCat = null;
      // نُلغي الاستعداد ونُبقي الاختيار: يعيد اللاعب تأكيده أو يبدّله للجولة الجديدة
      room.players.forEach(p => {
        p.spectator = false; p.score = 0; p.pyPos = 0; p.effects = []; p.ready = false;
        p.answered = false; p.lastGain = 0; p.pendingAttack = null;
        p.menu = null; p.lastTarget = null; p.lastPower = null;
        p.powersLeft = room.settings.powers ? room.settings.powerUses : 0;
        p.doubleNext = false;
      });
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
        player.lastPower = power;
        // حفلة النقاط: السؤال القادم كله بنقاط مضاعفة — لكل من يجيب صح
        if (power === "double") {
          room.partyNext = true;
          // كل حفلة تضيف مضاعفة إضافية
          room.partyCount = (room.partyCount || 0) + 1;
          // الجميع يعلم أن حفلةً أُقيمت — بلا كشف صاحبها
          nsp.to(room.id).emit("partyOn", { n: room.partyCount });
        }
        nsp.to(player.id).emit("attackAck", { to: "الجميع", power, self: true });
        broadcast(room);
        maybeEndAttack(room);
        return;
      }

      const target = room.players.find(p => p.id === to);
      if (!target || target.id === player.id || target.spectator) return;

      // ── الرهان: لا يضر الهدف — تراهن أنه سيجيب صح أولاً ──
      if (power === "bet") {
        player.pendingAttack = { to, power };
        player.lastPower = power;
        (room.bets = room.bets || []).push({ by: player.id, byName: player.name, on: to, onName: target.name });
        nsp.to(player.id).emit("attackAck", { to: target.name, power, bet: true });
        broadcast(room);
        maybeEndAttack(room);
        return;
      }
      player.pendingAttack = { to, power };
      player.lastTarget = to;
      player.lastPower = power;
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
    socket.on("sortPick", (d) => { if (room && player) sortPick(room, player, d); });
    socket.on("linkPick", (d) => { if (room && player) linkPick(room, player, d); });

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
