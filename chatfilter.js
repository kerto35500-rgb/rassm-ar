// 🧹 تنقية نصّ الدردشة.
//
// المرشِّح لا يمنع السبّ — من أراد أن يسبّ سبّ بحروفٍ متباعدةٍ أو بلهجةٍ
// لا نعرفها. غايتُه أن يرفع كلفةَ الإساءة العابرة، وأن يقطع ما هو أخطر من
// السبّ: الروابط، والأرقام الطويلة، والنصّ المكرَّر الذي يُغرق الطاولة.
//
// وما يفلت منه يُبلَّغ عنه — فالبلاغ هو النظام الحقيقيّ، والمرشِّح مكنسة.
//
// التطبيع مقصود: من كتب «س ب ب» أو «سـبـب» أو «سبببب» يُقرأ واحدًا. ومن
// كتب بالإنجليزيّة المموّهة (leet) يُقرأ كذلك.

"use strict";

const MAX_LEN = 160;

/* حروفٌ عربيّةٌ تُكتَب بأشكالٍ مختلفةٍ لمعنًى واحد */
const NORM = [
  [/[ً-ْـ]/g, ""],          /* تشكيلٌ وتطويل */
  [/[أإآٱ]/g, "ا"], [/ى/g, "ي"], [/ة/g, "ه"], [/ؤ/g, "و"], [/ئ/g, "ي"],
  [/[0O]/g, "o"], [/[1lI|]/g, "i"], [/3/g, "a"], [/4/g, "a"],
  [/5/g, "kh"], [/7/g, "h"], [/8/g, "gh"], [/9/g, "s"]
];

/* قائمةٌ قصيرةٌ عمدًا: الطويلةُ تُسقِط كلامًا بريئًا («حمار» في مَثَل، و«كلب»
   في وصف حيوان). ما نمنعه هنا صريحٌ لا يحتمل وجهًا آخر في طاولة ورق. */
const BAD = [
  "كس", "طيز", "زب", "نيك", "شرموط", "قحب", "عاهر", "منيوك", "خول",
  "لعن", "يلعن", "حقير", "وسخ", "زفت", "خرا", "تفو",
  "fuck", "shit", "bitch", "asshole", "cunt", "dick", "whore"
];
/* الكلمةُ القصيرة تُطابَق كلمةً كاملةً لا جزءًا: «كس» في «كسر» بريئة،
   و«لعن» في «الملعون» ليست سبًّا مباشرًا. أمّا الطويلة فجزءٌ يكفي —
   «شرموط» في «شرموطة» هي هي. */
const SHORT = 4;

const URLISH = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|me|ly|co|ru|xyz|link|shop|store|app)\b)/i;
/* رقمٌ طويلٌ يعني جوّالًا أو حسابًا — والطاولة ليست سوق إعلانات */
const LONGNUM = /[0-9٠-٩]{7,}/;
const MENTION = /(واتس|whats|تلق?رام|telegram|سناب|snap|انستا|instagram|تويتر|twitter|ايميل|@[a-z0-9_]{3,})/i;

function normalize(s) {
  let t = String(s || "").toLowerCase();
  for (const [re, to] of NORM) t = t.replace(re, to);
  t = t.replace(/[^\p{L}\p{N}]+/gu, "");        /* كلُّ فاصلٍ يسقط */
  /* التكرار يُقلَّص إلى حرفٍ واحد لا اثنين: «شرمووووط» يجب أن تصير «شرموط»
     بعينها، وإلا نجا كلُّ من مطّ حرفًا. والقائمة تمرّ بالتطبيع نفسه فيبقى
     الطرفان على قياسٍ واحد. */
  t = t.replace(/(.)\1+/gu, "$1");
  return t;
}
/* تُطبَّع القائمةُ مرّةً عند التحميل لا مع كلّ رسالة */
const BAD_LONG = BAD.filter(w => w.length >= SHORT).map(normalize).filter(Boolean);
const BAD_SHORT = BAD.filter(w => w.length < SHORT).map(normalize).filter(Boolean);

/**
 * يفحص رسالةً ويُرجع { ok, text, why }.
 * `text` هو المسموح إرساله (مقصوصًا ومُنظَّفًا من الفراغ الزائد).
 */
function check(raw) {
  let text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, why: "رسالةٌ فارغة" };
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

  if (URLISH.test(text)) return { ok: false, why: "الروابط ممنوعة في الطاولة" };
  if (LONGNUM.test(text)) return { ok: false, why: "لا تكتب أرقامًا طويلة هنا" };
  if (MENTION.test(text)) return { ok: false, why: "تبادُل الحسابات ممنوع في الطاولة" };

  const n = normalize(text);
  for (const w of BAD_LONG) if (n.includes(w)) return { ok: false, why: "فيها لفظٌ غير لائق" };
  /* القصيرةُ تُطابَق كلمةً كاملة — وأيضًا على النصّ كلِّه بلا فواصل، كي لا
     ينجو من فرّق حروفَها: «ك س» كلمتان، ومجموعُهما واحدة. */
  const words = text.split(/\s+/).map(normalize).filter(Boolean);
  for (const w of BAD_SHORT) {
    if (words.includes(w)) return { ok: false, why: "فيها لفظٌ غير لائق" };
    if (words.length > 1 && words.every(x => x.length === 1) && n.includes(w))
      return { ok: false, why: "فيها لفظٌ غير لائق" };
  }
  /* حروفٌ متكرّرةٌ تملأ السطر، أو صراخٌ كلُّه علامات */
  if (/(.)\1{6,}/u.test(text)) return { ok: false, why: "لا تُكرّر الحروف" };
  if (text.length > 12 && !/[\p{L}\p{N}]/u.test(text)) return { ok: false, why: "رسالةٌ بلا معنى" };

  return { ok: true, text };
}

module.exports = { check, normalize, MAX_LEN, BAD };
