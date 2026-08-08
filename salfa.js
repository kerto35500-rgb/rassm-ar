// 🕵️ «برّا السالفة» — منطق مستقل تماماً على namespace "/salfa"
// الخادم هو الحكم: كلمة السر لا تُبثّ للغرفة أبداً، بل تُرسل لكل socket دوره فقط.
const crypto = require("crypto");
const words = require("./salfa-words");
const { nameFromSocket } = require("./account");

const RECONNECT_MS = 120000;   // مهلة العودة بعد انقطاع الاتصال
const CHAT_MAX = 200;
const REVEAL_MS = 12000;       // مهلة مرحلة كشف الأدوار (قابلة للتخطي بالجاهزية)
const GUESS_MS = 30000;        // مهلة فرصة تخمين برّا السالفة
const RESULT_MS = 15000;       // مدة عرض النتائج قبل السماح بجولة جديدة

const DEFAULTS = {
  flow: "timer",        // timer = وقت مفتوح للنقاش | circle = دورة كاملة (كل لاعب يسأل ويُسأل)
  roundTime: 300,       // ثواني النقاش (٦٠–٩٠٠) — في نمط الدورة: مهلة السؤال الواحد
  askTime: 60,          // ثواني السؤال الواحد في نمط الدورة
  spies: 1,             // عدد الخارجين عن السالفة (1–3)
  autoSpies: true,      // زيادة تلقائية لجاسوس ثانٍ عند ٧ لاعبين أو أكثر
  scoreLimit: 10,       // النقاط التي تنتهي عندها اللعبة
  firstPlayer: "random",// random = النظام يختار | host = المضيف يختار
  emergency: true,      // زر الاتهام الطارئ
  packs: [],            // التصنيفات المفعّلة (فارغ = الكل)
  customWords: [],      // حزمة المضيف الخاصة
  maxPlayers: 12,       // 3–16
  visibility: "private",
  password: ""
};

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function sanitize(s = {}, old = DEFAULTS) {
  const o = { ...old };
  if (s.flow !== undefined) o.flow = (s.flow === "circle" ? "circle" : "timer");
  if (s.roundTime !== undefined) o.roundTime = clampInt(s.roundTime, 60, 900, old.roundTime);
  if (s.askTime !== undefined) o.askTime = clampInt(s.askTime, 15, 180, old.askTime);
  if (s.spies !== undefined) o.spies = clampInt(s.spies, 1, 3, old.spies);
  if (s.autoSpies !== undefined) o.autoSpies = !!s.autoSpies;
  if (s.scoreLimit !== undefined) o.scoreLimit = clampInt(s.scoreLimit, 3, 50, old.scoreLimit);
  if (s.firstPlayer !== undefined) o.firstPlayer = (s.firstPlayer === "host" ? "host" : "random");
  if (s.emergency !== undefined) o.emergency = !!s.emergency;
  if (s.packs !== undefined) {
    o.packs = Array.isArray(s.packs) ? s.packs.filter(n => words.PACKS[n]).slice(0, 40) : [];
  }
  if (s.customWords !== undefined) {
    o.customWords = Array.isArray(s.customWords)
      ? s.customWords.map(w => String(w || "").trim().slice(0, 40)).filter(Boolean).slice(0, 200)
      : [];
  }
  if (s.maxPlayers !== undefined) o.maxPlayers = clampInt(s.maxPlayers, 3, 16, old.maxPlayers);
  if (s.visibility !== undefined) o.visibility = (s.visibility === "public" ? "public" : "private");
  if (s.password !== undefined) o.password = String(s.password || "").slice(0, 24);
  return o;
}

// عدد الجواسيس الفعلي: يحترم إعداد المضيف ويضمن بقاء عارفَين على الأقل
function spyCount(room) {
  const n = playing(room).length;
  let k = room.settings.spies;
  if (room.settings.autoSpies && n >= 7 && k < 2) k = 2;
  return Math.max(1, Math.min(k, Math.max(1, n - 2)));
}

const playing = (room) => room.players.filter(p => p.connected && !p.spectator);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function normalize(text) {
  return String(text || "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").toLowerCase();
}

function setupSalfa(io, deps) {
  const { store, hashPass, publicStats, getAdmin } = deps;
  const nsp = io.of("/salfa");
  const rooms = new Map();

  // ====== أدوات ======
  function makeRoomId() {
    let id;
    do { id = String(Math.floor(10000 + Math.random() * 90000)); } while (rooms.has(id));
    return id;
  }

  function liveStats() {
    let online = 0;
    const list = [];
    rooms.forEach(r => {
      const conn = r.players.filter(p => p.connected);
      online += conn.length;
      if (conn.length) list.push({ id: r.id, state: r.state, players: conn.length });
    });
    return { online, rooms: list };
  }

  function publicRooms() {
    const out = [];
    rooms.forEach(r => {
      if (r.settings.visibility !== "public") return;
      const conn = r.players.filter(p => p.connected).length;
      if (!conn) return;
      out.push({
        id: r.id, players: conn, max: r.settings.maxPlayers, state: r.state,
        locked: !!r.settings.password,
        owner: r.players.find(p => p.id === r.ownerId)?.name || "—"
      });
    });
    return out.sort((a, b) => b.players - a.players).slice(0, 30);
  }

  function playerView(room, p) {
    return {
      id: p.id, name: p.name, avatar: p.avatar, score: p.score,
      connected: p.connected, spectator: p.spectator,
      ready: !!p.ready,
      asked: !!p.asked, answered: !!p.answered,
      voted: room.state === "voting" ? !!room.votes[p.id] : false,
      registered: !!p.userName
    };
  }

  // الحالة العامة — بلا أي أثر لكلمة السر أو هوية الجاسوس قبل الكشف
  function state(room) {
    const cur = room.players.find(p => p.id === room.turnId);
    const tgt = room.players.find(p => p.id === room.targetId);
    return {
      id: room.id,
      state: room.state,
      ownerId: room.ownerId,
      settings: room.settings,
      players: room.players.map(p => playerView(room, p)),
      packNames: words.PACK_NAMES,
      category: room.category,          // التصنيف معروف للجميع (وللجاسوس أيضاً)
      roundNo: room.roundNo,
      endsAt: room.endsAt,
      serverNow: Date.now(),
      turnId: room.turnId || null,
      targetId: room.targetId || null,
      askerPickPending: !!room.askerPickPending,
      emergency: room.emergency && {
        byId: room.emergency.byId, byName: room.emergency.byName,
        yes: room.emergency.yes.length, need: room.emergency.need,
        endsAt: room.emergency.endsAt
      },
      votesCount: Object.keys(room.votes || {}).length,
      votesNeed: room.state === "voting" ? playing(room).length : 0,
      result: room.result,               // يُملأ في مرحلة النتائج فقط
      winner: room.winner
    };
  }

  function broadcast(room) { nsp.to(room.id).emit("state", state(room)); }
  function sys(room, text, cls = "system") { nsp.to(room.id).emit("chat", { system: true, cls, text }); }

  // الدور السرّي: رسالة خاصة لكل لاعب على حدة
  function sendRoles(room) {
    room.players.forEach(p => {
      if (!p.connected) return;
      const spy = room.spyIds.includes(p.id);
      nsp.to(p.id).emit("role", {
        spy,
        category: room.category,
        word: spy ? null : room.word,          // الجاسوس لا يستلم الكلمة إطلاقاً
        spies: room.spyIds.length,
        roundNo: room.roundNo
      });
    });
  }

  function clearTimers(room) {
    clearTimeout(room.phaseTimer); room.phaseTimer = null;
    clearInterval(room.tickTimer); room.tickTimer = null;
    clearTimeout(room.emgTimer); room.emgTimer = null;
  }

  function setPhase(room, phase, seconds, done) {
    clearTimers(room);
    room.state = phase;
    room.endsAt = seconds ? Date.now() + seconds * 1000 : 0;
    broadcast(room);
    if (!seconds) return;
    room.phaseTimer = setTimeout(() => { if (rooms.has(room.id)) done && done(); }, seconds * 1000);
    room.tickTimer = setInterval(() => {
      if (!rooms.has(room.id)) return clearInterval(room.tickTimer);
      const left = Math.max(0, Math.round((room.endsAt - Date.now()) / 1000));
      nsp.to(room.id).emit("tick", left);
    }, 1000);
  }

  // ====== دورة اللعبة ======
  function startRound(room) {
    const list = playing(room);
    if (list.length < 3) {
      room.state = "lobby";
      sys(room, "نحتاج ٣ لاعبين على الأقل لبدء الجولة", "warn");
      return broadcast(room);
    }
    clearTimers(room);
    room.roundNo++;
    room.votes = {};
    room.result = null;
    room.emergency = null;
    room.winner = null;
    room.spyGuess = null;
    room.players.forEach(p => { p.asked = false; p.answered = false; p.ready = false; });

    // كلمة السر: من حزمة المضيف إن كانت كافية، وإلا من التصنيفات المفعّلة
    if (room.settings.customWords.length >= 3) {
      const w = room.settings.customWords[Math.floor(Math.random() * room.settings.customWords.length)];
      room.category = "حزمة المضيف";
      room.word = w;
    } else {
      const pool = words.poolFrom(room.settings.packs);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      room.category = pick.cat;
      room.word = pick.word;
    }

    // توزيع الأدوار
    const ids = shuffle(list.map(p => p.id));
    room.spyIds = ids.slice(0, spyCount(room));

    // من يبدأ السؤال
    if (room.settings.firstPlayer === "host" && room.players.some(p => p.id === room.ownerId && p.connected)) {
      room.turnId = room.ownerId;
    } else {
      room.turnId = ids[Math.floor(Math.random() * ids.length)];
    }
    room.targetId = null;
    room.askerPickPending = true;
    room.lastAskerId = null;

    sendRoles(room);
    sys(room, `الجولة ${room.roundNo} — التصنيف: ${room.category}`, "good");
    setPhase(room, "reveal", Math.round(REVEAL_MS / 1000), () => beginTalk(room));
  }

  function beginTalk(room) {
    room.players.forEach(p => { p.ready = false; });
    if (room.settings.flow === "circle") {
      setPhase(room, "talking", room.settings.askTime, () => passTurn(room, true));
    } else {
      setPhase(room, "talking", room.settings.roundTime, () => beginVoting(room));
    }
    sys(room, room.settings.flow === "circle"
      ? "ابدؤوا! كل لاعب يسأل لاعباً آخر — تنتهي الجولة عند اكتمال الدائرة"
      : "ابدؤوا النقاش! التصويت يفتح عند انتهاء الوقت");
  }

  // نمط الدورة: تمرير السؤال. المجيب يصير هو السائل ولا يسأل من سأله.
  function passTurn(room, timedOut) {
    const list = playing(room);
    const asker = room.players.find(p => p.id === room.turnId);
    const target = room.players.find(p => p.id === room.targetId);
    if (asker) asker.asked = true;
    if (target) target.answered = true;

    // اكتملت الدائرة؟ (كل لاعب سأل وأجاب)
    if (list.every(p => p.asked) && list.every(p => p.answered)) {
      sys(room, "اكتملت الدائرة — وقت التصويت 🗳️", "good");
      return beginVoting(room);
    }
    // التالي: المجيب يسأل، وإلا أول من لم يسأل بعد
    let next = target && target.connected ? target : list.find(p => !p.asked);
    if (!next) return beginVoting(room);
    room.lastAskerId = room.turnId;
    room.turnId = next.id;
    room.targetId = null;
    room.askerPickPending = true;
    if (timedOut) sys(room, "انتهى وقت السؤال — الدور التالي", "warn");
    setPhase(room, "talking", room.settings.askTime, () => passTurn(room, true));
  }

  function beginVoting(room) {
    room.votes = {};
    room.askerPickPending = false;
    room.emergency = null;
    setPhase(room, "voting", 60, () => tallyVotes(room));
    sys(room, "صوّتوا على من تعتقدون أنه برّا السالفة 🗳️");
  }

  function tallyVotes(room) {
    clearTimers(room);
    const list = playing(room);
    const counts = {};
    Object.values(room.votes).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    let top = null, topN = 0, tie = false;
    Object.entries(counts).forEach(([id, n]) => {
      if (n > topN) { top = id; topN = n; tie = false; }
      else if (n === topN) tie = true;
    });
    const majority = Math.floor(list.length / 2) + 1;
    const caught = !tie && top && topN >= majority && room.spyIds.includes(top);

    room.result = {
      votes: { ...room.votes },                         // من صوّت لمن (تُكشف الآن)
      counts, top, topN, tie, majority,
      spyIds: [...room.spyIds],
      spyNames: room.spyIds.map(id => room.players.find(p => p.id === id)?.name || "—"),
      word: room.word, category: room.category,
      caught, phase: "votes", gains: {}
    };

    if (caught) {
      // كُشف الجاسوس → فرصة أخيرة ليخمن الكلمة ويسرق الفوز
      room.result.phase = "spyGuess";
      room.caughtSpyId = top;
      broadcast(room);
      setPhase(room, "spyGuess", Math.round(GUESS_MS / 1000), () => finishRound(room, false));
      nsp.to(top).emit("yourGuess", { category: room.category, seconds: Math.round(GUESS_MS / 1000) });
      sys(room, "تم كشف برّا السالفة! أمامه فرصة أخيرة لتخمين الكلمة 😈", "warn");
    } else {
      finishRound(room, false);
    }
  }

  /* توزيع النقاط:
     • نجا الجاسوس (صوّتوا على بريء أو تعادل) ⇒ نقطتان لكل جاسوس.
     • كُشف الجاسوس وخمّن الكلمة ⇒ يسرق الفوز: نقطتان له.
     • كُشف وفشل ⇒ نقطة واحدة لكل من صوّت عليه صح.
     • مكافأة المبادر: من ضغط «اتهام طارئ» وأدّى لكشف الجاسوس ⇒ نقطة إضافية. */
  function finishRound(room, stolen) {
    clearTimers(room);
    const r = room.result;
    if (!r) return;
    const gains = {};
    const add = (id, n) => { gains[id] = (gains[id] || 0) + n; };

    if (!r.caught) {
      room.spyIds.forEach(id => add(id, 2));
      r.outcome = "spyEscaped";
    } else if (stolen) {
      add(room.caughtSpyId, 2);
      r.outcome = "spyStole";
    } else {
      Object.entries(r.votes).forEach(([voter, target]) => {
        if (room.spyIds.includes(target)) add(voter, 1);
      });
      if (room.emergencyStarterId && r.caught) add(room.emergencyStarterId, 1);
      r.outcome = "insidersWin";
    }

    Object.entries(gains).forEach(([id, n]) => {
      const p = room.players.find(x => x.id === id);
      if (p) p.score += n;
    });
    r.gains = gains;
    r.stolen = !!stolen;
    r.spyGuess = room.spyGuess;
    r.phase = "done";
    room.emergencyStarterId = null;

    // نهاية اللعبة؟
    const champ = room.players.filter(p => p.connected).sort((a, b) => b.score - a.score)[0];
    if (champ && champ.score >= room.settings.scoreLimit) {
      room.winner = { id: champ.id, name: champ.name, score: champ.score };
      setPhase(room, "gameEnd", 0, null);
      saveStats(room, champ);
      sys(room, `🏆 ${champ.name} فاز باللعبة بـ ${champ.score} نقطة!`, "good");
    } else {
      setPhase(room, "result", Math.round(RESULT_MS / 1000), () => {
        if (room.state === "result") { room.state = "lobby"; broadcast(room); }
      });
    }
  }

  async function saveStats(room, champ) {
    try {
      const key = "salfaStats";
      const s = (await store.getKV(key)) || {};
      room.players.forEach(p => {
        if (!p.userName) return;
        const e = s[p.userName] || { games: 0, wins: 0, points: 0 };
        e.games++; e.points += p.score;
        if (champ && champ.id === p.id) e.wins++;
        s[p.userName] = e;
      });
      await store.saveKV(key, s);
    } catch (e) { /* لا يعطّل اللعبة */ }
  }

  // ====== الاتصالات ======
  nsp.on("connection", (socket) => {
    let room = null;
    let player = null;

    socket.userName = nameFromSocket(socket) || null;
    socket.emit("hello", {
      defaults: DEFAULTS,
      packs: words.PACK_NAMES,
      stats: words.stats(),
      you: socket.userName
    });

    function leaveRoom(hard) {
      if (!room || !player) return;
      const r = room, p = player;
      if (hard) r.players = r.players.filter(x => x.id !== p.id);
      else { p.connected = false; p.disconnectedAt = Date.now(); }
      socket.leave(r.id);
      if (r.ownerId === p.id) {
        const nxt = r.players.find(x => x.connected);
        if (nxt) { r.ownerId = nxt.id; sys(r, `👑 ${nxt.name} صار مدير الغرفة`); }
      }
      // إن كان صاحب الدور في نمط الدورة
      if (hard && r.state === "talking" && r.turnId === p.id && r.settings.flow === "circle") passTurn(r, false);
      if (!r.players.some(x => x.connected)) { clearTimers(r); rooms.delete(r.id); }
      else broadcast(r);
      room = null; player = null;
    }

    function makePlayer(name) {
      return {
        id: socket.id,
        token: crypto.randomBytes(8).toString("hex"),
        name: socket.userName || String(name || "").trim().slice(0, 20) || "لاعب",
        userName: socket.userName || null,
        avatar: Math.floor(Math.random() * 12),
        score: 0, connected: true, spectator: false,
        ready: false, asked: false, answered: false, disconnectedAt: 0
      };
    }

    socket.on("publicRooms", (cb) => { if (typeof cb === "function") cb({ ok: true, rooms: publicRooms() }); });

    socket.on("leaderboard", async (cb) => {
      if (typeof cb !== "function") return;
      try {
        const s = (await store.getKV("salfaStats")) || {};
        const top = Object.entries(s)
          .map(([name, v]) => ({ name, wins: v.wins || 0, games: v.games || 0, points: v.points || 0 }))
          .sort((a, b) => b.wins - a.wins || b.points - a.points).slice(0, 10);
        cb({ ok: true, top });
      } catch (e) { cb({ ok: true, top: [] }); }
    });

    socket.on("createRoom", ({ name, settings } = {}, cb) => {
      if (typeof cb !== "function") return;
      if (room) leaveRoom(true);
      const id = makeRoomId();
      const r = {
        id, players: [], state: "lobby", ownerId: socket.id,
        settings: sanitize(settings || {}, DEFAULTS),
        roundNo: 0, category: null, word: null, spyIds: [],
        turnId: null, targetId: null, askerPickPending: false, lastAskerId: null,
        votes: {}, result: null, emergency: null, emergencyStarterId: null,
        caughtSpyId: null, spyGuess: null, winner: null,
        endsAt: 0, phaseTimer: null, tickTimer: null, emgTimer: null
      };
      player = makePlayer(name);
      r.players.push(player);
      rooms.set(id, r);
      room = r;
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
      if (room) leaveRoom(true);
      player = makePlayer(name);
      // الانضمام أثناء جولة جارية = متفرج حتى الجولة القادمة
      if (r.state !== "lobby" && r.state !== "result" && r.state !== "gameEnd") player.spectator = true;
      r.players.push(player);
      room = r;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: player.id, token: player.token });
      sys(r, `${player.name} انضم${player.spectator ? " (متفرج حتى الجولة القادمة)" : ""} 👋`);
      broadcast(r);
    });

    // استرداد سلس: نفس اللاعب يرجع لنفس حالته دون تدمير الجولة
    socket.on("rejoin", ({ roomId, token } = {}, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(String(roomId || "").trim());
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const p = r.players.find(x => x.token === token);
      if (!p) return cb({ ok: false, error: "انتهت جلستك" });
      if (p.connected && p.id !== socket.id) return cb({ ok: false, error: "الجلسة مفتوحة في مكان آخر" });
      const oldId = p.id;
      p.id = socket.id; p.connected = true; p.disconnectedAt = 0;
      if (r.ownerId === oldId) r.ownerId = socket.id;
      if (r.turnId === oldId) r.turnId = socket.id;
      if (r.targetId === oldId) r.targetId = socket.id;
      if (r.caughtSpyId === oldId) r.caughtSpyId = socket.id;
      r.spyIds = r.spyIds.map(x => (x === oldId ? socket.id : x));
      if (r.votes[oldId]) { r.votes[socket.id] = r.votes[oldId]; delete r.votes[oldId]; }
      Object.keys(r.votes).forEach(k => { if (r.votes[k] === oldId) r.votes[k] = socket.id; });
      room = r; player = p;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: p.id, token: p.token, state: state(r) });
      // يستعيد دوره السرّي فوراً
      if (["reveal", "talking", "voting", "spyGuess"].includes(r.state)) {
        const spy = r.spyIds.includes(p.id);
        nsp.to(p.id).emit("role", { spy, category: r.category, word: spy ? null : r.word, spies: r.spyIds.length, roundNo: r.roundNo });
      }
      broadcast(r);
    });

    socket.on("leaveRoom", () => leaveRoom(true));

    socket.on("updateSettings", (s) => {
      if (!room || !player || room.ownerId !== player.id) return;
      room.settings = sanitize(s || {}, room.settings);
      broadcast(room);
    });

    socket.on("startGame", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      if (!["lobby", "result", "gameEnd"].includes(room.state)) return;
      if (room.state === "gameEnd") room.players.forEach(p => { p.score = 0; });
      room.players.forEach(p => { p.spectator = false; });
      startRound(room);
    });

    socket.on("newRound", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      if (!["result", "lobby"].includes(room.state)) return;
      room.players.forEach(p => { p.spectator = false; });
      startRound(room);
    });

    socket.on("backToLobby", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      clearTimers(room);
      room.state = "lobby"; room.winner = null; room.result = null;
      room.category = null; room.word = null; room.spyIds = [];
      room.players.forEach(p => { p.spectator = false; p.score = 0; });
      broadcast(room);
    });

    // انتهى من قراءة دوره
    socket.on("ready", () => {
      if (!room || !player || room.state !== "reveal") return;
      player.ready = true;
      broadcast(room);
      if (playing(room).every(p => p.ready)) beginTalk(room);
    });

    // نمط الدورة: السائل يختار من يسأل (لا يسأل من سأله للتو)
    socket.on("pickTarget", (targetId) => {
      if (!room || !player || room.state !== "talking") return;
      if (room.settings.flow !== "circle") return;
      if (room.turnId !== player.id || !room.askerPickPending) return;
      const t = room.players.find(p => p.id === targetId);
      if (!t || !t.connected || t.spectator || t.id === player.id) return;
      if (room.lastAskerId && t.id === room.lastAskerId) {
        return nsp.to(player.id).emit("toast", "ما تقدر تسأل اللي سألك للتو");
      }
      room.targetId = t.id;
      room.askerPickPending = false;
      sys(room, `${player.name} يسأل ${t.name} ❓`);
      broadcast(room);
    });

    // المجيب أنهى إجابته → ينتقل الدور إليه
    socket.on("answered", () => {
      if (!room || !player || room.state !== "talking") return;
      if (room.settings.flow !== "circle") return;
      if (room.targetId !== player.id) return;
      passTurn(room, false);
    });

    // اتهام طارئ: يوقف اللعب ويسأل البقية إن أرادوا التصويت الآن
    socket.on("emergency", () => {
      if (!room || !player || room.state !== "talking") return;
      if (!room.settings.emergency || room.emergency) return;
      const list = playing(room);
      if (list.length < 3) return;
      room.emergency = {
        byId: player.id, byName: player.name,
        yes: [player.id], need: Math.floor(list.length / 2) + 1,
        endsAt: Date.now() + 20000
      };
      sys(room, `🚨 ${player.name} طلب اتهاماً طارئاً — هل توافقون على التصويت الآن؟`, "warn");
      broadcast(room);
      clearTimeout(room.emgTimer);
      room.emgTimer = setTimeout(() => {
        if (room.emergency) { sys(room, "لم توافق الأغلبية — نكمل النقاش", "system"); room.emergency = null; broadcast(room); }
      }, 20000);
    });

    socket.on("emergencyVote", (agree) => {
      if (!room || !player || !room.emergency || room.state !== "talking") return;
      const e = room.emergency;
      if (agree) {
        if (!e.yes.includes(player.id)) e.yes.push(player.id);
      } else {
        e.yes = e.yes.filter(id => id !== player.id);
      }
      if (e.yes.length >= e.need) {
        room.emergencyStarterId = e.byId;    // مكافأة المبادر إن نجح الكشف
        clearTimeout(room.emgTimer);
        room.emergency = null;
        sys(room, "وافقت الأغلبية — التصويت الآن! 🗳️", "good");
        return beginVoting(room);
      }
      broadcast(room);
    });

    // التصويت السرّي: لا تُبثّ الأصوات، فقط عددها
    socket.on("vote", (targetId) => {
      if (!room || !player || room.state !== "voting") return;
      if (player.spectator || !player.connected) return;
      const t = room.players.find(p => p.id === targetId);
      if (!t || t.spectator || !t.connected || t.id === player.id) return;
      room.votes[player.id] = t.id;
      nsp.to(player.id).emit("voteOk", t.id);
      broadcast(room);
      if (playing(room).every(p => room.votes[p.id])) tallyVotes(room);
    });

    // فرصة برّا السالفة الأخيرة
    socket.on("spyGuess", (text) => {
      if (!room || !player || room.state !== "spyGuess") return;
      if (room.caughtSpyId !== player.id) return;
      const guess = normalize(text);
      room.spyGuess = String(text || "").trim().slice(0, 40);
      const hit = guess && guess === normalize(room.word);
      sys(room, hit ? `😈 خمّنها! «${room.word}» — سرق الفوز` : `فشل التخمين: «${room.spyGuess}»`, hit ? "warn" : "good");
      finishRound(room, !!hit);
    });

    // المضيف يبدأ التصويت مبكراً
    socket.on("forceVote", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      if (room.state !== "talking") return;
      beginVoting(room);
    });

    socket.on("kickPlayer", (targetId) => {
      if (!room || !player || room.ownerId !== player.id) return;
      const t = room.players.find(p => p.id === targetId);
      if (!t || t.id === player.id) return;
      room.players = room.players.filter(p => p.id !== targetId);
      nsp.to(targetId).emit("kicked");
      sys(room, `${t.name} تم إخراجه من الغرفة`, "warn");
      broadcast(room);
    });

    socket.on("chat", (text) => {
      if (!room || !player) return;
      const t = String(text || "").trim().slice(0, CHAT_MAX);
      if (!t) return;
      // لا نسمح بكتابة كلمة السر في الشات أثناء الجولة
      if (room.word && ["reveal", "talking", "voting", "spyGuess"].includes(room.state)
          && normalize(t).includes(normalize(room.word))) {
        return nsp.to(player.id).emit("toast", "ممنوع كتابة كلمة السر في الدردشة!");
      }
      nsp.to(room.id).emit("chat", { name: player.name, text: t });
    });

    socket.on("disconnect", () => {
      if (!room || !player) return;
      const r = room, p = player;
      p.connected = false;
      p.disconnectedAt = Date.now();
      sys(r, `${p.name} انقطع اتصاله…`, "warn");
      if (r.ownerId === p.id) {
        const nxt = r.players.find(x => x.connected);
        if (nxt) { r.ownerId = nxt.id; sys(r, `👑 ${nxt.name} صار مدير الغرفة`); }
      }
      if (r.state === "talking" && r.settings.flow === "circle" && r.turnId === p.id) passTurn(r, false);
      if (r.state === "voting" && playing(r).length && playing(r).every(x => r.votes[x.id])) tallyVotes(r);
      broadcast(r);
      // تنظيف مؤجَّل: نحفظ الجلسة مدة كافية للعودة
      setTimeout(() => {
        if (!rooms.has(r.id)) return;
        if (p.connected) return;
        r.players = r.players.filter(x => x.id !== p.id);
        if (!r.players.some(x => x.connected)) { clearTimers(r); rooms.delete(r.id); }
        else broadcast(r);
      }, RECONNECT_MS);
      room = null; player = null;
    });
  });

  return { liveStats, publicRooms };
}

module.exports = { setupSalfa, DEFAULTS, sanitize, spyCount, normalize };
