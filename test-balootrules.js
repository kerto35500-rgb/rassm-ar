// اختبار محرّك قواعد «بالوت».
// العشوائيّة محقونةٌ ببذرةٍ ثابتة، فكلّ مباراةٍ هنا قابلةٌ للإعادة حرفًا بحرف.
// وفي آخره ثلاثةُ آلاف يدٍ يلعبها البوت وحده: إن مرّت بلا مخالفةِ قاعدةٍ
// ولا اختلالِ مجموع، فالمحرّك يقف على قدميه.

const B = require("./balootrules");
const BOT = require("./balootbot");
const { BalootMatch, DEFAULTS } = B;

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

/* يدٌ مصنوعةٌ باليد: نضع الأوراق حيث نريد فنختبر القاعدة بلا انتظار الحظّ */
function rigged(hands, opts = {}) {
  const m = new BalootMatch(opts.rules || {}, 7);
  m.startHand();
  m.hands = hands.map(h => h.slice());
  m.mode = opts.mode || "sun";
  m.trump = opts.trump || null;
  m.buyerSeat = opts.buyer ?? 0;
  m.callerSeat = m.buyerSeat;
  m.firstSeat = opts.first ?? 0;
  m.phase = "playing";
  m.leader = m.firstSeat; m.turn = opts.turn ?? m.firstSeat;
  m.trick = []; m.tricks = []; m.trickNo = 0;
  m.rawPoints = [0, 0]; m.declared = {}; m.projectsCounted = []; m.available = {};
  for (let s = 0; s < 4; s++) m.available[s] = B.findProjects(m.hands[s], m.mode, m.rules);
  return m;
}

console.log("\n═══ محرّك قواعد بالوت ═══\n");

/* ─────────────────────────────────────── */
console.log("① الرزمة والأوراق");
{
  const d = B.makeDeck();
  ok(d.length === 32, `اثنتان وثلاثون ورقة (${d.length})`, d.length);
  ok(new Set(d).size === 32, "بلا تكرار");
  ok(d.filter(c => B.suitOf(c) === "S").length === 8, "ثمانٍ لكلّ نوع");
  ok(!d.some(c => ["2", "3", "4", "5", "6"].includes(B.rankOf(c))), "لا أوراق دون السبعة");
  eq(B.rankOf("10H"), "10", "قراءة الرتبة ذات الحرفين");
  eq(B.suitOf("10H"), "H", "وقراءة نوعها");
  eq(B.cardAr("AS"), "A♠", "الرمز العربيّ للورقة");
}

console.log("② القيَم");
{
  eq(B.cardValue("AS", "sun"), 11, "الأكة في الصنّ ١١");
  eq(B.cardValue("10S", "sun"), 10, "والعشرة ١٠");
  eq(B.cardValue("KS", "sun"), 4, "والشايب ٤");
  eq(B.cardValue("QS", "sun"), 3, "والبنت ٣");
  eq(B.cardValue("JS", "sun"), 2, "والولد ٢");
  eq(B.cardValue("9S", "sun"), 0, "والتسعة صفر");
  eq(B.cardValue("JS", "hokum", "S"), 20, "ولد الحكم ٢٠");
  eq(B.cardValue("9S", "hokum", "S"), 14, "وتسعة الحكم ١٤");
  eq(B.cardValue("JH", "hokum", "S"), 2, "وولدُ غيرِ الحكم يبقى ٢");
  eq(B.cardValue("9H", "hokum", "S"), 0, "وتسعتُه صفر");

  const deck = B.makeDeck();
  const sun = deck.reduce((a, c) => a + B.cardValue(c, "sun"), 0);
  const hok = deck.reduce((a, c) => a + B.cardValue(c, "hokum", "S"), 0);
  eq(sun, 120, "مجموع الصنّ ١٢٠ قبل آخر أكلة");
  eq(hok, 152, "ومجموع الحكم ١٥٢");
  eq(sun + 10, B.RAW_TOTAL.sun, "فالصنّ ١٣٠ بآخر أكلة");
  eq(hok + 10, B.RAW_TOTAL.hokum, "والحكم ١٦٢");
}

console.log("③ القوّة والفائز بالأكلة");
{
  const s = (c, led) => B.strength(c, "sun", null, led);
  ok(s("AS", "S") > s("10S", "S"), "الأكة فوق العشرة في الصنّ");
  ok(s("10S", "S") > s("KS", "S"), "والعشرة فوق الشايب");
  ok(s("KS", "S") > s("QS", "S") && s("QS", "S") > s("JS", "S"), "ثمّ البنت فالولد");
  ok(s("7H", "S") === -1, "ورقةٌ من غير نوع الافتتاح لا تفوز");

  const h = (c, led) => B.strength(c, "hokum", "S", led);
  ok(h("JS", "S") > h("9S", "S"), "ولد الحكم فوق تسعته");
  ok(h("9S", "S") > h("AS", "S"), "وتسعتُه فوق أكته");
  ok(h("7S", "H") > h("AH", "H"), "وأدنى حكمٍ يقطع أعلى غيره");

  const t = [{ seat: 0, card: "KH" }, { seat: 1, card: "AH" }, { seat: 2, card: "7S" }, { seat: 3, card: "10H" }];
  eq(B.trickWinner(t, "sun", null), 1, "في الصنّ تفوز الأكة");
  eq(B.trickWinner(t, "hokum", "S"), 2, "وفي الحكم يفوز القاطع ولو بسبعة");
  const t2 = [{ seat: 0, card: "7S" }, { seat: 1, card: "JS" }, { seat: 2, card: "AH" }, { seat: 3, card: "9S" }];
  eq(B.trickWinner(t2, "hokum", "S"), 1, "وأعلى الحكم يأخذها");
}

console.log("④ الأوراق المسموح بها — الصنّ");
{
  const hand = ["AS", "7S", "KH", "9D"];
  const t = [{ seat: 3, card: "10S" }];
  eq(B.legalMoves(hand, t, "sun", null, DEFAULTS, 0).sort(), ["7S", "AS"], "اتّباع النوع واجب");
  eq(B.legalMoves(["KH", "9D"], t, "sun", null, DEFAULTS, 0).sort(), ["9D", "KH"], "ومن عجز فهو حرّ");
  eq(B.legalMoves(hand, [], "sun", null, DEFAULTS, 0).length, 4, "والافتتاح بأيّ ورقة");
  ok(!B.legalMoves(hand, t, "sun", null, DEFAULTS, 0).includes("KH"), "لا يُسمح بترك النوع مع وجوده");
}

console.log("⑤ الأوراق المسموح بها — الحكم");
{
  const R = DEFAULTS;
  /* لا أملك نوع الافتتاح وأملك حكمًا والخصم آخذها ⇐ القطع واجب */
  const t = [{ seat: 3, card: "AH" }];
  eq(B.legalMoves(["7S", "8S", "KD"], t, "hokum", "S", R, 0).sort(), ["7S", "8S"], "القطع واجبٌ على الخصم");
  /* الشريك آخذها ⇐ لا قطع */
  const t2 = [{ seat: 2, card: "AH" }];
  eq(B.legalMoves(["7S", "KD"], t2, "hokum", "S", R, 0).sort(), ["7S", "KD"], "ولا يُجبَر من شريكُه آخذُها");
  eq(B.legalMoves(["7S", "KD"], t2, "hokum", "S", { ...R, partnerWinningNoTrump: false }, 0).sort(), ["7S"],
     "إلا إذا أُلغيت القاعدة");
  /* سبقني قاطعٌ أعلى ولا أملك أعلى منه ⇐ أنا حرّ */
  const t3 = [{ seat: 1, card: "AH" }, { seat: 2, card: "JS" }];
  eq(B.legalMoves(["7S", "KD"], t3, "hokum", "S", R, 3).sort(), ["7S", "KD"], "من لا يعلو القاطعَ فهو حُرّ");
  /* سبقني قاطعٌ وأملك أعلى منه ⇐ يجب أن أعلوه */
  const t4 = [{ seat: 1, card: "AH" }, { seat: 2, card: "7S" }];
  eq(B.legalMoves(["JS", "KD"], t4, "hokum", "S", R, 3), ["JS"], "ومن علا وجب أن يعلو");
  eq(B.legalMoves(["JS", "KD"], t4, "hokum", "S", { ...R, mustOvertrump: false }, 3).sort(), ["JS"],
     "وبلا إجبار العلوّ يبقى الحكم واجبًا");
  /* افتُتح بالحكم: اتبع، وبالأعلى إن استطعت */
  const t5 = [{ seat: 3, card: "10S" }];
  eq(B.legalMoves(["JS", "7S", "AH"], t5, "hokum", "S", R, 0), ["JS"], "افتُتح بالحكم فيجب الأعلى");
  eq(B.legalMoves(["7S", "8S", "AH"], t5, "hokum", "S", R, 0).sort(), ["7S", "8S"],
     "ومن لا أعلى عنده يتبع بما عنده");
  eq(B.legalMoves(["AH", "KD"], t5, "hokum", "S", R, 0).sort(), ["AH", "KD"], "ومن لا حكم عنده فهو حُرّ");
}

console.log("⑥ المشاريع");
{
  const p1 = B.findProjects(["7S", "8S", "9S", "AH", "KD"], "sun");
  eq(p1.length, 1, "ثلاثةٌ متتالية = مشروع واحد");
  eq(p1[0].type, "sira", "وهو سرا");
  eq(B.findProjects(["7S", "8S", "9S", "10S"], "sun")[0].type, "khamsin", "وأربعٌ خمسين");
  eq(B.findProjects(["7S", "8S", "9S", "10S", "JS"], "sun")[0].type, "miya", "وخمسٌ مية");
  eq(B.findProjects(["AS", "AH", "AD", "AC"], "sun")[0].type, "arbaamiya", "وأربع أكَك في الصنّ أربعمية");
  eq(B.findProjects(["AS", "AH", "AD", "AC"], "hokum", DEFAULTS)[0].type, "miya", "وفي الحكم مية");
  eq(B.findProjects(["KS", "KH", "KD", "KC"], "sun")[0].type, "miya", "وأربعة شيوخ مية");
  eq(B.findProjects(["9S", "9H", "9D", "9C"], "sun").length, 0, "ولا مشروع في أربع تِسعات");
  eq(B.findProjects(["7S", "8S", "9S"], "sun", { ...DEFAULTS, projects: false }).length, 0, "وتُلغى المشاريع بالإعداد");
  /* التسلسل بترتيب ٧٨٩١٠JQKA لا بترتيب القوّة */
  eq(B.findProjects(["9S", "10S", "JS"], "sun").length, 1, "٩·١٠·J تسلسلٌ صحيح");
  eq(B.findProjects(["10S", "JS", "QS"], "sun")[0].top, "Q", "وأعلى ١٠·J·Q هو Q");
  /* قطعان منفصلان في نوعٍ واحد */
  eq(B.findProjects(["7S", "8S", "9S", "JS", "QS", "KS"], "sun").length, 2, "قطعان في نوعٍ واحد مشروعان");

  eq(B.projectRaw({ type: "sira" }), 20, "سرا ٢٠");
  eq(B.projectRaw({ type: "khamsin" }), 50, "خمسين ٥٠");
  eq(B.projectRaw({ type: "miya" }), 100, "مية ١٠٠");
  eq(B.projectRaw({ type: "arbaamiya" }), 200, "أربعمية ٢٠٠");
}

console.log("⑦ مفاضلة المشاريع");
{
  const sira = { type: "sira", rank: 1, topIdx: 2 };
  const siraHi = { type: "sira", rank: 1, topIdx: 6 };
  const khamsin = { type: "khamsin", rank: 2, topIdx: 3 };
  eq(B.resolveProjects({ 0: [sira], 1: [khamsin] }, 0).team, 1, "الأعلى نوعًا يكسب");
  eq(B.resolveProjects({ 0: [siraHi], 1: [sira] }, 0).team, 0, "وعند التساوي فالأعلى ورقة");
  eq(B.resolveProjects({ 0: [sira], 2: [sira] }, 0).counted.length, 2, "ومشاريع الفريق كلُّها تُحتسب");
  eq(B.resolveProjects({ 0: [sira], 1: [siraHi] }, 0).counted.length, 1, "ومشاريع الخصم تسقط");
  eq(B.resolveProjects({}, 0).team, null, "ولا فريق بلا مشروع");
  const first = B.resolveProjects({ 1: [sira], 3: [sira] }, 1);
  eq(first.team, 1, "وعند التطابق التامّ يسبق الأقرب للافتتاح");
}

console.log("⑧ التسجيل — الحالات العاديّة");
{
  const T = (over, mode = "sun") => ({
    mode, trump: mode === "hokum" ? "S" : null, buyerSeat: 0, multiplier: 1, gahwa: false,
    tricks: Array.from({ length: 8 }, (_, i) => ({ winner: i < over ? 0 : 1, cards: [] })),
    rawPoints: mode === "sun" ? [80, 50] : [100, 62], projectsCounted: [], balootTeam: null
  });
  const r = B.scoreHand(T(4));
  ok(r.buyerWon, "الشاري بـ٨٠ مقابل ٥٠ رابح");
  eq(r.abnat[0] + r.abnat[1], DEFAULTS.sunTotal, "ومجموع الأبناط ٢٦ في الصنّ");
  eq(r.abnat[0], 16, "وحصّته ١٦");

  const h = B.scoreHand(T(4, "hokum"));
  eq(h.abnat[0] + h.abnat[1], DEFAULTS.hokumTotal, "ومجموع الحكم ١٦");
  eq(h.abnat[0], 10, "وحصّة الشاري ١٠");

  const lose = B.scoreHand({ ...T(4), rawPoints: [50, 80] });
  ok(!lose.buyerWon, "والشاري بـ٥٠ مقابل ٨٠ خاسر");
  eq(lose.abnat, [0, 26], "فتذهب الأبناط كلُّها للخصم");

  const tie = B.scoreHand({ ...T(4), rawPoints: [65, 65] });
  ok(!tie.buyerWon, "والتعادل خسارةٌ على الشاري");
  const tie2 = B.scoreHand({ ...T(4), rawPoints: [65, 65] }, { ...DEFAULTS, tieGoesToOpponents: false });
  ok(tie2.buyerWon, "إلا إذا أُلغيت القاعدة");
}

console.log("⑨ التسجيل — المشاريع والكبوت والمضاعفة");
{
  const base = {
    mode: "sun", trump: null, buyerSeat: 0, multiplier: 1, gahwa: false,
    tricks: Array.from({ length: 8 }, (_, i) => ({ winner: i < 4 ? 0 : 1, cards: [] })),
    rawPoints: [80, 50], projectsCounted: [], balootTeam: null
  };
  const withSira = B.scoreHand({ ...base, projectsCounted: [{ seat: 0, project: { type: "sira" } }] });
  eq(withSira.projRaw, [20, 0], "المشروع يُضاف خامًا لفريقه");
  eq(withSira.abnat[0], 16 + 4, "وسرا في الصنّ أربعة أبناط");

  const capot = B.scoreHand({ ...base, tricks: Array.from({ length: 8 }, () => ({ winner: 0, cards: [] })), rawPoints: [130, 0] });
  eq(capot.capot, 0, "ثماني أكلات = كبوت");
  eq(capot.abnat, [DEFAULTS.sunCapot, 0], "وكبوت الصنّ ٤٤");
  const capotH = B.scoreHand({ ...base, mode: "hokum", trump: "S", tricks: Array.from({ length: 8 }, () => ({ winner: 1, cards: [] })), rawPoints: [0, 162] });
  eq(capotH.abnat, [0, DEFAULTS.hokumCapot], "وكبوت الحكم ٢٥");
  ok(!capotH.buyerWon, "وكبوتُ الخصم خسارةٌ للشاري");

  const dbl = B.scoreHand({ ...base, mode: "hokum", trump: "S", multiplier: 2, rawPoints: [100, 62] });
  eq(dbl.abnat[0], DEFAULTS.hokumTotal * 2, "الدبل يجمع الكلّ للفائز ثمّ يضاعف");
  eq(dbl.abnat[1], 0, "ولا شيء للخاسر");
  const four = B.scoreHand({ ...base, mode: "hokum", trump: "S", multiplier: 4, rawPoints: [40, 122] });
  eq(four.abnat, [0, DEFAULTS.hokumTotal * 4], "والفور أربعة أضعاف للخصم إن خسر الشاري");

  const bal = B.scoreHand({ ...base, balootTeam: 0 });
  eq(bal.projRaw, [20, 0], "والبلوت عشرون خامًا");
  const balLose = B.scoreHand({ ...base, rawPoints: [50, 80], balootTeam: 0 });
  ok(balLose.abnat[0] > 0, "ويبقى للشاري بلوتُه ولو خسر");
}

console.log("⑩ الشراء");
{
  const m = new BalootMatch({}, 11);
  m.startHand();
  eq(m.phase, "bidding", "تبدأ اليد بالشراء");
  eq(m.hands.map(h => h.length), [5, 5, 5, 5], "خمسٌ لكلّ لاعب");
  ok(!!m.bidCard, "وورقة شراءٍ مكشوفة");
  eq(m.bidTurn, (m.dealer + 1) % 4, "والدور ليمين الموزّع");
  eq(m.firstSeat, 0, "وأوّل لاعبٍ في اليد الأولى المقعد ٠");

  const ids = m.bidOptions(m.bidTurn).map(o => o.id);
  ok(ids.includes("sun") && ids.includes("hokum") && ids.includes("pass"), "الخيارات: صن وحكم وبس");
  ok(ids.includes("ashkal") || B.rankOf(m.bidCard) === "A", "وأشكل لأوّل لاعب");
  ok(!m.bidOptions((m.bidTurn + 1) % 4).length, "ولا خيار لمن ليس دوره");

  let threw = false;
  try { m.bid((m.bidTurn + 1) % 4, "sun"); } catch (e) { threw = true; }
  ok(threw, "ولا يشتري من ليس دوره");
  threw = false;
  try { m.bid(m.bidTurn, "hokum", "Z"); } catch (e) { threw = true; }
  ok(threw, "ولا يُقبل نوعٌ غير مطروح");
}

console.log("⑪ الشراء — المسارات");
{
  /* الكلّ يمرّ في اللفتين ⇐ إعادة توزيع */
  const m = new BalootMatch({}, 3);
  m.startHand();
  const d0 = m.dealer;
  for (let i = 0; i < 8 && m.phase === "bidding"; i++) m.bid(m.bidTurn, "pass");
  eq(m.phase, "redeal", "الكلّ مرّ لفتين ⇐ إعادة توزيع");
  eq(m.dealer, (d0 + 1) % 4, "وينتقل الموزّع");

  /* اللفة الثانية تفتح كلّ الأنواع */
  const m2 = new BalootMatch({}, 5);
  m2.startHand();
  for (let i = 0; i < 4; i++) m2.bid(m2.bidTurn, "pass");
  eq(m2.bidRound, 2, "بعد لفةٍ كاملة تبدأ الثانية");
  eq(m2.bidTurn, m2.firstSeat, "ويعود الدور للأوّل");
  const hs = m2.bidOptions(m2.bidTurn).filter(o => o.id === "hokum");
  eq(hs.length, 3, "وثلاثةُ أنواعٍ للحكم (عدا نوع ورقة الشراء)");
  const m2b = new BalootMatch({ round2HokumSameSuit: true }, 5);
  m2b.startHand();
  for (let i = 0; i < 4; i++) m2b.bid(m2b.bidTurn, "pass");
  eq(m2b.bidOptions(m2b.bidTurn).filter(o => o.id === "hokum").length, 4, "وأربعةٌ بالإعداد");

  /* الصنّ يعلو الحكم في اللفة الأولى */
  const m3 = new BalootMatch({}, 9);
  m3.startHand();
  const hSeat = m3.bidTurn;
  m3.bid(hSeat, "hokum", B.suitOf(m3.bidCard));
  ok(m3.phase === "bidding" || m3.buyerSeat === hSeat, "الحكم لا يُنهي الشراء فورًا إلا من الموزّع");
  if (m3.phase === "bidding") {
    eq(m3.bidOptions(m3.bidTurn).map(o => o.id).filter(x => x !== "gahwa").sort(), ["pass", "sun"],
       "وبعد الحكم لا يبقى إلا صنّ أو بس");
    const sSeat = m3.bidTurn;
    m3.bid(sSeat, "sun");
    eq(m3.buyerSeat, sSeat, "والصنّ يخطف الشراء");
    eq(m3.mode, "sun", "ويصير النمط صنًّا");
  }

  /* أشكل: يشتري الشريك */
  const m4 = new BalootMatch({}, 21);
  m4.startHand();
  while (B.rankOf(m4.bidCard) === "A") { m4.startHand(); }
  const aSeat = m4.bidTurn;
  m4.bid(aSeat, "ashkal", B.suitOf(m4.bidCard));
  eq(m4.buyerSeat, (aSeat + 2) % 4, "أشكل ⇐ الشاري هو الشريك");
  eq(m4.callerSeat, aSeat, "والمعلن صاحب الكلمة");
  eq(m4.mode, "hokum", "والنمط حكم");
  ok(m4.ashkal, "وتُرفع راية أشكل");
}

console.log("⑫ الإكمال بعد الشراء");
{
  const m = new BalootMatch({ allowDouble: false }, 13);
  m.startHand();
  const card = m.bidCard;
  while (m.phase === "bidding") {
    const o = m.bidOptions(m.bidTurn);
    m.bid(m.bidTurn, o.some(x => x.id === "sun") ? "sun" : "pass");
  }
  eq(m.hands.map(h => h.length), [8, 8, 8, 8], "ثمانٍ لكلّ لاعبٍ بعد الإكمال");
  ok(m.hands[m.buyerSeat].includes(card), "وورقة الشراء في يد الشاري");
  eq(m.phase, "playing", "ثمّ يبدأ اللعب");
  eq(m.turn, m.firstSeat, "ويفتتح أوّل لاعب");
  const all = m.hands.flat();
  eq(new Set(all).size, 32, "والأوراق كلُّها موزّعةٌ بلا تكرار");
}

console.log("⑬ المضاعفة");
{
  const m = new BalootMatch({}, 17);
  let guard = 0;
  while (guard++ < 40) {
    m.startHand();
    while (m.phase === "bidding") {
      const o = m.bidOptions(m.bidTurn).map(x => x.id);
      m.bid(m.bidTurn, o.includes("hokum") ? "hokum" : "pass", o.includes("hokum") ? B.suitOf(m.bidCard) : undefined);
    }
    if (m.phase === "doubling") break;
  }
  eq(m.phase, "doubling", "الحكم يفتح باب المضاعفة");
  eq(m.doubleTurn % 2, 1 - (m.buyerSeat % 2), "والخصم أوّل من يضاعف");
  eq(m.doubleOptions(m.doubleTurn).map(o => o.id), ["double", "pass"], "خياراه: دبل أو بس");
  ok(!m.doubleOptions((m.doubleTurn + 1) % 4).length, "ولا خيار للفريق الآخر");
  m.double(m.doubleTurn, "double");
  eq(m.multiplier, 2, "دبل ⇐ ×٢");
  eq(m.doubleTurn % 2, m.buyerSeat % 2, "وينتقل الدور لفريق الشاري");
  eq(m.doubleOptions(m.doubleTurn).map(o => o.id), ["three", "pass"], "وخياره ثري");
  m.double(m.doubleTurn, "three");
  eq(m.multiplier, 3, "ثري ⇐ ×٣");
  m.double(m.doubleTurn, "four");
  eq(m.multiplier, 4, "فور ⇐ ×٤");
  ok(m.doubleOptions(m.doubleTurn).map(o => o.id).includes("gahwa"), "وبعد الفور تُطرَح القهوة");
  m.double(m.doubleTurn, "pass");
  eq(m.phase, "playing", "والبس يبدأ اللعب");

  const m2 = new BalootMatch({ allowDouble: false }, 17);
  let g2 = 0, found = false;
  while (g2++ < 40 && !found) {
    m2.startHand();
    while (m2.phase === "bidding") {
      const o = m2.bidOptions(m2.bidTurn).map(x => x.id);
      m2.bid(m2.bidTurn, o.includes("hokum") ? "hokum" : "pass", o.includes("hokum") ? B.suitOf(m2.bidCard) : undefined);
    }
    if (m2.mode === "hokum") found = true;
  }
  eq(m2.phase, "playing", "وبلا إعداد المضاعفة يُلعَب مباشرة");
}

console.log("⑭ القهوة");
{
  const m = new BalootMatch({}, 23);
  m.startHand();
  ok(!m.bidOptions(m.bidTurn).some(o => o.id === "gahwa"), "لا قهوة قبل بلوغ الحدّ");
  m.scores = [120, 0];
  m.startHand();
  const seat = m.bidTurn;
  const has = m.bidOptions(seat).some(o => o.id === "gahwa");
  eq(has, seat % 2 === 0, "والقهوة لمن بلغ فريقُه المئة وحده");
  if (has) {
    m.bid(seat, "gahwa");
    ok(m.gahwa, "أُعلنت القهوة");
    eq(m.mode, "sun", "وهي صنٌّ ما لم يُذكر نوع");
    eq(m.phase, "playing", "ولا مضاعفة بعدها");
  }
  const m2 = new BalootMatch({}, 23);
  m2.scores = [120, 0];
  m2.startHand();
  if (m2.bidTurn % 2 === 0) {
    m2.bid(m2.bidTurn, "gahwa", "H");
    eq(m2.mode, "hokum", "وقهوةٌ بنوعٍ = حكم");
    eq(m2.trump, "H", "بالنوع المطلوب");
  }
}

console.log("⑮ اللعب والأكلات");
{
  const m = rigged([
    ["AS", "KS", "7H", "8H", "9H", "10H", "JH", "QH"],
    ["10S", "QS", "7D", "8D", "9D", "10D", "JD", "QD"],
    ["JS", "9S", "7C", "8C", "9C", "10C", "JC", "QC"],
    ["8S", "7S", "KH", "AH", "KD", "AD", "KC", "AC"]
  ], { mode: "sun", first: 0 });

  eq(m.legalMoves(0).length, 8, "الافتتاح بأيّ ورقة");
  ok(!m.legalMoves(1).length, "ولا حركةَ لمن ليس دوره");
  m.play(0, "AS");
  eq(m.turn, 1, "وينتقل الدور عكس العقارب");
  eq(m.hands[0].length, 7, "وتنقص اليد ورقة");
  eq(m.legalMoves(1), ["10S", "QS"], "ومن بعده يتبع النوع");
  m.play(1, "10S"); m.play(2, "9S"); m.play(3, "8S");
  eq(m.trickNo, 1, "تمّت الأكلة الأولى");
  eq(m.lastTrickWinner, 0, "وأخذها صاحب الأكة");
  eq(m.rawPoints, [21, 0], "بمجموع ١١+١٠");
  eq(m.turn, 0, "ويفتتح الفائز");
  eq(m.trick.length, 0, "وتُفرَّغ الطاولة");

  let threw = false;
  try { m.play(1, "QS"); } catch (e) { threw = true; }
  ok(threw, "ولا يلعب من ليس دوره");
  m.play(0, "7H");
  eq(m.legalMoves(1).length, 7, "ومن لا يملك النوع فكلُّ يده مسموحة");
  m.play(1, "JD"); m.play(2, "7C");
  eq(m.legalMoves(3).sort(), ["AH", "KH"], "ومن يملكه يُحصَر فيه");
  threw = false;
  try { m.play(3, "KD"); } catch (e) { threw = true; }
  ok(threw, "ولا تُلعَب ورقةٌ خارج النوع مع وجوده");
}

console.log("⑯ آخر أكلة ومجموع النقاط");
{
  const m = rigged([
    ["AS", "KS", "QS", "JS", "10S", "9S", "8S", "7S"],
    ["AH", "KH", "QH", "JH", "10H", "9H", "8H", "7H"],
    ["AD", "KD", "QD", "JD", "10D", "9D", "8D", "7D"],
    ["AC", "KC", "QC", "JC", "10C", "9C", "8C", "7C"]
  ], { mode: "sun", first: 0 });
  for (let t = 0; t < 8; t++) {
    for (let k = 0; k < 4; k++) {
      const seat = m.turn;
      m.play(seat, m.legalMoves(seat)[0]);
    }
  }
  eq(m.phase, "handover", "انتهت اليد بثماني أكلات");
  eq(m.rawPoints[0] + m.rawPoints[1], B.RAW_TOTAL.sun, "ومجموع الخام ١٣٠ في الصنّ");
  eq(m.tricks[7].points >= 10, true, "وآخر أكلةٍ فيها عشرة زائدة");
  ok(!!m.lastResult, "وتُحسَب النتيجة");
  ok(m.scores[0] + m.scores[1] > 0, "وتُضاف للنقاط");
}

console.log("⑰ إعلان المشاريع والبلوت");
{
  const m = rigged([
    ["7S", "8S", "9S", "AH", "KH", "QH", "JH", "10H"],
    ["10S", "JS", "QS", "7D", "8D", "9D", "10D", "JD"],
    ["KS", "AS", "7C", "8C", "9C", "10C", "JC", "QC"],
    ["7H", "8H", "9H", "KD", "AD", "KC", "AC", "QD"]
  ], { mode: "sun", first: 0 });
  ok(m.declarableProjects(0).length >= 1, "للمقعد ٠ مشروعٌ قابلٌ للإعلان");
  m.play(0, "7S", { declare: true });
  ok((m.declared[0] || []).length >= 1, "أُعلن المشروع");
  m.play(1, "10S"); m.play(2, "AS"); m.play(3, "8H");
  ok(m.projectsShown, "وتُحسَم المشاريع بعد الأكلة الأولى");
  ok(m.projectsTeam !== null, "ولفريقٍ منهما");
  eq(m.declarableProjects(0).length, 0, "ولا إعلان بعد الأكلة الأولى");

  /* البلوت: شايب وبنت الحكم */
  const b = rigged([
    ["KS", "QS", "7S", "AH", "KH", "QH", "JH", "10H"],
    ["10S", "JS", "9S", "7D", "8D", "9D", "10D", "JD"],
    ["8S", "AS", "7C", "8C", "9C", "10C", "JC", "QC"],
    ["7H", "8H", "9H", "KD", "AD", "KC", "AC", "QD"]
  ], { mode: "hokum", trump: "S", first: 0 });
  ok(b.canDeclareBaloot(0, "KS"), "شايب الحكم مع بنته = بلوت");
  ok(b.canDeclareBaloot(0, "QS"), "ومن أيّهما");
  ok(!b.canDeclareBaloot(0, "7S"), "ولا بلوت بغيرهما");
  ok(!b.canDeclareBaloot(1, "JS"), "ولا لمن لا يملكهما");
  b.play(0, "KS", { baloot: true });
  eq(b.balootTeam, 0, "أُعلن البلوت لفريقه");
  ok(!b.canDeclareBaloot(0, "QS"), "ولا يُعلَن مرّتين");

  const s = rigged([["KS", "QS", "7S", "AH", "KH", "QH", "JH", "10H"], [], [], []], { mode: "sun" });
  ok(!s.canDeclareBaloot(0, "KS"), "ولا بلوت في الصنّ");
}

console.log("⑱ المنظور — ما يراه اللاعب");
{
  const m = new BalootMatch({}, 31);
  m.startHand();
  const v = B.view(m, 1);
  eq(v.me.hand.length, 5, "يرى يده كاملة");
  ok(!v.hands, "ولا يرى أيدي غيره");
  eq(v.handCounts, [5, 5, 5, 5], "بل أعدادها فقط");
  eq(JSON.stringify(v).includes(m.hands[0][0]) && !m.hands[1].includes(m.hands[0][0]), false,
     "ولا تتسرّب ورقةٌ من يد غيره إلى منظوره");
  ok(!!v.bidCard, "ويرى ورقة الشراء");
  eq(v.me.seat, 1, "ويعرف مقعده");
  ok(Array.isArray(v.me.bidOptions), "وخياراتِ شرائه");

  const v0 = B.view(m, null);
  eq(v0.me, null, "ومنظور المتفرّج بلا يد");
  const v2 = B.view(m, 2, [{ name: "أ" }, { name: "ب" }, { name: "ج" }, { name: "د" }]);
  eq(v2.players.length, 4, "ويضمّ الخادمُ بيانات اللاعبين للمنظور");
}

console.log("⑲ الأحداث");
{
  const m = new BalootMatch({}, 37);
  m.startHand();
  const e1 = m.takeEvents();
  ok(e1.some(e => e.t === "deal"), "التوزيع يُسجَّل حدثًا");
  ok(e1.some(e => e.t === "bidcard"), "وورقة الشراء كذلك");
  eq(m.takeEvents().length, 0, "ولا يُبَثّ حدثٌ مرّتين");
  while (m.phase === "bidding") {
    const o = m.bidOptions(m.bidTurn).map(x => x.id);
    m.bid(m.bidTurn, o.includes("sun") ? "sun" : "pass");
  }
  const e2 = m.takeEvents();
  ok(e2.some(e => e.t === "bid"), "والشراء حدث");
  ok(e2.some(e => e.t === "buy"), "وحسمُه حدث");
  ok(e2.some(e => e.t === "complete"), "والإكمال حدث");
  if (m.phase === "playing") {
    const seat = m.turn;
    m.play(seat, m.legalMoves(seat)[0]);
    const e3 = m.takeEvents();
    ok(e3.some(e => e.t === "play" && e.seat === seat), "ولعبُ الورقة حدث");
  }
}

console.log("⑳ العشوائيّة المحقونة");
{
  const a = new BalootMatch({}, 99); a.startHand();
  const b = new BalootMatch({}, 99); b.startHand();
  eq(a.hands, b.hands, "البذرة نفسها ⇐ التوزيع نفسه");
  const c = new BalootMatch({}, 100); c.startHand();
  ok(JSON.stringify(a.hands) !== JSON.stringify(c.hands), "وبذرةٌ أخرى ⇐ توزيعٌ آخر");
  ok(a.hands.flat().length === 20 && new Set(a.hands.flat()).size === 20, "ولا تكرار في التوزيع");
}

console.log("㉑ آلة الحالات — الأخطاء");
{
  const m = new BalootMatch({}, 41);
  m.startHand();
  const bad = (fn, why) => { let t = false; try { fn(); } catch (e) { t = true; } ok(t, why); };
  bad(() => m.play(m.bidTurn, m.hands[m.bidTurn][0]), "لا لعب في طور الشراء");
  bad(() => m.double(0, "double"), "ولا مضاعفة في طور الشراء");
  while (m.phase === "bidding") {
    const o = m.bidOptions(m.bidTurn).map(x => x.id);
    m.bid(m.bidTurn, o.includes("sun") ? "sun" : "pass");
  }
  bad(() => m.bid(m.bidTurn ?? 0, "sun"), "ولا شراء بعد انتهائه");
  if (m.phase === "playing") {
    bad(() => m.play(m.turn, "ZZ"), "ولا ورقةً غير موجودة");
    bad(() => m.play((m.turn + 1) % 4, m.hands[(m.turn + 1) % 4][0]), "ولا من غير صاحب الدور");
  }
  eq(m.actingSeat(), m.phase === "playing" ? m.turn : m.doubleTurn, "و`actingSeat` يدلّ على صاحب الدور");
}

console.log("㉒ نهاية الصكّة");
{
  const m = new BalootMatch({ targetScore: 20 }, 43);
  let guard = 0;
  while (!m.finished && guard++ < 200) {
    m.startHand();
    while (m.phase === "bidding") { const b = BOT.chooseBid(m, m.bidTurn, 2); m.bid(m.bidTurn, b.choice, b.suit); }
    if (m.phase === "redeal") continue;
    while (m.phase === "doubling") { const d = BOT.chooseDouble(m, m.doubleTurn, 2); m.double(m.doubleTurn, d.choice); }
    while (m.phase === "playing") { const c = BOT.chooseCard(m, m.turn, 2); m.play(m.turn, c.card, c); }
  }
  ok(m.finished, "بلغت الصكّة نهايتها", { guard, scores: m.scores });
  eq(m.phase, "finished", "والطور نهائيّ");
  ok(m.scores[m.winnerTeam] >= 20, "والفائز تجاوز الحدّ", m.scores);
  ok(m.history.length >= 1, "وسِجِلّ الأيدي محفوظ", m.history.length);
  ok(m.history.every(h => h.scores.length === 2), "وكلُّ يدٍ فيها لقطةُ النقاط");
}

/* ─────────────────────────────────────── */
console.log("㉓ ثلاثة آلاف يدٍ بالبوت");
{
  const S = { games: 0, hands: 0, sun: 0, hokum: 0, redeal: 0, capot: 0, doubled: 0,
              gahwa: 0, ashkal: 0, projects: 0, baloot: 0, buyerWon: 0, wins: [0, 0],
              illegal: 0, rawMismatch: 0, lowSum: 0, negative: 0, maxHands: 0, handCount: 0 };
  const N = 320;
  for (let g = 0; g < N; g++) {
    const m = new BalootMatch({}, 1000 + g);
    let guard = 0;
    while (!m.finished && guard++ < 400) {
      m.startHand();
      while (m.phase === "bidding") {
        const seat = m.bidTurn;
        const b = BOT.chooseBid(m, seat, 2);
        const allowed = m.bidOptions(seat);
        if (!allowed.some(o => o.id === b.choice)) { S.illegal++; break; }
        m.bid(seat, b.choice, b.suit);
      }
      if (m.phase === "redeal") { S.redeal++; continue; }
      while (m.phase === "doubling") {
        const seat = m.doubleTurn;
        const d = BOT.chooseDouble(m, seat, 2);
        m.double(seat, d.choice);
      }
      if (m.ashkal) S.ashkal++;
      while (m.phase === "playing") {
        const seat = m.turn;
        const legal = m.legalMoves(seat);
        const c = BOT.chooseCard(m, seat, 2);
        if (!c || !legal.includes(c.card)) { S.illegal++; break; }
        /* كلّ يدٍ في هذه اللحظة يجب أن تحوي ما بقي من أوراقها لا أكثر */
        m.play(seat, c.card, c);
      }
      if (m.phase !== "handover" && m.phase !== "finished") break;
      S.hands++; S.handCount += m.tricks.length;
      if (m.mode === "sun") S.sun++; else S.hokum++;
      const r = m.lastResult;
      if (r.capot !== null) S.capot++;
      if (m.multiplier > 1) S.doubled++;
      if (m.gahwa) S.gahwa++;
      if (m.projectsCounted.length) S.projects++;
      if (m.balootTeam !== null) S.baloot++;
      if (r.buyerWon) S.buyerWon++;
      if (m.rawPoints[0] + m.rawPoints[1] !== B.RAW_TOTAL[m.mode]) S.rawMismatch++;
      const sum = r.abnat[0] + r.abnat[1];
      const base = m.mode === "sun" ? m.rules.sunTotal : m.rules.hokumTotal;
      if (r.capot === null && m.multiplier === 1 && sum < base) S.lowSum++;
      if (r.abnat[0] < 0 || r.abnat[1] < 0) S.negative++;
      if (m.hands.some(h => h.length !== 0)) S.illegal++;
    }
    S.games++;
    if (m.winnerTeam !== null) S.wins[m.winnerTeam]++;
    S.maxHands = Math.max(S.maxHands, m.handNo);
  }
  console.log("     " + JSON.stringify({ ...S, wins: S.wins.join("/") }));
  ok(S.hands >= 3000, `أكثر من ٣٠٠٠ يد (${S.hands})`, S.hands);
  ok(S.illegal === 0, "بلا مخالفةِ قاعدةٍ واحدة", S.illegal);
  ok(S.rawMismatch === 0, "ومجموع الخام صحيحٌ في كلّ يد", S.rawMismatch);
  ok(S.lowSum === 0, "ومجموع الأبناط لا ينقص عن الحدّ", S.lowSum);
  ok(S.negative === 0, "ولا أبناطَ سالبة", S.negative);
  ok(S.handCount === S.hands * 8, "وكلّ يدٍ ثماني أكلات", { S: S.handCount, want: S.hands * 8 });
  ok(S.sun > 200 && S.hokum > 200, "والنمطان يقعان كلاهما", { sun: S.sun, hokum: S.hokum });
  ok(S.capot > 0 && S.doubled > 0 && S.projects > 0, "والكبوت والمضاعفة والمشاريع تقع", S);
  ok(S.buyerWon / S.hands > 0.5 && S.buyerWon / S.hands < 0.85,
     `والشاري يربح ${(100 * S.buyerWon / S.hands).toFixed(0)}٪ — معقولة`, S.buyerWon / S.hands);
  ok(S.maxHands < 60, "ولا صكّةَ لا تنتهي", S.maxHands);
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
