/* 🌶️ «البسكويتة الحارّة» أونلاين — مساحة ‎/spicy‎.
 *
 * القواعد في spicyrules.js؛ وهنا الغرف والمقاعد والبوتات والمؤقّتات والبثّ.
 *
 *  ١) لكلّ لاعبٍ حالتُه وحده: أنواعُ ماكارونات غيره المقلوبة، وما خسره غيرُه،
 *     لا تغادر الخادم إليه — الحجبُ هنا لا في المتصفّح.
 *  ٢) لكلّ خطوةٍ مهلة (يختارها المضيف)؛ فإن انقضت فُعل عن صاحبها (وضعٌ أو
 *     انسحابٌ أو قلب) — لا تتجمّد الطاولةُ لغائب.
 *  ٣) البوتاتُ اختياريّة: تُكمل الطاولة إلى العدد الذي يختاره المضيف.
 *  ٤) من خرج أو غاب يلعب عنه بوت؛ ويعود إلى مقعده برمز جهازه أو باسمه.
 *     ولا أحدَ من البشر حاضرًا ⇒ تتوقّف الطاولة وتُحفظ الغرفة.
 */
"use strict";

const { SpicyMatch, decide, MIN_PLAYERS, MAX_PLAYERS } = require("./spicyrules");
const FILTER = require("./chatfilter");
const { nameFromSocket } = require("./account");

const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const KEEP_MS = 15 * 60 * 1000;
const CHAT_KEEP = 50;
const TURN_SECS = [15, 25, 40];
const RESULT_SECS = 5;
const BOT_NAMES = ["أبو فهد", "صقر", "نورة", "الذيب", "سيف", "ريم", "مشعل", "الشمري", "أبو تركي", "لولوة"];
const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").trim().slice(0, n);
const normName = n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().toLowerCase();

const DEFAULTS = Object.freeze({ seats: 4, bots: true, turnSecs: 25 });
function sanitize(d, old) {
  const S = { ...old };
  if (!d || typeof d !== "object") return S;
  if ([3, 4, 5, 6].includes(+d.seats)) S.seats = +d.seats;
  if (typeof d.bots === "boolean") S.bots = d.bots;
  if (TURN_SECS.includes(+d.turnSecs)) S.turnSecs = +d.turnSecs;
  return S;
}

function setupSpicyOnline(io, deps = {}) {
  const nsp = io.of("/spicy");
  const st = () => deps.store;
  const graceMs = deps.graceMs != null ? deps.graceMs : GRACE_MS;
  const keepMs = deps.keepMs != null ? deps.keepMs : KEEP_MS;
  const botDelay = deps.botDelay || [700, 1400];
  /* للاختبارات: تقصيرُ المهل (١ = الزمن الحقيقيّ) */
  const secsScale = deps.secsScale != null ? deps.secsScale : 1;
  const rng = deps.rng || Math.random;
  const rooms = new Map();

  function newCode() {
    for (let t = 0; t < 400; t++) {
      const c = String(10000 + Math.floor(Math.random() * 90000));
      if (!rooms.has(c)) return c;
    }
    return String(Date.now()).slice(-6);
  }
  const touch = r => { r.touched = Date.now(); };
  const humans = r => r.players.filter(p => !p.bot);
  const present = r => humans(r).filter(p => !p.gone);
  const sockOf = p => p && p.sockId ? nsp.sockets.get(p.sockId) : null;

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: { ...r.settings }, playing: !!r.match,
      min: MIN_PLAYERS, max: MAX_PLAYERS,
      players: r.players.filter(p => !p.bot || r.match).map(p => ({ id: p.id, name: p.name, host: p.id === r.hostId,
        gone: !!p.gone, bot: !!p.bot, registered: !!p.userId })),
      lastResult: r.lastResult
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));
  const playersPub = r => r.players.map(p => ({ id: p.id, bot: !!p.bot && !p._wasHuman, away: !!p.gone || !!p._wasHuman }));

  /* ── الحالة: لكلّ لاعبٍ عرضُه هو ── */
  function flush(r) {
    const m = r.match;
    if (!m) return;
    const raw = m.takeEvents();
    const pub = playersPub(r);
    for (const p of r.players) {
      const s = sockOf(p);
      if (!s) continue;
      /* ‏‎span‎ لا ‎total‎: ‎total‎ في العرض مجموعُ ما على الطاولة (كانت المهلةُ تكتب فوقه) */
      s.emit("state", { ...m.view(p.id), events: m.eventsFor(raw, p.id), deadline: r.deadline || 0, span: r.total || 0,
                        serverNow: Date.now(), paused: !!r.paused, settings: { ...r.settings }, seats: pub });
    }
  }

  function clearTimers(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    if (r.botT) { clearTimeout(r.botT); r.botT = null; }
    r.deadline = 0; r.total = 0;
  }
  /* «مرحلةٌ» تتجدّد مهلتُها: الوضعُ كلُّه مرحلةٌ واحدة (لا تتجدّد بكلّ وضع)،
     وغيرُه لكلّ فعلٍ مرحلتُه (دورٌ جديد، أو قلبٌ جديد) */
  const stageOf = m => m.phase === "placement" ? m.round + ":placement"
    : [m.round, m.phase, m.turn, m.bid ? m.bid.amount : 0, m.revealed.length].join(":");
  const isBot = (r, id) => { const p = r.players.find(x => x.id === id); return !p || p.bot; };

  function after(r) {
    touch(r);
    const m = r.match;
    if (!m) return;
    if (m.phase === "over") { clearTimers(r); r.paused = false; flush(r); return finish(r); }
    if (!present(r).length) { clearTimers(r); r.stage = null; r.paused = true; flush(r); return; }
    r.paused = false;
    const key = stageOf(m);
    if (r.stage !== key) {
      clearTimers(r);
      r.stage = key;
      if (m.phase === "result") arm(r, m, RESULT_SECS, () => m.nextRound());
      else if (m.waitingFor().some(id => !isBot(r, id))) arm(r, m, r.settings.turnSecs, () => m.timeout());
    }
    /* بوتٌ ينتظره فعل: واحدٌ في كلّ مرّة، بعد لحظة */
    if (!r.botT && m.phase !== "result") {
      const id = m.waitingFor().find(x => isBot(r, x));
      if (id) {
        const [a, b] = botDelay;
        r.botT = setTimeout(() => {
          r.botT = null;
          if (r.match !== m || !m.waitingFor().includes(id)) return after(r);
          try { const d = decide(m.view(id), rng); if (d) m.act(id, d); } catch (e) { /* فعلٌ لم يعد ممكنًا */ }
          after(r);
        }, (a + Math.random() * Math.max(0, b - a)) * (deps.botScale != null ? deps.botScale : 1));
      }
    }
    flush(r);
  }
  function arm(r, m, secs, fn) {
    const ms = secs * 1000 * secsScale;
    const key = r.stage;
    r.deadline = Date.now() + ms;
    r.total = secs * 1000;
    r.timer = setTimeout(() => {
      r.timer = null;
      if (r.match !== m || r.stage !== key) return;
      try { fn(); } catch (e) { /* تبدّلت المرحلةُ للتوّ */ }
      after(r);
    }, ms + (m.phase === "result" ? 0 : 300 * secsScale));
  }

  async function finish(r) {
    clearTimers(r);
    const m = r.match;
    if (!m || m._done) return;
    m._done = true;
    const nameOf = id => { const p = r.players.find(x => x.id === id); return p ? (p._name || p.name) : "؟"; };
    const ranking = m.ranking().map(x => ({ ...x, name: nameOf(x.id), bot: isBot(r, x.id) && !(r.players.find(p => p.id === x.id) || {})._wasHuman }));
    r.lastResult = { winner: m.winner, winnerName: nameOf(m.winner), reason: m.reason, ranking, at: Date.now() };
    nsp.to(r.code).emit("matchEnd", r.lastResult);
    const finishers = r.players.filter(p => !p.bot && !p.gone && p.userId);
    const stars = Object.fromEntries(m.players.map(x => [x.id, x.stars]));
    r.match = null;
    r.stage = null; r.paused = false;
    r.players = r.players.filter(p => !p.bot && !p.gone);
    if (!r.players.some(p => p.id === r.hostId)) r.hostId = r.players[0] ? r.players[0].id : null;
    sendLobby(r);
    for (const p of finishers) {
      if (!st()) break;
      try { await st().bumpGameStats(p.userId, "spicy", { games: 1, wins: m.winner === p.id ? 1 : 0, score: stars[p.id] || 0 }); }
      catch (e) { /* الإحصاءُ لا يُعطّل اللعبة */ }
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!present(r).length && now - r.touched > (r.match ? keepMs : graceMs))) {
        clearTimers(r); rooms.delete(code);
      }
    }
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();

  nsp.on("connection", socket => {
    let room = null, me = null, lastChat = 0;

    socket.emit("hello", { defaults: DEFAULTS, turnSecs: TURN_SECS, min: MIN_PLAYERS, max: MAX_PLAYERS, resultSecs: RESULT_SECS,
                           you: nameFromSocket(socket) || socket.userName || null });

    const err = msg => socket.emit("toast", msg);
    const isHost = () => room && me && room.hostId === me.id && room.players.includes(me);
    const mine = () => !!(room && me && room.players.includes(me) && me.sockId === socket.id);

    function identity(name) {
      const acct = nameFromSocket(socket) || socket.userName || null;
      return { id: rid(), token: rid() + rid(), name: acct || clean(name, 20) || "لاعب",
               userId: socket.userId || null, sockId: socket.id, gone: false, bot: false };
    }
    function enter(r, p, cb, extra) {
      room = r; me = p;
      socket.join(r.code);
      if (!r.hostId) r.hostId = p.id;
      cb && cb({ ok: true, roomId: r.code, you: p.id, token: p.token, ...(extra || {}) });
      sendLobby(r);
      if (r.chat.length) socket.emit("chatLog", r.chat.slice(-CHAT_KEEP));
      if (r.match) flush(r);
    }

    socket.on("createRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const r = { code: newCode(), hostId: null, touched: Date.now(), settings: { ...DEFAULTS },
                  players: [], match: null, timer: null, botT: null, deadline: 0, total: 0, stage: null, paused: false,
                  chat: [], lastResult: null };
      rooms.set(r.code, r);
      const p = identity(d && d.name);
      r.players.push(p);
      enter(r, p, cb);
    });

    socket.on("joinRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(clean(d && d.roomId, 8));
      if (!r) return cb({ ok: false, error: "لا توجد غرفة بهذا الرمز" });
      if (r.match) {
        const p = seatToReclaim(r, d);
        if (!p) return cb({ ok: false, error: "اللعبة جارية — انتظر انتهاءها" });
        return resume(r, p, cb);
      }
      if (present(r).length >= MAX_PLAYERS) return cb({ ok: false, error: "الطاولة ممتلئة (٦ لاعبين)" });
      const acct = socket.userId ? String(socket.userId) : null;
      if (acct && r.players.some(p => p.userId && String(p.userId) === acct && !p.gone))
        return cb({ ok: false, error: "حسابك موجودٌ في الغرفة" });
      if (room) leave(true);
      r.players = r.players.filter(p => !p.gone);
      const p = identity(d && d.name);
      r.players.push(p);
      enter(r, p, cb);
    });

    socket.on("rejoin", (d, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(clean(d && d.roomId, 8));
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const p = r.players.find(x => x.token && x.token === String(d && d.token || ""));
      if (!p) return cb({ ok: false, error: "انتهت جلستك" });
      resume(r, p, cb);
    });

    /** صاحبُ مقعدٍ في اللعبة الجارية: برمز جهازه، أو حسابه، أو اسمه (لغائبٍ فقط) */
    function seatToReclaim(r, d) {
      const mineP = r.players.filter(p => !p.bot || p._wasHuman);
      const tok = String(d && d.token || "");
      const acct = socket.userId ? String(socket.userId) : null;
      const nm = normName(d && d.name);
      return (tok && mineP.find(p => p.token === tok)) ||
             (acct && mineP.find(p => p.userId && String(p.userId) === acct)) ||
             (nm && mineP.find(p => (p.gone || p._wasHuman) && normName(p._name || p.name) === nm)) || null;
    }
    function resume(r, p, cb) {
      if (room && (room !== r || me !== p)) leave(true);
      const oldId = p.sockId;
      p.sockId = socket.id; p.gone = false;
      p._leaveGen = (p._leaveGen || 0) + 1;
      if (p._wasHuman) { p.bot = false; p.name = p._name || p.name; p._wasHuman = false; }
      if (oldId && oldId !== socket.id) {
        const old = nsp.sockets.get(oldId);
        if (old) { old.emit("replaced"); if (typeof old.disconnect === "function") old.disconnect(true); }
      }
      enter(r, p, cb, { resumed: true });
      if (r.match) { r.stage = r.paused ? null : r.stage; after(r); }
    }

    socket.on("leaveRoom", () => leave(true));
    socket.on("disconnect", () => leave(false));

    socket.on("updateSettings", d => {
      if (!isHost() || room.match) return;
      room.settings = sanitize(d, room.settings);
      touch(room); sendLobby(room);
    });

    socket.on("kick", d => {
      if (!isHost() || room.match) return;
      const id = clean(d && d.id, 20);
      if (id === room.hostId) return;
      const p = room.players.find(x => x.id === id);
      if (!p) return;
      room.players = room.players.filter(x => x !== p);
      const s = sockOf(p);
      if (s) { s.emit("kicked"); s.leave(room.code); }
      sendLobby(room);
    });

    socket.on("startGame", () => {
      if (!isHost() || room.match) return;
      const hs = present(room);
      const S = room.settings;
      const n = S.bots ? Math.min(MAX_PLAYERS, Math.max(S.seats, hs.length)) : hs.length;
      if (n < MIN_PLAYERS) return err("تحتاجون ٣ لاعبين على الأقلّ — أو فعّلوا البوتات");
      room.players = hs.slice();
      const used = new Set(hs.map(p => p.name));
      while (room.players.length < n) {
        let nm = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        for (let t = 0; used.has(nm) && t < 30; t++) nm = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        used.add(nm);
        room.players.push({ id: "bot" + rid(), token: null, name: nm, userId: null, sockId: null, gone: false, bot: true });
      }
      /* ترتيبُ الجلوس عشوائيّ (اتّجاهُ الساعة) */
      for (let i = room.players.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [room.players[i], room.players[j]] = [room.players[j], room.players[i]]; }
      try { room.match = new SpicyMatch(room.players.map(p => ({ id: p.id, name: p.name })), { rng }); }
      catch (e) { room.players = hs; return err(e.message); }
      room.lastResult = null; room.stage = null; room.paused = false;
      nsp.to(room.code).emit("started", {});
      sendLobby(room);
      after(room);
    });

    /* ── أفعال الجولة ── */
    function act(fn) {
      return d => {
        if (!mine() || !room.match) return;
        try { fn(room.match, me.id, d || {}); }
        catch (e) { return err(e.message || "فعلٌ غير مقبول"); }
        after(room);
      };
    }
    socket.on("place", act((m, id, d) => m.place(id, String(d.disc || ""))));
    socket.on("raise", act((m, id, d) => m.raise(id, +d.amount)));
    socket.on("pass", act((m, id) => m.pass(id)));
    socket.on("flip", act((m, id, d) => m.flip(id, String(d.owner || ""))));

    socket.on("chat", d => {
      if (!mine()) return;
      const now = Date.now();
      if (now - lastChat < 600) return;
      lastChat = now;
      const c = FILTER.check(d && d.text);
      if (!c.ok) return err(c.why);
      const msg = { id: me.id, name: me.name, text: c.text, at: now };
      room.chat.push(msg);
      if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
      nsp.to(room.code).emit("chat", msg);
    });

    /* من خرج عمدًا أو انقطع ولم يعد: في اللعبة يلعب عنه بوت (ويعود إلى مقعده
       إن رجع)؛ وفي اللوبي يُزال. */
    function leave(deliberate) {
      if (!room || !me) return;
      const r = room, p = me;
      room = null; me = null;
      socket.leave(r.code);
      if (!r.players.includes(p)) return;
      if (p.sockId && p.sockId !== socket.id) return;     /* جلسةٌ أحدث تسلّمت المقعد */
      p.sockId = null;
      const gen = p._leaveGen = (p._leaveGen || 0) + 1;
      const drop = () => {
        if (!r.players.includes(p)) return;
        if (r.match) {
          if (!p._wasHuman) { p._wasHuman = true; p._name = p.name; }
          p.bot = true; p.gone = true;
        } else r.players = r.players.filter(x => x !== p);
        if (r.hostId === p.id) {
          const nx = r.players.find(x => !x.bot && !x.gone);
          r.hostId = nx ? nx.id : null;
        }
        sendLobby(r);
        if (r.match) after(r);
        else if (!present(r).length) { clearTimers(r); rooms.delete(r.code); }
      };
      if (deliberate || !r.match) { p.gone = true; drop(); return; }
      p.gone = true;
      sendLobby(r);
      after(r);
      setTimeout(() => {
        if (p._leaveGen !== gen || p.sockId) return;
        drop();
      }, graceMs);
    }
  });

  console.log("🌶️ البسكويتة الحارّة جاهزة على /spicy");
  return {
    rooms,
    /* للاختبارات: يمرّ بمسار «بعد كلّ فعل» (بثٌّ ومهلٌ ونهاية) بعد تعديلٍ مباشر */
    _tick(code) { const r = rooms.get(String(code)); if (r) after(r); },
    liveStats: () => {
      let online = 0, playing = 0;
      for (const r of rooms.values()) { online += present(r).length; if (r.match) playing++; }
      return { online, rooms: [...rooms.values()], playing };
    }
  };
}

module.exports = { setupSpicyOnline, DEFAULTS, sanitize, TURN_SECS, RESULT_SECS };
