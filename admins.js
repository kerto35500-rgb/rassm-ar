// 👑 حساباتُ الأدمن — من يدخل لوحة التحكّم بحسابه العاديّ في الموقع.
//
// لا اسمَ ولا كلمةَ مرورٍ للأدمن في الكود: المستودعُ يقرؤه غيرُ صاحبه، وكلمةٌ
// مكتوبةٌ فيه مفتاحُ الموقع لكلّ قارئ. بل يُنشئ صاحبُ الموقع حسابًا عاديًّا
// بكلمته هو، ثمّ يُعلَن أدمنًا بطريقتين:
//   ١) متغيّرُ البيئة ADMIN_ACCOUNTS في Render (أسماءُ حساباتٍ مفصولةٌ بفاصلة) —
//      هذا الأصل، ولا يُنزَع من اللوحة.
//   ٢) من اللوحة نفسها: أدمنٌ يرقّي حسابًا آخر أو يُنزله (يُحفظ في المخزن).
//
// والمقارنةُ بالاسم «كما هو» حرفًا بحرف (بلا تسويةٍ لحالة الأحرف ولا للمسافات
// الداخليّة): الحساباتُ تتمايز بذلك، فلو سوّينا لصار «Kerto» أدمنًا لأنّ «kerto»
// أدمن — ومن سبق إلى الاسم القريب أخذ اللوحة.
"use strict";

const KEY = "adminAccounts";
const norm = n => String(n == null ? "" : n).trim();
const fromEnv = () => String(process.env.ADMIN_ACCOUNTS || "").split(/[,،\n]+/).map(norm).filter(Boolean);

/* صاحبُ الموقع: حسابُه أدمنٌ من الكود مباشرةً — بلا إعدادٍ في Render، وبكلمة
   مروره هو (لا كلمةَ في الكود). والشرط أن يكون الحسابُ أُنشئ قبل لحظة كتابة
   هذا السطر: فلو حُذف الحسابُ يومًا لما استطاع أحدٌ أن يسجّل الاسمَ من جديد
   ويأخذ اللوحة. */
const OWNERS = [
  { name: "kerto3500", before: 1795082405776 },
  { name: "A.mas_98", before: 1795082932201 }   /* حسابُ صاحب الموقع القائم (اسمُ الدخول حرفًا بحرف) */
];
const ownerOf = u => {
  if (!u || typeof u !== "object") return false;
  const o = OWNERS.find(x => x.name === u.name);
  if (!o) return false;
  const c = Number(u.created || 0);
  return c < o.before;            /* حساباتٌ قديمةٌ بلا تاريخ (0) قبلها */
};

let extra = [];          /* ما رُقّي من اللوحة */

async function load(store) {
  try {
    const v = await store.getKV(KEY);
    extra = Array.isArray(v) ? v.map(norm).filter(Boolean) : [];
  } catch (e) { extra = []; }
  return list();
}

/** هل هذا الحسابُ أدمن؟ (يقبل كائنَ المستخدم أو اسمَه) */
function isAdmin(u) {
  if (ownerOf(u)) return true;
  const n = norm(u && typeof u === "object" ? u.name : u);
  if (!n) return false;
  return fromEnv().includes(n) || extra.includes(n);
}

function list() {
  const env = [...OWNERS.map(o => o.name), ...fromEnv().filter(n => !OWNERS.some(o => o.name === n))];
  return [...env.map(name => ({ name, env: true })), ...extra.filter(n => !env.includes(n)).map(name => ({ name, env: false }))];
}

/** ترقيةٌ أو إنزالٌ من اللوحة. أدمنُ البيئة لا يُنزَل من هنا (يُنزَل من Render). */
async function set(store, name, on) {
  const n = norm(name);
  if (!n) return { ok: false, error: "اكتب اسم الحساب" };
  if (!on && (fromEnv().includes(n) || OWNERS.some(o => o.name === n))) return { ok: false, error: "هذا أدمنٌ من إعدادات Render (ADMIN_ACCOUNTS) — يُنزَل من هناك" };
  if (on) {
    const u = await store.getUser(name);
    if (!u) return { ok: false, error: "لا يوجد حسابٌ بهذا الاسم — أنشئه أوّلًا من الصفحة الرئيسيّة" };
    if (!extra.includes(u.name)) extra.push(u.name);
  } else {
    if (!extra.includes(n)) return { ok: false, error: "ليس أدمنًا" };
    extra = extra.filter(x => x !== n);
  }
  await store.saveKV(KEY, extra);
  return { ok: true, list: list() };
}

/** هل في الموقع طريقٌ لأدمنٍ بالحساب؟ (لتُركَّب اللوحة ولو بلا ADMIN_USER/PASS) */
const accountsEnabled = () => OWNERS.length > 0 || fromEnv().length > 0;

module.exports = { load, isAdmin, list, set, accountsEnabled, norm, OWNERS };
