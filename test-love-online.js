// اختبار خادم «رسالة حب»: الغرف والإعدادات والبوتات، والحجبُ لكلّ لاعب
// (نفحص كلَّ ما وصل المقابس: يدُ غيري، والكومة، والمحروقة، وما رآه غيري بالكاهن)،
// واللعبُ بالمقابس، والمهلة، والخروجُ والعودة، ومباراةٌ كاملة حتى الترتيب والإحصاءات.

const { setupLoveOnline, sanitize } = require("./lovesrv");

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
const slow = setupLoveOnline({ of: () => slowN }, { store, graceMs: 150, botDelay: [1, 3], secsScale: 1 });
const fast = setupLoveOnline({ of: () => fastN }, { store, graceMs: 100, botDelay: [1, 3], secsScale: 0.002 });
const st = s => s.last("state");
const toast = s => s.last("toast");

(async () => {
  console.log("\n═══ خادم «رسالة حب» ═══\n");

  console.log("① الغرفة والإعدادات");
  const A = slowN.connect(51), B = slowN.connect();
  const r0 = await A.ask("createRoom", { name: "سعود" });
  const code = r0.roomId;
  ok(r0.ok && A.last("hello").min === 2 && A.last("hello").max === 4, "غرفةٌ جديدة (٢–٤ لاعبين)");
  ok(A.last("hello").turnSecs.join() === "45", "ومهلةُ الدور ٤٥ ثانية", A.last("hello").turnSecs);
  await B.ask("joinRoom", { name: "نورة", roomId: code });
  const room = slow.rooms.get(code);
  eq(sanitize({ seats: 6, turnSecs: 7, bots: "x" }, { seats: 4, bots: true, turnSecs: 45 }), { seats: 4, bots: true, turnSecs: 45 }, "قيمٌ خارج مداها تُتجاهَل");
  A.fire("updateSettings", { bots: false });
  B.fire("updateSettings", { bots: true });
  ok(room.settings.bots === false, "غيرُ المضيف لا يغيّر الإعدادات");
  A.fire("updateSettings", { bots: true, seats: 3 });
  A.fire("startGame");
  const m = room.match;
  ok(!!m && m.players.length === 3 && room.players.filter(p => p.bot).length === 1 && m.target === 5, "بوتٌ يُكمل الطاولة إلى ثلاثة (٥ نجوم للفوز)");

  console.log("② الحجب");
  const a = room.players.find(p => p.name === "سعود").id, b = room.players.find(p => p.name === "نورة").id;
  ok(await until(() => [a, b].includes(m.turn)), "(دورُ أحد البشر)");
  const leaks = S => S.all("state").some(v => v.players.some(x => x.id !== v.me && x.hand && v.phase === "turn") ||
                                                "deck" in v || "burned" in v || "know" in v);
  ok(!leaks(A) && !leaks(B), "لا تصل يدُ غيري ولا الكومةُ ولا المحروقةُ مقبسي أبدًا");
  const S = m.turn === a ? A : B, id = m.turn, O = S === A ? B : A, oid = id === a ? b : a;
  ok(st(S).legal && st(S).legal.cards.length >= 1 && st(S).players.find(x => x.id === id).hand.length === 2, "صاحبُ الدور يرى بطاقتيه وما يجوز له", st(S).legal);
  ok(st(S).deadline > Date.now() && st(S).span === 45000, "ومهلةُ ٤٥ ثانية", st(S).span);
  const drew = S.all("state").some(v => (v.events || []).some(e => e.t === "drew" && e.card));
  ok(drew && !O.all("state").some(v => (v.events || []).some(e => e.t === "drew" && e.card && v.turn === id)), "وما سحبه يصله وحده");

  console.log("③ اللعبُ بالمقابس");
  S.fire("play", { card: 9 });
  ok(/ليست في يدك/.test(toast(S) || ""), "بطاقةٌ ليست معك تُرفض");
  O.fire("play", { card: 1, target: id, guess: 2 });
  ok(/ليس دورك/.test(toast(O) || ""), "ولا يلعب غيرُ صاحب الدور");
  /* نرتّب يدَه: كاهنٌ وحارس، والهدفُ الآخرُ البشريّ */
  m.p(id).hand = [2, 1];
  S.fire("play", { card: 2 });
  ok(/هدف/.test(toast(S) || ""), "الكاهنُ بلا هدفٍ يُرفض", toast(S));
  const n0 = m.log.length;
  const want = m.p(oid).hand[0];
  m.p(oid).protected = false;
  S.fire("play", { card: 2, target: oid });
  ok(m.log.length === n0 + 1 && m.log[n0].card === 2, "لعب الكاهن", m.log);
  const peekS = S.all("state").some(v => (v.events || []).some(e => e.t === "peek" && e.card === want));
  const peekO = [O, ...[...slowN.sockets.values()].filter(x => x !== S && x !== O)].some(x => x.all("state").some(v => (v.events || []).some(e => e.t === "peek")));
  ok(peekS && !peekO, "رأى بطاقتَه وحده", { peekS, peekO });
  ok(!O.all("state").some(v => v.known && v.known[oid]), "ولا تصل «معرفتُه» غيرَه");

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
  ok(r.ok && B2.all("replaced").length === 1, "وجلسةٌ أحدث برمز الجهاز تتسلّم المقعد");
  slowN.drop(A); slowN.drop(B3);
  await sleep(30);
  ok(room.paused && !room.timer, "لا أحدَ من البشر ⇒ تتوقّف الطاولة");

  console.log("⑤ مباراةٌ كاملة بالمهل (خادمٌ سريع)");
  {
    const X = fastN.connect(61), Y = fastN.connect(62);
    const rr = await X.ask("createRoom", { name: "أ" });
    await Y.ask("joinRoom", { name: "ب", roomId: rr.roomId });
    const R = fast.rooms.get(rr.roomId);
    X.fire("updateSettings", { seats: 4, bots: true });
    X.fire("startGame");
    ok(R.match && R.match.players.length === 4 && R.match.target === 4, "بشريّان + بوتان (٤ نجوم)");
    ok(await until(() => !R.match, 90000), "تكتمل المباراة بالمهل وحدها");
    const e = X.last("matchEnd");
    ok(e && e.winner && e.ranking.length === 4 && e.ranking[0].id === e.winner && e.ranking[0].stars >= 4 && e.ranking.every(x => x.name), "الترتيبُ الكامل بالأسماء والنجوم", e);
    await until(() => stats.filter(x => x.g === "love").length >= 2, 1000);
    const ss = stats.filter(x => x.g === "love");
    ok(ss.length === 2 && ss.every(x => x.games === 1), "إحصاءُ «love» للمسجَّلَين", ss);
    ok(X.last("lobby") && !X.last("lobby").playing && X.last("lobby").players.length === 2, "والعودةُ إلى اللوبي بلا بوتات");
    const rounds = X.all("state").filter(v => (v.events || []).some(e => e.t === "roundEnd")).length;
    ok(rounds >= 4, "عدّة جولاتٍ مرّت بالنتيجة", rounds);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
