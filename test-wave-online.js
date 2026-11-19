// اختبار خادم «التخاطر»: الفريقان، والحجب (الهدفُ للوسيط وحده — نفحص كلَّ ما
// وصل المقابس)، والتلميح، والمؤشرُ الحيّ برسائل «dial»، والموافقة والتصويت،
// والكشف والنقاط، والمهل، والعودة، ومباراةٌ كاملة حتى الإحصاءات.

const { setupWaveOnline, sanitize } = require("./wavesrv");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(4); } return false; }
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
const slow = setupWaveOnline({ of: () => slowN }, { store, graceMs: 150, psyGraceMs: 60, secsScale: 1 });
const fast = setupWaveOnline({ of: () => fastN }, { store, graceMs: 120, psyGraceMs: 40, secsScale: 0.003 });
const st = s => s.last("state");
const toast = s => s.last("toast");

async function room4(N, api, ids = []) {
  const socks = [];
  const A = N.connect(ids[0]);
  const r0 = await A.ask("createRoom", { name: "سعود" });
  socks.push(A);
  for (const [i, nm] of ["نورة", "فهد", "ريم"].entries()) {
    const s = N.connect(ids[i + 1]);
    await s.ask("joinRoom", { name: nm, roomId: r0.roomId });
    socks.push(s);
  }
  return { socks, code: r0.roomId, room: api.rooms.get(r0.roomId), host: A };
}
const pid = (room, s) => room.players.find(p => p.sockId === s.id).id;
const sockOf = (room, socks, id) => socks.find(s => pid(room, s) === id);

(async () => {
  console.log("\n═══ خادم «التخاطر» ═══\n");

  console.log("① الغرفة والفريقان");
  const { socks, code, room, host } = await room4(slowN, slow);
  eq(room.players.map(p => p.team), [0, 1, 0, 1], "كلُّ داخلٍ إلى الفريق الأقلّ");
  host.fire("updateSettings", { clueSecs: 60, dialSecs: 0, guessSecs: 30, win: 7, junk: 1 });
  eq(room.settings, { clueSecs: 60, dialSecs: 0, guessSecs: 30, win: 7 }, "الإعدادات (والمؤشرُ بلا وقت)");
  eq(sanitize({ win: 99 }, { win: 10 }).win, 10, "وقيمةٌ خارج القائمة تُتجاهَل");
  host.fire("updateSettings", { dialSecs: 120, win: 10 });

  console.log("② الحجب والتلميح");
  host.fire("startGame");
  const m = room.match;
  ok(!!m && m.phase === "clue", "بدأت: التلميح");
  const psy = sockOf(room, socks, m.cur.psychic);
  const team = m.cur.team;
  const an = socks.find(s => s !== psy && m.teamOf(pid(room, s)) === team);
  const opp = socks.filter(s => m.teamOf(pid(room, s)) !== team);
  ok(st(psy).cur.target === m.cur.target, "الوسيطُ يرى الهدف");
  const leaked = [an, ...opp].some(s => s.all("state").some(v => v.cur && v.cur.target != null));
  ok(!leaked, "ولا يصل الهدفُ مقبسَ أحدٍ غيره أبدًا (فحصُ كلّ ما وصل)");
  ok(st(psy).span === 60000 && st(psy).deadline > Date.now(), "مهلةُ التلميح ٦٠ث");
  an.fire("clue", { text: "س" });
  ok(/الوسيطُ وحده/.test(toast(an) || ""), "غيرُ الوسيط لا يكتب");
  psy.fire("reroll");
  ok(m.cur.rerolls === 1, "الوسيطُ يبدّل البطاقة");
  psy.fire("clue", { text: "قهوة المطار" });
  ok(m.phase === "dial" && socks.every(s => st(s).cur.clue === "قهوة المطار"), "التلميحُ للجميع ⇒ المؤشر");
  ok(st(psy).cur.target === null, "والستارةُ أُغلقت على الوسيط");

  console.log("③ المؤشرُ الحيّ والموافقة");
  const n0 = socks.map(s => s.all("dial").length);
  an.fire("dial", { a: 37.26 });
  ok(socks.every((s, i) => s.all("dial").length === n0[i] + 1 && s.last("dial").a === 37.3), "تحريكُ المحلّل يصل الغرفةَ كلَّها فورًا (رسالةٌ خفيفة)");
  an.fire("dial", { a: 38 });
  ok(socks[0].all("dial").length === n0[0] + 1, "والتحريكُ أسرع من ٣٣ في الثانية يُهمل (إلا آخره)");
  await sleep(35);
  an.fire("dial", { a: 40, end: true });
  ok(m.cur.dial === 40, "وآخرُ تحريكٍ يصل");
  opp[0].fire("dial", { a: 90 });
  ok(m.cur.dial === 40, "والخصمُ لا يحرّك المؤشر");
  m.cur.target = 45;
  an.fire("agree", { on: true });
  ok(m.phase === "guess" && m.cur.locked === 40, "موافقةُ المحلّل الوحيد ⇒ ثُبّت");
  ok(st(opp[0]).span === 30000, "ومهلةُ الخصم ٣٠ث");

  console.log("④ تصويتُ الخصم والكشف");
  opp[0].fire("vote", { side: "right" });
  ok(m.phase === "guess", "صوتٌ من اثنين لا يحسم");
  opp[1].fire("vote", { side: "left" });
  ok(m.phase === "reveal", "صوّت الجميع ⇒ الكشف");
  ok(socks.every(s => st(s).cur.target === 45), "والهدفُ للجميع الآن");
  eq(st(opp[0]).cur.result, { pts: 3, opp: 1, truth: "right", diff: 5 }, "على بُعد ٥ ⇒ ٣، والتعادلُ لأوّل صوت (يمين) ⇒ نقطةٌ للخصم");
  eq(st(an).scores[team], 3, "النقاطُ في الشريط");
  socks.forEach(s => s.fire("next"));
  ok(m.round === 2 && m.cur.team === 1 - team, "«التالي» من الجميع ⇒ دورُ الفريق الآخر");

  console.log("⑤ الغياب والعودة");
  const psy2 = sockOf(room, socks, m.cur.psychic);
  const psyId = m.cur.psychic;
  slowN.drop(psy2);
  ok(await until(() => m.cur.psychic !== psyId, 1000), "الوسيطُ انقطع ⇒ يتسلّم زميلُه بعد مهلةٍ قصيرة");
  const back = slowN.connect();
  const r = await back.ask("joinRoom", { name: room.players.find(p => p.id === psyId).name, roomId: code });
  ok(r.ok && r.resumed, "ويعود صاحبُ المقعد باسمه");
  const outsider = slowN.connect();
  const r2 = await outsider.ask("joinRoom", { name: "غريب", roomId: code });
  ok(!r2.ok && /جارية/.test(r2.error), "والغريبُ ينتظر");

  console.log("⑥ مباراةٌ كاملة بالمهل (خادمٌ سريع)");
  {
    const g = await room4(fastN, fast, [31, 32, 33, 34]);
    g.host.fire("updateSettings", { win: 7 });
    g.host.fire("startGame");
    const mm = g.room.match;
    ok(!!mm, "بدأت");
    /* الوسطاءُ يكتبون، والمؤشرُ على الهدف (نصيب ٤)، والباقي بالمهل */
    let rounds = 0;
    while (g.room.match && rounds++ < 30) {
      await until(() => !g.room.match || mm.phase === "clue", 3000);
      if (!g.room.match) break;
      const ps = sockOf(g.room, g.socks, mm.cur.psychic);
      ps.fire("clue", { text: "تلميح" });
      const a = g.socks.find(s => s !== ps && mm.teamOf(pid(g.room, s)) === mm.cur.team);
      a.fire("dial", { a: mm.cur.target, end: true });
      a.fire("agree", { on: true });
      await until(() => !g.room.match || mm.phase === "reveal", 3000);
      g.socks.forEach(s => s.fire("next"));
    }
    ok(await until(() => !g.room.match, 4000), "انتهت ببلوغ الهدف");
    const e = g.host.last("matchEnd");
    ok(e && e.winner != null && Math.max(...e.scores) >= 7 && e.history.length >= 2, "النهاية: الفائزُ والنقاطُ والسجلّ", e && { w: e.winner, s: e.scores });
    await until(() => stats.filter(x => x.g === "wave").length >= 4, 1000);
    const ws = stats.filter(x => x.g === "wave");
    ok(ws.length === 4 && ws.filter(x => x.wins).length === 2, "إحصاءُ «wave»: فائزان وخاسران", ws);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
