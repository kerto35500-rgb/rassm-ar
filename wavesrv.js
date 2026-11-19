/* 📡 «التخاطر» أونلاين — مساحة ‎/wave‎.
 *
 * القواعد في waverules.js؛ وهنا الغرف والفريقان والمؤقّتات والبثّ.
 *
 *  ١) الهدفُ لا يغادر الخادم إلا إلى الوسيط (قبل أن يكتب) — ثمّ للجميع عند
 *     الكشف. الحجبُ هنا لا في المتصفّح.
 *  ٢) المؤشرُ حيّ: كلُّ تحريكٍ من محلّلٍ يُبثّ للغرفة فورًا رسالةً خفيفة
 *     («dial») لا حالةً كاملة — فيتحرّك عند الجميع بسلاسة.
 *  ٣) لكلّ مرحلةٍ مهلةٌ يختارها المضيف (أو بلا وقت)؛ وفريقٌ لا حاضرَ فيه ⇒
 *     تتوقّف الساعة.
 */
"use strict";

const { WaveMatch } = require("./waverules");
const WB = require("./wavebank");
const FILTER = require("./chatfilter");
const { nameFromSocket } = require("./account");

const MAX_PLAYERS = 12, MIN_PLAYERS = 4, TEAM_MAX = 6;
const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const PSY_GRACE_MS = 15 * 1000;
const CHAT_KEEP = 60;
const CLUE_SECS = [60, 90, 120, 0], DIAL_SECS = [60, 120, 180, 0], GUESS_SECS = [30, 45, 60, 0], WINS = [7, 10, 15];
const REVEAL_SECS = 20;
const DIAL_EVERY_MS = 30;
const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").trim().slice(0, n);
const normName = n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().toLowerCase();

const DEFAULTS = Object.freeze({ clueSecs: 90, dialSecs: 120, guessSecs: 45, win: 10 });
function sanitize(d, old) {
  const S = { ...old };
  if (!d || typeof d !== "object") return S;
  if (CLUE_SECS.includes(+d.clueSecs)) S.clueSecs = +d.clueSecs;
  if (DIAL_SECS.includes(+d.dialSecs)) S.dialSecs = +d.dialSecs;
  if (GUESS_SECS.includes(+d.guessSecs)) S.guessSecs = +d.guessSecs;
  if (WINS.includes(+d.win)) S.win = +d.win;
  return S;
}

function setupWaveOnline(io, deps = {}) {
  const nsp = io.of("/wave");
  const st = () => deps.store;
  const graceMs = deps.graceMs != null ? deps.graceMs : GRACE_MS;
  const psyGraceMs = deps.psyGraceMs != null ? deps.psyGraceMs : PSY_GRACE_MS;
  const secsScale = deps.secsScale != null ? deps.secsScale : 1;
  const deal = deps.deal || (used => WB.deal(Math.random, used));
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
  const sockOf = p => p && p.sockId ? nsp.sockets.get(p.sockId) : null;

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: { ...r.settings }, playing: !!r.match,
      min: MIN_PLAYERS, max: MAX_PLAYERS, teamMax: TEAM_MAX,
      players: r.players.map(p => ({ id: p.id, name: p.name, team: p.team, host: p.id === r.hostId, gone: !!p.gone, registered: !!p.userId })),
      lastResult: r.lastResult
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));

  function flush(r) {
    const m = r.match;
    if (!m) return;
    const events = m.takeEvents();
    for (const p of r.players) {
      const s = sockOf(p);
      if (!s) continue;
      s.emit("state", { ...m.view(p.id), events, deadline: r.deadline || 0, span: r.span || 0, serverNow: Date.now(),
                        paused: !!r.paused, settings: { ...r.settings } });
    }
  }
  function clearTimer(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.deadline = 0; r.span = 0;
  }
  const secsOf = (r, phase) => phase === "clue" ? r.settings.clueSecs : phase === "dial" ? r.settings.dialSecs
    : phase === "guess" ? r.settings.guessSecs : phase === "reveal" ? REVEAL_SECS : 0;
  const teamsHere = r => [0, 1].every(t => r.match.onlineIn(t) > 0);

  function after(r) {
    touch(r);
    const m = r.match;
    if (!m) return;
    if (m.phase === "over") { clearTimer(r); r.paused = false; flush(r); return finish(r); }
    if (!teamsHere(r)) { clearTimer(r); r.stage = null; r.paused = true; flush(r); return; }
    r.paused = false;
    const key = m.round + ":" + m.phase;
    if (r.stage !== key) {
      clearTimer(r);
      r.stage = key;
      const secs = secsOf(r, m.phase);
      if (secs) {
        const ms = secs * 1000 * secsScale;
        r.deadline = Date.now() + ms; r.span = secs * 1000;
        r.timer = setTimeout(() => {
          r.timer = null;
          if (r.match !== m || r.stage !== key) return;
          try { m.timeout(); } catch (e) { /* تبدّلت المرحلة */ }
          after(r);
        }, ms + (m.phase === "reveal" ? 0 : 300 * secsScale));
      }
    }
    flush(r);
  }

  async function finish(r) {
    clearTimer(r);
    const m = r.match;
    if (!m || m._done) return;
    m._done = true;
    const names = Object.fromEntries(m.players.map(p => [p.id, p.name]));
    r.lastResult = { winner: m.winner, scores: m.teams.map(T => T.score), at: Date.now() };
    nsp.to(r.code).emit("matchEnd", { winner: m.winner, scores: m.teams.map(T => T.score), names, history: m.history,
                                      teams: m.teams.map(T => T.players.slice()) });
    const finishers = r.players.filter(p => !p.gone && p.userId);
    const teamOf = Object.fromEntries(m.players.map(p => [p.id, p.team]));
    r.match = null; r.stage = null; r.paused = false;
    r.players = r.players.filter(p => !p.gone);
    if (!r.players.some(p => p.id === r.hostId)) r.hostId = r.players[0] ? r.players[0].id : null;
    sendLobby(r);
    for (const p of finishers) {
      if (!st()) break;
      const t = teamOf[p.id];
      try { await st().bumpGameStats(p.userId, "wave", { games: 1, wins: m.winner === t ? 1 : 0, score: t != null ? m.teams[t].score : 0 }); }
      catch (e) { /* الإحصاءُ لا يُعطّل اللعبة */ }
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!present(r).length && now - r.touched > graceMs)) { clearTimer(r); rooms.delete(code); }
    }
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();

  const smallerTeam = r => inTeam(r, 1).length < inTeam(r, 0).length ? 1 : 0;

  nsp.on("connection", socket => {
    let room = null, me = null, lastChat = 0, lastDial = 0;

    socket.emit("hello", { defaults: DEFAULTS, clueSecs: CLUE_SECS, dialSecs: DIAL_SECS, guessSecs: GUESS_SECS, wins: WINS,
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
      if (r.chat.length) socket.emit("chatLog", r.chat.slice(-CHAT_KEEP));
      if (r.match) flush(r);
    }

    socket.on("createRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const r = { code: newCode(), hostId: null, touched: Date.now(), settings: { ...DEFAULTS },
                  players: [], match: null, timer: null, deadline: 0, span: 0, stage: null, paused: false,
                  chat: [], lastResult: null };
      rooms.set(r.code, r);
      const p = identity(d && d.name, 0);
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
      if (present(r).length >= MAX_PLAYERS) return cb({ ok: false, error: "الغرفة ممتلئة" });
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
    socket.on("team", d => {
      if (!mine() || room.match) return;
      const t = +(d && d.team) === 1 ? 1 : 0;
      if (me.team === t) return;
      if (inTeam(room, t).length >= TEAM_MAX) return err("الفريقُ ممتلئ");
      me.team = t;
      touch(room); sendLobby(room);
    });
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
      if (a.length < 2 || b.length < 2) return err("لكلّ فريقٍ لاعبان على الأقلّ (٤ لاعبين فأكثر)");
      room.players = ps;
      try {
        room.match = new WaveMatch(ps.map(p => ({ id: p.id, name: p.name, team: p.team })),
                                   { deal, key: WB.key, win: room.settings.win });
      } catch (e) { return err(e.message); }
      room.lastResult = null; room.stage = null; room.paused = false;
      nsp.to(room.code).emit("started", {});
      sendLobby(room);
      after(room);
    });

    function act(fn) {
      return d => {
        if (!mine() || !room.match) return;
        try { fn(room.match, me.id, d || {}); }
        catch (e) { return err(e.message || "فعلٌ غير مقبول"); }
        after(room);
      };
    }
    socket.on("clue", act((m, id, d) => {
      const c = FILTER.check(d.text);
      if (!c.ok) throw new Error(c.why);
      m.submitClue(id, c.text);
    }));
    socket.on("reroll", act((m, id) => m.reroll(id)));
    socket.on("agree", act((m, id, d) => m.agree(id, d.on !== false)));
    socket.on("vote", act((m, id, d) => m.vote(id, d.side === "right" ? "right" : "left")));
    socket.on("next", act((m, id) => m.readyNext(id)));

    /* المؤشرُ الحيّ: رسالةٌ خفيفةٌ للغرفة كلّها مع كلّ تحريك (حتى ٣٣ في الثانية).
       وإن أسقط التحريكُ موافقاتٍ قائمةً بُثّت الحالةُ كاملةً ليعرف الجميع */
    socket.on("dial", d => {
      if (!mine() || !room.match) return;
      const now = Date.now();
      if (now - lastDial < DIAL_EVERY_MS && !(d && d.end)) return;
      lastDial = now;
      const m = room.match;
      const hadOk = m.phase === "dial" && m.cur.ok.size > 0;
      let moved;
      try { moved = m.setDial(me.id, d && d.a); } catch (e) { return; }
      if (moved) nsp.to(room.code).emit("dial", { a: m.cur.dial, by: me.id });
      if (hadOk && !m.cur.ok.size) after(room);
      touch(room);
    });

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

    function leave(deliberate) {
      if (!room || !me) return;
      const r = room, p = me;
      room = null; me = null;
      socket.leave(r.code);
      if (!r.players.includes(p)) return;
      if (p.sockId && p.sockId !== socket.id) return;
      p.sockId = null;
      const gen = p._leaveGen = (p._leaveGen || 0) + 1;
      const drop = () => {
        if (!r.players.includes(p)) return;
        p.gone = true;
        const m = r.match;
        if (m) {
          m.setOnline(p.id, false);
          m.reassignPsychic();
          if (!r.players.some(x => x.team === p.team && !x.gone)) {
            /* فريقٌ غاب كلُّه: يفوز الآخر */
            m.winner = 1 - p.team; m.phase = "over"; m.ev({ t: "over", winner: m.winner, forfeit: true });
          }
        } else r.players = r.players.filter(x => x !== p);
        if (r.hostId === p.id) { const nx = r.players.find(x => !x.gone); r.hostId = nx ? nx.id : null; }
        if (r.match) after(r);
        sendLobby(r);
        if (!present(r).length) { clearTimer(r); rooms.delete(r.code); }
      };
      if (deliberate || !r.match) { drop(); return; }
      r.match.setOnline(p.id, false);
      p.gone = true;
      sendLobby(r);
      after(r);
      if (r.match && r.match.isPsychic(p.id) && r.match.phase === "clue") {
        setTimeout(() => {
          if (p._leaveGen !== gen || p.sockId || !r.match) return;
          if (r.match.reassignPsychic()) after(r);
        }, psyGraceMs);
      }
      setTimeout(() => { if (p._leaveGen !== gen || p.sockId) return; drop(); }, graceMs);
    }
  });

  console.log("📡 التخاطر جاهزة على /wave");
  return {
    rooms,
    _tick(code) { const r = rooms.get(String(code)); if (r) after(r); },
    liveStats: () => {
      let online = 0, playing = 0;
      for (const r of rooms.values()) { online += present(r).length; if (r.match) playing++; }
      return { online, rooms: [...rooms.values()], playing };
    }
  };
}

module.exports = { setupWaveOnline, DEFAULTS, sanitize, REVEAL_SECS };
