// اختبار طبقة الهوية والمخزن: كلمات السرّ، الترقية، الجلسات — على JsonStore حقيقيّ.
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const A = require("./auth");
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : "  → " + JSON.stringify(x))); };

const tmp = path.join(os.tmpdir(), "auth-test-" + Date.now() + ".json");
process.env.DATABASE_URL = "";
const { createStore } = require("./store");

(async () => {
  console.log("\n═══ اختبار الهوية ═══\n");
  const StoreMod = require("./store");
  // JsonStore مباشرةً بملفٍّ مؤقّت
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const store = new JsonStore(tmp);
  const S = A.makeSessions(store);

  // ① إنشاء مستخدم بمعرّف
  const ph = await A.hashPassword("سرّي الطويل ١٢٣");
  const id = await store.createUser("أحمد", "", "", { passHash: ph });
  ok(id === 1, "أوّل مستخدم يأخذ المعرّف ١", id);
  const u = await store.getUser("أحمد");
  ok(u && u.id === 1 && u.passHash === ph, "يُقرأ بالاسم بمعرّفه وتجزئته");
  ok((await store.getUserById(1)).name === "أحمد", "ويُقرأ بالمعرّف");
  const id2 = await store.createUser("سارة", "", "", {});
  ok(id2 === 2, "المعرّفات تتصاعد", id2);

  // ② كلمة السرّ
  ok(await A.verifyNew("سرّي الطويل ١٢٣", ph), "التحقّق الصحيح ينجح");
  ok(!(await A.verifyNew("سرّي الطويل ١٢٤", ph)), "والخاطئ يفشل");

  // ③ حسابٌ قديم يُرقَّى عند الدخول
  const salt = crypto.randomBytes(16).toString("hex");
  const legacy = crypto.scryptSync("قديمة جدًّا", salt, 64).toString("hex");
  const oldId = await store.createUser("قديم", salt, legacy, {});
  const old = await store.getUserById(oldId);
  ok(!old.passHash && A.needsUpgrade(old.passHash), "القديم بلا تجزئةٍ جديدة");
  ok(await A.verifyLegacy("قديمة جدًّا", old.salt, old.hash), "لكن كلمته القديمة تُتحقَّق");
  await store.updateUser(oldId, { passHash: await A.hashPassword("قديمة جدًّا"), passChangedAt: Date.now() });
  const up = await store.getUserById(oldId);
  ok(!A.needsUpgrade(up.passHash), "وبعد الترقية لا يحتاج ترقية");
  ok(await A.verifyNew("قديمة جدًّا", up.passHash), "وكلمته نفسها ما زالت تعمل");

  // ④ الجلسات
  const s1 = await S.create(1, { ua: "جهاز أ", ip: "1.1.1.1" });
  const s2 = await S.create(1, { ua: "جهاز ب", ip: "2.2.2.2" });
  ok((await S.userOf(s1.token)).name === "أحمد", "الرمز يعيد صاحبه");
  ok((await S.list(1)).length === 2, "جلستان نشطتان");
  ok(await S.userOf("رمز مزوّر") === null, "رمزٌ مزوّر لا يعيد أحدًا");
  await S.revoke(s1.token);
  ok(await S.userOf(s1.token) === null, "الإبطال الفرديّ يعمل");
  ok(await S.userOf(s2.token) !== null, "ولا يمسّ الجلسة الأخرى");
  await S.revokeAll(1);
  ok(await S.userOf(s2.token) === null, "الخروج من كل الأجهزة يعمل");

  // ⑤ الرمز لا يُخزَّن كما هو
  const raw = fs.existsSync(tmp) ? fs.readFileSync(tmp, "utf8") : "";
  await new Promise(r => setTimeout(r, 700));
  const raw2 = fs.readFileSync(tmp, "utf8");
  ok(!raw2.includes(s2.token), "الرمز نفسه لا يُكتب في القاعدة (تُخزَّن تجزئته)");

  // ⑥ انتهاء الصلاحية
  await store.createSession({ userId: 2, tokenHash: A.tokenHash("منتهية"), ua: "", ip: "",
                              createdAt: Date.now() - 1000, expiresAt: Date.now() - 1 });
  ok(await S.userOf("منتهية") === null, "الجلسة المنتهية لا تُقبل");
  ok((await store.purgeSessions()) >= 1, "التنظيف يحذف المنتهية والمُبطَلة");

  fs.unlinkSync(tmp);
  console.log(`\n  ${P} ناجح / ${F} فاشل\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
