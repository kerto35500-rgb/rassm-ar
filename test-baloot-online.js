// اختبار «بالوت» أونلاين: الطاولات والمقاعد والصكّة على الخادم.
//
// نستعمل محاكاة السوكِت نفسها التي تستعملها بقيّة اختبارات الموقع (لا
// socket.io-client في البيئة). وما يُفحَص هنا ليس أن اللعبة تعمل فحسب، بل
// أن الخادم لا يُصدّق العميل: ورقةٌ ليست في يدك، ودورٌ ليس دورك، وشراءٌ
// غير مطروح، ومنظورٌ يحمل أوراق غيرك — كلُّها تُردّ.

const { setupBalootOnline, SEATS } = require("./balootsrv");
const B = require("./balootrules");

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
const wallets = {}, stats = {}, escrow = [];
const store = {
  async move(u, c, d) {
    const w = wallets[u] = wallets[u] || { gold: 0, gems: 0 };
    if (w[c] + d < 0) return { ok: false, error: "الرصيد لا يكفي" };
    w[c] += d; return { ok: true, balance: w[c], ...w };
  },
  async getWallet(u) { return wallets[u] || { gold: 0, gems: 0 }; },
  async earnedSince() { return 0; },
  async spentSince() { return 0; },
  async bumpGameStats(u, g, x) { (stats[u] = stats[u] || []).push({ g, ...x }); },
  /* حجزٌ مبسَّطٌ يحاكي الذرّيّة: إمّا الخصمُ والصفُّ معًا وإمّا لا شيء */
  async holdBet(room, game, u, amt) {
    if (escrow.some(e => e.room === room && e.userId === u && e.state === "held"))
      return { ok: false, error: "لك رهانٌ محجوز" };
    const r = await this.move(u, "gold", -amt);
    if (!r.ok) return r;
    escrow.push({ room, game, userId: u, amount: amt, state: "held" });
    return { ok: true, balance: r.balance, amount: amt };
  },
  async heldBets(room) { return escrow.filter(e => e.room === room && e.state === "held"); },
  async settleBets(room, winners) {
    const held = escrow.filter(e => e.room === room && e.state === "held");
    if (!held.length) return { ok: true, pot: 0, paid: [] };
    const pot = held.reduce((a, e) => a + e.amount, 0);
    const W = [...new Set((winners || []).filter(Boolean))];
    const paid = [];
    if (W.length) {
      const per = Math.floor(pot / W.length);
      for (let i = 0; i < W.length; i++) {
        const amt = per + (i === 0 ? pot - per * W.length : 0);
        await this.move(W[i], "gold", amt);
        paid.push({ userId: W[i], amount: amt, ok: true });
      }
    } else {
      for (const e of held) { await this.move(e.userId, "gold", e.amount); paid.push({ userId: e.userId, amount: e.amount, ok: true }); }
    }
    held.forEach(e => { e.state = W.length ? "paid" : "refunded"; });
    return { ok: true, pot, paid };
  },
  async refundBets(room) { const r = await this.settleBets(room, []); return { ok: true, refunded: r.paid }; }
};
/* بوتٌ سريعٌ ومهَلٌ قصيرة: نختبر المنطق لا تمثيليّة التفكير */
const SRV = setupBalootOnline({ of: () => nsp }, { store, botMin: 1, botMax: 4, handPause: 20, redealPause: 10 });

let seq = 0;
const conn = ip => nsp.connect("s" + (++seq), ip);
const ask = (s, e, d, ms = 500) => new Promise(res => {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
  s.fire(e, d, r => { if (!done) { done = true; clearTimeout(t); res(r); } });
});
const lob = s => s.last("lobby");
const stv = s => s.last("state");

/* طاولةٌ جاهزة: مضيفٌ + ثلاثةٌ (أو بوتات) */
async function table(n = 4, ids = true) {
  const socks = [];
  for (let i = 0; i < n; i++) {
    const s = conn((i + 1) + "." + (i + 1) + "." + (i + 1) + "." + (i + 1));
    if (ids) { s.userId = "u" + (++seq); s.userName = "لاعب" + i; }
    socks.push(s);
  }
  const r = await ask(socks[0], "create", { name: "المضيف" });
  for (let i = 1; i < n; i++) await ask(socks[i], "join", { code: r.code, name: "ضيف" + i });
  return { socks, code: r.code, id: r.id };
}

/* يمرّر الصكّة خطوةً خطوة حتى تنتهي أو تُستنفَد المحاولات */
async function drive(socks, room, maxSteps = 4000) {
  let steps = 0;
  while (room.match && steps++ < maxSteps) {
    const m = room.match;
    const seat = m.actingSeat();
    if (seat == null) { await sleep(5); continue; }
    const p = room.seats[seat];
    if (p.bot) { await sleep(5); continue; }
    const s = socks.find(x => x.id === p.sockId);
    if (!s) { await sleep(5); continue; }
    if (m.phase === "bidding") {
      const o = m.bidOptions(seat).map(x => x.id);
      s.fire("bid", { choice: o.includes("sun") ? "sun" : "pass" });
    } else if (m.phase === "doubling") {
      s.fire("double", { choice: "pass" });
    } else if (m.phase === "playing") {
      s.fire("play", { card: m.legalMoves(seat)[0] });
    }
    await sleep(2);
  }
  return steps;
}

(async () => {
  console.log("\n═══ بالوت أونلاين ═══\n");

  /* ─────────────────────────── */
  console.log("① الطاولة والمقاعد");
  {
    const A = conn("1.1.1.1"), C = conn("2.2.2.2");
    const r = await ask(A, "create", { name: "أحمد", av: "Adult_1", frame: "Classic" });
    ok(r && r.ok && /^[A-Z0-9]{4}$/.test(r.code), "أُنشئت طاولةٌ برمزٍ من ٤ خانات", r);
    ok(lob(A) && lob(A).host === r.id, "والمُنشئ هو المضيف");
    ok(!/[01OI]/.test(r.code), "ولا حرفَ ملتبسًا في الرمز", r.code);
    ok(lob(A).max === 4, "والطاولة أربعة مقاعد");

    const j = await ask(C, "join", { code: r.code, name: "خالد" });
    ok(j && j.ok, "وانضمّ الثاني", j);
    ok(lob(A).players.length === 2, "فصار في الطاولة اثنان");
    ok(lob(A).players[0].team === 0 && lob(A).players[1].team === 1, "وكلٌّ في فريق");

    const bad = await ask(conn("3.3.3.3"), "join", { code: "ZZZZ" });
    ok(bad && !bad.ok, "ولا انضمامَ لرمزٍ لا وجود له", bad);

    const D = conn("4.4.4.4"), E = conn("5.5.5.5"), G = conn("6.6.6.6");
    await ask(D, "join", { code: r.code }); await ask(E, "join", { code: r.code });
    const full = await ask(G, "join", { code: r.code });
    ok(full && !full.ok && /ممتلئة/.test(full.error), "والخامس يُردّ — الطاولة ممتلئة", full);
  }

  console.log("② حسابٌ واحد لا يجلس مقعدين");
  {
    const A = conn("1.1.1.1"); A.userId = "same"; A.userName = "سعد";
    const Bb = conn("2.2.2.2"); Bb.userId = "same"; Bb.userName = "سعد";
    const r = await ask(A, "create", {});
    const j = await ask(Bb, "join", { code: r.code });
    ok(j && !j.ok && /حسابك/.test(j.error), "الحساب نفسه لا يجلس مقعدين", j);
  }

  console.log("③ الاسم لا يُنتحَل");
  {
    const A = conn("1.1.1.1"); A.userId = "u9"; A.userName = "الاسم الحقيقيّ";
    await ask(A, "create", { name: "اسمٌ مزوَّر" });
    ok(lob(A).players[0].name === "الاسم الحقيقيّ", "المسجَّل يلعب باسم حسابه", lob(A).players[0].name);
  }

  console.log("④ الإعدادات — المضيف وحده، وبحدود");
  {
    const t = await table(2);
    const [A, C] = t.socks;
    A.fire("settings", { targetScore: 102, allowGahwa: false, bots: true });
    ok(lob(A).settings.targetScore === 102, "المضيف يغيّر نقاط الصكّة", lob(A).settings);
    ok(lob(A).settings.allowGahwa === false, "ويُطفئ القهوة");

    C.fire("settings", { targetScore: 202 });
    ok(lob(A).settings.targetScore === 102, "وغيرُ المضيف لا يغيّر شيئًا", lob(A).settings.targetScore);

    A.fire("settings", { targetScore: 9999 });
    ok(lob(A).settings.targetScore === 102, "وقيمةٌ خارج المسموح تُرفَض", lob(A).settings.targetScore);
    A.fire("settings", { sunCapot: 999 });
    ok(lob(A).settings.sunCapot === undefined, "وإعدادٌ ليس للمضيف لا يظهر أصلًا");
    A.fire("settings", { turnSeconds: 30 });
    ok(lob(A).settings.turnSeconds === 30, "ووقت الدور يُضبَط");
  }

  console.log("⑤ تبديل المقاعد والطرد");
  {
    const t = await table(3);
    const [A, C, D] = t.socks;
    const before = lob(A).players.map(p => p.name);
    A.fire("swap", { a: 1, b: 2 });
    const after = lob(A).players.map(p => p.name);
    ok(after[1] === before[2] && after[2] === before[1], "المضيف يبدّل مقعدين", { before, after });
    C.fire("swap", { a: 0, b: 1 });
    ok(JSON.stringify(lob(A).players.map(p => p.name)) === JSON.stringify(after), "وغيرُه لا يبدّل");

    const victim = lob(A).players.find(p => !p.host);
    A.fire("kick", { id: victim.id });
    ok(lob(A).players.length === 2, "والمضيف يطرد", lob(A).players.length);
    const hostId = lob(A).host;
    A.fire("kick", { id: hostId });
    ok(lob(A).players.length === 2, "ولا يطرد نفسه");
  }

  console.log("⑥ البداية");
  {
    const t = await table(2);
    const [A] = t.socks;
    A.fire("settings", { bots: false });
    A.fire("start");
    ok(!stv(A), "لا تبدأ باثنين بلا بوتات", stv(A));
    ok(/أربعة/.test((A.last("err") || {}).msg || ""), "ويُقال له: بالوت أربعة", A.last("err"));

    A.fire("settings", { bots: true });
    A.fire("start");
    await sleep(30);
    const room = SRV.rooms.get(t.code);
    ok(room.seats.length === 4, "والبوتات تملأ المقاعد إلى الأربعة", room.seats.length);
    ok(room.seats.filter(p => p.bot).length === 2, "بوتان فقط", room.seats.filter(p => p.bot).length);
    ok(!!stv(A), "ووصلت الحالة");
    const v = stv(A);
    ok(v.phase === "bidding" || v.phase === "playing", "وبدأ الشراء", v.phase);
    ok(v.me.hand.length === 5 || v.me.hand.length === 8, "ويده خمسٌ قبل الإكمال", v.me.hand.length);
    ok(!!v.bidCard, "وورقة الشراء مكشوفة");
    ok(v.players.length === 4, "ويرى اللاعبين الأربعة");
  }

  console.log("⑦ المنظور لا يُسرِّب");
  {
    const t = await table(4);
    const [A, C] = t.socks;
    A.fire("start");
    await sleep(30);
    const room = SRV.rooms.get(t.code);
    const va = stv(A), vc = stv(C);
    ok(va.me.seat === 0 && vc.me.seat === 1, "كلٌّ يعرف مقعده", { a: va.me.seat, c: vc.me.seat });
    ok(!va.hands, "ولا حقلَ لأيدي الجميع");
    const mine = new Set(va.me.hand);
    const others = room.seats.map((p, i) => i).filter(i => i !== 0).flatMap(i => room.match.hands[i]);
    const leak = others.filter(c => JSON.stringify(va).includes('"' + c + '"') && !mine.has(c));
    ok(leak.length === 0, "ولا تتسرّب ورقةٌ من أيدي الخصوم", leak.slice(0, 5));
    ok(va.handCounts.every(n => n === 5), "بل أعدادُ الأوراق فقط", va.handCounts);
    ok(va.me.hand.length === 5, "ويرى يده كاملة");
  }

  console.log("⑧ الخادم لا يُصدّق العميل");
  {
    const t = await table(4);
    const [A, C] = t.socks;
    A.fire("start");
    await sleep(30);
    const room = SRV.rooms.get(t.code);
    const m = room.match;
    const acting = m.actingSeat();
    const other = (acting + 1) % 4;
    const bad = room.socksOf;  /* لا شيء — نستعمل المقابس مباشرة */
    const sOther = t.socks[other];
    const before = JSON.stringify(m.bidLog);
    sOther.fire("bid", { choice: "sun" });
    ok(JSON.stringify(m.bidLog) === before, "شراءٌ من غير صاحب الدور يُردّ");
    ok(!!sOther.last("err"), "ويُبلَّغ بالخطأ", sOther.last("err"));

    const sAct = t.socks[acting];
    sAct.fire("bid", { choice: "طنجرة" });
    ok(JSON.stringify(m.bidLog) === before, "وخيارٌ مخترَع يُردّ");

    /* حتى نصل إلى اللعب: نمرّ حتى يُحسَم الشراء */
    let guard = 0;
    while (room.match && room.match.phase === "bidding" && guard++ < 40) {
      const seat = room.match.actingSeat();
      if (seat == null) break;
      const p = room.seats[seat];
      if (p.bot) { await sleep(6); continue; }
      const o = room.match.bidOptions(seat).map(x => x.id);
      t.socks[seat].fire("bid", { choice: o.includes("sun") ? "sun" : "pass" });
      await sleep(4);
    }
    while (room.match && room.match.phase === "doubling" && guard++ < 60) {
      const seat = room.match.actingSeat();
      const p = room.seats[seat];
      if (p.bot) { await sleep(6); continue; }
      t.socks[seat].fire("double", { choice: "pass" });
      await sleep(4);
    }
    if (room.match && room.match.phase === "playing") {
      const mm = room.match;
      const seat = mm.turn;
      const nCards = mm.hands[seat].length;
      const notMine = mm.hands[(seat + 1) % 4][0];
      t.socks[seat].fire("play", { card: notMine });
      ok(mm.hands[seat].length === nCards, "وورقةٌ ليست في يدي تُردّ", { notMine });
      t.socks[seat].fire("play", { card: "ZZ" });
      ok(mm.hands[seat].length === nCards, "وورقةٌ لا وجود لها تُردّ");
      t.socks[(seat + 1) % 4].fire("play", { card: mm.hands[(seat + 1) % 4][0] });
      ok(mm.hands[seat].length === nCards, "ولعبٌ من غير صاحب الدور يُردّ");
      const legal = mm.legalMoves(seat)[0];
      t.socks[seat].fire("play", { card: legal });
      await sleep(5);
      ok(mm.hands[seat].length === nCards - 1 || !room.match, "والورقة المسموحة تُقبَل");
    } else ok(true, "(تخطّي فحص اللعب — لم يصل الطور)");
  }

  console.log("⑨ صكّةٌ كاملة بالبوتات");
  {
    const t = await table(1);
    const [A] = t.socks;
    A.fire("settings", { targetScore: 102, turnSeconds: 0, bidSeconds: 0 });
    A.fire("start");
    await sleep(20);
    const room = SRV.rooms.get(t.code);
    ok(room.seats.filter(p => p.bot).length === 3, "ثلاثة بوتات وواحدٌ حقيقيّ");
    await drive(t.socks, room, 6000);
    const end = A.last("matchEnd");
    ok(!!end, "انتهت الصكّة", { steps: "—" });
    if (end) {
      ok(end.winnerTeam === 0 || end.winnerTeam === 1, "ولفريقٍ منهما", end.winnerTeam);
      ok(end.scores[end.winnerTeam] >= 102, "والفائز بلغ الحدّ", end.scores);
      ok(end.gold === 0, "ولا ذهبَ في مباراةٍ فيها بوت", end.gold);
      ok(/بوت/.test(end.reason || ""), "والسبب مذكور", end.reason);
      ok(end.hands >= 1, "وسِجِلّ الأيدي غير فارغ", end.hands);
      ok(Array.isArray(end.players) && end.players.length === 4, "وصور اللاعبين مرسَلة");
    }
    ok(!room.match, "وتُنظَّف المباراة بعد النهاية");
  }

  console.log("⑩ الذهب لأربعةٍ مسجَّلين");
  {
    const t = await table(4);
    const [A] = t.socks;
    A.fire("settings", { targetScore: 102, turnSeconds: 0, bidSeconds: 0 });
    A.fire("start");
    await sleep(20);
    const room = SRV.rooms.get(t.code);
    await drive(t.socks, room, 8000);
    const ends = t.socks.map(s => s.last("matchEnd"));
    ok(ends.every(e => !!e), "وصلت النهاية للأربعة", ends.map(e => !!e));
    if (ends.every(e => !!e)) {
      const winners = ends.filter(e => e.won), losers = ends.filter(e => !e.won);
      ok(winners.length === 2 && losers.length === 2, "فائزان وخاسران", { w: winners.length, l: losers.length });
      ok(winners.every(e => e.gold === 70), "والفائزان يأخذان ٧٠", winners.map(e => e.gold));
      ok(losers.every(e => e.gold === 25), "والخاسران ٢٥", losers.map(e => e.gold));
      ok(winners.every(e => e.myTeam === winners[0].myTeam), "والفائزان من فريقٍ واحد");
    }
    const played = Object.values(stats).flat().filter(x => x.g === "baloot");
    ok(played.length >= 4, "وسُجِّلت الإحصاءات للأربعة", played.length);
    ok(played.filter(x => x.wins === 1).length >= 2, "ولفائزَين منهم فوز", played.filter(x => x.wins === 1).length);
  }

  console.log("⑪ المؤقّت يلعب عمّن نام");
  {
    const t = await table(4);
    const [A] = t.socks;
    const room0 = SRV.rooms.get(t.code);
    /* المهَل المسموحة للمضيف بالثواني الكاملة، والاختبار لا ينتظر عشرًا —
       فنضبطها من داخل الغرفة قبل البداية، وهو ما لا يستطيعه أيّ عميل. */
    room0.settings.bidSeconds = 1; room0.settings.turnSeconds = 1;
    A.fire("start");
    await sleep(20);
    const room = SRV.rooms.get(t.code);
    const m = room.match;
    const seat = m.actingSeat();
    ok(seat != null && !room.seats[seat].bot, "صاحب الدور لاعبٌ حقيقيّ", seat);
    ok(room.deadline > Date.now(), "ومهلتُه مضبوطة", room.deadline - Date.now());
    const before = m.bidLog.length;
    await sleep(1500);                       /* ننام عنه ولا نلعب */
    ok(m.bidLog.length > before || m.phase !== "bidding", "من تأخّر يُلعب عنه «بس»",
       { before, now: m.bidLog.length, phase: m.phase });
    const auto = m.bidLog[before];
    ok(!auto || auto.choice === "pass", "ولا يُشترى عنه أبدًا", auto);
  }

  console.log("⑫ الانقطاع والرجوع");
  {
    const t = await table(4);
    const [A, C] = t.socks;
    A.fire("settings", { turnSeconds: 0, bidSeconds: 0 });
    A.fire("start");
    await sleep(20);
    const room = SRV.rooms.get(t.code);
    ok(!!room.match, "بدأت الصكّة");
    C.fire("disconnect");
    await sleep(10);
    ok(!!room.match, "ولا تُهدَم بانقطاع لاعب");
    ok(room.seats.length === 4, "ويبقى مقعده", room.seats.length);
    ok(room.seats[1].gone === true, "ويُعلَّم أنه غائب");

    const t2 = await table(2);
    const [A2, C2] = t2.socks;
    C2.fire("disconnect");
    await sleep(5);
    ok(lob(A2).players.length === 1, "ومن غادر قبل البداية يُزال من المقاعد", lob(A2).players.length);
  }

  console.log("⑬ المضيف ينتقل");
  {
    const t = await table(3);
    const [A, C] = t.socks;
    const oldHost = lob(A).host;
    A.fire("disconnect");
    await sleep(5);
    const l = lob(C);
    ok(l && l.host && l.host !== oldHost, "خرج المضيف فانتقلت الرئاسة", { old: oldHost, now: l && l.host });
    ok(l.players.length === 2, "وبقي الاثنان", l.players.length);
  }

  console.log("⑭ لا مباراةَ تُفتَح مرّتين");
  {
    const t = await table(4);
    const [A, C] = t.socks;
    A.fire("start"); await sleep(20);
    const room = SRV.rooms.get(t.code);
    const m1 = room.match;
    A.fire("start"); await sleep(10);
    ok(room.match === m1, "طلبُ بدءٍ ثانٍ لا يفتح صكّةً جديدة");
    C.fire("start"); await sleep(10);
    ok(room.match === m1, "وغيرُ المضيف لا يبدأ");
    const late = await ask(conn("9.9.9.9"), "join", { code: t.code });
    ok(late && !late.ok && /بدأت/.test(late.error), "ولا انضمامَ بعد البداية", late);
  }

  console.log("⑮ طاولات الرهان");
  {
    const SETT = require("./settings");
    /* الرهان مغلقٌ افتراضيًّا — نفتحه في الذاكرة وحدها للاختبار */
    const open = v => { try { SETT._cache().bet.betOpen = v; } catch (e) {} };

    const A = conn("7.1.1.1"); A.userId = "b1"; A.userName = "راهنٌ ١";
    let r = await ask(A, "create", { tier: "bronze" });
    ok(r && !r.ok && /مغلق/.test(r.error || ""), "لا طاولةَ رهانٍ والرهان مغلق", r);

    open(true);
    const G0 = conn("7.9.9.9");                       /* ضيفٌ بلا حساب */
    const g = await ask(G0, "create", { tier: "bronze" });
    ok(g && !g.ok && /للمسجَّلين/.test(g.error || ""), "ولا يفتحها ضيف", g);

    r = await ask(A, "create", { tier: "bronze" });
    ok(r && r.ok, "والمسجَّل يفتحها", r);
    ok(r.bet > 0, "ولها رهانٌ مقدَّر", r.bet);
    const room = SRV.rooms.get(r.code);
    ok(room.tier === "bronze" && !room.settings.bots, "ولا بوتات فيها");

    const list = await ask(A, "betRooms", {});
    ok(list && list.ok && list.tiers.length === 4, "وتُعرَض أربع طبقات", list && list.tiers.length);
    ok(list.tiers.some(t => t.rooms.some(x => x.code === r.code)), "وطاولتُنا مفتوحةٌ فيها");
    ok(list.tiers.every(t => t.min >= t.bet), "والحدّ الأدنى فوق الرهان", list.tiers.map(t => [t.bet, t.min]));

    const G1 = conn("7.9.9.8");
    const gj = await ask(G1, "join", { code: r.code });
    ok(gj && !gj.ok && /للمسجَّلين/.test(gj.error || ""), "ولا ينضمّ إليها ضيف", gj);

    A.fire("start");
    await sleep(30);
    ok(!room.match, "ولا تبدأ بأقلّ من أربعة حقيقيّين");
    ok(/أربعة/.test((A.last("err") || {}).msg || ""), "ويُقال ذلك صراحةً", A.last("err"));

    /* أربعةٌ مسجَّلون، وثلاثةٌ منهم بلا رصيد */
    const B2 = conn("7.2.2.2"); B2.userId = "b2"; B2.userName = "راهنٌ ٢";
    const C3 = conn("7.3.3.3"); C3.userId = "b3"; C3.userName = "راهنٌ ٣";
    const D4 = conn("7.4.4.4"); D4.userId = "b4"; D4.userName = "راهنٌ ٤";
    for (const s of [B2, C3, D4]) await ask(s, "join", { code: r.code });
    ok(room.seats.length === 4, "اكتملت الطاولة", room.seats.length);

    A.fire("start");
    await sleep(60);
    ok(!room.match, "ولا تبدأ ومحافظُهم فارغة");
    ok(/يحتاج|يكفي/.test((A.last("err") || {}).msg || ""), "ويُقال من يعجز ولماذا", A.last("err"));
    ok(Object.values(wallets).every(w => (w.gold || 0) >= 0), "ولا رصيدَ سالب");

    /* نمنحهم ما يكفي ثمّ نبدأ */
    for (const u of ["b1", "b2", "b3", "b4"]) await store.move(u, "gold", 5000);
    const before = { ...Object.fromEntries(["b1", "b2", "b3", "b4"].map(u => [u, wallets[u].gold])) };
    A.fire("start");
    await sleep(80);
    ok(!!room.match, "وتبدأ حين يكفي رصيدهم");
    ok(room.held === true, "والرهان محجوز");
    const held = escrow.filter(e => e.state === "held");
    ok(held.length === 4, "أربعةُ صفوفٍ محجوزة", held.length);
    ok(["b1", "b2", "b3", "b4"].every(u => wallets[u].gold === before[u] - room.bet),
       "وخُصم من كلٍّ رهانُه بالضبط", ["b1", "b2", "b3", "b4"].map(u => wallets[u].gold));
    const pot = held.reduce((a, e) => a + e.amount, 0);

    A.fire("settings", { targetScore: 102, turnSeconds: 0, bidSeconds: 0 });
    await drive([A, B2, C3, D4], room, 9000);
    const ends = [A, B2, C3, D4].map(s => s.last("matchEnd"));
    ok(ends.every(e => !!e), "وانتهت الصكّة", ends.map(e => !!e));
    if (ends.every(e => !!e)) {
      const w = ends.filter(e => e.won), l = ends.filter(e => !e.won);
      ok(w.every(e => e.betWon > 0), "والفائزان أخذا من الرهان", w.map(e => e.betWon));
      ok(l.every(e => !e.betWon), "والخاسران لا شيء", l.map(e => e.betWon));
      ok(w.reduce((a, e) => a + e.betWon, 0) === pot, "ووُزّع المجموع كاملًا", { pot, w: w.map(e => e.betWon) });
      ok(w.every(e => e.pot === pot), "والمجموع معلَنٌ للجميع", w.map(e => e.pot));
    }
    const after = ["b1", "b2", "b3", "b4"].reduce((a, u) => a + wallets[u].gold, 0);
    const beforeSum = Object.values(before).reduce((a, x) => a + x, 0);
    const rewards = ends.reduce((a, e) => a + ((e && e.gold) || 0), 0);
    ok(after === beforeSum + rewards, "ولم يُخلَق ذهبٌ ولم يضِع", { beforeSum, after, rewards });
    ok(!escrow.some(e => e.state === "held"), "ولم يبقَ محجوز");
    open(false);
  }

  console.log("⑯ الدردشة والعبارات");
  {
    const t = await table(2);
    const [A, C] = t.socks;
    const meta = await ask(A, "chatMeta", {});
    ok(meta && meta.ok, "قائمةُ العبارات والهدايا متاحة", meta && meta.ok);
    ok(meta.phrases.length >= 6 && meta.emojis.length >= 6, "وفيها عباراتٌ وإيموجي",
       { p: meta.phrases.length, e: meta.emojis.length });
    ok(meta.gifts.every(g => g.price > 0), "وكلُّ هديّةٍ لها ثمن", meta.gifts.map(g => g.price));

    A.fire("chat", { text: "يا سلام لعبٌ نظيف" });
    await sleep(5);
    const m = C.last("chat");
    ok(m && m.text === "يا سلام لعبٌ نظيف", "وصلت الرسالة للآخر", m);
    ok(m.seat === 0, "ومعها مقعدُ قائلها", m && m.seat);

    A.fire("chat", { text: "ثانيةٌ فورًا" });
    await sleep(5);
    ok(C.last("chat").text === "يا سلام لعبٌ نظيف", "والثانيةُ فورًا تُبتلَع (حدُّ الإغراق)", C.last("chat").text);

    const room = SRV.rooms.get(t.code);
    room.settings && (room.settings._x = 1);
    await sleep(1600);
    A.fire("chat", { text: "شوف https://example.com" });
    await sleep(5);
    ok(C.last("chat").text !== "شوف https://example.com", "والرابط لا يمرّ");
    ok(/روابط/.test((A.last("err") || {}).msg || ""), "ويُقال له لماذا", A.last("err"));

    A.fire("quick", { id: "p1" });
    await sleep(5);
    let q = C.last("quick");
    ok(q && q.text && q.seat === 0, "والعبارة الجاهزة تصل", q);
    await sleep(1600);
    A.fire("quick", { id: "😂" });
    await sleep(5);
    q = C.last("quick");
    ok(q && q.emoji === true, "والإيموجي كذلك", q);
    await sleep(1600);
    const before = C.all("quick").length;
    A.fire("quick", { id: "لا-وجود-له" });
    await sleep(5);
    ok(C.all("quick").length === before, "ومعرّفٌ مخترَعٌ لا يصل");

    /* من دخل متأخّرًا يرى ما قيل */
    const D = conn("8.8.8.8");
    await ask(D, "join", { code: t.code });
    await sleep(5);
    ok(Array.isArray(D.last("chatLog")) && D.last("chatLog").length >= 1,
       "والداخلُ متأخّرًا يرى السجلّ", D.last("chatLog") && D.last("chatLog").length);
  }

  console.log("⑰ الهدايا");
  {
    const t = await table(2);
    const [A, C] = t.socks;
    const room = SRV.rooms.get(t.code);
    const uid = A.userId;
    wallets[uid] = { gold: 1000, gems: 0 };

    let r = await ask(A, "gift", { seat: 1, id: "rose" });
    ok(r && r.ok, "أُهديت وردة", r);
    ok(wallets[uid].gold === 950, "وخُصم ثمنُها", wallets[uid].gold);
    const g = C.last("gift");
    ok(g && g.from === 0 && g.to === 1, "ووصلت لكلّ الطاولة بمقعدَيها", g);
    ok(g.icon === "🌹", "ومعها رمزُها", g && g.icon);
    const sys = C.all("chat").filter(x => x.sys).pop();
    ok(sys && /أهدى/.test(sys.text), "وسطرٌ في الدردشة يشرحها", sys);

    r = await ask(A, "gift", { seat: 1, id: "rose" });
    ok(!r.ok && /تمهّل/.test(r.error), "ولا هديّتان متلاحقتان", r);
    await sleep(4100);

    r = await ask(A, "gift", { seat: 0, id: "rose" });
    ok(!r.ok, "ولا يُهدي نفسه", r);
    r = await ask(A, "gift", { seat: 9, id: "rose" });
    ok(!r.ok, "ولا مقعدًا لا وجود له", r);
    r = await ask(A, "gift", { seat: 1, id: "تنّين" });
    ok(!r.ok, "ولا هديّةً مخترَعة", r);

    wallets[uid] = { gold: 10, gems: 0 };
    r = await ask(A, "gift", { seat: 1, id: "crown" });
    ok(!r.ok, "ولا يُهدي ما لا يملك ثمنَه", r);
    ok(wallets[uid].gold === 10, "ورصيدُه لم يُمسّ", wallets[uid].gold);

    /* الهديّة تحرق ولا تنقل */
    wallets[uid] = { gold: 1000, gems: 0 };
    const toUid = C.userId;
    wallets[toUid] = { gold: 500, gems: 0 };
    await sleep(4100);
    r = await ask(A, "gift", { seat: 1, id: "coffee" });
    ok(r.ok, "أُهديت قهوة", r);
    ok(wallets[uid].gold === 850, "خُصمت من المُهدي", wallets[uid].gold);
    ok(wallets[toUid].gold === 500, "ولم تُضَف للمُهدى إليه — الهديّة تحرق ولا تنقل",
       wallets[toUid].gold);

    /* الضيف لا يُهدي */
    const Gst = conn("8.7.7.7");
    await ask(Gst, "join", { code: t.code });
    r = await ask(Gst, "gift", { seat: 0, id: "rose" });
    ok(!r.ok && /مسجَّلين/.test(r.error), "والضيف لا يُهدي", r);

    /* البوت لا يُهدى */
    A.fire("settings", { bots: true });
    A.fire("start");
    await sleep(40);
    const botSeat = room.seats.findIndex(p => p.bot);
    if (botSeat >= 0) {
      await sleep(4100);
      r = await ask(A, "gift", { seat: botSeat, id: "rose" });
      ok(!r.ok && /البوتات/.test(r.error), "ولا تُهدى البوتات", r);
    } else ok(true, "(لا بوت في الطاولة)");
  }

  console.log("⑱ إحصاءات حيّة");
  {
    const s = SRV.liveStats();
    ok(typeof s.rooms === "number" && typeof s.online === "number", "الإحصاءات الحيّة متاحة", s);
    ok(s.rooms >= 1, "وفيها طاولاتٌ مفتوحة", s.rooms);
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})();
