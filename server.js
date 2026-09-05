// ارسمها! - لعبة رسم وتخمين عربية (على غرار skribbl.io)
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");
const CATEGORIES = require("./words");
const { createStore } = require("./store");
const { setupAdmin } = require("./admin");
const { setupBomb } = require("./bomb");
const { setupQuiz } = require("./quiz");
const mod = require("./moderation");
const { setupSalfa } = require("./salfa");
const { setupAccounts, attachSocketAuth, nameFromSocket } = require("./account");
const { securityHeaders, rateLimit } = require("./security");

const app = express();
const server = http.createServer(app);

/* ═══ الأصول المسموح بها ═══
   خلف Render نعرف نطاقنا من RENDER_EXTERNAL_URL، ويمكن إضافة نطاقاتٍ أخرى في
   ALLOWED_ORIGINS مفصولةً بفواصل. في التطوير المحلّي نسمح بكل شيء. */
const PROD = process.env.NODE_ENV === "production" || !!process.env.RENDER;
const ORIGINS = [process.env.RENDER_EXTERNAL_URL, ...String(process.env.ALLOWED_ORIGINS || "")
  .split(",").map(x => x.trim())].filter(Boolean);
const originOK = o => !PROD || !ORIGINS.length || !o || ORIGINS.includes(o);

const io = new Server(server, {
  cors: { origin: (o, cb) => cb(null, originOK(o)), credentials: true },
  maxHttpBufferSize: 1e6
});

/* خلف بروكسي Render: بدونه تكون req.ip هي البروكسي فتفشل كل حدود المعدّل،
   ولا يعرف express أن الاتصال https فلا تُوسَم الكوكيز Secure. */
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders());

/* حدٌّ عامٌّ لكل الطلبات — سخيّ كي لا يزعج اللعب، ويكفي لصدّ الإغراق */
app.use(rateLimit({ name: "all", windowMs: 60000, max: 600 }));
/* وحدٌّ أضيق على واجهات البيانات */
app.use("/api", rateLimit({ name: "api", windowMs: 60000, max: 120 }));

let admin = null; // يُهيأ بعد الاتصال بقاعدة البيانات

// إحصائيات حية للوحة المراقبة
function getLiveStats() {
  let online = 0;
  const roomList = [];
  rooms.forEach(r => {
    const conn = r.players.filter(p => p.connected && !p.isBot);
    online += conn.length;
    if (conn.length > 0) {
      roomList.push({
        id: r.id,
        state: r.state,
        mode: r.settings.mode,
        players: conn.length,
        owner: r.players.find(p => p.id === r.ownerId)?.name || null
      });
    }
  });
  return { online, rooms: roomList };
}

// دعم هيكلين: index.html داخل public/ أو في جذر المشروع
const pubDir = path.join(__dirname, "public");
const indexFile = fs.existsSync(path.join(pubDir, "index.html")) ? path.join(pubDir, "index.html") : path.join(__dirname, "index.html");
const pageFile = (name) => {
  const inPub = path.join(pubDir, name);
  return fs.existsSync(inPub) ? inPub : path.join(__dirname, name);
};
// الصفحة الرئيسية: اختيار اللعبة
app.get("/", (req, res) => {
  if (admin) admin.trackVisit();
  const hub = pageFile("hub.html");
  if (fs.existsSync(hub)) return res.sendFile(hub);
  res.sendFile(indexFile); // احتياطي: لعبة الرسم
});
// لعبة الرسم
app.get(["/draw", "/rassm"], (req, res) => {
  if (admin) admin.trackVisit();
  res.sendFile(indexFile);
});
// لعبة القنبلة
app.get(["/bomb", "/qunbula"], (req, res) => {
  if (admin) admin.trackVisit();
  const f = pageFile("bomb.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).type("text").send("bomb.html غير موجود");
});
// النسخة الكلاسيكية أُلغيت — أي رابط قديم يوجّه للنسخة المعتمدة
app.get(["/quiz", "/qimma"], (req, res) => res.redirect(301, "/quiz2"));
// قمّة الهرم — النسخة المعتمدة
app.get(["/quiz2", "/apex"], (req, res) => {
  if (admin) admin.trackVisit();
  const f = pageFile("quiz2.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).type("text").send("quiz2.html غير موجود");
});
// 🕵️ برّا السالفة
// 🃏 أونو: لعبةٌ ثابتة كاملة في public/uno — تُخدَم من المجلد نفسه لأنّ مساراتها نسبية
// (Express يطابق /uno و/uno/ معًا، فنفرّق بالمسار الأصليّ كي لا ندور في حلقة)
// 👤 صفحة الحساب — حسابٌ واحد لكل الألعاب
app.get(["/me", "/hesabi"], (req, res) => res.sendFile(path.join(pubDir, "me.html")));
app.get(["/shop", "/mtjr"], (req, res) => res.sendFile(path.join(pubDir, "shop.html")));

app.get("/uno", (req, res) => {
  if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(301, "/uno/");
  res.sendFile(path.join(pubDir, "uno", "index.html"));
});
// 🂡 بالوت: ساحتها منقولةٌ من اونو، وقواعدها في balootrules.js على الخادم
app.get("/baloot", (req, res) => {
  if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(301, "/baloot/");
  res.sendFile(path.join(pubDir, "baloot", "index.html"));
});
app.get(["/barra", "/salfa"], (req, res) => {
  if (admin) admin.trackVisit();
  const f = pageFile("salfa.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).type("text").send("salfa.html غير موجود");
});
// نقطة إبقاء حيّة (تمنع السيرفر المجاني من النوم أثناء اللعب الطويل)
app.get("/healthz", (req, res) => res.type("text").send("ok"));
// حالة الألعاب المباشرة (تستعملها الصفحة الرئيسية)
let bombApi = null, quizApi = null, salfaApi = null, ttsApi = null;
app.get("/api/status", (req, res) => {
  const draw = getLiveStats();
  const bomb = bombApi ? bombApi.liveStats() : { online: 0, rooms: [] };
  const quiz = quizApi ? quizApi.liveStats() : { online: 0, rooms: [] };
  const salfa = salfaApi ? salfaApi.liveStats() : { online: 0, rooms: [] };
  res.json({
    draw: { online: draw.online, rooms: draw.rooms.length },
    bomb: { online: bomb.online, rooms: bomb.rooms.length },
    quiz: { online: quiz.online, rooms: quiz.rooms.length },
    salfa: { online: salfa.online, rooms: salfa.rooms.length },
    total: draw.online + bomb.online + quiz.online + salfa.online
  });
});
// حساب واحد لكل الألعاب — يُسجّل الدخول من الصفحة الرئيسية فقط
const accounts = setupAccounts(app, {
  get store() { return store; },   /* كسولٌ: القاعدة تُفتح بعد تركيب المسارات */
  hashPass, publicStats,
  onNewUser: () => { if (admin) admin.trackNewUser(); }
});
/* المتجر يحلّ الهويّة بالطريقة نفسها التي تحلّها الحسابات — لا فكَّ كوكي ثانٍ */
require("./shop").setupShop(app, {
  get store() { return store; },
  currentUser: accounts.currentUser
});
require("./support").setupSupport(app, {
  get store() { return store; },
  currentUser: accounts.currentUser, pubDir
});
/* ═══ صفحات المختبرات ═══
   *-lab.html و_doors_preview.html أدواتُ ضبطٍ داخلية (إحداثيات، فخاخ، أقراص).
   تبقى متاحةً محلّيًّا للتطوير، وتُحجَب في الإنتاج إلا لصاحب جلسة الأدمن. */
const LAB_RE = /(^|\/)(_.*|.*-lab)\.html$/i;
app.use((req, res, next) => {
  if (!PROD || !LAB_RE.test(req.path)) return next();
  let ok = false;
  try {
    const { verifySession, parseCookies } = require("./admin");
    ok = verifySession(parseCookies(req).adm);
  } catch (e) {}
  if (ok) return next();
  res.status(404).type("text/plain; charset=utf-8").send("غير موجود");
});

if (fs.existsSync(path.join(pubDir, "index.html"))) app.use(express.static(pubDir));

/* SESSION_SECRET بلا قيمةٍ ثابتة يعني توليدَ سرٍّ جديد مع كل إقلاع، فتُبطَل
   جلساتُ كل اللاعبين والأدمن مع كل نشر. نمنع الإقلاع في الإنتاج بدونه. */
if (PROD && !process.env.SESSION_SECRET) {
  console.error("\n❌ SESSION_SECRET غير مضبوط — أضفه في متغيّرات البيئة قبل التشغيل.\n");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// ====== إعدادات عامة ======
const PICK_TIME = 15;
const WORD_CHOICES = 3;
const MAX_PLAYERS = 12;
const VOTE_TIME = 25;

const CATEGORY_NAMES = Object.keys(CATEGORIES);
const ALL_WORDS = CATEGORY_NAMES.flatMap(c => CATEGORIES[c]);

const DEFAULT_SETTINGS = { rounds: 3, turnTime: 80, category: "الكل", mode: "classic", guessLock: 0, roundGallery: false };
const MAX_POINTS = 10; // أعلى نقاط للسؤال الواحد

const rooms = new Map();

// ====== قاعدة البيانات (عبر store.js) ======
let store = null; // تُهيأ قبل تشغيل السيرفر في الأسفل
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString("hex"); }
/* ما يُعرَض للناس هو الاسم المعروض إن وُجد، لا اسم الدخول */
function publicStats(u) { return { name: u.displayName || u.name, wins: u.wins, games: u.games, totalScore: u.totalScore }; }

// ====== أدوات نصية ======
function normalizeArabic(text) {
  return (text || "")
    .trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

function makeRoomId() {
  let id = "";
  do { id = String(Math.floor(10000 + Math.random() * 90000)); } while (rooms.has(id));
  return id;
}

// ====== الكلمات ======
// تعديلات الكلمات محلّية لكل غرفة: كل غرفة جديدة تبدأ من القائمة الأساسية.
// اللاعب المسجَّل تُحمَّل له كلماته وإعداداته المحفوظة، وتُحفظ تعديلاته باسمه.
function emptyWords() { return { extra: {}, removedWords: new Set(), removedCats: new Set() }; }
function wordsToJSON(w) {
  return { extra: w.extra, removedWords: [...w.removedWords], removedCats: [...w.removedCats] };
}
function wordsFromJSON(j) {
  return {
    extra: (j && j.extra) || {},
    removedWords: new Set((j && j.removedWords) || []),
    removedCats: new Set((j && j.removedCats) || [])
  };
}
const PROFILE_KEY = (name) => "drawProfile:" + name;

// حفظ مؤجَّل لملف اللاعب المسجَّل (الضيف لا يُحفظ له شيء)
function persistWords(room) {
  if (!room || !room.ownerUser) return;         // ضيف → التعديلات تنتهي مع الغرفة
  clearTimeout(room._wSave);
  room._wSave = setTimeout(() => {
    store.saveKV(PROFILE_KEY(room.ownerUser), {
      words: wordsToJSON(room.words),
      settings: room.settings
    }).catch(e => console.error("profile save:", e.message));
  }, 600);
}

// الفئات الفعلية للغرفة: الأصلية (بدون المحذوف) + المضافة
function roomCategories(room) {
  const W = (room && room.words) || emptyWords();
  const out = {};
  for (const [name, words] of Object.entries(CATEGORIES)) {
    if (W.removedCats.has(name)) continue;
    out[name] = [...words.filter(w => !W.removedWords.has(w)), ...(W.extra[name] || [])];
  }
  for (const [name, words] of Object.entries(W.extra)) {
    if (!(name in CATEGORIES)) out[name] = [...words];
  }
  return out;
}

function wordPool(room) {
  if (room.customWords.length >= 5) return room.customWords;
  const cats = roomCategories(room);
  let base = (room.settings.category !== "الكل" && cats[room.settings.category])
    ? cats[room.settings.category]
    : Object.values(cats).flat();
  base = [...new Set(base)];
  return base.length ? base : ALL_WORDS;
}

function pickWords(room, n) {
  const poolAll = wordPool(room);
  const pool = poolAll.filter(w => !room.usedWords.has(w));
  const source = pool.length >= n ? pool : poolAll;
  const picks = [];
  const copy = [...source];
  while (picks.length < n && copy.length) {
    picks.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return picks;
}

function sanitizeSettings(s, old, room) {
  s = s || {};
  const catOk = s.category === "الكل" || !!roomCategories(room)[s.category];
  return {
    rounds: [1, 2, 3, 5, 10].includes(+s.rounds) ? +s.rounds : old.rounds,
    turnTime: Number.isFinite(+s.turnTime) ? Math.min(300, Math.max(10, Math.round(+s.turnTime))) : old.turnTime,
    category: catOk ? s.category : old.category,
    mode: ["classic", "teams", "vote"].includes(s.mode) ? s.mode : old.mode,
    guessLock: [0, 3, 5, 10, 15, 25, 30].includes(+s.guessLock) ? +s.guessLock : (old.guessLock || 0),
    roundGallery: typeof s.roundGallery === "boolean" ? s.roundGallery : (old.roundGallery || false)
  };
}

// ====== حالة الغرفة ======
function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id, name: p.name, score: p.score,
    isDrawer: p.id === room.drawerId,
    guessed: room.guessedIds.has(p.id),
    connected: p.connected,
    isOwner: p.id === room.ownerId,
    isBot: !!p.isBot,
    team: p.team || null
  }));
}

function roomState(room) {
  return {
    roomId: room.id,
    players: publicPlayers(room),
    state: room.state, // lobby | picking | drawing | drawAll | collecting | voting | turnEnd | gameEnd
    round: room.round,
    totalRounds: room.settings.rounds,
    settings: room.settings,
    categories: Object.keys(roomCategories(room)),
    customWordsCount: room.customWords.length,
    drawerId: room.drawerId,
    drawerName: room.players.find(p => p.id === room.drawerId)?.name || null,
    canvasAspect: typeof room.canvasAspect === "number" ? room.canvasAspect : null,
    hint: room.hint,
    timeLeft: room.timeLeft,
    guessLockRemaining: (room.state === "drawing" && room.guessOpenAt && Date.now() < room.guessOpenAt)
      ? Math.ceil((room.guessOpenAt - Date.now()) / 1000) : 0,
    paused: !!room.paused,
    pausedName: room.paused ? (room.pendingDrawer?.name || null) : null
  };
}

function broadcast(room) { io.to(room.id).emit("roomState", roomState(room)); }
function sysMsg(room, text, cls = "system") { io.to(room.id).emit("chat", { system: true, cls, text }); }

function clearTimers(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  (room.botTimers || []).forEach(t => { clearTimeout(t); clearInterval(t); });
  room.botTimers = [];
}

// ====== بدء اللعبة ======
function startGame(room) {
  if (admin) admin.trackGame();
  room.round = 0;
  room.usedWords = new Set();
  room.roundDrawings = [];
  room.galleryDone = false;
  room.players = room.players.filter(p => p.connected); // تنظيف المغادرين
  room.players.forEach(p => { p.score = 0; p.hasDrawn = false; p.team = null; });

  if (room.settings.mode === "teams") {
    const conn = room.players.filter(p => p.connected);
    // خلط ثم توزيع بالتناوب
    const shuffled = [...conn].sort(() => Math.random() - 0.5);
    shuffled.forEach((p, i) => p.team = i % 2 === 0 ? "red" : "blue");
    const red = shuffled.filter(p => p.team === "red").map(p => p.name).join("، ");
    const blue = shuffled.filter(p => p.team === "blue").map(p => p.name).join("، ");
    sysMsg(room, `🔴 الفريق الأحمر: ${red}`);
    sysMsg(room, `🔵 الفريق الأزرق: ${blue}`);
  }

  sysMsg(room, "بدأت اللعبة! 🎨");
  if (room.settings.mode === "vote") nextVoteRound(room);
  else nextTurn(room);
}

// ====== معرض رسمات نهاية الجولة (بدون تايمر - القائد ينتقل بنفسه) ======
function showRoundGallery(room) {
  clearTimers(room);
  room.state = "roundGallery";
  const drawings = room.roundDrawings || [];
  room.galleryReacts = drawings.map(() => ({ like: 0, dislike: 0 }));
  room.galleryVotes = {};
  room.timeLeft = 0;
  io.to(room.id).emit("roundGallery", { drawings, reacts: room.galleryReacts });
  sysMsg(room, "معرض رسمات الجولة! 👍👎 القائد ينتقل للجولة التالية عند الجاهزية");
  broadcast(room);
}

// ====== الوضع الكلاسيكي / الفرق ======
function nextTurn(room) {
  clearTimers(room);
  if (room.drawerGrace) { clearTimeout(room.drawerGrace); room.drawerGrace = null; }
  room.paused = false;
  room.guessedIds = new Set();
  room.currentWord = null;
  room.hint = "";
  room.canvasOps = [];
  room.canvasAspect = null;   // نسبة لوحة الرسّام تُحدَّد من جديد كل دور

  const connected = room.players.filter(p => p.connected);
  if (connected.length < 2) {
    room.state = "lobby";
    sysMsg(room, "عدد اللاعبين غير كافٍ، بانتظار انضمام لاعبين...");
    broadcast(room);
    return;
  }

  // أولوية للرسام اللي انقطع ورجع (دوره محفوظ)
  let next = null;
  if (room.pendingDrawer && room.pendingDrawer.connected && !room.pendingDrawer.hasDrawn) {
    next = room.pendingDrawer;
  }
  room.pendingDrawer = null;
  if (!next) next = connected.find(p => !p.hasDrawn);
  if (!next) {
    // انتهت الجولة — اعرض المعرض أولًا إن كان مفعّلًا
    if (room.settings.roundGallery && room.settings.mode !== "vote"
        && room.roundDrawings && room.roundDrawings.length && !room.galleryDone) {
      return showRoundGallery(room);
    }
    room.galleryDone = false;
    room.roundDrawings = [];
    room.round++;
    if (room.round >= room.settings.rounds) return endGame(room);
    room.players.forEach(p => p.hasDrawn = false);
    sysMsg(room, `الجولة ${room.round + 1} من ${room.settings.rounds}`);
    next = connected[0];
  }
  if (room.round === 0 && !room.players.some(p => p.hasDrawn)) {
    sysMsg(room, `الجولة 1 من ${room.settings.rounds}`);
  }

  next.hasDrawn = true;
  room.drawerId = next.id;
  room.state = "picking";
  room.wordOptions = pickWords(room, WORD_CHOICES);
  room.timeLeft = PICK_TIME;

  io.to(next.id).emit("chooseWord", { options: room.wordOptions, time: PICK_TIME });
  sysMsg(room, `${next.name} يختار الكلمة...`);
  broadcast(room);

  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) chooseWord(room, next.id, room.wordOptions[0]);
  }, 1000);
}

function chooseWord(room, playerId, word) {
  if (room.state !== "picking" || playerId !== room.drawerId) return;
  if (!room.wordOptions.includes(word)) word = room.wordOptions[0];
  clearTimers(room);

  const T = room.settings.turnTime;
  room.currentWord = word;
  room.usedWords.add(word);
  room.state = "drawing";
  room.timeLeft = T;
  room.hint = word.replace(/[^ ]/g, "_");
  room.revealedIdx = new Set();

  // قفل التخمين: لا أحد يقدر يخمّن إلا بعد مرور المدة المحددة
  const lock = room.settings.guessLock || 0;
  room.guessOpenAt = Date.now() + lock * 1000;

  io.to(playerId).emit("yourWord", { word });
  io.to(room.id).emit("clearCanvas");
  io.to(room.id).emit("guessLock", { seconds: lock });
  sysMsg(room, lock > 0 ? `بدأ الرسم! التخمين يفتح بعد ${lock} ثواني ✏️` : "بدأ الرسم! خمنوا الكلمة ✏️");
  broadcast(room);

  startDrawCountdown(room);
}

// عدّاد وقت الرسم (يُستأنف من الوقت المتبقّي عند رجوع الرسام)
// كم حرفاً يُكشف في التلميح: نصف حروف الكلمة (تقريب للأعلى عند الفرد)
// حرفان→١ · ٣→٢ · ٤→٢ · ٥→٣ · ٦→٣ … مع إبقاء حرف واحد مخفياً على الأقل
function hintBudget(word) {
  const n = word.replace(/ /g, "").length;
  if (n <= 1) return 0;
  return Math.max(1, Math.min(n - 1, Math.round(n / 2)));
}

/* جدول كشف التلميح:
   • أول حرف بعد انقضاء ثلث الوقت.
   • آخر حرف حين يتبقّى ١٥ ثانية.
   • الباقي موزّع بالتساوي بين اللحظتين.
   مثال: كلمة ٨ أحرف والوقت ٦٠ث ⇒ الميزانية ٤ أحرف، أول حرف عند مضي ٢٠ث
   (يتبقّى ٤٠) وآخر حرف عند تبقّي ١٥ث، والحرفان الوسطيان موزّعان بينهما.
   يُرجِع Map: ثانية متبقّية → إجمالي الحروف المكشوفة عندها. */
const HINT_TAIL = 15;   // ثواني تبقى بعد اكتمال التلميح
function hintSchedule(T, budget) {
  const map = new Map();
  if (budget <= 0 || T <= 2) return map;
  const first = Math.max(1, T - Math.round(T / 3));   // المتبقّي عند أول حرف
  let last = HINT_TAIL;                               // المتبقّي عند آخر حرف
  if (last >= first) last = Math.max(1, Math.floor(first / 2));  // أوقات قصيرة: انضغاط آمن
  if (budget === 1) { map.set(first, 1); return map; }
  const used = new Set();
  for (let i = 0; i < budget; i++) {
    let s = Math.round(first - (first - last) * (i / (budget - 1)));
    s = Math.min(first, Math.max(1, s));
    while (used.has(s) && s > 1) s--;                 // لا حرفان في الثانية نفسها
    used.add(s);
  }
  // الإجمالي التراكمي: الأحدث زمنياً يحمل رقماً أكبر
  [...used].sort((a, b) => b - a).forEach((s, i) => map.set(s, i + 1));
  return map;
}

function startDrawCountdown(room) {
  clearTimers(room);
  const T = room.settings.turnTime;
  const word = room.currentWord;
  // التلميح تدريجي: أول حرف بعد ثلث الوقت، وآخر حرف عند تبقّي ١٥ ثانية
  const budget = hintBudget(word);
  const revealAt = hintSchedule(T, budget);         // ثانية متبقّية → إجمالي الحروف المكشوفة
  room.timer = setInterval(() => {
    room.timeLeft--;
    const want = revealAt.get(room.timeLeft);
    if (want) {
      const letters = word.split("");
      let changed = false;
      while (room.revealedIdx.size < Math.min(want, budget)) {
        const hidden = letters.map((c, i) => (c !== " " && !room.revealedIdx.has(i) ? i : -1)).filter(i => i >= 0);
        if (hidden.length <= 1) break;   // لا نكشف الكلمة بالكامل
        room.revealedIdx.add(hidden[Math.floor(Math.random() * hidden.length)]);
        changed = true;
      }
      if (changed) {
        room.hint = letters.map((c, i) => (c === " " ? " " : room.revealedIdx.has(i) ? c : "_")).join("");
        broadcast(room);
      }
    }
    if (room.timeLeft <= 0) endTurn(room, "time");
    else if (room.timeLeft % 5 === 0) broadcast(room);
    io.to(room.id).emit("tick", room.timeLeft);
  }, 1000);
}

function endTurn(room, reason) {
  clearTimers(room);
  room.state = "turnEnd";

  // الرسام لا يأخذ نقاط
  const word = room.currentWord;

  // التقاط رسمة الجولة إن كان معرض الجولة مفعّلًا
  if (room.settings.roundGallery && room.settings.mode !== "vote") {
    io.to(room.drawerId).emit("captureDrawing", { word });
  }

  io.to(room.id).emit("turnEnd", { word, reason });
  if (reason === "all") sysMsg(room, `الجميع خمّن الكلمة! كانت: ${word} ✅`, "correct");
  else sysMsg(room, `انتهى الوقت! الكلمة كانت: ${word}`);
  broadcast(room);

  setTimeout(() => { if (rooms.has(room.id)) nextTurn(room); }, 5000);
}

// ====== وضع "الكل يرسم" بالتصويت ======
function nextVoteRound(room) {
  clearTimers(room);
  room.drawerId = null;
  room.guessedIds = new Set();
  room.drawings = new Map();
  room.votes = new Map();
  room.canvasOps = [];
  room.canvasAspect = null;   // نسبة لوحة الرسّام تُحدَّد من جديد كل دور

  const connected = room.players.filter(p => p.connected && !p.isBot);
  if (connected.length < 2) {
    room.state = "lobby";
    sysMsg(room, "وضع التصويت يحتاج لاعبين حقيقيين اثنين على الأقل");
    broadcast(room);
    return;
  }

  if (room.round >= room.settings.rounds) return endGame(room);

  const word = pickWords(room, 1)[0];
  room.currentWord = word;
  room.usedWords.add(word);
  room.state = "drawAll";
  room.timeLeft = room.settings.turnTime;
  room.hint = "";

  io.to(room.id).emit("voteWord", { word, round: room.round + 1, total: room.settings.rounds });
  io.to(room.id).emit("clearCanvas");
  sysMsg(room, `الكلمة ${room.round + 1} من ${room.settings.rounds}: الجميع يرسم "${word}" 🎨`);
  broadcast(room);

  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) startGallery(room);
    else if (room.timeLeft % 5 === 0) broadcast(room);
    io.to(room.id).emit("tick", room.timeLeft);
  }, 1000);
}

function startGallery(room) {
  clearTimers(room);
  room.state = "collecting";
  room.timeLeft = 0;
  io.to(room.id).emit("requestDrawing");
  broadcast(room);

  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    const entries = [...room.drawings].map(([id, img]) => ({
      id, img, name: room.players.find(p => p.id === id)?.name || "؟"
    }));
    if (entries.length < 2) {
      sysMsg(room, "لم يصل عدد كافٍ من الرسمات، ننتقل للكلمة التالية...");
      room.round++;
      return setTimeout(() => nextVoteRound(room), 2000);
    }
    room.state = "voting";
    room.timeLeft = VOTE_TIME;
    io.to(room.id).emit("gallery", { entries, word: room.currentWord });
    sysMsg(room, "صوّتوا لأفضل رسمة! 🗳️ (لا يمكنك التصويت لنفسك)");
    broadcast(room);

    room.timer = setInterval(() => {
      room.timeLeft--;
      if (room.timeLeft <= 0) finishVoting(room);
      io.to(room.id).emit("tick", room.timeLeft);
    }, 1000);
  }, 2500);
}

function castVote(room, voterId, targetId) {
  if (room.state !== "voting") return;
  if (voterId === targetId) return;
  if (!room.drawings.has(targetId)) return;
  if (room.votes.has(voterId)) return;
  room.votes.set(voterId, targetId);

  const voters = room.players.filter(p => p.connected).length;
  if (room.votes.size >= voters) finishVoting(room);
}

function finishVoting(room) {
  clearTimers(room);
  room.state = "turnEnd";

  const counts = new Map();
  room.votes.forEach(target => counts.set(target, (counts.get(target) || 0) + 1));
  const results = [...room.drawings.keys()].map(id => {
    const p = room.players.find(x => x.id === id);
    const votes = counts.get(id) || 0;
    if (p) p.score += votes * 100;
    return { name: p?.name || "؟", votes, points: votes * 100 };
  }).sort((a, b) => b.votes - a.votes);

  io.to(room.id).emit("voteResults", { word: room.currentWord, results });
  if (results[0] && results[0].votes > 0) {
    sysMsg(room, `أفضل رسمة: ${results[0].name} 🏆 (${results[0].votes} أصوات، +${results[0].points})`, "correct");
  } else {
    sysMsg(room, "لا توجد أصوات هذه الجولة!");
  }
  broadcast(room);

  room.round++;
  setTimeout(() => { if (rooms.has(room.id)) nextVoteRound(room); }, 6000);
}

// ====== نهاية اللعبة والإحصائيات ======
function endGame(room) {
  clearTimers(room);
  room.state = "gameEnd";
  room.drawerId = null;

  const ranking = [...room.players].sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score, team: p.team || null }));

  let teams = null;
  const winnersIds = new Set();

  if (room.settings.mode === "teams") {
    const sum = t => room.players.filter(p => p.team === t).reduce((a, p) => a + p.score, 0);
    teams = { red: sum("red"), blue: sum("blue") };
    const winTeam = teams.red > teams.blue ? "red" : teams.blue > teams.red ? "blue" : null;
    if (winTeam) room.players.forEach(p => { if (p.team === winTeam) winnersIds.add(p.id); });
    sysMsg(room, winTeam
      ? `انتهت اللعبة! فاز ${winTeam === "red" ? "الفريق الأحمر 🔴" : "الفريق الأزرق 🔵"} 🏆`
      : "انتهت اللعبة! تعادل الفريقان 🤝");
  } else {
    const top = ranking[0]?.score || 0;
    room.players.forEach(p => { if (p.score === top && top > 0) winnersIds.add(p.id); });
    sysMsg(room, `انتهت اللعبة! الفائز: ${ranking[0]?.name} 🏆`);
  }

  // تحديث إحصائيات المسجلين (غير متزامن)
  room.players.forEach(p => {
    if (p.isBot || !p.userName) return;
    store.addStats(p.userName, { games: 1, score: p.score, wins: winnersIds.has(p.id) ? 1 : 0 })
      .then(() => store.getUser(p.userName))
      .then(u => { if (u) io.to(p.id).emit("statsUpdate", publicStats(u)); })
      .catch(e => console.error("stats:", e.message));
  });

  io.to(room.id).emit("gameEnd", { ranking, teams });
  broadcast(room);
}

// ====== الشات والتخمين ======
function handleChat(room, player, text) {
  text = String(text || "").trim().slice(0, 100);
  if (!text) return;

  const isDrawer = player.id === room.drawerId;
  const alreadyGuessed = room.guessedIds.has(player.id);

  if (room.state === "drawing" && !isDrawer && !alreadyGuessed) {
    // موقوف مؤقتًا (الرسام منقطع): لا تخمين
    if (room.paused) {
      io.to(player.id).emit("chat", { system: true, cls: "close", text: "⏸️ اللعبة متوقفة — بانتظار رجوع الرسام" });
      return;
    }
    // قفل التخمين: امنع التخمين قبل فتح الوقت
    if (room.guessOpenAt && Date.now() < room.guessOpenAt) {
      const rem = Math.ceil((room.guessOpenAt - Date.now()) / 1000);
      io.to(player.id).emit("chat", { system: true, cls: "close", text: `⏳ التخمين يفتح بعد ${rem} ثانية` });
      return;
    }

    const guess = normalizeArabic(text);
    const answer = normalizeArabic(room.currentWord);

    if (guess === answer) {
      room.guessedIds.add(player.id);
      // نقاط بالترتيب: الأول 10، الثاني 9 ... العاشر فما بعده 1
      const rank = room.guessedIds.size; // ترتيب هذا اللاعب
      const points = Math.max(1, MAX_POINTS + 1 - rank);
      player.score += points;
      io.to(room.id).emit("chat", { system: true, cls: "correct", text: `${player.name} خمّن الكلمة! ✅ (المركز ${rank} • +${points})` });
      io.to(player.id).emit("guessedCorrectly");
      io.to(player.id).emit("guessResult", { ok: true });
      broadcast(room);

      const remaining = room.players.filter(p => p.connected && p.id !== room.drawerId && !room.guessedIds.has(p.id));
      if (remaining.length === 0) endTurn(room, "all");
      return;
    }

    const veryClose = levenshtein(guess, answer) === 1;
    if (veryClose) {
      io.to(player.id).emit("chat", { system: true, cls: "close", text: `"${text}" قريبة جدًا! 🔥` });
    }
    // نتيجة التخمين للمُخمِّن نفسه: يلوّن مربع الدردشة (أحمر خطأ • برتقالي قريبة)
    io.to(player.id).emit("guessResult", { ok: false, close: veryClose });
    io.to(room.id).emit("chat", { name: player.name, text });
    return;
  }

  if (room.state === "drawing" && (isDrawer || alreadyGuessed)) {
    if (normalizeArabic(text).includes(normalizeArabic(room.currentWord))) return;
    room.players.forEach(p => {
      if (p.connected && (p.id === room.drawerId || room.guessedIds.has(p.id))) {
        io.to(p.id).emit("chat", { name: player.name, text, cls: "guessedChat" });
      }
    });
    return;
  }

  io.to(room.id).emit("chat", { name: player.name, text });
}

// ====== الاتصالات ======
io.on("connection", (socket) => {
  let room = null;
  let player = null;

  // الحساب المشترك (كوكي من الصفحة الرئيسية) — لا حاجة لتسجيل دخول داخل اللعبة
  socket.userName = nameFromSocket(socket) || null;

  socket.emit("meta", { categories: ["الكل", ...CATEGORY_NAMES] });

  // ---- الحسابات ----
  socket.on("register", async (data, cb) => {
    if (typeof cb !== "function") return;
    try {
      const name = String(data?.name || "").trim().slice(0, 20);
      const pass = String(data?.pass || "");
      if (name.length < 2) return cb({ ok: false, error: "الاسم قصير جدًا (حرفان على الأقل)" });
      if (pass.length < 4) return cb({ ok: false, error: "كلمة المرور قصيرة (4 أحرف على الأقل)" });
      if (await store.getUser(name)) return cb({ ok: false, error: "الاسم مستخدم، جرب تسجيل الدخول" });
      const salt = crypto.randomBytes(16).toString("hex");
      await store.createUser(name, salt, hashPass(pass, salt));
      if (admin) admin.trackNewUser();
      socket.userName = name;
      cb({ ok: true, stats: { name, wins: 0, games: 0, totalScore: 0 } });
    } catch (e) {
      console.error("register:", e.message);
      cb({ ok: false, error: "خطأ في الخادم، حاول مرة أخرى" });
    }
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
      cb({ ok: true, stats: publicStats(u) });
    } catch (e) {
      console.error("login:", e.message);
      cb({ ok: false, error: "خطأ في الخادم، حاول مرة أخرى" });
    }
  });

  socket.on("leaderboard", async (cb) => {
    if (typeof cb !== "function") return;
    try {
      cb({ ok: true, top: await store.top(10) });
    } catch (e) {
      cb({ ok: true, top: [] });
    }
  });

  // ---- الغرف ----
  socket.on("createRoom", async ({ name }, cb) => {
    if (typeof cb !== "function") return;
    name = socket.userName || String(name || "").trim().slice(0, 20) || "لاعب";
    const id = makeRoomId();
    // كل غرفة جديدة تبدأ من الإعدادات والكلمات الأساسية
    room = {
      id, players: [], state: "lobby", round: 0,
      drawerId: null, ownerId: socket.id, ownerUser: socket.userName || null,
      currentWord: null, wordOptions: [], hint: "",
      guessedIds: new Set(), usedWords: new Set(),
      timeLeft: 0, timer: null, canvasOps: [], botTimers: [],
      settings: { ...DEFAULT_SETTINGS }, customWords: [],
      words: emptyWords(),
      drawings: new Map(), votes: new Map()
    };
    rooms.set(id, room);
    player = { id: socket.id, name, userName: socket.userName || null, score: 0, hasDrawn: false, connected: true };
    room.players.push(player);
    socket.join(id);
    cb({ ok: true, roomId: id, saved: !!room.ownerUser });
    broadcast(room);
    // القائد المسجَّل: نحمّل ملفه (كلماته وإعداداته الخاصة)
    if (room.ownerUser) {
      try {
        const p = await store.getKV(PROFILE_KEY(room.ownerUser));
        if (p && rooms.get(id) === room) {
          if (p.words) room.words = wordsFromJSON(p.words);
          if (p.settings) room.settings = sanitizeSettings(p.settings, DEFAULT_SETTINGS, room);
          broadcast(room);
        }
      } catch (e) { console.error("profile load:", e.message); }
    }
  });

  socket.on("joinRoom", ({ name, roomId }, cb) => {
    if (typeof cb !== "function") return;
    name = socket.userName || String(name || "").trim().slice(0, 20) || "لاعب";
    roomId = String(roomId || "").trim();
    const r = rooms.get(roomId);
    if (!r) return cb({ ok: false, error: "الغرفة غير موجودة، تأكد من الرمز" });
    if (r.players.filter(p => p.connected).length >= MAX_PLAYERS)
      return cb({ ok: false, error: "الغرفة ممتلئة" });
    if (mod.isBanned(r, { name })) return cb({ ok: false, error: "أنت محظور من هذه الغرفة" });

    room = r;
    // إذا كان لاعب منقطع/مطرود بنفس الاسم: استرجع سجله كاملًا (النقاط والتقدم)
    const existing = r.players.find(p => !p.connected && !p.isBot && p.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.connected = true;
      if (socket.userName) existing.userName = socket.userName;
      player = existing;
      sysMsg(room, `${name} رجع للغرفة 🔄 (نقاطه محفوظة: ${existing.score})`, "join");
      // إذا كان الرسام المنقطع ورجع خلال المهلة: يستأنف نفس دوره بنفس الكلمة والرسمة
      if (room.paused && room.pendingDrawer === existing && room.drawerGrace) {
        clearTimeout(room.drawerGrace);
        room.drawerGrace = null;
        room.paused = false;
        room.pendingDrawer = null;
        room.drawerId = existing.id;             // حدّث معرّف الرسام للسوكِت الجديد
        room.timeLeft = room.pausedRemaining;    // استأنف من نفس الوقت المتبقّي
        socket.join(roomId);
        // أعِد الرسمة الحالية للرسام (والباقي رسمتهم لم تتغيّر)
        if (room.canvasOps && room.canvasOps.length) socket.emit("canvasHistory", room.canvasOps);
        if (room.pausedPhase === "drawing") {
          socket.emit("yourWord", { word: room.currentWord });
          sysMsg(room, `✅ ${name} رجع — يكمل الرسم من نفس النقطة!`, "join");
          startDrawCountdown(room);
        } else { // انقطع وهو يختار الكلمة
          socket.emit("chooseWord", { options: room.wordOptions, time: room.pausedRemaining });
          sysMsg(room, `✅ ${name} رجع — يكمل اختيار الكلمة`, "join");
          room.timer = setInterval(() => {
            room.timeLeft--;
            if (room.timeLeft <= 0) chooseWord(room, existing.id, room.wordOptions[0]);
          }, 1000);
        }
        cb({ ok: true, roomId });
        broadcast(room);
        return;
      }
    } else {
      player = { id: socket.id, name, userName: socket.userName || null, score: 0, hasDrawn: false, connected: true };
      room.players.push(player);
      sysMsg(room, `${name} انضم إلى الغرفة 👋`, "join");
    }
    socket.join(roomId);
    cb({ ok: true, roomId });
    if (room.canvasOps.length) socket.emit("canvasHistory", room.canvasOps);
    broadcast(room);
  });

  // ---- الإعدادات (المالك فقط في اللوبي) ----
  socket.on("updateSettings", (s) => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "lobby" && room.state !== "gameEnd") return;
    room.settings = sanitizeSettings(s, room.settings, room);
    persistWords(room);          // تُحفظ للقائد المسجَّل فقط
    broadcast(room);
  });

  socket.on("setCustomWords", (text) => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "lobby" && room.state !== "gameEnd") return;
    const words = String(text || "").split(/[,،\n]+/)
      .map(w => w.trim()).filter(w => w.length >= 2 && w.length <= 30).slice(0, 200);
    room.customWords = [...new Set(words)];
    broadcast(room);
  });

  socket.on("startGame", () => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "lobby" && room.state !== "gameEnd") return;
    const conn = room.players.filter(p => p.connected);
    if (conn.length < 2) return socket.emit("chat", { system: true, text: "تحتاج لاعبين اثنين على الأقل لبدء اللعبة" });
    startGame(room);
  });

  // العودة لغرفة الانتظار/الإعدادات (للقائد بعد نهاية اللعبة)
  socket.on("backToLobby", () => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "gameEnd") return;
    clearTimers(room);
    room.state = "lobby";
    room.drawerId = null;
    room.currentWord = null;
    room.hint = "";
    sysMsg(room, "رجع القائد لغرفة الإعدادات ⚙️");
    broadcast(room);
  });

  // طرد لاعب (للقائد فقط) — المطرود يقدر يرجع بنفس الاسم ويكمل بنقاطه وتقدمه
  socket.on("kickPlayer", (targetId) => {
    if (!room || socket.id !== room.ownerId) return;
    targetId = String(targetId || "");
    if (targetId === socket.id) return; // لا يطرد نفسه
    const target = room.players.find(p => p.id === targetId && p.connected);
    if (!target) return;
    sysMsg(room, `تم إخراج ${target.name} من الغرفة 🚫 (يقدر يرجع ويكمل بنقاطه)`, "leave");
    // نبقي سجله في القائمة (connected=false) حتى يستعيد نقاطه وتقدمه عند الرجوع
    target.connected = false;
    io.to(targetId).emit("kicked");
    // إذا كان الرسام الحالي، انتقل للدور التالي
    if (room.drawerId === targetId && (room.state === "drawing" || room.state === "picking")) {
      clearTimers(room);
      setTimeout(() => { if (rooms.has(room.id)) nextTurn(room); }, 1500);
    }
    // فصل السوكت بعد مهلة قصيرة حتى تصل رسالة "kicked" أولًا
    const sock = io.sockets.sockets.get(targetId);
    if (sock) setTimeout(() => sock.disconnect(true), 400);
    broadcast(room);
  });

  /* نظام الإشراف المشترك — الإخراج هنا «ناعم» ليحتفظ اللاعب بنقاطه عند العودة */
  mod.attach(io, socket, {
    getRoom:   () => room,
    getPlayer: () => (room ? room.players.find(p => p.id === socket.id) : null),
    broadcast, sys: sysMsg,
    remove: (r, t, reason) => {
      t.connected = false;
      io.to(t.id).emit("kicked", { reason });
      if (r.drawerId === t.id && (r.state === "drawing" || r.state === "picking")) {
        clearTimers(r);
        setTimeout(() => { if (rooms.has(r.id)) nextTurn(r); }, 1500);
      }
      const sock = io.sockets.sockets.get(t.id);
      if (sock) setTimeout(() => sock.disconnect(true), 400);
      broadcast(r);
    }
  });

  socket.on("chooseWord", (word) => { if (room) chooseWord(room, socket.id, word); });

  // ---- الرسم ----
  socket.on("draw", (op) => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    if (room.canvasOps.length > 20000) return;
    if (op.start) room.redoStack = []; // أي رسمة جديدة تلغي إمكانية الإعادة
    room.canvasOps.push(op);
    socket.to(room.id).emit("draw", op);
  });

  // نسبة لوحة الرسّام (ارتفاع/عرض): تُبثّ للبقية ليعرضوا الرسمة كاملة
  // بمقياس موحّد — فالرسّام يستفيد من كل شاشته ولا يُقصّ شيء عن أحد
  socket.on("canvasAspect", (a) => {
    if (!room || socket.id !== room.drawerId) return;
    const v = Number(a);
    if (!(v > 0.05 && v < 6)) return;
    if (room.canvasAspect === v) return;
    room.canvasAspect = v;
    socket.to(room.id).emit("canvasAspect", v);
  });

  socket.on("clearCanvas", () => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    // المسح عملية قابلة للتراجع: نحفظ اللوحة كاملة قبل إفراغها
    if (!room.redoStack) room.redoStack = [];
    if (room.canvasOps.length) room.redoStack.push({ cleared: room.canvasOps });
    room.canvasOps = [];
    io.to(room.id).emit("clearCanvas");
  });

  socket.on("undo", () => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    // تراجع عن «مسح الكل»: نعيد اللوحة كما كانت
    const top = room.redoStack && room.redoStack[room.redoStack.length - 1];
    if (!room.canvasOps.length && top && top.cleared) {
      room.canvasOps = room.redoStack.pop().cleared;
      io.to(room.id).emit("canvasHistory", room.canvasOps);
      return;
    }
    let i = room.canvasOps.length - 1;
    while (i >= 0 && !room.canvasOps[i].start) i--;
    if (i >= 0) {
      const removed = room.canvasOps.splice(i); // مجموعة العملية الأخيرة
      if (!room.redoStack) room.redoStack = [];
      room.redoStack.push(removed);
    }
    // حدث واحد فقط = إعادة رسم سلسة بدون وميض
    io.to(room.id).emit("canvasHistory", room.canvasOps);
  });

  socket.on("redo", () => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    if (!room.redoStack || !room.redoStack.length) return;
    const group = room.redoStack.pop();
    if (group && group.cleared) room.canvasOps = [];   // إعادة تنفيذ المسح
    else room.canvasOps.push(...group);
    io.to(room.id).emit("canvasHistory", room.canvasOps);
  });

  // ---- إدارة الكلمات والفئات (للقائد — التعديلات خاصة بهذه الغرفة فقط) ----
  socket.on("wordsList", (cb) => {
    if (typeof cb !== "function" || !room) return;
    cb({
      builtin: CATEGORIES,
      extra: room.words.extra,
      removedWords: [...room.words.removedWords],
      removedCats: [...room.words.removedCats],
      saved: !!room.ownerUser        // هل ستُحفظ التعديلات للمرة القادمة؟
    });
  });

  socket.on("addWord", (data, cb) => {
    if (!room || socket.id !== room.ownerId) return;
    const done = r => typeof cb === "function" && cb(r);
    const W = room.words;
    const word = String(data?.word || "").trim().slice(0, 30);
    const cat = String(data?.cat || "").trim();
    if (word.length < 2) return done({ ok: false, error: "الكلمة قصيرة جدًا" });
    const cats = roomCategories(room);
    if (!cats[cat]) return done({ ok: false, error: "الفئة غير موجودة" });
    // لو كانت الكلمة محذوفة من نفس الفئة الأصلية: استرجاع
    if (W.removedWords.has(word) && (CATEGORIES[cat] || []).includes(word)) {
      W.removedWords.delete(word);
      persistWords(room);
      return done({ ok: true, restored: true });
    }
    if (cats[cat].includes(word)) return done({ ok: false, error: "الكلمة موجودة في هذه الفئة" });
    (W.extra[cat] = W.extra[cat] || []).push(word);
    persistWords(room);
    done({ ok: true });
  });

  socket.on("removeWord", (word) => {
    if (!room || socket.id !== room.ownerId) return;
    const W = room.words;
    word = String(word || "").trim();
    let inExtra = false;
    for (const cat of Object.keys(W.extra)) {
      const i = W.extra[cat].indexOf(word);
      if (i >= 0) { W.extra[cat].splice(i, 1); inExtra = true; }
    }
    if (!inExtra && ALL_WORDS.includes(word)) W.removedWords.add(word);
    persistWords(room);
  });

  socket.on("restoreWord", (word) => {
    if (!room || socket.id !== room.ownerId) return;
    room.words.removedWords.delete(String(word || "").trim());
    persistWords(room);
  });

  socket.on("addCategory", (name, cb) => {
    if (!room || socket.id !== room.ownerId) return;
    const done = r => typeof cb === "function" && cb(r);
    const W = room.words;
    name = String(name || "").trim().slice(0, 20);
    if (name.length < 2) return done({ ok: false, error: "اسم الفئة قصير جدًا" });
    if (name === "الكل") return done({ ok: false, error: "اسم محجوز" });
    if (W.removedCats.has(name)) { W.removedCats.delete(name); persistWords(room); broadcast(room); return done({ ok: true }); }
    if (roomCategories(room)[name]) return done({ ok: false, error: "الفئة موجودة أصلًا" });
    W.extra[name] = W.extra[name] || [];
    persistWords(room);
    broadcast(room);
    done({ ok: true });
  });

  socket.on("removeCategory", (name) => {
    if (!room || socket.id !== room.ownerId) return;
    const W = room.words;
    name = String(name || "").trim();
    if (CATEGORIES[name]) W.removedCats.add(name);
    delete W.extra[name];
    if (room.settings.category === name) room.settings.category = "الكل";
    persistWords(room);
    broadcast(room);
  });

  socket.on("restoreCategory", (name) => {
    if (!room || socket.id !== room.ownerId) return;
    room.words.removedCats.delete(String(name || "").trim());
    persistWords(room);
    broadcast(room);
  });

  // ---- وضع التصويت ----
  socket.on("submitDrawing", (img) => {
    if (!room || room.state !== "collecting") return;
    if (typeof img !== "string" || !img.startsWith("data:image/") || img.length > 500000) return;
    room.drawings.set(socket.id, img);
  });

  socket.on("vote", (targetId) => {
    if (!room) return;
    castVote(room, socket.id, String(targetId || ""));
  });

  // ---- معرض نهاية الجولة ----
  socket.on("turnDrawing", (img) => {
    if (!room || socket.id !== room.drawerId) return;
    if (typeof img !== "string" || !img.startsWith("data:image/") || img.length > 500000) return;
    if (!room.roundDrawings) room.roundDrawings = [];
    room.roundDrawings.push({ name: player?.name || "؟", word: room.currentWord, img });
  });

  // القائد ينهي معرض الجولة وينتقل للدور التالي
  socket.on("endRoundGallery", () => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "roundGallery") return;
    room.galleryDone = true;
    nextTurn(room);
  });

  socket.on("reactDrawing", ({ index, type } = {}) => {
    if (!room || room.state !== "roundGallery" || !room.galleryReacts) return;
    const i = +index;
    if (!room.galleryReacts[i]) return;
    room.galleryVotes = room.galleryVotes || {};
    const key = socket.id + ":" + i;
    if (room.galleryVotes[key]) return; // صوت واحد لكل لاعب لكل رسمة
    room.galleryVotes[key] = true;
    if (type === "dislike") room.galleryReacts[i].dislike++;
    else room.galleryReacts[i].like++;
    io.to(room.id).emit("galleryReacts", room.galleryReacts);
  });

  // ---- الشات ----
  socket.on("chat", (text) => { if (room && player) handleChat(room, player, text); });

  socket.on("disconnect", () => {
    if (!room || !player) return;
    // السجل انتقل لاتصال أحدث (اللاعب رجع قبل اكتمال فصل الاتصال القديم) — لا تلمسه
    if (player.id !== socket.id) return;
    if (!player.connected) return; // مطرود سابقًا وتم التعامل معه
    player.connected = false;
    sysMsg(room, `${player.name} غادر الغرفة`, "leave");

    const humans = room.players.filter(p => p.connected && !p.isBot);
    if (humans.length === 0) {
      clearTimers(room);
      rooms.delete(room.id);
      return;
    }

    if (room.ownerId === socket.id) {
      room.ownerId = humans[0].id;
      sysMsg(room, `${humans[0].name} أصبح مالك الغرفة 👑`);
    }

    if (room.drawerId === socket.id && (room.state === "drawing" || room.state === "picking")) {
      // إيقاف الدور مؤقتًا: نحفظ الكلمة والرسمة والوقت المتبقّي وننتظر الرسام 30 ثانية
      clearTimers(room);
      room.paused = true;
      room.pausedPhase = room.state;  // "drawing" أو "picking"
      room.pausedRemaining = room.timeLeft;
      room.pendingDrawer = player;    // نفس الرسام (لا نغيّر hasDrawn)
      sysMsg(room, `⏸️ ${player.name} انقطع اتصاله! الرجاء الانتظار 30 ثانية ليكمل دوره...`, "leave");
      broadcast(room); // يُظهر حالة الإيقاف للجميع
      room.drawerGrace = setTimeout(() => {
        room.drawerGrace = null;
        room.paused = false;
        room.pendingDrawer = null;
        if (rooms.has(room.id)) {
          sysMsg(room, `${player.name} ما رجع — ننتقل للدور التالي`);
          nextTurn(room); // الرسام يبقى hasDrawn=true فينتقل للاعب التالي
        }
      }, 30000);
    }

    broadcast(room);
  });
});

createStore()
  .then(async s => {
    store = s;
    // تعديلات الكلمات صارت لكل غرفة على حدة (وتُحفظ للاعب المسجَّل باسمه)،
    // فلم تعد تُحمَّل قائمة عامة عند الإقلاع.
    console.log("📚 قائمة الكلمات الأساسية: " + ALL_WORDS.length + " كلمة في " + CATEGORY_NAMES.length + " فئة");
    // تفعيل لوحة المراقبة
    admin = setupAdmin(app, { getLiveStats, store });
    // 💣 تفعيل لعبة القنبلة (namespace مستقل /bomb)
    try {
      bombApi = setupBomb(io, { store, hashPass, publicStats, getAdmin: () => admin });
      require("./wadmin").setupWordAdmin(app, { getBank: () => bombApi && bombApi.wordBank });
      console.log("💣 لعبة القنبلة جاهزة على /bomb");
    } catch (e) {
      console.error("bomb setup:", e.message);
    }
    // 🏆 تفعيل لعبة قمّة الهرم (namespace مستقل /quiz)
    try {
      const qbank = require("./qbank");
      const saved = await store.getKV("quizBank");
      if (saved) { qbank.setExtra(saved.extra || {}); qbank.setRemoved(saved.removed || []); }
      require("./qadmin").setupQuestionAdmin(app, { store });
      // 🎙️ أصوات المعلّق: استماع/تعطيل/رفع من الأدمن (<ADMIN_PATH>/vo)
      try { require("./voadmin").setupVoiceOverAdmin(app, { store }); }
      catch (e) { console.error("voadmin setup:", e.message); }
      // 🔊 صوت قراءة الأسئلة (ElevenLabs) — يُخزَّن مرة واحدة ويُقدَّم من /tts/<id>
      try {
        ttsApi = require("./tts").setupTts(app, { store });
        require("./vadmin").setupVoiceAdmin(app, { tts: ttsApi });
        console.log("🔊 صوت الأسئلة: " + (ttsApi.hasKey() ? "المفتاح مضبوط" : "بانتظار ELEVEN_KEY"));
      } catch (e) {
        console.error("tts setup:", e.message);
      }
      quizApi = setupQuiz(io, { store, hashPass, publicStats, getAdmin: () => admin, tts: () => ttsApi });
      console.log(`🏆 قمّة الهرم جاهزة على /quiz — ${qbank.countAll()} سؤال`);
    } catch (e) {
      console.error("quiz setup:", e.message);
    }
    // 🕵️ تفعيل «برّا السالفة» (namespace مستقل /salfa)
    try {
      const sw = require("./salfa-words");
      salfaApi = setupSalfa(io, { store, hashPass, publicStats, getAdmin: () => admin });
      const st = sw.stats();
      console.log(`🕵️ برّا السالفة جاهزة على /barra — ${st.words} كلمة في ${st.packs} تصنيفاً`);
    } catch (e) {
      console.error("salfa setup:", e.message);
    }
    /* ترحيلٌ لمرّةٍ واحدة: إحصاءات الألعاب من مخازن الأسماء القديمة إلى
       جدولٍ بمعرّفات الحسابات. لا يمنع الإقلاع إن تعثّر. */
    try { await require("./statsmigrate").migrateGameStats(store); }
    catch (e) { console.error("stats migrate:", e.message); }

    /* بذر المتجر من كتالوجات الألعاب: يُحدِّث الأسماء والأسعار عند كل إقلاع
       فلا يفترق المعروض عمّا في اللعبة، ولا يمسّ ما أخفته الإدارة. */
    try { await require("./shopseed").seedShop(store); }
    catch (e) { console.error("shop seed:", e.message); }

    /* الإعدادات الحيّة إلى الذاكرة قبل أن يلعب أحد. لو تعذّرت القراءة بقيت
       القيم الافتراضيّة — الموقع يعمل، ولا يقف بسبب جدولِ إعدادات. */
    try {
      await require("./settings").load(store);
      /* والبذر أعاد للتوّ أسعار الملفّ، فنُعيد فوقها ما سعّرته اللوحة —
         وإلا ضاع كل تسعيرٍ إداريّ مع كل نشرة. */
      await require("./padmin").applyPriceOverrides(store);
      require("./padmin").setupPanel(app, { store, currentUser: accounts.currentUser });
    } catch (e) { console.error("settings/panel:", e.message); }

    /* بلاغات الإشراف: كانت تُجمَع في الذاكرة ولا يقرؤها أحد ولا تنجو من
       إعادة تشغيل. نُحمّلها ونحفظها بتأخيرٍ قصير — البلاغ نادر، والحفظ
       الفوريّ مع كل واحدٍ إسرافٌ بلا فائدة. */
    try {
      mod.loadReports(await store.getKV("modReports"));
      let t = null;
      mod.setSink(list => {
        clearTimeout(t);
        t = setTimeout(() => store.saveKV("modReports", list).catch(() => {}), 800);
      });
    } catch (e) { console.error("mod reports:", e.message); }

    /* اونو أونلاين: القواعد في unorules.js والغرف هنا */
    let unoApi = null;
    try { unoApi = require("./unosrv").setupUnoOnline(io, { store }); }
    catch (e) { console.error("uno online:", e.message); }

    /* بالوت أونلاين: القواعد في balootrules.js والطاولات هنا */
    let balootApi = null;
    try { balootApi = require("./balootsrv").setupBalootOnline(io, { store }); }
    catch (e) { console.error("baloot online:", e.message); }

    /* هويّة موحّدة لكل مساحات الأسماء: تُحلّ الجلسة قبل أن يصل الاتصال إلى
       منطق أي لعبة، فتعرف اللعبةُ صاحبَها بلا أن تسأل عن كوكي. تُركَّب بعد
       إنشاء المساحات كلّها وقبل الاستماع، فلا اتصالَ يسبقها. */
    attachSocketAuth(io, store, ["/", "/bomb", "/quiz", "/salfa", "/uno", "/baloot"]);

    server.listen(PORT, () => {
      console.log(`🎨 لعبة ارسمها! تعمل على المنفذ ${PORT}`);
    });
  })
  .catch(e => {
    console.error("فشل الاتصال بقاعدة البيانات:", e.message);
    process.exit(1);
  });
