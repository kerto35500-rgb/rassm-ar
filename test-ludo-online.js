// اختبار خادم لودو: الغرف والمقاعد والإعدادات، والحجب لكلّ مقعد، والمباراة
// كاملةً بين بشرٍ وبوتات، والمؤقّت، والانقطاع والعودة، والدردشة.
//
// نحاكي socket.io في الذاكرة (كاختبار بالوت): أسرعُ ألف مرّة من مقابس
// حقيقيّة، وحتميّ — والمنطقُ الذي نختبره منطقُ الغرف لا منطقُ الشبكة.

const { setupLudoOnline, activeSlots } = require("./ludosrv");
const L = require("./ludorules");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));

class FS {
  constructor(nsp, id) { this.nsp = nsp; this.id = id; this.rooms = new Set([id]); this.h = {}; this.rx = []; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  emit(e, d) { this.rx.push({ e, d }); }
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
  connect() { const s = new FS(this, "s" + (++this.n)); this.sockets.set(s.id, s); this.cf.forEach(f => f(s)); return s; }
  drop(s) { this.sockets.delete(s.id); s.fire("disconnect"); }
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
}

const nsp = new FN();
const stats = [];
const store = { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } };
const api = setupLudoOnline({ of: () => nsp }, {
  store, botDelay: [1, 3], autoMoveMs: 2, graceMs: 150, secsScale: 0.004
});

/* لاعبٌ بشريّ آليّ: يردّ على حالته متى كان دورَه */
function autopilot(s, opts = {}) {
  let on = true;
  const tick = () => {
    if (!on) return;
    const v = s.last("state");
    if (v && v.phase !== "over") {
      const me = v.me;
      if (v.prompt && v.prompt.seat === me && v.prompt.options) {
        s.fire("choose", { choice: v.prompt.kind === "sacrifice" ? v.prompt.options[0] : v.prompt.options[0].id });
      } else if (v.turn === me && v.phase === "roll" && !opts.idle) s.fire("roll");
      else if (v.turn === me && v.phase === "move" && v.legal.length && !opts.idle) s.fire("move", { id: v.legal[0].id });
    }
    setTimeout(tick, 2);
  };
  tick();
  return () => { on = false; };
}
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(5); }
  return false;
}
/* إنهاءُ مباراةٍ **بلعبٍ حقيقيّ** لا باستدعاءٍ مباشر: نضع قطعَ اللاعب (وزميله)
   على بُعد خطوةٍ من الفوز ونحمّل النرد، ثمّ يرمي فيمرّ كلُّ شيءٍ في مسار
   الخادم الطبيعيّ — النهايةُ والجائزةُ والعودةُ إلى اللوبي. */
async function endByPlay(room, sock) {
  const m = room.match;
  const seat = m.seats.find(s => room.slots[s] && room.slots[s].sockId === sock.id);
  const team = m.rules.teams ? [seat, (seat + 2) % 4] : [seat];
  for (const t of team) for (let i = 0; i < 4; i++) { m.pieces[t][i].p = 56; m.pieces[t][i].cooldown = 0; }
  m.pieces[seat][3].p = 55;
  for (const t of m.seats) if (m.missions[t]) m.missions[t] = { id: "sixes", goal: 99, target: null };
  m.prompt = null; m.queue = []; m.turn = seat; m.phase = "roll"; m.dice = null; m.sixes = 0; m._loaded = [1];
  sock.fire("roll");
  return until(() => !room.match, 4000);
}

(async () => {
  console.log("\n═══ خادم لودو ═══\n");

  console.log("① الدخول والغرفة");
  const A = nsp.connect();
  const hi = A.last("hello");
  ok(hi && hi.defaults && hi.modes.length === 6, "الترحيب يحمل الإعدادات والأوضاع الستّة", hi && hi.modes);
  let r = await A.ask("createRoom", { name: "سعود" });
  ok(r.ok && /^\d{5}$/.test(r.roomId) && r.token, "أُنشئت غرفةٌ برمزٍ من خمسة أرقام", r);
  const code = r.roomId;
  let lob = A.last("lobby");
  ok(lob.slots[0] && lob.slots[0].name === "سعود" && lob.host === lob.slots[0].id, "المنشئ في المقعد الأحمر وهو المضيف");

  const B = nsp.connect();
  r = await B.ask("joinRoom", { name: "فهد", roomId: code });
  ok(r.ok, "انضمّ ثانٍ", r);
  lob = B.last("lobby");
  ok(lob.slots[1] && lob.slots[1].name === "فهد", "في أوّل مقعدٍ فارغ");
  r = await nsp.connect().ask("joinRoom", { name: "x", roomId: "99999" });
  ok(!r.ok, "رمزٌ غير موجود يُردّ");

  console.log("② الإعدادات والمقاعد");
  B.fire("updateSettings", { mode: "rush" });
  eq(A.last("lobby").settings.mode, "classic", "غيرُ المضيف لا يغيّر الإعدادات");
  A.fire("updateSettings", { mode: "night", powerups: true, powerCount: 99, turnSecs: 7 });
  lob = A.last("lobby");
  ok(lob.settings.mode === "night" && lob.settings.powerups, "المضيف يغيّر الوضع ويفعّل المعزّزات");
  ok(lob.settings.powerCount === 4 && lob.settings.turnSecs === 15, "وقيمةٌ خارج مداها تُتجاهَل");
  A.fire("updateSettings", { players: 2 });
  lob = A.last("lobby");
  eq(lob.active, [0, 2], "لاعبان ⇒ المقعدان المتقابلان");
  ok(lob.slots[2] && lob.slots[2].name === "فهد" && !lob.slots[1], "ومن جلس في مقعدٍ خرج عن اللعب يُنقَل");
  A.fire("updateSettings", { teams: true });
  lob = A.last("lobby");
  ok(lob.settings.players === 4 && lob.active.length === 4, "الفرق تفرض أربعة مقاعد");
  B.fire("sit", { slot: 1 });
  ok(A.last("lobby").slots[1] && A.last("lobby").slots[1].name === "فهد", "اللاعب ينتقل إلى مقعدٍ فارغ (يختار لونه وفريقه)");
  B.fire("sit", { slot: 0 });
  ok(A.last("lobby").slots[0].name === "سعود", "ولا يأخذ مقعدًا مشغولًا");
  /* المضيفُ يمنع أنواعًا من المعزّزات */
  eq(A.last("lobby").settings.powerTypes, ["gold", "jump", "bubble", "wind", "swap"], "المعزّزاتُ كلُّها مسموحةٌ افتراضًا");
  A.fire("updateSettings", { powerTypes: ["swap", "zzz", "gold"] });
  eq(A.last("lobby").settings.powerTypes, ["gold", "swap"], "يختار المضيفُ أنواعَها (والمجهولُ يُتجاهَل)");
  A.fire("updateSettings", { powerTypes: [] });
  eq(A.last("lobby").settings.powerTypes, ["gold", "swap"], "والقائمةُ الفارغة لا تُقبل — يبقى نوعٌ على الأقلّ");
  B.fire("updateSettings", { powerTypes: ["jump"] });
  eq(A.last("lobby").settings.powerTypes, ["gold", "swap"], "وغيرُ المضيف لا يغيّرها");
  A.fire("updateSettings", { mode: "classic", powerups: true, powerCount: 6 });
  A.fire("startGame");
  {
    const mm = api.rooms.get(code).match;
    ok(mm && mm.rules.powerTypes.join() === "gold,swap" && mm.powerups.every(p => p.type === "gold" || p.type === "swap"),
       "والمباراةُ لا يظهر فيها إلا المسموح", mm && mm.powerups.map(p => p.type));
    ok(A.last("state").rules.powerTypes.join() === "gold,swap", "والقواعدُ في الحالة تحمل الأنواع (للقواعد في الواجهة)");
    const rm = api.rooms.get(code);
    await endByPlay(rm, A);
  }
  A.fire("updateSettings", { teams: false, players: 4, mode: "classic", powerups: false, powerTypes: ["gold", "jump", "bubble", "wind", "swap"] });

  console.log("③ البداية والحجب لكلّ مقعد");
  A.fire("updateSettings", { mode: "missions", teams: true });
  A.fire("startGame");
  ok(api.rooms.get(code).match, "بدأت المباراة والبوتات تملأ الفراغ");
  ok(A.last("started") && A.last("started").players.filter(p => p && p.bot).length === 2, "بوتان في المقعدين الفارغين");
  let sa = A.last("state"), sb = B.last("state");
  ok(sa && sb && sa.me === 0 && sb.me === 1, "لكلّ لاعبٍ حالتُه بمقعده");
  ok(!sa.missions[0].hidden && sa.missions[2] && !sa.missions[2].hidden, "يرى مهمّتَه ومهمّةَ زميله");
  ok(sa.missions[1].hidden && sa.missions[3].hidden, "ومهامُّ الخصمين مخفيّة عنه");
  ok(sb.missions[1].text && sb.missions[0].hidden, "والخصمُ كذلك لا يرى مهمّته");
  const room = api.rooms.get(code);
  await endByPlay(room, A);
  ok(!room.match, "النهاية تعيد الغرفة إلى اللوبي");
  ok(A.last("matchEnd") && A.last("matchEnd").names.length === 2, "ونتيجةٌ بأسماء الفائزين", A.last("matchEnd"));
  ok(A.last("lobby").slots.filter(Boolean).every(p => !p.bot), "والبوتات تُزال من المقاعد");

  console.log("④ الظلام: لا يغادر الخادمَ موضعٌ مخفيّ");
  A.fire("updateSettings", { mode: "night", teams: false, players: 4 });
  A.fire("startGame");
  const m = room.match;
  /* ضع قطعةً لكلٍّ بعيدةً عن الأخرى ثمّ حرّك شيئًا كي تُرسَل الحالة */
  m.pieces[0][0].p = 5; m.pieces[2][0].p = (40 - 26 + 52) % 52;
  m.turn = 0; m.phase = "roll"; m._loaded = [1];
  const nState = A.all("state").length;
  A.fire("roll");
  await until(() => A.all("state").length > nState);
  sa = A.last("state");
  ok(sa.rules.mode === "night", "(المباراة الجديدة في وضع الظلام)", sa.rules);
  const seen = sa.pieces[2][0];
  ok(seen.hidden && !("p" in seen), "قطعةُ الخصم البعيدة تصل بلا موضع", seen);
  ok(Array.isArray(sa.visible) && !sa.visible.includes(40), "وقائمةُ المرئيّ لا تشمل موضعها");
  const json = JSON.stringify(A.rx.filter(x => x.e === "state").slice(-1));
  ok(!json.includes("_see"), "ولا حقلَ داخليّ يتسرّب في الرسالة");
  await endByPlay(room, A);

  console.log("⑤ مباراةٌ كاملة: بشرٌ آليّون وبوتات حتى النهاية");
  for (const mode of ["classic", "rush", "master", "king"]) {
    A.fire("updateSettings", { mode, teams: mode === "king", powerups: mode !== "rush", players: 4 });
    const n0 = A.all("matchEnd").length;
    const stopA = autopilot(A), stopB = autopilot(B);
    A.fire("startGame");
    const done = await until(() => A.all("matchEnd").length > n0, 60000);
    stopA(); stopB();
    const end = A.last("matchEnd");
    ok(done && end && end.mode === mode && end.seats.length >= 1, `${L.MODE_AR[mode]}: انتهت بفائز`, end && { reason: end.reason, seats: end.seats });
  }
  ok(stats.length === 0, "الضيوف (بلا حساب) لا تُسجَّل لهم إحصاءات");

  console.log("⑥ المؤقّت: من لا يلعب يُلعَب عنه");
  A.fire("updateSettings", { mode: "classic", teams: false, players: 2, powerups: false, turnSecs: 10 });
  A.fire("startGame");
  /* لا أحدَ يلعب: المؤقّتُ وحده يدفع المباراة */
  const before = room.match.rolls;
  await until(() => room.match && room.match.rolls >= before + 3, 3000);
  ok(room.match && room.match.rolls >= before + 3, "مرّ الوقت فرُمي عن الغائبين ولم يتجمّد الدور", room.match && room.match.rolls);
  ok(A.all("state").some(s => s.events && s.events.some(e => e.t === "timeout" && e.seat === 0)),
     "ويُعلَن ذلك (حدث timeout باسم صاحبه)");
  {
    /* وضعُ AUTO (من المرجع: SYSTEM_TRUST): من انقضى وقتُه يلعب عنه البوتُ
       **أدوارَه كلَّها** بسرعة حتى يلمس الشاشة أو يلعب. مهلةٌ واحدةٌ إذن — لا
       مهلةٌ لكلّ خطوة (كان الغائبُ يكلّف الطاولة أربعَ مهلٍ في الدور الواحد)
       ولا لكلّ دور. */
    const m = room.match;
    const freeze = () => {
      for (const k of ["timer", "botT", "autoT"]) { if (room[k]) clearTimeout(room[k]); room[k] = null; }
    };
    freeze();
    for (const p of room.slots) if (p) p.auto = false;
    for (const s of m.seats) m.pieces[s].forEach(pc => { pc.p = -1; pc.shield = 0; pc.cooldown = 0; });
    m.pieces[0][0].p = 5; m.pieces[0][1].p = 20;          /* حركاتٌ غيرُ متكافئة: لا تحريكَ تلقائيّ */
    const other = m.seats.find(s => s !== 0);
    m.prompt = null; m.queue = []; m.after = null; m.legal = []; m.pool = [];
    m.turn = other; m.phase = "roll"; m.dice = null;
    m._loaded = [1, 6, 2];          /* الخصم ١ (لا حركة) ثمّ الغائب ٦ فرميةٌ أخرى ٢ ⇒ بركتُه ٦ و٢ */
    const sOther = [...nsp.sockets.values()].find(s => room.slots[other] && room.slots[other].sockId === s.id);
    const n0 = A.all("state").length, rolls0 = m.rolls;
    sOther.fire("roll");
    const passed = await until(() => m.turn === other && m.rolls >= rolls0 + 3, 3000);
    const evs = A.all("state").slice(n0).flatMap(s => s.events || []);
    const outs = evs.filter(e => e.t === "timeout" && e.seat === 0).length;
    ok(passed && outs === 1, "الغائب: مهلةٌ واحدةٌ ثمّ يُكمل البوتُ دورَه كلَّه (ستّةٌ فرميةٌ أخرى ثمّ رقما البركة)",
       { passed, outs, rolls: m.rolls - rolls0 });
    ok(evs.filter(e => e.t === "move" && e.owner === 0).length === 2, "وأُنفق رقما بركته في حركتين", evs.map(e => e.t));
    ok(room.slots[0].auto === true, "ويبقى في وضع AUTO بعد دوره (كالمرجع)", room.slots[0].auto);
    ok(A.last("state").players[0].auto === true && B.last("state").players[0].auto === true,
       "وشارتُه يراها الجميع");

    /* دورُه التالي يُلعَب عنه فورًا: لا مهلةَ جديدةَ ولا حدثَ انقضاءٍ ثانٍ */
    freeze();
    m.turn = other; m.phase = "roll"; m.pool = []; m.legal = []; m._loaded = [1, 3];
    const n1 = A.all("state").length;
    sOther.fire("roll");
    const went = await until(() => A.all("state").slice(n1).flatMap(s => s.events || []).some(e => e.t === "move" && e.owner === 0), 2000);
    const evs2 = A.all("state").slice(n1).flatMap(s => s.events || []);
    ok(went && !evs2.some(e => e.t === "timeout" && e.seat === 0), "ودورُه التالي يُلعَب عنه فورًا بلا مهلةٍ جديدة", evs2.map(e => e.t));

    /* لمسُ الشاشة يعيده إلى يده، ويبدأ مؤقّتُه إن كان الدورُ دوره */
    freeze();
    m.turn = 0; m.phase = "roll"; m.pool = []; m.legal = [];
    A.fire("manual");
    ok(room.slots[0].auto === false, "ولمسُ الشاشة («manual») يُعيده إلى يده (المرجع: SYSTEM_TRUST_CANCEL)");
    ok(room.deadline > Date.now() && !!room.timer, "ودورُه الآن ينتظره بمؤقّتٍ لا ببوت", { deadline: room.deadline, timer: !!room.timer });
    ok(A.last("state").players[0].auto === false, "وتختفي الشارة عند الجميع");

    /* حركةٌ وحيدة تُلعَب عنه بعد لحظة؛ ونقرتُه التي وصلت بعدها لا تعود بخطأ
       «ليس دورك في التحريك» (كان يظهر حين ينقر القطعةَ المتوهّجة) */
    freeze();
    for (const s of m.seats) m.pieces[s].forEach(pc => { pc.p = -1; });
    m.pieces[0][0].p = 10;
    m.turn = 0; m.phase = "roll"; m.pool = []; m.legal = []; m._loaded = [3];
    const t0 = A.all("toast").length;
    A.fire("roll");
    ok(await until(() => m.pieces[0][0].p === 13, 1000), "حركةٌ وحيدة ⇒ لُعبت عنه تلقائيًّا");
    A.fire("move", { id: 0 });
    await sleep(20);
    ok(A.all("toast").length === t0, "ونقرتُه المتأخّرة تُتجاهَل بلا رسالة خطأ", A.all("toast").slice(t0));
    /* لكنّ الخطأَ الحقيقيّ يبقى: نقرٌ في دور غيره بلا حركةٍ آليّة قريبة */
    freeze(); room.lastAuto = null;
    m.turn = m.seats.find(s => s !== 0); m.phase = "roll";
    A.fire("move", { id: 0 });
    ok(A.all("toast").length === t0 + 1 && /ليس دورك/.test(A.last("toast")), "والنقرُ في دور غيره يبقى خطأً ظاهرًا", A.last("toast"));
  }

  console.log("⑦ الانقطاع والعودة");
  const tokA = (await (async () => { return null; })()) || null;
  const before2 = room.match ? room.match.seats.slice() : [];
  const slot0 = room.slots[0];
  const myToken = slot0.token;
  nsp.drop(A);
  await sleep(20);
  ok(room.slots[0] && room.slots[0].gone && !room.slots[0].bot, "منقطعٌ في مهلته: مقعدُه محجوزٌ له");
  const A2 = nsp.connect();
  r = await A2.ask("rejoin", { roomId: code, token: myToken });
  ok(r.ok && r.resumed && room.slots[0] === slot0 && !slot0.gone, "يعود بمقعده ورمزه", r);
  ok(A2.last("state") && A2.last("state").me === 0, "ويأخذ حالةَ المباراة فورًا");
  nsp.drop(A2);
  await sleep(250);
  ok(room.slots[0].bot && /\(بوت\)/.test(room.slots[0].name), "بعد المهلة يصير مقعدُه بوتًا");
  ok(!/\(بوت\) \(بوت\)/.test(room.slots[0].name), "انقطاعٌ فعودةٌ فانقطاعٌ ثانٍ لا يحوّل المقعد مرّتين", room.slots[0].name);
  const A3 = nsp.connect();
  r = await A3.ask("rejoin", { roomId: code, token: myToken });
  ok(r.ok && !room.slots[0].bot && room.slots[0].name === "سعود", "ويستردّه إن عاد قبل نهاية المباراة", { r, slot: room.slots[0] && { name: room.slots[0].name, bot: room.slots[0].bot, gone: room.slots[0].gone }, match: !!room.match });
  if (room.match) await endByPlay(room, A3);

  console.log("⑧ الدردشة والطرد");
  A3.fire("chat", { text: "يلا نلعب 🎲" });
  ok(B.last("chat") && B.last("chat").text === "يلا نلعب 🎲", "الرسالة تصل للغرفة");
  await sleep(750);
  A3.fire("chat", { text: "ادخلوا www.spam.com" });
  ok(B.last("chat").text === "يلا نلعب 🎲" && A3.last("toast"), "والروابط تُمنع بتنبيهٍ لصاحبها");
  const hostNow = room.hostId === room.slots.find(p => p && p.name === "سعود").id ? A3 : B;
  const other = hostNow === A3 ? B : A3;
  const otherId = room.slots.find(p => p && p.sockId === other.id).id;
  hostNow.fire("kick", { id: otherId });
  ok(other.last("kicked") !== null && !room.slots.some(p => p && p.id === otherId), "المضيف يطرد");

  console.log("⑨ الإحصاءات المسجَّلة بلا ذهب");
  {
    const s = nsp.connect();
    s.userId = 77; s._authDone = true; s.userName = "مسجّل";
    const rr = await s.ask("createRoom", { name: "?" });
    ok(rr.ok && api.rooms.get(rr.roomId).slots[0].name === "مسجّل", "المسجَّل يلعب باسم حسابه");
    const rm = api.rooms.get(rr.roomId);
    s.fire("updateSettings", { mode: "rush", players: 2 });
    const stop = autopilot(s);
    s.fire("startGame");
    await until(() => !rm.match && stats.length > 0, 60000);
    stop();
    ok(stats.some(x => x.u === 77 && x.g === "ludo" && x.games === 1), "تُسجَّل مباراتُه في إحصاءات «ludo»", stats);
  }

  console.log("⑩ الخروجُ من مباراةٍ جارية ثمّ العودةُ إليها");
  {
    /* وحيدٌ مع البوتات يخرج: كانت الغرفةُ تُحذف فورًا فيجد «الغرفة انتهت» */
    const s = nsp.connect();
    const rr = await s.ask("createRoom", { name: "عمر" });
    const rm = api.rooms.get(rr.roomId);
    s.fire("updateSettings", { players: 4, mode: "classic" });
    s.fire("startGame");
    ok(!!rm.match, "مباراةٌ مع ثلاثة بوتات");
    const tok = rr.token;
    nsp.drop(s);
    await sleep(260);
    ok(api.rooms.has(rr.roomId) && !!rm.match, "خرج البشريُّ الوحيد: الغرفةُ والمباراةُ باقيتان");
    ok(rm.paused && !rm.timer && !rm.botT && !rm.autoT, "والمباراةُ متوقّفة — لا تُكملها البوتاتُ وحدها",
       { paused: rm.paused, t: !!rm.timer, b: !!rm.botT });
    const mn = rm.match.moveNo;
    await sleep(60);
    eq(rm.match.moveNo, mn, "لا حركةَ في غيابه");

    const s2 = nsp.connect();
    let j = await s2.ask("rejoin", { roomId: rr.roomId, token: tok });
    ok(j.ok && j.resumed && rm.slots[0].sockId === s2.id && !rm.slots[0].bot && rm.slots[0].name === "عمر",
       "يعود برمز جهازه إلى مقعده باسمه", { j, slot: rm.slots[0] && { n: rm.slots[0].name, b: rm.slots[0].bot } });
    ok(!rm.paused && !!(rm.timer || rm.botT || rm.autoT), "وتُستأنف المباراة");

    /* من متصفّحٍ آخر (بلا رمز): يعود باسمه — والغريبُ لا يدخل */
    nsp.drop(s2);
    await sleep(260);
    const s3 = nsp.connect();
    j = await s3.ask("joinRoom", { name: "غريب", roomId: rr.roomId });
    ok(!j.ok && /جارية/.test(j.error || ""), "غريبٌ لا يدخل مباراةً جارية", j);
    j = await s3.ask("joinRoom", { name: "  عمر ", roomId: rr.roomId });
    ok(j.ok && j.resumed && rm.slots[0].sockId === s3.id && rm.slots[0].name === "عمر" && !rm.slots[0].bot,
       "ومن متصفّحٍ آخر بلا رمز يعود باسمه إلى مقعده", j);
    ok(s3.last("state") && s3.last("state").me === 0, "ويأخذ حالةَ المباراة فورًا");

    /* جلستُه القديمة ما زالت متّصلة (تبويبٌ آخر): الجديدةُ تتسلّم المقعد */
    const s4 = nsp.connect();
    j = await s4.ask("joinRoom", { name: "؟", roomId: rr.roomId, token: tok });
    ok(j.ok && rm.slots[0].sockId === s4.id, "رمزُ جهازه في تبويبٍ ثانٍ يتسلّم المقعد (كان «الجلسة مفتوحةٌ في مكانٍ آخر» يمسح رمزَه)", j);
    ok(s3.all("replaced").length === 1 && !nsp.sockets.has(s3.id), "والجلسةُ القديمة تُخبَر وتُغلَق");
    ok(!rm.slots[0].gone && !rm.slots[0].bot && rm.slots[0].sockId === s4.id, "ولا يمسّ خروجُها المقعد");
    const s5 = nsp.connect();
    j = await s5.ask("joinRoom", { name: "عمر", roomId: rr.roomId });
    ok(!j.ok && rm.slots[0].sockId === s4.id, "والاسمُ وحده لا ينتزع مقعدَ لاعبٍ حاضر", j);
    ok(await endByPlay(rm, s4), "وتكتمل المباراةُ بعد العودة");
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
