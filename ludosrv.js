/* 🎲 لودو أونلاين — مساحة ‎/ludo‎.
 *
 * القواعد كلُّها في ludorules.js؛ وهنا الغرف والمقاعد والمؤقّتات والبوتات.
 *
 * ثلاثُ قواعد تحكم هذا الملفّ:
 *  ١) الحالةُ تُرسَل لكلّ مقعدٍ على حدة — لا بثٌّ واحدٌ أبدًا. في الظلام
 *     والمهامّ السرّيّة يرى كلٌّ ما يحقّ له وحده، والحجبُ يحدث هنا قبل أن
 *     يغادر أيُّ شيءٍ الخادم، لا في المتصفّح حيث تقرؤه أدواتُ المطوّر.
 *  ٢) لا يتجمّد دورٌ أبدًا: لكلّ لاعبٍ بشريّ مؤقّت، ومن غاب يلعب عنه البوت
 *     في مهلة الرجوع، ثمّ يصير مقعدُه بوتًا.
 *  ٣) العميل يرسل نوايا («ارمِ»، «حرّك رقم ٣»، «اختر») لا نتائج. النردُ
 *     يُرمى هنا.
 */
"use strict";

const L = require("./ludorules");
const BOT = require("./ludobot");
const FILTER = require("./chatfilter");
const { nameFromSocket } = require("./account");

const SLOTS = 4;
const IDLE_MS = 45 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const CHAT_KEEP = 40;
const TURN_SECS = [10, 15, 20, 30];
const BOT_NAMES = ["أبو فهد", "صقر", "نورة", "الذيب", "سيف", "العنيد", "مشعل", "ريم", "الشمري", "أبو تركي"];
const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").trim().slice(0, n);

const DEFAULTS = Object.freeze({
  ...L.DEFAULTS, players: 4, turnSecs: 15, bots: true, botDiff: 2
});

/** إعداداتُ المضيف بعد التحقّق — لا يمرّ رقمٌ خارج مداه. */
function sanitize(d, old) {
  const S = { ...old };
  if (!d || typeof d !== "object") return S;
  if (L.MODES.includes(d.mode)) S.mode = d.mode;
  if (typeof d.teams === "boolean") S.teams = d.teams;
  if (typeof d.sharedSafe === "boolean") S.sharedSafe = d.sharedSafe;
  if (typeof d.powerups === "boolean") S.powerups = d.powerups;
  if ([3, 4, 5, 6].includes(+d.powerCount)) S.powerCount = +d.powerCount;
  if ([2, 3, 4].includes(+d.players)) S.players = +d.players;
  if (TURN_SECS.includes(+d.turnSecs)) S.turnSecs = +d.turnSecs;
  if (typeof d.bots === "boolean") S.bots = d.bots;
  if ([1, 2].includes(+d.botDiff)) S.botDiff = +d.botDiff;
  if (S.teams) S.players = 4;
  if (!S.teams) S.sharedSafe = false;
  return S;
}

/** المقاعد المشاركة: لاعبان متقابلان، أو ثلاثة، أو أربعة. */
const activeSlots = S => (S.teams || S.players === 4) ? [0, 1, 2, 3] : S.players === 3 ? [0, 1, 2] : [0, 2];

function setupLudoOnline(io, deps = {}) {
  const nsp = io.of("/ludo");
  const st = () => deps.store;
  const botDelay = deps.botDelay != null ? deps.botDelay : [650, 1100];
  const autoMoveMs = deps.autoMoveMs != null ? deps.autoMoveMs : 650;
  const graceMs = deps.graceMs != null ? deps.graceMs : GRACE_MS;
  /* للاختبارات وحدها: تقصيرُ مؤقّت الدور (١ = الزمن الحقيقيّ) */
  const secsScale = deps.secsScale != null ? deps.secsScale : 1;
  const rooms = new Map();

  function newCode() {
    for (let t = 0; t < 400; t++) {
      const c = String(10000 + Math.floor(Math.random() * 90000));
      if (!rooms.has(c)) return c;
    }
    return String(Date.now()).slice(-6);
  }

  function makeRoom() {
    return {
      code: newCode(), hostId: null, createdAt: Date.now(), touched: Date.now(),
      settings: { ...DEFAULTS }, slots: [null, null, null, null],
      match: null, timer: null, botT: null, autoT: null, deadline: 0,
      chat: [], lastResult: null
    };
  }
  const touch = r => { r.touched = Date.now(); };
  const people = r => r.slots.filter(Boolean);
  const humans = r => people(r).filter(p => !p.bot);
  const slotOf = (r, id) => r.slots.findIndex(p => p && p.id === id);

  /* ── اللوبي ── */
  function lobbyOf(r) {
    return {
      code: r.code, host: r.hostId, settings: { ...r.settings }, playing: !!r.match,
      active: activeSlots(r.settings),
      slots: r.slots.map((p, i) => p ? {
        id: p.id, name: p.name, bot: !!p.bot, gone: !!p.gone, seat: i,
        host: p.id === r.hostId, registered: !!p.userId
      } : null),
      lastResult: r.lastResult
    };
  }
  const sendLobby = r => nsp.to(r.code).emit("lobby", lobbyOf(r));

  const playersPub = r => r.slots.map((p, i) => p ? { seat: i, name: p.name, bot: !!p.bot, gone: !!p.gone, auto: !!p.auto } : null);

  /* ── الحالة لكلّ مقعدٍ على حدة ── */
  function flush(r) {
    const m = r.match;
    if (!m) return;
    const raw = m.takeEvents();
    const players = playersPub(r);
    for (let seat = 0; seat < SLOTS; seat++) {
      const p = r.slots[seat];
      if (!p || p.bot || !p.sockId || !m.seats.includes(seat)) continue;
      const s = nsp.sockets.get(p.sockId);
      if (!s) continue;
      /* serverNow: ساعةُ الجهاز قد تسبق الخادم أو تتأخّر عنه ثوانيَ، والمهلةُ
         وقتٌ مطلقٌ من ساعة الخادم — فيقيس العميلُ الفرقَ ويصحّح شريطَ الوقت */
      s.emit("state", { ...m.view(seat), events: m.eventsFor(raw, seat), deadline: r.deadline || 0,
                        serverNow: Date.now(), players });
    }
  }

  function clearTimers(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    if (r.botT) { clearTimeout(r.botT); r.botT = null; }
    if (r.autoT) { clearTimeout(r.autoT); r.autoT = null; }
    r.deadline = 0;
  }

  /** فعلُ البوت (أو البديل عن الغائب): من عرض مقعده هو. */
  function botAct(r, seat, diff) {
    const m = r.match;
    if (!m || m.phase === "over" || m.actingSeat() !== seat) return false;
    const d = BOT.decide(m.view(seat), diff, Math.random);
    if (!d) return false;
    try {
      if (d.kind === "roll") m.roll(seat);
      else if (d.kind === "move") m.move(seat, d.id);
      else m.choose(seat, d.choice);
      return true;
    } catch (e) { return false; }
  }

  /** بعد كلّ فعل: بثٌّ، ثمّ جدولةُ ما يلي. */
  function after(r) {
    touch(r);
    const m = r.match;
    if (!m) return;
    clearTimers(r);
    if (m.phase === "over") { flush(r); return finish(r); }

    const seat = m.actingSeat();
    const p = r.slots[seat];
    /* وضعُ AUTO (من لعبة المرجع: SYSTEM_TRUST «系统托管»): من انقضى وقتُه
       يلعب عنه البوتُ **كلَّ أدواره** بسرعة حتى يعود فيلمس الشاشة أو يلعب —
       لا مهلةٌ كاملةٌ لكلّ خطوةٍ من غائب، فلا يكلّف الطاولةَ انتظارًا بعد أوّل
       مرّة */
    if (!p || p.bot || p.auto) {
      flush(r);
      const [a, b] = botDelay;
      /* البديلُ عن البشريّ الغائب يلعب أحسنَ ما يعرف — لا بمستوى بوتات الغرفة */
      const diff = (p && !p.bot) ? 2 : (Number(r.settings.botDiff) || 2);
      r.botT = setTimeout(() => {
        r.botT = null;
        if (r.match !== m) return;
        if (botAct(r, seat, diff)) after(r);
      }, a + Math.random() * Math.max(0, b - a));
      return;
    }

    /* لاعبٌ بشريّ: مؤقّتٌ، وعند انقضائه يلعب عنه البوت أحسنَ ما يعرف */
    const secs = (Number(r.settings.turnSecs) || 15) * secsScale;
    r.deadline = Date.now() + secs * 1000;
    r.timer = setTimeout(() => {
      r.timer = null;
      if (r.match !== m) return;
      if (botAct(r, seat, 2)) { m.ev({ t: "timeout", seat }); p.auto = true; after(r); }
    }, secs * 1000 + 300);

    /* حركةٌ واحدةٌ ممكنة (أو حركاتٌ متكافئة): نحرّكها عنه بعد لحظة كي لا
       يُضطرّ إلى نقرةٍ لا خيارَ فيها — ويبقى قادرًا على النقر قبلها */
    if (m.phase === "move" && m.turn === seat) {
      const uniq = new Set(m.legal.map(x => x.owner + ":" + x.from + ":" + x.to));
      if (uniq.size === 1) {
        const id = m.legal[0].id;
        r.autoT = setTimeout(() => {
          r.autoT = null;
          if (r.match !== m || m.phase !== "move" || m.turn !== seat) return;
          try { m.move(seat, id); } catch (e) { return; }
          after(r);
        }, autoMoveMs);
      }
    }
    flush(r);
  }

  /* ── النهاية ── */
  async function finish(r) {
    clearTimers(r);
    const m = r.match;
    if (!m || m._done) return;
    m._done = true;
    const w = m.winner || { seats: [], reason: "none" };
    const names = w.seats.map(s => r.slots[s] ? r.slots[s].name : "?");
    const missions = {};
    for (const s of m.seats) if (m.missions[s]) missions[s] = { ...m.missionPublic(s), name: r.slots[s] && r.slots[s].name };
    r.lastResult = {
      seats: w.seats, names, reason: w.reason, by: w.by, mode: m.rules.mode, teams: m.rules.teams,
      missions, at: Date.now()
    };
    /* الإحصاءاتُ للمسجَّلين — بلا ذهب (قرارُ صاحب الموقع للّودو) */
    for (const s of m.seats) {
      const p = r.slots[s];
      if (!p || p.bot || !p.userId || !st()) continue;
      try { await st().bumpGameStats(p.userId, "ludo", { games: 1, wins: w.seats.includes(s) ? 1 : 0, score: 0 }); }
      catch (e) { /* الإحصاء لا يُعطّل اللعبة */ }
    }
    nsp.to(r.code).emit("matchEnd", r.lastResult);
    r.match = null;
    /* البوتات تُزال والغائبون يُخرَجون: اللوبي يعود كما كان قبل البداية */
    r.slots = r.slots.map(p => (p && !p.bot && !p.gone) ? p : null);
    for (const p of r.slots) if (p) p.auto = false;
    if (!r.slots.some(p => p && p.id === r.hostId)) {
      const nx = r.slots.find(Boolean);
      r.hostId = nx ? nx.id : null;
    }
    sendLobby(r);
  }

  /* ── تنظيفٌ دوريّ ── */
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.touched > IDLE_MS || (!humans(r).some(p => !p.gone) && now - r.touched > graceMs)) {
        clearTimers(r);
        rooms.delete(code);
      }
    }
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();

  /* ── الاتّصال ── */
  nsp.on("connection", socket => {
    let room = null, me = null;
    let lastChat = 0;

    socket.emit("hello", {
      defaults: DEFAULTS, modes: L.MODES, modeNames: L.MODE_AR,
      powers: L.POWERS, powerNames: L.POWER_AR, powerIcons: L.POWER_ICON,
      you: nameFromSocket(socket) || socket.userName || null
    });

    const err = msg => socket.emit("toast", msg);
    const isHost = () => room && me && room.hostId === me.id;

    function identity(name) {
      const acct = nameFromSocket(socket) || socket.userName || null;
      return {
        id: rid(), token: rid() + rid(), name: acct || clean(name, 20) || "لاعب",
        userId: socket.userId || null, sockId: socket.id, bot: false, gone: false
      };
    }

    function enter(r, p, cb, extra) {
      room = r; me = p;
      socket.join(r.code);
      if (!r.hostId) r.hostId = p.id;
      cb && cb({ ok: true, roomId: r.code, you: p.id, token: p.token, ...(extra || {}) });
      sendLobby(r);
      if (r.chat.length) socket.emit("chatLog", r.chat.slice(-CHAT_KEEP));
      /* العائدُ في منتصف مباراةٍ يأخذ حالتَه فورًا — دون أن نعيد ضبط مؤقّت
         صاحب الدور، وإلا صار الانقطاعُ والعودة طريقةً لإطالة دورٍ ما */
      if (r.match) flush(r);
    }

    /** أوّلُ مقعدٍ نشطٍ فارغ؛ وإن امتلأت النشطة وسّعنا العدد (ما لم تكن فرقًا). */
    function freeSlot(r) {
      let act = activeSlots(r.settings);
      let i = act.find(s => !r.slots[s]);
      if (i != null) return i;
      if (!r.settings.teams && r.settings.players < 4) {
        r.settings.players = r.settings.players === 2 ? 3 : 4;
        /* من ٢ إلى ٣ تتغيّر المقاعد النشطة من (٠،٢) إلى (٠،١،٢) — نعيد
           ترتيبَ من فيها كي لا يجلس أحدٌ في مقعدٍ صار خارج اللعب */
        compact(r);
        act = activeSlots(r.settings);
        i = act.find(s => !r.slots[s]);
        if (i != null) return i;
      }
      return null;
    }

    socket.on("createRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      if (room) leave(true);
      const r = makeRoom();
      rooms.set(r.code, r);
      const p = identity(d && d.name);
      r.slots[0] = p;
      enter(r, p, cb);
    });

    socket.on("joinRoom", (d, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(clean(d && d.roomId, 8));
      if (!r) return cb({ ok: false, error: "لا توجد غرفة بهذا الرمز" });
      if (r.match) return cb({ ok: false, error: "المباراة جارية — انتظر انتهاءها" });
      const acct = socket.userId ? String(socket.userId) : null;
      if (acct && people(r).some(p => p.userId && String(p.userId) === acct && !p.gone))
        return cb({ ok: false, error: "حسابك موجودٌ في الغرفة" });
      const i = freeSlot(r);
      if (i == null) return cb({ ok: false, error: "الغرفة ممتلئة" });
      if (room) leave(true);
      const p = identity(d && d.name);
      r.slots[i] = p;
      enter(r, p, cb);
    });

    socket.on("rejoin", (d, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(clean(d && d.roomId, 8));
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const i = r.slots.findIndex(p => p && p.token && p.token === String(d && d.token || ""));
      if (i < 0) return cb({ ok: false, error: "انتهت جلستك" });
      const p = r.slots[i];
      if (p.sockId && p.sockId !== socket.id && nsp.sockets.get(p.sockId))
        return cb({ ok: false, error: "الجلسة مفتوحةٌ في مكانٍ آخر" });
      /* رجع قبل أن يصير بوتًا: نسلّمه مقعدَه كما تركه */
      p.sockId = socket.id; p.gone = false;
      p.auto = false;                            /* عاد ليلعب: لا يبقى البوتُ مكانه */
      p._leaveGen = (p._leaveGen || 0) + 1;      /* أيُّ مؤقّتِ مغادرةٍ معلّقٍ صار قديمًا */
      if (p._wasHuman) { p.bot = false; p.name = p._name || p.name; p._wasHuman = false; }
      enter(r, p, cb, { resumed: true });
    });

    socket.on("leaveRoom", () => leave(true));
    socket.on("disconnect", () => leave(false));

    socket.on("updateSettings", d => {
      if (!isHost() || room.match) return;
      const before = room.settings;
      const next = sanitize(d, before);
      /* لا يُنقَص العددُ عمّن في الغرفة فعلًا */
      const n = humans(room).length;
      if (activeSlots(next).length < n) next.players = n <= 2 ? 2 : n === 3 ? 3 : 4;
      room.settings = next;
      compact(room);
      touch(room); sendLobby(room);
    });

    /** من كان في مقعدٍ خرج عن اللعب يُنقَل إلى أوّل مقعدٍ نشطٍ فارغ. */
    function compact(r) {
      const act = activeSlots(r.settings);
      for (let i = 0; i < SLOTS; i++) {
        const p = r.slots[i];
        if (!p || act.includes(i)) continue;
        const j = act.find(s => !r.slots[s]);
        if (j == null) continue;
        r.slots[j] = p; r.slots[i] = null;
      }
    }

    /* الجلوس في مقعدٍ فارغ (اختيارُ اللون، وتكوينُ الفرق) */
    socket.on("sit", d => {
      if (!room || !me || room.match) return;
      const to = +(d && d.slot);
      if (!(to >= 0 && to < SLOTS) || room.slots[to]) return;
      if (!activeSlots(room.settings).includes(to)) return;
      const from = slotOf(room, me.id);
      if (from < 0) return;
      room.slots[to] = me; room.slots[from] = null;
      touch(room); sendLobby(room);
    });

    socket.on("kick", d => {
      if (!isHost() || room.match) return;
      const i = slotOf(room, clean(d && d.id, 20));
      if (i < 0 || room.slots[i].id === room.hostId) return;
      const p = room.slots[i];
      room.slots[i] = null;
      if (p.sockId) { const s = nsp.sockets.get(p.sockId); if (s) { s.emit("kicked"); s.leave(room.code); } }
      sendLobby(room);
    });

    socket.on("startGame", () => {
      if (!isHost() || room.match) return;
      const S = room.settings;
      const act = activeSlots(S);
      if (!humans(room).length) return;
      const empty = act.filter(s => !room.slots[s]);
      if (empty.length && !S.bots) return err("المقاعد ناقصة — فعّل البوتات أو انتظر البقيّة");
      const used = new Set(people(room).map(p => p.name));
      for (const s of empty) {
        let nm = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        for (let t = 0; used.has(nm) && t < 30; t++) nm = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        used.add(nm);
        room.slots[s] = { id: "bot" + rid(), token: null, name: nm, userId: null, sockId: null, bot: true, gone: false };
      }
      try {
        room.match = new L.LudoMatch(
          { mode: S.mode, teams: S.teams, sharedSafe: S.sharedSafe, powerups: S.powerups, powerCount: S.powerCount },
          act, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
      } catch (e) { return err(e.message); }
      room.lastResult = null;
      for (const p of room.slots) if (p) p.auto = false;
      nsp.to(room.code).emit("started", { players: playersPub(room) });
      sendLobby(room);
      after(room);
    });

    /* ── أفعال المباراة ── */
    function act(fn) {
      return d => {
        if (!room || !room.match || !me) return;
        const seat = slotOf(room, me.id);
        if (seat < 0) return;
        me.auto = false;                           /* لعب بنفسه ⇒ خرج من AUTO */
        try { fn(room.match, seat, d || {}); }
        catch (e) { return err(e.message || "فعلٌ غير مقبول"); }
        after(room);
      };
    }
    socket.on("roll", act((m, seat) => m.roll(seat)));
    socket.on("move", act((m, seat, d) => m.move(seat, +d.id)));
    socket.on("choose", act((m, seat, d) => m.choose(seat, d.choice === "none" ? "none" : +d.choice)));
    /* لمسُ الشاشة في وضع AUTO يُعيد اللاعبَ إلى يده (المرجع: SYSTEM_TRUST_CANCEL):
       إن كان الدورُ دورَه بدأ مؤقّتُه الآن بدل أن يلعب عنه البوت */
    socket.on("manual", () => {
      if (!room || !room.match || !me || !me.auto || slotOf(room, me.id) < 0) return;
      me.auto = false;
      after(room);
    });

    /* ── الدردشة ── */
    socket.on("chat", d => {
      /* المُخرَجُ يبقى مقبسُه مربوطًا بالغرفة في هذا الإغلاق — فالمقعدُ هو الحكم */
      if (!room || !me || slotOf(room, me.id) < 0) return;
      const now = Date.now();
      if (now - lastChat < 700) return;
      lastChat = now;
      const c = FILTER.check(d && d.text);
      if (!c.ok) return err(c.why);
      const msg = { name: me.name, text: c.text, seat: slotOf(room, me.id), at: now };
      room.chat.push(msg);
      if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
      nsp.to(room.code).emit("chat", msg);
    });

    /* من خرج عمدًا يُزال؛ ومن انقطع أثناء المباراة يُمهَل، ويلعب عنه المؤقّتُ
       في أثنائها، ثمّ يصير مقعدُه بوتًا. اللودو لا تُلعَب بمقعدٍ مجمَّد. */
    function leave(deliberate) {
      if (!room || !me) return;
      const r = room, p = me;
      room = null; me = null;
      socket.leave(r.code);
      const i = slotOf(r, p.id);
      if (i < 0) return;
      p.sockId = null;
      /* رقمُ هذه المغادرة. من انقطع ثمّ عاد ثمّ انقطع ثانيةً يترك مؤقّتين
         معلّقين؛ لولا هذا الرقم لنفّذ الاثنان التحويلَ إلى بوت، فيُكتب اسمُه
         «(بوت) (بوت)» ويُحفظ الاسمُ المشوّه بدل اسمه — فلا يستردّه حين يعود. */
      const gen = p._leaveGen = (p._leaveGen || 0) + 1;

      const drop = () => {
        const j = slotOf(r, p.id);
        if (j < 0) return;
        if (r.match && r.match.seats.includes(j)) {
          if (!p._wasHuman || !p.bot) { p._wasHuman = true; p._name = p.name; p.name = p.name + " (بوت)"; }
          p.bot = true; p.gone = true;
        } else r.slots[j] = null;
        if (r.hostId === p.id) {
          const nx = r.slots.find(x => x && !x.bot && !x.gone);
          r.hostId = nx ? nx.id : null;
        }
        sendLobby(r);
        if (r.match) after(r);
        if (!humans(r).some(x => !x.gone)) { clearTimers(r); rooms.delete(r.code); }
      };

      if (deliberate || !r.match) { p.gone = true; drop(); return; }
      p.gone = true;
      sendLobby(r);
      setTimeout(() => {
        if (p._leaveGen !== gen) return;          /* مغادرةٌ أحدث تتولّى الأمر */
        const j = slotOf(r, p.id);
        if (j >= 0 && !r.slots[j].sockId) drop();
      }, graceMs);
    }
  });

  console.log("🎲 لودو أونلاين جاهزة على /ludo");
  return {
    rooms,
    liveStats: () => {
      let online = 0, playing = 0;
      for (const r of rooms.values()) { online += humans(r).filter(p => !p.gone).length; if (r.match) playing++; }
      return { online, rooms: [...rooms.values()], playing };
    }
  };
}

module.exports = { setupLudoOnline, DEFAULTS, sanitize, activeSlots };
