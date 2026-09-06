/* 🛍️ كتالوج بالوت — الساحات وظهور البطاقات.
 *
 * كلُّ ثيمٍ هنا **مرسومٌ لا مصوَّر**: تدرّجاتٌ ونقوشُ CSS ومعاينةٌ بصيغة
 * SVG داخل العنوان نفسه. ولماذا؟ لأنّ خمسة ثيماتٍ في صورتين لكلٍّ تعني
 * عشرة ملفّاتٍ تُحمَّل على شبكةِ جوّالٍ بطيئة قبل أن تبدأ اللعبة، ولأنّ
 * المرسوم يتكيّف مع أيّ مقاسٍ ودقّةِ شاشةٍ بلا تشوّش.
 *
 * وهذا الملفّ **مصدرٌ واحد**: يقرأه المتصفّح ليرسم، ويقرأه الخادم ليبذر
 * المتجر. فلو غيّرتَ سعرًا هنا تغيّر في المكانين بلا تكرار.
 *
 * الصيغة: [مفتاح، اسم، وصف، سعر]
 */

/* ── الساحات ──
   `felt` ألوانُ الجوخ (من الحافّة إلى المركز)، و`ink` لونُ النصّ الغالب،
   و`accent` لونُ اللمسات. */
const BOARD_THEME = {
  classic: { felt: ["#9adcbe", "#57b391", "#3d9276"], accent: "#ffcf5c", dots: "#ffffff" },
  hilal:   { felt: ["#2f7bd6", "#1b56a8", "#123e7e"], accent: "#f2c94c", dots: "#ffffff" },
  night:   { felt: ["#3b4a63", "#232f45", "#151d2c"], accent: "#7cc6ff", dots: "#9fb6d6" },
  sand:    { felt: ["#e8cfa0", "#cfa96d", "#a97f48"], accent: "#6b4b23", dots: "#fff4dd" },
  royal:   { felt: ["#a98bd6", "#7a55b8", "#553a86"], accent: "#ffd88a", dots: "#f0e4ff" }
};

const BOARDS = [
  ["classic", "الجوخ الأخضر", "الطاولة الكلاسيكيّة", 0],
  ["hilal",   "الأزرق الملكيّ", "أزرقُ وأبيضُ ولمسةٌ ذهبيّة", 900],
  ["night",   "ليلٌ هادئ", "أزرقٌ داكنٌ يريح العين", 700],
  ["sand",    "رمالُ الجزيرة", "دفءُ الصحراء", 700],
  ["royal",   "بنفسجيٌّ فاخر", "للمزاج العالي", 1200]
];

/* ── ظهور البطاقات ──
   `bg` تدرّجُ الظهر، و`pat` لونُ النقش، و`ring` لونُ الحافّة الداخليّة،
   و`glyph` رمزٌ صغيرٌ في الوسط (فارغٌ = نقشٌ فقط). */
const BACK_THEME = {
  classic: { bg: ["#ffb7cd", "#b79bea"], pat: "rgba(255,255,255,.85)", ring: "#ffffff", glyph: "" },
  hilal:   { bg: ["#1b56a8", "#2f7bd6"], pat: "rgba(255,255,255,.9)",  ring: "#ffffff", glyph: "★" },
  carbon:  { bg: ["#2b2f36", "#454b56"], pat: "rgba(255,255,255,.5)",  ring: "#8f98a6", glyph: "" },
  gold:    { bg: ["#c8992f", "#f0d27a"], pat: "rgba(255,255,255,.9)",  ring: "#fff4d0", glyph: "◆" },
  palm:    { bg: ["#1f7a5a", "#49b98c"], pat: "rgba(255,255,255,.85)", ring: "#d9fff0", glyph: "🌴" }
};

const BACKS = [
  ["classic", "الوردي الكلاسيكيّ", "ظهرُ البداية", 0],
  ["hilal",   "الأزرق الملكيّ", "نجمةٌ ذهبيّةٌ على أزرق", 900],
  ["carbon",  "كربون", "رماديٌّ أنيقٌ بلا ضجيج", 600],
  ["gold",    "ذهبيّ", "لمن يحبّ اللمعة", 1200],
  ["palm",    "نخيل", "أخضرُ الواحة", 600]
];

/* ── صورٌ من لوحة الإدارة ──
   المظهرُ قد يكون **صورةً** رفعها صاحبُ الموقع بدل الرسم. نحفظ عناوينها هنا،
   ويسبق العنوانُ الرسمَ حيثما وُجد — والرسمُ يبقى احتياطًا لو تعذّرت الصورة. */
const IMG = { boards: {}, backs: {} };

/* ── المعاينات: SVG داخل عنوانٍ، بلا أيّ ملفّ يُحمَّل ── */
const svg = s => "data:image/svg+xml;utf8," + encodeURIComponent(s);

function boardPreview(key) {
  if (IMG.boards[key]) return IMG.boards[key];
  const t = BOARD_THEME[key] || BOARD_THEME.classic;
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150">` +
    `<defs><radialGradient id="g" cx="50%" cy="42%" r="75%">` +
    `<stop offset="0" stop-color="${t.felt[0]}"/><stop offset="55%" stop-color="${t.felt[1]}"/>` +
    `<stop offset="1" stop-color="${t.felt[2]}"/></radialGradient>` +
    `<pattern id="d" width="16" height="16" patternUnits="userSpaceOnUse">` +
    `<circle cx="2" cy="2" r="1.4" fill="${t.dots}" opacity=".16"/></pattern></defs>` +
    `<rect width="240" height="150" rx="14" fill="url(#g)"/>` +
    `<rect width="240" height="150" rx="14" fill="url(#d)"/>` +
    `<ellipse cx="120" cy="75" rx="78" ry="46" fill="none" stroke="${t.accent}" stroke-width="3" opacity=".55"/>` +
    `<ellipse cx="120" cy="75" rx="60" ry="34" fill="#fff" opacity=".07"/></svg>`);
}

function backPreview(key) {
  if (IMG.backs[key]) return IMG.backs[key];
  const t = BACK_THEME[key] || BACK_THEME.classic;
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="170" viewBox="0 0 120 170">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient>` +
    `<pattern id="p" width="17" height="17" patternUnits="userSpaceOnUse">` +
    `<circle cx="3" cy="3" r="2.4" fill="${t.pat}"/></pattern></defs>` +
    `<rect width="120" height="170" rx="12" fill="#fff"/>` +
    `<rect x="5" y="5" width="110" height="160" rx="9" fill="url(#b)"/>` +
    `<rect x="11" y="11" width="98" height="148" rx="7" fill="url(#p)" opacity=".55"/>` +
    `<rect x="11" y="11" width="98" height="148" rx="7" fill="none" stroke="${t.ring}" stroke-width="3" opacity=".8"/>` +
    (t.glyph ? `<text x="60" y="95" font-size="34" text-anchor="middle" fill="${t.ring}">${t.glyph}</text>` : "") +
    `</svg>`);
}

/**
 * يدمج ما ردّه `/api/baloot/skins` فوق الكتالوج المضمَّن.
 * المصفوفات تُعدَّل في مكانها لأنّ الصفحة تحمل مرجعًا إليها أصلًا.
 */
function applyOverrides(d) {
  if (!d) return;
  const put = (arr, theme, imgs, list) => {
    if (!Array.isArray(list) || !list.length) return;
    arr.length = 0;
    list.forEach(s => {
      if (!s || !s.key) return;
      arr.push([s.key, s.name || s.key, s.descr || "", Number(s.price) || 0]);
      if (s.theme) theme[s.key] = s.theme;
      if (s.img) imgs[s.key] = s.img; else delete imgs[s.key];
    });
  };
  put(BOARDS, BOARD_THEME, IMG.boards, d.boards);
  put(BACKS, BACK_THEME, IMG.backs, d.backs);
}

/* ── ما تحتاجه الصفحة لترسم الثيم المُجهَّز ── */
function boardCss(key) {
  if (IMG.boards[key]) return `url("${IMG.boards[key]}") center/cover no-repeat`;
  const t = BOARD_THEME[key] || BOARD_THEME.classic;
  return `radial-gradient(ellipse at 50% 42%, ${t.felt[0]}, ${t.felt[1]} 55%, ${t.felt[2]})`;
}
function backCss(key) {
  if (IMG.backs[key])
    return { img: true, outer: `url("${IMG.backs[key]}") center/cover no-repeat`,
             inner: "", ring: "rgba(255,255,255,.55)", glyph: "" };
  const t = BACK_THEME[key] || BACK_THEME.classic;
  return {
    img: false,
    outer: `linear-gradient(140deg, ${t.bg[0]}, ${t.bg[1]})`,
    inner: `radial-gradient(circle, ${t.pat} 2.6px, transparent 3px) 0 0/17px 17px, ` +
           `linear-gradient(140deg, ${t.bg[1]}, ${t.bg[0]})`,
    ring: t.ring, glyph: t.glyph || ""
  };
}

const API = { BOARDS, BACKS, BOARD_THEME, BACK_THEME, IMG,
              boardPreview, backPreview, boardCss, backCss, applyOverrides };

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.BCAT = API;
