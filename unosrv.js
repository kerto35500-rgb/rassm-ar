// 🌐 «اونو» أونلاين — الغرف والدعوة والمباراة على الخادم.
//
// القواعد كلّها في unorules.js، وهذا الملفّ لا يعرف كيف تُلعَب اونو: يعرف
// من في الغرفة، ومن دوره، ومتى ينتهي وقته، ومتى تُمنَح الجائزة. الفصل مقصود
// — فمن أراد تغيير قاعدةٍ لا يقترب من الشبكة، ومن أراد إصلاح اتّصالٍ لا
// يقترب من القواعد.
//
// وثلاثة أشياء لا يفعلها هذا الملفّ أبدًا:
//   • لا يُرسل حالةً كاملة. لكل لاعبٍ منظورُه (view) وفيه يده وحدها.
//   • لا يُصدّق العميل في شيء. الكرت يُلعَب بمعرّفه، والخادم يتحقّق.
//   • لا يمنح ذهبًا لمباراةٍ فيها بوت. البوت لا يشتكي، فيسهل استغلاله.

"use strict";

const U = require("./unorules");
const { awardMatch } = require("./economy");

const MAX_SEATS = 4;
const CODE_LEN = 4;
const IDLE_MS = 45 * 60 * 1000;     /* غرفةٌ بلا حراك ٤٥ دقيقة تُغلَق */
/* تأخيرُ البوت مقصود: لو لعب فورًا شعر الناس أنهم يلعبون ضدّ آلة حاسبة.
   وهو قابلٌ للحقن كي لا يقضي الاختبار دقائقَ في انتظار تمثيليّة تفكير. */
const BOT_MIN = 900, BOT_MAX = 1800;
const GRACE_MS = 60 * 1000;         /* مهلةُ رجوعٍ لمن انقطع اتّصاله */

/* رموزٌ بلا حروفٍ متشابهة: لا 0/O ولا 1/I — الرمز يُملى صوتًا كثيرًا */
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rid = () => Math.random().toString(36).slice(2, 10);

function setupUnoOnline(io, deps = {}) {
  const nsp = io.of("/uno");
  const botMin = deps.botMin != null ? deps.botMin : BOT_MIN;
  const botMax = deps.botMax != null ? deps.botMax : BOT_MAX;
  const roundPause = deps.roundPause != null ? deps.roundPause : 4500;
  const rooms = new Map();               /* code -> room */
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

  /* ── الغرفة ── */
  function makeRoom(code) {
    return {
      code, hostId: null, createdAt: Date.now(), touched: Date.now(),
      settings: { ...U.DEFAULTS },
      seats: [],                        /* {id,name,av,frame,userId,ip,bot,sockId,gone} */
      match: null, timer: null, deadline: 0, botT: null, nextRoundT: null, closed: false
    };
  }
  const touch = r => { r.touched = Date.now(); };
  const seatById = (r, id) => r.seats.findIndex(p => p.id === id);
  const humans = r => r.seats.filter(p => !p.bot);

  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: U.publicSettings(r.settings),
      botsOn: !!r.settings.bots, max: MAX_SEATS,
      players: r.seats.map(p => ({ id: p.id, name: p.name, av: p.av, frame: p.frame,
                                   bot: p.bot, gone: !!p.gone, host: p.id === r.hostId }))
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));

  /** الحالة لكلٍّ على حدة — لا تُبَثّ بثًّا واحدًا أبدًا. */
  function sendState(r, events) {
    if (!r.match) return;
    for (const p of r.seats) {
      if (p.bot || !p.sockId) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      s.emit("state", {
        ...U.view(r.match, p.id),
        deadline: r.deadline || 0,
        seatsN: r.seats.length,
        events: events || []
      });
    }
  }

  function flush(r) {
    const ev = r.match ? r.match.events.splice(0) : [];
    sendState(r, ev);
  }

  /* ── المؤقّت: من تأخّر يُلعب عنه، فلا تتجمّد الغرفة بمن نام ── */
  function clearTimer(r) { if (r.timer) { clearTimeout(r.timer); r.timer = null; } r.deadline = 0; }
  function clearBot(r) { if (r.botT) { clearTimeout(r.botT); r.botT = null; } }
  function armTimer(r) {
    clearTimer(r);
    if (!r.match || r.match.over || r.match.phase === "roundEnd") return;
    const secs = Number(r.settings.timer) || 0;
    const seat = r.match.phase === "drawn" ? r.match.pendingFor : r.match.turn;
    const p = r.seats[seat];
    if (!p || p.bot) return;
    if (!secs) return;
    r.deadline = Date.now() + secs * 1000;
    r.timer = setTimeout(() => autoPlay(r, seat), secs * 1000 + 250);
  }
  function autoPlay(r, seat) {
    if (!r.match || r.match.over) return;
    const m = r.match;
    if (m.phase === "drawn" && m.pendingFor === seat) U.answerDrawn(m, seat, false, null, Math.random);
    else if (m.turn === seat) {
      /* نلعب عنه أضعفَ فعلٍ مقبول: السحب. لا نلعب كرتًا لم يخترْه. */
      const rr = U.drawTurn(m, seat, Math.random);
      if (rr.ask) U.answerDrawn(m, seat, false, null, Math.random);
    } else return;
    m.events.push({ t: "timeout", seat });
    after(r);
  }

  /* ── دور البوت ── */
  function scheduleBot(r) {
    clearBot(r);
    const m = r.match;
    if (!m || m.over || (m.phase !== "turn" && m.phase !== "drawn")) return;
    const seat = m.phase === "drawn" ? m.pendingFor : m.turn;
    const p = r.seats[seat];
    if (!p || !p.bot) return;
    r.botT = setTimeout(() => {
      r.botT = null;
      /* الجولة قد تكون انتهت بينما كان هذا المؤقّت في الطريق. لو لعبنا الآن
         لعبنا في جولةٍ ماضية، ولأطلقنا جولةً جديدةً ثانية فوق الأولى — وهذا
         ما كان يُجمّد الغرفة بعد أوّل جولةٍ في الكلاسيكيّ. */
      if (!r.match || r.match !== m || m.over) return;
      if (m.phase !== "turn" && m.phase !== "drawn") return;
      const now = m.phase === "drawn" ? m.pendingFor : m.turn;
      if (now !== seat) return;
      if (m.phase === "drawn" && m.pendingFor === seat) U.answerDrawn(m, seat, true, "r", Math.random);
      else {
        const a = U.botAction(m, seat);
        const res = a.type === "draw" ? U.drawTurn(m, seat, Math.random)
                                      : U.playCard(m, seat, a, Math.random);
        if (res && res.ask) U.answerDrawn(m, seat, true, a.color || "r", Math.random);
        if (res && !res.ok) U.drawTurn(m, seat, Math.random);
        /* البوت ينادي «اونو» كما ينبغي — إلا أحيانًا، فيصير مسكه ممكنًا */
        if (m.players[seat].hand.length === 1 && Math.random() < 0.75) U.callUno(m, seat);
      }
      after(r);
    }, botMin + Math.random() * Math.max(0, botMax - botMin));
  }

  /** بعد كل فعلٍ ناجح: بثٌّ، ثم مؤقّت، ثم دور البوت، ثم النهاية. */
  function after(r) {
    touch(r);
    const m = r.match;
    flush(r);
    if (!m) return;
    if (m.phase === "matchEnd" || m.over) return finish(r);
    if (m.phase === "roundEnd") {
      clearTimer(r); clearBot(r);
      /* مهلةٌ لعرض النتيجة ثم جولةٌ جديدة (الكلاسيكيّ وحده يُكمل).
         والعلَم يمنع جدولتها مرّتين لو نادى شيءٌ `after` مرّةً أخرى في أثناء
         المهلة — فجولتان تبدآن معًا تعنيان غرفةً مجمَّدة. */
      if (r.nextRoundT) return;
      r.nextRoundT = setTimeout(() => {
        r.nextRoundT = null;
        if (!r.match || r.match !== m || m.over) return;
        U.startRound(m);
        after(r);
      }, roundPause);
      return;
    }
    armTimer(r);
    scheduleBot(r);
  }

  /* ── نهاية المباراة والجائزة ── */
  async function finish(r) {
    clearTimer(r); clearBot(r);
    if (r.nextRoundT) { clearTimeout(r.nextRoundT); r.nextRoundT = null; }
    const m = r.match;
    if (!m || m._awarded) return;
    m._awarded = true;

    const hasBot = r.seats.some(p => p.bot);
    let reason = null, granted = [];
    if (hasBot) reason = "مباراةٌ فيها بوت — لا جائزة";
    else {
      try {
        const res = await awardMatch(st(), {
          game: "uno",
          players: r.seats.map(p => ({ id: p.id, userId: p.userId, ip: p.ip, isBot: p.bot })),
          winnerId: (m.players[m.matchWinner] || {}).id,
          matchId: r.code + ":" + m.round + ":" + r.createdAt
        });
        granted = res.granted || []; reason = res.reason || null;
      } catch (e) { console.error("uno award:", e.message); }
    }

    /* الإحصاءات تُسجَّل للمسجَّلين ولو لم تُمنَح جائزة */
    for (const p of r.seats) {
      if (p.bot || !p.userId) continue;
      const won = m.players[m.matchWinner] && m.players[m.matchWinner].id === p.id;
      try {
        await st().bumpGameStats(p.userId, "uno", { games: 1, wins: won ? 1 : 0,
                                                    score: (m.players[seatById(r, p.id)] || {}).score || 0 });
      } catch (e) {}
    }

    for (const p of r.seats) {
      if (p.bot || !p.sockId) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      const mine = granted.find(g => String(g.userId) === String(p.userId));
      s.emit("matchEnd", {
        winner: m.matchWinner,
        scores: m.players.map(x => ({ name: x.name, score: x.score })),
        gold: mine ? mine.amount : 0,
        reason: p.userId ? reason : "الضيوف لا يكسبون ذهبًا — سجّل حسابك"
      });
    }
    r.match = null;
    r.seats.forEach(p => { if (p.bot) p.bot = p.bot; });
    sendLobby(r);
  }

  /* ── تنظيفٌ دوريّ ── */
  setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!humans(r).length && now - r.touched > GRACE_MS)) {
        clearTimer(r); clearBot(r); if (r.nextRoundT) clearTimeout(r.nextRoundT);
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
      if (r.seats.length >= MAX_SEATS) return cb && cb({ ok: false, error: "الغرفة ممتلئة" });
      const me = identity(d);
      if (socket.userName) {
        me.name = socket.userName;
        /* حسابٌ واحد لا يجلس مقعدَين في غرفةٍ واحدة */
        if (r.seats.some(p => p.userId && String(p.userId) === String(me.userId)))
          return cb && cb({ ok: false, error: "حسابك موجودٌ في الغرفة" });
      }
      r.seats.push(me);
      joinRoom(r, me);
      cb && cb({ ok: true, code, id: me.id });
    });

    const isHost = () => room && meId && room.hostId === meId;

    socket.on("settings", d => {
      if (!isHost() || room.match) return;
      const S = room.settings;
      const b = k => { if (typeof d[k] === "boolean") S[k] = d[k]; };
      if (d.mode === "classic" || d.mode === "nomercy") S.mode = d.mode;
      if ([200, 300, 500].includes(+d.limit)) S.limit = +d.limit;
      if ([0, 15, 30].includes(+d.timer)) S.timer = +d.timer;
      ["stacking", "seven0", "mercy", "jumpin", "forceplay", "challenge", "bots"].forEach(b);
      touch(room); sendLobby(room);
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
      if (real < 2 && !room.settings.bots)
        return err("تحتاج لاعبَين على الأقلّ — أو فعّل البوتات");
      if (real < 1) return;

      /* البوتات تملأ الفراغ إن أذن المضيف. ومباراةٌ فيها بوتٌ لا تمنح ذهبًا. */
      room.seats = room.seats.filter(p => !p.bot);
      if (room.settings.bots) {
        const names = ["جود", "أليكس", "آش", "داني", "روبي", "ماكس", "ليو", "ميا"];
        const avs = ["Adult_2", "Adult_3", "Kid_1", "Animal_1", "Animal_2", "Adult_5"];
        /* تملأ المقاعد الفارغة كلَّها إلى الأربعة. المضيف اختار البوتات،
           فمعناه أنه لا يريد الانتظار — لا أن يجلس واحدٌ ويبقى مقعدان. */
        const need = Math.max(0, MAX_SEATS - room.seats.length);
        for (let i = 0; i < need; i++)
          room.seats.push({ id: "bot" + i + rid(), name: names[(Math.random() * names.length) | 0] ,
                            av: avs[(Math.random() * avs.length) | 0], frame: "",
                            userId: null, ip: null, bot: true, sockId: null, gone: false });
      }
      if (room.seats.length < 2) return err("تحتاج لاعبَين على الأقلّ");

      room.match = U.createMatch({ players: room.seats, settings: room.settings });
      U.startRound(room.match);
      nsp.to(room.code).emit("started", { seats: room.seats.map(p => p.id) });
      after(room);
    });

    /* ── أفعال المباراة ── */
    function act(fn) {
      return d => {
        if (!room || !room.match) return;
        const seat = seatById(room, meId);
        if (seat < 0) return;
        const res = fn(room.match, seat, d || {});
        if (res && res.ok === false) return err(res.error || "فعلٌ غير مقبول");
        after(room);
      };
    }

    socket.on("play", act((m, seat, d) =>
      U.playCard(m, seat, { cardId: +d.cardId, color: d.color, swap: +d.swap }, Math.random)));
    socket.on("draw", act((m, seat) => U.drawTurn(m, seat, Math.random)));
    socket.on("drawn", act((m, seat, d) => U.answerDrawn(m, seat, !!d.yes, d.color, Math.random)));
    socket.on("uno", act((m, seat) => U.callUno(m, seat)));
    socket.on("catch", act((m, seat, d) => U.catchUno(m, seat, +d.seat, Math.random)));
    socket.on("challenge", act((m, seat) => U.challenge(m, seat, Math.random)));

    socket.on("leaveRoom", () => quit(true));

    socket.on("disconnect", () => quit(false));

    /* من انقطع أثناء المباراة يُمهَل دقيقة: لعبةُ ورقٍ لا تُهدَم لأن جوّالًا
       دخل النفق. ومن غادر عمدًا يخرج فورًا. */
    function quit(deliberate) {
      if (!room) return;
      const r = room, i = seatById(r, meId);
      if (i < 0) return;
      const p = r.seats[i];
      p.sockId = null;

      const drop = () => {
        const j = seatById(r, p.id);
        if (j < 0) return;
        if (r.match) U.leave(r.match, j, Math.random);
        else r.seats.splice(j, 1);
        if (r.hostId === p.id) {
          const nx = r.seats.find(x => !x.bot && !x.gone);
          r.hostId = nx ? nx.id : null;
        }
        if (r.match) { flush(r); if (r.match.over || r.match.phase === "matchEnd") finish(r); else { armTimer(r); scheduleBot(r); } }
        sendLobby(r);
        if (!humans(r).some(x => !x.gone)) { clearTimer(r); rooms.delete(r.code); }
      };

      if (deliberate || !r.match) { p.gone = true; drop(); }
      else {
        p.gone = true;
        sendLobby(r);
        setTimeout(() => { if (seatById(r, p.id) >= 0 && !r.seats[seatById(r, p.id)].sockId) drop(); }, GRACE_MS);
      }
      room = null; meId = null;
    }
  });

  console.log("🃏 اونو أونلاين جاهزة على /uno");
  return {
    rooms,
    liveStats: () => ({ online: nsp.sockets.size, rooms: rooms.size })
  };
}

module.exports = { setupUnoOnline, MAX_SEATS, CODE_LEN };
