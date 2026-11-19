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
  const n = norm(u && typeof u === "object" ? u.name : u);
  if (!n) return false;
  return fromEnv().includes(n) || extra.includes(n);
}

function list() {
  const env = fromEnv();
  return [...env.map(name => ({ name, env: true })), ...extra.filter(n => !env.includes(n)).map(name => ({ name, env: false }))];
}

/** ترقيةٌ أو إنزالٌ من اللوحة. أدمنُ البيئة لا يُنزَل من هنا (يُنزَل من Render). */
async function set(store, name, on) {
  const n = norm(name);
  if (!n) return { ok: false, error: "اكتب اسم الحساب" };
  if (!on && fromEnv().includes(n)) return { ok: false, error: "هذا أدمنٌ من إعدادات Render (ADMIN_ACCOUNTS) — يُنزَل من هناك" };
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
const accountsEnabled = () => fromEnv().length > 0;

module.exports = { load, isAdmin, list, set, accountsEnabled, norm };
