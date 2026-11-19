// اختبار قواعد «رسالة حب»: التجهيز، وقدراتُ البطاقات الثمان، والكونتيسة،
// والخادمة، ونهايةُ الجولة والتعادل، والنجوم، وحجبُ العرض — ثمّ آلافُ
// المباريات بين البوتات مع فحص حفظ البطاقات في كلّ خطوة.
"use strict";
const L = require("./loverules");
const { LoveMatch, decide, rngFrom, TARGET } = L;

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; if (!c) console.log("  ❌ " + m + " → " + JSON.stringify(x)); };
const T = (name, fn) => { try { fn(); } catch (e) { F++; console.log("  ❌ " + name + " — " + e.stack.split("\n").slice(0, 3).join(" | ")); } };
const throws = (fn, re, m) => { try { fn(); ok(false, m, "لم يرمِ"); } catch (e) { ok(!re || re.test(e.message), m, e.message); } };
const PL = n => Array.from({ length: n }, (_, i) => ({ id: "p" + i, name: "لاعب" + i }));

/** مباراةٌ مضبوطة: الدورُ لـ p0 بيده hand، وأيدي البقيّة، والكومة */
function rig(n, hand, others, deck) {
  const m = new LoveMatch(PL(n), { rng: rngFrom(7) });
  m.takeEvents();
  m.turn = "p0";
  m.players[0].hand = hand.slice();
  others.forEach((h, i) => { m.players[i + 1].hand = [h]; });
  for (const x of m.players) { x.out = false; x.protected = false; x.discards = []; }
  m.deck = deck ? deck.slice() : [1, 1, 2, 3];
  m.know = {};
  m.phase = "turn";
  return m;
}
const total = m => m.deck.length + (m.burned != null ? 1 : 0) + m.faceUp.length +
  m.players.reduce((n, x) => n + x.hand.length + x.discards.length, 0);

console.log("\n═══ رسالة حب — القواعد ═══\n");

T("التجهيز", () => {
  for (const n of [2, 3, 4]) {
    const m = new LoveMatch(PL(n), { rng: rngFrom(n) });
    ok(total(m) === 16, n + " لاعبين: ١٦ بطاقة محفوظة", total(m));
    ok(m.target === TARGET[n] && TARGET[2] === 7 && TARGET[3] === 5 && TARGET[4] === 4, "النجوم ٧/٥/٤", m.target);
    ok(m.faceUp.length === (n === 2 ? 3 : 0), "ثلاثٌ مكشوفة مع لاعبَين فقط", m.faceUp);
    ok(m.p(m.turn).hand.length === 2 && m.players.filter(x => x.id !== m.turn).every(x => x.hand.length === 1), "صاحبُ الدور سحب: معه اثنتان", m.players.map(x => x.hand));
    const v = m.view(m.players.find(x => x.id !== m.turn).id);
    ok(v.players.filter(x => x.id !== v.me).every(x => x.hand === null) && !("deck" in v) && !("burned" in v), "العرضُ يحجب أيدي غيري والكومة والمحروقة");
    const ev = m.takeEvents();
    ok(ev.some(e => e.t === "drew" && e._only === m.turn), "السحبُ حدثٌ خاصٌّ بصاحبه");
  }
  ok(L.fullDeck().length === 16 && L.fullDeck().filter(c => c === 1).length === 5, "الحزمة: ١٦ منها ٥ حرّاس");
});

T("الحارس", () => {
  let m = rig(3, [1, 4], [5, 2]);
  throws(() => m.play("p0", 1, { target: "p1", guess: 1 }), /لا تخمين للحارس|من ٢/, "لا يُخمَّن الحارس");
  throws(() => m.play("p0", 1, { target: "p0", guess: 3 }), /هدف/, "ولا تستهدف نفسك");
  m.play("p0", 1, { target: "p1", guess: 5 });
  ok(m.p("p1").out && m.p("p1").discards.includes(5), "تخمينٌ صحيح ⇒ خرج وكُشفت بطاقته", m.p("p1"));
  ok(m.log[0].hit === true && m.turn === "p2", "السجلّ يذكر الإصابة، والدورُ للتالي", [m.log, m.turn]);
  m = rig(3, [1, 4], [5, 2]);
  m.play("p0", 1, { target: "p1", guess: 6 });
  ok(!m.p("p1").out && m.log[0].hit === false, "تخمينٌ خاطئ ⇒ لا شيء");
});

T("الكاهن", () => {
  const m = rig(3, [2, 4], [6, 3]);
  m.play("p0", 2, { target: "p2" });
  const ev = m.takeEvents();
  const peek = ev.find(e => e.t === "peek");
  ok(peek && peek._only === "p0" && peek.card === 3, "يرى بطاقتَه وحده", peek);
  ok(m.eventsFor(ev, "p1").every(e => e.t !== "peek"), "ولا يصل غيرَه");
  ok(m.view("p0").known.p2 === 3 && !m.view("p1").known.p2, "ويبقى في معرفته (known)", m.view("p0").known);
});

T("البارون", () => {
  let m = rig(3, [3, 6], [4, 2]);
  m.play("p0", 3, { target: "p1" });
  ok(m.p("p1").out && !m.p("p0").out && m.log[0].loser === "p1", "الأقلّ يخرج (٤ أمام ٦)", m.log[0]);
  const ev = m.takeEvents().filter(e => e.t === "baron");
  ok(ev.length === 2 && ev.find(e => e._only === "p0").theirs === 4 && ev.find(e => e._only === "p1").theirs === 6, "كلٌّ يرى بطاقةَ الآخر سرًّا", ev);
  m = rig(3, [3, 2], [4, 2]);
  m.play("p0", 3, { target: "p1" });
  ok(m.p("p0").out && m.log[0].loser === "p0", "ومن لعبه يخرج إن كان أقلّ");
  m = rig(3, [3, 4], [4, 2]);
  m.play("p0", 3, { target: "p1" });
  ok(!m.p("p0").out && !m.p("p1").out && m.log[0].loser === null, "التعادل: لا شيء");
  ok(m.view("p0").known.p1 === 4 && m.view("p1").known.p0 === 4, "وكلاهما صار يعرف بطاقةَ الآخر");
});

T("الخادمة", () => {
  const m = rig(3, [4, 1], [5, 2], [1, 2, 3, 3, 1, 1]);
  m.play("p0", 4);
  ok(m.p("p0").protected, "صار محميًّا");
  /* دور p1: لا يستهدفه */
  m.p("p1").hand = [1, 6];
  throws(() => m.play("p1", 1, { target: "p0", guess: 4 }), /محمي/, "لا يُستهدف المحميّ");
  ok(m.view("p1").legal.targets[1].join() === "p2", "الأهدافُ الجائزة تستثنيه", m.view("p1").legal);
  m.play("p1", 6, { target: "p2" });
  m.p("p2").hand = [1, 5];
  m.p("p1").protected = true;
  /* p2: الكلُّ محميٌّ إلا هو — الحارسُ بلا أثر، والأميرُ على نفسه فقط */
  const lg = m.view("p2").legal;
  ok(lg.targets[1].length === 0 && lg.targets[5].join() === "p2", "الكلُّ محميّ: الحارسُ بلا هدف، والأميرُ على نفسك", lg);
  m.play("p2", 1, {});
  ok(m.log[m.log.length - 1].noEffect === true, "ويُلعب بلا أثر", m.log[m.log.length - 1]);
  ok(m.turn === "p0" && !m.p("p0").protected, "تسقط الحمايةُ حين يعود دورُه", [m.turn, m.p("p0").protected]);
});

T("الأمير", () => {
  let m = rig(3, [5, 2], [8, 3], [1, 6]);
  m.play("p0", 5, { target: "p1" });
  ok(m.p("p1").out && m.log[0].discarded === 8, "رمى الأميرة ⇒ خرج", m.log[0]);
  m = rig(3, [5, 2], [4, 3], [1, 6]);
  m.play("p0", 5, { target: "p1" });
  ok(!m.p("p1").out && m.p("p1").hand[0] === 6 && m.p("p1").discards.includes(4), "رمى بطاقتَه وسحب من الكومة (بلا تنفيذ قدرتها)", m.p("p1"));
  m = rig(3, [5, 2], [4, 3], []);
  m.burned = 7;
  m.deck = [];
  m.play("p0", 5, { target: "p0" });
  ok(m.p("p0").hand[0] === 7 && m.burned === null && m.log[0].fromBurn, "الكومةُ فارغة ⇒ يسحب المحروقة", m.p("p0").hand);
  ok(m.phase !== "turn", "ثمّ تنتهي الجولة (لا كومة)", m.phase);
});

T("الملك", () => {
  const m = rig(3, [6, 2], [8, 3], [1, 1, 1, 1]);
  m.know = { p2: { p1: 8 } };
  m.play("p0", 6, { target: "p1" });
  ok(m.p("p0").hand[0] === 8 && m.p("p1").hand[0] === 2, "تبادلا البطاقتين", m.players.map(x => x.hand));
  ok(m.view("p0").known.p1 === 2 && m.view("p1").known.p0 === 8, "وكلاهما يعرف ما عند الآخر");
  ok(m.view("p2").known.p0 === 8 && !m.view("p2").known.p1, "ومن عرف الأميرةَ عند p1 صار يعرفها عند p0", m.view("p2").known);
});

T("الكونتيسة والأميرة", () => {
  let m = rig(3, [7, 6], [1, 2]);
  ok(m.view("p0").legal.forced && m.view("p0").legal.cards.join() === "7", "مع الملك: الكونتيسة إجباريّة");
  throws(() => m.play("p0", 6, { target: "p1" }), /الكونتيسة/, "لا يُلعب الملك");
  m.play("p0", 7);
  ok(m.p("p0").hand[0] === 6 && !m.p("p0").out, "رماها واحتفظ بالملك");
  m = rig(3, [7, 5], [1, 2]);
  ok(m.view("p0").legal.cards.join() === "7", "ومع الأمير كذلك");
  m = rig(3, [7, 3], [1, 2]);
  ok(m.view("p0").legal.cards.length === 2, "ومع غيرهما: حرّ");
  m = rig(3, [8, 3], [1, 2]);
  m.play("p0", 8);
  ok(m.p("p0").out && m.p("p0").discards.includes(3), "لعب الأميرة ⇒ خرج", m.p("p0"));
});

T("نهاية الجولة", () => {
  let m = rig(3, [2, 6], [5, 3], [4]);
  m.play("p0", 2, { target: "p1" });                       /* p1 يسحب آخر بطاقة */
  m.play("p1", 4);                                          /* الكومةُ فرغت بعد دوره */
  ok(m.phase === "result" && m.result.reason === "deck" && m.result.winners.join() === "p0", "الكومةُ فرغت ⇒ الأعلى يكسب", m.result);
  ok(m.p("p0").stars === 1 && m.result.hands.p2 === 3, "نجمة، وتُكشف الأيدي", m.result);
  ok(m.view("p2").players.find(x => x.id === "p0").hand[0] === 6, "والعرضُ يكشفها للجميع بعد الجولة");
  /* تعادلٌ يحسمه المرميّ */
  m = rig(3, [3, 6], [6, 1], []);
  m.deck = [];
  m.players[1].discards = [5, 1];
  m.players[0].discards = [2];
  m.play("p0", 3, { target: "p2" });                        /* p2 (١) يخرج؛ ثمّ لا كومة */
  ok(m.result.reason === "deck" && m.result.tie && m.result.winners.join() === "p1", "تعادلٌ ٦–٦: يكسب صاحبُ المرميّ الأكبر", m.result);
  /* تعادلٌ تامّ: يكسبان معًا */
  m = rig(2, [2, 6], [6], []);
  m.deck = []; m.players[1].discards = [2];
  m.play("p0", 2, { target: "p1" });
  ok(m.result.winners.length === 2 && m.players.every(x => x.stars === 1), "تعادلٌ تامّ: نجمةٌ لكلٍّ", m.result);
  /* آخرُ من بقي */
  m = rig(2, [1, 3], [5], [2, 2, 2]);
  m.play("p0", 1, { target: "p1", guess: 5 });
  ok(m.result.reason === "last" && m.result.winners.join() === "p0" && m.starter === "p0", "آخرُ من بقي يكسب ويبدأ الجولةَ التالية", m.result);
  m.nextRound();
  ok(m.round >= 2 && m.phase === "turn" && m.turn === "p0" && total(m) === 16, "جولةٌ جديدة بحزمةٍ كاملة", [m.round, m.turn, total(m)]);
});

T("الفوز باللعبة", () => {
  const m = rig(4, [1, 3], [5, 2, 2], [2, 2, 2]);
  m.players[0].stars = 3;
  m.p("p1").hand = [5];
  m.play("p0", 1, { target: "p1", guess: 5 });
  m.p("p2").hand = [2, 1]; m.p("p2").hand = [1, 2];
  m.play("p2", 1, { target: "p3", guess: 2 });
  m.p("p0").hand = [1, 8]; m.play("p0", 1, { target: "p2", guess: 2 });
  ok(m.phase === "over" && m.winner === "p0" && m.p("p0").stars === 4, "٤ نجوم مع ٤ لاعبين ⇒ فاز", [m.phase, m.players.map(x => x.stars)]);
  ok(m.view("p3").ranking[0].id === "p0", "والترتيبُ يبدأ به");
});

T("البوت", () => {
  let m = rig(3, [5, 2], [8, 3], [1, 1, 1]);
  m.know = { p0: { p1: 8 } };
  let d = decide(m.view("p0"), rngFrom(3));
  ok(d.card === 5 && d.target === "p1", "يعرف الأميرة ⇒ أميرٌ عليها", d);
  m = rig(3, [1, 4], [6, 3], [1, 1, 1]);
  m.know = { p0: { p2: 3 } };
  d = decide(m.view("p0"), rngFrom(3));
  ok(d.card === 1 && d.target === "p2" && d.guess === 3, "يعرف البارون ⇒ حارسٌ يصيب", d);
  m = rig(3, [8, 4], [6, 3], [1, 1, 1]);
  d = decide(m.view("p0"), rngFrom(3));
  ok(d.card === 4, "لا يرمي الأميرة", d);
  m = rig(3, [7, 6], [1, 3]);
  d = decide(m.view("p0"), rngFrom(3));
  ok(d.card === 7, "يحترم الكونتيسة", d);
});

T("آلافُ المباريات", () => {
  let games = 0, rounds = 0, err = 0, cons = 0, wins = { 2: 0, 3: 0, 4: 0 }, stuck = 0;
  const reasons = { last: 0, deck: 0 };
  for (let s = 1; s <= 1500; s++) {
    const n = 2 + (s % 3);
    const rng = rngFrom(s * 7919);
    const m = new LoveMatch(PL(n), { rng });
    let steps = 0;
    while (m.phase !== "over" && steps < 5000) {
      steps++;
      if (m.phase === "result") { rounds++; reasons[m.result.reason]++; m.nextRound(); continue; }
      const v = m.view(m.turn);
      const d = decide(v, rng);
      try { m.act(m.turn, d); } catch (e) { err++; if (err < 4) console.log("   خطأ:", e.message, JSON.stringify(d), JSON.stringify(v.legal)); break; }
      if (total(m) !== 16) { cons++; break; }
      for (const x of m.players) if (!x.out && x.hand.length !== (m.turn === x.id && m.phase === "turn" ? 2 : 1)) { cons++; break; }
      m.takeEvents();
    }
    if (m.phase !== "over") stuck++;
    else { games++; if (m.p(m.winner).stars >= m.target) wins[n]++; }
  }
  ok(err === 0, "البوتُ يلعب دائمًا لعبًا جائزًا", err);
  ok(cons === 0, "١٦ بطاقة في كلّ خطوة، ويدٌ صحيحة لكلّ لاعب", cons);
  ok(stuck === 0 && games === 1500, "كلُّ مباراةٍ تنتهي", { games, stuck });
  ok(wins[2] + wins[3] + wins[4] === games, "والفائزُ بلغ النجوم المطلوبة", wins);
  ok(reasons.last > 0 && reasons.deck > 0, "الجولاتُ تنتهي بالطريقتين", reasons);
  console.log("   ", games, "مباراة،", rounds, "جولة —", JSON.stringify(reasons));
});

T("المهلة", () => {
  const m = rig(3, [7, 5], [1, 2]);
  const who = m.timeout();
  ok(who.join() === "p0" && m.p("p0").discards.includes(7) && m.turn === "p1", "تُلعب بطاقةٌ جائزةٌ عن المتأخّر", m.log);
});

console.log(`\n${F ? "❌" : "✅"} ${P} نجح، ${F} فشل\n`);
process.exit(F ? 1 : 0);
