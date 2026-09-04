// اختبار الإعدادات: المدى في الكود، والقيمة الفاسدة لا تُشغّل الموقع.
const fs = require("fs"), os = require("os"), path = require("path");
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const tmp = path.join(os.tmpdir(), "set-" + Date.now() + ".json");
const { createStore } = require("./store");
const S = require("./settings");
const E = require("./economy");

(async () => {
  console.log("\n═══ الإعدادات الحيّة ═══\n");
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const s = new JsonStore(tmp);

  console.log("── التحقّق ──");
  ok(S.validate("economy", "quizWin", 50).ok, "رقمٌ داخل المدى يُقبَل");
  ok(!S.validate("economy", "quizWin", 99999).ok, "وفوقَه يُرفَض");
  ok(!S.validate("economy", "quizWin", -1).ok, "وتحته يُرفَض");
  ok(!S.validate("economy", "quizWin", "كلام").ok, "ونصٌّ يُرفَض");
  ok(S.validate("economy", "quizWin", "50").value === 50, "ونصٌّ رقميّ يُحوَّل");
  ok(S.validate("economy", "quizWin", 50.7).value === 51, "والكسر يُقرَّب");
  ok(!S.validate("economy", "لا-يوجد", 1).ok, "ومفتاحٌ مجهول يُرفَض");
  ok(!S.validate("لا-يوجد", "quizWin", 1).ok, "ونطاقٌ مجهول يُرفَض");
  ok(S.validate("site", "registerOpen", "أيّ شيء").value === true, "المنطقيّ يُحوَّل");
  ok(S.validate("site", "notice", "x".repeat(500)).value.length === 200, "والنصّ يُقَصّ عند حدّه");

  console.log("\n── الافتراضيّ والحفظ ──");
  S.resetCache();
  ok(S.get("economy", "quizWin") === 60, "الافتراضيّ قبل أيّ حفظ", S.get("economy", "quizWin"));
  let r = await S.set(s, "economy", "quizWin", 90, "tester");
  ok(r.ok && S.get("economy", "quizWin") === 90, "الحفظ يُحدّث الذاكرة فورًا", r);
  ok((await s.getSettings("economy")).quizWin === 90, "ويصل المخزن", await s.getSettings("economy"));
  r = await S.set(s, "economy", "quizWin", 1e9, "tester");
  ok(!r.ok && S.get("economy", "quizWin") === 90, "والرفض لا يمسّ القيمة القائمة", r);

  console.log("\n── إعادة التحميل ──");
  S.resetCache();
  ok(S.get("economy", "quizWin") === 60, "الذاكرة صُفِّرت");
  await S.load(s);
  ok(S.get("economy", "quizWin") === 90, "والتحميل يُرجع المحفوظ", S.get("economy", "quizWin"));

  /* الحالة الخطرة: قيمةٌ فاسدة في القاعدة (تعديلٌ يدويّ أو إعدادٌ قديم).
     المطلوب ألّا تُشغّل الموقع، لا أن تُسقطه. */
  await s.setSetting("economy", "quizWin", 500000);
  await s.setSetting("economy", "dailyTotal", "خربشة");
  const before = console.error; console.error = () => {};
  await S.load(s);
  console.error = before;
  ok(S.get("economy", "quizWin") === 60, "قيمةٌ فاسدة في القاعدة تُتجاهَل ويُستعمل الافتراضيّ");
  ok(S.get("economy", "dailyTotal") === 900, "وكذلك النصّ في مكان الرقم");

  console.log("\n── أثرها في الاقتصاد ──");
  S.resetCache();
  const u1 = await s.createUser("أ", "", "", {}), u2 = await s.createUser("ب", "", "", {});
  const players = [{ userId: u1, id: "p1", ip: "1.1.1.1" }, { userId: u2, id: "p2", ip: "2.2.2.2" }];
  let g = await E.awardMatch(s, { game: "quiz", players, winnerId: "p1", matchId: "m1" });
  ok((await s.getWallet(u1)).gold === 60, "الفائز أخذ الافتراضيّ ٦٠", await s.getWallet(u1));

  await S.set(s, "economy", "quizWin", 111, "tester");
  g = await E.awardMatch(s, { game: "quiz", players, winnerId: "p1", matchId: "m2" });
  ok((await s.getWallet(u1)).gold === 60 + 111, "وبعد التغيير أخذ ١١١ بلا إعادة تشغيل", await s.getWallet(u1));

  await S.set(s, "economy", "quizCap", 0, "tester");
  const gold = (await s.getWallet(u1)).gold;
  g = await E.awardMatch(s, { game: "quiz", players, winnerId: "p1", matchId: "m3" });
  ok((await s.getWallet(u1)).gold === gold, "وسقفٌ صفرٌ يوقف المنح تمامًا", g.granted);

  S.resetCache();
  try { fs.unlinkSync(tmp); } catch (e) {}
  try { fs.rmSync(path.join(path.dirname(tmp), "blobs"), { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
