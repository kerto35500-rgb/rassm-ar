// 🎮 حالةُ الألعاب — يفتحها الأدمن أو يُغلقها للصيانة أو يُخفيها، ويضيف بطاقات.
//
// لكلّ لعبةٍ حالة: «open» مفتوحة، أو «maint» صيانة (تظهر في الرئيسيّة بشارة
// ولا تُفتح صفحتُها)، أو «hidden» مخفيّة (لا تظهر ولا تُفتح). والأدمنُ يدخلها
// في كلّ حال ليجرّبها قبل أن يفتحها للناس.
//
// والبطاقاتُ المضافة: عنوانٌ وأيقونةٌ ووصفٌ ورابط (داخليّ أو خارجيّ)، أو
// «قريبًا» بلا رابط — لعبةٌ جديدةٌ كاملة تحتاج كودًا، أمّا بطاقتُها فمن هنا.
//
// كلُّ شيءٍ في المخزن (KV «gamesState») فينجو من كلّ نشرٍ وإعادة تشغيل.
"use strict";

const KEY = "gamesState";
const MAX_CUSTOM = 12;

/** الألعابُ المبنيّة: مفتاحُها في الرئيسيّة، وروابطُ صفحتها */
const GAMES = [
  { key: "draw", icon: "🎨", title: "ارسمها!", paths: ["/draw", "/rassm", "/index.html"] },
  { key: "bomb", icon: "💣", title: "القنبلة", paths: ["/bomb", "/qunbula", "/bomb.html"] },
  { key: "quiz", icon: "🏆", title: "قمّة الهرم", paths: ["/quiz2", "/apex", "/quiz", "/qimma", "/quiz2.html"] },
  { key: "salfa", icon: "🕵️", title: "برّا السالفة", paths: ["/barra", "/salfa", "/salfa.html"] },
  { key: "uno", icon: "🃏", title: "اونو", paths: ["/uno"] },
  { key: "baloot", icon: "♠️", title: "بالوت", paths: ["/baloot"] },
  { key: "ludo", icon: "🎲", title: "لودو", paths: ["/ludo"] },
  { key: "justone", icon: "🔤", title: "كلمة واحدة فقط", paths: ["/justone"] },
  { key: "decrypto", icon: "🔐", title: "فكّ الشفرة", paths: ["/decrypto"] },
  { key: "spicy", icon: "🌶️", title: "البسكويتة الحارّة", paths: ["/spicy"] },
  { key: "wave", icon: "📡", title: "التخاطر", paths: ["/wave"] },
  { key: "love", icon: "💌", title: "رسالة حب", paths: ["/love", "/risala"] }
];
const BY_KEY = Object.fromEntries(GAMES.map(g => [g.key, g]));
const PATH2KEY = {};
for (const g of GAMES) for (const p of g.paths) PATH2KEY[p] = g.key;
const STATUSES = ["open", "maint", "hidden"];

let state = { games: {}, custom: [] };

const clean = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

async function load(store) {
  try {
    const v = await store.getKV(KEY);
    if (v && typeof v === "object") state = { games: v.games || {}, custom: Array.isArray(v.custom) ? v.custom : [] };
  } catch (e) { /* المخزنُ غير متاح: الكلُّ مفتوح */ }
  return state;
}
const save = store => store.saveKV(KEY, state);

function statusOf(key) {
  const g = state.games[key];
  return g && STATUSES.includes(g.status) ? { status: g.status, msg: g.msg || "" } : { status: "open", msg: "" };
}

async function setStatus(store, key, status, msg) {
  if (!BY_KEY[key]) return { ok: false, error: "لعبةٌ غير معروفة" };
  if (!STATUSES.includes(status)) return { ok: false, error: "حالةٌ غير معروفة" };
  if (status === "open") delete state.games[key];
  else state.games[key] = { status, msg: clean(msg, 140), at: Date.now() };
  await save(store);
  return { ok: true, ...publicState() };
}

/** بطاقةٌ مضافة: رابطٌ داخليّ (/…) أو https://… — أو «قريبًا» بلا رابط */
async function addCard(store, d) {
  if (state.custom.length >= MAX_CUSTOM) return { ok: false, error: "١٢ بطاقةً على الأكثر" };
  const title = clean(d && d.title, 40);
  if (title.length < 2) return { ok: false, error: "اكتب عنوانًا" };
  const soon = !!(d && d.soon);
  let href = String(d && d.href || "").trim().slice(0, 300);
  if (!soon) {
    /* داخليٌّ يبدأ بشرطةٍ واحدة (لا «//» ولا «/\» فهما خارجيّان في المتصفّح) أو https */
    if (!/^\/(?![\/\\])[\w\-\/?=&.%#]*$/.test(href) && !/^https:\/\/[^\s<>"'\\]+$/.test(href)) return { ok: false, error: "الرابط: يبدأ بـ / أو https://" };
  } else href = "";
  const card = {
    id: Math.random().toString(36).slice(2, 9), title, soon, href,
    icon: clean(d && d.icon, 8) || "🎮", desc: clean(d && d.desc, 200)
  };
  state.custom.push(card);
  await save(store);
  return { ok: true, ...publicState() };
}
async function removeCard(store, id) {
  const n = state.custom.length;
  state.custom = state.custom.filter(c => c.id !== String(id));
  if (state.custom.length === n) return { ok: false, error: "بطاقةٌ غير موجودة" };
  await save(store);
  return { ok: true, ...publicState() };
}

function publicState() {
  const games = {};
  for (const g of GAMES) { const s = statusOf(g.key); if (s.status !== "open") games[g.key] = s; }
  return { games, custom: state.custom.map(c => ({ ...c })) };
}
const registry = () => GAMES.map(g => ({ key: g.key, icon: g.icon, title: g.title, path: g.paths[0], ...statusOf(g.key) }));

/** مفتاحُ اللعبة لصفحةٍ مطلوبة (الصفحةُ نفسُها لا ملفّاتُها: /ludo و/ludo/ و/ludo/index.html،
 *  والملفُّ المباشر للألعاب القديمة: /bomb.html و/salfa.html …) */
function keyOfPath(p) {
  const seg = "/" + (String(p || "").split("/")[1] || "");
  const key = PATH2KEY[seg];
  if (!key) return null;
  return (p === seg || p === seg + "/" || p === seg + "/index.html") ? key : null;
}

function maintPage(key, s) {
  const g = BY_KEY[key];
  const hidden = s.status === "hidden";
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.title)} — ${hidden ? "غير متاحة" : "صيانة"}</title><style>
*{box-sizing:border-box;margin:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
font-family:"Segoe UI",Tahoma,system-ui,sans-serif;background:linear-gradient(165deg,#FFF8EE,#FFE9D6);color:#4A2E2B}
.box{background:#fff;border:5px solid #fff;border-radius:28px;box-shadow:0 0 0 2px #EBD4BE,0 14px 34px rgba(150,100,60,.2);
padding:26px 22px;max-width:420px;width:100%;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center}
.ic{font-size:64px;line-height:1}h1{font-size:23px;font-weight:900}p{font-size:15px;line-height:1.8;color:#7D6252;font-weight:700}
a{display:inline-block;margin-top:6px;padding:11px 24px;border-radius:999px;background:linear-gradient(180deg,#FFD9A8,#FFB86B);
color:#5A3408;font-weight:900;text-decoration:none;border:3px solid #fff;box-shadow:0 4px 0 #D99A4E}
</style></head><body><div class="box"><div class="ic">${hidden ? "🙈" : "🛠️"}</div>
<h1>${esc(g.icon)} ${esc(g.title)} ${hidden ? "غيرُ متاحةٍ حاليًّا" : "تحت الصيانة"}</h1>
<p>${s.msg ? esc(s.msg) : hidden ? "هذه اللعبةُ غيرُ متاحةٍ الآن." : "نجهّز لكم شيئًا أحسن — ترجع قريبًا إن شاء الله 🤍"}</p>
<a href="/">← الرجوع لاختيار الألعاب</a></div></body></html>`;
}

/** بوّابةُ الصفحات: لعبةٌ في صيانةٍ أو مخفيّة لا تُفتح صفحتُها — إلا للأدمن */
function gate(deps) {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const key = keyOfPath(req.path);
    if (!key) return next();
    const s = statusOf(key);
    if (s.status === "open") return next();
    try {
      const u = deps.currentUser ? await deps.currentUser(req) : null;
      if (u && deps.isAdmin && deps.isAdmin(u)) return next();
    } catch (e) { /* ليس أدمنًا */ }
    res.status(503).set("Cache-Control", "no-store").type("html").send(maintPage(key, s));
  };
}

module.exports = { load, statusOf, setStatus, addCard, removeCard, publicState, registry, keyOfPath, gate, maintPage, GAMES, STATUSES, KEY };
