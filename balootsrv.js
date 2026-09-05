// 🌐 «بالوت» أونلاين — الغرف والمقاعد والمباراة على الخادم.
//
// القواعد كلّها في balootrules.js، وهذا الملفّ لا يعرف كيف تُلعَب بالوت:
// يعرف من في الغرفة، ومن دوره، ومتى ينتهي وقته، ومتى تُمنَح الجائزة.
//
// وثلاثة أشياء لا يفعلها أبدًا:
//   • لا يُرسل حالةً كاملة. لكلّ لاعبٍ منظورُه (view) وفيه يده وحدها.
//   • لا يُصدّق العميل في شيء. الورقة تُلعَب باسمها، والخادم يتحقّق.
//   • لا يمنح ذهبًا لمباراةٍ فيها بوت. البوت لا يشتكي، فيسهل استغلاله.
//
// وبالوت أربعةٌ لا أقلّ: فريقان، المقعدان ٠و٢ فريق، و١و٣ فريق. فلا تبدأ
// المباراة بثلاثة، ولا تُملأ المقاعد إلا إلى الأربعة.

"use strict";

const B = require("./balootrules");
const BOT = require("./balootbot");
const { awardMatch } = require("./economy");

const SEATS = 4;
const CODE_LEN = 4;
const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const BOT_MIN = 900, BOT_MAX = 1800;
const HAND_PAUSE = 5000;            /* مهلةُ عرض نتيجة اليد قبل التالية */
const REDEAL_PAUSE = 1800;          /* الكلّ مرّ ⇐ إعادة توزيعٍ سريعة */

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rid = () => Math.random().toString(36).slice(2, 10);

/* الإعدادات التي يملك المضيفُ تغييرها، وحدودُها. ما ليس هنا لا يُغيَّر
   من العميل مهما أرسل — قائمةُ سماحٍ لا قائمةُ منع. */
const HOST_RULES = {
  targetScore: [102, 152, 202],
  turnSeconds: [0, 15, 20, 30],
  bidSeconds: [0, 10, 15, 25],
  allowAshkal: "bool", allowDouble: "bool", allowGahwa: "bool",
  projects: "bool", balootProject: "bool", fourOfKind: "bool",
  mustOvertrump: "bool", partnerWinningNoTrump: "bool", round2HokumSameSuit: "bool"
};

function setupBalootOnline(io, deps = {}) {
  const nsp = io.of("/baloot");
  const botMin = deps.botMin != null ? deps.botMin : BOT_MIN;
  const botMax = deps.botMax != null ? deps.botMax : BOT_MAX;
  const handPause = deps.handPause != null ? deps.handPause : HAND_PAUSE;
  const redealPause = deps.redealPause != null ? deps.redealPause : REDEAL_PAUSE;
  const rooms = new Map();
  const st = () => deps.store;

  const ipOf = s =>
    ((s.handshake.headers["x-forwarded-for"] || "").split(",")[0] ||
     s.handshake.address || "?").toString().replace(/^::ffff:/, "").trim();

  function newCode() {
    for (let t = 0; t < 200; t++) {
      let c = "";
      for (let i = 0; i < CODE_LEN; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)];
      if (!rooms.has(c)) return c;
    }
    return "R" + Date.now().toString(36).slice(-5).toUpperCase();
  }

  function makeRoom(code) {
    return {
      code, hostId: null, createdAt: Date.now(), touched: Date.now(),
      settings: { ...B.DEFAULTS, bots: true, botDiff: 2 },
      seats: [],
      match: null, timer: null, deadline: 0, botT: null, nextHandT: null, closed: false
    };
  }
  const touch = r => { r.touched = Date.now(); };
  const seatById = (r, id) => r.seats.findIndex(p => p.id === id);
  const humans = r => r.seats.filter(p => !p.bot);

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: publicSettings(r.settings),
      botsOn: !!r.settings.bots, max: SEATS,
      players: r.seats.map((p, i) => ({
        id: p.id, seat: i, team: i % 2, name: p.name, av: p.av, frame: p.frame,
        bot: p.bot, gone: !!p.gone, host: p.id === r.hostId
      }))
    };
  }
  const publicSettings = S => {
    const o = { bots: !!S.bots };
    for (const k of Object.keys(HOST_RULES)) o[k] = S[k];
    return o;
  };
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));

  const seatsPub = r => r.seats.map((p, i) => ({
    id: p.id, seat: i, team: i % 2, name: p.name, av: p.av, frame: p.frame,
    bot: !!p.bot, gone: !!p.gone
  }));

  /** الحالة لكلٍّ على حدة — لا تُبَثّ بثًّا واحدًا أبدًا. */
  function sendState(r, events) {
    if (!r.match) return;
    const players = seatsPub(r);
    for (let i = 0; i < r.seats.length; i++) {
      const p = r.seats[i];
      if (p.bot || !p.sockId) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      s.emit("state", {
        ...B.view(r.match, i, players),
        deadline: r.deadline || 0,
        events: events || []
      });
    }
  }
  function flush(r) {
    const ev = r.match ? r.match.takeEvents() : [];
    sendState(r, ev);
  }

  /* ── المؤقّت: من تأخّر يُلعب عنه أضعفَ فعلٍ مقبول ── */
  function clearTimer(r) { if (r.timer) { clearTimeout(r.timer); r.timer = null; } r.deadline = 0; }
  function clearBot(r) { if (r.botT) { clearTimeout(r.botT); r.botT = null; } }
  function clearNext(r) { if (r.nextHandT) { clearTimeout(r.nextHandT); r.nextHandT = null; } }

  const secsFor = (r, m) => Number(m.phase === "playing" ? r.settings.turnSeconds : r.settings.bidSeconds) || 0;

  function armTimer(r) {
    clearTimer(r);
    const m = r.match;
    if (!m || m.finished) return;
    const seat = m.actingSeat();
    if (seat == null) return;
    const p = r.seats[seat];
    if (!p || p.bot) return;
    const secs = secsFor(r, m);
    if (!secs) return;
    r.deadline = Date.now() + secs * 1000;
    r.timer = setTimeout(() => autoAct(r, m, seat), secs * 1000 + 250);
  }

  /* عند انتهاء الوقت نلعب عنه أقلَّ ما يُلزِمه: بسٌّ في الشراء والمضاعفة،
     وأرخصُ ورقةٍ مسموحة في اللعب. لا نشتري عنه ولا نضاعف — قرارٌ كهذا
     يُغيّر الصكّة كلَّها، ومن غاب لا يُقامَر بماله. */
  function autoAct(r, m, seat) {
    if (!r.match || r.match !== m || m.finished) return;
    if (m.actingSeat() !== seat) return;
    try {
      if (m.phase === "bidding") m.bid(seat, "pass");
      else if (m.phase === "doubling") m.double(seat, "pass");
      else if (m.phase === "playing") {
        const legal = m.legalMoves(seat);
        if (!legal.length) return;
        const cheap = legal.slice().sort((a, bb) =>
          B.cardValue(a, m.mode, m.trump) - B.cardValue(bb, m.mode, m.trump))[0];
        m.play(seat, cheap, {});
      } else return;
    } catch (e) { return; }
    m.ev({ t: "timeout", seat });
    after(r);
  }

  /* ── دور البوت ── */
  function scheduleBot(r) {
    clearBot(r);
    const m = r.match;
    if (!m || m.finished) return;
    const seat = m.actingSeat();
    if (seat == null) return;
    const p = r.seats[seat];
    if (!p || !p.bot) return;
    r.botT = setTimeout(() => {
      r.botT = null;
      /* اليد قد تكون انتهت بينما كان هذا المؤقّت في الطريق. لو تصرّفنا الآن
         تصرّفنا في يدٍ ماضية، وربّما أطلقنا يدًا جديدةً فوق أخرى. */
      if (!r.match || r.match !== m || m.finished) return;
      if (m.actingSeat() !== seat) return;
      const diff = Number(r.settings.botDiff) || 2;
      const a = BOT.botAction(m, seat, diff);
      if (!a) return;
      try {
        if (a.kind === "bid") m.bid(seat, a.choice, a.suit);
        else if (a.kind === "double") m.double(seat, a.choice);
        else m.play(seat, a.card, { declare: a.declare, baloot: a.baloot });
      } catch (e) { return; }
      after(r);
    }, botMin + Math.random() * Math.max(0, botMax - botMin));
  }

  /** بعد كلّ فعلٍ ناجح: بثٌّ، ثمّ ما يقتضيه الطور. */
  function after(r) {
    touch(r);
    const m = r.match;
    flush(r);
    if (!m) return;

    if (m.finished) return finish(r);

    if (m.phase === "redeal" || m.phase === "handover") {
      clearTimer(r); clearBot(r);
      if (r.nextHandT) return;                 /* لا تُجدوَل يدان معًا */
      const pause = m.phase === "redeal" ? redealPause : handPause;
      r.nextHandT = setTimeout(() => {
        r.nextHandT = null;
        if (!r.match || r.match !== m || m.finished) return;
        m.startHand();
        after(r);
      }, pause);
      return;
    }
    armTimer(r);
    scheduleBot(r);
  }

  /* ── نهاية الصكّة والجائزة ── */
  async function finish(r) {
    clearTimer(r); clearBot(r); clearNext(r);
    const m = r.match;
    if (!m || m._awarded) return;
    m._awarded = true;

    const winners = r.seats.filter((p, i) => i % 2 === m.winnerTeam);
    const hasBot = r.seats.some(p => p.bot);
    let reason = null, granted = [];
    if (hasBot) reason = "مباراةٌ فيها بوت — لا جائزة";
    else {
      try {
        const res = await awardMatch(st(), {
          game: "baloot",
          players: r.seats.map(p => ({ id: p.id, userId: p.userId, ip: p.ip, isBot: p.bot })),
          winnerIds: winners.map(p => p.id),
          matchId: r.code + ":" + m.handNo + ":" + r.createdAt
        });
        granted = res.granted || []; reason = res.reason || null;
      } catch (e) { console.error("baloot award:", e.message); }
    }

    for (let i = 0; i < r.seats.length; i++) {
      const p = r.seats[i];
      if (p.bot || !p.userId) continue;
      try {
        await st().bumpGameStats(p.userId, "baloot", {
          games: 1, wins: (i % 2 === m.winnerTeam) ? 1 : 0, score: m.scores[i % 2]
        });
      } catch (e) {}
    }

    const players = seatsPub(r);
    for (let i = 0; i < r.seats.length; i++) {
      const p = r.seats[i];
      if (p.bot || !p.sockId) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      const mine = granted.find(g => String(g.userId) === String(p.userId));
      s.emit("matchEnd", {
        winnerTeam: m.winnerTeam, myTeam: i % 2, won: (i % 2) === m.winnerTeam,
        scores: m.scores.slice(), hands: m.history.length, players,
        gold: mine ? mine.amount : 0,
        reason: p.userId ? reason : "الضيوف لا يكسبون ذهبًا — سجّل حسابك"
      });
    }
    r.match = null;
    sendLobby(r);
  }

  /* ── تنظيفٌ دوريّ ── */
  setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!humans(r).length && now - r.touched > GRACE_MS)) {
        clearTimer(r); clearBot(r); clearNext(r);
        rooms.delete(code);
      }
    }
  }, 60 * 1000).unref?.();

  /* ── الاتصال ── */
  nsp.on("connection", socket => {
    let room = null, meId = null;

    const err = msg => socket.emit("err", { msg });
    const clean = (s, n) => String(s == null ? "" : s).trim().slice(0, n);

    function identity(d) {
      return {
        id: rid(),
        name: clean(d && d.name, 16) || (socket.userName || "لاعب"),
        av: clean(d && d.av, 40) || "Adult_1",
        frame: clean(d && d.frame, 40) || "Classic",
        userId: socket.userId || null,
        ip: ipOf(socket),
        bot: false, sockId: socket.id, gone: false
      };
    }

    function joinRoom(r, me) {
      room = r; meId = me.id;
      socket.join(r.code);
      if (!r.hostId) r.hostId = me.id;
      sendLobby(r);
    }

    socket.on("create", (d, cb) => {
      const code = newCode();
      const r = makeRoom(code);
      rooms.set(code, r);
      const me = identity(d);
      /* المسجَّل يلعب باسم حسابه دائمًا — لا ينتحل أحدٌ اسم غيره أونلاين */
      if (socket.userName) me.name = socket.userName;
      r.seats.push(me);
      joinRoom(r, me);
      cb && cb({ ok: true, code, id: me.id });
    });

    socket.on("join", (d, cb) => {
      const code = clean(d && d.code, 8).toUpperCase();
      const r = rooms.get(code);
      if (!r) return cb && cb({ ok: false, error: "لا توجد غرفة بهذا الرمز" });
      if (r.match) return cb && cb({ ok: false, error: "المباراة بدأت — انتظر انتهاءها" });
      if (r.seats.length >= SEATS) return cb && cb({ ok: false, error: "الطاولة ممتلئة" });
      const me = identity(d);
      if (socket.userName) {
        me.name = socket.userName;
        if (r.seats.some(p => p.userId && String(p.userId) === String(me.userId)))
          return cb && cb({ ok: false, error: "حسابك موجودٌ في الطاولة" });
      }
      r.seats.push(me);
      joinRoom(r, me);
      cb && cb({ ok: true, code, id: me.id });
    });

    const isHost = () => room && meId && room.hostId === meId;

    socket.on("settings", d => {
      if (!isHost() || room.match || !d) return;
      const S = room.settings;
      if (typeof d.bots === "boolean") S.bots = d.bots;
      if ([1, 2, 3].includes(+d.botDiff)) S.botDiff = +d.botDiff;
      for (const [k, rule] of Object.entries(HOST_RULES)) {
        if (!(k in d)) continue;
        if (rule === "bool") { if (typeof d[k] === "boolean") S[k] = d[k]; }
        else if (rule.includes(+d[k])) S[k] = +d[k];
      }
      touch(room); sendLobby(room);
    });

    /* تبديل مقعدين: الشريك يُختار قبل البداية لا بعدها */
    socket.on("swap", d => {
      if (!isHost() || room.match || !d) return;
      const a = +d.a, b = +d.b;
      if (!(a >= 0 && a < room.seats.length && b >= 0 && b < room.seats.length) || a === b) return;
      const t = room.seats[a]; room.seats[a] = room.seats[b]; room.seats[b] = t;
      sendLobby(room);
    });

    socket.on("kick", d => {
      if (!isHost() || room.match) return;
      const i = seatById(room, clean(d && d.id, 20));
      if (i < 0 || room.seats[i].id === room.hostId) return;
      const p = room.seats[i];
      room.seats.splice(i, 1);
      if (p.sockId) {
        const s = nsp.sockets.get(p.sockId);
        if (s) { s.emit("kicked", {}); s.leave(room.code); }
      }
      sendLobby(room);
    });

    socket.on("start", () => {
      if (!isHost() || !room || room.match) return;
      const real = humans(room).length;
      if (real < SEATS && !room.settings.bots)
        return err("بالوت أربعة — فعّل البوتات أو انتظر البقيّة");
      if (real < 1) return;

      room.seats = room.seats.filter(p => !p.bot);
      if (room.settings.bots) {
        const names = ["أبو فهد", "المعلّم", "صقر", "الشمري", "أبو تركي", "الفارس", "سيف", "العنيد", "الذيب", "مشعل"];
        const avs = ["Adult_2", "Adult_3", "Adult_5", "Adult_4", "Animal_1", "Animal_2"];
        const need = Math.max(0, SEATS - room.seats.length);
        const used = new Set(room.seats.map(p => p.name));
        for (let i = 0; i < need; i++) {
          let nm = names[(Math.random() * names.length) | 0];
          for (let t = 0; used.has(nm) && t < 20; t++) nm = names[(Math.random() * names.length) | 0];
          used.add(nm);
          room.seats.push({
            id: "bot" + i + rid(), name: nm, av: avs[(Math.random() * avs.length) | 0],
            frame: "", userId: null, ip: null, bot: true, sockId: null, gone: false
          });
        }
      }
      if (room.seats.length !== SEATS) return err("بالوت أربعة لاعبين");

      const rules = {};
      for (const k of Object.keys(B.DEFAULTS)) rules[k] = room.settings[k];
      room.match = new B.BalootMatch(rules);
      room.match.startHand();
      nsp.to(room.code).emit("started", { seats: seatsPub(room) });
      after(room);
    });

    /* ── أفعال المباراة ── */
    function act(fn) {
      return d => {
        if (!room || !room.match) return;
        const seat = seatById(room, meId);
        if (seat < 0) return;
        try { fn(room.match, seat, d || {}); }
        catch (e) { return err(e.message || "فعلٌ غير مقبول"); }
        after(room);
      };
    }

    socket.on("bid", act((m, seat, d) => m.bid(seat, clean(d.choice, 10), d.suit ? clean(d.suit, 1) : undefined)));
    socket.on("double", act((m, seat, d) => m.double(seat, clean(d.choice, 10))));
    socket.on("play", act((m, seat, d) => m.play(seat, clean(d.card, 3), { declare: !!d.declare, baloot: !!d.baloot })));

    socket.on("leaveRoom", () => quit(true));
    socket.on("disconnect", () => quit(false));

    /* من انقطع أثناء المباراة يُمهَل دقيقة، ويلعب البوت عنه في أثنائها —
       فبالوت أربعةٌ لا تُلعَب بثلاثة، ولا تُهدَم صكّةٌ لأن جوّالًا دخل النفق. */
    function quit(deliberate) {
      if (!room) return;
      const r = room, i = seatById(r, meId);
      if (i < 0) return;
      const p = r.seats[i];
      p.sockId = null;

      const drop = () => {
        const j = seatById(r, p.id);
        if (j < 0) return;
        if (r.match) {
          /* المقعد يبقى ويصير بوتًا: لا يمكن إخراج لاعبٍ من فريقٍ في منتصف صكّة */
          r.seats[j].bot = true;
          r.seats[j].gone = true;
          r.seats[j].name = p.name + " (بوت)";
        } else r.seats.splice(j, 1);
        if (r.hostId === p.id) {
          const nx = r.seats.find(x => !x.bot && !x.gone);
          r.hostId = nx ? nx.id : null;
        }
        if (r.match) { flush(r); armTimer(r); scheduleBot(r); }
        sendLobby(r);
        if (!humans(r).some(x => !x.gone)) { clearTimer(r); clearBot(r); clearNext(r); rooms.delete(r.code); }
      };

      if (deliberate || !r.match) { p.gone = true; drop(); }
      else {
        p.gone = true;
        sendLobby(r);
        setTimeout(() => {
          const j = seatById(r, p.id);
          if (j >= 0 && !r.seats[j].sockId) drop();
        }, GRACE_MS);
      }
      room = null; meId = null;
    }
  });

  console.log("🂡 بالوت أونلاين جاهزة على /baloot");
  return {
    rooms,
    liveStats: () => ({ online: nsp.sockets.size, rooms: rooms.size })
  };
}

module.exports = { setupBalootOnline, SEATS, CODE_LEN, HOST_RULES };
