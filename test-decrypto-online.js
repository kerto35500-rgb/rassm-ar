// اختبار خادم «فكّ الشفرة»: الغرف والفرق (تعيينٌ تلقائيّ، انتقال، توزيعٌ
// عشوائيّ)، والحجبُ لكلّ لاعب (نفحص كلَّ ما وصل مقبسَ الخصم حرفًا حرفًا)،
// والتلميحاتُ وساعةُ الرمل، وورقتا التخمين المشتركتان، والدردشتان (العامّة
// والسرّيّة) وصمتُ المُشفِّر، والمهل، والانقطاعُ والعودة، والانسحاب،
// ومباراةٌ كاملةٌ حتى الإحصاءات.

const { setupDecryptoOnline, sanitize, SAND_SECS } = require("./decryptosrv");

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

const WORDS = ["شمس", "باب", "تفاحة", "قطار", "قمر", "كتاب", "بحر", "سيارة"];
const deal = n => WORDS.slice(0, n);
const stats = [];
const store = { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } };
const slowN = new FN(), fastN = new FN();
const slow = setupDecryptoOnline({ of: () => slowN }, { store, deal, graceMs: 150, encGraceMs: 60, secsScale: 1 });
const fast = setupDecryptoOnline({ of: () => fastN }, { store, deal, graceMs: 120, encGraceMs: 40, secsScale: 0.003 });

const st = s => s.last("state");
const toast = s => s.last("toast");
let clueN = 0;
const fresh = () => { clueN++; return ["ريح" + clueN, "نور" + clueN, "ظل" + clueN]; };
/** أربعةُ لاعبين في غرفة: ٢ ضدّ ٢ */
async function room4(N, api, names = ["سعود", "نورة", "فهد", "ريم"], ids = []) {
  const socks = [];
  const A = N.connect(ids[0]);
  const r0 = await A.ask("createRoom", { name: names[0] });
  socks.push(A);
  for (let i = 1; i < names.length; i++) {
    const s = N.connect(ids[i]);
    await s.ask("joinRoom", { name: names[i], roomId: r0.roomId });
    socks.push(s);
  }
  return { socks, code: r0.roomId, room: api.rooms.get(r0.roomId), host: A };
}
const pid = (room, s) => room.players.find(p => p.sockId === s.id).id;
const sockOfId = (room, socks, id) => socks.find(s => pid(room, s) === id);
/** يعبّئ فريقٌ ورقتَه بالشفرة ويوافق كلُّ من يحقّ له */
function answer(room, socks, t, kind, code) {
  const m = room.match;
  const eds = m.editors(t, kind).map(id => sockOfId(room, socks, id)).filter(Boolean);
  code.forEach((v, i) => eds[0].fire("slot", { kind, slot: i, value: v }));
  for (const s of eds) s.fire("confirm", { kind, on: true });
}
const wrong = c => [c[1], c[0], c[2]];
function sendClues(room, socks) {
  for (let t = 0; t < 2; t++) sockOfId(room, socks, room.match.cur[t].encryptor).fire("clues", { list: fresh() });
}

(async () => {
  console.log("\n═══ خادم «فكّ الشفرة» ═══\n");

  console.log("① الدخول والفرق والإعدادات");
  const { socks, code, room, host } = await room4(slowN, slow);
  const [A, B, C, Dd] = socks;
  ok(A.last("hello") && A.last("hello").min === 4 && A.last("hello").max === 8 && A.last("hello").sandSecs === 45, "الترحيب: ٤–٨ لاعبين وساعةُ رملٍ ٤٥ث");
  eq(room.players.map(p => p.team), [0, 1, 0, 1], "كلُّ داخلٍ إلى الفريق الأقلّ: أزرق، وردي، أزرق، وردي");
  B.fire("shuffle");
  eq(room.players.map(p => p.team), [0, 1, 0, 1], "غيرُ المضيف لا يوزّع");
  C.fire("team", { team: 1 });
  eq(room.players.map(p => p.team), [0, 1, 1, 1], "لاعبٌ ينتقل بنفسه إلى الفريق الآخر");
  host.fire("startGame");
  ok(!room.match && /لاعبان/.test(toast(host) || ""), "فريقٌ بلاعبٍ واحد ⇒ لا تبدأ", toast(host));
  C.fire("team", { team: 0 });
  host.fire("shuffle");
  const tc = [0, 1].map(t => room.players.filter(p => p.team === t).length);
  eq(tc, [2, 2], "المضيفُ يوزّع عشوائيًّا بالتساوي");
  host.fire("updateSettings", { clueSecs: 90, guessSecs: 0, junk: 5 });
  eq(room.settings, { clueSecs: 90, guessSecs: 0 }, "الإعدادات: ٩٠ث للتلميح، والتخمينُ بلا وقت");
  eq(sanitize({ clueSecs: 7 }, { clueSecs: 120, guessSecs: 120 }).clueSecs, 120, "وقيمةٌ خارج القائمة تُتجاهَل");
  host.fire("updateSettings", { clueSecs: 120, guessSecs: 120 });
  /* ثبّت الفرق: سعود وفهد أزرق، نورة وريم وردي */
  room.players.forEach((p, i) => { p.team = i % 2; });

  console.log("② البداية والحجب");
  host.fire("startGame");
  const m = room.match;
  ok(!!m && m.round === 1 && m.phase === "clues", "بدأت: الجولة الأولى");
  const all = socks.map(s => st(s));
  ok(all.every(v => v && v.phase === "clues"), "الكلُّ وصلته حالتُه");
  const [tA, tB] = [0, 1].map(t => m.teams[t].secretWords);
  const leak = (s, words) => s.all("state").some(v => words.some(w => JSON.stringify(v).includes(w)));
  ok(!leak(B, tA) && !leak(Dd, tA) && !leak(A, tB) && !leak(C, tB), "لا تصل كلماتُ فريقٍ مقبسَ خصمه أبدًا (فحصُ كلّ ما وصل)");
  const encA = sockOfId(room, socks, m.cur[0].encryptor), encB = sockOfId(room, socks, m.cur[1].encryptor);
  const anA = socks.find(s => s !== encA && m.teamOf(pid(room, s)) === 0);
  ok(st(encA).cur[0].code && !st(anA).cur[0].code && !st(encA).cur[1].code, "الشفرةُ لمُشفِّرها وحده");
  ok(st(A).deadline > Date.now() && st(A).total === 120000, "مهلةُ التلميح ١٢٠ث");

  console.log("③ التلميحات وساعةُ الرمل");
  encA.fire("clues", { list: ["التفاحة", "ب", "ج"] });
  ok(/كلماتكم/.test(toast(encA) || "") && !m.cur[0].clues, "تلميحٌ هو إحدى كلماتنا يُرفض برسالة", toast(encA));
  anA.fire("clues", { list: ["أ", "ب", "ج"] });
  ok(/المُشفِّرُ وحده/.test(toast(anA) || ""), "وغيرُ المُشفِّر لا يرسل");
  const before = room.deadline;
  encA.fire("clues", { list: ["أحمر", "أصفر", "سكة"] });
  ok(m.cur[0].clues && room.sanded && room.deadline < before && room.deadline <= Date.now() + SAND_SECS * 1000 + 50,
     "أرسل الأوّل ⇒ ساعةُ الرمل: ٤٥ث للآخر", { left: room.deadline - Date.now() });
  ok(st(encB).sand === true && st(encB).total === SAND_SECS * 1000, "والآخرُ يرى أنّها ساعةُ الرمل");
  ok(st(B).cur[0].clues === null, "ولا تُبثّ قبل أن يرسل الثاني");
  encB.fire("clues", { list: ["ليل", "ورق", "موج"] });
  ok(m.phase === "guess" && JSON.stringify(st(B).cur[0].clues) === JSON.stringify(["أحمر", "أصفر", "سكة"]), "أرسلا ⇒ التلميحاتُ للجميع والتخمين");
  ok(st(A).deadline > Date.now() && st(A).total === 120000, "ومهلةُ التخمين تبدأ");

  console.log("④ الدردشتان وصمتُ المُشفِّر");
  const anB = socks.find(s => s !== encB && m.teamOf(pid(room, s)) === 1);
  const n0 = socks.map(s => s.all("chat").length);
  anA.fire("chat", { text: "أظنّها " + tA[0], team: true });
  const got = socks.map((s, i) => s.all("chat").length - n0[i]);
  ok(got[socks.indexOf(anA)] === 1 && got[socks.indexOf(encA)] === 1 && got[socks.indexOf(B)] + got[socks.indexOf(Dd)] === 0,
     "دردشةُ الفريق تصل فريقي وحده — وفيها كلماتُنا بلا حرج", got);
  await sleep(650);
  anA.fire("chat", { text: "مرحبا " + tA[1] });
  ok(/الدردشة العامّة/.test(toast(anA) || ""), "وكلماتُ الفريق ممنوعةٌ في العامّة", toast(anA));
  await sleep(650);
  anA.fire("chat", { text: "يلا يا شباب" });
  ok(socks.every(s => s.last("chat") && s.last("chat").text === "يلا يا شباب" && s.last("chat").team === null), "والعامّةُ للجميع");
  encA.fire("chat", { text: "ركّزوا", team: true });
  ok(/المُشفِّر/.test(toast(encA) || ""), "المُشفِّرُ صامتٌ قبل أن يقفل فريقُه فكَّ شفرته", toast(encA));

  console.log("⑤ الورقة المشتركة والكشف");
  anA.fire("slot", { kind: "dec", slot: 0, value: m.cur[0].code[0] });
  ok(st(encA).cur[0].dec.draft[0] === m.cur[0].code[0], "ما يكتبه المحلّلُ يراه فريقُه حيًّا");
  ok(st(B).cur[0].dec.draft === undefined, "ولا يراه الخصم");
  anA.fire("slot", { kind: "int", slot: 0, value: 1 });
  ok(/ليست ورقتك/.test(toast(anA) || ""), "لا اعتراضَ في الجولة الأولى");
  answer(room, socks, 0, "dec", m.cur[0].code);
  ok(m.cur[0].dec.locked, "وافق المحلّلون ⇒ قُفلت");
  await sleep(650);
  encA.fire("chat", { text: "أحسنتم", team: true });
  ok(socks[socks.indexOf(anA)].last("chat").text === "أحسنتم", "وبعد القفل يتكلّم المُشفِّر");
  answer(room, socks, 1, "dec", wrong(m.cur[1].code));
  ok(m.phase === "reveal", "قُفلت الأوراق ⇒ الكشف");
  ok(st(B).cur[0].code && st(B).result && st(B).result.teams[1].decOK === false, "الشفرتان والنتائجُ للجميع");
  eq(st(A).teams.map(T => T.tokens.miscommunication), [0, 1], "سوءُ فهمٍ على الوردي");
  ok(st(A).total === 25000, "والكشفُ ٢٥ث (أو «التالي» من الجميع)");
  socks.forEach(s => s.fire("next"));
  ok(m.round === 2 && m.phase === "clues", "الجميعُ ضغط «التالي» ⇒ الجولة الثانية");
  ok(m.cur[0].encryptor !== pid(room, encA), "والمُشفِّرُ تغيّر");

  console.log("⑥ الانقطاعُ والعودة");
  const tokA = room.players.find(p => p.sockId === anA.id);
  const enc2 = sockOfId(room, socks, m.cur[0].encryptor);
  const enc2Id = m.cur[0].encryptor;
  slowN.drop(enc2);
  await sleep(20);
  ok(room.players.find(p => p.id === enc2Id).gone, "المُشفِّرُ انقطع");
  ok(await until(() => m.cur[0].encryptor !== enc2Id, 1000), "فتسلّم زميلُه الدورَ بعد مهلةٍ قصيرة", m.cur[0].encryptor);
  const E2 = slowN.connect();
  const p2 = room.players.find(p => p.id === enc2Id);
  let r = await E2.ask("joinRoom", { name: "غريب", roomId: code });
  ok(!r.ok && /جارية/.test(r.error), "غريبٌ لا يدخل لعبةً جارية");
  r = await E2.ask("joinRoom", { name: " " + p2.name + " ", roomId: code });
  ok(r.ok && r.resumed && p2.sockId === E2.id && !p2.gone, "وصاحبُ المقعد يعود باسمه من متصفّحٍ آخر", r);
  ok(st(E2) && st(E2).myTeam === 0 && st(E2).teams[0].words, "ويأخذ حالتَه وكلماتِ فريقه");
  socks[socks.indexOf(enc2)] = E2;
  /* جلسةٌ ثانية برمز الجهاز تتسلّم المقعد */
  const E3 = slowN.connect();
  r = await E3.ask("rejoin", { roomId: code, token: p2.token });
  ok(r.ok && p2.sockId === E3.id && E2.all("replaced").length === 1 && !slowN.sockets.has(E2.id), "وجلسةٌ أحدث برمز الجهاز تتسلّمه، والقديمةُ تُخبَر وتُغلَق");
  ok(!p2.gone, "ولا يمسّ خروجُ القديمة المقعد");
  socks[socks.indexOf(E2)] = E3;

  console.log("⑦ الانسحاب: فريقٌ غاب كلُّه");
  const pinkSocks = socks.filter(s => m.teamOf(pid(room, s)) === 1);
  pinkSocks.forEach(s => s.fire("leaveRoom"));
  ok(await until(() => !room.match, 1000), "خرج الورديُّ كلُّه ⇒ انتهت");
  const end = socks[0].last("matchEnd") || E3.last("matchEnd");
  ok(end && end.winner === 0 && end.reason === "forfeit", "ويفوز الأزرق بالانسحاب", end && { w: end.winner, r: end.reason });
  ok(end && end.teams[0].words.length === 4 && end.teams[1].words.length === 4, "والكلماتُ تُكشف في النهاية");

  console.log("⑧ المهلُ ومباراةٌ كاملة (خادمٌ سريع)");
  {
    const g = await room4(fastN, fast, ["أ", "ب", "ج", "د"], [11, 12, 13, 14]);
    g.host.fire("startGame");
    const mm = g.room.match;
    ok(!!mm, "بدأت");
    /* لا أحدَ يرسل: المهلةُ تُكمل التلميحات بـ«—» */
    ok(await until(() => mm.phase === "guess", 3000), "مهلةُ التلميح انقضت ⇒ التخمين");
    ok(mm.cur.every(c => c.autoClues), "بلا تلميحات");
    ok(await until(() => mm.phase === "reveal", 3000), "ومهلةُ التخمين ⇒ الكشف");
    eq(mm.teams.map(T => T.tokens.miscommunication), [1, 1], "ورقتان فارغتان ⇒ سوءُ فهمٍ على الفريقين");
    ok(await until(() => mm.round === 2, 3000), "ومهلةُ الكشف ⇒ الجولة الثانية");
    /* الأزرقُ يعترض جولتين ⇒ يفوز */
    for (let k = 0; k < 2 && g.room.match; k++) {
      await until(() => mm.phase === "clues");
      sendClues(g.room, g.socks);
      answer(g.room, g.socks, 0, "dec", mm.cur[0].code);
      answer(g.room, g.socks, 1, "dec", mm.cur[1].code);
      answer(g.room, g.socks, 0, "int", mm.cur[1].code);
      answer(g.room, g.socks, 1, "int", wrong(mm.cur[0].code));
      if (mm.phase === "reveal") g.socks.forEach(s => s.fire("next"));
    }
    ok(await until(() => !g.room.match, 2000), "اعتراضان ⇒ انتهت");
    const e = g.host.last("matchEnd");
    ok(e && e.winner === 0 && e.reason === "intercept" && e.history.length === 3, "فاز الأزرق بالاعتراض", e && { w: e.winner, r: e.reason, h: e.history.length });
    await until(() => stats.filter(x => x.g === "decrypto").length >= 4, 1000);
    const ds = stats.filter(x => x.g === "decrypto");
    ok(ds.length === 4 && ds.filter(x => x.wins === 1).length === 2 && ds.every(x => x.games === 1), "إحصاءُ «decrypto» للمسجَّلين: فائزان وخاسران", ds);
    ok(g.host.last("lobby") && !g.host.last("lobby").playing && g.host.last("lobby").lastResult.winner === 0, "والعودةُ إلى اللوبي بالنتيجة");
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
