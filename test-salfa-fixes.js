// اختبار إصلاحات «برّا السالفة».
//
// كلُّ اختبارٍ هنا يقابل عطبًا اشتكى منه صاحب الموقع، ومكتوبٌ بحيث يفشل
// على النسخة القديمة وينجح على الجديدة — فلو عاد أحدُها يومًا صرخ الاختبار.
//
// نتكلّم بروتوكول socket.io على الأسلاك فوق `ws` (المكتبة العميلة محجوبة).

const WebSocket = require("ws");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PORT = 9010 + Math.floor(Math.random() * 40);
process.env.PORT = String(PORT);
require("./server.js");

const WSURL = "ws://127.0.0.1:" + PORT + "/salfa?EIO=4&transport=websocket";

class Sock {
  constructor(name) {
    this.nick = name; this.st = null; this.ev = {}; this.chats = [];
    this.id = null; this.acks = new Map(); this.ackId = 0; this.open = false;
    /* مساحةُ «برّا السالفة» اسمُها ‎/salfa‎ — ندخلها بـ‎40/salfa,‎ */
    this.ws = new WebSocket("ws://127.0.0.1:" + PORT + "/socket.io/?EIO=4&transport=websocket");
    this.ws.on("message", raw => this._rx(String(raw)));
  }
  _rx(m) {
    if (m === "2") return this.ws.send("3");
    if (m[0] === "0" && m[1] === "{") return this.ws.send("40/salfa,");
    if (m.startsWith("40/salfa,")) {
      try { this.id = JSON.parse(m.slice(9)).sid; } catch (e) {}
      this.open = true; return;
    }
    const pre = "43/salfa,";
    if (m.startsWith(pre)) {
      const i = m.indexOf("[");
      const fn = this.acks.get(+m.slice(pre.length, i));
      if (fn) { this.acks.delete(+m.slice(pre.length, i)); fn(JSON.parse(m.slice(i))[0]); }
      return;
    }
    if (!m.startsWith("42/salfa,")) return;
    let body; try { body = JSON.parse(m.slice(9)); } catch (e) { return; }
    const [name, data] = body;
    if (name === "state") this.st = data;
    else if (name === "chat") this.chats.push(data);
    (this.ev[name] = this.ev[name] || []).push(data === undefined ? true : data);
  }
  emit(name, data) {
    if (this.ws.readyState !== 1) return;
    this.ws.send("42/salfa," + JSON.stringify(data === undefined ? [name] : [name, data]));
  }
  ask(name, data) {
    return new Promise(res => {
      const id = ++this.ackId;
      this.acks.set(id, res);
      this.ws.send("42/salfa," + id + JSON.stringify([name, data]));
      setTimeout(() => { if (this.acks.delete(id)) res(null); }, 3000);
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}
const conn = n => new Sock(n);
const ready = s => new Promise(r => { const t = setInterval(() => { if (s.open) { clearInterval(t); r(); } }, 20); });
async function until(fn, ms = 5000, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return false;
}

/* غرفةٌ ببعض اللاعبين، والمضيف أوّلهم */
async function room(n, settings) {
  const socks = [];
  for (let i = 0; i < n; i++) { const s = conn("لاعب" + i); socks.push(s); }
  await Promise.all(socks.map(ready));
  const r = await socks[0].ask("createRoom", { name: "المضيف", settings: settings || {} });
  for (let i = 1; i < n; i++) await socks[i].ask("joinRoom", { name: socks[i].nick, roomId: r.roomId });
  await until(() => socks[0].st && socks[0].st.players.length === n);
  return { socks, id: r.roomId };
}
/* يمرّ بطور الكشف حتى النقاش */
async function toTalking(g) {
  g.socks[0].emit("startGame");
  await until(() => g.socks[0].st.state === "reveal", 4000);
  g.socks.forEach(s => s.emit("ready"));
  await until(() => g.socks[0].st.state === "talking", 4000);
}
const spyOf = s => (s.ev.role || []).slice(-1)[0];

(async () => {
  await sleep(1400);
  console.log("\n═══ إصلاحات برّا السالفة ═══\n");

  console.log("① الرفض يُسقط البلاغ الطارئ");
  {
    /* ستّة لاعبين، النصاب ٤. ثلاثةٌ يوافقون وثلاثةٌ يرفضون ⇒ يجب أن يسقط
       فورًا لا أن ينتظر عشرين ثانية (وهي شكوى صاحب الموقع بالحرف). */
    const g = await room(6, { askTime: 120, flow: "free" });
    await toTalking(g);
    const A = g.socks[0];
    A.emit("emergency");
    await until(() => A.st.emergency, 3000);
    eq(A.st.emergency.need, 4, "النصاب أربعةٌ من ستّة");
    eq(A.st.emergency.yes, 1, "وصاحبُ البلاغ موافقٌ تلقائيًّا");
    ok(A.st.emergency.no === 0, "ولا رافضَ بعد", A.st.emergency.no);

    g.socks[1].emit("emergencyVote", true);
    g.socks[2].emit("emergencyVote", true);
    await until(() => A.st.emergency && A.st.emergency.yes === 3, 3000);
    eq(A.st.emergency.yes, 3, "ثلاثةُ موافقين");
    ok(A.st.state === "talking", "ولم يبدأ التصويت بعد");

    g.socks[3].emit("emergencyVote", false);
    g.socks[4].emit("emergencyVote", false);
    await sleep(300);
    ok(A.st.emergency, "رافضان: البلاغ ما زال قائمًا (٣+١ ممكن)", A.st.emergency);
    eq(A.st.emergency.no, 2, "ورافضان معدودان");

    g.socks[5].emit("emergencyVote", false);
    await until(() => !A.st.emergency, 3000);
    ok(!A.st.emergency, "الرافض الثالث يجعل النصاب مستحيلًا ⇒ سقط فورًا");
    eq(A.st.state, "talking", "ونكمل النقاش بلا تصويت");
    ok(A.chats.some(c => /رفضت الأغلبية/.test(c.text || "")), "ويُقال ذلك صراحةً",
       A.chats.slice(-3).map(c => c.text));
    g.socks.forEach(s => s.close());
  }

  console.log("② لا نقطةَ لفتح البلاغ");
  {
    /* أربعةٌ: نفتح بلاغًا ونمرّره، ثمّ نصوّت جميعًا على الجاسوس. صاحبُ
       البلاغ (وهو عارفٌ صوّت صحيحًا) يجب أن يخرج بنقطةٍ واحدة لا نقطتين. */
    const g = await room(4, { askTime: 120, flow: "free", spies: 1, autoSpies: false });
    await toTalking(g);
    const A = g.socks[0];
    const spyIdx = g.socks.findIndex(s => (spyOf(s) || {}).spy);
    ok(spyIdx >= 0, "عُرف الجاسوس", spyIdx);
    const starter = g.socks.find((s, i) => i !== spyIdx);

    starter.emit("emergency");
    await until(() => A.st.emergency, 3000);
    g.socks.forEach(s => { if (s !== starter) s.emit("emergencyVote", true); });
    await until(() => A.st.state === "voting", 4000);
    eq(A.st.state, "voting", "بدأ التصويت بعد الموافقة");

    const spyId = g.socks[spyIdx].id;
    g.socks.forEach((s, i) => { if (i !== spyIdx) s.emit("vote", spyId); });
    /* الجاسوس يصوّت على أحدهم كي يكتمل التصويت */
    g.socks[spyIdx].emit("vote", g.socks[(spyIdx + 1) % 4].id);
    await until(() => A.st.state === "spyGuess" || A.st.state === "result", 5000);

    if (A.st.state === "spyGuess") {
      const board = (g.socks[spyIdx].ev.guessBoard || []).slice(-1)[0];
      ok(board && board.choices, "ووصلت لوحة التخمين", board && board.choices.length);
      const wrong = board.choices.find(w => w !== board.answer) || board.choices[0];
      g.socks[spyIdx].emit("spyPick", wrong);
      await until(() => A.st.state === "result", 8000);
    }
    eq(A.st.state, "result", "وانتهت الجولة");
    const r = A.st.result;
    const g0 = r.gains[starter.id] || 0;
    eq(g0, 1, "صاحبُ البلاغ الذي صوّت صحيحًا يأخذ نقطةً واحدة لا نقطتين", r.gains);
    const others = g.socks.filter((s, i) => i !== spyIdx && s !== starter);
    ok(others.every(s => (r.gains[s.id] || 0) === 1), "وبقيّة العارفين نقطةً نقطة",
       others.map(s => r.gains[s.id]));
    ok(Object.values(r.gains).every(v => v <= 1) || (r.gains[spyId] || 0) <= 2,
       "ولا أحدَ فوق نقطةٍ إلا برّا السالفة", r.gains);
    g.socks.forEach(s => s.close());
  }

  console.log("③ التخمين: لوحةٌ للجميع، وكشفٌ بعد لحظة");
  {
    const g = await room(4, { askTime: 120, flow: "free", spies: 1, autoSpies: false });
    await toTalking(g);
    const A = g.socks[0];
    const spyIdx = g.socks.findIndex(s => (spyOf(s) || {}).spy);
    const spy = g.socks[spyIdx];
    g.socks[spyIdx].emit("forceVote");           /* غير مضيف: يُتجاهَل */
    g.socks[0].emit("forceVote");
    await until(() => A.st.state === "voting", 4000);
    const spyId = spy.id;
    /* الجاسوس لا يصوّت على نفسه وإلا لم يكتمل التصويت */
    g.socks.forEach((s, i) => s.emit("vote", i === spyIdx ? g.socks[(spyIdx + 1) % 4].id : spyId));
    await until(() => A.st.state === "spyGuess", 5000);

    ok((A.ev.guessBoard || []).length >= 1, "اللوحة وصلت لعارفٍ لا جاسوس");
    ok((spy.ev.guessBoard || []).length >= 1, "ووصلت للجاسوس");
    const board = (A.ev.guessBoard || []).slice(-1)[0];
    eq(board.choices.length, 6, "ستّ كلمات");
    ok(board.spies && board.spies.length === 1, "ومعها اسم برّا السالفة", board.spies);
    ok(board.spies[0].id === spyId, "بالمعرّف الصحيح");
    const same = (spy.ev.guessBoard || []).slice(-1)[0];
    eq(same.choices, board.choices, "والشبكة نفسها للجميع — لا شبكةٌ لكلٍّ");

    /* لاعبٌ ليس جاسوسًا يحاول الاختيار: يُتجاهَل */
    g.socks[(spyIdx + 1) % 4].emit("spyPick", board.choices[0]);
    await sleep(250);
    ok(!(A.ev.spyPicked || []).length, "ومن ليس برّا السالفة لا يختار");

    /* كلمةٌ ليست في الشبكة: تُردّ */
    spy.emit("spyPick", "كلمةٌ مخترَعة");
    await sleep(250);
    ok(!(A.ev.spyPicked || []).length, "ولا تُقبَل كلمةٌ خارج الشبكة");

    const pick = board.choices[0];
    spy.emit("spyPick", pick);
    await until(() => (A.ev.spyPicked || []).length >= 1, 3000);
    const picked = (A.ev.spyPicked || [])[0];
    eq(picked.word, pick, "أُعلن اختيارُه للجميع فورًا");
    ok(!(A.ev.spyReveal || []).length, "ولم يُكشَف صوابُه بعد — لحظةُ ترقّب");

    await until(() => (A.ev.spyReveal || []).length >= 1, 4000);
    const rev = (A.ev.spyReveal || [])[0];
    ok(typeof rev.hit === "boolean", "ثمّ كُشف", rev);
    ok(rev.answer, "ومعه الكلمة الصحيحة لتُضاء", rev.answer);
    eq(rev.hit, rev.word === rev.answer, "والحكمُ موافقٌ للاختيار");

    await until(() => A.st.state === "result", 8000);
    eq(A.st.state, "result", "ثمّ شاشة النتائج");
    g.socks.forEach(s => s.close());
  }

  console.log("④ «صوّت» تعني أكمل أصواته");
  {
    /* جاسوسان ⇒ صوتان لكلّ لاعب. من اختار واحدًا لا يُعَدّ منتهيًا. */
    const g = await room(5, { askTime: 120, flow: "free", spies: 2, autoSpies: false });
    await toTalking(g);
    const A = g.socks[0];
    A.emit("forceVote");
    await until(() => A.st.state === "voting", 4000);
    eq(A.st.voteMax, 2, "صوتان لكلّ لاعب");
    eq(A.st.votesCount, 0, "ولا منتهيَ بعد");

    A.emit("vote", g.socks[1].id);
    await until(() => A.st.players.find(p => p.id === A.id).votesCast === 1, 3000);
    const me = A.st.players.find(p => p.id === A.id);
    eq(me.votesCast, 1, "أدلى بصوتٍ واحد");
    eq(me.voted, false, "ولم يُعَدّ منتهيًا — وهذا هو الإصلاح");
    eq(A.st.votesCount, 0, "والعدّاد لم يتحرّك");

    A.emit("vote", g.socks[2].id);
    await until(() => A.st.votesCount === 1, 3000);
    eq(A.st.players.find(p => p.id === A.id).voted, true, "وبالثاني صار منتهيًا");
    eq(A.st.votesCount, 1, "والعدّاد واحد");

    /* البقيّة يكملون ⇒ ينتقل فورًا بلا انتظار المؤقّت */
    for (let i = 1; i < 5; i++) {
      g.socks[i].emit("vote", g.socks[(i + 1) % 5].id);
      g.socks[i].emit("vote", g.socks[(i + 2) % 5].id);
    }
    const moved = await until(() => A.st.state !== "voting", 5000);
    ok(moved, "وباكتمال الجميع ننتقل فورًا", A.st.state);
    g.socks.forEach(s => s.close());
  }

  console.log("⑤ الرجوع للوبي لا يمحو النقاط إلا بطلب");
  {
    const g = await room(3, { askTime: 120, flow: "free" });
    const A = g.socks[0];
    await toTalking(g);
    A.emit("forceVote");
    await until(() => A.st.state === "voting", 4000);
    /* يصوّت العارفون على الجاسوس كي تُكتسَب نقاطٌ فعلًا */
    const si = g.socks.findIndex(x => (spyOf(x) || {}).spy);
    g.socks.forEach((s, i) => s.emit("vote", i === si ? g.socks[(si + 1) % 3].id : g.socks[si].id));
    await until(() => ["result", "spyGuess"].includes(A.st.state), 6000);
    /* لا ننتظر مؤقّت التخمين ثلاثين ثانية: يختار الجاسوس فتنتهي الجولة */
    if (A.st.state === "spyGuess") {
      const bd = (g.socks[si].ev.guessBoard || []).slice(-1)[0];
      if (bd) g.socks[si].emit("spyPick", bd.choices[0]);
    }
    await until(() => A.st.state === "result", 12000);
    const before = A.st.players.map(p => p.score);
    ok(before.some(v => v > 0), "هناك نقاطٌ مكتسبة", before);

    A.emit("backToLobby", { reset: false });
    await until(() => A.st.state === "lobby", 3000);
    eq(A.st.players.map(p => p.score), before, "الرجوع بلا تصفيرٍ يحفظها");

    A.emit("resetScores");
    await until(() => A.st.players.every(p => p.score === 0), 3000);
    ok(A.st.players.every(p => p.score === 0), "وزرُّ التصفير يمحوها");

    /* وغيرُ المضيف لا يصفّر */
    g.socks[1].emit("resetScores");
    await sleep(200);
    ok(A.st.players.every(p => p.score === 0), "ولا يصفّرها غيرُ المضيف (لا خطأ)");
    g.socks.forEach(s => s.close());
  }

  /* ══════════ الواجهة ══════════
     أربعُ شكاوى بصريّة، وثلاثٌ منها من علّةٍ واحدة: سمةُ «المارشميلو»
     (`kawaii.css`) أعلى أسبقيّةً من قواعد الصفحة، فكلُّ ما نكتبه في
     `salfa.html` تدهسه هي في صمت. فنفحص **الغالبَ** لا المكتوب. */
  console.log("⑥ الواجهة: التمرير والألوان والأسماء");
  {
    const fs = require("fs"), path = require("path");
    const html = fs.readFileSync(path.join(__dirname, "public", "salfa.html"), "utf8");
    const kw = fs.readFileSync(path.join(__dirname, "public", "kawaii.css"), "utf8");
    const rule = (css, sel) => {
      const i = css.indexOf(sel + " {") >= 0 ? css.indexOf(sel + " {") : css.indexOf(sel + "{");
      return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
    };

    /* ① اللوبي يمرَّر: السمةُ كانت تُلغي التمرير فيُقصّ نصفُ الإعدادات */
    const lob = rule(kw, "body.kw-salfa #lobby");
    ok(lob, "للسمة قاعدةٌ للوبي", lob.slice(0, 60));
    ok(!/overflow:\s*visible/.test(lob), "لا تُلغي التمرير");
    ok(/overflow:\s*auto/.test(lob), "بل تُبقيه");
    ok(/flex:\s*1/.test(lob) && /min-height:\s*0/.test(lob),
       "وتترك اللوبي يتقيّد بارتفاع الشاشة لا بمحتواه", lob);

    /* ② صفُّ برّا السالفة أحمرُ فاتح — والسمةُ هي مَن كانت تُخضّره */
    const spy = rule(kw, "body.kw-salfa .scoreRow.wasSpy");
    ok(spy, "وللسمة قاعدةٌ لصفّ برّا السالفة", spy);
    ok(/#FFDEDB/i.test(spy), "خلفيّتُه حمراءُ فاتحة", spy);
    const rowIdx = kw.indexOf("body.kw-salfa .scoreRow {");
    ok(kw.indexOf("body.kw-salfa .scoreRow.wasSpy") > rowIdx,
       "ومكتوبةٌ بعد العامّة فتغلبها");

    /* ③ السائل أخضر والمسؤول أحمر، ويسبقان تمييزَ «أنا» */
    ok(/body\.kw-salfa \.pl\.asker/.test(kw), "للسائل قاعدةٌ في السمة");
    ok(/body\.kw-salfa \.pl\.target/.test(kw), "وللمسؤول");
    ok(/\.pl\.me\.asker/.test(kw) && /\.pl\.me\.target/.test(kw),
       "وتسبقان تمييزَ «أنا» صراحةً");
    const me = rule(kw, "body.kw-salfa .pl.me");
    ok(!/#6CCB93/.test(me), "و«أنا» لم يعد أخضرَ فيلتبس بالسائل", me);
    ok(/asker/.test(html) && /target/.test(html), "والصفحةُ تُلبس الصنفين");
    ok(/const askerId = talking \? s\.turnId/.test(html), "من الدور الذي يبثّه الخادم");
    ok(/const targetId = talking \? s\.targetId/.test(html), "ومن المسؤول كذلك");
    ok(/state === "talking"/.test(html), "وفي طور النقاش وحده");

    /* ④ لا «(أنت)» — في الكود لا في التعليقات التي تشرح إزالتها */
    const code = html.replace(/\/\*[\s\S]*?\*\//g, "");
    ok(!/\(\u0623\u0646\u062a\)/.test(code), "ولا يُكتب «(أنت)» بعد الاسم في أيّ قائمة",
       (code.match(/.{0,40}\(\u0623\u0646\u062a\).{0,20}/) || [])[0]);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
