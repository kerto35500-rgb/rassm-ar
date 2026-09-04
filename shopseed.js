// 🛍️ بذر المتجر — تحويل أصول الألعاب إلى عناصر قابلة للشراء.
//
// المصدر واحد: `public/uno/catalog.js` نفسه الذي تقرأه اللعبة. فلو غيّرتَ
// سعرًا هناك تغيّر هنا عند الإقلاع التالي، ولا يفترق معروضُ المتجر عمّا
// تعرضه اللعبة. والبذر يُحدِّث الأسماء والأسعار ولا يمسّ ما أخفته الإدارة.
//
// المعرّف نصٌّ مقروء: `uno:cards:gold` — يظهر كما هو في دفتر الحركات،
// فسطرٌ مكتوبٌ فيه «شراء:uno:frames:Wizard» يُفهَم بلا استعلام.

const path = require("path");

/* رتبةُ الندرة من السعر: للعرض والترتيب فقط، لا أثر لها في المنطق */
function rarityOf(price) {
  if (price <= 0) return "free";
  if (price < 800) return "common";
  if (price < 1600) return "rare";
  if (price < 2200) return "epic";
  return "legend";
}

const UNO_KINDS = [
  { kind: "boards",  list: "BOARDS",  label: "الطاولات", preview: k => `/uno/thumbs/boards/${k}.webp` },
  { kind: "cards",   list: "CARDSETS", label: "أطقم الكروت", preview: k => `/uno/thumbs/cards/${k}.webp` },
  { kind: "avatars", list: "AVATARS", label: "الصور الشخصية", preview: k => `/uno/avatars/${k}.webp` },
  { kind: "frames",  list: "FRAMES",  label: "الإطارات", preview: k => `/uno/frames/${k}.webp` }
];

/** يبني صفوف عناصر «وحدة» من كتالوج اللعبة. */
function unoItems() {
  let cat;
  try { cat = require(path.join(__dirname, "public", "uno", "catalog.js")); }
  catch (e) { console.error("🛍️  تعذّرت قراءة كتالوج وحدة:", e.message); return []; }

  const rows = [];
  for (const g of UNO_KINDS) {
    (cat[g.list] || []).forEach((it, i) => {
      const [key, name, descr, price] = it;
      rows.push({
        id: `uno:${g.kind}:${key}`, game: "uno", kind: g.kind, key,
        name: String(name || key), descr: descr || null,
        currency: "gold", price: Number(price) || 0,
        rarity: rarityOf(Number(price) || 0),
        preview: g.preview(key), sort: i
      });
    });
  }
  return rows;
}

/** كل ما يُعرَض في المتجر اليوم. الهرم مجّانيّ حاليًّا فلا عناصر له بعد. */
function allItems() { return [...unoItems()]; }

/** تسميات الأقسام للواجهة — عربيّةٌ في مكانٍ واحد. */
const SECTIONS = {
  uno: {
    name: "اونو", icon: "🃏", href: "/uno/",
    kinds: { boards: "الطاولات", cards: "أطقم الكروت", avatars: "الصور الشخصية", frames: "الإطارات" }
  }
};

/** يُنفَّذ عند الإقلاع: يزرع أو يُحدِّث الكتالوج، ويصمت إن لم يتغيّر شيء. */
async function seedShop(store, log = console.log) {
  const rows = allItems();
  if (!rows.length) return 0;
  try {
    await store.upsertItems(rows);
    const free = rows.filter(r => r.price === 0).length;
    log(`🛍️  المتجر: ${rows.length} عنصرًا (${free} مجّانيّ)`);
    return rows.length;
  } catch (e) {
    /* المتجر ليس شرطًا للّعب: نُبلّغ ونُكمل */
    console.error("🛍️  تعذّر بذر المتجر:", e.message);
    return 0;
  }
}

module.exports = { seedShop, allItems, unoItems, SECTIONS, rarityOf, UNO_KINDS };
