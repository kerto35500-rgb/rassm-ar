// اختبار «كلمة واحدة فقط»: خوارزمية التطابق العربيّة، وبنكُ الكلمات،
// والمحرّكُ جولةً جولة، ثمّ مئاتُ المباريات العشوائيّة نفحص فيها في كلّ خطوةٍ
// ألّا يرى المخمّنُ الكلمةَ ولا التلميحات قبل وقتها.

const N = require("./public/justone/norm");
const JB = require("./justonebank");
const W = require("./justone-words");
const { JustOneMatch, rating, MAX_UNKNOWN } = require("./justonerules");
const L = require("./ludorules");          /* لمولّد الأرقام القابل للإعادة وحده */

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const throws = (f, m) => { try { f(); ok(false, m, "لم يُرفض"); } catch (e) { ok(true, m); } };

const PL = n => ["سعود", "فهد", "نورة", "ريم", "سيف", "مشعل", "أبو تركي"].slice(0, n).map((name, i) => ({ id: "p" + i, name }));
/* بنكٌ ثابتٌ للاختبار: البطاقاتُ معروفةٌ مسبقًا */
const fixedDeal = cards => { let i = 0; return () => cards[i++ % cards.length].slice(); };
const mk = (n, cards, seed = 3) => new JustOneMatch(PL(n), { deal: fixedDeal(cards), rng: L.rngFrom(seed) });
const CARD = ["شمس", "قطة", "بحر", "قلم", "تفاحة"];

console.log("\n═══ كلمة واحدة فقط ═══\n");

console.log("① التطبيع (القسم الثاني من وثيقة التصميم)");
eq(N.norm("أَسَد"), N.norm("اسد"), "التشكيلُ يسقط والهمزةُ على الألف ألف");
ok(["أ", "إ", "آ", "ٱ"].every(h => N.norm(h + "مل") === N.norm("امل")), "كلُّ همزات الألف ⇒ ا");
eq(N.norm("تفاحة"), N.norm("تفاحه"), "التاء المربوطة = الهاء");
eq(N.norm("مستشفى"), N.norm("مستشفي"), "الألف المقصورة = الياء");
eq(N.norm("التفاحة"), N.norm("تفاحة"), "«ال» التعريف تُنزَع: التفاحة = تفاحة");
eq(N.norm("الم"), "الم", "ولا تُنزَع إن لم يبقَ بعدها إلا حرف («الم»)");
eq(N.norm("اللبن"), N.norm("لبن"), "«اللبن» = «لبن» (لا «بن»)");
eq(N.norm("قطــــة!!"), N.norm("قطة"), "التطويلُ وعلامات الترقيم تسقط");
eq(N.norm("قطططة"), N.norm("قطة"), "والحرفُ الممطوط يُضغط — لا نجاةَ من الحذف بمدّ حرف");
ok(N.norm("100") !== N.norm("10"), "والأرقامُ لا تُضغط («100» ليست «10»)");
eq(N.norm("مسئول"), N.norm("مسؤول"), "الهمزةُ على الواو والياء واحدة (مسئول = مسؤول)");
eq(N.norm("APPLE"), N.norm("apple"), "اللاتينيّةُ بلا حالة أحرف");
eq(N.norm("٣"), N.norm("3"), "الأرقامُ العربيّة = اللاتينيّة");
ok(N.isMulti("كرة قدم") && N.isMulti("آيس-كريم") && !N.isMulti("  قطة  ") && !N.isMulti("SMS"), "أكثرُ من كلمة: المسافة والشَّرطة");

console.log("② التلميحُ الممنوع: الكلمةُ نفسها أو جزءٌ منها أو من عائلتها");
for (const [c, t] of [["تفاحة", "تفاحة"], ["التفاحة", "تفاحة"], ["تفاح", "تفاحة"], ["شمسية", "شمس"], ["قمري", "قمر"],
                      ["سيارات", "سيارة"], ["معلمون", "معلم"], ["كهربائي", "كهرباء"], ["برتقالي", "برتقال"]])
  ok(N.related(c, t), `«${c}» لـ«${t}» يُحذف`);
for (const [c, t] of [["فيلم", "فيل"], ["مطرقة", "مطر"], ["كاميرا", "أمير"], ["قرصان", "قرص"], ["أدب", "دب"],
                      ["منارة", "نار"], ["تاجر", "تاج"], ["صيدلية", "صيد"], ["برجر", "برج"], ["ماء", "بحر"]])
  ok(!N.related(c, t), `«${c}» لـ«${t}» لا يُحذف (تشابهُ حروفٍ صدفة)`);

console.log("③ التخمين");
ok(N.guessOK("التفاحه", "تفاحة"), "«التفاحه» إصابةٌ لـ«تفاحة»");
ok(N.guessOK("سيارات", "سيارة"), "والجمعُ السالم إصابة");
ok(N.guessOK("مستشفا", "مستشفى"), "وخطأُ حرفٍ في كلمةٍ طويلة إصابة");
ok(!N.guessOK("ساعي", "ساعة"), "لكن «ساعي» ليست «ساعة»");
ok(!N.guessOK("دب", "أدب") && !N.guessOK("", "قطة"), "ولا «دب» لـ«أدب»، ولا الفراغ");

console.log("④ بنكُ الكلمات");
{
  const all = []; for (const c in W) for (const w of W[c]) all.push(w);
  const norms = new Set(all.map(N.norm));
  ok(all.length >= 650, `${all.length} كلمةً أساسيّة`, all.length);
  eq(norms.size, all.length, "ولا كلمتان تتّحدان بعد التطبيع");
  ok(all.every(w => !N.isMulti(w) && !/\s/.test(w)), "وكلُّها كلمةٌ واحدة");
  const card = JB.deal(L.rngFrom(9), new Set());
  ok(card.length === 5 && new Set(card.map(N.norm)).size === 5, "البطاقةُ خمسُ كلماتٍ مختلفة", card);
  const used = new Set(JB.words().slice(0, JB.words().length - 5).map(N.norm));
  const last = JB.deal(L.rngFrom(9), used);
  ok(last.every(w => !used.has(N.norm(w))), "ولا تتكرّر كلمةٌ ظهرت في المباراة ما بقي غيرُها", last);
}

console.log("⑤ الجولة: الاختيار والتلميح");
{
  throws(() => mk(2, [CARD]), "أقلُّ من ثلاثة لاعبين يُرفض");
  throws(() => new JustOneMatch(PL(7).concat([{ id: "x", name: "x" }]), { deal: fixedDeal([CARD]) }), "وأكثرُ من سبعة يُرفض");
  const m = mk(4, [CARD]);
  const g = m.guesser.id;
  eq(m.phase, "pick", "تبدأ الجولةُ باختيار الرقم");
  ok(m.view(g).card === null && m.view(g).secret === null, "المخمّنُ لا يرى البطاقة");
  const giver = m.givers()[0].id;
  eq(m.view(giver).card, CARD, "والملمّحون يرونها");
  throws(() => m.pick(giver, 1), "الملمّحُ لا يختار الرقم");
  throws(() => m.pick(g, 6), "ولا رقمَ خارج ١..٥");
  m.pick(g, 3);
  eq(m.secret, "بحر", "الرقم ٣ ⇒ الكلمةُ الثالثة سرّيّة");
  eq(m.view(g).secret, null, "ولا يراها المخمّن");
  throws(() => m.submit(g, ["ماء"]), "المخمّنُ لا يلمّح");
  m.unknown(giver);
  ok(m.phase === "pick" && m.disabled.includes(3), "«ما أعرفها» ⇒ يختار المخمّنُ رقمًا آخر، والثالثُ معطَّل");
  throws(() => m.pick(g, 3), "والرقمُ المعطَّل لا يُختار");
  m.pick(g, 1); m.unknown(giver); m.pick(g, 2); m.unknown(giver);
  m.pick(g, 4);
  throws(() => m.unknown(giver), `«ما أعرفها» ${MAX_UNKNOWN} مرّاتٍ في الجولة على الأكثر`);

  const m3 = mk(3, [CARD]);
  eq(m3.cluesPer, 2, "مع ثلاثة لاعبين: تلميحان لكلّ ملمّح (القاعدة الرسميّة)");
  eq(mk(5, [CARD]).cluesPer, 1, "ومع خمسة: تلميحٌ واحد");
}

console.log("⑥ الحذف الآليّ والمراجعة بالتصويت");
{
  const m = mk(5, [CARD]);
  const g = m.guesser.id; m.pick(g, 3);                 /* بحر */
  const [a, b, c, d] = m.givers().map(p => p.id);
  m.submit(a, ["موج"]); m.submit(b, ["الموج"]); m.submit(c, ["البحار"]);
  eq(m.phase, "clues", "تنتظر المرحلةُ آخرَ ملمّح");
  m.submit(c, ["سفينة"]);                                /* إعادةُ الإرسال تستبدل */
  m.submit(d, ["كرة قدم"]);
  const out = Object.fromEntries(m.clues.map(x => [x.text, x.out]));
  ok(out["موج"] === "dup" && out["الموج"] === "dup", "«موج» و«الموج» متطابقان بعد التطبيع ⇒ يُحذفان كلاهما", out);
  eq(out["كرة قدم"], "multi", "أكثرُ من كلمة ⇒ يُحذف");
  ok(out["سفينة"] === null && !("البحار" in out), "وإعادةُ الإرسال استبدلت «البحار» بـ«سفينة»", out);
  eq(m.phase, "review", "ثمّ المراجعة");
  eq(m.view(g).clues, null, "والمخمّنُ لا يرى شيئًا في المراجعة");

  const m2 = mk(5, [CARD]);
  const g2 = m2.guesser.id; m2.pick(g2, 1);              /* شمس */
  const gv = m2.givers().map(p => p.id);
  m2.submit(gv[0], ["شمسية"]); m2.submit(gv[1], ["sun"]); m2.submit(gv[2], ["حرارة"]); m2.submit(gv[3], ["حر"]);
  const o2 = Object.fromEntries(m2.clues.map(x => [x.text, x]));
  eq(o2["شمسية"].out, "target", "«شمسية» من عائلة «شمس» ⇒ تُحذف آليًّا");
  ok(o2.sun.latin && !o2.sun.out, "و«sun» تبقى للتصويت، مُنبَّهًا أنّها لاتينيّة (قد تكون ترجمة)");
  m2.strike(gv[0], o2.sun.id); m2.strike(gv[1], o2.sun.id);
  m2.reviewReady(gv[0]); m2.reviewReady(gv[1]); m2.reviewReady(gv[2]);
  eq(m2.phase, "review", "تنتظر المراجعةُ جاهزيّةَ الجميع");
  m2.strike(gv[2], o2.sun.id);
  ok(!m2.ready.has(gv[2]), "ومن غيّر شطبه لم يعد جاهزًا");
  m2.reviewReady(gv[2]); m2.reviewReady(gv[3]);
  eq(o2.sun.out, "vote", "٣ من ٤ شطبوا ⇒ أكثرُ من النصف ⇒ يُحذف");
  eq(m2.phase, "guess", "ثمّ التخمين");
  const seen = m2.view(g2).clues;
  ok(seen.length === 2 && seen.every(x => x.out === undefined && x.votes === undefined), "المخمّنُ يرى الناجيَين وحدهما بلا أسباب حذفٍ ولا أصوات", seen);

  const m3 = mk(5, [CARD]);
  const g3 = m3.guesser.id; m3.pick(g3, 2);
  const v3 = m3.givers().map(p => p.id);
  m3.submit(v3[0], ["مواء"]); m3.submit(v3[1], ["أليف"]); m3.submit(v3[2], ["فأر"]); m3.submit(v3[3], ["حليب"]);
  const id = m3.clues[0].id;
  m3.strike(v3[0], id); m3.strike(v3[1], id);
  m3.timeout();
  ok(m3.clues[0].out === null && m3.phase === "guess", "شطبُ ٢ من ٤ (النصف لا أكثر) لا يحذف");

  const m4 = mk(4, [CARD]);
  const g4 = m4.guesser.id; m4.pick(g4, 4);              /* قلم */
  const v4 = m4.givers().map(p => p.id);
  m4.submit(v4[0], ["حبر"]); m4.submit(v4[1], ["حبر"]); m4.submit(v4[2], ["القلم"]);
  ok(m4.phase === "reveal" && m4.result === "empty", "حُذف الجميع ⇒ تنتهي الجولة بلا تخمين");
  eq([m4.score, m4.deckLeft], [0, 12], "وتضيع البطاقةُ وحدها (كالتخطّي)");
}

console.log("⑦ النقاط (القسم الثالث)");
{
  const play = (m, res) => {
    const g = m.guesser.id; m.pick(g, 5);                /* تفاحة */
    for (const p of m.givers()) m.submit(p.id, ["أحمر" + p.id]);
    for (const p of m.givers()) m.reviewReady(p.id);
    if (res === "correct") m.guessWord(g, "التفاحه"); else if (res === "wrong") m.guessWord(g, "موز"); else m.skip(g);
  };
  const m = mk(4, [CARD]);
  play(m, "correct"); eq([m.score, m.deckLeft], [1, 12], "إصابة ⇒ +١");
  m.next(); play(m, "skip"); eq([m.score, m.deckLeft], [1, 11], "تخطٍّ ⇒ تضيع البطاقةُ الحاليّة وحدها");
  m.next(); play(m, "wrong"); eq([m.score, m.deckLeft], [1, 9], "خطأ ⇒ تضيع البطاقةُ الحاليّة والتي بعدها");
  ok(m.history.length === 3 && m.history[2].guess === "موز" && m.history[2].result === "wrong", "والسجلُّ يحفظ الجولات");

  const z = mk(4, [CARD]);
  while (z.deckLeft > 0) { play(z, "correct"); z.next(); }
  play(z, "correct"); z.next();
  ok(z.phase === "over" && z.score === 13 && z.round === 13, "١٣ بطاقة ⇒ ١٣ جولة على الأكثر", { r: z.round, s: z.score });
  eq(z.view("p0").rating.id, "legend", "١٣ = أسطوري");

  const last = mk(4, [CARD]);
  play(last, "correct"); last.next();
  last.deckLeft = 0;
  play(last, "wrong");
  eq(last.score, 0, "خطأٌ في البطاقة الأخيرة ⇒ تُخصم نقطة (القاعدة الأصليّة)");
  const zero = mk(4, [CARD]); zero.deckLeft = 0; play(zero, "wrong");
  eq(zero.score, 0, "ولا تنزل النقاطُ تحت الصفر");

  eq([13, 12, 10, 9, 7, 6, 0].map(s => rating(s).id), ["legend", "amazing", "amazing", "good", "good", "try", "try"],
     "التصنيف: ١٣ أسطوري، ١٠–١٢ مذهل، ٧–٩ جيّد، وأقلُّ «حاولوا التفاهم»");
}

console.log("⑧ الدوران والوقت والغياب");
{
  const m = mk(4, [CARD]);
  const seen = [];
  for (let r = 0; r < 4; r++) {
    seen.push(m.guesser.id);
    const r0 = m.round;
    for (let k = 0; k < 10 && m.round === r0; k++) m.timeout();     /* حتى الجولة التالية بالضبط */
  }
  eq(new Set(seen).size, 4, "المخمّنُ يتناوب: كلُّ لاعبٍ في دوره", seen);
  const t = mk(4, [CARD]);
  t.timeout();
  ok(t.phase === "clues" && t.pickNo >= 1, "انقضى وقتُ الاختيار ⇒ رقمٌ عشوائيّ");
  t.timeout();
  ok(t.phase === "reveal" && t.result === "empty", "انقضى وقتُ التلميح بلا تلميح ⇒ تضيع البطاقة بلا عقاب");

  const o = mk(4, [CARD]);
  const g = o.guesser.id; o.pick(g, 2);
  const [a, b, c] = o.givers().map(p => p.id);
  o.submit(a, ["مواء"]); o.submit(b, ["أليف"]);
  o.setOnline(c, false);
  eq(o.phase, "review", "غاب الملمّحُ الأخير ⇒ لا تنتظره المرحلة");
  o.next && o.setOnline(c, true);
  const r = mk(4, [CARD]);
  r.setOnline(r.players[(r.gi + 1) % 4].id, false);
  r.timeout(); r.timeout(); r.timeout(); r.timeout(); r.timeout();
  ok(r.guesser.on, "والمخمّنُ التالي من الحاضرين", r.guesser);
}

console.log("⑨ مبارياتٌ عشوائيّة: لا يرى المخمّنُ ما لا يحقّ له في أيّ خطوة");
{
  let games = 0, steps = 0, bad = [];
  for (let gN = 0; gN < 300; gN++) {
    const n = 3 + (gN % 5);
    const rng = L.rngFrom(1000 + gN);
    const m = new JustOneMatch(PL(n), { deal: u => JB.deal(rng, u), rng });
    let guard = 0;
    while (m.phase !== "over" && guard++ < 2000) {
      steps++;
      const g = m.guesser.id;
      const gv = m.view(g);
      /* الثوابت */
      if (m.phase !== "reveal" && (gv.card !== null || gv.secret !== null)) bad.push("المخمّن رأى الكلمة");
      if ((m.phase === "clues" || m.phase === "review") && gv.clues !== null) bad.push("المخمّن رأى التلميحات مبكّرًا");
      if (m.phase === "guess" && gv.clues.some(c => c.out !== undefined || m.clues[c.id].out)) bad.push("المخمّن رأى تلميحًا محذوفًا");
      if (m.deckLeft < 0 || m.score < 0 || m.score > 13 || m.round > 13) bad.push("عدّادٌ خارج حدوده");
      if (m.phase === "clues" && m.givers().some(p => (m.view(p.id).clues || []).some(c => c.by !== p.id))) bad.push("ملمّح رأى تلميحَ غيره قبل المراجعة");
      /* فعلٌ عشوائيّ */
      const r = rng();
      try {
        if (m.phase === "pick") m.pick(g, 1 + Math.floor(rng() * 5));
        else if (m.phase === "clues") {
          const gs = m.givers(); const p = gs[Math.floor(rng() * gs.length)];
          if (r < 0.06 && m.unknowns < MAX_UNKNOWN) m.unknown(p.id);
          else if (r < 0.12) m.timeout();
          else {
            const pool = ["ماء", "موج", "ملح", "sun", m.secret, "شمسية", "حبر", "كرة قدم", "أزرق", "حلو"];
            m.submit(p.id, Array.from({ length: m.cluesPer }, () => pool[Math.floor(rng() * pool.length)]));
          }
        } else if (m.phase === "review") {
          const gs = m.givers(); const p = gs[Math.floor(rng() * gs.length)];
          const alive = m.clues.filter(c => !c.out);
          if (r < 0.4 && alive.length) m.strike(p.id, alive[Math.floor(rng() * alive.length)].id);
          else if (r < 0.9) m.reviewReady(p.id); else m.timeout();
        } else if (m.phase === "guess") {
          if (r < 0.45) m.guessWord(g, m.secret); else if (r < 0.75) m.guessWord(g, "خطأ"); else if (r < 0.9) m.skip(g); else m.timeout();
        } else if (m.phase === "reveal") m.next();
        if (rng() < 0.03) { const p = m.players[Math.floor(rng() * m.players.length)]; m.setOnline(p.id, !p.on || m.onlineCount() <= 3); }
      } catch (e) { /* فعلٌ مرفوض — مقبولٌ في العشوائيّ */ }
      m.takeEvents();
    }
    if (m.phase !== "over") bad.push("مباراةٌ لم تنتهِ");
    games++;
  }
  console.log(`     ${games} مباراة · ${steps.toLocaleString()} خطوة`);
  ok(!bad.length, "لا خرقَ في أيّ خطوة", [...new Set(bad)].slice(0, 5));
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
