// اختبار الرهان المحجوز (escrow) — ذهبٌ يخرج من محفظةٍ ولم يدخل أخرى بعد.
//
// كلُّ اختبارٍ هنا سؤالٌ واحد: أين ذهب الذهب؟ فالمجموع قبل الحجز وبعد
// التسوية يجب أن يتساوى دائمًا — لا يُخلَق ذهبٌ من العدم ولا يضيع.

const { createStore } = require("./store");
const fs = require("fs");
const os = require("os");
const path = require("path");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const FILE = path.join(os.tmpdir(), "bet-" + Date.now() + ".json");

(async () => {
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const S = new JsonStore(FILE);
  await S.init();

  /* أربع محافظ */
  const U = [11, 12, 13, 14];
  for (const u of U) await S.move(u, "gold", 1000, { reason: "بذر" });
  const total = async () => {
    let t = 0;
    for (const u of U) t += (await S.getWallet(u)).gold;
    return t;
  };

  console.log("\n═══ الرهان المحجوز ═══\n");

  console.log("① الحجز");
  {
    eq(await total(), 4000, "بدأنا بأربعة آلاف");
    const r = await S.holdBet("room1", "baloot", 11, 250);
    ok(r.ok, "حُجز رهان", r);
    eq((await S.getWallet(11)).gold, 750, "وخرج من محفظته");
    const held = await S.heldBets("room1");
    eq(held.length, 1, "وسُجّل صفٌّ محجوز");
    eq(held[0].amount, 250, "بمقداره");

    const dup = await S.holdBet("room1", "baloot", 11, 250);
    ok(!dup.ok, "ولا يُحجَز للاعبٍ مرّتين في الطاولة نفسها", dup);
    eq((await S.getWallet(11)).gold, 750, "ولم يُخصَم مرّتين");

    const poor = await S.holdBet("room1", "baloot", 12, 99999);
    ok(!poor.ok && /يكفي/.test(poor.error), "ومن لا يملك لا يُحجَز له", poor);
    eq((await S.getWallet(12)).gold, 1000, "ومحفظته سليمة");

    const bad = await S.holdBet("room1", "baloot", 13, -50);
    ok(!bad.ok, "ولا رهانَ سالب", bad);
    const zero = await S.holdBet("room1", "baloot", 13, 0);
    ok(!zero.ok, "ولا رهانَ صفريّ", zero);
  }

  console.log("② التسوية للفائزين");
  {
    for (const u of [12, 13, 14]) await S.holdBet("room1", "baloot", u, 250);
    const held = await S.heldBets("room1");
    eq(held.length, 4, "الأربعة محجوزون");
    eq(await total(), 3000, "وخرج ألفٌ من المحافظ");

    const res = await S.settleBets("room1", [11, 13]);
    eq(res.pot, 1000, "المجموع ألف");
    eq(res.paid.length, 2, "ودُفع لفائزَين");
    eq((await S.getWallet(11)).gold, 1250, "لكلٍّ خمسُ مئة فوق ما بقي");
    eq((await S.getWallet(13)).gold, 1250, "وللآخر مثلها");
    eq((await S.getWallet(12)).gold, 750, "والخاسران خسرا رهانَهما");
    eq(await total(), 4000, "ولم يُخلَق ذهبٌ ولم يضِع");
    eq((await S.heldBets("room1")).length, 0, "ولم يبقَ محجوز");

    const again = await S.settleBets("room1", [11]);
    eq(again.pot, 0, "ولا تُسوَّى الطاولة مرّتين");
    eq(await total(), 4000, "فلا ذهبَ مضاعف");
  }

  console.log("③ القسمة غير المستوية");
  {
    for (const u of U) await S.holdBet("room2", "baloot", u, 251);
    const res = await S.settleBets("room2", [11, 12, 13]);
    eq(res.pot, 1004, "المجموع ١٠٠٤");
    const sum = res.paid.reduce((a, x) => a + x.amount, 0);
    eq(sum, 1004, "ووُزّع كاملًا بلا كسرٍ ضائع");
    ok(res.paid.every(x => x.amount >= 334), "وكلٌّ أخذ نصيبه", res.paid);
    eq(await total(), 4000, "والمجموع الكلّيّ ثابت");
  }

  console.log("④ الردّ");
  {
    const before = await total();
    for (const u of U) await S.holdBet("room3", "baloot", u, 300);
    eq(await total(), before - 1200, "حُجز ألفٌ ومئتان");
    const r = await S.refundBets("room3");
    eq(r.refunded.length, 4, "ورُدّ للأربعة");
    eq(await total(), before, "فعادت المحافظ كما كانت");
    eq((await S.heldBets("room3")).length, 0, "ولا محجوزَ باقٍ");
  }

  console.log("⑤ التسوية بلا فائز = ردّ");
  {
    const before = await total();
    for (const u of U) await S.holdBet("room4", "baloot", u, 120);
    const r = await S.settleBets("room4", []);
    eq(await total(), before, "بلا فائزٍ يُردّ لكلٍّ ما دفع");
    ok(r.ok, "والعمليّة ناجحة", r);
  }

  console.log("⑥ الكنس عند الإقلاع");
  {
    const before = await total();
    await S.holdBet("room5", "baloot", 11, 400);
    await S.holdBet("room6", "baloot", 12, 500);
    eq(await total(), before - 900, "محجوزٌ في طاولتين");
    const n = await S.sweepEscrow();
    eq(n, 2, "كُنس صفّان");
    eq(await total(), before, "ورُدّ كلُّ شيء");
    const s = await S.escrowStats();
    eq(s.held, 0, "ولم يبقَ محجوزٌ واحد");
    ok(s.refunded >= 2, "والمردود مسجَّل", s);
  }

  console.log("⑦ سقف الرهان اليوميّ");
  {
    const spent = await S.spentSince(11, Date.now() - 86400000, "رهان:حجز");
    ok(spent > 0, "ما حُجز اليوم محسوب", spent);
    const other = await S.spentSince(11, Date.now() - 86400000, "شراء:");
    eq(other, 0, "ولا يُخلَط بسببٍ آخر");
    const earned = await S.earnedSince(11, Date.now() - 86400000, "رهان:فوز");
    ok(earned > 0, "والمكسوب من الرهان محسوبٌ على حدة", earned);
  }

  console.log("⑧ الدفتر يشرح كلّ حركة");
  {
    const led = await S.ledgerOf(11, 50);
    ok(led.some(x => /رهان:حجز/.test(x.reason)), "الحجز مسجَّل");
    ok(led.some(x => /رهان:فوز/.test(x.reason)), "والفوز مسجَّل");
    ok(led.some(x => /رهان:ردّ/.test(x.reason)), "والردّ مسجَّل");
    ok(led.every(x => Number.isFinite(x.balanceAfter)), "وكلُّ حركةٍ معها الرصيد بعدها");
    /* الرصيد في الدفتر يوافق المحفظة */
    const w = (await S.getWallet(11)).gold;
    eq(led[0].balanceAfter, w, "وآخرُ رصيدٍ في الدفتر هو رصيد المحفظة");
  }

  try { fs.unlinkSync(FILE); } catch (e) {}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})();
