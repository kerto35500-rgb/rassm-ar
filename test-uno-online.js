// اختبار «اونو» أونلاين: الغرف والدعوة والمباراة على الخادم.
//
// نستعمل محاكاة السوكِت نفسها التي تستعملها بقيّة اختبارات الموقع (لا
// socket.io-client في البيئة). ما يُفحَص هنا ليس أن اللعبة تعمل فحسب، بل
// أن الخادم لا يُصدّق العميل: كرتٌ ليس في يدك، ودورٌ ليس دورك، وحالةٌ تحمل
// كروت غيرك — كلّها تُردّ.

const { setupUnoOnline } = require("./unosrv");
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── محاكاة socket.io ── */
class FS {
  constructor(nsp, id) { this.nsp = nsp; this.id = id; this.rooms = new Set([id]); this.h = {}; this.rx = []; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  emit(e, d) { this.rx.push({ e, d }); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  last(e) { for (let i = this.rx.length - 1; i >= 0; i--) if (this.rx[i].e === e) return this.rx[i].d; return null; }
  all(e) { return this.rx.filter(x => x.e === e).map(x => x.d); }
  get handshake() { return { headers: {}, address: this._ip || "1.2.3." + this.id }; }
}
class FN {
  constructor() { this.cf = []; this.sockets = new Map(); }
  on(e, f) { if (e === "connection") this.cf.push(f); }
  connect(id, ip) { const s = new FS(this, id); s._ip = ip; this.sockets.set(id, s); this.cf.forEach(f => f(s)); return s; }
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
}
const nsp = new FN();
const wallets = {}, stats = {};
const store = {
  async move(u, c, d) { const w = wallets[u] = wallets[u] || { gold: 0, gems: 0 }; w[c] += d; return { ok: true, ...w }; },
  async getWallet(u) { return wallets[u] || { gold: 0, gems: 0 }; },
  async earnedSince() { return 0; },
  async bumpGameStats(u, g, x) { (stats[u] = stats[u] || []).push({ g, ...x }); }
};
/* بوتٌ سريعٌ ومهلةُ جولةٍ قصيرة: نختبر المنطق لا تمثيليّة التفكير */
const UNO = setupUnoOnline({ of: () => nsp }, { store, botMin: 8, botMax: 20, roundPause: 60 });

let seq = 0;
function conn(ip) { return nsp.connect("s" + (++seq), ip); }
const ask = (s, e, d, ms = 500) => new Promise(res => {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
  s.fire(e, d, r => { if (!done) { done = true; clearTimeout(t); res(r); } });
});
const lob = s => s.last("lobby");
const st = s => s.last("state");

/* canPlay على منظور العميل — للاختبار وحده */
function playable(v, k) {
  const DR = { d2: 2, d4: 4, d6: 6, d10: 10, draw4: 4, revd4: 4 };
  if (v.pending > 0) {
    if (!v.S.stacking) return false;
    if (v.S.mode === "classic") {
      if (v.pendingType === "d2") return k.v === "d2" || k.v === "draw4";
      return k.v === "draw4";
    }
    return !!DR[k.v];
  }
  if (k.c === "w") return true;
  return k.c === v.color || (v.top && k.v === v.top.v);
}

(async () => {
  console.log("\n═══ اونو أونلاين ═══\n");

  console.log("① إنشاء غرفة وانضمام");
  const A = conn("1.1.1.1"), B = conn("2.2.2.2");
  let r = await ask(A, "create", { name: "أحمد", av: "Adult_1", frame: "Classic" });
  ok(r && r.ok && /^[A-Z0-9]{4}$/.test(r.code), "أُنشئت غرفةٌ برمزٍ من ٤ خانات", r);
  const CODE = r.code;
  ok(lob(A) && lob(A).host === r.id, "والمُنشئ هو المضيف");

  let r2 = await ask(B, "join", { code: "ZZZZ", name: "سعد" });
  ok(r2 && !r2.ok && /رمز/.test(r2.error), "ورمزٌ خاطئ يُردّ", r2);
  r2 = await ask(B, "join", { code: CODE.toLowerCase(), name: "سعد", av: "Kid_1" });
  ok(r2 && r2.ok, "والانضمام يقبل الرمز بحروفٍ صغيرة", r2);
  ok(lob(A).players.length === 2, "والمضيف يرى الاثنين", lob(A).players.length);
  ok(lob(A).players[1].name === "سعد" && lob(A).players[1].av === "Kid_1",
     "باسم الضيف وصورته — الضيف يختار شخصيّته", lob(A).players[1]);
  ok(lob(B).host !== r2.id, "والضيف ليس مضيفًا");

  console.log("\n② الإعدادات للمضيف وحده، وبحدودها");
  B.fire("settings", { mode: "classic", limit: 200 });
  ok(lob(A).settings.mode !== "classic", "غيرُ المضيف لا يُغيّر شيئًا", lob(A).settings.mode);
  A.fire("settings", { mode: "classic", limit: 200, timer: 0, bots: true, mercy: false, seven0: true });
  ok(lob(A).settings.mode === "classic" && lob(A).settings.limit === 200, "والمضيف يُغيّر", lob(A).settings);
  ok(lob(A).settings.seven0 === true, "وقواعد البيت تُضبط", lob(A).settings.seven0);
  A.fire("settings", { limit: 99999, mode: "خربشة", timer: 7 });
  ok(lob(A).settings.limit === 200 && lob(A).settings.mode === "classic" && lob(A).settings.timer === 0,
     "وقيمةٌ خارج المسموح تُتجاهَل بلا كسر", lob(A).settings);

  console.log("\n③ البدء والحالة الخاصّة بكلّ لاعب");
  A.fire("start");
  await sleep(60);
  const sa = st(A), sb = st(B);
  ok(!!sa && !!sb, "وصلت الحالة للاثنين");
  ok(sa.me.hand.length === 7 && sb.me.hand.length === 7, "لكلٍّ سبعة كروت", sa.me.hand.length);
  ok(sa.players.length === 4, "وامتلأت المقاعد ببوتات (أذِن المضيف)", sa.players.length);
  ok(sa.players.filter(p => p.bot).length === 2, "بوتان اثنان", sa.players.filter(p => p.bot).length);
  ok(sa.me.seat !== sb.me.seat, "ولكلٍّ مقعده", [sa.me.seat, sb.me.seat]);
  ok(sa.players.every(p => p.hand === undefined && p.n >= 0), "ولا يرى أحدٌ يد أحد — أعدادٌ لا أوراق");
  ok(sa.deckN > 0 && sa.deck === undefined, "والرزمة عددٌ لا ترتيب", sa.deckN);
  const mineA = new Set(sa.me.hand.map(k => k.id));
  const bIds = new Set(sb.me.hand.map(k => k.id));
  ok([...mineA].every(id => !bIds.has(id)), "ولا كرتَ في يدين معًا");
  const leak = [...JSON.stringify(sa).matchAll(/"id":(\d+)/g)].map(m => +m[1])
    .filter(id => !mineA.has(id) && id !== (sa.top && sa.top.id));
  ok(leak.length === 0, "ورسالتي لا تحمل معرّفَ كرتٍ لا أملكه", leak);

  console.log("\n④ الخادم لا يُصدّق العميل");
  const mine = st(A).turn === st(A).me.seat ? A : (st(B).turn === st(B).me.seat ? B : null);
  const other = mine === A ? B : A;
  if (mine) {
    const e0 = other.all("err").length;
    other.fire("play", { cardId: st(other).me.hand[0].id });
    ok(other.all("err").length > e0 && /دورك/.test(other.last("err").msg),
       "لعبٌ خارج الدور يُردّ برسالة", other.last("err"));
    const e1 = mine.all("err").length;
    mine.fire("play", { cardId: 999999 });
    ok(mine.all("err").length > e1 && /يدك/.test(mine.last("err").msg),
       "وكرتٌ ليس في يدك يُردّ", mine.last("err"));
    /* أخطر محاولة: كرتٌ حقيقيّ لكنه في يد غيري */
    const stolen = st(other).me.hand[0].id;
    const e2 = mine.all("err").length;
    mine.fire("play", { cardId: stolen });
    ok(mine.all("err").length > e2, "وكرتُ خصمي — وإن كان حقيقيًّا — يُردّ", mine.last("err"));
    const n0 = st(mine).me.hand.length;
    mine.fire("draw");
    await sleep(30);
    ok(st(mine).me.hand.length >= n0, "والسحب في الدور يعمل", st(mine).me.hand.length - n0);
  } else ok(false, "لم يُعرَف صاحب الدور", { turn: sa.turn, seat: sa.me.seat });

  console.log("\n⑤ المباراة تمشي حتى نهايتها (بوتات تلعب وحدها)");
  const t0 = Date.now();
  let ticks = 0;
  while (!A.last("matchEnd") && Date.now() - t0 < 60000) {
    for (const s of [A, B]) {
      const v = st(s);
      if (!v || v.over) continue;
      if (v.phase === "drawn" && v.pendingFor === v.me.seat) { s.fire("drawn", { yes: false }); continue; }
      if (v.phase !== "turn" || v.turn !== v.me.seat) continue;
      const k = v.me.hand.find(x => playable(v, x));
      if (k) s.fire("play", { cardId: k.id, color: "r", swap: (v.me.seat + 1) % v.players.length });
      else s.fire("draw");
      if (st(s) && st(s).me.hand.length === 1) s.fire("uno");
      ticks++;
    }
    await sleep(40);
  }
  const end = A.last("matchEnd");
  ok(!!end, "انتهت المباراة", { ticks });
  if (end) {
    ok(end.winner != null, "وفيها فائز", end.winner);
    ok(end.gold === 0, "ولا ذهب — فيها بوت", end.gold);
    ok(/بوت|ضيوف/.test(end.reason || ""), "والسبب مذكور", end.reason);
  }

  console.log("\n⑥ لا جائزة لمباراةٍ فيها بوت، ولا للضيوف");
  ok(Object.keys(wallets).length === 0, "لم تُمسّ أيّ محفظة", wallets);

  console.log("\n⑦ الغرفة والمغادرة");
  const C = conn("3.3.3.3");
  const rc = await ask(C, "create", { name: "خالد" });
  const D = conn("4.4.4.4");
  await ask(D, "join", { code: rc.code, name: "زياد" });
  ok(lob(C).players.length === 2, "غرفةٌ ثانية باثنين");
  D.fire("leaveRoom");
  ok(lob(C).players.length === 1, "ومن غادر خرج فورًا", lob(C).players.length);
  const E = conn("5.5.5.5");
  ok((await ask(E, "join", { code: rc.code, name: "بدر" })).ok, "ومكانه يُملأ");
  ok(lob(C).players.length === 2, "فرجعوا اثنين");

  console.log("\n⑧ الطرد للمضيف وحده");
  const eid = lob(C).players.find(p => p.name === "بدر").id;
  E.fire("kick", { id: lob(C).players[0].id });
  ok(lob(C).players.length === 2, "غيرُ المضيف لا يطرد");
  C.fire("kick", { id: eid });
  ok(lob(C).players.length === 1, "والمضيف يطرد", lob(C).players.length);
  ok(!!E.last("kicked"), "والمطرود يُخبَر");
  C.fire("kick", { id: lob(C).players[0].id });
  ok(lob(C).players.length === 1, "ولا يطرد المضيفُ نفسه");

  console.log("\n⑨ الامتلاء والبدء الناقص");
  const H = conn("6.6.6.6");
  const rf = await ask(H, "create", { name: "م١" });
  H.fire("settings", { bots: false });
  const e0 = H.all("err").length;
  H.fire("start");
  ok(H.all("err").length > e0 && /لاعبَين/.test(H.last("err").msg),
     "بلا بوتات ولاعبٍ واحد لا تبدأ", H.last("err"));
  const socks = [];
  for (let i = 0; i < 3; i++) { const s = conn("7.7.7." + i); socks.push(s); await ask(s, "join", { code: rf.code, name: "م" + (i + 2) }); }
  ok(lob(H).players.length === 4, "أربعة في الغرفة", lob(H).players.length);
  const extra = conn("8.8.8.8");
  const rx = await ask(extra, "join", { code: rf.code, name: "زائد" });
  ok(rx && !rx.ok && /ممتلئة/.test(rx.error), "والخامس يُردّ", rx);
  H.fire("start");
  await sleep(40);
  ok(!!st(H) && st(H).players.length === 4, "وتبدأ بأربعة بشرٍ بلا بوت", st(H) && st(H).players.length);
  ok(st(H).players.every(p => !p.bot), "ولا بوتَ فيها");
  const rj = await ask(conn("9.9.9.9"), "join", { code: rf.code, name: "متأخّر" });
  ok(rj && !rj.ok && /بدأت/.test(rj.error), "ولا يدخل أحدٌ بعد البدء", rj);

  console.log("\n⑩ مباراةٌ بين مسجَّلَين حقيقيَّين تمنح ذهبًا");
  {
    /* الفارق كلّه هنا: حسابان مختلفان وعنوانان مختلفان وبلا بوت. */
    const X = conn("11.11.11.11"), Y = conn("22.22.22.22");
    X.userName = "سالم"; X.userId = 501;
    Y.userName = "ناصر"; Y.userId = 502;
    const rx = await ask(X, "create", { name: "مُنتحَل" });
    ok(lob(X).players[0].name === "سالم", "المسجَّل يلعب باسم حسابه لا بما يكتبه", lob(X).players[0].name);
    await ask(Y, "join", { code: rx.code, name: "أيًّا كان" });
    X.fire("settings", { mode: "nomercy", timer: 0, bots: false });
    X.fire("start");
    await sleep(60);
    ok(!!st(X) && st(X).players.length === 2, "مباراةُ اثنين بلا بوت", st(X) && st(X).players.length);

    const t1 = Date.now();
    while (!X.last("matchEnd") && Date.now() - t1 < 45000) {
      for (const s of [X, Y]) {
        const v = st(s);
        if (!v || v.over) continue;
        if (v.phase === "drawn" && v.pendingFor === v.me.seat) { s.fire("drawn", { yes: true, color: "r" }); continue; }
        if (v.phase !== "turn" || v.turn !== v.me.seat) continue;
        const k = v.me.hand.find(x => playable(v, x));
        if (k) s.fire("play", { cardId: k.id, color: "r" }); else s.fire("draw");
        if (st(s) && st(s).me.hand.length === 1) s.fire("uno");
      }
      await sleep(15);
    }
    const e = X.last("matchEnd");
    ok(!!e, "انتهت", e);
    await sleep(120);
    const gold = (wallets[501] || {}).gold || 0, gold2 = (wallets[502] || {}).gold || 0;
    ok(gold > 0 && gold2 > 0, "وكلاهما قبض ذهبًا", { سالم: gold, ناصر: gold2 });
    ok(Math.max(gold, gold2) === 40 && Math.min(gold, gold2) === 15,
       "الفائز ٤٠ والمشارك ١٥", { gold, gold2 });
    ok((stats[501] || []).length === 1 && (stats[502] || []).length === 1,
       "وسُجّلت مباراةٌ لكلٍّ في إحصاءاته", { a: (stats[501] || []).length, b: (stats[502] || []).length });
  }

  console.log("\n⑪ حسابٌ واحد لا يجلس مقعدَين");
  {
    const Z1 = conn("33.33.33.33"), Z2 = conn("33.33.33.33");
    Z1.userName = "مكرَّر"; Z1.userId = 777;
    Z2.userName = "مكرَّر"; Z2.userId = 777;
    const rz = await ask(Z1, "create", {});
    const bad = await ask(Z2, "join", { code: rz.code });
    ok(bad && !bad.ok && /موجود/.test(bad.error), "الحساب نفسه لا ينضمّ مرّتين", bad);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
