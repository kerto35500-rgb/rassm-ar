// 🎨 مظاهر بالوت — الساحات وظهور البطاقات، قابلةً للتعديل من لوحة الإدارة.
//
// الأصلُ في `public/baloot/catalog.js`: خمسُ ساحاتٍ وخمسةُ ظهورٍ **مرسومةٍ**
// بالـCSS بلا ملفّات. وهذا الملفّ يضع فوقها طبقةَ تجاوز: الإدارة تُغيّر اسمًا
// أو سعرًا، أو ترفع **صورةً** تحلّ محلّ الرسم، أو تُضيف مظهرًا جديدًا كلّه صورة.
//
// ولماذا طبقةٌ لا تعديلٌ في الملفّ؟ لأنّ الملفّ يُنشَر مع الكود، فتعديلُه من
// اللوحة يضيع مع أوّل نشر. أمّا التجاوزُ فيعيش في المخزن (الإعدادات + blobs)
// ويبقى بعد كلّ نشر — والبذرُ عند الإقلاع يُعيد تطبيقه كما يفعل مع الأسعار.
//
// الصور تُحفَظ في مخزن الـblobs بمفتاح `bskin:<kind>:<key>` وتُقدَّم من
// `/api/baloot/skin/<kind>/<key>` — لا مجلّدَ على القرص، فقرصُ Render مؤقّت.

const path = require("path");
const CAT = require(path.join(__dirname, "public", "baloot", "catalog.js"));

const SCOPE = "bskin";                       /* نطاقُ الإعدادات */
const KINDS = { boards: "BOARDS", backs: "BACKS" };
const KIND_AR = { boards: "الساحات", backs: "ظهور البطاقات" };

/* مقاسُ الصورة المطلوبة لكلّ نوع — يُعرَض في اللوحة ويُستعمل في القوالب.
   الساحةُ خلفيّةُ المسرح كلِّه (١٦٠٠×٩٠٠ في إحداثيّات اللعبة)، والظهرُ
   بنسبة الورقة نفسها (١٢٦×١٩٥) مضاعفةً مرّتين لدقّة الشاشات العالية. */
const SIZE = {
  boards: { w: 1600, h: 900, note: "خلفيّةُ الطاولة كاملةً — نسبة ١٦:٩" },
  backs:  { w: 252,  h: 390, note: "ظهرُ الورقة — نسبة ١٢٦:١٩٥ (ضعفُ مقاس اللعبة)" }
};

const MAX_IMG = 1.5 * 1024 * 1024;           /* ١٫٥ ميغا: أكبرُ من هذا يُبطئ الفتح */
const OK_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const okKey = k => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(String(k || ""));
const okKind = k => k === "boards" || k === "backs";

const blobKey = (kind, key) => "bskin:" + kind + ":" + key;
const itemId  = (kind, key) => "baloot:" + kind + ":" + key;
const imgUrl  = (kind, key, v) => "/api/baloot/skin/" + kind + "/" + key + (v ? "?v=" + v : "");

/* الثيمُ المرسوم الأصليّ — يُستعمل حين لا صورة. */
const baseTheme = (kind, key) =>
  (kind === "boards" ? CAT.BOARD_THEME[key] : CAT.BACK_THEME[key]) ||
  (kind === "boards" ? CAT.BOARD_THEME.classic : CAT.BACK_THEME.classic);

const basePreview = (kind, key) =>
  kind === "boards" ? CAT.boardPreview(key) : CAT.backPreview(key);

/**
 * يقرأ التجاوزات ويدمجها مع الكتالوج المضمّن.
 * يرجع { boards:[…], backs:[…] } وكلُّ عنصرٍ فيه ما يكفي للعرض والبيع والرسم.
 */
async function listAll(store) {
  let over = {};
  try { over = (await store.getSettings(SCOPE)) || {}; } catch (e) {}

  const out = { boards: [], backs: [] };
  for (const kind of ["boards", "backs"]) {
    const seen = new Set();

    /* ① المضمَّنُ في الملفّ، معدَّلًا بما تجاوزته الإدارة */
    (CAT[KINDS[kind]] || []).forEach(([key, name, descr, price], i) => {
      seen.add(key);
      out[kind].push(merge(kind, key, { name, descr, price, sort: i, builtin: true },
                           over[kind + ":" + key]));
    });

    /* ② ما أضافته الإدارة ولا وجود له في الملفّ */
    Object.keys(over).forEach(k => {
      if (k.indexOf(kind + ":") !== 0) return;
      const key = k.slice(kind.length + 1);
      if (seen.has(key)) return;
      const o = over[k] || {};
      out[kind].push(merge(kind, key,
        { name: o.name || key, descr: o.descr || "", price: 0, sort: 100 + (o.sort || 0), builtin: false }, o));
    });

    out[kind].sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.price - b.price);
  }
  return out;
}

function merge(kind, key, base, o) {
  o = o || {};
  const img = o.img ? imgUrl(kind, key, o.imgAt) : null;
  return {
    kind, key,
    id: itemId(kind, key),
    name: o.name != null ? String(o.name) : base.name,
    descr: o.descr != null ? String(o.descr) : (base.descr || ""),
    price: o.price != null ? Number(o.price) : Number(base.price || 0),
    active: o.active === false ? false : true,
    builtin: !!base.builtin,
    sort: o.sort != null ? Number(o.sort) : base.sort,
    img,                                   /* عنوانُ الصورة أو null */
    theme: baseTheme(kind, key),           /* الرسمُ الاحتياطيُّ دائمًا موجود */
    preview: img || basePreview(kind, key)
  };
}

/** صفوفُ المتجر من المظاهر المدموجة — يستعملها البذرُ عند الإقلاع. */
async function shopRows(store) {
  const all = await listAll(store);
  const rows = [];
  for (const kind of ["boards", "backs"]) {
    all[kind].forEach(s => rows.push({
      id: s.id, game: "baloot", kind, key: s.key,
      name: s.name, descr: s.descr || null,
      currency: "gold", price: s.price,
      rarity: s.price <= 0 ? "free" : s.price < 800 ? "common"
            : s.price < 1600 ? "rare" : s.price < 2200 ? "epic" : "legend",
      preview: s.preview, sort: s.sort || 0
    }));
  }
  return rows;
}

/** يكتب تجاوزًا واحدًا (دمجٌ لا استبدال: ما لم يُرسَل يبقى). */
async function patch(store, kind, key, fields, by) {
  if (!okKind(kind)) throw new Error("نوعٌ غير معروف");
  if (!okKey(key)) throw new Error("المفتاح حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ و - _ فقط");
  const over = (await store.getSettings(SCOPE)) || {};
  const cur = over[kind + ":" + key] || {};
  const next = { ...cur };
  if (fields.name !== undefined)   next.name = String(fields.name).slice(0, 40);
  if (fields.descr !== undefined)  next.descr = String(fields.descr).slice(0, 80);
  if (fields.price !== undefined)  next.price = Math.max(0, Math.min(1000000, Math.round(Number(fields.price) || 0)));
  if (fields.active !== undefined) next.active = !!fields.active;
  if (fields.sort !== undefined)   next.sort = Math.round(Number(fields.sort) || 0);
  if (fields.img !== undefined)    { next.img = fields.img ? String(fields.img) : null; next.imgAt = Date.now(); }
  await store.setSetting(SCOPE, kind + ":" + key, next, by || "admin");
  return next;
}

/** يرفع صورةً ويربطها بالمظهر، ويُحدّث معاينةَ عنصر المتجر. */
async function putImage(store, kind, key, mime, buf, by) {
  if (!okKind(kind)) throw new Error("نوعٌ غير معروف");
  if (!okKey(key)) throw new Error("مفتاحٌ غير صالح");
  if (!OK_MIME.includes(mime)) throw new Error("الصيغ المقبولة: PNG أو JPG أو WEBP أو SVG");
  if (!buf || !buf.length) throw new Error("ملفٌّ فارغ");
  if (buf.length > MAX_IMG) throw new Error("أقصى حجمٍ ١٫٥ ميغابايت");
  await store.putBlob(blobKey(kind, key), mime, buf);
  await patch(store, kind, key, { img: mime }, by);
  await syncItem(store, kind, key);
  return { ok: true, bytes: buf.length };
}

/** يحذف الصورة فيعود المظهرُ إلى رسمِه الأصليّ. */
async function delImage(store, kind, key, by) {
  await store.delBlobs([blobKey(kind, key)]).catch(() => {});
  await patch(store, kind, key, { img: null }, by);
  await syncItem(store, kind, key);
  return { ok: true };
}

/** يُزامن صفَّ المتجر مع المظهر بعد أيّ تعديل. */
async function syncItem(store, kind, key) {
  const all = await listAll(store);
  const s = (all[kind] || []).find(x => x.key === key);
  if (!s) return null;
  const rows = await shopRows(store);
  const row = rows.find(r => r.id === s.id);
  if (row) await store.upsertItems([row]);
  await store.setItemActive(s.id, s.active).catch(() => {});
  return s;
}

/** يُعيد تطبيق المظاهر بعد بذر الكتالوج — كما تفعل تجاوزاتُ الأسعار. */
async function applySkins(store, log = console.log) {
  try {
    const rows = await shopRows(store);
    if (!rows.length) return 0;
    await store.upsertItems(rows);
    const all = await listAll(store);
    let hidden = 0;
    for (const kind of ["boards", "backs"])
      for (const s of all[kind])
        if (!s.active) { await store.setItemActive(s.id, false).catch(() => {}); hidden++; }
    const imgs = rows.filter(r => r.preview && r.preview.indexOf("/api/") === 0).length;
    if (imgs || hidden) log(`🎨 مظاهر بالوت: ${imgs} بصورة، ${hidden} مخفيّ`);
    return rows.length;
  } catch (e) { console.error("baloot skins:", e.message); return 0; }
}

/** المساراتُ العامّة: قائمةُ المظاهر للّعبة، وتقديمُ الصور. */
function setupBalootSkins(app, deps) {
  const st = () => deps.store;

  /* اللعبةُ تنادي هذا عند الإقلاع فتعرف الأسماءَ والأسعارَ والصور — فلو
     أضافت الإدارةُ ساحةً ظهرت في المتجر بلا نشرِ كود. */
  app.get("/api/baloot/skins", async (req, res) => {
    try {
      const all = await listAll(st());
      const slim = k => all[k].filter(s => s.active).map(s => ({
        key: s.key, name: s.name, descr: s.descr, price: s.price,
        img: s.img, theme: s.theme
      }));
      res.set("Cache-Control", "no-cache");
      res.json({ ok: true, boards: slim("boards"), backs: slim("backs") });
    } catch (e) { res.json({ ok: false, boards: [], backs: [] }); }
  });

  app.get("/api/baloot/skin/:kind/:key", async (req, res) => {
    const { kind, key } = req.params;
    if (!okKind(kind) || !okKey(key)) return res.status(404).end();
    try {
      const b = await st().getBlob(blobKey(kind, key));
      if (!b || !b.data) return res.status(404).end();
      /* مفتاحُ النسخة في العنوان (‎?v=‎) يكسر الخبيئةَ عند التبديل، فنُطيلها */
      res.set("Content-Type", b.mime || "image/png");
      res.set("Cache-Control", "public, max-age=604800");
      res.send(b.data);
    } catch (e) { res.status(404).end(); }
  });

  console.log("🎨 مظاهر بالوت على /api/baloot/skins");
}

module.exports = {
  SCOPE, KIND_AR, SIZE, MAX_IMG, OK_MIME, okKey, okKind,
  listAll, shopRows, patch, putImage, delImage, syncItem, applySkins, setupBalootSkins
};
