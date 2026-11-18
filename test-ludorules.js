// اختبار محرّك لودو: الهندسة، والقواعد الأساسيّة، والأوضاع الستّة، والمعزّزات،
// والفرق، ثمّ آلافُ المباريات العشوائيّة مع فحص الثوابت في كلّ خطوة.
//
// كلُّ مشهدٍ يُبنى يدويًّا (نضع القطع حيث نريد ونحمّل النرد) لأنّ القاعدة
// التي لا تُختبَر في مشهدها الدقيق تُختبَر بالحظّ — والحظُّ لا يجد الحوافّ.

const L = require("./ludorules");
const BOT = require("./ludobot");
const G = L.G;
const { FINISH, BASE, LAST_TRACK, HOME_FIRST, START, STARS, absOf, TRACK } = G;

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const mk = (rules, seats, seed = 1) => { const m = new L.LudoMatch(rules, seats, seed); m.takeEvents(); return m; };
const turnTo = (m, s) => { m.turn = s; m.phase = "roll"; m.dice = null; m.pool = []; m.legal = []; m.sixRun = 0; };
const put = (m, seat, idx, p) => { m.pieces[seat][idx].p = p; };
const rollAs = (m, seat, v) => { m._loaded = [v]; m.roll(seat); };
/* الستّةُ تُرمى بعدها أخرى قبل الحركة: رميُ تسلسلٍ كامل (٦ ثمّ ٤ مثلًا) */
const rollSeq = (m, seat, vs) => { for (const v of vs) rollAs(m, seat, v); };
/* تحريكُ قطعةٍ برقمٍ بعينه من البركة */
const goD = (m, seat, owner, idx, d) => {
  const x = m.legal.find(y => y.owner === owner && y.idx === idx && y.d === d);
  if (!x) throw new Error("no move " + owner + ":" + idx + " d" + d);
  m.move(seat, x.id);
};
const pool = m => m.pool.map(x => x.v);
const mv = (m, owner, idx) => m.legal.find(x => x.owner === owner && x.idx === idx);
const go = (m, seat, owner, idx) => { const x = mv(m, owner, idx); if (!x) throw new Error("no move " + owner + ":" + idx); m.move(seat, x.id); };
const rel = (seat, abs) => (abs - START[seat] + TRACK) % TRACK;
const evs = (m, t) => m.takeEvents().filter(e => !t || e.t === t);

console.log("\n═══ محرّك لودو ═══\n");

/* ═══════════ ١) الهندسة ═══════════ */
console.log("① الهندسة");
{
  const t = G.TRACK_RC;
  eq(t.length, 52, "الطريق ٥٢ مربّعًا");
  eq(new Set(t.map(x => x + "")).size, 52, "بلا تكرار");
  let diag = 0, jump = 0;
  for (let i = 0; i < 52; i++) {
    const a = t[i], b = t[(i + 1) % 52], d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (d === 2 && a[0] !== b[0] && a[1] !== b[1]) diag++; else if (d !== 1) jump++;
  }
  eq(diag, 4, "أربعُ زوايا قطريّة حول المركز — كاللوحة الحقيقيّة");
  eq(jump, 0, "ولا قفزةَ غيرها");
  eq([0, 1, 2, 3].map(s => t[absOf(s, 50)].join(",")), ["7,0", "0,7", "7,14", "14,7"], "كلُّ مقعدٍ ينعطف عند رأس ذراعه");
  ok(STARS.every(s => !START.includes(s)), "النجوم غيرُ مربّعات الانطلاق");
  ok(G.HOME_RC.every(h => h.length === 5), "مسار النهاية خمسةُ مربّعات");
}

/* ═══════════ ٢) القواعد الأساسيّة ═══════════ */
console.log("② القواعد الأساسيّة (من لعبة المرجع)");
{
  let m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); rollAs(m, 0, 3);
  eq(m.turn, 2, "بلا ستّةٍ والقطعُ كلُّها في القاعدة ⇒ يمرّ الدور");

  /* الستّة: رميةٌ أخرى **قبل** أيّ حركة، والأرقامُ تتجمّع (كود المرجع:
     Service.turingNumber ⇒ THROW_START عند الستّة، وnumArray تحفظ الأرقام) */
  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); rollAs(m, 0, 6);
  ok(m.turn === 0 && m.phase === "roll" && !m.legal.length, "الستّة: رميةٌ أخرى قبل أيّ حركة (كما في المرجع)");
  eq(pool(m), [6], "والستّةُ محفوظةٌ في بركة الدور");
  rollAs(m, 0, 4);
  eq(pool(m), [6, 4], "والأرقامُ تتجمّع: ٦ ثمّ ٤");
  ok(!!mv(m, 0, 0) && m.legal.every(x => x.d === 6), "والقطعُ كلُّها في القاعدة ⇒ لا يُلعب الآن إلا الخروجُ بالستّة", m.legal);
  eq(m.legal.length, 1, "وقطعُ القاعدة المتكافئة تُعرض مرّةً واحدة");
  go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, 0, "تقف على مربّع الانطلاق");
  ok(m.turn === 0 && m.phase === "move" && m.legal.length > 0 && m.legal.every(x => x.d === 4),
     "ثمّ يُنفَق الرقمُ الباقي (٤) بلا رميةٍ جديدة", m.legal);
  go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, 4, "القطعةُ تمشي بالأربعة");
  eq(m.turn, 2, "نفدت البركة ⇒ ينتقل الدور");

  /* أيُّ رقمٍ لأيّ قطعة، وبأيّ ترتيب */
  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 10); put(m, 0, 1, 20);
  rollSeq(m, 0, [6, 2]);
  {
    const o = m.legal.filter(x => x.owner === 0 && x.from >= 0).map(x => x.idx + ":" + x.d).sort();
    eq(o, ["0:2", "0:6", "1:2", "1:6"], "كلُّ قطعةٍ على الطريق بكلّ رقمٍ في البركة");
  }
  m.move(0, m.legal.find(x => x.idx === 1 && x.d === 2).id);
  eq(m.pieces[0][1].p, 22, "يبدأ بالاثنين لقطعة");
  ok(m.legal.length > 0 && m.legal.every(x => x.d === 6), "ثمّ لا يبقى إلا الستّة", m.legal);
  m.move(0, m.legal.find(x => x.idx === 0 && x.d === 6).id);
  eq(m.pieces[0][0].p, 16, "فيُعطيها لقطعةٍ أخرى");
  eq(m.turn, 2, "ثمّ ينتقل الدور");

  /* ثلاثُ ستّات: الدورُ كلُّه يضيع — والستّتان قبلها لم تُلعبا بعد */
  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 10);
  rollSeq(m, 0, [6, 6, 6]);
  eq(m.pieces[0][0].p, 10, "ثلاثُ ستّات: لا تتحرّك أيُّ قطعة — والستّتان قبلها تضيعان معها");
  eq(m.turn, 2, "وينتهي الدور");
  eq(m.pool.length, 0, "وتُفرَّغ البركة");

  /* أكثرُ من ثلاثة نرودٍ في الدور (طلبُ المستخدم): ٦ ٦ ٣ ← الثلاثةُ تأكل ← بقي
     ٦ ٦ ← رميةُ المكافأة ٦ ثمّ ٢. كانت «ثلاث ستّات» تُعَدّ من البركة كلّها
     فتجمع الستّتين الباقيتين مع ستّة المكافأة ويضيع الدورُ ظلمًا. */
  {
    /* أوّلُ موضعٍ تنزل منه الثلاثةُ على مربّعٍ غيرِ آمن (النجومُ لا يُؤكل فيها) */
    let from = 5;
    while (L.SAFE.has(absOf(0, from + 3))) from++;
    const setup = () => {
      const mm = mk({ mode: "classic" }, [0, 2]);
      turnTo(mm, 0); put(mm, 0, 0, from); put(mm, 0, 1, 30);
      const target = absOf(0, from + 3);
      put(mm, 2, 0, rel(2, target));
      return { mm, target };
    };
    let { mm, target } = setup();
    ok(!L.SAFE.has(target), "(مربّعُ الأكل غيرُ آمن)");
    rollSeq(mm, 0, [6, 6, 3]);
    eq(pool(mm), [6, 6, 3], "٦ ٦ ٣ في البركة");
    goD(mm, 0, 0, 0, 3);
    ok(mm.pieces[2][0].p === BASE && mm.phase === "roll" && mm.turn === 0, "الثلاثةُ أكلت ⇒ رميةُ مكافأة");
    eq(pool(mm), [6, 6], "والستّتان باقيتان");
    rollAs(mm, 0, 6);
    ok(mm.turn === 0 && mm.phase === "roll", "ستّةُ المكافأة لا تُكمل «ثلاث ستّات» مع الباقي — يرمي ثانية", { turn: mm.turn, phase: mm.phase });
    rollAs(mm, 0, 2);
    eq(pool(mm), [6, 6, 6, 2], "خمسةُ نرودٍ في دورٍ واحد: ٦ ٦ ٣ ثمّ ٦ ٢");
    ok(mm.phase === "move" && mm.legal.some(x => x.d === 2) && mm.legal.some(x => x.d === 6), "وكلُّها تُلعَب");

    ({ mm } = setup());
    rollSeq(mm, 0, [6, 6, 3]); goD(mm, 0, 0, 0, 3);
    rollSeq(mm, 0, [6, 6, 6]);
    ok(mm.turn === 2 && mm.pool.length === 0, "أمّا ثلاثُ ستّاتٍ في رمية المكافأة نفسها فتُضيّع الدور", { turn: mm.turn, pool: pool(mm) });

    /* والذهبيّةُ لا تُعَدّ: ٦ ٦ ثمّ ذهبيّة ثمّ ٦ ⇒ ثلاثٌ عاديّة لا أربع */
    mm = mk({ mode: "classic" }, [0, 2]);
    turnTo(mm, 0); put(mm, 0, 0, 10);
    rollSeq(mm, 0, [6, 6]); mm.golden[0] = true; mm.roll(0);
    ok(mm.turn === 0 && mm.phase === "roll" && mm.sixRun === 2, "الذهبيّةُ لا تزيد العدّاد ولا تصفّره", mm.sixRun);
    rollAs(mm, 0, 6);
    ok(mm.turn === 2, "والستّةُ العاديّةُ الثالثة تُضيّع الدور");

    /* القاعدةُ باقية (طلبُ المستخدم): ثلاثُ ستّاتٍ متتالية تُلغي الدور — من أوّل رمية */
    mm = mk({ mode: "classic" }, [0, 2]);
    turnTo(mm, 0); put(mm, 0, 0, 10);
    rollSeq(mm, 0, [6, 6, 6]);
    ok(mm.turn === 2 && mm.pieces[0][0].p === 10, "٦ ٦ ٦ من أوّل الدور ⇒ يُلغى الدور");
  }

  /* زوجُ الخصم: قطعتان من لونٍ واحدٍ في مربّعٍ غيرِ آمن لا يُنزَل عليهما
     (المرجع: MapEv.canMove) — كان الخصمُ ينزل فيأكلهما معًا. ويُتخطّيان. */
  {
    let from = 5;
    while (L.SAFE.has(absOf(0, from + 3)) || L.SAFE.has(absOf(0, from + 4))) from++;
    const pairCell = absOf(0, from + 3);
    const build = (n2) => {
      const mm = mk({ mode: "classic" }, [0, 2]);
      turnTo(mm, 0); put(mm, 0, 0, from); put(mm, 0, 1, 40);
      for (let i = 0; i < n2; i++) put(mm, 2, i, rel(2, pairCell));
      return mm;
    };
    let mm = build(2);
    rollAs(mm, 0, 3);
    ok(!mm.legal.some(x => x.owner === 0 && x.idx === 0), "لا ينزل الخصمُ على قطعتين من لونٍ واحد", mm.legal);
    mm = build(2); rollAs(mm, 0, 4);
    ok(mm.legal.some(x => x.owner === 0 && x.idx === 0), "لكن يتخطّاهما");
    go(mm, 0, 0, 0);
    ok(mm.pieces[2][0].p !== BASE && mm.pieces[2][1].p !== BASE, "ولا يمسّهما بالتخطّي");
    mm = build(1); rollAs(mm, 0, 3); go(mm, 0, 0, 0);
    ok(mm.pieces[2][0].p === BASE, "والقطعةُ الواحدة تُؤكل كالعادة");
    /* زوجي أنا: أنزل عليه (ثلاثُ قطعٍ لي) */
    mm = mk({ mode: "classic" }, [0, 2]);
    turnTo(mm, 0); put(mm, 0, 0, from); put(mm, 0, 1, from + 3); put(mm, 0, 2, from + 3);
    rollAs(mm, 0, 3);
    ok(mm.legal.some(x => x.owner === 0 && x.idx === 0), "وعلى زوجي أنا أنزل");
    /* على النجمة: لا أكل أصلًا، فلا حجب — تتشارك الألوانُ المربّعَ الآمن */
    const star = STARS.find(a => a > 8 && a < 40);
    mm = mk({ mode: "classic" }, [0, 2]);
    turnTo(mm, 0); put(mm, 0, 0, star - 3);
    put(mm, 2, 0, rel(2, star)); put(mm, 2, 1, rel(2, star));
    rollAs(mm, 0, 3);
    ok(mm.legal.some(x => x.owner === 0 && x.idx === 0), "زوجٌ على نجمة: يُنزَل معه (المربّعُ آمنٌ للجميع)");
    go(mm, 0, 0, 0);
    ok(mm.pieces[2][0].p !== BASE && mm.pieces[2][1].p !== BASE, "ولا أكل");
    /* في الفرق: زوجُ الخصم يحجب، وزوجُ زميلي لا يحجبني (مع التأمين المشترك) */
    mm = mk({ mode: "classic", teams: true, sharedSafe: true }, [0, 1, 2, 3]);
    turnTo(mm, 0); put(mm, 0, 0, from); put(mm, 0, 1, 40);
    put(mm, 2, 0, rel(2, pairCell)); put(mm, 2, 1, rel(2, pairCell));
    rollAs(mm, 0, 3);
    ok(mm.legal.some(x => x.owner === 0 && x.idx === 0), "زوجُ زميلي لا يحجبني");
    mm = mk({ mode: "classic", teams: true, sharedSafe: true }, [0, 1, 2, 3]);
    turnTo(mm, 0); put(mm, 0, 0, from); put(mm, 0, 1, 40);
    put(mm, 1, 0, rel(1, pairCell)); put(mm, 1, 1, rel(1, pairCell));
    rollAs(mm, 0, 3);
    ok(!mm.legal.some(x => x.owner === 0 && x.idx === 0), "وزوجُ الخصم يحجبني");
  }

  /* الأكلُ يمنح رميةً جديدة وما بقي في البركة لا يضيع */
  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 17); put(m, 0, 1, 30); put(m, 2, 0, rel(2, 20));
  rollSeq(m, 0, [6, 3]);
  m.move(0, m.legal.find(x => x.idx === 0 && x.d === 3).id);
  eq(m.pieces[2][0].p, BASE, "الثلاثةُ تأكل");
  ok(m.turn === 0 && m.phase === "roll", "والأكلُ يمنح رميةً جديدة قبل إنفاق الباقي (المرجع: Fight ⇒ THROW_START)", m.phase);
  eq(pool(m), [6], "والستّةُ الباقية محفوظةٌ لم تضِع");
  rollAs(m, 0, 2);
  eq(pool(m), [6, 2], "وتُضاف إليها الرميةُ الجديدة");

  /* نردُ المرجع: ceil(r×6.5) ⇒ الستّة ٣/١٣ والباقي ٢/١٣، وستّةٌ مضمونةٌ نصفَ
     المرّات حين تكون القطعُ كلُّها في القاعدة وأوّلَ رميةٍ في الدور */
  {
    const q = mk({ mode: "classic" }, [0, 2], 77); put(q, 0, 0, 5);
    const c = [0, 0, 0, 0, 0, 0, 0], N = 65000;
    for (let i = 0; i < N; i++) c[q.rollDie(0)]++;
    const p6 = c[6] / N, p1 = c[1] / N;
    ok(Math.abs(p6 - 3 / 13) < 0.01 && Math.abs(p1 - 2 / 13) < 0.01, "نردُ المرجع: الستّةُ ٣ من ١٣ (≈٢٣٪) وكلُّ رقمٍ آخر ٢ من ١٣ (≈١٥٪)", { p6, p1 });
    ok(c[0] === 0 && c.slice(1).every(x => x > 0), "ولا رقمَ خارج ١..٦");
    const r = mk({ mode: "classic" }, [0, 2], 78); let six = 0; const M = 20000;
    for (let i = 0; i < M; i++) six += r.rollDie(0) === 6 ? 1 : 0;
    ok(Math.abs(six / M - (0.5 + 0.5 * 3 / 13)) < 0.015, "القطعُ كلُّها في القاعدة وأوّلُ رميةٍ في الدور ⇒ نصفُها ستّةٌ مضمونة (≈٦٢٪)", six / M);
    r.pool = [{ v: 4, g: false }]; six = 0;
    for (let i = 0; i < M; i++) six += r.rollDie(0) === 6 ? 1 : 0;
    ok(Math.abs(six / M - 3 / 13) < 0.012, "وبعد أوّل رميةٍ في الدور يعود النردُ العاديّ للمرجع", six / M);
  }

  /* الأكل */
  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 26); put(m, 2, 0, rel(2, 30));
  rollAs(m, 0, 4); go(m, 0, 0, 0);
  eq(m.pieces[2][0].p, BASE, "النزولُ على خصمٍ يُعيده إلى قاعدته");
  ok(m.turn === 0 && m.phase === "roll", "والأكلُ يمنح رميةً إضافيّة");

  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 30); put(m, 2, 0, rel(2, 34));
  rollAs(m, 0, 4); go(m, 0, 0, 0);
  eq(m.pieces[2][0].p, rel(2, 34), "النجمة آمنة: لا أكل");
  eq(m.turn, 2, "ولا رميةَ إضافيّة");

  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 22); put(m, 2, 0, 0);
  rollAs(m, 0, 4); go(m, 0, 0, 0);
  eq(m.pieces[2][0].p, 0, "مربّعُ انطلاق الخصم آمنٌ كذلك");

  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 54);
  rollAs(m, 0, 3);
  eq(m.turn, 2, "لا تجاوزَ للمركز: ٥٤+٣ لا تُلعب");
  turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, FINISH, "والرميةُ المطابقة تُدخلها");
  ok(m.turn === 0 && m.phase === "roll", "ودخولُ المركز يمنح رميةً جديدة (المرجع: chessEvent.Win ⇒ THROW_START)");

  m = mk({ mode: "classic" }, [0, 2]);
  turnTo(m, 0); [0, 1, 2].forEach(i => put(m, 0, i, FINISH)); put(m, 0, 3, 55);
  rollAs(m, 0, 1); go(m, 0, 0, 3);
  ok(m.winner && m.winner.seats[0] === 0 && m.winner.reason === "allHome", "الكلاسيكيّ: الفوز بالأربع", m.winner);
}

/* ═══════════ ٣) السريع ═══════════ */
console.log("③ السريع");
{
  const m = mk({ mode: "rush" }, [0, 1, 2, 3]);
  ok([0, 1, 2, 3].every(s => m.pieces[s][0].p === 0), "قطعةٌ لكلّ لاعبٍ على الطريق من البداية");
  turnTo(m, 1); put(m, 1, 0, 53);
  rollAs(m, 1, 3); go(m, 1, 1, 0);
  ok(m.winner && m.winner.seats.join() === "1" && m.winner.reason === "first", "قطعةٌ واحدةٌ تكفي للفوز", m.winner);
}

/* ═══════════ ٤) الاحترافيّ ═══════════ */
console.log("④ الاحترافيّ: الحواجز والارتداد");
{
  let m = mk({ mode: "master" }, [0, 2]);
  put(m, 2, 0, rel(2, 30)); put(m, 2, 1, rel(2, 30));
  eq(m.blockadeAt(30), 2, "قطعتان لك في مربّعٍ واحد = حاجز");
  turnTo(m, 0); put(m, 0, 0, 27);
  m._loaded = [5]; m.roll(0);
  ok(!mv(m, 0, 0), "لا يُتخطّى الحاجز");
  turnTo(m, 0); rollAs(m, 0, 3);
  ok(!mv(m, 0, 0), "ولا يُنزَل عليه — فلا يُؤكل");
  turnTo(m, 0); rollAs(m, 0, 2);
  ok(!!mv(m, 0, 0), "وما قبله مشروع");

  m = mk({ mode: "master" }, [0, 2]);
  put(m, 2, 0, 4); put(m, 2, 1, 4); put(m, 2, 2, 1);
  turnTo(m, 2); rollAs(m, 2, 5);
  ok(!!mv(m, 2, 2), "صاحبُ الحاجز يعبر حاجزه");

  m = mk({ mode: "master" }, [0, 2]);
  put(m, 2, 0, rel(2, 34)); put(m, 2, 1, rel(2, 34));
  eq(m.blockadeAt(34), null, "لا حاجزَ على مربّعٍ آمن (من لعبة المرجع) — فلا يُحبَس أحدٌ في قاعدته");

  m = mk({ mode: "master", teams: true }, [0, 1, 2, 3]);
  put(m, 0, 0, 5); put(m, 0, 1, 5);
  put(m, 2, 0, rel(2, 3));
  turnTo(m, 2); rollAs(m, 2, 3);
  ok(!mv(m, 2, 0), "حاجزُ اللاعب يحجب زميلَه أيضًا");

  m = mk({ mode: "master" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 55);
  rollAs(m, 0, 3);
  const b = mv(m, 0, 0);
  ok(b && b.to === 54 && b.bounce, "رميةٌ أكبر من المسافة ⇒ ترتدّ القطعة", b);
  turnTo(m, 0); put(m, 0, 0, 53); rollAs(m, 0, 3);
  eq(mv(m, 0, 0).to, FINISH, "والرقمُ المطابق يُدخلها");
}

/* ═══════════ ٥) الفرق ═══════════ */
console.log("⑤ الفرق ٢ ضدّ ٢");
{
  let m = mk({ mode: "classic", teams: true }, [0, 1, 2, 3]);
  ok(!m.opponent(0, 2) && m.opponent(0, 1), "المتقابلان فريق: (٠+٢) ضدّ (١+٣)");
  put(m, 2, 0, rel(2, 30)); put(m, 0, 0, 26);
  turnTo(m, 0); rollAs(m, 0, 4);
  ok(!mv(m, 0, 0), "بلا «تأمينٍ مشترك» لا يقف زميلان في مربّعٍ غير آمن");

  m = mk({ mode: "classic", teams: true, sharedSafe: true }, [0, 1, 2, 3]);
  put(m, 2, 0, rel(2, 30)); put(m, 0, 0, 26);
  turnTo(m, 0); rollAs(m, 0, 4); go(m, 0, 0, 0);
  ok(m.isSafeAbs(30), "ومعه يقفان معًا فيصير المربّعُ آمنًا");
  put(m, 1, 0, rel(1, 27)); turnTo(m, 1); rollAs(m, 1, 3); go(m, 1, 1, 0);
  ok(m.pieces[0][0].p === 26 + 4 && m.pieces[2][0].p === rel(2, 30), "فلا يأكلهما الخصم");

  m = mk({ mode: "classic", teams: true }, [0, 1, 2, 3]);
  [0, 1, 2, 3].forEach(i => put(m, 0, i, FINISH));
  put(m, 2, 0, 10);
  eq(m.controlled(0), [2], "من أنهى قطعَه يرمي لزميله");
  turnTo(m, 0); rollAs(m, 0, 3);
  ok(m.legal.every(x => x.owner === 2) && m.legal.length > 0, "ويحرّك قطعَ زميله");
  go(m, 0, 2, 0);
  ok(!m.winner, "والفريقُ لا يفوز إلا بقطعه الثماني");
}

/* ═══════════ ٦) المهامّ السرّيّة ═══════════ */
console.log("⑥ المهامّ السرّيّة");
{
  let distinct = true, foeOnly = true;
  for (let seed = 1; seed < 80; seed++) {
    const m = mk({ mode: "missions", teams: seed % 2 === 0, powerups: seed % 3 === 0 }, [0, 1, 2, 3], seed);
    const ids = m.seats.map(s => m.missions[s].id);
    if (new Set(ids).size !== ids.length) distinct = false;
    for (const s of m.seats) if (m.missions[s].target != null && !m.opponent(s, m.missions[s].target)) foeOnly = false;
    if (!m.rules.powerups && ids.some(id => id.startsWith("pu"))) foeOnly = false;
  }
  ok(distinct, "لا مهمّتان متطابقتان على اللوحة");
  ok(foeOnly, "ومهمّةُ «كُل لونًا» تستهدف خصمًا لا زميلًا، ومهامُّ المعزّزات لا تُعطى بلا معزّزات");

  let m = mk({ mode: "missions", teams: true }, [0, 1, 2, 3], 5);
  let v = m.view(0);
  ok(v.missions[1].hidden && v.missions[3].hidden, "مهمّةُ الخصم مخفيّة");
  ok(!v.missions[0].hidden && !v.missions[2].hidden && v.missions[2].text, "ومهمّةُ الزميل مكشوفة");

  m = mk({ mode: "missions" }, [0, 2], 5);
  m.missions[0] = { id: "sixes", goal: 7, target: null };
  m.stats[0].sixes = 6;
  turnTo(m, 0); rollAs(m, 0, 6);
  ok(m.winner && m.winner.reason === "mission" && m.winner.by === 0,
     "مهمّةٌ تكتمل برميةٍ بلا حركة تفوز فورًا", m.winner);

  m = mk({ mode: "missions", teams: true }, [0, 1, 2, 3], 6);
  m.missions[2] = { id: "eat", goal: 2, target: null };
  m.stats[2].capsTotal = 1;
  put(m, 2, 0, 26 - 26 + 4); put(m, 1, 0, rel(1, 26 + 4 + 3));
  turnTo(m, 2); rollAs(m, 2, 3); go(m, 2, 2, 0);
  ok(m.winner && m.winner.seats.join() === "0,2", "إنجازُ الزميل فوزٌ للفريق", m.winner);
}

/* ═══════════ ٧) الظلام ═══════════ */
console.log("⑦ الظلام");
{
  let m = mk({ mode: "night" }, [0, 2]);
  put(m, 0, 0, 10);
  put(m, 2, 0, rel(2, 20)); put(m, 2, 1, rel(2, 13)); put(m, 2, 2, FINISH);
  let v = m.view(0);
  ok(v.pieces[2][0].hidden && v.pieces[2][0].p === undefined, "الخصمُ خارج النطاق مخفيٌّ تمامًا — حتى موضعُه لا يُرسَل");
  ok(!v.pieces[2][1].hidden, "وفي النطاق (٣ خطوات) ظاهر");
  ok(!v.pieces[2][2].hidden && !v.pieces[2][3].hidden, "والقاعدة والمركز عامّان");
  ok(v.visible.includes(14) && !v.visible.includes(15), "نطاقُ الرؤية ٤ خطوات حول قطعك");

  /* حركةٌ في الظلام لا تصل لمن لا يراها */
  turnTo(m, 2); rollAs(m, 2, 2); evs(m);
  go(m, 2, 2, 0);
  let raw = m.takeEvents();
  ok(!m.eventsFor(raw, 0).some(e => e.t === "move"), "حركةُ خصمٍ في الظلام لا يُرسَل منها شيء");
  ok(m.eventsFor(raw, 2).some(e => e.t === "move" && e.to != null), "وصاحبُها يراها كاملة");

  /* حركةٌ تدخل النطاق: تصل مقصوصة */
  m = mk({ mode: "night" }, [0, 2]);
  put(m, 0, 0, 10); put(m, 2, 0, rel(2, 2));
  turnTo(m, 2); rollSeq(m, 2, [6, 1]); evs(m); goD(m, 2, 2, 0, 6);
  raw = m.takeEvents();
  const part = m.eventsFor(raw, 0).find(e => e.t === "move");
  ok(part && part.partial && part.from === null && part.path[0] === null && part.path[5] != null,
     "تظهر القطعةُ من الظلام: المسارُ مقصوصٌ إلى ما يُرى", part);

  /* الأكلُ يكشف اللوحة حتى نهاية الدور */
  m = mk({ mode: "night" }, [0, 2]);
  put(m, 0, 0, 26); put(m, 2, 0, rel(2, 30)); put(m, 2, 1, rel(2, 45));
  turnTo(m, 0); rollAs(m, 0, 4); go(m, 0, 0, 0);
  eq(m.view(0).visible.length, 52, "من أكل انكشفت له اللوحةُ كلُّها");
  rollAs(m, 0, 1); go(m, 0, 0, 0);
  ok(m.view(0).visible.length < 52, "حتى نهاية دوره فقط");

  m = mk({ mode: "night", teams: true }, [0, 1, 2, 3]);
  put(m, 2, 0, rel(2, 40)); put(m, 1, 0, rel(1, 42));
  ok(!m.view(0).pieces[1][0].hidden, "رؤيةُ الزميل مشتركة");

  m = mk({ mode: "night", powerups: true }, [0, 2]);
  m.powerups = [{ cell: 30, type: "gold" }, { cell: 5, type: "jump" }];
  put(m, 0, 0, 3);
  eq(m.view(0).powerups.map(x => x.cell), [5], "والمعزّزات تُرى في النطاق وحده");

  m = mk({ mode: "night" }, [0, 2]);
  turnTo(m, 0); put(m, 0, 0, 53); rollAs(m, 0, 3); go(m, 0, 0, 0);
  ok(m.winner && m.winner.reason === "first", "الظلام يُكسَب بقطعةٍ واحدة (كلعبة المرجع)");
}

/* ═══════════ ٨) الملك ═══════════ */
console.log("⑧ الملك");
{
  let m = mk({ mode: "king" }, [0, 2]);
  eq(m.pieces[0].map(x => x.kind), ["guard", "guard", "guard", "king"], "ثلاثةُ حرّاسٍ وملك");
  turnTo(m, 0); rollSeq(m, 0, [6, 2]);
  ok(!m.legal.some(x => x.owner === 0 && x.idx === 3), "الملك مقفلٌ في القاعدة في البداية");
  goD(m, 0, 0, 0, 6);
  ok(!m.unlocked[0], "خروجُ الحارس وحده لا يفكّ القفل");
  goD(m, 0, 0, 0, 2);
  ok(m.unlocked[0], "حتى يخطو خطوةً على الأقلّ");
  turnTo(m, 0); rollSeq(m, 0, [6, 3]);
  ok(m.legal.some(x => x.owner === 0 && x.idx === 3 && x.d === 6), "ثمّ يخرج الملك بستّة");
  goD(m, 0, 0, 3, 6);
  ok(!m.legal.some(x => x.idx === 3 && x.d === 3), "ولا يمشي إلى ما لم يمشِه حارس (الحارس عند ٢)", m.legal);
  turnTo(m, 0); rollAs(m, 0, 2);
  ok(m.legal.some(x => x.idx === 3 && x.d === 2), "ويمشي على المسار المؤمَّن");

  /* التضحية */
  m = mk({ mode: "king" }, [0, 2]);
  m.unlocked[0] = true;
  for (let q = 0; q <= 20; q++) m.visited[0].add(m.key(0, q));
  put(m, 0, 3, 18); put(m, 0, 0, 5);
  put(m, 2, 0, rel(2, 15));
  turnTo(m, 2); rollAs(m, 2, 3); go(m, 2, 2, 0);
  ok(m.prompt && m.prompt.seat === 0 && m.prompt.kind === "sacrifice", "هجومٌ على الملك ⇒ يُسأل صاحبُه: تضحّي بحارس؟", m.prompt);
  eq(m.actingSeat(), 0, "والقرارُ لصاحب الملك لا لصاحب الدور");
  m.choose(0, 0);
  eq(m.pieces[0][3].p, 18, "الملكُ يبقى مكانه");
  eq(m.pieces[0][0].p, BASE, "والحارسُ يعود إلى القاعدة");
  eq(m.pieces[0][0].cooldown, 3, "محظورًا ٣ أدوار");
  ok(m.turn === 2 && m.phase === "roll", "والمهاجم يأخذ رميته الإضافيّة");

  /* الحظر */
  const exitOf = (mm, i) => mm.legal.some(x => x.owner === 0 && x.idx === i && x.from === BASE && x.d === 6);
  turnTo(m, 0); rollSeq(m, 0, [6, 1]);
  ok(!exitOf(m, 0), "الحارسُ المضحّي لا ينزل في فترة الحظر", m.legal);
  for (let k = 0; k < 3; k++) { turnTo(m, 0); m.endOfTurn(0); }
  turnTo(m, 0); rollSeq(m, 0, [6, 1]);
  ok(exitOf(m, 0), "وبعد ثلاثة أدوارٍ يعود", m.legal);

  /* رفض التضحية ⇒ يسقط الملك ويخرج اللاعب */
  m = mk({ mode: "king" }, [0, 2]);
  m.unlocked[0] = true;
  for (let q = 0; q <= 20; q++) m.visited[0].add(m.key(0, q));
  put(m, 0, 3, 18); put(m, 0, 0, 5); put(m, 2, 0, rel(2, 15)); put(m, 2, 3, BASE);
  turnTo(m, 2); rollAs(m, 2, 3); go(m, 2, 2, 0);
  m.choose(0, "none");
  ok(m.out[0] && m.pieces[0].every(x => x.p === L.DEAD), "بلا تضحية يسقط الملك ويخرج صاحبه بقطعه");
  ok(m.winner && m.winner.seats.join() === "2" && m.winner.reason === "lastKing", "وآخرُ ملكٍ قائمٍ يفوز", m.winner);

  /* الفرق: ملكان، ومسارٌ مشترك، وتضحيةٌ ذاتيّة فقط */
  m = mk({ mode: "king", teams: true }, [0, 1, 2, 3]);
  m.visited[2].add("t30"); m.visited[2].add("h2_1");
  ok(m.secured(0).has("t30") && !m.secured(0).has("h2_1"), "الملك يمشي على ما عبّده حرّاسُ زميله على الطريق المشترك");
  m.unlocked[0] = true;
  for (let q = 0; q <= 20; q++) m.visited[0].add(m.key(0, q));
  put(m, 0, 3, 18); put(m, 2, 0, 3);
  put(m, 1, 0, rel(1, 15));
  turnTo(m, 1); rollAs(m, 1, 3); go(m, 1, 1, 0);
  ok(!m.prompt && m.pieces[0][3].p === L.DEAD, "لا يُضحّى بحارس الزميل: ملكٌ بلا حرّاسٍ له يسقط");
  ok(!m.winner && !m.out[0], "والفريق باقٍ بملك الزميل");
  put(m, 2, 3, 18 - 26 + 52); m.unlocked[2] = true; m.visited[2].add(m.key(2, 44));
  put(m, 1, 1, rel(1, absOf(2, 44) - 2));
  turnTo(m, 1); rollAs(m, 1, 2);
  const kill = mv(m, 1, 1);
  if (kill) { m.move(1, kill.id); }
  ok(m.prompt && m.prompt.seat === 2 && m.prompt.options.every(i => m.pieces[2][i].kind === "guard"),
     "ملكُ الزميل يُفدى بحرّاس صاحبه وحده", m.prompt);
  m.choose(2, "none");
  ok(m.winner && m.winner.seats.join() === "1,3", "سقوطُ الملكين معًا يُخسر الفريق", m.winner);

  m = mk({ mode: "king" }, [0, 2]);
  m.unlocked[0] = true;
  for (let q = 0; q <= FINISH; q++) m.visited[0].add(m.key(0, q));
  put(m, 0, 3, 54); turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 3);
  ok(m.winner && m.winner.reason === "kingHome", "وصولُ الملك إلى المركز فوز", m.winner);
}

/* ═══════════ ٩) المعزّزات ═══════════ */
console.log("⑨ المعزّزات");
{
  let m = mk({ mode: "classic", powerups: true, powerCount: 5 }, [0, 1, 2, 3]);
  eq(m.powerups.length, 5, "العدد كما ضبطه المضيف");
  ok(m.powerups.every(x => !L.SAFE.has(x.cell)), "لا معزّزَ على مربّعٍ آمن");

  /* الالتقاط بالوقوف التامّ وحده، ويُولَد بديل */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: 12, type: "bubble" }, { cell: 40, type: "gold" }, { cell: 44, type: "gold" }];
  put(m, 0, 0, 10); turnTo(m, 0); rollAs(m, 0, 4); go(m, 0, 0, 0);
  ok(m.powerups.some(x => x.cell === 12), "المرورُ فوق المعزّز لا يلتقطه");
  turnTo(m, 0); put(m, 0, 0, 10); rollAs(m, 0, 2); go(m, 0, 0, 0);
  ok(!m.powerups.some(x => x.cell === 12) && m.powerups.length === 3, "والوقوفُ التامّ يلتقطه ويُولد بديلٌ فورًا");

  /* النرد الذهبيّ */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: 12, type: "gold" }];
  put(m, 0, 0, 10); turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  ok(m.golden[0], "النرد الذهبيّ محفوظٌ للرمية القادمة");
  turnTo(m, 0); m._loaded = [1]; m.roll(0);
  eq(m.dice, 6, "والرميةُ القادمة ستّةٌ مضمونة");
  ok(m.pool[0] && m.pool[0].g && m.phase === "roll", "وهي ستّةٌ تمنح رميةً أخرى كأيّ ستّة", m.pool);
  rollSeq(m, 0, [6, 6]);
  ok(m.turn === 0 && m.phase === "roll", "ولا تُحسَب في عقوبة الستّات: ذهبيّةٌ ثمّ ستّتان لا تُنهي الدور", pool(m));

  /* درع الفقاعة */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: 12, type: "bubble" }];
  put(m, 0, 0, 10); turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  ok(m.pieces[0][0].shield > 0, "الفقاعة على القطعة");
  put(m, 2, 0, rel(2, 9)); turnTo(m, 2); rollAs(m, 2, 3); go(m, 2, 2, 0);
  eq(m.pieces[0][0].p, 12, "لا تُؤكل وهي محميّة");
  eq(m.turn, 0, "ثمّ يعود الدور إلى صاحبها");
  eq(m.pieces[0][0].shield, 0, "والحمايةُ دورةٌ واحدة: تنتهي حين يعود الدور إليه");

  /* الرياح العكسيّة */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 30, type: "wind" }];
  put(m, 0, 0, 27);
  put(m, 1, 0, rel(1, 29)); put(m, 2, 0, rel(2, 27 + 0));
  turnTo(m, 0); rollAs(m, 0, 3); evs(m); go(m, 0, 0, 0);
  eq(absOf(1, m.pieces[1][0].p), 26, "خصمٌ خلفك بمربّعٍ يرتدّ إلى المربّع الرابع");
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 33, type: "wind" }];
  put(m, 0, 0, 28);
  put(m, 1, 0, rel(1, 31)); put(m, 2, 0, rel(2, 30));
  turnTo(m, 0); rollAs(m, 0, 5); go(m, 0, 0, 0);
  ok(absOf(1, m.pieces[1][0].p) === 29 && m.pieces[2][0].p === BASE,
     "خصمان على بُعد ٢ و٣ يرتدّان معًا إلى الرابع فيأكل الأقربُ الأبعد",
     { s1: m.pieces[1][0].p, s2: m.pieces[2][0].p });
  eq(m.pieces[0][0].p, 33, "وصاحبُ الريح ثابتٌ في مكانه");
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 30, type: "wind" }];
  put(m, 0, 0, 25); put(m, 1, 0, rel(1, 28)); put(m, 2, 0, rel(2, 27));
  turnTo(m, 0); rollAs(m, 0, 5); go(m, 0, 0, 0);
  ok(m.pieces[2][0].p === 0 && absOf(1, m.pieces[1][0].p) === 26,
     "واصطدامٌ على مربّعٍ آمن (انطلاق الأصفر) لا أكلَ فيه");
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 31, type: "wind" }];
  put(m, 0, 0, 25);
  put(m, 1, 0, rel(1, 30)); put(m, 2, 0, rel(2, 29));
  turnTo(m, 0); rollSeq(m, 0, [6, 1]); goD(m, 0, 0, 0, 6);
  ok(absOf(1, m.pieces[1][0].p) === 27 && m.pieces[2][0].p === BASE,
     "اصطدامٌ في الرابع: الأقربُ يأكل الأبعد", { s1: m.pieces[1][0].p, s2: m.pieces[2][0].p });
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: 12, type: "wind" }];
  put(m, 0, 0, 10); turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, 13, "ولا أحد خلفك ⇒ تتقدّم خطوة");
  /* لونٌ واحدٌ يرتدّ قطعتين إلى الرابع ⇒ لا أكل: يقفان معًا زوجًا محميًّا */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 33, type: "wind" }];
  put(m, 0, 0, 28);
  put(m, 1, 0, rel(1, 31)); put(m, 1, 1, rel(1, 30));
  turnTo(m, 0); rollAs(m, 0, 5); go(m, 0, 0, 0);
  ok(absOf(1, m.pieces[1][0].p) === 29 && absOf(1, m.pieces[1][1].p) === 29, "قطعتان من لونٍ واحد ترتدّان معًا بلا أكل",
     { a: m.pieces[1][0].p, b: m.pieces[1][1].p });
  ok(m.pairAt(29, 0) === 1, "فصارتا زوجًا محميًّا لا يُنزَل عليه");
  /* والزوجُ القائم خلفك لا تدفعه الريح (كحاجز الاحترافيّ) */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 33, type: "wind" }];
  put(m, 0, 0, 28);
  put(m, 1, 0, rel(1, 31)); put(m, 1, 1, rel(1, 31));
  turnTo(m, 0); rollAs(m, 0, 5); go(m, 0, 0, 0);
  ok(absOf(1, m.pieces[1][0].p) === 31 && absOf(1, m.pieces[1][1].p) === 31, "والزوجُ القائم لا تدفعه الريح");
  /* ولا يأكل المرتدُّ زوجًا وجده في الرابع */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 33, type: "wind" }];
  put(m, 0, 0, 28);
  put(m, 1, 0, rel(1, 31)); put(m, 2, 0, rel(2, 29)); put(m, 2, 1, rel(2, 29));
  turnTo(m, 0); rollAs(m, 0, 5); go(m, 0, 0, 0);
  ok(m.pieces[2][0].p !== BASE && m.pieces[2][1].p !== BASE && absOf(1, m.pieces[1][0].p) === 29,
     "ولا يأكل المرتدُّ زوجًا وجده في الرابع", { s2: [m.pieces[2][0].p, m.pieces[2][1].p] });
  /* قفزة الكنغر تقف قبل زوج الخصم */
  {
    let P = 14;
    while ([P, P + 1, P + 2, P + 3].some(a => L.SAFE.has(a))) P++;
    m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
    m.powerups = [{ cell: P, type: "jump" }];
    put(m, 0, 0, P - 2);
    put(m, 2, 0, rel(2, P + 3)); put(m, 2, 1, rel(2, P + 3));
    m.rnd = n => Math.min(2, n - 1);                      /* القفزة ٣ */
    turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
    ok(m.pieces[0][0].p === P + 2 && m.pieces[2][0].p !== BASE, "قفزةُ الحظّ تقف قبل زوج الخصم ولا تأكله", { me: m.pieces[0][0].p, P });
  }

  /* تبديل الأماكن */
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: 12, type: "swap" }];
  put(m, 0, 0, 10); put(m, 2, 0, rel(2, 16));
  turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  ok(m.pieces[0][0].p === 16 && absOf(2, m.pieces[2][0].p) === 12, "خصمٌ واحدٌ في النطاق ⇒ تبديلٌ فوريّ");
  {
    const mm = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
    let c = 16; while (L.SAFE.has(c)) c++;
    put(mm, 0, 0, 12); put(mm, 2, 0, rel(2, c)); put(mm, 2, 1, rel(2, c));
    ok(!mm.swapOptions(0, 0).length, "والزوجُ المحميّ لا يُبدَّل معه", mm.swapOptions(0, 0));
  }
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1, 2]);
  m.powerups = [{ cell: 31, type: "swap" }];
  put(m, 0, 0, 29); put(m, 2, 0, rel(2, 35)); put(m, 1, 0, rel(1, 28));
  turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  ok(m.prompt && m.prompt.kind === "swap" && m.prompt.options.length === 2, "أكثر من خصمٍ ⇒ يختار اللاعب", m.prompt);
  m.choose(0, m.prompt.options.find(o => o.seat === 1).id);
  ok(absOf(0, m.pieces[0][0].p) === 28 && absOf(1, m.pieces[1][0].p) === 31, "ويبدّل مع من اختار");
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 1]);
  m.powerups = [{ cell: 12, type: "swap" }];
  put(m, 0, 0, 12); put(m, 1, 0, rel(1, 9));
  eq(m.swapOptions(0, 0).length, 0, "ولا يُبدَّل خصمٌ إن كان التبديل سيعبر به مدخلَ بيته");
  m = mk({ mode: "classic", powerups: true, powerCount: 3 }, [0, 2]);
  m.powerups = [{ cell: absOf(0, 48), type: "swap" }];
  put(m, 0, 0, 46); put(m, 2, 0, rel(2, absOf(0, 48) + 4));
  turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, 48, "لا تبديلَ يعبر بالقطعة مدخلَ بيتها فتلفّ الطريق مرّةً ثانية");
  m = mk({ mode: "classic", teams: true, sharedSafe: true, powerups: true, powerCount: 3 }, [0, 1, 2, 3]);
  m.powerups = [{ cell: 12, type: "swap" }];
  put(m, 0, 0, 10); put(m, 2, 0, rel(2, 15));
  turnTo(m, 0); rollAs(m, 0, 2); go(m, 0, 0, 0);
  eq(m.pieces[0][0].p, 12, "ولا يُبدَّل مع الزميل");

  /* المضيفُ يختار أنواع المعزّزات (يمنع ما لا يريده) */
  m = mk({ mode: "classic", powerups: true, powerCount: 6, powerTypes: ["gold", "bubble"] }, [0, 1, 2, 3], 7);
  eq(m.rules.powerTypes, ["gold", "bubble"], "الأنواعُ المختارة في القواعد");
  ok(m.powerups.length === 6 && m.powerups.every(p => p.type === "gold" || p.type === "bubble"), "ولا يظهر على اللوحة غيرُها", m.powerups.map(p => p.type));
  {
    const seen = new Set();
    for (let k = 0; k < 40; k++) { m.spawnPowers(1); m.powerups.forEach(p => seen.add(p.type)); m.powerups = m.powerups.slice(-3); }
    ok([...seen].every(t => t === "gold" || t === "bubble"), "ولا فيما يظهر بعد الالتقاط", [...seen]);
  }
  eq(mk({ powerups: true, powerTypes: ["zzz", "swap", "swap"] }, [0, 2]).rules.powerTypes, ["swap"], "نوعٌ مجهول يُتجاهَل");
  m = mk({ powerups: true, powerTypes: [] }, [0, 2]);
  ok(!m.rules.powerups && m.powerups.length === 0, "لا نوعَ مُختار ⇒ لا معزّزات");
  eq(mk({ powerups: true }, [0, 2]).rules.powerTypes, L.POWERS, "وبلا اختيار: كلُّها كما كانت");
  {
    let bad = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const mm = mk({ mode: "missions", powerups: true, powerTypes: ["jump", "bubble"] }, [0, 1, 2, 3], seed);
      for (const s of mm.seats) if (["puSwap", "puWind", "puGold"].includes(mm.missions[s].id)) bad++;
    }
    ok(bad === 0, "ولا مهمّةَ لالتقاط نوعٍ ممنوع (كانت ستكون مستحيلة)", bad);
  }
}

/* ═══════════ ١٠) آلافُ المباريات مع فحص الثوابت ═══════════ */
console.log("⑩ مبارياتٌ عشوائيّة: الثوابت في كلّ خطوة");
{
  const issues = {};
  const bad = (k, x) => { issues[k] = (issues[k] || 0) + 1; if (issues[k] === 1) console.log("     ⚠️", k, JSON.stringify(x).slice(0, 300)); };
  let games = 0, steps = 0;
  for (const mode of L.MODES) for (const teams of [false, true]) for (const pu of [false, true]) {
    for (let g = 0; g < 45; g++) {
      const seats = teams ? [0, 1, 2, 3] : [[0, 2], [0, 1, 2], [0, 1, 2, 3]][g % 3];
      const m = new L.LudoMatch({ mode, teams, powerups: pu, sharedSafe: g % 2 === 0, powerCount: 3 + g % 4 }, seats, 20000 + g);
      const rnd = L.rngFrom(g * 31 + 7);
      let k = 0;
      while (m.phase !== "over" && k++ < 50000) {
        steps++;
        /* الثوابت */
        for (const s of m.seats) {
          if (m.pieces[s].length !== 4) bad("pieces!=4", { s });
          for (const pc of m.pieces[s]) if (!(pc.p === L.DEAD || (pc.p >= BASE && pc.p <= FINISH))) bad("p out of range", pc);
        }
        if (mode === "night") for (const v of m.seats) {
          const view = m.view(v), vis = new Set(view.visible);
          for (const s of m.seats) if (!m.allies(v).includes(s)) view.pieces[s].forEach(pc => {
            if (pc.hidden) { if ("p" in pc) bad("hidden piece leaks p", pc); return; }
            if (pc.p >= 0 && pc.p <= LAST_TRACK && !vis.has(absOf(s, pc.p))) bad("visible piece outside vision", { v, s, pc });
            if (pc.p > LAST_TRACK && pc.p < FINISH) bad("opponent home column leaked", { v, s, pc });
          });
          for (const pu2 of view.powerups) if (!vis.has(pu2.cell)) bad("power-up outside vision", pu2);
        }
        if (mode === "missions") for (const v of m.seats) {
          const view = m.view(v);
          for (const s of m.seats) if (!m.allies(v).includes(s) && !view.missions[s].hidden && !m.winner) bad("mission leaked", { v, s });
        }
        if (m.phase === "move") for (const x of m.legal) {
          if (mode === "master") for (const q of x.path) if (q <= LAST_TRACK) {
            const b = m.blockadeAt(absOf(x.owner, q));
            if (b !== null && b !== x.owner) bad("crosses blockade", x);
          }
          const pc = m.pieces[x.owner][x.idx];
          if (pc.kind === "king") {
            const sec = m.secured(x.owner);
            for (const q of x.path) if (!sec.has(m.key(x.owner, q))) bad("king off path", x);
          }
        }
        /* الحركة: بوتٌ أو عشوائيّ بالتناوب */
        const a = m.actingSeat();
        const useBot = (a + g) % 2 === 0;
        if (useBot) {
          const d = BOT.decide(m.view(a), 1 + (g % 2), rnd);
          if (!d) { bad("bot returned nothing", { phase: m.phase }); break; }
          if (d.kind === "roll") m.roll(a); else if (d.kind === "move") m.move(a, d.id); else m.choose(a, d.choice);
        } else if (m.prompt) {
          const o = m.prompt.options;
          m.choose(a, m.prompt.kind === "sacrifice" ? (rnd() < 0.3 ? "none" : o[0]) : o[Math.floor(rnd() * o.length)].id);
        } else if (m.phase === "roll") m.roll(a);
        else m.move(a, m.legal[Math.floor(rnd() * m.legal.length)].id);
        const raw = m.takeEvents();
        if (mode === "night") for (const v of m.seats) for (const e of m.eventsFor(raw, v)) {
          if (e._see) bad("internal field leaked", e.t);
        }
      }
      games++;
      if (m.phase !== "over") bad("game did not end", { mode, teams, pu, g });
    }
  }
  console.log(`     ${games} مباراة · ${steps.toLocaleString()} خطوة`);
  eq(issues, {}, "لا خرقَ لأيّ ثابتٍ في أيّ خطوة");
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
