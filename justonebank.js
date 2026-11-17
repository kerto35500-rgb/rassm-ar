// 🔤 «كلمة واحدة فقط» — بنكُ الكلمات السرّيّة.
//
// القائمةُ الأساس في justone-words.js، وفوقها تعديلاتُ الأدمن محفوظةً في
// الإعدادات (نطاق «justone»): كلماتٌ مُضافة، وكلماتٌ أساسيّةٌ مُخفاة. فيُضيف
// صاحبُ الموقع ويحذف من لوحته بلا نشرٍ جديد، ولا يُمَسّ الملفّ الأساس —
// وحذفُ كلمةٍ أساسيّةٍ «إخفاءٌ» يُتراجَع عنه، لا محوٌ نهائيّ.
//
// والمقارنةُ كلُّها بعد التطبيع: «التفاحة» و«تفاحة» كلمةٌ واحدة، فلا تُضاف مرّتين.
"use strict";

const BASE = require("./justone-words");
const N = require("./public/justone/norm");

const SCOPE = "justone";
const MAX_LEN = 20;

const baseFlat = [];
for (const cat in BASE) for (const w of BASE[cat]) baseFlat.push({ w, cat });

let added = [], removed = [];
let pool = [];

const clean = w => String(w == null ? "" : w).replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
/** كلمةٌ صالحة: واحدة، حرفان فأكثر بعد التطبيع، بلا رموزٍ تُفرّغها */
function okWord(w) {
  const c = clean(w);
  return !!c && !N.isMulti(c) && !/\s/.test(c) && N.norm(c).length >= 2;
}

function rebuild() {
  const rm = new Set(removed.map(N.norm));
  const seen = new Set(), out = [];
  for (const { w } of baseFlat) {
    const n = N.norm(w);
    if (rm.has(n) || seen.has(n)) continue;
    seen.add(n); out.push(w);
  }
  for (const w of added) {
    const n = N.norm(w);
    if (rm.has(n) || seen.has(n)) continue;
    seen.add(n); out.push(w);
  }
  pool = out;
}
rebuild();

/** يقرأ تعديلات الأدمن من المخزن (عند الإقلاع). قيمةٌ فاسدةٌ تُتجاهَل. */
async function load(store) {
  try {
    const s = (await store.getSettings(SCOPE)) || {};
    added = Array.isArray(s.added) ? s.added.map(clean).filter(okWord) : [];
    removed = Array.isArray(s.removed) ? s.removed.map(clean).filter(okWord) : [];
  } catch (e) { /* المخزنُ غير متاح: القائمةُ الأساس وحدها */ }
  rebuild();
  return pool.length;
}

async function save(store, key, by) {
  await store.setSetting(SCOPE, key, key === "added" ? added : removed, by || "admin");
}

/** إضافة: إن كانت كلمةً أساسيّةً مُخفاةً أُعيدت، وإن كانت موجودةً رُفضت. */
async function add(store, word, by) {
  const w = clean(word);
  if (!okWord(w)) return { ok: false, error: `كلمةٌ واحدةٌ من حرفين إلى ${MAX_LEN} (بلا مسافات)` };
  const n = N.norm(w);
  if (removed.some(x => N.norm(x) === n)) {
    removed = removed.filter(x => N.norm(x) !== n);
    await save(store, "removed", by);
    rebuild();
    return { ok: true, restored: true, word: w };
  }
  if (pool.some(x => N.norm(x) === n)) return { ok: false, error: `«${w}» موجودةٌ في القائمة` };
  added.push(w);
  await save(store, "added", by);
  rebuild();
  return { ok: true, word: w };
}

/** حذف: المُضافةُ تُمحى، والأساسيّةُ تُخفى (وتُستعاد بإضافتها من جديد). */
async function remove(store, word, by) {
  const w = clean(word), n = N.norm(w);
  if (added.some(x => N.norm(x) === n)) {
    added = added.filter(x => N.norm(x) !== n);
    await save(store, "added", by);
    rebuild();
    return { ok: true, word: w };
  }
  if (baseFlat.some(x => N.norm(x.w) === n)) {
    if (!removed.some(x => N.norm(x) === n)) removed.push(w);
    await save(store, "removed", by);
    rebuild();
    return { ok: true, hidden: true, word: w };
  }
  return { ok: false, error: `«${w}» ليست في القائمة` };
}

/** للوحة الأدمن: الأساسُ بتصنيفاته وحالةِ كلّ كلمة، والمُضافة، والمُخفاة. */
function listAll() {
  const rm = new Set(removed.map(N.norm));
  const cats = {};
  for (const { w, cat } of baseFlat) (cats[cat] = cats[cat] || []).push({ w, hidden: rm.has(N.norm(w)) });
  return { cats, added: added.slice(), removed: removed.slice(), total: pool.length, base: baseFlat.length };
}

const words = () => pool.slice();

/** بطاقة: خمسُ كلماتٍ مختلفةٍ لم تظهر في هذه المباراة بعد (used: تطبيعاتُها).
    إن ضاقت القائمةُ عمّا يكفي سُمح بالمُكرَّر — لا تتوقّف اللعبةُ لنقص كلمات. */
function deal(rng, used, n = 5) {
  const R = typeof rng === "function" ? rng : Math.random;
  const fresh = pool.filter(w => !used || !used.has(N.norm(w)));
  const src = fresh.length >= n ? fresh : pool.slice();
  const pick = [], taken = new Set();
  let guard = 0;
  while (pick.length < n && guard++ < 5000 && src.length) {
    const w = src[Math.floor(R() * src.length)];
    const k = N.norm(w);
    if (taken.has(k)) continue;
    taken.add(k); pick.push(w);
  }
  return pick;
}

module.exports = { load, add, remove, listAll, words, deal, okWord, SCOPE, MAX_LEN };
