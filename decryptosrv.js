/* 🔐 «فكّ الشفرة» أونلاين — مساحة ‎/decrypto‎.
 *
 * القواعد في decryptorules.js؛ وهنا الغرف والفرق والمؤقّتات والبثّ.
 *
 *  ١) لكلّ لاعبٍ حالتُه وحده: كلماتُ الخصم وشفرتُه وورقةُ تخمينه لا تغادر
 *     الخادم إليه — الحجبُ هنا لا في المتصفّح حيث تقرؤه أدواتُ المطوّر.
 *  ٢) دردشتان: عامّةٌ للجميع، وسرّيّةٌ لكلّ فريق لا يصل الخصمَ منها حرف.
 *     والمُشفِّرُ صامتٌ (في الاثنتين) من بداية الجولة حتى يقفل فريقُه فكَّ
 *     شفرته — وإلا صار التلميحُ شرحًا. ولا تُكتب كلماتُ الفريق في العامّة.
 *  ٣) لكلّ مرحلةٍ مهلةٌ يختارها المضيف (أو بلا وقت)، وساعةُ الرمل: إذا أرسل
 *     أحدُ المُشفِّرَين تلميحاته بقي للآخر ٤٥ ثانيةً على الأكثر.
 *  ٤) فريقٌ لا حاضرَ فيه ⇒ تتوقّف الساعة؛ فإن غاب كلُّه نهائيًّا خسر.
 */
"use strict";

const { DecryptoMatch } = require("./decryptorules");
const JB = require("./justonebank");
const N = require("./public/justone/norm");
const FILTER = require("./chatfilter");
const { nameFromSocket } = require("./account");

const MAX_PLAYERS = 8, MIN_PLAYERS = 4, TEAM_MAX = 4;
const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
/* المُشفِّرُ انقطع قبل أن يرسل: يتسلّم زميلُه بعد هذه المدّة */
const ENC_GRACE_MS = 15 * 1000;
const CHAT_KEEP = 60;
const CLUE_SECS = [60, 90, 120, 180, 0], GUESS_SECS = [60, 90, 120, 180, 0];
const SAND_SECS = 45, REVEAL_SECS = 25;
const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").trim().slice(0, n);
const normName = n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().toLowerCase();

const DEFAULTS = Object.freeze({ clueSecs: 120, guessSecs: 120 });
function sanitize(d, old) {
  const S = { ...old };
  if (!d || typeof d !== "object") return S;
  if (CLUE_SECS.includes(+d.clueSecs)) S.clueSecs = +d.clueSecs;
  if (GUESS_SECS.includes(+d.guessSecs)) S.guessSecs = +d.guessSecs;
  return S;
}

function setupDecryptoOnline(io, deps = {}) {
  const nsp = io.of("/decrypto");
  const st = () => deps.store;
  const graceMs = deps.graceMs != null ? deps.graceMs : GRACE_MS;
  const encGraceMs = deps.encGraceMs != null ? deps.encGraceMs : ENC_GRACE_MS;
  /* للاختبارات: تقصيرُ المهل (١ = الزمن الحقيقيّ) */
  const secsScale = deps.secsScale != null ? deps.secsScale : 1;
  const deal = deps.deal || (n => JB.deal(Math.random, null, n));
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
  const inTeam = (r, t) => present(r).filter(p => p.team === t);

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: { ...r.settings }, playing: !!r.match,
      min: MIN_PLAYERS, max: MAX_PLAYERS, teamMax: TEAM_MAX,
      players: r.players.map(p => ({ id: p.id, name: p.name, team: p.team, host: p.id === r.hostId,
                                     gone: !!p.gone, registered: !!p.userId })),
      lastResult: r.lastResult
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));
  const sockOf = p => p && p.sockId ? nsp.sockets.get(p.sockId) : null;

  /* ── الحالة: لكلّ لاعبٍ عرضُه هو ── */
  function flush(r) {
    const m = r.match;
    if (!m) return;
    const events = m.takeEvents();
    for (const p of r.players) {
      const s = sockOf(p);
      if (!s) continue;
      s.emit("state", { ...m.view(p.id), events, deadline: r.deadline || 0, serverNow: Date.now(),
                        paused: !!r.paused, sand: !!r.sanded && m.phase === "clues", total: r.total || 0,
                        settings: { ...r.settings } });
    }
  }

  function clearTimer(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.deadline = 0; r.total = 0;
  }
  function phaseSecs(r, phase) {
    if (phase === "clues") return r.settings.clueSecs;
    if (phase === "guess") return r.settings.guessSecs;
    if (phase === "reveal") return REVEAL_SECS;
    return 0;
  }
  function arm(r, m, secs) {
    const ms = secs * 1000 * secsScale;
    const key = r.stage;
    r.deadline = Date.now() + ms;
    r.total = secs * 1000;
    r.timer = setTimeout(() => {
      r.timer = null;
      if (r.match !== m || r.stage !== key) return;
      try { m.timeout(); } catch (e) { /* مرحلةٌ تبدّلت للتوّ */ }
      after(r);
    }, ms + (m.phase === "reveal" ? 0 : 300 * secsScale));
  }
  /* فريقٌ بلا حاضر: لا تمضي المهلةُ عليه */
  const teamsHere = r => [0, 1].every(t => r.match.onlineIn(t) > 0);

  /** بعد كلّ فعل: بثٌّ؛ ومهلةٌ جديدةٌ إن بدأت مرحلةٌ جديدة فقط، وساعةُ
      الرمل حين يرسل أوّلُ المُشفِّرَين. */
  function after(r) {
    touch(r);
    const m = r.match;
    if (!m) return;
    if (m.phase === "over") { clearTimer(r); r.paused = false; flush(r); return finish(r); }
    if (!teamsHere(r)) {
      clearTimer(r); r.stage = null; r.paused = true;
      flush(r); return;
    }
    r.paused = false;
    const key = m.round + ":" + m.phase;
    if (r.stage !== key) {
      clearTimer(r);
      r.stage = key; r.sanded = false;
      const secs = phaseSecs(r, m.phase);
      if (secs) arm(r, m, secs);
    }
    if (m.phase === "clues" && m.sentCount() === 1 && !r.sanded) {
      r.sanded = true;
      const left = r.deadline ? r.deadline - Date.now() : Infinity;
      if (left > SAND_SECS * 1000 * secsScale) { clearTimer(r); arm(r, m, SAND_SECS); }
    }
    flush(r);
  }

  async function finish(r) {
    clearTimer(r);
    const m = r.match;
    if (!m || m._done) return;
    m._done = true;
    const names = Object.fromEntries(m.players.map(p => [p.id, p.name]));
    r.lastResult = { winner: m.winner, reason: m.reason, tokens: m.teams.map(T => ({ ...T.tokens })), at: Date.now() };
    nsp.to(r.code).emit("matchEnd", {
      winner: m.winner, reason: m.reason, names,
      teams: m.teams.map(T => ({ words: T.secretWords.slice(), tokens: { ...T.tokens }, players: T.players.slice() })),
      history: m.history
    });
    const finishers = r.players.filter(p => !p.gone && p.userId);
    const teamOf = Object.fromEntries(m.players.map(p => [p.id, p.team]));
    r.match = null;
    r.stage = null; r.paused = false; r.sanded = false;
    r.players = r.players.filter(p => !p.gone);
    if (!r.players.some(p => p.id === r.hostId)) r.hostId = r.players[0] ? r.players[0].id : null;
    sendLobby(r);
    for (const p of finishers) {
      if (!st()) break;
      const t = teamOf[p.id];
      try {
        await st().bumpGameStats(p.userId, "decrypto", {
          games: 1, wins: m.winner === t ? 1 : 0, score: t != null ? m.teams[t].tokens.intercept : 0
        });
      } catch (e) { /* الإحصاءُ لا يُعطّل اللعبة */ }
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

  /** الفريقُ الأقلّ عددًا (والأزرقُ عند التساوي) */
  function smallerTeam(r) {
    const a = inTeam(r, 0).length, b = inTeam(r, 1).length;
    return b < a ? 1 : 0;
  }

  nsp.on("connection", socket => {
    let room = null, me = null, lastChat = 0;

    socket.emit("hello", { defaults: DEFAULTS, clueSecs: CLUE_SECS, guessSecs: GUESS_SECS, sandSecs: SAND_SECS,
                           revealSecs: REVEAL_SECS, min: MIN_PLAYERS, max: MAX_PLAYERS, teamMax: TEAM_MAX,
                           you: nameFromSocket(socket) || socket.userName || null });

    const err = msg => socket.emit("toast", msg);
    const isHost = () => room && me && room.hostId === me.id && room.players.includes(me);
    const mine = () => !!(room && me && room.players.includes(me) && me.sockId === socket.id);

    function identity(name, team) {
      const acct = nameFromSocket(socket) || socket.userName || null;
      return { id: rid(), token: rid() + rid(), name: acct || clean(name, 20) || "لاعب",
               userId: socket.userId || null, sockId: socket.id, gone: false, team };
    }
    function enter(r, p, cb, extra) {
      room = r; me = p;
      socket.join(r.code);
      if (!r.hostId) r.hostId = p.id;
      cb && cb({ ok: true, roomId: r.code, you: p.id, token: p.token, ...(extra || {}) });
      sendLobby(r);
      socket.emit("chatLog", { all: r.chat.slice(-CHAT_KEEP), team: (r.match && r.teamChat[p.team] || []).slice(-CHAT_KEEP) });
      /* العائدُ يأخذ حالتَه دون أن تتجدّد مهلةُ المرحلة */
      if (r.match) flush(r);
    }

    socket.on("createRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const r = { code: newCode(), hostId: null, touched: Date.now(), settings: { ...DEFAULTS },
                  players: [], match: null, timer: null, deadline: 0, total: 0, stage: null, paused: false,
                  sanded: false, chat: [], teamChat: [[], []], lastResult: null };
      rooms.set(r.code, r);
      const p = identity(d && d.name, 0);
      r.players.push(p);
      enter(r, p, cb);
    });

    socket.on("joinRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(clean(d && d.roomId, 8));
      if (!r) return cb({ ok: false, error: "لا توجد غرفة بهذا الرمز" });
      /* اللعبةُ جارية: صاحبُ المقعد يعود إليه (برمز جهازه، أو حسابه، أو اسمه
         إن كان غائبًا) — وغيرُه ينتظر نهايتها */
      if (r.match) {
        const p = seatToReclaim(r, d);
        if (!p) return cb({ ok: false, error: "اللعبة جارية — انتظر انتهاءها" });
        return resume(r, p, cb);
      }
      if (present(r).length >= MAX_PLAYERS) return cb({ ok: false, error: "الغرفة ممتلئة (٨ لاعبين)" });
      const acct = socket.userId ? String(socket.userId) : null;
      if (acct && r.players.some(p => p.userId && String(p.userId) === acct && !p.gone))
        return cb({ ok: false, error: "حسابك موجودٌ في الغرفة" });
      if (room) leave(true);
      r.players = r.players.filter(p => !p.gone);
      const p = identity(d && d.name, smallerTeam(r));
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

    function seatToReclaim(r, d) {
      const tok = String(d && d.token || "");
      const acct = socket.userId ? String(socket.userId) : null;
      const nm = normName(d && d.name);
      return (tok && r.players.find(p => p.token === tok)) ||
             (acct && r.players.find(p => p.userId && String(p.userId) === acct)) ||
             (nm && r.players.find(p => p.gone && normName(p.name) === nm)) || null;
    }

    /** يعود صاحبُ المقعد إليه؛ وجلستُه القديمة (إن بقيت متّصلة) تُخبَر وتُغلَق */
    function resume(r, p, cb) {
      if (room && (room !== r || me !== p)) leave(true);
      const oldId = p.sockId;
      p.sockId = socket.id; p.gone = false;
      p._leaveGen = (p._leaveGen || 0) + 1;
      if (oldId && oldId !== socket.id) {
        const old = nsp.sockets.get(oldId);
        if (old) { old.emit("replaced"); if (typeof old.disconnect === "function") old.disconnect(true); }
      }
      if (r.match) r.match.setOnline(p.id, true);
      enter(r, p, cb, { resumed: true });
      if (r.match) after(r);
    }

    socket.on("leaveRoom", () => leave(true));
    socket.on("disconnect", () => leave(false));

    socket.on("updateSettings", d => {
      if (!isHost() || room.match) return;
      room.settings = sanitize(d, room.settings);
      touch(room); sendLobby(room);
    });

    /* اختيارُ الفريق في اللوبي: كلٌّ ينتقل بنفسه (ما لم يمتلئ الفريق) */
    socket.on("team", d => {
      if (!mine() || room.match) return;
      const t = +(d && d.team) === 1 ? 1 : 0;
      if (me.team === t) return;
      if (inTeam(room, t).length >= TEAM_MAX) return err("الفريقُ ممتلئ (٤ لاعبين)");
      me.team = t;
      touch(room); sendLobby(room);
    });
    /* المضيفُ يوزّع الحاضرين عشوائيًّا بالتساوي */
    socket.on("shuffle", () => {
      if (!isHost() || room.match) return;
      const ps = present(room).slice();
      for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
      const first = Math.random() < 0.5 ? 0 : 1;
      ps.forEach((p, i) => { p.team = i % 2 === 0 ? first : 1 - first; });
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
      const ps = present(room);
      const a = ps.filter(p => p.team === 0), b = ps.filter(p => p.team === 1);
      if (ps.length < MIN_PLAYERS || a.length < 2 || b.length < 2) return err("لكلّ فريقٍ لاعبان على الأقلّ (٤ لاعبين فأكثر)");
      if (a.length > TEAM_MAX || b.length > TEAM_MAX) return err("أربعةٌ في الفريق على الأكثر");
      room.players = ps;
      try {
        room.match = new DecryptoMatch(ps.map(p => ({ id: p.id, name: p.name, team: p.team })), { deal });
      } catch (e) { return err(e.message); }
      room.lastResult = null; room.stage = null; room.paused = false; room.sanded = false;
      room.teamChat = [[], []];
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
    socket.on("clues", act((m, id, d) => {
      const list = (Array.isArray(d.list) ? d.list : []).slice(0, 3).map(x => String(x == null ? "" : x).slice(0, 24));
      /* التلميحُ يمرّ بمرشّح الدردشة: لا لفظَ ولا رابط */
      for (const t of list) {
        if (!t.trim()) continue;
        const c = FILTER.check(t);
        if (!c.ok) throw new Error(c.why);
      }
      m.submitClues(id, list);
    }));
    socket.on("slot", act((m, id, d) => m.setSlot(id, d.kind === "int" ? "int" : "dec", +d.slot, d.value)));
    socket.on("confirm", act((m, id, d) => m.confirm(id, d.kind === "int" ? "int" : "dec", d.on !== false)));
    socket.on("next", act((m, id) => m.readyNext(id)));

    /* ── الدردشة: عامّةٌ وسرّيّةٌ للفريق ── */
    socket.on("chat", d => {
      if (!mine()) return;
      const now = Date.now();
      if (now - lastChat < 600) return;
      lastChat = now;
      const c = FILTER.check(d && d.text);
      if (!c.ok) return err(c.why);
      const m = room.match;
      const team = !!(d && d.team) && !!m;
      if (m && m.phase !== "over") {
        const t = me.team;
        /* المُشفِّرُ صامتٌ حتى يقفل فريقُه فكَّ شفرته (التلميحاتُ وحدها كلامُه) */
        if (m.isEncryptor(me.id) && (m.phase === "clues" || (m.phase === "guess" && !m.cur[t].dec.locked)))
          return err("🤐 أنت المُشفِّر — صامتٌ حتى يقفل فريقُك فكَّ شفرتك");
        if (!team) {
          const words = m.teams[t] ? m.teams[t].secretWords : [];
          const parts = String(c.text).split(/[\s،,.!؟?؛:«»"'()\-_]+/).filter(Boolean);
          if (words.some(w => N.related(c.text, w) || parts.some(x => N.related(x, w))))
            return err("🤫 لا تكتب كلماتِ فريقك في الدردشة العامّة — استعمل دردشة الفريق");
        }
      }
      const msg = { id: me.id, name: me.name, text: c.text, at: now, team: team ? me.team : null };
      if (team) {
        const log = room.teamChat[me.team];
        log.push(msg);
        if (log.length > CHAT_KEEP) log.splice(0, log.length - CHAT_KEEP);
        /* السرّيّةُ لأعضاء الفريق وحدهم — لا بثٌّ للغرفة */
        for (const p of room.players) if (p.team === me.team) { const s = sockOf(p); if (s) s.emit("chat", msg); }
      } else {
        room.chat.push(msg);
        if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
        nsp.to(room.code).emit("chat", msg);
      }
    });

    /* من خرج عمدًا (أو من اللوبي) يُزال؛ ومن انقطع أثناء اللعب يغيب فورًا
       (لا ينتظره أحدٌ في الموافقة) ويُمهَل ليعود. والمُشفِّرُ الذي لم يرسل
       يتسلّم زميلُه دورَه بعد ENC_GRACE. ثمّ يُزال من لم يعد: تُقفل ورقةٌ
       لم يبقَ من يعبّئها، ومن غاب فريقُه كلُّه خسر. */
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
        p.gone = true;
        const m = r.match;
        if (m) {
          m.setOnline(p.id, false);
          m.reassignEncryptor(p.team);
          m.lockOrphans();
          if (!r.players.some(x => x.team === p.team && !x.gone)) m.forfeit(p.team);
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
      if (r.match && r.match.isEncryptor(p.id) && r.match.phase === "clues") {
        setTimeout(() => {
          if (p._leaveGen !== gen || p.sockId || !r.match) return;
          if (r.match.reassignEncryptor(p.team)) after(r);
        }, encGraceMs);
      }
      setTimeout(() => {
        if (p._leaveGen !== gen || p.sockId) return;   /* عاد، أو مغادرةٌ أحدث تتولّى الأمر */
        drop();
      }, graceMs);
    }
  });

  console.log("🔐 فكّ الشفرة جاهزة على /decrypto");
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

module.exports = { setupDecryptoOnline, DEFAULTS, sanitize, SAND_SECS, REVEAL_SECS, CLUE_SECS, GUESS_SECS };
