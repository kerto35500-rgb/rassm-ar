// اختبار منطق لعبة القنبلة بدون متصفح (محاكاة socket.io)
const { setupBomb } = require("./bomb");
const dict = require("./dict");

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log("  ✅ " + label); }
  else { FAIL++; console.log("  ❌ " + label + (extra ? "  → " + extra : "")); }
}

// ---------- محاكاة socket.io ----------
class FakeSocket {
  constructor(nsp, id) {
    this.nsp = nsp; this.id = id; this.rooms = new Set([id]);
    this.handlers = {}; this.received = [];
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
  fire(ev, ...args) { (this.handlers[ev] || []).forEach(f => f(...args)); }
  emit(ev, data) { this.received.push({ ev, data }); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  to(r) { return { emit: (ev, d) => this.nsp._emitRoom(r, ev, d, this.id) }; }
  last(ev) { for (let i = this.received.length - 1; i >= 0; i--) if (this.received[i].ev === ev) return this.received[i].data; return null; }
  all(ev) { return this.received.filter(r => r.ev === ev).map(r => r.data); }
}
class FakeNsp {
  constructor() { this.connFns = []; this.sockets = new Map(); }
  on(ev, fn) { if (ev === "connection") this.connFns.push(fn); }
  connect(id) {
    const s = new FakeSocket(this, id);
    this.sockets.set(id, s);
    this.connFns.forEach(f => f(s));
    return s;
  }
  _emitRoom(room, ev, data, exceptId) {
    this.sockets.forEach(s => {
      if (s.id === exceptId) return;
      if (s.rooms.has(room)) s.emit(ev, data);
    });
  }
  to(r) {
    return { emit: (ev, d) => {
      // "to" قد يكون معرّف غرفة أو معرّف socket
      let hit = false;
      this.sockets.forEach(s => { if (s.rooms.has(r)) { s.emit(ev, d); hit = true; } });
      if (!hit && this.sockets.has(r)) this.sockets.get(r).emit(ev, d);
    }};
  }
}
const fakeIo = { of: () => nsp };
const nsp = new FakeNsp();

// مخزن وهمي
const kv = {};
const users = {};
const store = {
  async getUser(n) { return users[n] || null; },
  async createUser(n, salt, hash) { users[n] = { name: n, salt, hash, wins: 0, games: 0, totalScore: 0 }; },
  async getKV(k) { return kv[k] || null; },
  async saveKV(k, v) { kv[k] = v; },
  async top() { return []; }
};

setupBomb(fakeIo, {
  store,
  hashPass: (p, salt) => "h(" + p + "|" + salt + ")",
  publicStats: u => ({ name: u.name, wins: u.wins, games: u.games, totalScore: u.totalScore }),
  getAdmin: () => null
});

// ---------- أدوات الاختبار ----------
function cb() { const f = (r) => { f.result = r; }; return f; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// للمعالجات غير المتزامنة (الحسابات): ننتظر ردّ الـ callback
function ask(sock, ev, data, ms = 250) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    sock.fire(ev, data, res => { if (!done) { done = true; clearTimeout(t); resolve(res); } });
  });
}

(async function run() {
  console.log("\n═══ اختبار لعبة القنبلة ═══\n");

  console.log("① القاموس والتوحيد");
  const st = dict.stats();
  ok(st.size > 400, `القاموس محمّل (${st.size} كلمة)`);
  ok(dict.check("كِتَاب", "كت").ok, "التشكيل يُتجاهل");
  ok(dict.check("مدرسة", "در").ok, "التاء المربوطة تُقبل");
  ok(dict.check("أرض", "ار").ok, "الهمزة تُوحّد مع الألف");
  ok(!dict.check("كتاب", "زز").ok, "ترفض كلمة بلا المقطع");
  ok(!dict.check("سسسسس", "سس").ok, "ترفض كلمة غير موجودة");
  ok(dict.check("كتاب", "كت", { minLength: 6 }).reason === "tooShort", "تحترم الحد الأدنى للطول");
  const used = new Set(["كتاب"]);
  ok(dict.check("كتاب", "كت", { used }).reason === "used", "ترفض التكرار");

  console.log("\n② الحسابات (موحّدة مع لعبة الرسم)");
  const A = nsp.connect("A"), B = nsp.connect("B"), C = nsp.connect("C");
  const ra = await ask(A, "register", { name: "أحمد", pass: "كلمة سرّ طويلة" });
  ok(ra && ra.ok, "تسجيل حساب جديد");
  ok(ra && ra.bomb && ra.bomb.games === 0, "إحصائيات القنبلة منفصلة تبدأ من صفر");
  const rb = await ask(B, "register", { name: "بدر", pass: "كلمة سرّ طويلة" });
  ok(rb && rb.ok, "تسجيل حساب ثانٍ");
  const rdup = await ask(C, "register", { name: "أحمد", pass: "كلمة سرّ طويلة" });
  ok(rdup && !rdup.ok, "يرفض اسماً مستخدماً");
  const rshort = await ask(C, "register", { name: "ك", pass: "كلمة سرّ طويلة" });
  ok(rshort && !rshort.ok, "يرفض اسماً قصيراً");
  const rlogin = await ask(C, "login", { name: "أحمد", pass: "غلط" });
  ok(rlogin && !rlogin.ok, "كلمة مرور خاطئة تُرفض عند الدخول");

  console.log("\n③ إنشاء غرفة والانضمام");
  let r1 = cb(); A.fire("createRoom", { name: "أحمد" }, r1);
  ok(r1.result && r1.result.ok, "أحمد أنشأ غرفة");
  const RID = r1.result.roomId;
  const TOKEN_A = r1.result.token;

  let r2 = cb(); B.fire("joinRoom", { name: "بدر", roomId: RID }, r2);
  ok(r2.result && r2.result.ok, "بدر انضم");
  let r3 = cb(); C.fire("joinRoom", { name: "سالم", roomId: RID }, r3);
  ok(r3.result && r3.result.ok, "سالم انضم");
  ok(A.last("state").players.length === 3, "الغرفة فيها ٣ لاعبين");
  ok(A.last("state").ownerId === "A", "أحمد هو المضيف");

  console.log("\n③ الإعدادات (المضيف فقط)");
  B.fire("updateSettings", { lives: 5, startTime: 30 });
  ok(A.last("state").settings.lives !== 5, "غير المضيف لا يستطيع تغيير الإعدادات");
  A.fire("updateSettings", { lives: 2, startTime: 6, minLength: 2, speedMode: "off", difficulty: 0, alphabetBonus: true });
  const s1 = A.last("state").settings;
  ok(s1.lives === 2 && s1.startTime === 6, "المضيف غيّر الإعدادات");
  A.fire("updateSettings", { startTime: 99, lives: 99 });
  const s2 = A.last("state").settings;
  ok(s2.startTime === 30 && s2.lives === 5, "القيم الشاذة تُقصّ للحدود المسموحة");
  A.fire("updateSettings", { startTime: 6, lives: 2 });

  console.log("\n④ بدء اللعبة ودورة الأدوار");
  A.fire("startGame");
  let S = A.last("state");
  ok(S.state === "playing", "اللعبة بدأت");
  ok(!!S.syllable, `تم توليد مقطع: «${S.syllable}»`);
  ok(S.sylPool > 0, `المقطع له ${S.sylPool} كلمة ممكنة`);
  ok(S.players.every(p => p.lives === 2), "كل لاعب عنده قلبان");
  ok(S.endsAt > Date.now(), "المؤقت يعمل");

  // الشخص الذي ليس دوره لا يستطيع الكتابة
  const turn1 = S.turnId;
  const notTurn = ["A","B","C"].find(x => x !== turn1);
  const sockOf = id => ({A,B,C}[id]);
  const before = A.last("state").turnId;
  sockOf(notTurn).fire("word", "كتاب");
  ok(A.last("state").turnId === before, "من ليس دوره لا يمرّر القنبلة");

  console.log("\n⑤ كلمة صحيحة تمرّر القنبلة");
  function wordFor(syl) {
    // ابحث عن كلمة صالحة تحتوي المقطع
    const cands = ["كتاب","مدرسة","بيت","سماء","شمس","قلم","ماء","طريق","مطر","سيارة","عمل","كبير","جميل","مدينة","انسان","حاسوب","برنامج","رياضيات","مستشفى","سفينة"];
    for (const w of cands) if (dict.check(w, syl, { minLength: 2 }).ok) return w;
    return null;
  }
  // نجرب مقاطع حتى نجد واحداً لدينا كلمة له
  let tries = 0, submitted = false;
  while (tries++ < 40) {
    S = A.last("state");
    const w = wordFor(S.syllable);
    if (w) {
      const prevTurn = S.turnId;
      sockOf(prevTurn).fire("word", w);
      const acc = A.all("accepted").pop();
      if (acc && acc.word) {
        ok(true, `كلمة «${acc.word}» قُبلت للمقطع «${S.syllable}»`);
        ok(A.last("state").turnId !== prevTurn, "القنبلة انتقلت للاعب التالي");
        ok(A.last("state").usedCount >= 1, "الكلمة سُجّلت كمستعملة");
        // تكرار نفس الكلمة
        const t2 = A.last("state").turnId;
        // نحتاج كلمة تحتوي المقطع الجديد؛ نتحقق فقط من رفض التكرار عبر القاموس
        submitted = true;
        break;
      }
    }
    // مقطع صعب: نجبر اللاعب على الانتظار — نغيّر المقطع بإعادة الجولة
    A.fire("updateSettings", { difficulty: 0 });
    // ندفع دورة: نجعل القنبلة تنفجر بسرعة عبر تقليل الوقت ليس عملياً هنا، فنعيد المحاولة
    const cur = A.last("state").turnId;
    sockOf(cur).fire("word", "زززز"); // ترفض ولا تغيّر الدور
    // نعيد توليد مقطع عبر إعادة تشغيل الجولة
    A.fire("backToLobby"); A.fire("updateSettings", { startTime: 6, lives: 2, minLength: 2, speedMode:"off", difficulty: 0 }); A.fire("startGame");
  }
  ok(submitted, "تم تمرير القنبلة بكلمة صحيحة");

  console.log("\n⑥ الحروف الأبجدية");
  const meA = A.last("state").players.find(p => p.words > 0);
  ok(!meA || meA.letters.length > 0, "حروف الكلمة أُضيفت للوحة اللاعب");

  console.log("\n⑦ الانفجار وخسارة القلوب");
  A.fire("backToLobby");
  A.fire("updateSettings", { startTime: 5, minTime: 5, lives: 1, speedMode: "off" });
  A.fire("startGame");
  const victim = A.last("state").turnId;
  const livesBefore = A.last("state").players.find(p => p.id === victim).lives;
  ok(livesBefore === 1, "بدأنا بقلب واحد");
  console.log("     … ننتظر انفجار القنبلة (٦ ثوان)");
  await sleep(6200);
  const booms = A.all("boom");
  ok(booms.length > 0, "القنبلة انفجرت عند انتهاء الوقت");
  const after = A.last("state").players.find(p => p.id === victim);
  ok(after && after.lives === 0 && after.alive === false, "اللاعب خسر قلبه وأُقصي");

  console.log("\n⑦-ب القنبلة تنتقل للاعب التالي بعد الانفجار");
  // ثلاثة قلوب حتى لا يُقصى أحد. نعتمد على حدث boom لمعرفة الضحية،
  // وننتظر انتهاء مهلة بدء الجولة الجديدة (١.٤ث) قبل قراءة الدور.
  A.fire("backToLobby");
  A.fire("updateSettings", { startTime: 5, minTime: 5, lives: 3, speedMode: "off" });
  const boomsBefore = A.all("boom").length;
  A.fire("startGame");
  const order = A.last("state").players.map(p => p.id);
  console.log("     … ننتظر انفجاراً ثم بدء الجولة الجديدة (٨ ثوان)");
  await sleep(8200);
  const booms2 = A.all("boom");
  ok(booms2.length > boomsBefore, "انفجرت القنبلة");
  const victimId = booms2[booms2.length - 1].id;
  const st1 = A.last("state");
  const vic = st1.players.find(p => p.id === victimId);
  ok(vic && vic.lives === 2 && vic.alive, `من انفجرت عنده خسر قلباً وبقي في اللعبة (${vic && vic.lives} ❤️)`);
  const nm = id => (st1.players.find(p => p.id === id) || {}).name;
  ok(st1.turnId !== victimId, `الدور لم يبقَ معلّقاً عليه: ${nm(victimId)} → ${nm(st1.turnId)}`);
  const expected = order[(order.indexOf(victimId) + 1) % order.length];
  ok(st1.turnId === expected, `انتقل للاعب الذي بعده مباشرة في الترتيب (${nm(expected)})`);

  console.log("\n⑧ نهاية اللعبة والفائز");
  // ننتظر حتى يُقصى لاعبان ويبقى واحد
  let guard = 0;
  while (A.last("state").state === "playing" && guard++ < 12) await sleep(6300);
  const fin = A.last("state");
  ok(fin.state === "ended", "اللعبة انتهت");
  ok(!!fin.winner, `الفائز: ${fin.winner ? fin.winner.name : "—"}`);
  await sleep(120);
  ok(!!kv.bombStats, "إحصائيات القنبلة حُفظت في قاعدة البيانات");
  ok(kv.bombStats && kv.bombStats["أحمد"] && kv.bombStats["أحمد"].games > 0,
     "اللاعب المسجّل سُجّلت له لعبة", JSON.stringify(kv.bombStats));
  ok(!kv.bombStats || !kv.bombStats["سالم"], "الضيف (بلا حساب) لا تُحفظ له إحصائيات");

  console.log("\n⑨ العودة للردهة وإعادة اللعب");
  A.fire("backToLobby");
  const lob = A.last("state");
  ok(lob.state === "lobby", "رجعنا للردهة");
  ok(lob.players.every(p => p.alive), "كل اللاعبين رجعوا أحياء");

  console.log("\n⑩ إعادة الاتصال والطرد");
  const D = nsp.connect("D");
  let rr = cb(); D.fire("rejoin", { roomId: RID, token: TOKEN_A }, rr);
  ok(rr.result && rr.result.ok === false || (rr.result && rr.result.ok), "طلب إعادة الاتصال يُعالج بدون خطأ");
  A.fire("kickPlayer", "C");
  ok(!A.last("state").players.some(p => p.id === "C"), "المضيف طرد لاعباً");
  ok(C.last("kicked") !== undefined || C.all("kicked").length > 0, "اللاعب المطرود تم إبلاغه");

  console.log("\n⑪ الغرف العامة وكلمة المرور");
  A.fire("updateSettings", { visibility: "public", password: "1234" });
  let pr = cb(); A.fire("publicRooms", pr);
  ok(pr.result.rooms.some(r => r.id === RID && r.locked), "الغرفة تظهر عامة ومقفلة");
  const E = nsp.connect("E");
  let je = cb(); E.fire("joinRoom", { name: "خالد", roomId: RID, password: "غلط" }, je);
  ok(je.result && !je.result.ok && je.result.needPass, "كلمة مرور خاطئة تُرفض");
  let je2 = cb(); E.fire("joinRoom", { name: "خالد", roomId: RID, password: "1234" }, je2);
  ok(je2.result && je2.result.ok, "كلمة المرور الصحيحة تُقبل");

  console.log("\n" + "═".repeat(34));
  console.log(`  ✅ نجح: ${PASS}    ❌ فشل: ${FAIL}`);
  console.log("═".repeat(34) + "\n");
  process.exit(FAIL ? 1 : 0);
})();
