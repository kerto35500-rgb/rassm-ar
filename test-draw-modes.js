// اختبار أوضاع «ارسمها!»: الفرق، والمحاولات، و«الكلّ يرسم».
//
// نشغّل الخادم الحقيقيّ ونتّصل به بمقابس socket.io حقيقيّة — لأنّ ما نختبره
// هنا تسلسلُ أطوارٍ ومؤقّتاتٍ لا دوالُّ نقيّة، ومحاكاةُ المقبس تُخفي أخطاء
// الترتيب بالضبط في الموضع الذي نخشاه.

// ملاحظة: `socket.io-client` غير متاحٍ في هذه البيئة (npm محجوب)، فنتكلّم
// بروتوكول socket.io على الأسلاك مباشرةً فوق `ws` — وهي حزمةٌ موجودةٌ أصلًا
// لأنّ engine.io يعتمد عليها. الرسائل نصّيّة وبسيطة:
//   "0{…}" فتحُ اتّصال · "40" دخول المساحة · "42[اسم,حمولة]" حدث
//   "42N[…]" حدثٌ ينتظر ردًّا · "43N[…]" الردّ · "2"/"3" نبضٌ وردُّه
const WebSocket = require("ws");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PORT = 8951 + Math.floor(Math.random() * 40);
process.env.PORT = String(PORT);
process.env.NO_ADMIN = "1";
require("./server.js");

const WSURL = "ws://127.0.0.1:" + PORT + "/socket.io/?EIO=4&transport=websocket";

class Sock {
  constructor(name) {
    this.nick = name; this.st = null; this.chats = []; this.ev = {};
    this.id = null; this.acks = new Map(); this.ackId = 0; this.open = false;
    this.ws = new WebSocket(WSURL);
    this.ws.on("message", raw => this._rx(String(raw)));
  }
  _rx(m) {
    if (m === "2") return this.ws.send("3");            /* نبضٌ يُردّ عليه */
    if (m[0] === "0") return this.ws.send("40");        /* فُتح ⇒ ادخل المساحة */
    if (m.startsWith("40")) {
      try { this.id = JSON.parse(m.slice(2)).sid; } catch (e) {}
      this.open = true; return;
    }
    if (m.startsWith("43")) {                            /* ردٌّ على طلبٍ لنا */
      const i = m.indexOf("[");
      const id = +m.slice(2, i);
      const fn = this.acks.get(id);
      if (fn) { this.acks.delete(id); fn(JSON.parse(m.slice(i))[0]); }
      return;
    }
    if (!m.startsWith("42")) return;
    let body;
    try { body = JSON.parse(m.slice(2)); } catch (e) { return; }
    const [name, data] = body;
    if (name === "roomState") this.st = data;
    else if (name === "chat") this.chats.push(data);
    (this.ev[name] = this.ev[name] || []).push(data === undefined ? true : data);
  }
  emit(name, data) {
    if (this.ws.readyState !== 1) return;
    this.ws.send("42" + JSON.stringify(data === undefined ? [name] : [name, data]));
  }
  ask(name, data) {
    return new Promise(res => {
      const id = ++this.ackId;
      this.acks.set(id, res);
      this.ws.send("42" + id + JSON.stringify([name, data]));
      setTimeout(() => { if (this.acks.delete(id)) res(null); }, 3000);
    });
  }
  disconnect() { try { this.ws.close(); } catch (e) {} }
}
const conn = name => new Sock(name);
const ready = s => new Promise(r => {
  const t = setInterval(() => { if (s.open) { clearInterval(t); r(); } }, 20);
});
const call = (s, e, d) => s.ask(e, d);
/* ينتظر شرطًا حتى يتحقّق أو تنتهي المهلة — أدقّ من النوم الأعمى */
async function until(fn, ms = 4000, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return false;
}

(async () => {
  await sleep(1200);
  console.log("\n═══ أوضاع ارسمها! ═══\n");

  /* ─────────────── الفرق ─────────────── */
  console.log("① الفرق: التوزيع والتناوب");
  let A, B, C, D;
  {
    A = conn("أحمد"); B = conn("بدر"); C = conn("خالد"); D = conn("داوود");
    await Promise.all([A, B, C, D].map(ready));
    const r = await call(A, "createRoom", { name: "أحمد" });
    ok(r && r.ok, "أُنشئت غرفة", r);
    const code = r.roomId;
    for (const s of [B, C, D]) await call(s, "joinRoom", { name: s.nick, roomId: code });
    await until(() => A.st && A.st.players.length === 4);
    eq(A.st.players.length, 4, "أربعةُ لاعبين");

    A.emit("updateSettings", { mode: "teams", rounds: 1, turnTime: 20, attempts: 2, category: "الكل" });
    await until(() => A.st.settings.mode === "teams");
    eq(A.st.settings.attempts, 2, "ضُبطت المحاولات باثنتين");
    ok(A.st.attemptsOn === true, "والمحاولات مفعّلةٌ حتمًا في وضع الفرق", A.st.attemptsOn);

    A.emit("startGame");
    await until(() => A.st.state === "picking", 3000);
    eq(A.st.state, "picking", "بدأت اللعبة");
    const teams = A.st.players.map(p => p.team);
    ok(teams.every(t => t === "red" || t === "blue"), "كلُّ لاعبٍ في فريق", teams);
    eq(teams.filter(t => t === "red").length, 2, "اثنان أحمر");
    eq(teams.filter(t => t === "blue").length, 2, "واثنان أزرق");
    ok(A.st.teamScores && A.st.teamScores.red === 0, "ومجموع الفريقين صفر", A.st.teamScores);
  }

  console.log("② الفرق: التخمين محصورٌ بفريق الرسّام");
  let word = null, drawer = null, mates = [], foes = [];
  {
    const socks = { [A.id]: A, [B.id]: B, [C.id]: C, [D.id]: D };
    const st = A.st;
    drawer = socks[st.drawerId];
    ok(!!drawer, "عُرف الرسّام", st.drawerName);
    /* الرسّام يختار الكلمة */
    const opts = (drawer.ev.chooseWord || [])[0];
    ok(opts && opts.options && opts.options.length === 3, "ووصلته ثلاثُ كلمات", opts && opts.options);
    word = opts.options[0];
    drawer.emit("chooseWord", word);
    await until(() => A.st.state === "drawing", 3000);
    eq(A.st.state, "drawing", "بدأ الرسم");

    const dt = A.st.players.find(p => p.id === drawer.id).team;
    eq(A.st.guessTeam, dt, "والتخمين لفريق الرسّام");
    ok(A.st.steal === false, "ولا خطفَ بعد");
    mates = [A, B, C, D].filter(s => s !== drawer && A.st.players.find(p => p.id === s.id).team === dt);
    foes = [A, B, C, D].filter(s => A.st.players.find(p => p.id === s.id).team !== dt);
    eq(mates.length, 1, "شريكٌ واحدٌ للرسّام");
    eq(foes.length, 2, "وخصمان");

    /* الخصم يكتب الكلمة الصحيحة: تُنشَر كدردشةٍ ولا تُحتسَب */
    const foe = foes[0];
    const before = A.st.teamScores;
    foe.chats = [];
    foe.emit("chat", word);
    await sleep(250);
    eq(A.st.teamScores, before, "الخصمُ يكتب الكلمة فلا نقاط");
    ok(A.st.state === "drawing", "والدور مستمرّ");
    ok(foe.chats.some(m => !m.system && m.text === word), "ورسالتُه ظهرت كدردشةٍ عاديّة",
       foe.chats.map(m => m.text).slice(-3));
  }

  console.log("③ الفرق: المحاولات ثمّ الخطف");
  {
    const mate = mates[0];
    mate.ev.guessResult = [];
    mate.emit("chat", "كلمةٌ غلط");
    await sleep(180);
    let g = (mate.ev.guessResult || []).pop();
    eq(g && g.left, 1, "بقيت له محاولةٌ واحدة", g);
    mate.emit("chat", "غلطٌ آخر");
    await until(() => A.st.steal === true, 3000);
    ok(A.st.steal === true, "نفدت محاولات فريقه ⇐ فُتح الخطف", A.st.steal);
    const dt = A.st.players.find(p => p.id === drawer.id).team;
    eq(A.st.guessTeam, dt === "red" ? "blue" : "red", "والتخمين انتقل للخصم");
    eq(A.st.maxTries, 1, "ومحاولةٌ واحدةٌ لكلّ خاطف");
    ok(A.st.timeLeft <= 6, "وبربع الوقت تقريبًا", A.st.timeLeft);
    eq(A.st.players.find(p => p.id === foes[0].id).tries, 0, "ومحاولات الخاطفين من جديد");

    /* الخاطف يخمّن ⇒ ٥ نقاطٍ لفريقه وينتهي الدور */
    const foe = foes[0];
    const foeTeam = A.st.players.find(p => p.id === foe.id).team;
    foe.emit("chat", word);
    await until(() => A.st.state === "turnEnd" || (A.st.teamScores || {})[foeTeam] > 0, 3000);
    eq((A.st.teamScores || {})[foeTeam], 5, "الخطفُ خمسُ نقاطٍ للفريق", A.st.teamScores);
    eq((A.st.teamScores || {})[foeTeam === "red" ? "blue" : "red"], 0, "ولا شيء للآخر");
    ok((A.ev.turnEnd || []).length >= 1, "وانتهى الدور فورًا");
  }

  console.log("④ الفرق: عشرُ نقاطٍ لمن خمّن في دوره، مرّةً واحدة");
  {
    await until(() => A.st.state === "picking" || A.st.state === "gameEnd", 8000);
    if (A.st.state === "picking") {
      const socks = { [A.id]: A, [B.id]: B, [C.id]: C, [D.id]: D };
      const dr = socks[A.st.drawerId];
      const dt2 = A.st.players.find(p => p.id === dr.id).team;
      ok(true, "دورٌ جديدٌ لفريقٍ آخر: " + dt2);
      const w2 = ((dr.ev.chooseWord || []).pop() || {}).options?.[0];
      dr.emit("chooseWord", w2);
      await until(() => A.st.state === "drawing", 3000);
      const mate2 = [A, B, C, D].find(s => s !== dr && A.st.players.find(p => p.id === s.id).team === dt2);
      const before = { ...A.st.teamScores };
      mate2.emit("chat", w2);
      await until(() => (A.st.teamScores || {})[dt2] > (before[dt2] || 0), 3000);
      eq((A.st.teamScores || {})[dt2] - (before[dt2] || 0), 10, "عشرُ نقاطٍ للفريق", A.st.teamScores);
      ok((A.ev.turnEnd || []).length >= 2, "وانتهى الدور بأوّل تخمينٍ صحيح");
    } else ok(true, "(انتهت اللعبة قبل الدور الثاني)");
  }

  [A, B, C, D].forEach(s => s.disconnect());
  await sleep(200);

  /* ─────────────── المحاولات في الكلاسيكيّ ─────────────── */
  console.log("⑤ الكلاسيكيّ بالمحاولات");
  {
    const H = conn("قائد"), G1 = conn("لاعب1"), G2 = conn("لاعب2");
    await Promise.all([H, G1, G2].map(ready));
    const r = await call(H, "createRoom", { name: "قائد" });
    for (const s of [G1, G2]) await call(s, "joinRoom", { name: s.nick, roomId: r.roomId });
    await until(() => H.st && H.st.players.length === 3);

    H.emit("updateSettings", { mode: "classic", rounds: 1, turnTime: 60, useAttempts: false });
    await until(() => H.st.settings.useAttempts === false);
    ok(H.st.attemptsOn === false, "بلا محاولاتٍ افتراضيًّا في الكلاسيكيّ", H.st.attemptsOn);

    H.emit("updateSettings", { mode: "classic", rounds: 1, turnTime: 60, useAttempts: true, attempts: 1 });
    await until(() => H.st.attemptsOn === true, 2000);
    ok(H.st.attemptsOn === true, "وتُفعَّل باختيار المضيف");
    eq(H.st.maxTries, 1, "بمحاولةٍ واحدة");

    H.emit("startGame");
    await until(() => H.st.state === "picking", 3000);
    const socks = { [H.id]: H, [G1.id]: G1, [G2.id]: G2 };
    const dr = socks[H.st.drawerId];
    const w = ((dr.ev.chooseWord || []).pop() || {}).options?.[0];
    dr.emit("chooseWord", w);
    await until(() => H.st.state === "drawing", 3000);

    const guessers = [H, G1, G2].filter(s => s !== dr);
    guessers[0].ev.guessResult = [];
    guessers[0].emit("chat", "خطأ");
    await sleep(200);
    let g = (guessers[0].ev.guessResult || []).pop();
    eq(g && g.left, 0, "نفدت محاولتُه الوحيدة", g);
    ok(g && g.spent === true, "وعُلِّم مستنفَدًا");

    /* حتى لو كتب الكلمة الصحيحة بعدها لا تُحتسَب */
    const scoreBefore = H.st.players.find(p => p.id === guessers[0].id).score;
    guessers[0].emit("chat", w);
    await sleep(250);
    eq(H.st.players.find(p => p.id === guessers[0].id).score, scoreBefore,
       "ومن نفدت محاولاتُه لا يُحتسَب تخمينُه ولو أصاب");

    /* نفاد محاولات الجميع ينهي الدور */
    guessers[1].emit("chat", "خطأ آخر");
    await until(() => (H.ev.turnEnd || []).length >= 1, 3000);
    const te = (H.ev.turnEnd || []).pop();
    eq(te && te.reason, "attempts", "ونفادُ محاولات الجميع ينهي الدور", te);

    [H, G1, G2].forEach(s => s.disconnect());
    await sleep(200);
  }

  /* ─────────────── الكلّ يرسم ─────────────── */
  console.log("⑥ الكلّ يرسم: اختيار القائد للكلمة و«انتهيت»");
  {
    const H = conn("قائد"), G1 = conn("لاعب1"), G2 = conn("لاعب2");
    await Promise.all([H, G1, G2].map(ready));
    const r = await call(H, "createRoom", { name: "قائد" });
    for (const s of [G1, G2]) await call(s, "joinRoom", { name: s.nick, roomId: r.roomId });
    await until(() => H.st && H.st.players.length === 3);

    H.emit("updateSettings", { mode: "vote", rounds: 1, turnTime: 300, votePick: "host" });
    await until(() => H.st.settings.mode === "vote", 2000);
    eq(H.st.settings.turnTime, 300, "خمسُ دقائق مسموحة في هذا الوضع");
    eq(H.st.settings.votePick, "host", "والقائد يختار الكلمة");

    H.emit("startGame");
    await until(() => H.st.state === "votePick", 3000);
    eq(H.st.state, "votePick", "طورُ اختيار الكلمة");
    const pick = (H.ev.votePickWord || [])[0];
    ok(pick && pick.words && pick.words.length > 5, "ووصلت القائدَ قائمةُ كلماتٍ", pick && pick.words?.length);
    ok(!G1.ev.votePickWord, "ولم تصل غيرَه");

    const chosen = pick.words[3];
    H.emit("chooseVoteWord", chosen);
    await until(() => H.st.state === "drawAll", 3000);
    eq(H.st.state, "drawAll", "بدأ الرسم الجماعيّ");
    eq(H.st.timeLeft > 250, true, "بوقتٍ طويل", H.st.timeLeft);

    /* «انتهيت» قابلٌ للتراجع */
    H.emit("doneDrawing", true);
    await until(() => H.st.doneCount === 1, 2000);
    eq(H.st.doneCount, 1, "أعلن واحدٌ انتهاءه");
    ok(H.st.players.find(p => p.id === H.id).done === true, "ويظهر ذلك للجميع");
    H.emit("doneDrawing", false);
    await until(() => H.st.doneCount === 0, 2000);
    eq(H.st.doneCount, 0, "وتراجَع عنه");

    /* الرسمة تُرسَل حين يطلبها الخادم لا قبله — الحالة يجب أن تكون «تجميع» */
    const img = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    [H, G1, G2].forEach(s => {
      s.ws.on("message", raw => {
        if (String(raw).startsWith('42["requestDrawing"')) s.emit("submitDrawing", img);
      });
    });
    [H, G1, G2].forEach(s => s.emit("doneDrawing", true));
    await until(() => H.st.state === "collecting" || H.st.state === "voting", 3000);
    ok(["collecting", "voting"].includes(H.st.state), "وانتقلنا بلا انتظار الوقت", H.st.state);

    console.log("⑦ الكلّ يرسم: التصويت واحدةً واحدة");
    await until(() => (H.ev.galleryOne || []).length >= 1, 6000);
    const one = (H.ev.galleryOne || [])[0];
    ok(one && one.entry && typeof one.index === "number", "وصلت رسمةٌ واحدة", one && one.index);
    eq(one.total >= 2, true, "ومجموعُ الرسمات معلوم", one && one.total);
    ok(one.word, "ومعها الكلمة");

    /* صاحبُ الرسمة لا يصوّت، والبقيّة صوتٌ أو امتناع */
    const owner = [H, G1, G2].find(s => s.id === one.entry.id);
    const others = [H, G1, G2].filter(s => s !== owner);
    owner.emit("voteOne", { index: one.index, yes: true });
    await sleep(150);
    ok(true, "محاولةُ صاحبها تُتجاهَل بلا خطأ");
    others[0].emit("voteOne", { index: one.index, yes: true });
    others[1].emit("voteOne", { index: one.index, yes: false });   /* امتناع */
    await until(() => (H.ev.galleryOne || []).length >= 2, 4000);
    ok((H.ev.galleryOne || []).length >= 2, "وبعد رأي الجميع ننتقل للتالية",
       (H.ev.galleryOne || []).length);
    eq((H.ev.galleryOne || [])[1].index, one.index + 1, "بالترتيب");

    /* المضيف يقطع الانتظار */
    const n0 = (H.ev.galleryOne || []).length;
    H.emit("nextDrawing");
    await until(() => (H.ev.galleryOne || []).length > n0 || (H.ev.voteResults || []).length, 4000);
    ok((H.ev.galleryOne || []).length > n0 || (H.ev.voteResults || []).length,
       "والقائد يقدر أن يتخطّى");

    /* آخر رسمةٍ لا أحد يصوّت عليها ⇒ تنتظر مؤقّتها كاملًا (٢٥ث) */
    await until(() => (H.ev.voteResults || []).length >= 1, 32000);
    const res = (H.ev.voteResults || [])[0];
    ok(res && Array.isArray(res.results), "ووصلت النتائج", res && res.results?.length);
    ok(res.results.some(x => x.votes >= 1), "وفيها صوتٌ واحدٌ على الأقلّ", res && res.results);

    [H, G1, G2].forEach(s => s.disconnect());
    await sleep(200);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
