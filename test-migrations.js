// اختبار الهجرات ببِركةٍ وهمية: الترتيب، التسجيل، التخطّي، والتراجع عند الفشل.
const { STEPS, migratePg, migrateJson, LATEST } = require("./migrations");
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : "  → " + JSON.stringify(x))); };

function fakePool({ applied = [], failAt = null } = {}) {
  const log = [];
  const rows = applied.map(id => ({ id }));
  const run = async (sql, args) => {
    log.push(sql.trim().split("\n")[0].slice(0, 70));
    if (failAt && sql.includes(failAt)) throw new Error("خطأ مصطنع");
    if (/SELECT id FROM schema_migrations/.test(sql)) return { rows };
    if (/INSERT INTO schema_migrations/.test(sql)) { rows.push({ id: args[0] }); return { rows: [] }; }
    return { rows: [] };
  };
  return {
    log,
    query: run,
    connect: async () => ({ query: run, release() {} })
  };
}

(async () => {
  console.log("\n═══ اختبار الهجرات ═══\n");

  // ① قاعدة جديدة: كل الخطوات تُطبَّق بالترتيب
  let pool = fakePool();
  let n = await migratePg(pool, () => {});
  ok(n === STEPS.length, `قاعدة جديدة: طُبّقت ${n} خطوة من ${STEPS.length}`);
  ok(/CREATE TABLE IF NOT EXISTS schema_migrations/.test(pool.log[0]), "أوّل أمر: إنشاء جدول السجلّ");
  const begins = pool.log.filter(x => x === "BEGIN").length;
  ok(begins === STEPS.length, "كل خطوةٍ في معاملةٍ مستقلّة", begins);
  ok(pool.log.filter(x => x === "COMMIT").length === STEPS.length, "وكلّها اعتُمدت");

  // ② إعادة التشغيل: لا شيء يُعاد
  pool = fakePool({ applied: STEPS.map(s => s.id) });
  n = await migratePg(pool, () => {});
  ok(n === 0, "إعادة التشغيل: لا تُعاد خطوةٌ مطبَّقة", n);
  ok(!pool.log.includes("BEGIN"), "ولا تُفتح معاملة");

  // ③ قاعدة قديمة عليها الخطوة الأولى فقط
  pool = fakePool({ applied: [1] });
  n = await migratePg(pool, () => {});
  ok(n === STEPS.length - 1, "قاعدة قديمة: تُكمِل من حيث وقفت", n);

  // ④ الفشل يُلغي الخطوة كاملة ولا يُسجّلها
  pool = fakePool({ failAt: "CREATE TABLE IF NOT EXISTS sessions" });
  let err = null;
  try { await migratePg(pool, () => {}); } catch (e) { err = e.message; }
  ok(!!err && /فشلت الهجرة 3/.test(err), "الفشل يُبلَّغ باسم الخطوة ورقمها", err);
  ok(pool.log.includes("ROLLBACK"), "ويُتراجَع عن المعاملة");
  ok(pool.log.filter(x => x === "COMMIT").length === 2, "والخطوتان السابقتان بقيتا معتمدتين");

  // ⑤ الأرقام فريدة ومتصاعدة
  const ids = STEPS.map(s => s.id);
  ok(new Set(ids).size === ids.length, "أرقام الخطوات فريدة");
  ok(ids.every((v, i) => i === 0 || v > ids[i - 1]), "ومتصاعدة");
  ok(LATEST === ids[ids.length - 1], "LATEST يشير إلى آخر خطوة");

  // ⑥ التخزين المحلّي يُسجّل ولا يُكرّر
  const kv = {};
  const js = { getKV: async k => kv[k] || null, saveKV: async (k, v) => { kv[k] = v; } };
  await migrateJson(js, () => {});
  ok(JSON.stringify(kv.schemaVersion.ids) === JSON.stringify(ids), "JSON: سُجّلت كل الأرقام", kv.schemaVersion);
  const again = await migrateJson(js, () => {});
  ok(again === 0, "JSON: لا تُسجَّل مرّتين");

  console.log(`\n  ${P} ناجح / ${F} فاشل\n`);
  process.exit(F ? 1 : 0);
})();
