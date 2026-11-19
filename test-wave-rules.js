// اختبار قواعد «التخاطر» (waverules.js) وبنك بطاقاته (wavebank.js): الأدوارُ
// والتناوب، والحجب (الهدفُ للوسيط وحده ثمّ تُغلق الستارة)، والتلميحُ والتبديل،
// والمؤشرُ بموافقة الجميع، وتصويتُ الخصم بالأغلبيّة، والنقاطُ ±٣/±٨/±١٥ ونقطةُ
// الخصم، والفوزُ بعشر، والمهلُ والغياب.

const W = require("./waverules");
const { WaveMatch, scoreOf } = W;
const WB = require("./wavebank");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const throws = (f, re, m) => { try { f(); ok(false, m, "لم يُرفض"); } catch (e) { ok(!re || re.test(e.message), m, e.message); } };

let seed = 5;
const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const P4 = [
  { id: "a1", name: "سعود", team: 0 }, { id: "b1", name: "نورة", team: 1 },
  { id: "a2", name: "فهد", team: 0 }, { id: "b2", name: "ريم", team: 1 }
];
const mk = (pl = P4) => { seed = 5; const m = new WaveMatch(pl, { rng, deal: used => WB.deal(rng, used), key: WB.key }); m.takeEvents(); return m; };
/** جولةٌ كاملة: تلميح، ثمّ المؤشر على زاوية، ثمّ تصويتُ الخصم */
function play(m, angle, side) {
  m.submitClue(m.cur.psychic, "تلميح");
  const an = m.analysts();
  m.setDial(an[0], angle);
  for (const id of an) m.agree(id);
  if (m.phase === "guess") for (const id of m.opponents()) m.vote(id, side);
}

console.log("\n═══ قواعد «التخاطر» ═══\n");

console.log("① البنك");
{
  const all = WB.listAll();
  ok(all.total >= 150 && all.base === all.total, "١٥٠ بطاقةً فأكثر في البنك", all.total);
  eq(WB.parse("  بارد |  حار "), { left: "بارد", right: "حار" }, "«يسار | يمين» تُقرأ");
  ok(WB.parse("بارد") === null && WB.parse("حار | الحار") === null, "وبطاقةٌ بطرفٍ واحد أو بطرفين متطابقين تُرفض");
  const keys = new Set(WB.cards().map(WB.key));
  ok(keys.size === WB.cards().length, "ولا بطاقتان متطابقتان بعد التطبيع");
  const used = new Set(), seen = new Set();
  for (let i = 0; i < 40; i++) { const c = WB.deal(rng, used); const k = WB.key(c); seen.add(k); used.add(k); }
  ok(seen.size === 40, "والسحبُ لا يكرّر بطاقةً في المباراة نفسها");
}
{
  const saved = {};
  const store = { async getSettings() { return saved; }, async setSetting(s, k, v) { saved[k] = v; } };
  (async () => {})();
  WB.add(store, "مطر خفيف | عاصفة").then(r => {
    ok(r.ok && WB.cards().some(c => c.left === "مطر خفيف"), "الأدمن يضيف بطاقة");
    return WB.add(store, "بارد | حار");
  }).then(r => {
    ok(!r.ok && /موجودة/.test(r.error), "والموجودةُ تُرفض");
    return WB.remove(store, "بارد | حار");
  }).then(r => {
    ok(r.ok && r.hidden && !WB.cards().some(c => c.left === "بارد" && c.right === "حار"), "وحذفُ الأساسيّة يُخفيها");
    return WB.add(store, "بارد | حار");
  }).then(r => {
    ok(r.ok && r.restored, "وإضافتُها من جديد تُعيدها");
    return WB.remove(store, "مطر خفيف | عاصفة");
  }).then(r => ok(r.ok && !saved.added.length, "والمُضافةُ تُمحى"));
}

console.log("② الأدوار والحجب");
{
  const m = mk();
  const t = m.cur.team;
  ok(m.phase === "clue" && m.round === 1, "الجولة الأولى: التلميح");
  ok(m.members(t).some(p => p.id === m.cur.psychic), "الوسيطُ من فريق الدور");
  ok(m.cur.target >= 20 && m.cur.target <= 160, "مركزُ الهدف بين ٢٠ و١٦٠", m.cur.target);
  const psy = m.cur.psychic, an = m.analysts()[0], op = m.opponents()[0];
  ok(m.view(psy).cur.target === m.cur.target, "الوسيطُ يرى الهدف");
  ok(m.view(an).cur.target === null && m.view(op).cur.target === null, "ولا يراه أحدٌ غيرُه (لا زميلٌ ولا خصم)");
  throws(() => m.submitClue(an, "س"), /الوسيطُ وحده/, "غيرُ الوسيط لا يكتب التلميح");
  const c0 = m.cur.card;
  m.reroll(psy); m.reroll(psy);
  throws(() => m.reroll(psy), /مرّتين/, "يبدّل البطاقةَ مرّتين على الأكثر");
  ok(JSON.stringify(m.cur.card) !== JSON.stringify(c0), "(تبدّلت البطاقة)");
  throws(() => m.submitClue(psy, "   "), /اكتب/, "وتلميحٌ فارغ يُرفض");
  m.submitClue(psy, "  قهوة   المطار ");
  ok(m.phase === "dial" && m.cur.clue === "قهوة المطار", "التلميحُ يُرسل ⇒ المؤشر");
  ok(m.view(psy).cur.target === null, "وتُغلق الستارةُ على الوسيط أيضًا");
  eq(m.view(op).cur.clue, "قهوة المطار", "والتلميحُ للجميع");
}

console.log("③ المؤشر بموافقة الجميع");
{
  const pl = [
    { id: "a1", name: "١", team: 0 }, { id: "a2", name: "٢", team: 0 }, { id: "a3", name: "٣", team: 0 },
    { id: "b1", name: "٤", team: 1 }, { id: "b2", name: "٥", team: 1 }
  ];
  const m = mk(pl);
  while (m.cur.team !== 0) { m.timeout(); m.timeout(); }
  const psy = m.cur.psychic, [x, y] = m.analysts();
  m.submitClue(psy, "س");
  throws(() => m.setDial(psy, 40), /المحلّلون/, "الوسيطُ لا يحرّك المؤشر");
  throws(() => m.setDial("b1", 40), /المحلّلون/, "ولا الخصم");
  m.setDial(x, 400);
  eq(m.cur.dial, 180, "المؤشرُ بين ٠ و١٨٠");
  m.setDial(y, 42.37);
  eq(m.cur.dial, 42.4, "بدقّة عُشر درجة");
  m.agree(x);
  ok(m.phase === "dial", "موافقةُ واحدٍ من اثنين لا تثبّت");
  m.setDial(y, 50);
  eq(m.cur.ok.size, 0, "وتحريكُه يُسقط الموافقات");
  m.agree(x); m.setOnline(y, false);
  ok(m.phase === "guess" && m.cur.locked === 50, "غيابُ الثاني: يكفي الحاضرون ⇒ ثُبّت", { phase: m.phase, l: m.cur.locked });
  throws(() => m.setDial(x, 60), /المحلّلون/, "ولا يتحرّك بعد التثبيت");
}

console.log("④ الخصم والنقاط");
{
  eq([scoreOf(100, 100), scoreOf(100, 103), scoreOf(100, 96.9), scoreOf(100, 108), scoreOf(100, 91.5), scoreOf(100, 115), scoreOf(100, 84.9)],
     [4, 4, 3, 3, 2, 2, 0], "±٣ ⇒ ٤ · ±٨ ⇒ ٣ · ±١٥ ⇒ ٢ · أبعد ⇒ ٠");
  const m = mk();
  const t = m.cur.team;
  m.cur.target = 100;
  m.submitClue(m.cur.psychic, "س");
  m.setDial(m.analysts()[0], 110);
  m.analysts().forEach(id => m.agree(id));
  throws(() => m.vote(m.analysts()[0], "left"), /الخصم وحده/, "فريقُ الوسيط لا يصوّت");
  const [o1, o2] = m.opponents();
  m.vote(o1, "left");
  ok(m.phase === "guess", "تصويتُ واحدٍ من اثنين لا يحسم");
  m.vote(o2, "right");
  ok(m.phase === "reveal" && m.cur.guess === "left", "التعادل ⇒ لأوّل من صوّت (يسار)");
  eq(m.cur.result, { pts: 2, opp: 1, truth: "left", diff: 10 }, "المؤشرُ على بُعد ١٠ ⇒ ٢، والخصمُ أصاب الاتّجاه ⇒ ١");
  eq(m.teams.map(T => T.score)[t], 2, "نقاطُ فريق الوسيط");
  eq(m.teams[1 - t].score, 1, "ونقطةُ الخصم");
  ok(m.view(o1).cur.target === 100, "والهدفُ يُكشف للجميع");
}
{
  const m = mk();
  m.cur.target = 70;
  play(m, 71, "right");
  eq([m.cur.result.pts, m.cur.result.opp], [4, 0], "المركز (٤) ⇒ لا نقطةَ للخصم ولو أصاب");
}
{
  const m = mk();
  m.cur.target = 70;
  play(m, 120, "right");
  eq([m.cur.result.pts, m.cur.result.opp], [0, 0], "أخطأ الفريقُ والخصمُ معًا ⇒ لا شيء");
}

console.log("⑤ التناوب والفوز");
{
  const m = mk();
  const t1 = m.cur.team, p1 = m.cur.psychic;
  play(m, 90, "left");
  for (const p of m.players) m.readyNext(p.id);
  ok(m.round === 2 && m.cur.team === 1 - t1, "الجولةُ التالية للفريق الآخر");
  play(m, 90, "left");
  for (const p of m.players) m.readyNext(p.id);
  ok(m.cur.team === t1 && m.cur.psychic !== p1, "ثمّ يعود الدور — بوسيطٍ آخر");
}
{
  const m = mk();
  m.teams[m.cur.team].score = 8;
  m.cur.target = 90;
  play(m, 90, "left");
  ok(m.phase === "over" && m.winner === m.cur.team, "بلغ عشرًا ⇒ فاز", { s: m.teams.map(T => T.score), w: m.winner });
  ok(m.view("a1").history.length === 1, "والسجلُّ في النهاية");
}
{
  const m = mk();
  const t = m.cur.team;
  m.teams[t].score = 8; m.teams[1 - t].score = 10;
  m.cur.target = 90;
  play(m, 99, "right");           /* ٢ للفريق ⇒ ١٠ ، والخصمُ أخطأ الاتّجاه ⇒ يبقى ١٠ */
  ok(m.phase === "reveal", "بلغاها متعادلَين ⇒ يُكمل اللعب", m.teams.map(T => T.score));
}

console.log("⑥ المهلُ والغياب");
{
  const m = mk();
  const t = m.cur.team;
  m.timeout();
  ok(m.phase === "reveal" && m.cur.result.skipped && m.teams[t].score === 0, "لم يكتب الوسيط ⇒ تضيع جولةُ فريقه");
  m.timeout();
  ok(m.round === 2 && m.phase === "clue", "ومهلةُ الكشف ⇒ الجولةُ التالية");
  m.submitClue(m.cur.psychic, "س");
  m.setDial(m.analysts()[0], 33);
  m.timeout();
  ok(m.phase === "guess" && m.cur.locked === 33, "مهلةُ المؤشر ⇒ يُثبَّت حيث هو");
  m.vote(m.opponents()[0], "right");
  m.timeout();
  ok(m.phase === "reveal" && m.cur.guess === "right", "ومهلةُ الخصم ⇒ يُحسم بما صُوّت");
}
{
  const m = mk();
  const psy = m.cur.psychic;
  m.setOnline(psy, false);
  const oldT = m.cur.target;
  ok(m.reassignPsychic() && m.cur.psychic !== psy, "الوسيطُ غاب قبل أن يكتب ⇒ يتسلّم زميلٌ حاضر");
  ok(m.view(m.cur.psychic).cur.target != null, "ويرى الهدفَ الجديد");
}
{
  const m = mk();
  m.submitClue(m.cur.psychic, "س");
  for (const id of m.opponents()) m.setOnline(id, false);
  m.analysts().forEach(id => m.agree(id));
  ok(m.phase === "reveal" && m.cur.guess === null, "لا خصمَ حاضرًا ⇒ الكشفُ مباشرةً بلا تخمين");
}

setTimeout(() => {
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
}, 100);
