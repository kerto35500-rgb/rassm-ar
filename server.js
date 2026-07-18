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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e6 });

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
// تتبع الزيارات (طلب صفحة اللعبة الرئيسية)
app.get("/", (req, res) => {
  if (admin) admin.trackVisit();
  res.sendFile(indexFile);
});
if (fs.existsSync(path.join(pubDir, "index.html"))) app.use(express.static(pubDir));

const PORT = process.env.PORT || 3000;

// ====== إعدادات عامة ======
const PICK_TIME = 15;
const WORD_CHOICES = 3;
const MAX_PLAYERS = 12;
const VOTE_TIME = 25;

const CATEGORY_NAMES = Object.keys(CATEGORIES);
const ALL_WORDS = CATEGORY_NAMES.flatMap(c => CATEGORIES[c]);

const DEFAULT_SETTINGS = { rounds: 3, turnTime: 80, category: "الكل", mode: "classic" };

const rooms = new Map();

// ====== قاعدة البيانات (عبر store.js) ======
let store = null; // تُهيأ قبل تشغيل السيرفر في الأسفل
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString("hex"); }
function publicStats(u) { return { name: u.name, wins: u.wins, games: u.games, totalScore: u.totalScore }; }

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
// تعديلات الكلمات عامة ودائمة (تُحفظ في قاعدة البيانات وتظهر لكل الغرف)
let GW = { extra: {}, removedWords: new Set(), removedCats: new Set() };
let wordsSaveTimer = null;
function persistWords() {
  clearTimeout(wordsSaveTimer);
  wordsSaveTimer = setTimeout(() => {
    store.saveWords({
      extra: GW.extra,
      removedWords: [...GW.removedWords],
      removedCats: [...GW.removedCats]
    }).catch(e => console.error("words save:", e.message));
  }, 500);
}
function broadcastAll() { rooms.forEach(r => broadcast(r)); }

// الفئات الفعلية: الأصلية (بدون المحذوف) + المضافة
function roomCategories() {
  const out = {};
  for (const [name, words] of Object.entries(CATEGORIES)) {
    if (GW.removedCats.has(name)) continue;
    out[name] = [...words.filter(w => !GW.removedWords.has(w)), ...(GW.extra[name] || [])];
  }
  for (const [name, words] of Object.entries(GW.extra)) {
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
    mode: ["classic", "teams", "vote"].includes(s.mode) ? s.mode : old.mode
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
    hint: room.hint,
    timeLeft: room.timeLeft
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

// ====== الوضع الكلاسيكي / الفرق ======
function nextTurn(room) {
  clearTimers(room);
  room.guessedIds = new Set();
  room.currentWord = null;
  room.hint = "";
  room.canvasOps = [];

  const connected = room.players.filter(p => p.connected);
  if (connected.length < 2) {
    room.state = "lobby";
    sysMsg(room, "عدد اللاعبين غير كافٍ، بانتظار انضمام لاعبين...");
    broadcast(room);
    return;
  }

  let next = connected.find(p => !p.hasDrawn);
  if (!next) {
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

  io.to(playerId).emit("yourWord", { word });
  io.to(room.id).emit("clearCanvas");
  sysMsg(room, "بدأ الرسم! خمنوا الكلمة ✏️");
  broadcast(room);

  const revealTimes = [Math.floor(T * 0.5), Math.floor(T * 0.25)];

  room.timer = setInterval(() => {
    room.timeLeft--;

    if (revealTimes.includes(room.timeLeft)) {
      const letters = word.split("");
      const hidden = letters.map((c, i) => (c !== " " && !room.revealedIdx.has(i) ? i : -1)).filter(i => i >= 0);
      if (hidden.length > 1) {
        room.revealedIdx.add(hidden[Math.floor(Math.random() * hidden.length)]);
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

  const drawer = room.players.find(p => p.id === room.drawerId);
  const guessers = room.guessedIds.size;
  if (drawer && guessers > 0) drawer.score += 25 + guessers * 25;

  const word = room.currentWord;
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
    const guess = normalizeArabic(text);
    const answer = normalizeArabic(room.currentWord);

    if (guess === answer) {
      room.guessedIds.add(player.id);
      const points = Math.max(50, Math.round(200 * (room.timeLeft / room.settings.turnTime)) + 50);
      player.score += points;
      io.to(room.id).emit("chat", { system: true, cls: "correct", text: `${player.name} خمّن الكلمة! ✅ (+${points})` });
      io.to(player.id).emit("guessedCorrectly");
      broadcast(room);

      const remaining = room.players.filter(p => p.connected && p.id !== room.drawerId && !room.guessedIds.has(p.id));
      if (remaining.length === 0) endTurn(room, "all");
      return;
    }

    if (levenshtein(guess, answer) === 1) {
      io.to(player.id).emit("chat", { system: true, cls: "close", text: `"${text}" قريبة جدًا! 🔥` });
    }
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
  socket.on("createRoom", ({ name }, cb) => {
    if (typeof cb !== "function") return;
    name = socket.userName || String(name || "").trim().slice(0, 20) || "لاعب";
    const id = makeRoomId();
    room = {
      id, players: [], state: "lobby", round: 0,
      drawerId: null, ownerId: socket.id,
      currentWord: null, wordOptions: [], hint: "",
      guessedIds: new Set(), usedWords: new Set(),
      timeLeft: 0, timer: null, canvasOps: [], botTimers: [],
      settings: { ...DEFAULT_SETTINGS }, customWords: [],
      drawings: new Map(), votes: new Map()
    };
    rooms.set(id, room);
    player = { id: socket.id, name, userName: socket.userName || null, score: 0, hasDrawn: false, connected: true };
    room.players.push(player);
    socket.join(id);
    cb({ ok: true, roomId: id });
    broadcast(room);
  });

  socket.on("joinRoom", ({ name, roomId }, cb) => {
    if (typeof cb !== "function") return;
    name = socket.userName || String(name || "").trim().slice(0, 20) || "لاعب";
    roomId = String(roomId || "").trim();
    const r = rooms.get(roomId);
    if (!r) return cb({ ok: false, error: "الغرفة غير موجودة، تأكد من الرمز" });
    if (r.players.filter(p => p.connected).length >= MAX_PLAYERS)
      return cb({ ok: false, error: "الغرفة ممتلئة" });

    room = r;
    player = { id: socket.id, name, userName: socket.userName || null, score: 0, hasDrawn: false, connected: true };
    room.players.push(player);
    socket.join(roomId);
    cb({ ok: true, roomId });
    sysMsg(room, `${name} انضم إلى الغرفة 👋`, "join");
    if (room.canvasOps.length) socket.emit("canvasHistory", room.canvasOps);
    broadcast(room);
  });

  // ---- الإعدادات (المالك فقط في اللوبي) ----
  socket.on("updateSettings", (s) => {
    if (!room || socket.id !== room.ownerId) return;
    if (room.state !== "lobby" && room.state !== "gameEnd") return;
    room.settings = sanitizeSettings(s, room.settings, room);
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

  socket.on("chooseWord", (word) => { if (room) chooseWord(room, socket.id, word); });

  // ---- الرسم ----
  socket.on("draw", (op) => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    if (room.canvasOps.length > 20000) return;
    room.canvasOps.push(op);
    socket.to(room.id).emit("draw", op);
  });

  socket.on("clearCanvas", () => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    room.canvasOps = [];
    io.to(room.id).emit("clearCanvas");
  });

  socket.on("undo", () => {
    if (!room || room.state !== "drawing" || socket.id !== room.drawerId) return;
    let i = room.canvasOps.length - 1;
    while (i >= 0 && !room.canvasOps[i].start) i--;
    if (i >= 0) room.canvasOps.splice(i);
    // حدث واحد فقط = إعادة رسم سلسة بدون وميض
    io.to(room.id).emit("canvasHistory", room.canvasOps);
  });

  // ---- إدارة الكلمات والفئات (للقائد - التعديلات دائمة وعامة) ----
  socket.on("wordsList", (cb) => {
    if (typeof cb !== "function" || !room) return;
    cb({
      builtin: CATEGORIES,
      extra: GW.extra,
      removedWords: [...GW.removedWords],
      removedCats: [...GW.removedCats]
    });
  });

  socket.on("addWord", (data, cb) => {
    if (!room || socket.id !== room.ownerId) return;
    const done = r => typeof cb === "function" && cb(r);
    const word = String(data?.word || "").trim().slice(0, 30);
    const cat = String(data?.cat || "").trim();
    if (word.length < 2) return done({ ok: false, error: "الكلمة قصيرة جدًا" });
    const cats = roomCategories();
    if (!cats[cat]) return done({ ok: false, error: "الفئة غير موجودة" });
    // لو كانت الكلمة محذوفة من نفس الفئة الأصلية: استرجاع
    if (GW.removedWords.has(word) && (CATEGORIES[cat] || []).includes(word)) {
      GW.removedWords.delete(word);
      persistWords();
      return done({ ok: true, restored: true });
    }
    if (cats[cat].includes(word)) return done({ ok: false, error: "الكلمة موجودة في هذه الفئة" });
    (GW.extra[cat] = GW.extra[cat] || []).push(word);
    persistWords();
    done({ ok: true });
  });

  socket.on("removeWord", (word) => {
    if (!room || socket.id !== room.ownerId) return;
    word = String(word || "").trim();
    let inExtra = false;
    for (const cat of Object.keys(GW.extra)) {
      const i = GW.extra[cat].indexOf(word);
      if (i >= 0) { GW.extra[cat].splice(i, 1); inExtra = true; }
    }
    if (!inExtra && ALL_WORDS.includes(word)) GW.removedWords.add(word);
    persistWords();
  });

  socket.on("restoreWord", (word) => {
    if (!room || socket.id !== room.ownerId) return;
    GW.removedWords.delete(String(word || "").trim());
    persistWords();
  });

  socket.on("addCategory", (name, cb) => {
    if (!room || socket.id !== room.ownerId) return;
    const done = r => typeof cb === "function" && cb(r);
    name = String(name || "").trim().slice(0, 20);
    if (name.length < 2) return done({ ok: false, error: "اسم الفئة قصير جدًا" });
    if (name === "الكل") return done({ ok: false, error: "اسم محجوز" });
    if (GW.removedCats.has(name)) { GW.removedCats.delete(name); persistWords(); broadcastAll(); return done({ ok: true }); }
    if (roomCategories()[name]) return done({ ok: false, error: "الفئة موجودة أصلًا" });
    GW.extra[name] = GW.extra[name] || [];
    persistWords();
    broadcastAll();
    done({ ok: true });
  });

  socket.on("removeCategory", (name) => {
    if (!room || socket.id !== room.ownerId) return;
    name = String(name || "").trim();
    if (CATEGORIES[name]) GW.removedCats.add(name);
    delete GW.extra[name];
    rooms.forEach(r => { if (r.settings.category === name) r.settings.category = "الكل"; });
    persistWords();
    broadcastAll();
  });

  socket.on("restoreCategory", (name) => {
    if (!room || socket.id !== room.ownerId) return;
    GW.removedCats.delete(String(name || "").trim());
    persistWords();
    broadcastAll();
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

  // ---- الشات ----
  socket.on("chat", (text) => { if (room && player) handleChat(room, player, text); });

  socket.on("disconnect", () => {
    if (!room || !player) return;
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
      sysMsg(room, "الرسام غادر! ننتقل للدور التالي...");
      clearTimers(room);
      setTimeout(() => { if (rooms.has(room.id)) nextTurn(room); }, 2000);
    }

    broadcast(room);
  });
});

createStore()
  .then(async s => {
    store = s;
    // تحميل تعديلات الكلمات المحفوظة
    try {
      const w = await store.getWords();
      if (w) {
        GW = {
          extra: w.extra || {},
          removedWords: new Set(w.removedWords || []),
          removedCats: new Set(w.removedCats || [])
        };
        const extraCount = Object.values(GW.extra).flat().length;
        console.log(`📚 كلمات مخصصة محفوظة: ${extraCount} كلمة، ${Object.keys(GW.extra).length} فئة`);
      }
    } catch (e) { console.error("words load:", e.message); }
    // تفعيل لوحة المراقبة
    admin = setupAdmin(app, { getLiveStats, store });
    server.listen(PORT, () => {
      console.log(`🎨 لعبة ارسمها! تعمل على المنفذ ${PORT}`);
    });
  })
  .catch(e => {
    console.error("فشل الاتصال بقاعدة البيانات:", e.message);
    process.exit(1);
  });
