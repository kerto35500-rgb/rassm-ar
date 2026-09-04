// ⚙️ الإعدادات الحيّة — أرقامٌ تُغيَّر من اللوحة بلا نشرٍ جديد.
//
// المبدأ: القيمة في القاعدة، لكن **المدى في الكود**. اللوحة تقترح والكود
// يقبل أو يرفض. فلو أخطأ أحدٌ فكتب سقفًا يوميًّا بمليون، أو جائزةً سالبة،
// رُدَّت قبل أن تلمس القاعدة. الإعداد الحرّ بلا حدٍّ ليس مرونةً بل ثغرة.
//
// والقراءة من ذاكرةٍ محدَّثة لا من القاعدة: الألعاب تسأل عن الجائزة عند كل
// نهاية مباراة، ولا يليق أن يصير ذلك استعلامًا.

const SCHEMA = {
  economy: {
    welcomeGold:  { def: 500, min: 0,  max: 5000, name: "هديّة الترحيب", hint: "تُمنح مرّةً عند أوّل زيارةٍ للمتجر" },
    dailyTotal:   { def: 900, min: 50, max: 20000, name: "سقف الكسب اليوميّ الكلّيّ" },
    unoSoloCap:   { def: 80,  min: 0,  max: 2000, name: "سقف «وحدة» المنفردة", hint: "اللعب ضدّ الحاسوب — نتيجته من العميل فاجعله صغيرًا" },
    quizWin:      { def: 60,  min: 0,  max: 1000, name: "قمّة الهرم · فوز" },
    quizPlay:     { def: 20,  min: 0,  max: 1000, name: "قمّة الهرم · مشاركة" },
    quizCap:      { def: 400, min: 0,  max: 10000, name: "قمّة الهرم · سقف يوميّ" },
    bombWin:      { def: 50,  min: 0,  max: 1000, name: "القنبلة · فوز" },
    bombPlay:     { def: 18,  min: 0,  max: 1000, name: "القنبلة · مشاركة" },
    bombCap:      { def: 350, min: 0,  max: 10000, name: "القنبلة · سقف يوميّ" },
    salfaWin:     { def: 45,  min: 0,  max: 1000, name: "برّا السالفة · فوز" },
    salfaPlay:    { def: 16,  min: 0,  max: 1000, name: "برّا السالفة · مشاركة" },
    salfaCap:     { def: 350, min: 0,  max: 10000, name: "برّا السالفة · سقف يوميّ" },
    drawWin:      { def: 40,  min: 0,  max: 1000, name: "ارسمها! · فوز" },
    drawPlay:     { def: 15,  min: 0,  max: 1000, name: "ارسمها! · مشاركة" },
    drawCap:      { def: 300, min: 0,  max: 10000, name: "ارسمها! · سقف يوميّ" },
    unoWin:       { def: 40,  min: 0,  max: 1000, name: "وحدة · فوز" },
    unoPlay:      { def: 15,  min: 0,  max: 1000, name: "وحدة · مشاركة" },
    unoCap:       { def: 300, min: 0,  max: 10000, name: "وحدة · سقف يوميّ" }
  },
  site: {
    registerOpen: { def: true, type: "bool", name: "التسجيل مفتوح",
                    hint: "إغلاقه يمنع الحسابات الجديدة ولا يمسّ القائمة" },
    shopOpen:     { def: true, type: "bool", name: "المتجر مفتوح" },
    notice:       { def: "",   type: "text", max: 200, name: "شريط إعلان",
                    hint: "يظهر أعلى الصفحة الرئيسية — اتركه فارغًا لإخفائه" }
  }
};

/* الذاكرة الحيّة: تُملأ عند الإقلاع وتُحدَّث عند كل تغيير */
const cache = {};
function resetCache() {
  for (const scope in SCHEMA) {
    cache[scope] = {};
    for (const k in SCHEMA[scope]) cache[scope][k] = SCHEMA[scope][k].def;
  }
}
resetCache();

/** يتحقّق من قيمةٍ مقترحة ويُرجع {ok,value} أو {ok:false,error}. */
function validate(scope, key, raw) {
  const s = SCHEMA[scope] && SCHEMA[scope][key];
  if (!s) return { ok: false, error: "إعدادٌ غير معروف" };
  const t = s.type || "int";
  if (t === "bool") return { ok: true, value: !!raw };
  if (t === "text") {
    const v = String(raw == null ? "" : raw).slice(0, s.max || 200);
    return { ok: true, value: v };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: "أدخل رقمًا" };
  const v = Math.round(n);
  if (v < s.min || v > s.max) return { ok: false, error: `القيمة بين ${s.min} و${s.max}` };
  return { ok: true, value: v };
}

/** يقرأ كل الإعدادات من المخزن إلى الذاكرة. القيمة الفاسدة تُتجاهَل. */
async function load(store) {
  resetCache();
  let saved = {};
  try { saved = (await store.getSettings()) || {}; } catch (e) { return cache; }
  for (const scope in SCHEMA) {
    for (const key in SCHEMA[scope]) {
      const v = saved[scope] && saved[scope][key];
      if (v === undefined || v === null) continue;
      const c = validate(scope, key, v);
      if (c.ok) cache[scope][key] = c.value;
      /* قيمةٌ خارج المدى في القاعدة (بقيّةُ إعدادٍ قديم أو تعديلٌ يدويّ):
         نتجاهلها ونُبقي الافتراضيّ بدل أن نُشغّل الموقع برقمٍ فاسد. */
      else console.error(`⚙️  تجاهلتُ ${scope}.${key}: ${c.error}`);
    }
  }
  return cache;
}

async function set(store, scope, key, raw, by) {
  const c = validate(scope, key, raw);
  if (!c.ok) return c;
  await store.setSetting(scope, key, c.value, by);
  cache[scope][key] = c.value;
  return { ok: true, value: c.value };
}

const get = (scope, key) => (cache[scope] || {})[key];
const all = () => JSON.parse(JSON.stringify(cache));

/** الشكل الذي تفهمه الواجهة: القيمة الحالية مع اسمها ومداها. */
function describe() {
  const out = {};
  for (const scope in SCHEMA) {
    out[scope] = Object.entries(SCHEMA[scope]).map(([key, s]) => ({
      key, name: s.name, hint: s.hint || null, type: s.type || "int",
      min: s.min, max: s.max, def: s.def, value: cache[scope][key]
    }));
  }
  return out;
}

module.exports = { SCHEMA, load, set, get, all, describe, validate, resetCache };
