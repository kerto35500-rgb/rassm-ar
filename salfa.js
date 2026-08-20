// 🕵️ «برّا السالفة» — منطق مستقل تماماً على namespace "/salfa"
// الخادم هو الحكم: كلمة السر لا تُبثّ للغرفة أبداً، بل تُرسل لكل socket دوره فقط.
const crypto = require("crypto");
const words = require("./salfa-words");
const { nameFromSocket } = require("./account");

const EMPTY_ROOM_MS = 600000;  // غرفة انقطع كل لاعبيها تبقى ١٠ دقائق ليعودوا
const CHAT_MAX = 200;
const REVEAL_MS = 12000;       // مهلة مرحلة كشف الأدوار (تُتخطّى بالجاهزية)
const GUESS_MS = 30000;        // مهلة اختيار برّا السالفة للكلمة
const RESULT_MS = 15000;       // مدة عرض النتائج
const GUESS_CHOICES = 6;       // عدد الكلمات المعروضة على برّا السالفة

const DEFAULTS = {
  flow: "circle",       // النمط الوحيد: الدورة الكاملة (كل لاعب يسأل ويُسأل)
  askTime: 60,          // ثواني السؤال الواحد في نمط الدورة
  circles: 1,           // عدد الدورات الكاملة قبل التصويت (0 = مفتوح: المضيف يقرر)
  spies: 1,             // عدد الخارجين عن السالفة (1–3)
  autoSpies: true,      // جاسوس ثانٍ تلقائياً عند ٧ لاعبين أو أكثر
  scoreLimit: 10,       // النقاط التي تنتهي عندها اللعبة
  firstPlayer: "random",// random | host
  emergency: true,      // زر الاتهام الطارئ
  packs: [],            // التصنيفات المفعّلة (فارغ = الكل)
  maxPlayers: 16,       // 3–16
  visibility: "private",
  password: ""
};

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function sanitize(s = {}, old = DEFAULTS) {
  const o = { ...old };
  o.flow = "circle";                       // لا نمط غيره
  if (s.askTime !== undefined) o.askTime = clampInt(s.askTime, 15, 180, old.askTime);
  if (s.circles !== undefined) o.circles = clampInt(s.circles, 0, 5, old.circles);
  if (s.spies !== undefined) o.spies = clampInt(s.spies, 1, 3, old.spies);
  if (s.autoSpies !== undefined) o.autoSpies = !!s.autoSpies;
  if (s.scoreLimit !== undefined) o.scoreLimit = clampInt(s.scoreLimit, 3, 50, old.scoreLimit);
  if (s.firstPlayer !== undefined) o.firstPlayer = (s.firstPlayer === "host" ? "host" : "random");
  if (s.emergency !== undefined) o.emergency = !!s.emergency;
  if (s.packs !== undefined) o.packs = Array.isArray(s.packs) ? s.packs.map(String).slice(0, 60) : [];
  if (s.maxPlayers !== undefined) o.maxPlayers = clampInt(s.maxPlayers, 3, 16, old.maxPlayers);
  if (s.visibility !== undefined) o.visibility = (s.visibility === "public" ? "public" : "private");
  if (s.password !== undefined) o.password = String(s.password || "").slice(0, 24);
  return o;
}

/* ===== تعديلات الكلمات: لكل غرفة على حدة، وتُحفظ للاعب المسجَّل ===== */
function emptyWords() { return { extra: {}, removedWords: new Set(), removedCats: new Set() }; }
function wordsToJSON(w) {
  return { extra: w.extra, removedWords: [...w.removedWords], removedCats: [...w.removedCats] };
}
function wordsFromJSON(j) {
  return {
    extra: (j && j.extra) || {},
    removedWords: new Set((j && j.removedWords) || []),
    removedCats: new Set((j && j.removedCats) || [])
  };
}
// التصنيفات الفعلية للغرفة: الأصلية (بلا المحذوف) + المضافة
function roomPacks(room) {
  const W = (room && room.words) || emptyWords();
  const out = {};
  for (const [name, list] of Object.entries(words.PACKS)) {
    if (W.removedCats.has(name)) continue;
    out[name] = [...list.filter(w => !W.removedWords.has(w)), ...(W.extra[name] || [])];
  }
  for (const [name, list] of Object.entries(W.extra)) {
    if (!(name in words.PACKS)) out[name] = [...list];
  }
  return out;
}
function roomPool(room) {
  const cats = roomPacks(room);
  const enabled = (room.settings.packs || []).filter(n => cats[n] && cats[n].length);
  const names = enabled.length ? enabled : Object.keys(cats).filter(n => cats[n].length);
  const out = [];
  names.forEach(n => cats[n].forEach(w => out.push({ cat: n, word: w })));
  return out;
}

// عدد الجواسيس الفعلي: يحترم الإعداد ويضمن بقاء عارفَين على الأقل
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
  const PROFILE_KEY = (name) => "salfaProfile:" + name;

  // حفظ مؤجَّل لملف اللاعب المسجَّل (الضيف لا يُحفظ له شيء)
  function persistWords(room) {
    if (!room || !room.ownerUser) return;
    clearTimeout(room._wSave);
    room._wSave = setTimeout(() => {
      store.saveKV(PROFILE_KEY(room.ownerUser), {
        words: wordsToJSON(room.words),
        settings: room.settings
      }).catch(() => {});
    }, 600);
  }

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
      ready: !!p.ready, asked: !!p.asked, answered: !!p.answered,
      voted: room.state === "voting" ? ((room.votes[p.id] || []).length > 0) : false,
      registered: !!p.userName
    };
  }

  // الحالة العامة — بلا أي أثر لكلمة السر أو هوية الجاسوس قبل الكشف
  function state(room) {
    const cur = room.players.find(p => p.id === room.turnId);
    const tgt = room.players.find(p => p.id === room.targetId);
    const votesDone = Object.values(room.votes || {}).filter(v => v && v.length).length;
    return {
      id: room.id,
      state: room.state,
      ownerId: room.ownerId,
      settings: room.settings,
      players: room.players.map(p => playerView(room, p)),
      packNames: Object.keys(roomPacks(room)),
      wordsSaved: !!room.ownerUser,
      category: room.category,
      roundNo: room.roundNo,
      circleNo: room.circleNo,
      endsAt: room.endsAt,
      serverNow: Date.now(),
      turnId: room.turnId || null,
      targetId: room.targetId || null,
      askerPickPending: !!room.askerPickPending,
      voteMax: room.state === "voting" ? (room.voteMax || 1) : 0,
      emergency: room.emergency && {
        byId: room.emergency.byId, byName: room.emergency.byName,
        yes: room.emergency.yes.length, need: room.emergency.need,
        endsAt: room.emergency.endsAt
      },
      votesCount: votesDone,
      votesNeed: room.state === "voting" ? playing(room).length : 0,
      result: room.result,
      winner: room.winner
    };
  }

  function broadcast(room) { nsp.to(room.id).emit("state", state(room)); }
  function sys(room, text, cls = "system") { nsp.to(room.id).emit("chat", { system: true, cls, text }); }

  function sendRoles(room) {
    room.players.forEach(p => {
      if (!p.connected || p.spectator) return;
      const spy = room.spyIds.includes(p.id);
      nsp.to(p.id).emit("role", {
        spy,
        category: room.category,
        word: spy ? null : room.word,
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
    room.circleNo = 0;
    room.votes = {};
    room.result = null;
    room.emergency = null;
    room.winner = null;
    room.guessRound = null;
    room.players.forEach(p => { p.asked = false; p.answered = false; p.ready = false; });

    const pool = roomPool(room);
    if (!pool.length) {
      room.state = "lobby";
      sys(room, "لا توجد كلمات مفعّلة! فعّل تصنيفاً أو أضف كلمات من إدارة الكلمات", "warn");
      return broadcast(room);
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    room.category = pick.cat;
    room.word = pick.word;

    // عشوائي، لكن من كان برّا السالفة الجولة الماضية تنخفض احتماليته كثيراً
    const prevSpies = new Set(room.lastSpyIds || []);
    const pickWeighted = (cands, k) => {
      const pool = cands.map(id => ({ id, w: prevSpies.has(id) ? 0.25 : 1 }));
      const out = [];
      while (out.length < k && pool.length) {
        const total = pool.reduce((a, x) => a + x.w, 0);
        let t = Math.random() * total;
        let i = 0;
        while (i < pool.length - 1 && (t -= pool[i].w) > 0) i++;
        out.push(pool.splice(i, 1)[0].id);
      }
      return out;
    };
    room.spyIds = pickWeighted(list.map(p => p.id), spyCount(room));
    room.lastSpyIds = [...room.spyIds];

    if (room.settings.firstPlayer === "host" && list.some(p => p.id === room.ownerId)) {
      room.turnId = room.ownerId;
    } else {
      room.turnId = list[Math.floor(Math.random() * list.length)].id;
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
    room.circleNo = Math.max(1, room.circleNo || 1);
    setPhase(room, "talking", room.settings.askTime, () => passTurn(room, true));
    const total = room.settings.circles;
    sys(room, total
      ? `ابدؤوا! الدورة ${room.circleNo} من ${total} — كل لاعب يسأل لاعباً آخر`
      : "ابدؤوا! دورات مفتوحة — المضيف يفتح التصويت وقت ما يشوف");
  }

  // نمط الدورة: المجيب يصير السائل، ولا يسأل من سأله للتو
  function passTurn(room, timedOut) {
    const list = playing(room);
    const asker = room.players.find(p => p.id === room.turnId);
    const target = room.players.find(p => p.id === room.targetId);
    if (asker) asker.asked = true;
    if (target) target.answered = true;

    // اكتملت الدورة؟
    if (list.every(p => p.asked) && list.every(p => p.answered)) {
      const total = room.settings.circles;
      if (total && room.circleNo >= total) {
        sys(room, "اكتملت الدورات — وقت التصويت 🗳️", "good");
        return beginVoting(room);
      }
      // دورة جديدة
      room.circleNo++;
      room.players.forEach(p => { p.asked = false; p.answered = false; });
      room.lastAskerId = null;
      sys(room, total
        ? `اكتملت الدورة! نبدأ الدورة ${room.circleNo} من ${total} 🔄`
        : "اكتملت دورة — نكمل! (المضيف يفتح التصويت وقت ما يشوف) 🔄", "good");
      const next0 = list[Math.floor(Math.random() * list.length)];
      room.turnId = next0.id;
      room.targetId = null;
      room.askerPickPending = true;
      return setPhase(room, "talking", room.settings.askTime, () => passTurn(room, true));
    }

    let next = target && target.connected && !target.spectator ? target : list.find(p => !p.asked);
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
    room.voteMax = room.spyIds.length || 1;   // عدد الأصوات المتاحة لكل لاعب
    setPhase(room, "voting", 60, () => tallyVotes(room));
    sys(room, room.voteMax > 1
      ? `صوّتوا على ${room.voteMax} لاعبين تشكّون فيهم 🗳️`
      : "صوّتوا على من تعتقدون أنه برّا السالفة 🗳️");
  }

  const allVoted = (room) => playing(room).every(p => (room.votes[p.id] || []).length >= (room.voteMax || 1));

  function tallyVotes(room) {
    clearTimers(room);
    const list = playing(room);
    const counts = {};
    Object.values(room.votes).forEach(arr => (arr || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
    const majority = Math.floor(list.length / 2) + 1;
    const accused = Object.keys(counts).filter(id => counts[id] >= majority);
    // برّا السالفة «ناجٍ» فقط إذا خمّنه أقل من ٥٠٪ من إجمالي اللاعبين
    const half = list.length / 2;
    const escaped = room.spyIds.filter(id => (counts[id] || 0) < half);
    const caughtSpies = room.spyIds.filter(id => !escaped.includes(id));

    // 🎯 نقطة لكل من اكتشف برّا السالفة بصوته — مستقلة عن نتيجة الأغلبية
    // (الجاسوس نفسه لا يُكافأ لو صوّت على زميله؛ المكافأة للعارفين)
    const gains = {};
    const add = (id, n) => { gains[id] = (gains[id] || 0) + n; };
    Object.entries(room.votes).forEach(([voter, arr]) => {
      if (room.spyIds.includes(voter)) return;
      (arr || []).forEach(t => { if (room.spyIds.includes(t)) add(voter, 1); });
    });

    room.result = {
      votes: Object.fromEntries(Object.entries(room.votes).map(([k, v]) => [k, [...(v || [])]])),
      counts, accused, majority,
      spyIds: [...room.spyIds],
      spyNames: room.spyIds.map(id => room.players.find(p => p.id === id)?.name || "—"),
      caughtIds: caughtSpies, escapedIds: escaped,
      word: room.word, category: room.category,
      caught: caughtSpies.length > 0 && escaped.length === 0,
      gains, picks: {}, phase: "votes"
    };

    // 😈 بعد كل تصويت: كل برّا السالفة (مكشوفاً كان أو ناجياً) يحاول اكتشاف
    // السالفة من قائمة كلمات — الاختيار الصحيح = نقطتان، الخطأ = لا شيء
    const guessers = room.spyIds.filter(id => {
      const p = room.players.find(x => x.id === id);
      return p && p.connected && !p.spectator;
    });
    if (guessers.length) {
      room.guessRound = { ids: [...guessers], answered: {} };
      room.result.phase = "spyGuess";
      broadcast(room);
      setPhase(room, "spyGuess", Math.round(GUESS_MS / 1000), () => finishRound(room));
      guessers.forEach(id => {
        nsp.to(id).emit("yourGuess", {
          category: room.category,
          choices: guessChoices(room),
          seconds: Math.round(GUESS_MS / 1000)
        });
      });
      sys(room, room.result.caught
        ? "تم كشف برّا السالفة! أمامه فرصة أخيرة يختار فيها السالفة 😈"
        : "انتهى التصويت — برّا السالفة يحاول الآن اكتشاف السالفة 😈", "warn");
    } else {
      finishRound(room);
    }
  }

  // ٦ كلمات من نفس التصنيف فيها السالفة الحقيقية
  function guessChoices(room) {
    const cats = roomPacks(room);
    let same = (cats[room.category] || []).filter(w => w !== room.word);
    if (same.length < GUESS_CHOICES - 1) {
      const extra = [];
      Object.entries(cats).forEach(([c, list]) => {
        if (c === room.category) return;
        list.forEach(w => { if (w !== room.word) extra.push(w); });
      });
      same = same.concat(shuffle(extra).slice(0, GUESS_CHOICES - 1 - same.length));
    }
    const decoys = shuffle([...same]).slice(0, GUESS_CHOICES - 1);
    return shuffle([room.word, ...decoys]);
  }

  /* توزيع النقاط:
     • كل من صوّت على برّا السالفة يأخذ نقطة (لكل تصويت صحيح).
     • برّا السالفة: إن خمّنه أقل من ٥٠٪ من اللاعبين ⇒ نقطة واحدة.
     • وإن اختار السالفة الصحيحة ⇒ نقطتان. غير ذلك لا شيء. */
  function finishRound(room) {
    clearTimers(room);
    const r = room.result;
    if (!r || r.phase === "done") return;
    const add = (id, n) => { r.gains[id] = (r.gains[id] || 0) + n; };

    r.escapedIds.forEach(id => add(id, 1));   // أقل من ٥٠٪ خمّنوه ⇒ نقطة واحدة

    let stolen = false;
    if (room.guessRound) {
      r.picks = { ...room.guessRound.answered };
      room.guessRound.ids.forEach(id => {
        const pick = room.guessRound.answered[id];
        if (pick && normalize(pick) === normalize(room.word)) { add(id, 2); stolen = true; }
      });
    }
    if (room.emergencyStarterId && r.caught) add(room.emergencyStarterId, 1);

    r.stolen = stolen;
    r.outcome = r.escapedIds.length ? "spyEscaped" : (stolen ? "spyStole" : "insidersWin");
    r.phase = "done";
    room.emergencyStarterId = null;

    Object.entries(r.gains).forEach(([id, n]) => {
      const p = room.players.find(x => x.id === id);
      if (p) p.score += n;
    });

    const champ = room.players.filter(p => p.connected).sort((a, b) => b.score - a.score)[0];
    if (champ && champ.score >= room.settings.scoreLimit) {
      room.winner = { id: champ.id, name: champ.name, score: champ.score };
      setPhase(room, "gameEnd", 0, null);
      saveStats(room, champ);
      sys(room, `🏆 ${champ.name} فاز باللعبة بـ ${champ.score} نقطة!`, "good");
    } else {
      setPhase(room, "result", Math.round(RESULT_MS / 1000), () => {
        if (room.state !== "result") return;
        clearTimers(room);          // مهم: نوقف نبض المؤقت وإلا بقي يبثّ صفراً
        room.state = "lobby";
        room.endsAt = 0;
        broadcast(room);
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

    socket.on("createRoom", async ({ name, settings } = {}, cb) => {
      if (typeof cb !== "function") return;
      if (room) leaveRoom(true);
      const id = makeRoomId();
      const r = {
        id, players: [], state: "lobby", ownerId: socket.id,
        ownerUser: socket.userName || null,
        settings: sanitize(settings || {}, DEFAULTS),
        words: emptyWords(),
        roundNo: 0, circleNo: 0, category: null, word: null, spyIds: [], lastSpyIds: [],
        turnId: null, targetId: null, askerPickPending: false, lastAskerId: null,
        votes: {}, voteMax: 1, result: null, emergency: null, emergencyStarterId: null,
        guessRound: null, winner: null,
        endsAt: 0, phaseTimer: null, tickTimer: null, emgTimer: null
      };
      // اللاعب المسجَّل: نحمّل كلماته وإعداداته المحفوظة
      if (r.ownerUser) {
        try {
          const prof = await store.getKV(PROFILE_KEY(r.ownerUser));
          if (prof) {
            if (prof.words) r.words = wordsFromJSON(prof.words);
            if (prof.settings) r.settings = sanitize(prof.settings, r.settings);
          }
        } catch (e) {}
      }
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
      // ✨ كما في لعبة الرسم: الرجوع بنفس الاسم يستعيد النقاط والدور والتقدم
      const wanted = (socket.userName || String(name || "").trim().slice(0, 20) || "لاعب");
      const ghost = r.players.find(x => !x.connected && x.name === wanted);
      if (ghost) {
        sys(r, `${ghost.name} رجع وواصل من حيث توقف 🔄`);
        return reattach(r, ghost, cb);
      }
      clearTimeout(r._emptyT);
      player = makePlayer(name);
      if (!["lobby", "result", "gameEnd"].includes(r.state)) player.spectator = true;
      r.players.push(player);
      room = r;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: player.id, token: player.token });
      sys(r, `${player.name} انضم${player.spectator ? " (متفرج حتى الجولة القادمة)" : ""} 👋`);
      broadcast(r);
    });

    // إعادة ربط لاعب موجود (منقطع) بهذه الجلسة: يستعيد نقاطه ودوره وأصواته كاملة
    function reattach(r, p, cb) {
      clearTimeout(r._emptyT);
      const oldId = p.id;
      p.id = socket.id; p.connected = true; p.disconnectedAt = 0;
      if (r.ownerId === oldId) r.ownerId = socket.id;
      if (r.turnId === oldId) r.turnId = socket.id;
      if (r.targetId === oldId) r.targetId = socket.id;
      if (r.lastAskerId === oldId) r.lastAskerId = socket.id;
      r.spyIds = r.spyIds.map(x => (x === oldId ? socket.id : x));
      r.lastSpyIds = (r.lastSpyIds || []).map(x => (x === oldId ? socket.id : x));
      if (r.guessRound) {
        r.guessRound.ids = r.guessRound.ids.map(x => (x === oldId ? socket.id : x));
        if (r.guessRound.answered[oldId]) { r.guessRound.answered[socket.id] = r.guessRound.answered[oldId]; delete r.guessRound.answered[oldId]; }
      }
      if (r.votes[oldId]) { r.votes[socket.id] = r.votes[oldId]; delete r.votes[oldId]; }
      Object.keys(r.votes).forEach(k => { r.votes[k] = (r.votes[k] || []).map(x => (x === oldId ? socket.id : x)); });
      room = r; player = p;
      socket.join(r.id);
      cb({ ok: true, roomId: r.id, you: p.id, token: p.token, resumed: true, state: state(r) });
      if (["reveal", "talking", "voting", "spyGuess"].includes(r.state) && !p.spectator) {
        const spy = r.spyIds.includes(p.id);
        nsp.to(p.id).emit("role", { spy, category: r.category, word: spy ? null : r.word, spies: r.spyIds.length, roundNo: r.roundNo });
        if (r.state === "spyGuess" && r.guessRound && r.guessRound.ids.includes(p.id) && !r.guessRound.answered[p.id]) {
          nsp.to(p.id).emit("yourGuess", { category: r.category, choices: guessChoices(r), seconds: Math.max(3, Math.round((r.endsAt - Date.now()) / 1000)) });
        }
      }
      broadcast(r);
    }

    socket.on("rejoin", ({ roomId, token } = {}, cb) => {
      if (typeof cb !== "function") return;
      const r = rooms.get(String(roomId || "").trim());
      if (!r) return cb({ ok: false, error: "الغرفة انتهت" });
      const p = r.players.find(x => x.token === token);
      if (!p) return cb({ ok: false, error: "انتهت جلستك" });
      if (p.connected && p.id !== socket.id) return cb({ ok: false, error: "الجلسة مفتوحة في مكان آخر" });
      if (room) leaveRoom(true);
      reattach(r, p, cb);
    });

    socket.on("leaveRoom", () => leaveRoom(true));

    socket.on("updateSettings", (s) => {
      if (!room || !player || room.ownerId !== player.id) return;
      room.settings = sanitize(s || {}, room.settings);
      persistWords(room);
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
      room.category = null; room.word = null; room.spyIds = []; room.endsAt = 0;
      room.players.forEach(p => { p.spectator = false; p.score = 0; });
      broadcast(room);
    });

    socket.on("ready", () => {
      if (!room || !player || room.state !== "reveal") return;
      player.ready = true;
      broadcast(room);
      if (playing(room).every(p => p.ready)) beginTalk(room);
    });

    // نمط الدورة: السائل يختار من يسأل
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

    // المجيب يضغط «أجبت» → ينتقل الدور إليه
    socket.on("answered", () => {
      if (!room || !player || room.state !== "talking") return;
      if (room.settings.flow !== "circle") return;
      if (room.targetId !== player.id) return;
      passTurn(room, false);
    });

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
      if (agree) { if (!e.yes.includes(player.id)) e.yes.push(player.id); }
      else e.yes = e.yes.filter(id => id !== player.id);
      if (e.yes.length >= e.need) {
        room.emergencyStarterId = e.byId;
        clearTimeout(room.emgTimer);
        room.emergency = null;
        sys(room, "وافقت الأغلبية — التصويت الآن! 🗳️", "good");
        return beginVoting(room);
      }
      broadcast(room);
    });

    // التصويت السرّي — يسمح بعدد أصوات = عدد الخارجين عن السالفة
    socket.on("vote", (targetId) => {
      if (!room || !player || room.state !== "voting") return;
      if (player.spectator || !player.connected) return;
      const t = room.players.find(p => p.id === targetId);
      if (!t || t.spectator || !t.connected || t.id === player.id) return;
      const max = room.voteMax || 1;
      const mine = room.votes[player.id] || (room.votes[player.id] = []);
      const i = mine.indexOf(t.id);
      if (i >= 0) mine.splice(i, 1);                       // إلغاء الصوت
      else if (mine.length < max) mine.push(t.id);
      else return nsp.to(player.id).emit("toast", `تقدر تصوّت على ${max} فقط — ألغِ صوتاً أولاً`);
      nsp.to(player.id).emit("myVotes", [...mine]);
      broadcast(room);
      if (allVoted(room)) tallyVotes(room);
    });

    // اختيار برّا السالفة من قائمة الكلمات
    socket.on("spyPick", (word) => {
      if (!room || !player || room.state !== "spyGuess") return;
      const gr = room.guessRound;
      if (!gr || !gr.ids.includes(player.id) || gr.answered[player.id]) return;
      const w = String(word || "").trim().slice(0, 40);
      gr.answered[player.id] = w;
      const hit = normalize(w) === normalize(room.word);
      sys(room, hit ? `😈 ${player.name} اختار «${room.word}» — سرق الفوز!` : `${player.name} اختار «${w}» — غلط`, hit ? "warn" : "good");
      if (gr.ids.every(id => gr.answered[id])) finishRound(room);
      else broadcast(room);
    });

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
      if (room.word && ["reveal", "talking", "voting", "spyGuess"].includes(room.state)
          && normalize(t).includes(normalize(room.word))) {
        return nsp.to(player.id).emit("toast", "ممنوع كتابة كلمة السر في الدردشة!");
      }
      nsp.to(room.id).emit("chat", { name: player.name, text: t });
    });

    /* ===== إدارة الكلمات والتصنيفات (للمضيف) ===== */
    socket.on("wordsList", (cb) => {
      if (typeof cb !== "function" || !room) return;
      cb({
        builtin: words.PACKS,
        extra: room.words.extra,
        removedWords: [...room.words.removedWords],
        removedCats: [...room.words.removedCats],
        saved: !!room.ownerUser
      });
    });

    socket.on("addWord", (data, cb) => {
      if (!room || socket.id !== room.ownerId) return;
      const done = r => typeof cb === "function" && cb(r);
      const W = room.words;
      const word = String(data?.word || "").trim().slice(0, 40);
      const cat = String(data?.cat || "").trim();
      if (word.length < 2) return done({ ok: false, error: "الكلمة قصيرة جدًا" });
      const cats = roomPacks(room);
      if (!cats[cat]) return done({ ok: false, error: "التصنيف غير موجود" });
      if (W.removedWords.has(word) && (words.PACKS[cat] || []).includes(word)) {
        W.removedWords.delete(word);
        persistWords(room); broadcast(room);
        return done({ ok: true, restored: true });
      }
      if (cats[cat].includes(word)) return done({ ok: false, error: "الكلمة موجودة في هذا التصنيف" });
      (W.extra[cat] = W.extra[cat] || []).push(word);
      persistWords(room); broadcast(room);
      done({ ok: true });
    });

    socket.on("removeWord", (word) => {
      if (!room || socket.id !== room.ownerId) return;
      const W = room.words;
      word = String(word || "").trim();
      let inExtra = false;
      for (const cat of Object.keys(W.extra)) {
        const i = W.extra[cat].indexOf(word);
        if (i >= 0) { W.extra[cat].splice(i, 1); inExtra = true; }
      }
      const allBuiltin = Object.values(words.PACKS).flat();
      if (!inExtra && allBuiltin.includes(word)) W.removedWords.add(word);
      persistWords(room); broadcast(room);
    });

    socket.on("restoreWord", (word) => {
      if (!room || socket.id !== room.ownerId) return;
      room.words.removedWords.delete(String(word || "").trim());
      persistWords(room); broadcast(room);
    });

    socket.on("addCategory", (name, cb) => {
      if (!room || socket.id !== room.ownerId) return;
      const done = r => typeof cb === "function" && cb(r);
      const W = room.words;
      name = String(name || "").trim().slice(0, 24);
      if (name.length < 2) return done({ ok: false, error: "اسم التصنيف قصير جدًا" });
      if (name === "الكل") return done({ ok: false, error: "اسم محجوز" });
      if (W.removedCats.has(name)) { W.removedCats.delete(name); persistWords(room); broadcast(room); return done({ ok: true }); }
      if (roomPacks(room)[name]) return done({ ok: false, error: "التصنيف موجود أصلًا" });
      W.extra[name] = W.extra[name] || [];
      persistWords(room); broadcast(room);
      done({ ok: true });
    });

    socket.on("removeCategory", (name) => {
      if (!room || socket.id !== room.ownerId) return;
      const W = room.words;
      name = String(name || "").trim();
      if (words.PACKS[name]) W.removedCats.add(name);
      delete W.extra[name];
      room.settings.packs = (room.settings.packs || []).filter(n => n !== name);
      persistWords(room); broadcast(room);
    });

    socket.on("restoreCategory", (name) => {
      if (!room || socket.id !== room.ownerId) return;
      room.words.removedCats.delete(String(name || "").trim());
      persistWords(room); broadcast(room);
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
      if (r.state === "voting" && playing(r).length && allVoted(r)) tallyVotes(r);
      if (r.state === "spyGuess" && r.guessRound && r.guessRound.ids.every(id => r.guessRound.answered[id])) finishRound(r);
      broadcast(r);
      // اللاعب المنقطع يبقى محفوظاً (بنقاطه ودوره) — يرجع بالتوكن أو بنفس الاسم.
      // وإذا انقطع الجميع تبقى الغرفة مهلةً كافية ثم تُحذف
      if (!r.players.some(x => x.connected)) {
        clearTimeout(r._emptyT);
        r._emptyT = setTimeout(() => {
          if (rooms.has(r.id) && !r.players.some(x => x.connected)) { clearTimers(r); rooms.delete(r.id); }
        }, EMPTY_ROOM_MS);
      }
      room = null; player = null;
    });
  });

  return { liveStats, publicRooms };
}

module.exports = { setupSalfa, DEFAULTS, sanitize, spyCount, normalize, emptyWords, roomPacks, roomPool };
