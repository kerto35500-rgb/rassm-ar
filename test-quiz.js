// اختبار منطق «قمّة الهرم» — محرك يلعب مباراة كاملة تلقائياً ويسجّل لقطات لكل مرحلة
// التشغيل:  QUIZ_TEST_FAST=1 node test-quiz.js
const { setupQuiz } = require("./quiz");
const qbank = require("./qbank");

let PASS = 0, FAIL = 0;
const ok = (c, l, x) => { c ? (PASS++, console.log("  ✅ " + l)) : (FAIL++, console.log("  ❌ " + l + (x ? "  → " + x : ""))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- محاكاة socket.io ----------
class FS {
  constructor(nsp, id) { this.nsp = nsp; this.id = id; this.rooms = new Set([id]); this.h = {}; this.rx = []; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  emit(e, d) { this.rx.push({ e, d }); (this._spy || []).forEach(fn => fn(e, d)); }
  spy(fn) { (this._spy = this._spy || []).push(fn); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  to(r) { return { emit: (e, d) => this.nsp._room(r, e, d, this.id) }; }
  last(e) { for (let i = this.rx.length - 1; i >= 0; i--) if (this.rx[i].e === e) return this.rx[i].d; return null; }
  all(e) { return this.rx.filter(x => x.e === e).map(x => x.d); }
}
class FN {
  constructor() { this.cf = []; this.s = new Map(); }
  on(e, f) { if (e === "connection") this.cf.push(f); }
  connect(id) { const s = new FS(this, id); this.s.set(id, s); this.cf.forEach(f => f(s)); return s; }
  _room(r, e, d, ex) { this.s.forEach(s => { if (s.id !== ex && s.rooms.has(r)) s.emit(e, d); }); }
  to(r) { return { emit: (e, d) => {
    let hit = false;
    this.s.forEach(s => { if (s.rooms.has(r)) { s.emit(e, d); hit = true; } });
    if (!hit && this.s.has(r)) this.s.get(r).emit(e, d);
  }}; }
}
const nsp = new FN();
const kv = {}, users = {};
const store = {
  async getUser(n) { return users[n] || null; },
  async createUser(n, s, h) { users[n] = { name: n, salt: s, hash: h, wins: 0, games: 0, totalScore: 0 }; },
  async getKV(k) { return kv[k] || null; },
  async saveKV(k, v) { kv[k] = v; }
};
const QUIZ = setupQuiz({ of: () => nsp }, {
  store,
  hashPass: (p, s) => "h(" + p + "|" + s + ")",
  publicStats: u => ({ name: u.name, wins: u.wins, games: u.games, totalScore: u.totalScore }),
  getAdmin: () => null
});
// للاختبار فقط: نقرأ الإجابة الصحيحة من داخل الخادم (العميل لا يستطيع ذلك)
const peekCorrect = rid => { const r = QUIZ.rooms.get(rid); return r && r.currentQ ? r.currentQ.correct : -1; };
const ask = (s, e, d, ms = 400) => new Promise(res => {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
  s.fire(e, d, r => { if (!done) { done = true; clearTimeout(t); res(r); } });
});

(async function run() {
  console.log("\n═══ اختبار «قمّة الهرم» ═══\n");
  if (process.env.QUIZ_TEST_FAST !== "1") console.log("⚠️  شغّله بـ QUIZ_TEST_FAST=1 ليكون سريعاً\n");

  console.log("① المحتوى");
  const v = qbank.validate(), ch = qbank.validateChallenges();
  ok(v.problems.length === 0, `${v.total} سؤال صالح`, v.problems[0]);
  ok(ch.problems.length === 0, `${ch.links} ربط + ${ch.sorts} تصنيف صالحة`, ch.problems[0]);
  ok(qbank.categories().length >= 10, `${qbank.categories().length} فئة`);

  console.log("\n② الحسابات والغرفة");
  const A = nsp.connect("A"), B = nsp.connect("B"), C = nsp.connect("C");
  const P = { A, B, C };
  const ra = await ask(A, "register", { name: "أحمد", pass: "1234" });
  ok(ra && ra.ok, "تسجيل حساب");
  ok(ra && ra.quiz && ra.quiz.games === 0, "إحصائيات المسابقات منفصلة عن باقي الألعاب");
  const r1 = await ask(A, "createRoom", { name: "أحمد" });
  ok(r1 && r1.ok, "إنشاء غرفة " + (r1 && r1.roomId));
  const RID = r1.roomId;
  ok((await ask(B, "joinRoom", { name: "بدر", roomId: RID })).ok, "انضمام لاعب ثانٍ");
  ok((await ask(C, "joinRoom", { name: "سالم", roomId: RID })).ok, "انضمام لاعب ثالث");
  let S = A.last("state");
  ok(S.players.length === 3, "٣ لاعبين");
  ok(new Set(S.players.map(p => p.color)).size === 3, "لكل لاعب لون مميز");

  console.log("\n③ الإعدادات وحمايتها");
  B.fire("updateSettings", { questionTime: 30 });
  ok(A.last("state").settings.questionTime !== 30, "غير المضيف لا يغيّر الإعدادات");
  A.fire("updateSettings", { questionTime: 999, pyramidHeight: 999, maxPlayers: 99, powerUses: 99 });
  S = A.last("state");
  ok(S.settings.questionTime === 30 && S.settings.pyramidHeight === 6 && S.settings.maxPlayers === 8 && S.settings.powerUses === 12,
     "القيم الشاذة تُقصّ للحدود القصوى", JSON.stringify({q:S.settings.questionTime,h:S.settings.pyramidHeight,m:S.settings.maxPlayers,u:S.settings.powerUses}));
  A.fire("updateSettings", {
    length: "short", questionTime: 1, voteTime: 1, attackTime: 1,
    pyramidTime: 1, pyramidHeight: 6, challenges: true, powers: true, powerUses: 3
  });
  S = A.last("state");
  ok(S.settings.length === "short", "طول المباراة: قصيرة");

  // ---------- لقطات ----------
  const snap = {};           // أول لقطة لكل مرحلة
  const seen = new Set();
  const leaks = [];
  A.spy((e, d) => {
    if (e !== "state" || !d) return;
    const ph = d.phase;
    if (ph && !seen.has(ph)) { seen.add(ph); snap[ph] = JSON.parse(JSON.stringify(d)); }
    // فحص تسريب الإجابات في كل رسالة حالة
    const j = JSON.stringify(d);
    if (/"correct"\s*:/.test(j) || /"answer"\s*:/.test(j)) leaks.push(ph);
  });

  console.log("\n④ المباراة تعمل من البداية للنهاية");
  A.fire("startGame");
  await sleep(250);
  ok(A.last("state").state === "playing", "المباراة بدأت");
  ok(A.last("state").totalStages === 9, `الجدول: ${A.last("state").totalStages} مراحل (٦ أسئلة + ربط + تصنيف + هرم)`);

  // محرك اللعب التلقائي
  let voted = "", answeredAt = "", attacked = false, attackAckSeen = false, doubleAttackBlocked = null; let pyAttacked = null;
  const driver = setInterval(() => {
    const st = A.last("state");
    if (!st || st.state !== "playing") return;
    const key = st.phase + "|" + st.stage + "|" + st.pyramidQ;
    if (st.phase === "vote" && voted !== key) {
      voted = key;
      const c = st.catOptions[0];
      A.fire("vote", c); B.fire("vote", c); C.fire("vote", st.catOptions[1] || c);
    }
    /* فخاخ الهرم: لكل جولةٍ طورُ فخاخٍ يخصّ كل لاعب — الروبوتات تردّ فورًا كي لا
       تنتظر المهلة كاملةً في كل جولة (وهذا ما كان يجعل المباراة تلامس حدّ الزمن) */
    if (st.phase === "attack" && st.pyMode && pyAttacked !== key) {
      pyAttacked = key;
      [[A, "B"], [B, "C"], [C, "A"]].forEach(([S, tgt]) => {
        const mm = S.last("powerMenu");
        if (mm && mm.tier && mm.menu && mm.menu.length) S.fire("attack", { to: tgt, power: mm.menu[0] });
      });
    }
    if (st.phase === "attack" && !st.pyMode && !attacked) {
      /* لكل لاعب قائمته الخاصة تصله برسالة powerMenu — لم تعد في الحالة العامة */
      const mm = A.last("powerMenu");
      const menu = ((mm && mm.menu) || []).filter(p => p !== "double" && p !== "bet");
      if (menu.length) {
        attacked = true;
        A.fire("attack", { to: "B", power: menu[0] });
        setTimeout(() => {
          attackAckSeen = !!A.last("attackAck");
          const nAck = A.all("attackAck").length;
          /* الهجوم الثاني في نفس الجولة يُرفض: pendingAttack محجوز */
          A.fire("attack", { to: "C", power: menu[menu.length - 1] });
          setTimeout(() => { doubleAttackBlocked = A.all("attackAck").length === nAck; }, 40);
        }, 40);
      }
    }
    if ((st.phase === "question" || st.phase === "pyramid") && answeredAt !== key) {
      answeredAt = key;
      A.fire("answer", 0); B.fire("answer", 1); C.fire("answer", 2);
    }
    /* الربط والتصنيف يُلعبان عنصرًا عنصرًا كما يفعل العميل الحقيقي */
    if (st.phase === "link" && answeredAt !== key) {
      answeredAt = key;
      [A, B, C].forEach(S => {
        /* اللوحة تُرسل بالمفتاحين r و l، وكل محاولة قد تُصيب أو تُخطئ.
           نجرّب كل يمين مع كل يسار حتى تُستنفد اللوحة كما يفعل اللاعب. */
        /* اللوحة تضمن توصيلة صحيحة واحدة على الأقل لكنها ليست بالضرورة
           لأوّل يمين، فنجرّب كل يمين مع كل يسار حتى تُستنفد الأزواج. */
        for (let guard = 0; guard < 3000; guard++) {
          const bd = S.last("linkBoard");
          if (!bd || !bd.r || !bd.r.length || !bd.l || !bd.l.length) break;
          if (bd.hits >= bd.total) break;
          const before = bd.hits;
          outer: for (const r of bd.r) for (const l of bd.l) {
            S.fire("linkPick", { r: r.k, l: l.k });
            if ((S.last("linkBoard") || {}).hits > before) break outer;
          }
          if ((S.last("linkBoard") || {}).hits === before) break;   /* لا تقدّم */
        }
      });
    }
    if (st.phase === "sort" && answeredAt !== key) {
      answeredAt = key;
      const n = st.sort ? st.sort.items.length : 0;
      [A, B, C].forEach((S, si) => {
        for (let i = 0; i < n; i++) S.fire("sortPick", { i, side: (i + si) % 2 });
      });
    }
  }, 50);

  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = A.last("state");
    if (st && st.state === "ended") break;
    await sleep(150);
  }
  clearInterval(driver);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  ok(A.last("state").state === "ended", `المباراة اكتملت في ${dur}ث`);

  console.log("\n⑤ مراحل المباراة ظهرت كلها");
  ["vote", "attack", "question", "link", "sort", "pyramid"].forEach(ph => {
    const names = { vote: "التصويت على الفئة", attack: "اختيار الهجوم", question: "السؤال", link: "جولة الربط", sort: "جولة التصنيف", pyramid: "الهرم النهائي" };
    ok(!!snap[ph], "مرحلة " + names[ph]);
  });

  console.log("\n⑥ 🔒 لا تسريب للإجابات");
  ok(leaks.length === 0, "لا يوجد حقل correct/answer في أي رسالة حالة", leaks.slice(0, 3).join(","));
  if (snap.question) {
    ok(snap.question.question.options.length === 4, "السؤال فيه ٤ خيارات");
    ok(snap.question.question.correct === undefined, "الإجابة الصحيحة غير مُرسلة مع السؤال");
  }
  if (snap.link) ok(!("answer" in snap.link.link), "الربط: بلا حلٍّ مُرسل");
  if (snap.sort) ok(snap.sort.sort.items.length > 0 && !("answer" in snap.sort.sort),
    `التصنيف: ${snap.sort.sort.items.length} عنصرًا بلا حل مُرسل`);

  console.log("\n⑦ القوى الهجومية");
  ok(attackAckSeen, "تأكيد وصول الهجوم للمهاجم");
  ok(doubleAttackBlocked === true, "لا يمكن الهجوم مرتين في نفس الجولة");
  const att = B.all("attacked");
  ok(att.length > 0, `الهدف استقبل ${att.length} تأثير` + (att[0] ? ` (${att[0].power} من ${att[0].from})` : ""));
  ok(!A.all("attacked").some(x => x.from === "أحمد"), "المهاجم لم يتأثر بهجومه");
  if (snap.attack) {
    const me = snap.attack.players.find(p => p.id === "A");
    ok(me.powersLeft <= 3, `عدد الاستخدامات محدود (${me.powersLeft} متبقية)`);
  }

  console.log("\n⑧ النقاط والكشف");
  const revs = A.all("reveal");
  ok(revs.length >= 5, `تم كشف نتيجة ${revs.length} سؤال`);
  const withCorrect = revs.flatMap(r => r.results).filter(r => r.correct);
  ok(revs.every(r => typeof r.correct === "number" && r.correctText), "كل كشف يحوي الإجابة الصحيحة ونصها");
  /* الأسئلة العادية 100–200 بحسب السرعة، ومراحل الهرم 100/200/300 بحسب
     المركز، وحفلة النقاط تضاعف الأساس — فنفحص الأساس لا الناتج. */
  ok(withCorrect.every(r => { const b = r.base != null ? r.base : r.gain;
      return b >= 100 && b <= 300 && r.gain >= b; }),
    `نقاط الإجابات الصحيحة: الأساس بين 100 و300 (${withCorrect.length} إجابة صحيحة)`);
  const fast = withCorrect.filter(r => r.ms !== null);
  ok(fast.length === withCorrect.length, "زمن كل إجابة مقاس من الخادم");

  console.log("\n⑨ الهرم النهائي");
  const pyr = A.all("pyramidReveal");
  ok(pyr.length > 0, `${pyr.length} جولة على الهرم`);
  if (pyr.length) {
    const allMoves = pyr.flatMap(p => p.moves);
    ok(allMoves.every(m => m.to >= 0 && m.to <= 6), "المواقع داخل حدود الهرم (0..6)");
    ok(allMoves.every(m => m.d >= -1 && m.d <= 1), "الحركة بين -1 و+1 درجة");
    ok(pyr.some(p => p.fastest), "الأسرع يُحدَّد في كل جولة");
    /* القاعدة تغيّرت: درجةٌ واحدة لكل إجابةٍ صحيحة مهما كانت السرعة.
       القفزُ درجتين كان يبدو خطأً في الرسم على صورة الهرم. */
    const twoStep = allMoves.filter(m => m.d === 2);
    ok(twoStep.length === 0, `لا أحد يصعد درجتين (${twoStep.length} مرة)`);
    const oneStep = allMoves.filter(m => m.d === 1);
    ok(oneStep.length > 0, `المُجيب صحيحًا يصعد درجةً واحدة (${oneStep.length} مرة)`);
  }
  if (snap.pyramid) {
    const pos = snap.pyramid.players.map(p => p.pyPos);
    ok(pos.some(x => x > 0), "البداية متدرجة حسب النقاط: " + pos.join("، "));
  }

  console.log("\n⑩ النهاية والإحصائيات");
  const F = A.last("finish");
  ok(F && F.winner, "يوجد فائز: " + (F && F.winner ? F.winner.name : "—"));
  ok(F && F.table && F.table.length === 3, "جدول الترتيب كامل");
  ok(F && F.table[0].rank === 1 && F.table[2].rank === 3, "الترتيب مرقّم 1..3");
  await sleep(150);
  ok(!!kv.quizStats, "الإحصائيات حُفظت");
  ok(kv.quizStats && kv.quizStats["أحمد"] && kv.quizStats["أحمد"].games === 1, "المسجّل سُجّلت له مباراة");
  ok(!kv.quizStats || !kv.quizStats["بدر"], "الضيوف بلا إحصائيات");

  console.log("\n⑪ العودة للردهة");
  A.fire("backToLobby");
  await sleep(150);
  const lob = A.last("state");
  ok(lob.state === "lobby" && lob.players.every(p => p.score === 0 && p.pyPos === 0), "رجعنا للردهة والنقاط والمواقع صُفّرت");

  console.log("\n⑫ الفوز الحقيقي بالوصول لقمة الهرم");
  // مباراة قصيرة: بلا أسئلة قتالية، هرم منخفض، ولاعب يجيب صح دائماً
  A.fire("updateSettings", { length: "short", challenges: false, powers: false, pyramidHeight: 3, pyramidTime: 1, headStart: false });
  A.fire("startGame");
  await sleep(200);
  let champDone = false;
  const d2 = setInterval(() => {
    const st = A.last("state");
    if (!st || st.state !== "playing") return;
    if (st.phase === "vote") { const c = st.catOptions[0]; A.fire("vote", c); B.fire("vote", c); C.fire("vote", c); }
    if (st.phase === "question" || st.phase === "pyramid") {
      const right = peekCorrect(RID);
      A.fire("answer", right);              // أحمد يعرف الإجابة دائماً
      B.fire("answer", (right + 1) % 4);    // بدر يخطئ دائماً
      C.fire("answer", (right + 2) % 4);
    }
  }, 50);
  const t2 = Date.now();
  while (Date.now() - t2 < 30000) {
    if (A.last("state").state === "ended") { champDone = true; break; }
    await sleep(120);
  }
  clearInterval(d2);
  ok(champDone, "المباراة الثانية انتهت");
  const F2 = A.last("finish");
  ok(F2 && F2.winner && F2.winner.name === "أحمد", "من يجيب صح دائماً هو الفائز: " + (F2 && F2.winner ? F2.winner.name : "—"));
  const pyr2 = A.all("pyramidReveal");
  const reachedTop = pyr2.some(p => p.moves.some(m => m.to >= 3));
  ok(reachedTop, "لاعب وصل قمة الهرم فعلاً وأنهى المباراة");
  ok(pyr2.length < 24, `المباراة حُسمت في ${pyr2.length} جولة هرم (لا تعلق حتى السقف)`);
  const noPenalty = pyr2.flatMap(p => p.moves).every(m => m.d >= 0);
  ok(noPenalty, "بدون عقوبة: الإجابة الخاطئة لا تُنزل درجة (الإعداد الافتراضي)");

  console.log("\n⑬ الغرف العامة وكلمة المرور");
  A.fire("backToLobby");
  await sleep(120);
  A.fire("updateSettings", { visibility: "public", password: "9999" });
  await sleep(80);
  const pr = await new Promise(res => { let d = false; const t = setTimeout(() => { if (!d) { d = true; res(null); } }, 500); A.fire("publicRooms", r => { if (!d) { d = true; clearTimeout(t); res(r); } }); });
  ok(pr && pr.rooms.some(r => r.id === RID && r.locked), "الغرفة تظهر عامة ومقفلة");
  const D = nsp.connect("D");
  const bad = await ask(D, "joinRoom", { name: "خالد", roomId: RID, password: "غلط" });
  ok(bad && !bad.ok && bad.needPass, "كلمة مرور خاطئة تُرفض");
  const good = await ask(D, "joinRoom", { name: "خالد", roomId: RID, password: "9999" });
  ok(good && good.ok, "كلمة المرور الصحيحة تُقبل");

  console.log("\n" + "═".repeat(34));
  console.log(`  ✅ نجح: ${PASS}    ❌ فشل: ${FAIL}`);
  console.log("═".repeat(34) + "\n");
  process.exit(FAIL ? 1 : 0);
})();
