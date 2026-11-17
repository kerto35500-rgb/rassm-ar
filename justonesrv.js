/* 🔤 «كلمة واحدة فقط» أونلاين — مساحة ‎/justone‎.
 *
 * القواعد في justonerules.js؛ وهنا الغرف والمؤقّتات والبثّ.
 *
 *  ١) لكلّ لاعبٍ حالتُه وحده: المخمّنُ لا تصله الكلمةُ ولا التلميحات قبل
 *     وقتها — الحجبُ هنا على الخادم، لا في المتصفّح حيث تقرؤه أدواتُ المطوّر.
 *  ٢) لكلّ مرحلةٍ مهلةٌ تبدأ مع المرحلة ولا تتجدّد بأفعال اللاعبين فيها؛ وما
 *     لم يُفعل حين تنقضي يُكمَل (رقمٌ عشوائيّ، أو إغلاقٌ، أو تخطٍّ).
 *  ٣) ما يكتبه المخمّنُ يُبثّ حيًّا للبقيّة كما في وثيقة التصميم.
 *  ٤) الدردشةُ لا تُسرّب: الملمّحُ لا يكتب فيها الكلمةَ ولا تلميحًا قبل الكشف.
 *     (والمخمّنُ لا يُردّ عليه بسبب الكلمة — وإلا صارت الدردشةُ عرّافًا يُجرّب
 *     فيه الكلمات حتى يُرفض أحدُها.)
 *  ٥) إن بقي حاضرٌ واحد توقّفت الساعة (لا تحترق بطاقاتُ الفريق وأصحابُه
 *     ينقطعون)، فإن لم يعد أحدٌ في المهلة انتهت المباراة.
 */
"use strict";

const { JustOneMatch, rating } = require("./justonerules");
const JB = require("./justonebank");
const N = require("./public/justone/norm");
const FILTER = require("./chatfilter");
const { nameFromSocket } = require("./account");

const MAX_PLAYERS = 7, MIN_PLAYERS = 3;
const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const CHAT_KEEP = 50;
const CLUE_SECS = [45, 60, 90, 120], GUESS_SECS = [45, 60, 90];
const PHASE_SECS = { pick: 20, review: 25, reveal: 8 };
const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").trim().slice(0, n);

const DEFAULTS = Object.freeze({ clueSecs: 60, guessSecs: 60 });
function sanitize(d, old) {
  const S = { ...old };
  if (!d || typeof d !== "object") return S;
  if (CLUE_SECS.includes(+d.clueSecs)) S.clueSecs = +d.clueSecs;
  if (GUESS_SECS.includes(+d.guessSecs)) S.guessSecs = +d.guessSecs;
  return S;
}

/** هل في الرسالة الكلمةُ السرّيّة (أو من عائلتها)، أو أحدُ التلميحات؟ */
function leaks(text, m) {
  const words = String(text).split(/[\s،,.!؟?؛:«»"'()\-_]+/).filter(Boolean);
  if (m.secret && (N.related(text, m.secret) || words.some(w => N.related(w, m.secret)))) return "secret";
  const ns = new Set((m.clues || []).map(c => c.n).filter(Boolean));
  if (ns.size && (ns.has(N.norm(text)) || words.some(w => ns.has(N.norm(w))))) return "clue";
  return null;
}

function setupJustOneOnline(io, deps = {}) {
  const nsp = io.of("/justone");
  const st = () => deps.store;
  const graceMs = deps.graceMs != null ? deps.graceMs : GRACE_MS;
  /* للاختبارات: تقصيرُ المهل (١ = الزمن الحقيقيّ) */
  const secsScale = deps.secsScale != null ? deps.secsScale : 1;
  const rooms = new Map();

  function newCode() {
    for (let t = 0; t < 400; t++) {
      const c = String(10000 + Math.floor(Math.random() * 90000));
      if (!rooms.has(c)) return c;
    }
    return String(Date.now()).slice(-6);
  }
  const touch = r => { r.touched = Date.now(); };
  const present = r => r.players.filter(p => !p.gone);

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: { ...r.settings }, playing: !!r.match,
      min: MIN_PLAYERS, max: MAX_PLAYERS,
      players: r.players.map(p => ({ id: p.id, name: p.name, host: p.id === r.hostId, gone: !!p.gone, registered: !!p.userId })),
      lastResult: r.lastResult
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));

  /* ── الحالة: لكلّ لاعبٍ عرضُه هو ── */
  function flush(r) {
    const m = r.match;
    if (!m) return;
    const events = m.takeEvents();
    for (const p of r.players) {
      if (!p.sockId) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      s.emit("state", { ...m.view(p.id), events, deadline: r.deadline || 0, serverNow: Date.now(),
                        paused: !!r.paused, settings: { ...r.settings } });
    }
  }

  function clearTimer(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.deadline = 0;
  }
  /* «مرحلةٌ» = جولة + طور + عددُ مرّات «ما أعرفها» (العودةُ إلى الاختيار مرحلةٌ جديدة) */
  const stageOf = m => `${m.round}:${m.phase}:${m.unknowns || 0}`;

  /** بعد كلّ فعل: بثٌّ؛ ومهلةٌ جديدةٌ إن بدأت مرحلةٌ جديدة فقط. */
  function after(r) {
    touch(r);
    const m = r.match;
    if (!m) return;
    if (m.phase === "over") { clearTimer(r); r.paused = false; flush(r); return finish(r); }
    if (m.onlineCount() < 2) {
      clearTimer(r); r.stage = null; r.paused = true;
      flush(r); return;
    }
    r.paused = false;
    const key = stageOf(m);
    if (r.timer && r.stage === key) { flush(r); return; }
    clearTimer(r);
    r.stage = key;
    const secs = m.phase === "clues" ? r.settings.clueSecs
      : m.phase === "guess" ? r.settings.guessSecs
      : PHASE_SECS[m.phase] || 20;
    const ms = secs * 1000 * secsScale;
    r.deadline = Date.now() + ms;
    /* سماحٌ صغيرٌ لما في الطريق من الشبكة — إلا الكشف فلا ينتظر أحدًا */
    r.timer = setTimeout(() => {
      r.timer = null;
      if (r.match !== m || stageOf(m) !== key) return;
      try { m.timeout(); } catch (e) { /* مرحلةٌ تبدّلت للتوّ */ }
      after(r);
    }, ms + (m.phase === "reveal" ? 0 : 300 * secsScale));
    flush(r);
  }

  async function finish(r) {
    clearTimer(r);
    const m = r.match;
    if (!m || m._done) return;
    m._done = true;
    const rt = rating(m.score);
    const names = Object.fromEntries(m.players.map(p => [p.id, p.name]));
    r.lastResult = { score: m.score, cards: m.cardsTotal, rating: rt, at: Date.now() };
    nsp.to(r.code).emit("matchEnd", {
      score: m.score, cards: m.cardsTotal, rating: rt, names,
      history: m.history.map(h => ({ ...h, clues: h.clues.map(c => ({ ...c })) }))
    });
    /* من بقي حتى النهاية يُحسب له اللعب (الخارجُ لا) */
    const finishers = r.players.filter(p => !p.gone && p.userId);
    r.match = null;
    r.stage = null; r.paused = false;
    r.players = r.players.filter(p => !p.gone);
    if (!r.players.some(p => p.id === r.hostId)) r.hostId = r.players[0] ? r.players[0].id : null;
    sendLobby(r);
    /* الإحصاءاتُ للمسجَّلين — بلا ذهب. «فوزُ» لعبةٍ تعاونيّة: تصنيفُ «مذهل» فما فوق */
    for (const p of finishers) {
      if (!st()) break;
      try { await st().bumpGameStats(p.userId, "justone", { games: 1, wins: m.score >= 10 ? 1 : 0, score: m.score, best: m.score }); }
      catch (e) { /* الإحصاءُ لا يُعطّل اللعبة */ }
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!present(r).length && now - r.touched > graceMs)) {
        clearTimer(r); rooms.delete(code);
      }
    }
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();

  nsp.on("connection", socket => {
    let room = null, me = null, lastChat = 0, lastType = 0;

    socket.emit("hello", { defaults: DEFAULTS, clueSecs: CLUE_SECS, guessSecs: GUESS_SECS,
                           min: MIN_PLAYERS, max: MAX_PLAYERS, you: nameFromSocket(socket) || socket.userName || null });

    const err = msg => socket.emit("toast", msg);
    const isHost = () => room && me && room.hostId === me.id && room.players.includes(me);

    function identity(name) {
      const acct = nameFromSocket(socket) || socket.userName || null;
      return { id: rid(), token: rid() + rid(), name: acct || clean(name, 20) || "لاعب",
               userId: socket.userId || null, sockId: socket.id, gone: false };
    }
    function enter(r, p, cb, extra) {
      room = r; me = p;
      socket.join(r.code);
      if (!r.hostId) r.hostId = p.id;
      cb && cb({ ok: true, roomId: r.code, you: p.id, token: p.token, ...(extra || {}) });
      sendLobby(r);
      if (r.chat.length) socket.emit("chatLog", r.chat.slice(-CHAT_KEEP));
      /* العائدُ يأخذ حالتَه دون أن تتجدّد مهلةُ المرحلة — وإلا صار الانقطاعُ
         والعودة طريقةً لإطالة الوقت */
      if (r.match) flush(r);
    }

    socket.on("createRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const r = { code: newCode(), hostId: null, touched: Date.now(), settings: { ...DEFAULTS },
                  players: [], match: null, timer: null, deadline: 0, stage: null, paused: false,
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
      if (r.match) return cb({ ok: false, error: "اللعبة جارية — انتظر انتهاءها" });
      if (present(r).length >= MAX_PLAYERS) return cb({ ok: false, error: "الغرفة ممتلئة (٧ لاعبين)" });
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
      if (p.sockId && p.sockId !== socket.id && nsp.sockets.get(p.sockId))
        return cb({ ok: false, error: "الجلسة مفتوحةٌ في مكانٍ آخر" });
      if (room && room !== r) leave(true);
      p.sockId = socket.id; p.gone = false;
      p._leaveGen = (p._leaveGen || 0) + 1;      /* أيُّ مؤقّتِ مغادرةٍ معلّقٍ صار قديمًا */
      if (r.match) r.match.setOnline(p.id, true);
      enter(r, p, cb, { resumed: true });
      /* عودتُه قد تُكمل مرحلةً (أو تُعيد الساعةَ إن كانت متوقّفة) */
      if (r.match && (r.paused || stageOf(r.match) !== r.stage)) after(r);
    });

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
      if (p.sockId) { const s = nsp.sockets.get(p.sockId); if (s) { s.emit("kicked"); s.leave(room.code); } }
      sendLobby(room);
    });

    socket.on("startGame", () => {
      if (!isHost() || room.match) return;
      const ps = present(room);
      if (ps.length < MIN_PLAYERS) return err("اللعبة تحتاج ثلاثة لاعبين على الأقلّ");
      room.players = ps;
      try {
        room.match = new JustOneMatch(ps.map(p => ({ id: p.id, name: p.name })),
                                      { deal: used => JB.deal(Math.random, used) });
      } catch (e) { return err(e.message); }
      room.lastResult = null; room.stage = null; room.paused = false;
      nsp.to(room.code).emit("started", {});
      sendLobby(room);
      after(room);
    });

    /* ── أفعال الجولة ── */
    function act(fn) {
      return d => {
        if (!room || !room.match || !me || !room.players.includes(me)) return;
        try { fn(room.match, me.id, d || {}); }
        catch (e) { return err(e.message || "فعلٌ غير مقبول"); }
        after(room);
      };
    }
    socket.on("pick", act((m, id, d) => m.pick(id, +d.n)));
    socket.on("unknown", act((m, id) => m.unknown(id)));
    socket.on("clues", act((m, id, d) => {
      const list = (Array.isArray(d.list) ? d.list : [d.list]).slice(0, 2)
        .map(x => String(x == null ? "" : x).slice(0, 24));
      /* التلميحُ يمرّ بمرشّح الدردشة: لا لفظَ ولا رابطَ ولا رقمَ هاتف */
      for (const t of list) {
        if (!t.trim()) continue;
        const c = FILTER.check(t);
        if (!c.ok) throw new Error(c.why);
      }
      m.submit(id, list);
    }));
    socket.on("strike", act((m, id, d) => m.strike(id, +d.id)));
    socket.on("ready", act((m, id) => m.reviewReady(id)));
    socket.on("guess", act((m, id, d) => m.guessWord(id, d.text)));
    socket.on("skip", act((m, id) => m.skip(id)));

    /* ما يكتبه المخمّنُ يصل البقيّةَ حيًّا (بثٌّ لا يغيّر شيئًا في اللعبة) */
    socket.on("typing", d => {
      if (!room || !room.match || !me) return;
      const m = room.match;
      if (m.phase !== "guess" || !m.isGuesser(me.id)) return;
      const now = Date.now();
      if (now - lastType < 60) return;
      lastType = now;
      socket.to(room.code).emit("typing", { by: me.id, text: clean(d && d.text, 24) });
    });

    socket.on("chat", d => {
      if (!room || !me || !room.players.includes(me)) return;
      const now = Date.now();
      if (now - lastChat < 700) return;
      lastChat = now;
      const c = FILTER.check(d && d.text);
      if (!c.ok) return err(c.why);
      /* الملمّحُ يعرف الكلمة: لا يكتبها ولا تلميحًا في الدردشة قبل الكشف */
      const m = room.match;
      if (m && !["reveal", "over"].includes(m.phase) && !m.isGuesser(me.id)) {
        const why = leaks(c.text, m);
        if (why === "secret") return err("🤫 لا تكتب الكلمة السرّيّة في الدردشة");
        if (why === "clue") return err("🤫 التلميحاتُ لا تُكتب في الدردشة");
      }
      const msg = { id: me.id, name: me.name, text: c.text, at: now };
      room.chat.push(msg);
      if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
      nsp.to(room.code).emit("chat", msg);
    });

    /* من خرج عمدًا يُزال؛ ومن انقطع أثناء اللعب يغيب عن الجولة فورًا (لا
       تنتظره مرحلة) ويُمهَل ليعود، ثمّ يُزال إن لم يعد. */
    function leave(deliberate) {
      if (!room || !me) return;
      const r = room, p = me;
      room = null; me = null;
      socket.leave(r.code);
      if (!r.players.includes(p)) return;
      p.sockId = null;
      const gen = p._leaveGen = (p._leaveGen || 0) + 1;
      const drop = () => {
        if (!r.players.includes(p)) return;
        p.gone = true;
        if (r.match) {
          r.match.setOnline(p.id, false);
          /* لا تُلعب «كلمة واحدة» بلاعبٍ واحد */
          if (r.match.onlineCount() < 2) r.match.finish();
        } else {
          r.players = r.players.filter(x => x !== p);
        }
        if (r.hostId === p.id) {
          const nx = r.players.find(x => !x.gone);
          r.hostId = nx ? nx.id : null;
        }
        if (r.match) after(r);
        sendLobby(r);
        if (!present(r).length) { clearTimer(r); rooms.delete(r.code); }
      };
      if (deliberate || !r.match) { drop(); return; }
      r.match.setOnline(p.id, false);
      p.gone = true;
      sendLobby(r);
      after(r);
      setTimeout(() => {
        if (p._leaveGen !== gen || p.sockId) return;   /* عاد، أو مغادرةٌ أحدث تتولّى الأمر */
        drop();
      }, graceMs);
    }
  });

  console.log("🔤 كلمة واحدة فقط جاهزة على /justone");
  return {
    rooms,
    /* للاختبارات: تنقضي مهلةُ المرحلة الآن (المسارُ نفسُه الذي يسلكه المؤقّت) */
    _expire(code) {
      const r = rooms.get(String(code));
      if (!r || !r.match) return;
      clearTimer(r); r.stage = null;
      try { r.match.timeout(); } catch (e) { /* لا شيء ينقضي */ }
      after(r);
    },
    liveStats: () => {
      let online = 0, playing = 0;
      for (const r of rooms.values()) { online += present(r).length; if (r.match) playing++; }
      return { online, rooms: [...rooms.values()], playing };
    }
  };
}

module.exports = { setupJustOneOnline, DEFAULTS, sanitize, leaks, PHASE_SECS };
