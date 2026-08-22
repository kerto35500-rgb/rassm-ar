// 💣 لعبة القنبلة الكلامية — منطق مستقل تماماً على namespace "/bomb"
// لا يتداخل إطلاقاً مع لعبة الرسم (io.on("connection") الأساسي).
const crypto = require("crypto");
const dict = require("./dict");
const { nameFromSocket } = require("./account");

const GRACE_MS = 500;          // فترة سماح خفية عند وصول العداد للصفر
const RECONNECT_MS = 60000;    // مهلة العودة بعد انقطاع الاتصال
const CHAT_MAX = 200;
const ALPHABET = dict.ALPHABET;

const DEFAULTS = {
  startTime: 12,        // ثواني البداية لكل لاعب (5-30)
  speedMode: "classic", // off | slow | classic | fast
  minTime: 5,           // الحد الأدنى للوقت (سقف سرعة القنبلة)
  timeMode: "reset",    // reset = يعود كاملاً | carry = المتبقي + مكافأة
  longWordBonus: true,  // ثانية إضافية للكلمات الطويلة
  lives: 2,             // عدد القلوب (1-5)
  alphabetBonus: true,  // حياة إضافية عند إكمال الأبجدية
  bonusRepeat: true,    // تكرار المكافأة أكثر من مرة
  minLength: 3,         // أقل عدد أحرف مقبول (2-6)
  difficulty: 40,       // ندرة المقاطع 0-100
  dictionary: "full",   // full | simple
  lateJoin: "spectate", // play | spectate
  maxPlayers: 12,       // 2-16
  visibility: "private",// private | public
  password: ""
};

const SPEED_STEP = { off: 0, slow: 0.25, classic: 0.5, fast: 1 };

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function sanitize(s = {}, old = DEFAULTS) {
  const o = { ...old };
  if (s.startTime !== undefined) o.startTime = clampInt(s.startTime, 5, 30, old.startTime);
  if (s.speedMode !== undefined) o.speedMode = SPEED_STEP[s.speedMode] !== undefined ? s.speedMode : old.speedMode;
  if (s.minTime !== undefined) o.minTime = clampInt(s.minTime, 2, 15, old.minTime);
  if (s.timeMode !== undefined) o.timeMode = (s.timeMode === "carry" ? "carry" : "reset");
  if (s.longWordBonus !== undefined) o.longWordBonus = !!s.longWordBonus;
  if (s.lives !== undefined) o.lives = clampInt(s.lives, 1, 5, old.lives);
  if (s.alphabetBonus !== undefined) o.alphabetBonus = !!s.alphabetBonus;
  if (s.bonusRepeat !== undefined) o.bonusRepeat = !!s.bonusRepeat;
  if (s.minLength !== undefined) o.minLength = clampInt(s.minLength, 2, 6, old.minLength);
  if (s.difficulty !== undefined) o.difficulty = clampInt(s.difficulty, 0, 100, old.difficulty);
  if (s.dictionary !== undefined) o.dictionary = (s.dictionary === "simple" ? "simple" : "full");
  if (s.lateJoin !== undefined) o.lateJoin = (s.lateJoin === "play" ? "play" : "spectate");
  if (s.maxPlayers !== undefined) o.maxPlayers = clampInt(s.maxPlayers, 2, 16, old.maxPlayers);
  if (s.visibility !== undefined) o.visibility = (s.visibility === "public" ? "public" : "private");
  if (s.password !== undefined) o.password = String(s.password || "").slice(0, 24);
  if (o.minTime > o.startTime) o.minTime = o.startTime;
  return o;
}

function setupBomb(io, deps) {
  const { store, hashPass, publicStats, getAdmin } = deps;
  const nsp = io.of("/bomb");
  const rooms = new Map();

  dict.load();

  /* ═══ بنك الكلمات المقترحة من اللاعبين ═══
     كل كلمة عربية سليمة كتبها لاعب ولم يجدها القاموس تُسجَّل هنا،
     ويراجعها الأدمن من لوحة الكلمات (قبول = تُضاف للقاموس فوراً). */
  const WORD_BANK = { pending: {}, approved: [], rejected: [] };
  let bankTimer = null;

  store.getKV("bombWordBank").then(v => {
    if (v) {
      WORD_BANK.pending = v.pending || {};
      WORD_BANK.approved = v.approved || [];
      WORD_BANK.rejected = v.rejected || [];
      const n = dict.addApproved(WORD_BANK.approved);
      if (WORD_BANK.approved.length) console.log(`💬 كلمات معتمدة من الأدمن: ${WORD_BANK.approved.length}`);
    }
  }).catch(() => {});

  function saveBank() {
    clearTimeout(bankTimer);
    bankTimer = setTimeout(() => { store.setKV("bombWordBank", WORD_BANK).catch(() => {}); }, 1500);
  }

  function suggestWord(word, by) {
    const w = dict.normalize(word);
    if (!w || w.length < 2 || w.length > 12) return;
    if (!dict.isPureArabic(w)) return;
    if (dict.has(w)) return;
    if (WORD_BANK.rejected.includes(w)) return;
    const e = WORD_BANK.pending[w] || { word: w, count: 0, by: [], first: Date.now() };
    e.count++;
    if (by && !e.by.includes(by) && e.by.length < 8) e.by.push(by);
    e.last = Date.now();
    WORD_BANK.pending[w] = e;
    saveBank();
  }

  const wordBankApi = {
    list() { return Object.values(WORD_BANK.pending).sort((a, b) => b.count - a.count || b.last - a.last); },
    counts() { return { pending: Object.keys(WORD_BANK.pending).length, approved: WORD_BANK.approved.length, rejected: WORD_BANK.rejected.length }; },
    approve(words) {
      let n = 0;
      for (const raw of (words || [])) {
        const w = dict.normalize(raw);
        if (!w || !WORD_BANK.pending[w]) continue;
        delete WORD_BANK.pending[w];
        if (!WORD_BANK.approved.includes(w)) { WORD_BANK.approved.push(w); n++; }
      }
      if (n) dict.addApproved(WORD_BANK.approved);
      saveBank();
      return n;
    },
    reject(words) {
      let n = 0;
      for (const raw of (words || [])) {
        const w = dict.normalize(raw);
        if (!w || !WORD_BANK.pending[w]) continue;
        delete WORD_BANK.pending[w];
        if (!WORD_BANK.rejected.includes(w)) WORD_BANK.rejected.push(w);
        n++;
      }
      saveBank();
      return n;
    },
    addDirect(words) {
      let n = 0;
      for (const raw of (words || [])) {
        const w = dict.normalize(raw);
        if (!w || !dict.isPureArabic(w) || w.length < 2 || w.length > 12) continue;
        if (!WORD_BANK.approved.includes(w)) { WORD_BANK.approved.push(w); n++; }
        delete WORD_BANK.pending[w];
      }
      if (n) dict.addApproved(WORD_BANK.approved);
      saveBank();
      return n;
    },
    approvedList() { return [...WORD_BANK.approved]; },
    removeApproved(words) {
      const set = new Set((words || []).map(w => dict.normalize(w)));
      const before = WORD_BANK.approved.length;
      WORD_BANK.approved = WORD_BANK.approved.filter(w => !set.has(w));
      saveBank();
      return before - WORD_BANK.approved.length;
    }
  };

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
        id: r.id,
        players: conn,
        max: r.settings.maxPlayers,
        state: r.state,
        locked: !!r.settings.password,
        owner: r.players.find(p => p.id === r.ownerId)?.name || "—"
      });
    });
    return out.sort((a, b) => b.players - a.players).slice(0, 30);
  }

  function playerView(p) {
    return {
      id: p.id, name: p.name, lives: p.lives, alive: p.alive,
      connected: p.connected, spectator: p.spectator,
      letters: [...p.letters], resets: p.resets,
      words: p.wordsCount, registered: !!p.userName
    };
  }

  function state(room) {
    const cur = room.players[room.turnIdx];
    return {
      id: room.id,
      state: room.state,
      ownerId: room.ownerId,
      settings: room.settings,
      players: room.players.map(playerView),
      turnId: room.state === "playing" && cur ? cur.id : null,
      syllable: room.syllable,
      sylPool: room.sylPool,
      roundNo: room.roundNo,
      usedCount: room.used.size,
      endsAt: room.endsAt,
      serverNow: Date.now(),
      baseTime: room.baseTime,
      winner: room.winner,
      dictSize: dict.stats().size
    };
  }

  function broadcast(room) { nsp.to(room.id).emit("state", state(room)); }
  function sys(room, text, cls = "system") { nsp.to(room.id).emit("chat", { system: true, cls, text }); }

  function clearTimers(room) {
    clearTimeout(room.boomTimer); room.boomTimer = null;
  }

  function alivePlayers(room) { return room.players.filter(p => p.alive && !p.spectator); }

  // ====== دورة اللعب ======
  function startGame(room) {
    if (room.state === "playing") return;
    const ready = room.players.filter(p => !p.spectator);
    if (ready.length < 2) { sys(room, "نحتاج لاعبين على الأقل للبدء", "warn"); return; }
    const a = getAdmin && getAdmin();
    if (a && a.trackGame) a.trackGame();

    room.players.forEach(p => {
      p.spectator = false;
      p.alive = true;
      p.lives = room.settings.lives;
      p.letters = new Set();
      p.resets = 0;
      p.wordsCount = 0;
    });
    room.state = "playing";
    room.roundNo = 0;
    room.winner = null;
    room.turnIdx = Math.floor(Math.random() * room.players.length);
    newRound(room, room.turnIdx);
    sys(room, "بدأت اللعبة! 💣", "good");
  }

  function newRound(room, startIdx) {
    room.roundNo++;
    room.used = new Set();
    room.baseTime = room.settings.startTime;
    const list = alivePlayers(room);
    if (list.length <= 1) return endGame(room);
    // اجعل الدور على لاعب حيّ
    let idx = startIdx;
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[(idx + i) % room.players.length];
      if (p && p.alive && !p.spectator) { idx = (idx + i) % room.players.length; break; }
    }
    room.turnIdx = idx;
    nextSyllable(room);
    armBomb(room, room.baseTime);
    broadcast(room);
  }

  function nextSyllable(room) {
    const { syllable, pool } = dict.pickSyllable(
      room.settings.difficulty, true, room.settings.dictionary);
    room.syllable = syllable;
    room.sylPool = pool;
  }

  function armBomb(room, seconds) {
    clearTimers(room);
    const ms = Math.max(1000, Math.round(seconds * 1000));
    room.endsAt = Date.now() + ms;
    room.boomTimer = setTimeout(() => explode(room), ms + GRACE_MS);
  }

  // أول لاعب حيّ بعد الموضع المُعطى (دوراناً حول الحلقة)
  function nextAliveIdx(room, from) {
    const n = room.players.length;
    for (let i = 1; i <= n; i++) {
      const j = (from + i) % n;
      const c = room.players[j];
      if (c && c.alive && !c.spectator) return j;
    }
    return from;
  }

  function advanceTurn(room, gainedSeconds) {
    const list = alivePlayers(room);
    if (list.length <= 1) return endGame(room);
    // تسريع القنبلة
    const step = SPEED_STEP[room.settings.speedMode] || 0;
    room.baseTime = Math.max(room.settings.minTime, room.baseTime - step);

    room.turnIdx = nextAliveIdx(room, room.turnIdx);
    nextSyllable(room);

    let t = room.baseTime;
    if (room.settings.timeMode === "carry") {
      const remain = Math.max(0, (room.endsAt - Date.now()) / 1000);
      t = Math.min(room.settings.startTime, remain + 2 + (gainedSeconds || 0));
      t = Math.max(2, t);
    } else {
      t = room.baseTime + (gainedSeconds || 0);
    }
    armBomb(room, t);
    broadcast(room);
  }

  function explode(room) {
    if (room.state !== "playing") return;
    clearTimers(room);
    const p = room.players[room.turnIdx];
    if (!p) return;
    p.lives--;
    nsp.to(room.id).emit("boom", { id: p.id, name: p.name, lives: p.lives });
    if (p.lives <= 0) {
      p.alive = false;
      p.lives = 0;
      sys(room, `💀 خرج ${p.name} من اللعبة`, "bad");
    } else {
      sys(room, `💥 انفجرت عند ${p.name} — بقي له ${p.lives} ❤️`, "warn");
    }
    const list = alivePlayers(room);
    if (list.length <= 1) return endGame(room);
    // بعد الانفجار تنتقل القنبلة للاعب الذي بعده — لا تبقى معلّقة عليه
    const startIdx = nextAliveIdx(room, room.turnIdx);
    setTimeout(() => { if (room.state === "playing") newRound(room, startIdx); }, 1400);
    broadcast(room);
  }

  function endGame(room) {
    clearTimers(room);
    room.state = "ended";
    const list = alivePlayers(room);
    const win = list[0] || null;
    room.winner = win ? { id: win.id, name: win.name } : null;
    room.endsAt = 0;
    if (win) sys(room, `🏆 الفائز: ${win.name}`, "good");
    else sys(room, "انتهت اللعبة بدون فائز", "system");
    saveStats(room, win);
    broadcast(room);
  }

  async function saveStats(room, winner) {
    try {
      const prev = (await store.getKV("bombStats")) || {};
      let changed = false;
      for (const p of room.players) {
        if (!p.userName || p.spectator) continue;
        const s = prev[p.userName] || { games: 0, wins: 0, words: 0 };
        s.games++; s.words += p.wordsCount;
        if (winner && winner.id === p.id) s.wins++;
        prev[p.userName] = s;
        changed = true;
      }
      if (changed) await store.saveKV("bombStats", prev);
    } catch (e) { console.error("bomb stats:", e.message); }
  }

  // ====== محاولة كلمة ======
  function trySubmit(room, p, raw) {
    if (room.state !== "playing") return;
    const cur = room.players[room.turnIdx];
    if (!cur || cur.id !== p.id) return;
    // فترة السماح: نقبل حتى GRACE_MS بعد الصفر
    if (Date.now() > room.endsAt + GRACE_MS) return;

    const res = dict.check(raw, room.syllable, {
      minLength: room.settings.minLength,
      dictionary: room.settings.dictionary,
      used: room.used
    });

    if (!res.ok) {
      const msgs = {
        empty: "اكتب كلمة",
        notArabic: "حروف عربية فقط",
        tooShort: `الكلمة قصيرة — ${room.settings.minLength} أحرف على الأقل`,
        noSyllable: `الكلمة لا تحتوي «${room.syllable}»`,
        used: "الكلمة مستعملة في هذه الجولة",
        notFound: "الكلمة غير موجودة في القاموس"
      };
      // كلمة عربية سليمة غير موجودة ⇒ تُرسل للأدمن كاقتراح
      if (res.reason === "notFound") suggestWord(res.word || raw, p.name);
      nsp.to(p.id).emit("reject", {
        reason: res.reason,
        msg: res.reason === "notFound" ? "غير موجودة في القاموس — أُرسلت للمراجعة 📩" : (msgs[res.reason] || "غير مقبولة")
      });
      return;
    }

    // ✅ مقبولة
    const w = res.word;
    room.used.add(w);
    p.wordsCount++;

    // مكافأة الكلمة الطويلة
    let bonus = 0;
    if (room.settings.longWordBonus && w.length >= 7) bonus = Math.min(3, 1 + Math.floor((w.length - 7) / 3));

    // لوحة الحروف
    let gotLife = false;
    for (const ch of dict.lettersOf(w)) p.letters.add(ch);
    if (room.settings.alphabetBonus && p.letters.size >= ALPHABET.length) {
      const allow = room.settings.bonusRepeat || p.resets === 0;
      p.letters = new Set();
      p.resets++;
      if (allow) {
        p.lives++;
        gotLife = true;
        sys(room, `✨ ${p.name} أكمل الأبجدية وحصل على حياة إضافية! ❤️`, "good");
      }
    }

    nsp.to(room.id).emit("accepted", {
      id: p.id, name: p.name, word: w, bonus, gotLife, syllable: room.syllable
    });
    advanceTurn(room, bonus);
  }

  // ====== الاتصال ======
  nsp.on("connection", (socket) => {
    let room = null;
    let player = null;

    // الحساب المشترك من الصفحة الرئيسية (كوكي) — لا تسجيل دخول داخل اللعبة
    socket.userName = nameFromSocket(socket) || null;

    socket.emit("hello", { dict: dict.stats(), defaults: DEFAULTS, alphabet: ALPHABET });

    function leaveRoom(hard) {
      if (!room || !player) return;
      const r = room, p = player;
      if (hard) {
        r.players = r.players.filter(x => x.id !== p.id);
      } else {
        p.connected = false;
        p.disconnectedAt = Date.now();
      }
      socket.leave(r.id);
      // نقل الملكية
      if (r.ownerId === p.id) {
        const nxt = r.players.find(x => x.connected);
        if (nxt) { r.ownerId = nxt.id; sys(r, `👑 ${nxt.name} صار مدير الغرفة`, "system"); }
      }
      // إذا كان دوره أثناء اللعب وخرج نهائياً
      if (r.state === "playing" && hard) {
        const stillAlive = alivePlayers(r);
        if (stillAlive.length <= 1) endGame(r);
        else if (r.players[r.turnIdx] === undefined || !r.players[r.turnIdx].alive) {
          if (r.turnIdx >= r.players.length) r.turnIdx = 0;
          advanceTurn(r, 0);
        }
      }
      if (!r.players.length) { clearTimers(r); rooms.delete(r.id); }
      else broadcast(r);
      room = null; player = null;
    }

    // ---- الحسابات (نفس قاعدة بيانات لعبة الرسم) ----
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
        const a = getAdmin && getAdmin();
        if (a && a.trackNewUser) a.trackNewUser();
        socket.userName = name;
        cb({ ok: true, stats: { name, wins: 0, games: 0, totalScore: 0 }, bomb: { games: 0, wins: 0, words: 0 } });
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
        const bs = (await store.getKV("bombStats")) || {};
        cb({ ok: true, stats: publicStats(u), bomb: bs[name] || { games: 0, wins: 0, words: 0 } });
      } catch (e) { cb({ ok: false, error: "خطأ في الخادم" }); }
    });

    socket.on("leaderboard", async (cb) => {
      if (typeof cb !== "function") return;
      try {
        const bs = (await store.getKV("bombStats")) || {};
        const top = Object.entries(bs)
          .map(([name, s]) => ({ name, wins: s.wins || 0, games: s.games || 0, words: s.words || 0 }))
          .sort((a, b) => b.wins - a.wins || b.words - a.words)
          .slice(0, 10);
        cb({ ok: true, top });
      } catch (e) { cb({ ok: true, top: [] }); }
    });

    socket.on("publicRooms", (cb) => { if (typeof cb === "function") cb({ ok: true, rooms: publicRooms() }); });

    // ---- الغرف ----
    function makePlayer(name) {
      return {
        id: socket.id,
        token: crypto.randomBytes(8).toString("hex"),
        name: socket.userName || String(name || "").trim().slice(0, 20) || "لاعب",
        userName: socket.userName || null,
        lives: DEFAULTS.lives, alive: true, connected: true, spectator: false,
        letters: new Set(), resets: 0, wordsCount: 0, disconnectedAt: 0
      };
    }

    socket.on("createRoom", ({ name, settings } = {}, cb) => {
      if (typeof cb !== "function") return;
      if (room) leaveRoom(true);
      const id = makeRoomId();
      const r = {
        id, players: [], state: "lobby", ownerId: socket.id,
        settings: sanitize(settings || {}, DEFAULTS),
        used: new Set(), syllable: "", sylPool: 0, roundNo: 0,
        turnIdx: 0, endsAt: 0, baseTime: DEFAULTS.startTime,
        boomTimer: null, winner: null
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
      const conn = r.players.filter(p => p.connected).length;
      if (conn >= r.settings.maxPlayers) return cb({ ok: false, error: "الغرفة ممتلئة" });
      if (room) leaveRoom(true);
      player = makePlayer(name);
      // الانضمام المتأخر
      if (r.state === "playing") {
        if (r.settings.lateJoin === "play") {
          player.lives = r.settings.lives;
          player.alive = true;
        } else {
          player.spectator = true;
          player.alive = false;
        }
      }
      r.players.push(player);
      room = r;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: player.id, token: player.token });
      sys(r, `${player.name} انضم${player.spectator ? " (متفرج)" : ""} 👋`);
      broadcast(r);
    });

    // العودة بعد انقطاع الاتصال
    socket.on("rejoin", ({ roomId, token } = {}, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(String(roomId || "").trim());
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const p = r.players.find(x => x.token === token);
      if (!p) return cb({ ok: false, error: "انتهت جلستك" });
      if (p.connected && p.id !== socket.id) return cb({ ok: false, error: "الجلسة مفتوحة في مكان آخر" });
      const oldId = p.id;
      p.id = socket.id;
      p.connected = true;
      p.disconnectedAt = 0;
      if (r.ownerId === oldId) r.ownerId = socket.id;
      room = r; player = p;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: p.id, token: p.token });
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
      startGame(room);
    });

    socket.on("backToLobby", () => {
      if (!room || !player || room.ownerId !== player.id) return;
      clearTimers(room);
      room.state = "lobby";
      room.winner = null;
      room.syllable = "";
      room.endsAt = 0;
      room.used = new Set();
      room.players.forEach(p => { p.spectator = false; p.alive = true; p.letters = new Set(); p.resets = 0; });
      broadcast(room);
    });

    socket.on("kickPlayer", (targetId) => {
      if (!room || !player || room.ownerId !== player.id) return;
      const t = room.players.find(p => p.id === targetId);
      if (!t || t.id === player.id) return;
      room.players = room.players.filter(p => p.id !== targetId);
      nsp.to(targetId).emit("kicked");
      sys(room, `🚪 تم طرد ${t.name}`, "warn");
      if (room.state === "playing" && alivePlayers(room).length <= 1) endGame(room);
      else broadcast(room);
    });

    socket.on("word", (text) => {
      if (!room || !player) return;
      trySubmit(room, player, String(text || "").slice(0, 40));
    });

    // عرض ما يكتبه اللاعب لحظياً (مثل اللعبة الأصلية)
    socket.on("typing", (text) => {
      if (!room || !player || room.state !== "playing") return;
      const cur = room.players[room.turnIdx];
      if (!cur || cur.id !== player.id) return;
      socket.to(room.id).emit("typing", { id: player.id, text: String(text || "").slice(0, 40) });
    });

    socket.on("chat", (text) => {
      if (!room || !player) return;
      const t = String(text || "").trim().slice(0, CHAT_MAX);
      if (!t) return;
      nsp.to(room.id).emit("chat", { name: player.name, text: t });
    });

    socket.on("disconnect", () => {
      if (!room || !player) return;
      const r = room, p = player;
      p.connected = false;
      p.disconnectedAt = Date.now();
      if (r.ownerId === p.id) {
        const nxt = r.players.find(x => x.connected);
        if (nxt) r.ownerId = nxt.id;
      }
      broadcast(r);
      setTimeout(() => {
        if (p.connected) return;
        r.players = r.players.filter(x => x !== p);
        if (!r.players.length) { clearTimers(r); rooms.delete(r.id); return; }
        if (r.ownerId === p.id) r.ownerId = r.players[0].id;
        if (r.state === "playing" && alivePlayers(r).length <= 1) endGame(r);
        else broadcast(r);
      }, RECONNECT_MS);
      room = null; player = null;
    });
  });

  // تنظيف دوري للغرف الميتة
  setInterval(() => {
    const now = Date.now();
    rooms.forEach((r, id) => {
      if (!r.players.some(p => p.connected) &&
          r.players.every(p => now - (p.disconnectedAt || now) > RECONNECT_MS)) {
        clearTimers(r);
        rooms.delete(id);
      }
    });
  }, 30000);

  return { liveStats, publicRooms, rooms, wordBank: wordBankApi };
}

module.exports = { setupBomb, DEFAULTS };
