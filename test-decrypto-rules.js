// اختبار قواعد «فكّ الشفرة» (decryptorules.js): الفرق والكلمات والشفرات،
// والحجبُ لكلّ لاعب، والتلميحات وشروطها، وورقتا التخمين المشتركتان،
// والكشفُ والنقاط، والفوزُ والخسارةُ وكسرُ التعادل، والمهلُ والغياب.

const D = require("./decryptorules");
const { DecryptoMatch } = D;

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const throws = (f, re, m) => { try { f(); ok(false, m, "لم يُرفض"); } catch (e) { ok(!re || re.test(e.message), m, e.message); } };

const WORDS = ["شمس", "باب", "تفاحة", "قطار", "قمر", "كتاب", "بحر", "سيارة", "نخلة", "قلم"];
const deal = n => WORDS.slice(0, n);
let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const P4 = [
  { id: "a1", name: "سعود", team: 0 }, { id: "b1", name: "نورة", team: 1 },
  { id: "a2", name: "فهد", team: 0 }, { id: "b2", name: "ريم", team: 1 }
];
const mk = (players = P4) => { seed = 7; const m = new DecryptoMatch(players, { deal, rng }); m.takeEvents(); return m; };
const enc = (m, t) => m.cur[t].encryptor;
let clueN = 0;
const fresh = () => { clueN++; return ["ريح" + clueN, "نور" + clueN, "ظل" + clueN]; };
const sendBoth = m => { m.submitClues(enc(m, 0), fresh()); m.submitClues(enc(m, 1), fresh()); };
/** يملأ ورقةَ فريقٍ ويوافق كلُّ محرّريها */
function answer(m, t, kind, code) {
  const eds = m.editors(t, kind);
  code.forEach((v, i) => m.setSlot(eds[0], kind, i, v));
  for (const id of eds) if (m.member(id).on && !m.cur[t][kind].locked) m.confirm(id, kind, true);
}
const wrong = c => { const w = c.slice(); [w[0], w[1]] = [w[1], w[0]]; return w; };
const nextRound = m => { for (const p of m.players) if (p.on) m.readyNext(p.id); };
/** جولةٌ كاملة: dec/int لكلّ فريق: true = صحيح، false = خطأ */
function play(m, decA, decB, intA, intB) {
  sendBoth(m);
  answer(m, 0, "dec", decA ? m.cur[0].code : wrong(m.cur[0].code));
  answer(m, 1, "dec", decB ? m.cur[1].code : wrong(m.cur[1].code));
  if (m.intercepting()) {
    answer(m, 0, "int", intA ? m.cur[1].code : wrong(m.cur[1].code));
    answer(m, 1, "int", intB ? m.cur[0].code : wrong(m.cur[0].code));
  }
}

console.log("\n═══ قواعد «فكّ الشفرة» ═══\n");

console.log("① التجهيز");
{
  const m = mk();
  eq(m.teams.map(T => T.players), [["a1", "a2"], ["b1", "b2"]], "فريقان بترتيب الجلوس");
  eq(m.teams.map(T => T.secretWords), [["شمس", "باب", "تفاحة", "قطار"], ["قمر", "كتاب", "بحر", "سيارة"]], "أربعُ كلماتٍ لكلّ فريق من ثمانٍ مسحوبة");
  ok(m.round === 1 && m.phase === "clues", "الجولة الأولى: التلميحات");
  eq([enc(m, 0), enc(m, 1)], ["a1", "b1"], "المُشفِّرُ الأوّل أوّلُ كلّ فريق");
  ok(m.cur.every(c => D.complete(c.code)), "الشفرةُ ثلاثةُ أرقامٍ مختلفة من ١–٤", m.cur.map(c => c.code));
  eq(D.ALL_CODES.length, 24, "٢٤ شفرةً ممكنة");
  throws(() => new DecryptoMatch([{ id: "x", team: 0 }, { id: "y", team: 1 }, { id: "z", team: 1 }], { deal }), /لاعبَين/, "فريقٌ بلاعبٍ واحد يُرفض");
  throws(() => new DecryptoMatch(P4, { deal: () => ["أ"] }), /الكلمات/, "وكلماتٌ لا تكفي تُرفض");
}

console.log("② الحجب");
{
  const m = mk();
  const va = m.view("a2"), vb = m.view("b2");
  eq(va.teams[0].words, ["شمس", "باب", "تفاحة", "قطار"], "أرى كلمات فريقي");
  ok(va.teams[1].words === null && vb.teams[0].words === null, "ولا أرى كلمات الخصم (ولا يرى كلماتي)");
  ok(va.cur[0].code === null && va.cur[1].code === null, "المحلّلُ لا يرى شفرةَ فريقه ولا شفرةَ الخصم");
  ok(D.complete(m.view("a1").cur[0].code) && m.view("a1").cur[1].code === null, "المُشفِّرُ يرى شفرتَه وحده");
  m.submitClues("a1", ["أحمر", "أصفر", "سكة"]);
  ok(m.view("a1").cur[0].clues && m.view("a2").cur[0].clues === null && m.view("b1").cur[0].clues === null,
     "تلميحاتٌ أُرسلت لا تُبثّ حتى يرسل المُشفِّران كلاهما");
  ok(m.view("b2").cur[0].sent === true, "لكن يُرى أنّها أُرسلت");
  m.submitClues("b1", ["ليل", "ورق", "موج"]);
  eq(m.view("b2").cur[0].clues, ["أحمر", "أصفر", "سكة"], "ثمّ تُبثّ للفريقين معًا");
  ok(m.phase === "guess", "ويبدأ التخمين");
  answer(m, 0, "dec", [1, 2, 3].slice(0, 2).concat([4]));
  const vb2 = m.view("b2");
  ok(vb2.cur[0].dec.draft === undefined && vb2.cur[0].dec.final === null, "ورقةُ الخصم لا تُرى قبل الكشف");
}

console.log("③ التلميحات");
{
  const m = mk();
  throws(() => m.submitClues("a2", ["أ", "ب", "ج"]), /المُشفِّرُ وحده/, "غيرُ المُشفِّر لا يكتب");
  throws(() => m.submitClues("a1", ["أحمر", "أصفر"]), /ثلاثة/, "ثلاثةٌ لا أقلّ");
  throws(() => m.submitClues("a1", ["أحمر", "", "سكة"]), /كلَّها/, "ولا فارغ");
  throws(() => m.submitClues("a1", ["أحمر فاتح", "أصفر", "سكة"]), /كلمةٌ واحدة/, "كلُّ تلميحٍ كلمةٌ واحدة");
  throws(() => m.submitClues("a1", ["التفاحة", "أصفر", "سكة"]), /كلماتكم/, "ولا إحدى كلماتنا («التفاحة» = تفاحة)");
  throws(() => m.submitClues("a1", ["شمسية", "أصفر", "سكة"]), /عائلتها/, "ولا من عائلتها (شمسية ⊃ شمس)");
  throws(() => m.submitClues("a1", ["أحمر", "الأحمر", "سكة"]), /مختلفة/, "والثلاثةُ مختلفة بعد التطبيع");
  ok(m.clueProblem(0, ["قمر", "بحر", "نخلة"]) === null, "كلماتُ الخصم ليست ممنوعةً على فريقي (لا يعرفها)");
  m.submitClues("a1", ["أحمر", "أصفر", "سكة"]);
  throws(() => m.submitClues("a1", ["ا", "ب", "ج"]), /أرسلت/, "ولا يُرسل مرّتين");
  m.submitClues("b1", ["ليل", "ورق", "موج"]);
  answer(m, 0, "dec", m.cur[0].code); answer(m, 1, "dec", m.cur[1].code);
  nextRound(m);
  ok(m.round === 2, "(الجولة الثانية)");
  ok(m.clueProblem(0, ["الأحمر", "ب", "ج"]) && /سابقة/.test(m.clueProblem(0, ["الأحمر", "بوق", "جرس"])), "وتلميحٌ استُعمل في جولةٍ سابقة يُرفض");
}

console.log("④ ورقتا التخمين");
{
  const m = mk();
  sendBoth(m);
  eq(m.sheetsOf(0), ["dec"], "الجولة الأولى: فكُّ شفرة الزميل وحده (لا اعتراض)");
  eq(m.editors(0, "dec"), ["a2"], "المُشفِّرُ لا يشارك في فكّ شفرته");
  throws(() => m.setSlot("a1", "dec", 0, 1), /ليست ورقتك/, "فلا يعبّئها");
  m.setSlot("b2", "dec", 0, 2);
  ok(m.cur[0].dec.draft[0] === null && m.cur[1].dec.draft[0] === 2, "والخصمُ يعبّئ ورقتَه هو لا ورقتنا");
  m.setSlot("a2", "dec", 0, 3); m.setSlot("a2", "dec", 1, 1);
  throws(() => m.confirm("a2", "dec"), /أكملوا/, "الموافقةُ بعد الأرقام الثلاثة");
  m.setSlot("a2", "dec", 2, 4);
  eq(m.cur[0].dec.draft, [3, 1, 4], "الخاناتُ تُملأ");
  m.setSlot("a2", "dec", 0, 4);
  eq(m.cur[0].dec.draft, [4, 1, 3], "ورقمٌ مكرّر يُبادل الخانةَ التي فيها (لا تكرار)");
  eq(m.view("a1").cur[0].dec.draft, [4, 1, 3], "والمُشفِّرُ يرى ما يكتبه فريقُه حيًّا");
}
{
  /* ثلاثة محلّلين: يوافقون جميعًا — وتغييرٌ يُسقط الموافقات */
  const pl = [
    { id: "a1", name: "١", team: 0 }, { id: "a2", name: "٢", team: 0 }, { id: "a3", name: "٣", team: 0 }, { id: "a4", name: "٤", team: 0 },
    { id: "b1", name: "٥", team: 1 }, { id: "b2", name: "٦", team: 1 }
  ];
  const m = mk(pl);
  sendBoth(m);
  m.setSlot("a2", "dec", 0, 1); m.setSlot("a3", "dec", 1, 2); m.setSlot("a4", "dec", 2, 3);
  m.confirm("a2", "dec"); m.confirm("a3", "dec");
  ok(!m.cur[0].dec.locked, "موافقةُ اثنين من ثلاثة لا تُقفل");
  m.setSlot("a4", "dec", 2, 4);
  eq(m.cur[0].dec.ok.size, 0, "وتغييرُ خانةٍ يُسقط الموافقات");
  m.confirm("a2", "dec"); m.confirm("a3", "dec");
  m.setOnline("a4", false);
  ok(m.cur[0].dec.locked && !m.cur[0].dec.auto, "غيابُ الثالث: يكفي الحاضرون فتُقفل");
  eq(m.cur[0].dec.final, [1, 2, 4], "بما وافقوا عليه");
  throws(() => m.setSlot("a2", "dec", 0, 3), /أُقفلت/, "ولا تُعدَّل بعد القفل");
  ok(m.phase === "guess", "والجولةُ تنتظر الفريقَ الآخر");
}

console.log("⑤ الكشفُ والنقاط وسجلُّ التلميحات");
{
  const m = mk();
  play(m, true, false);
  ok(m.phase === "reveal", "قُفلت الأوراق ⇒ الكشف");
  eq(m.teams.map(T => T.tokens), [{ intercept: 0, miscommunication: 0 }, { intercept: 0, miscommunication: 1 }],
     "الأزرقُ فكّ شفرتَه، والورديُّ أخطأ ⇒ سوءُ فهمٍ عليه");
  const v = m.view("b2");
  ok(v.cur[0].code && v.cur[1].code && v.result && v.result.teams[1].decOK === false, "الكشف: الشفرتان ونتيجةُ كلّ فريقٍ للجميع");
  eq(v.teams[0].words, null, "وكلماتُ الخصم تبقى مخفيّة");
  const log = m.teams[0].cluesLog[0];
  ok(log.round === 1 && D.complete(log.code) && log.clues.length === 3, "سجلُّ الأزرق: الجولةُ بشفرتها وتلميحاتها", log);
  eq(v.teams[0].log, m.teams[0].cluesLog, "والسجلُّ يُرى عند الخصم (ليفرز تلميحاتنا تحت أرقامها)");
  nextRound(m);
  ok(m.round === 2 && m.phase === "clues", "«التالي» من الجميع ⇒ الجولة الثانية");
  eq([enc(m, 0), enc(m, 1)], ["a2", "b2"], "والمُشفِّرُ يتناوب");
  sendBoth(m);
  eq(m.sheetsOf(0), ["dec", "int"], "ومن الجولة الثانية: اعتراضُ شفرة الخصم أيضًا");
  eq(m.editors(0, "int"), ["a1", "a2"], "والاعتراضُ للفريق كلِّه — المُشفِّرُ معهم");
  answer(m, 0, "dec", m.cur[0].code); answer(m, 1, "dec", m.cur[1].code);
  answer(m, 0, "int", m.cur[1].code);
  ok(m.phase === "guess", "(ورقةُ الوردي للاعتراض لم تُقفل)");
  answer(m, 1, "int", wrong(m.cur[0].code));
  eq(m.teams.map(T => T.tokens.intercept), [1, 0], "الأزرقُ اعترض شفرةَ الوردي ⇒ اعتراض ✅");
}

console.log("⑥ الفوز والخسارة");
{
  const m = mk();
  play(m, true, true); nextRound(m);
  play(m, true, true, true, false); nextRound(m);
  ok(m.phase === "clues", "اعتراضٌ واحد لا يكفي");
  play(m, true, true, true, false);
  ok(m.phase === "over" && m.winner === 0 && m.reason === "intercept", "اعتراضان ⇒ فوزٌ فوريّ", { w: m.winner, r: m.reason });
  const v = m.view("b2");
  ok(v.teams[0].words && v.teams[1].words && v.history.length === 3, "وفي النهاية تُكشف كلماتُ الفريقين والسجلُّ كلُّه");
}
{
  const m = mk();
  play(m, false, true); nextRound(m);
  play(m, false, true, false, false);
  ok(m.phase === "over" && m.winner === 1 && m.reason === "miscommunication", "سوءا فهمٍ ⇒ خسارة (يفوز الخصم)", { w: m.winner, r: m.reason });
}
{
  /* الفريقان «يفوزان» معًا: الأزرقُ باعتراضين، والورديُّ بسوءَي فهمٍ على الأزرق */
  const m = mk();
  play(m, false, true); nextRound(m);
  play(m, true, true, true, false); nextRound(m);
  play(m, false, true, true, false);
  ok(m.phase === "over" && m.reason === "both", "فوزٌ وخسارةٌ معًا ⇒ كسرُ التعادل", m.reason);
  eq(m.winner, 0, "الأكثرُ اعتراضًا يفوز (٢ مقابل ٠)");
}
{
  const m = mk();
  for (let r = 1; r <= 8; r++) {
    /* الأزرقُ اعترض مرّةً في الجولة ٢، والورديُّ لا شيء */
    play(m, true, true, r === 2, false);
    if (m.phase !== "over") nextRound(m);
  }
  ok(m.phase === "over" && m.reason === "rounds" && m.winner === 0, "ثماني جولات ⇒ الأكثرُ اعتراضًا", { r: m.reason, w: m.winner, round: m.round });
}
{
  const m = mk();
  for (let r = 1; r <= 8; r++) { play(m, r !== 3, true, r === 2, r === 4); if (m.phase !== "over") nextRound(m); }
  ok(m.phase === "over" && m.reason === "rounds" && m.winner === 1, "اعتراضٌ لكلٍّ ⇒ الأقلُّ سوءَ فهمٍ يفوز", { w: m.winner, t: m.teams.map(T => T.tokens) });
}
{
  const m = mk();
  for (let r = 1; r <= 8; r++) { play(m, true, true); if (m.phase !== "over") nextRound(m); }
  ok(m.phase === "over" && m.winner === null, "تساوٍ تامّ بعد الثماني ⇒ تعادل", { w: m.winner });
}

console.log("⑦ المهلة والغياب");
{
  const m = mk();
  m.submitClues("a1", fresh());
  m.timeout();
  ok(m.phase === "guess" && m.cur[1].autoClues && m.cur[1].clues.every(c => c === "—"), "انقضت مهلةُ التلميح ⇒ يمضي بلا تلميحاتٍ من لم يرسل");
  m.setSlot("a2", "dec", 0, 1);
  m.timeout();
  ok(m.phase === "reveal" && m.cur[0].dec.auto && m.teams[0].tokens.miscommunication === 1, "ومهلةُ التخمين تُقفل الأوراقَ بما فيها (ناقصةٌ ⇒ خطأ)");
  m.timeout();
  ok(m.round === 2 && m.phase === "clues", "ومهلةُ الكشف ⇒ الجولةُ التالية");
}
{
  const m = mk();
  m.setOnline("a1", false);
  ok(m.reassignEncryptor(0) && enc(m, 0) === "a2", "المُشفِّرُ غاب ولم يرسل ⇒ يتسلّم زميلٌ حاضر");
  ok(D.complete(m.view("a2").cur[0].code), "ويرى الشفرة");
  ok(!m.reassignEncryptor(1), "ولا يُنزع الدورُ من حاضر");
}
{
  const m = mk();
  sendBoth(m);
  m.setOnline("a2", false);
  ok(!m.cur[0].dec.locked, "انقطاعٌ قصير لا يُقفل الورقةَ فارغة");
  m.lockOrphans();
  ok(m.cur[0].dec.locked && m.cur[0].dec.auto, "وإزالةُ الغائب نهائيًّا تُقفلها بما فيها");
}
{
  const m = mk();
  play(m, true, true);
  m.readyNext("a1"); m.readyNext("a2"); m.readyNext("b1");
  ok(m.phase === "reveal", "«التالي» من بعضهم لا يكفي");
  m.setOnline("b2", false);
  ok(m.round === 2, "وغيابُ من لم يضغط يُكمله");
}
{
  const m = mk();
  m.forfeit(1);
  ok(m.phase === "over" && m.winner === 0 && m.reason === "forfeit", "فريقٌ غاب كلُّه ⇒ يفوز الآخر");
}
{
  /* مباراةٌ عشوائيّةٌ كاملة كثيرًا: لا خطأ، وتنتهي دائمًا في ثماني جولاتٍ أو أقلّ */
  let bad = 0;
  for (let g = 0; g < 300; g++) {
    seed = 1000 + g;
    const m = new DecryptoMatch(P4, { deal, rng });
    let guard = 0;
    while (m.phase !== "over" && guard++ < 50) {
      const r = () => rng() < 0.5;
      try {
        if (m.phase === "clues") sendBoth(m);
        if (m.phase === "guess") {
          answer(m, 0, "dec", r() ? m.cur[0].code : wrong(m.cur[0].code));
          answer(m, 1, "dec", r() ? m.cur[1].code : wrong(m.cur[1].code));
          if (m.intercepting()) {
            answer(m, 0, "int", rng() < .2 ? m.cur[1].code : wrong(m.cur[1].code));
            answer(m, 1, "int", rng() < .2 ? m.cur[0].code : wrong(m.cur[0].code));
          }
        }
        if (m.phase === "reveal") nextRound(m);
      } catch (e) { bad++; console.log(e.message); break; }
    }
    if (m.phase !== "over" || m.round > 8) bad++;
  }
  ok(bad === 0, "٣٠٠ مباراةٍ عشوائيّة تنتهي كلُّها بلا خطأ", bad);
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
