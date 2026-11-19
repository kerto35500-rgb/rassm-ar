// 📡 «التخاطر» — بنكُ بطاقات المفاهيم المتعاكسة.
//
// القائمةُ الأساس في wavecards.js، وفوقها تعديلاتُ الأدمن محفوظةً في الإعدادات
// (نطاق «wave»): بطاقاتٌ مُضافة، وبطاقاتٌ أساسيّةٌ مُخفاة — كبنك «كلمة واحدة
// فقط» تمامًا. فيُضيف صاحبُ الموقع ويحذف من لوحته بلا نشرٍ جديد، وحذفُ بطاقةٍ
// أساسيّةٍ «إخفاءٌ» يُتراجَع عنه.
//
// البطاقةُ نصٌّ «يسار | يمين»؛ والمقارنةُ بعد التطبيع (همزاتٌ وتاءٌ مربوطة و«ال»).
"use strict";

const BASE = require("./wavecards");
const N = require("./public/justone/norm");

const SCOPE = "wave";
const MAX_SIDE = 30;

const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
/** «يسار | يمين» ⇒ {left, right} أو null */
function parse(raw) {
  const parts = String(raw == null ? "" : raw).split(/\s*[|｜]\s*/);
  if (parts.length !== 2) return null;
  const left = clean(parts[0]).slice(0, MAX_SIDE), right = clean(parts[1]).slice(0, MAX_SIDE);
  if (!N.norm(left) || !N.norm(right) || N.norm(left) === N.norm(right)) return null;
  return { left, right };
}
const fmt = c => c.left + " | " + c.right;
const key = c => N.norm(c.left) + "|" + N.norm(c.right);

const baseFlat = [];
for (const cat in BASE) for (const raw of BASE[cat]) { const c = parse(raw); if (c) baseFlat.push({ c, cat }); }

let added = [], removed = [];   /* نصوصٌ «يسار | يمين» */
let pool = [];

function rebuild() {
  const rm = new Set(removed.map(parse).filter(Boolean).map(key));
  const seen = new Set(), out = [];
  const push = c => { const k = key(c); if (rm.has(k) || seen.has(k)) return; seen.add(k); out.push(c); };
  for (const { c } of baseFlat) push(c);
  for (const raw of added) { const c = parse(raw); if (c) push(c); }
  pool = out;
}
rebuild();

async function load(store) {
  try {
    const s = (await store.getSettings(SCOPE)) || {};
    added = Array.isArray(s.added) ? s.added.filter(x => parse(x)).map(x => fmt(parse(x))) : [];
    removed = Array.isArray(s.removed) ? s.removed.filter(x => parse(x)).map(x => fmt(parse(x))) : [];
  } catch (e) { /* المخزنُ غير متاح: القائمةُ الأساس وحدها */ }
  rebuild();
  return pool.length;
}
async function save(store, k, by) { await store.setSetting(SCOPE, k, k === "added" ? added : removed, by || "admin"); }

/** إضافة: بطاقةٌ أساسيّةٌ مُخفاةٌ تُعاد، والموجودةُ تُرفض */
async function add(store, raw, by) {
  const c = parse(raw);
  if (!c) return { ok: false, error: "اكتب طرفين مختلفين بينهما خطٌّ عموديّ: «بارد | حار»" };
  const k = key(c), text = fmt(c);
  if (removed.some(x => key(parse(x)) === k)) {
    removed = removed.filter(x => key(parse(x)) !== k);
    await save(store, "removed", by);
    rebuild();
    return { ok: true, restored: true, card: text };
  }
  if (pool.some(x => key(x) === k)) return { ok: false, error: `«${text}» موجودةٌ في القائمة` };
  added.push(text);
  await save(store, "added", by);
  rebuild();
  return { ok: true, card: text };
}
/** حذف: المُضافةُ تُمحى، والأساسيّةُ تُخفى */
async function remove(store, raw, by) {
  const c = parse(raw);
  if (!c) return { ok: false, error: "بطاقةٌ غير صالحة" };
  const k = key(c), text = fmt(c);
  if (added.some(x => key(parse(x)) === k)) {
    added = added.filter(x => key(parse(x)) !== k);
    await save(store, "added", by);
    rebuild();
    return { ok: true, card: text };
  }
  if (baseFlat.some(x => key(x.c) === k)) {
    if (!removed.some(x => key(parse(x)) === k)) removed.push(text);
    await save(store, "removed", by);
    rebuild();
    return { ok: true, hidden: true, card: text };
  }
  return { ok: false, error: `«${text}» ليست في القائمة` };
}

function listAll() {
  const rm = new Set(removed.map(x => key(parse(x))));
  const cats = {};
  for (const { c, cat } of baseFlat) (cats[cat] = cats[cat] || []).push({ w: fmt(c), hidden: rm.has(key(c)) });
  return { cats, added: added.slice(), removed: removed.slice(), total: pool.length, base: baseFlat.length };
}
const cards = () => pool.map(c => ({ ...c }));

/** بطاقةٌ لم تُستعمل في هذه المباراة (used: مفاتيحُها) — وإن نفدت سُمح بالمكرّر */
function deal(rng, used) {
  const R = typeof rng === "function" ? rng : Math.random;
  const fresh = pool.filter(c => !used || !used.has(key(c)));
  const src = fresh.length ? fresh : pool;
  const c = src[Math.floor(R() * src.length)];
  return c ? { ...c } : { left: "بارد", right: "حار" };
}

module.exports = { load, add, remove, listAll, cards, deal, parse, key, fmt, SCOPE };
