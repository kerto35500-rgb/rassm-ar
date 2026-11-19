// اختبار خادم «البسكويتة الحارّة»: الغرف والإعدادات والبوتات، والحجبُ لكلّ
// لاعب (نفحص كلَّ ما وصل المقابس)، والوضعُ والمزايدةُ والكشف بالمقابس، والمهل،
// والخروجُ والعودة، ومباراةٌ كاملة حتى الترتيب والإحصاءات.

const { setupSpicyOnline, sanitize } = require("./spicysrv");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(4); }
  return false;
}
class FS {
  constructor(nsp, id) { this.nsp = nsp; this.id = id; this.rooms = new Set([id]); this.h = {}; this.rx = []; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  emit(e, d) { this.rx.push({ e, d: d === undefined ? d : JSON.parse(JSON.stringify(d)) }); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  last(e) { for (let i = this.rx.length - 1; i >= 0; i--) if (this.rx[i].e === e) return this.rx[i].d; return null; }
  all(e) { return this.rx.filter(x => x.e === e).map(x => x.d); }
  ask(e, d) { return new Promise(res => this.fire(e, d, res)); }
  disconnect() { this.nsp.drop(this); }
  get handshake() { return { headers: {}, address: "1.2.3.4" }; }
}
class FN {
  constructor() { this.cf = []; this.sockets = new Map(); this.n = 0; }
  on(e, f) { if (e === "connection") this.cf.push(f); }
  connect(userId) { const s = new FS(this, "s" + (++this.n)); if (userId) s.userId = userId; this.sockets.set(s.id, s); this.cf.forEach(f => f(s)); return s; }
  drop(s) { this.sockets.delete(s.id); s.fire("disconnect"); }
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
}

const stats = [];
const store = { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } };
const slowN = new FN(), fastN = new FN();
/* البطيء: البوتاتُ سريعة والمهلُ حقيقيّة (نخطو فيه بأيدينا) — والسريع: كلُّ شيءٍ مقصّر */
const slow = setupSpicyOnline({ of: () => slowN }, { store, graceMs: 150, botDelay: [1, 3], secsScale: 1 });
const fast = setupSpicyOnline({ of: () => fastN }, { store, graceMs: 100, botDelay: [1, 3], secsScale: 0.004 });
const st = s => s.last("state");
const toast = s => s.last("toast");
const meIn = v => v.players.find(x => x.id === v.me);

(async () => {
  console.log("\n═══ خادم «البسكويتة الحارّة» ═══\n");

  console.log("① الغرفة والإعدادات");
  const A = slowN.connect(51), B = slowN.connect();
  const r0 = await A.ask("createRoom", { name: "سعود" });
  const code = r0.roomId;
  ok(r0.ok && A.last("hello").min === 3 && A.last("hello").max === 6, "غرفةٌ جديدة (٣–٦ لاعبين)");
  await B.ask("joinRoom", { name: "نورة", roomId: code });
  const room = slow.rooms.get(code);
  eq(sanitize({ seats: 9, turnSecs: 7, bots: "x" }, { seats: 4, bots: true, turnSecs: 25 }), { seats: 4, bots: true, turnSecs: 25 }, "قيمٌ خارج مداها تُتجاهَل");
  A.fire("updateSettings", { bots: false });
  A.fire("startGame");
  ok(!room.match && /٣ لاعبين/.test(toast(A) || ""), "لاعبان بلا بوتات ⇒ لا تبدأ", toast(A));
  B.fire("updateSettings", { bots: true });
  ok(room.settings.bots === false, "وغيرُ المضيف لا يغيّر الإعدادات");
  A.fire("updateSettings", { bots: true, seats: 4, turnSecs: 25 });
  A.fire("startGame");
  const m = room.match;
  ok(!!m && m.players.length === 4 && room.players.filter(p => p.bot).length === 2, "البوتاتُ تُكمل الطاولة إلى أربعة");

  console.log("② الحجب والوضعُ الإجباريّ");
  const a = room.players.find(p => p.name === "سعود").id, b = room.players.find(p => p.name === "نورة").id;
  ok(await until(() => m.players.filter(x => room.players.find(p => p.id === x.id).bot).every(x => x.stack.length === 1)), "البوتاتُ تضع ماكاروناتها وحدها");
  ok(m.phase === "placement", "وتنتظر المرحلةُ البشر");
  const myHand = meIn(st(A)).hand;
  ok(myHand.length === 4 && myHand.every(d => d.t), "أرى يدي");
  A.fire("place", { disc: myHand.find(d => d.t === "trap").id });
  B.fire("place", { disc: meIn(st(B)).hand.find(d => d.t === "safe").id });
  ok(m.phase === "action", "وضع الجميع ⇒ الدور");
  const leakA = B.all("state").some(v => v.players.find(x => x.id === a).stack.some(d => d.t));
  ok(!leakA, "لا يصل نوعُ ماكارونتي مقبسَ غيري أبدًا (حتى الحارّة)");
  ok(st(A).deadline > Date.now() || m.turn !== a && m.turn !== b, "مهلةٌ لصاحب الدور البشريّ");

  console.log("③ الدور والمزاد والكشف (بالمقابس)");
  /* ننتظر دورَ أحدنا ثمّ نزايد بمجموع الطاولة ⇒ كشفٌ فوريّ */
  ok(await until(() => [a, b].includes(m.turn) || m.phase !== "action", 4000), "(دورُ أحدِ البشر)");
  if (m.phase === "action") {
    const S = m.turn === a ? A : B, id = m.turn;
    S.fire("place", { disc: "زائف" });
    ok(/ليست في يدك/.test(toast(S) || ""), "ماكارونةٌ ليست في يدك تُرفض");
    S.fire("raise", { amount: m.total() + 1 });
    ok(/أكثرُ ما يمكن/.test(toast(S) || ""), "ومزايدةٌ فوق الطاولة تُرفض");
    S.fire("raise", { amount: m.total() });
    ok(m.phase === "reveal" && m.bid.id === id, "مزايدةٌ بمجموع الطاولة ⇒ الكشفُ فورًا");
    const other = room.players.find(p => p.bot).id;
    S.fire("flip", { owner: other });
    ok(/أوّلًا/.test(toast(S) || ""), "القفلُ الذكيّ: كومتُك أوّلًا 🔒", toast(S));
    S.fire("flip", { owner: id });
    if (m.phase === "reveal") for (let k = 0; k < 6 && m.phase === "reveal"; k++) S.fire("flip", { owner: m.flippable()[0].owner });
    ok(m.phase === "result" || m.phase === "over", "انتهى الكشف ⇒ النتيجة", m.phase);
    if (m.result && !m.result.ok) {
      const lostTo = slowN.sockets.get(room.players.find(p => p.id === id).sockId);
      const others = [A, B].filter(x => x !== lostTo);
      ok(lostTo.all("state").some(v => (v.events || []).some(e => e.t === "lost" && e.kind)) &&
         !others.some(x => x.all("state").some(v => (v.events || []).some(e => e.t === "lost"))), "نوعُ الخسارة لصاحبها وحده");
    } else ok(true, "(نجح التحدّي)");
    ok(st(A).span === 5000 && st(A).deadline > Date.now() && st(A).total === m.total(), "النتيجةُ تُعرض ٥ ثوانٍ ثمّ جولةٌ جديدة (والمهلةُ لا تكتب فوق «على الطاولة»)");
  }

  console.log("④ الخروجُ والعودة");
  const tokB = room.players.find(p => p.id === b).token;
  B.fire("leaveRoom");
  ok(room.players.find(p => p.id === b).bot, "خرجت عمدًا ⇒ يلعب عنها بوتٌ فورًا");
  const B2 = slowN.connect();
  let r = await B2.ask("joinRoom", { name: "غريب", roomId: code });
  ok(!r.ok && /جارية/.test(r.error), "غريبٌ لا يدخل لعبةً جارية");
  r = await B2.ask("joinRoom", { name: "نورة", roomId: code });
  ok(r.ok && r.resumed && !room.players.find(p => p.id === b).bot, "وصاحبةُ المقعد تعود باسمها", r);
  const B3 = slowN.connect();
  r = await B3.ask("rejoin", { roomId: code, token: tokB });
  ok(r.ok && B2.all("replaced").length === 1 && room.players.find(p => p.id === b).sockId === B3.id, "وجلسةٌ أحدث برمز الجهاز تتسلّم المقعد");
  slowN.drop(A); slowN.drop(B3);
  await sleep(30);
  ok(room.paused && !room.timer, "لا أحدَ من البشر ⇒ تتوقّف الطاولة");

  console.log("⑤ مباراةٌ كاملة بالمهل (خادمٌ سريع)");
  {
    const X = fastN.connect(61), Y = fastN.connect(62), Z = fastN.connect(63);
    const rr = await X.ask("createRoom", { name: "أ" });
    await Y.ask("joinRoom", { name: "ب", roomId: rr.roomId });
    await Z.ask("joinRoom", { name: "ج", roomId: rr.roomId });
    const R = fast.rooms.get(rr.roomId);
    X.fire("updateSettings", { seats: 5, bots: true, turnSecs: 15 });
    X.fire("startGame");
    ok(R.match && R.match.players.length === 5, "ثلاثةُ بشرٍ + بوتان");
    /* البشرُ لا يفعلون شيئًا: المهلُ تفعل عنهم حتى النهاية */
    ok(await until(() => !R.match, 60000), "تكتمل المباراة بالمهل وحدها");
    const e = X.last("matchEnd");
    ok(e && e.winner && e.ranking.length === 5 && e.ranking[0].id === e.winner && e.ranking.every(x => x.name), "الترتيبُ الكامل بالأسماء", e);
    await until(() => stats.filter(x => x.g === "spicy").length >= 3, 1000);
    const ss = stats.filter(x => x.g === "spicy");
    ok(ss.length === 3 && ss.every(x => x.games === 1), "إحصاءُ «spicy» للمسجَّلين الثلاثة", ss);
    ok(X.last("lobby") && !X.last("lobby").playing && X.last("lobby").players.length === 3, "والعودةُ إلى اللوبي بلا بوتات");
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
