// اختبار قواعد «البسكويتة الحارّة» (spicyrules.js): الوضعُ الإجباريّ، والإضافةُ
// والمزايدة، والمزاد، والقفلُ الذكيّ في الكشف، والنجومُ والعقابُ العشوائيّ
// والإقصاء، والحجبُ لكلّ لاعب، والبوت، ومبارياتٌ عشوائيّةٌ كاملة.

const S = require("./spicyrules");
const { SpicyMatch, decide, rngFrom } = S;

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const throws = (f, re, m) => { try { f(); ok(false, m, "لم يُرفض"); } catch (e) { ok(!re || re.test(e.message), m, e.message); } };

const P3 = [{ id: "a", name: "سعود" }, { id: "b", name: "نورة" }, { id: "c", name: "فهد" }];
const mk = (pl = P3, seed = 3) => { const m = new SpicyMatch(pl, { rng: rngFrom(seed) }); m.takeEvents(); return m; };
const safeOf = (m, id) => m.p(id).hand.find(d => m.p(id).discs[d] === "safe");
const trapOf = (m, id) => m.p(id).hand.find(d => m.p(id).discs[d] === "trap");
/** يضع الجميعُ لذيذة، ويبدأ الدورُ بالمقعد المطلوب */
function placeAll(m, first = "a", trapFor = []) {
  m.starter = first;
  for (const x of m.alive()) m.place(x.id, trapFor.includes(x.id) ? trapOf(m, x.id) : safeOf(m, x.id));
}

console.log("\n═══ قواعد «البسكويتة الحارّة» ═══\n");

console.log("① التجهيز والحجب");
{
  const m = mk();
  ok(m.players.every(x => Object.keys(x.discs).length === 4 && Object.values(x.discs).filter(t => t === "trap").length === 1),
     "لكلٍّ أربعُ ماكارونات: ثلاثٌ لذيذة وواحدةٌ حارّة");
  ok(m.phase === "placement" && m.round === 1, "الجولة الأولى: الوضعُ الإجباريّ");
  throws(() => new SpicyMatch(P3.slice(0, 2)), /٣ إلى ٦/, "لاعبان لا يكفيان");
  const v = m.view("a");
  ok(v.players[0].hand.length === 4 && v.players[0].hand.every(d => d.t), "أرى يدي وأنواعها");
  ok(v.players[1].hand === null && v.players[1].handN === 4, "ويدُ غيري عددٌ فقط");
  const ids = Object.keys(m.p("a").discs);
  ok(!ids.some(d => /:0$/.test(d)), "ومعرّفاتُ الماكارونات عشوائيّة (لا تفضح الحارّة)", ids);
}

console.log("② الوضعُ الإجباريّ ثمّ الدور");
{
  const m = mk();
  m.starter = "b";
  m.place("a", safeOf(m, "a"));
  throws(() => m.place("a", safeOf(m, "a")), /انتظر/, "ماكارونةٌ واحدةٌ في الوضع الإجباريّ");
  ok(m.phase === "placement", "لا تبدأ المرحلةُ التالية قبل أن يضع الجميع");
  m.place("b", trapOf(m, "b")); m.place("c", safeOf(m, "c"));
  ok(m.phase === "action" && m.turn === "b", "وضع الجميع ⇒ الدورُ لمن يبدأ الجولة");
  const vc = m.view("c");
  ok(vc.players[1].stack.length === 1 && vc.players[1].stack[0].t === null && !("id" in vc.players[1].stack[0]),
     "كومةُ غيري مقلوبة: لا نوعَ ولا معرّف");
  eq(m.view("b").players[1].stack[0].t, "trap", "وكومتي أعرف ما فيها");
  throws(() => m.place("c", safeOf(m, "c")), /ليس دورك/, "الإضافةُ في دورك وحده");
  m.place("b", safeOf(m, "b"));
  ok(m.p("b").stack.length === 2 && m.turn === "c", "أضاف ⇒ الدورُ للتالي باتّجاه الساعة");
}

console.log("③ المزاد");
{
  const m = mk();
  placeAll(m, "a");
  m.place("a", safeOf(m, "a"));                    /* الطاولة: ٤ */
  throws(() => m.raise("b", 5), /أكثرُ ما يمكن/, "لا مزايدةَ فوق مجموع الطاولة");
  throws(() => m.raise("b", 0), /١ فأكثر/, "ولا أقلّ من ١");
  m.raise("b", 2);
  ok(m.phase === "auction" && m.bid.amount === 2 && m.turn === "c", "أوّلُ مزايدة تفتح المزاد");
  throws(() => m.place("c", safeOf(m, "c")), /لا إضافةَ/, "وتُقفل الإضافةَ للجميع");
  throws(() => m.raise("c", 2), /ارفع فوق ٢|ارفع فوق 2/, "ورفعٌ لا يقلّ عن الحاليّ + ١");
  m.pass("c");
  ok(m.p("c").status === "passed" && m.turn === "a", "انسحب ⇒ مظلّلٌ لهذه الجولة");
  m.raise("a", 3);
  ok(m.turn === "b", "ومن انسحب يُتخطّى");
  m.pass("b");
  ok(m.phase === "reveal" && m.bid.id === "a" && m.turn === "a", "لم يبقَ إلا أعلى مزايد ⇒ الكشف");
}
{
  const m = mk();
  placeAll(m, "a");
  m.raise("a", 3);
  ok(m.phase === "reveal", "مزايدةٌ بمجموع الطاولة ⇒ الكشفُ فورًا");
}

console.log("④ الكشف: القفلُ الذكيّ");
{
  const m = mk();
  placeAll(m, "a");
  m.place("a", safeOf(m, "a")); m.place("b", safeOf(m, "b")); m.place("c", safeOf(m, "c"));   /* ٦ */
  m.raise("a", 4); m.pass("b"); m.pass("c");
  eq(m.view("a").flippable, ["a"], "المتحدّي يقلب كومتَه هو أوّلًا");
  throws(() => m.flip("a", "b"), /أوّلًا/, "ولا يقلب غيرَها قبلها (🔒)");
  throws(() => m.flip("b", "b"), /المتحدّي وحده/, "وغيرُه لا يقلب");
  m.flip("a", "a");
  eq(m.view("a").flippable, ["a"], "والكومةُ من الأعلى حتى آخرها");
  m.flip("a", "a");
  eq(m.view("a").flippable.sort(), ["b", "c"], "انتهت كومتُه ⇒ أعلى كومة أيّ لاعبٍ آخر");
  m.flip("a", "b");
  ok(m.view("c").players[1].stack[1].up && m.view("c").players[1].stack[1].t === "safe", "المقلوبةُ يراها الجميع");
  m.flip("a", "c");
  ok(m.phase === "result" && m.p("a").stars === 1 && m.result.ok, "بلغ العددَ بلا حارّة ⇒ نجمة ⭐");
  m.nextRound();
  ok(m.round === 2 && m.phase === "placement" && m.p("a").hand.length === 4 && !m.p("b").stack.length, "جولةٌ جديدة: الماكاروناتُ تعود لأصحابها");
  eq(m.starter, "a", "ويبدؤها الناجح");
}

console.log("⑤ الفشل والعقاب والإقصاء");
{
  const m = mk();
  placeAll(m, "a", ["b"]);                          /* حارّةُ نورة على الطاولة */
  m.raise("a", 2); m.pass("b"); m.pass("c");
  m.flip("a", "a");
  m.takeEvents();
  m.flip("a", "b");
  ok(m.phase === "result" && !m.result.ok && m.result.trapOwner === "b", "صادف حارّةً ⇒ فشلٌ فوريّ");
  ok(Object.keys(m.p("a").discs).length === 3 && m.p("a").lost.length === 1, "ويخسر ماكارونةً واحدةً نهائيًّا");
  const raw = m.takeEvents();
  const forA = m.eventsFor(raw, "a"), forB = m.eventsFor(raw, "b");
  ok(forA.some(e => e.t === "lost" && e.kind) && !forB.some(e => e.t === "lost"), "نوعُ ما خسره يعرفه هو وحده");
  ok(m.view("b").players[0].lost === 1 && m.view("b").players[0].owned === 3, "والبقيّةُ يعرفون العددَ فقط");
  ok(Array.isArray(m.view("a").players[0].lost) && m.view("a").players[0].lost[0].t, "وهو يرى ما خسر");
}
{
  /* حارّتُه هو تُفشله كذلك */
  const m = mk();
  placeAll(m, "a", ["a"]);
  m.raise("a", 1); m.pass("b"); m.pass("c");
  m.flip("a", "a");
  ok(!m.result.ok && m.result.trapOwner === "a", "وحارّتُه هو تُفشله أيضًا");
}
{
  /* الإقصاء: آخرُ ماكارونةٍ تضيع ⇒ يخرج، ويبدأ الجولةَ صاحبُ الحارّة */
  const m = mk();
  const A = m.p("a");
  /* بقيت له لذيذةٌ واحدة */
  Object.keys(A.discs).filter(d => A.discs[d] === "trap").concat(Object.keys(A.discs).filter(d => A.discs[d] === "safe").slice(1)).forEach(d => delete A.discs[d]);
  m.startRound();
  placeAll(m, "a", ["b"]);
  m.raise("a", 2); m.pass("b"); m.pass("c");
  m.flip("a", "a"); m.flip("a", "b");
  ok(A.out && A.status === "eliminated", "نفدت ماكاروناتُه ⇒ أُقصي");
  eq(m.starter, "b", "ويبدأ الجولةَ التاليةَ صاحبُ الحارّة");
  m.nextRound();
  ok(!m.alive().some(x => x.id === "a") && m.p("a").hand.length === 0, "والمُقصى لا يلعب بعدها");
}

console.log("⑥ نهاية اللعبة");
{
  const m = mk();
  m.p("c").stars = 1;
  placeAll(m, "c");
  m.raise("c", 3);
  m.flip("c", "c");
  m.flip("c", m.view("c").flippable[0]); m.flip("c", m.view("c").flippable[0]);
  ok(m.phase === "over" && m.winner === "c" && m.reason === "stars", "نجمتان ⇒ فوز");
  eq(m.view("a").ranking[0].id, "c", "والترتيبُ يبدأ بالفائز");
  ok(m.view("a").players[1].stack.every(d => d.t), "وفي النهاية تُكشف الكومُ كلُّها");
}
{
  const m = mk();
  for (const id of ["a", "b"]) { const x = m.p(id); Object.keys(x.discs).filter(d => x.discs[d] === "trap").concat(Object.keys(x.discs).filter(d => x.discs[d] === "safe").slice(1)).forEach(d => delete x.discs[d]); }
  m.startRound();
  placeAll(m, "a", ["c"]);
  m.raise("a", 2); m.pass("b"); m.pass("c");
  m.flip("a", "a"); m.flip("a", "c");
  ok(m.p("a").out && m.phase === "result", "(أُقصي الأوّل)");
  m.nextRound();
  placeAll(m, "b", ["c"]);
  m.raise("b", 2);                                 /* = مجموعُ الطاولة ⇒ كشفٌ فوريّ */
  m.flip("b", "b"); m.flip("b", "c");
  ok(m.phase === "over" && m.winner === "c" && m.reason === "last", "بقي لاعبٌ واحد ⇒ يفوز (آخرُ الصامدين)", { w: m.winner, r: m.reason });
  eq(m.ranking().map(r => r.id), ["c", "b", "a"], "والخارجون: الأحدثُ خروجًا أعلى");
}

console.log("⑦ المهلة والبوت ومبارياتٌ كاملة");
{
  const m = mk();
  m.place("a", safeOf(m, "a"));
  eq(m.timeout().sort(), ["b", "c"], "مهلةُ الوضع: يُوضع عن المتأخّرين");
  ok(m.phase === "action", "فيبدأ الدور");
  const t = m.turn;
  m.timeout();
  ok(m.turn !== t || m.phase !== "action", "ومهلةُ الدور: فعلٌ عن صاحبه");
}
{
  let bad = 0, rounds = 0, wins = { stars: 0, last: 0 };
  for (let g = 0; g < 400; g++) {
    const pl = [...Array(3 + (g % 4))].map((_, i) => ({ id: "p" + i, name: "ب" + i }));
    const rng = rngFrom(100 + g);
    const m = new SpicyMatch(pl, { rng });
    let guard = 0;
    try {
      while (m.phase !== "over" && guard++ < 5000) {
        if (m.phase === "result") { m.nextRound(); continue; }
        const w = m.waitingFor();
        if (!w.length) throw new Error("لا أحدَ ينتظر في " + m.phase);
        for (const id of w) { const d = decide(m.view(id), rng); if (!d) throw new Error("البوت بلا فعل في " + m.phase); m.act(id, d); if (m.phase !== "placement") break; }
        /* الحجبُ: لا يرى أحدٌ نوعَ ماكارونةٍ مقلوبةٍ لغيره */
        if (m.phase !== "over") for (const x of m.players) for (const y of m.view(x.id).players) if (y.id !== x.id && y.stack.some(d => !d.up && d.t)) throw new Error("تسريب");
      }
      if (m.phase !== "over") bad++; else { wins[m.reason]++; rounds += m.round; }
    } catch (e) { bad++; if (bad < 3) console.log("   ", e.message); }
  }
  ok(bad === 0, "٤٠٠ مباراةٍ عشوائيّة (٣–٦ لاعبين) تنتهي كلُّها بلا خطأ ولا تسريب", bad);
  ok(wins.stars > 0 && wins.last >= 0, "تنتهي بالنجمتين غالبًا (وبآخر الصامدين أحيانًا)", wins);
  console.log("    متوسّطُ الجولات:", (rounds / 400).toFixed(1), wins);
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
