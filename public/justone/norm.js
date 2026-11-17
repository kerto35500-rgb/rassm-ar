/* 🔤 «كلمة واحدة فقط» — خوارزمية التطابق العربيّة.
 *
 * قلبُ اللعبة: تلميحان متطابقان يُحذفان معًا، وتلميحٌ هو الكلمةُ نفسها أو
 * جزءٌ منها يُحذف. والتطابقُ يُقرَّر بعد «تطبيع» النصّ، كي لا ينجو أحدٌ
 * بهمزةٍ أو تاءٍ أو «ال» أو حرفٍ ممطوط — ولا يُظلَم أحدٌ بخطأٍ إملائيٍّ صغير.
 *
 * ملفٌّ واحدٌ يقرؤه الخادم (الحكمُ الفعليّ) والمتصفّح (تنبيهُ صاحب التلميح
 * قبل أن يرسل: «تلميحك سيُحذف — فيه الكلمة نفسها»).
 *
 * ما لا تعرفه الآلة — الترجمة (قطة ↔ cat)، والمفرد والجمع المكسَّر
 * (كتاب ↔ كتب)، وكلمات العائلة الواحدة (بحر ↔ بحّار) — يُحسَم بتصويت
 * مقدّمي التلميحات بعد الحذف الآليّ، كما في Board Game Arena.
 */
(function (root) {
  "use strict";

  /* التشكيل (الحركات والتنوين والشدّة والسكون) وعلامات القرآن الصغيرة */
  const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
  const TATWEEL = /ـ/g;
  /* توحيد الحروف: الهمزاتُ على الألف ⇒ ا، والهمزةُ على الواو والياء ⇒ ء
     (فتتّحد «مسئول» و«مسؤول» — لو صارت تلك ي وهذه و لافترقتا)، والتاءُ
     المربوطة ⇒ ه، والألفُ المقصورة ⇒ ي، وأشكالٌ فارسيّةٌ شائعة */
  const LETTERS = [
    [/[أإآٱ]/g, "ا"], [/[ؤئ]/g, "ء"], [/ة/g, "ه"], [/ى/g, "ي"],
    [/ک/g, "ك"], [/[یې]/g, "ي"], [/ۀ/g, "ه"], [/گ/g, "ك"]
  ];
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

  /** التطبيع: النصُّ كما تُقارَن به الكلماتُ لا كما يُعرَض. */
  function norm(raw) {
    let s = String(raw == null ? "" : raw);
    try { s = s.normalize("NFKC"); } catch (e) { /* متصفّحٌ قديم */ }
    s = s.toLowerCase().replace(TASHKEEL, "").replace(TATWEEL, "");
    for (const [re, to] of LETTERS) s = s.replace(re, to);
    s = s.replace(/[٠-٩۰-۹]/g, d => {
      const i = AR_DIGITS.indexOf(d);
      return String(i >= 0 ? i : FA_DIGITS.indexOf(d));
    });
    /* كلُّ ما ليس حرفًا أو رقمًا يسقط: الفواصل والنقاط والمسافات والرموز */
    s = s.replace(/[^\p{L}\p{N}]+/gu, "");
    /* «ال» التعريف: «التفاحة» = «تفاحة». تُنزَع قبل ضغط المكرّر — وإلا صار
       «اللبن» «البن» ثمّ «بن» — وبشرط أن يبقى بعدها حرفان على الأقلّ
       («الم» تبقى كما هي) */
    if (s.length >= 4 && s.startsWith("ال")) s = s.slice(2);
    /* الحرفُ الممطوط يُضغط: «قطططه» = «قطه» — فلا ينجو أحدٌ من الحذف بمدّ حرف.
       الحروفُ وحدها: «100» ليست «10» */
    s = s.replace(/(\p{L})\1+/gu, "$1");
    return s;
  }

  /** جذعٌ خفيف: تُنزَع لواحقُ الجمع السالم والتأنيث، فـ«سيارة» و«سيارات»
      جذعهما «سيار». لا يعرف الجموعَ المكسَّرة — تلك للتصويت. ولا تُنزَع ياءُ
      النسبة: لو نُزعت صار «ساعي» (موزّع البريد) و«ساعة» كلمةً واحدة. */
  function stem(n) {
    let s = n;
    /* ولا «ان»: لو نُزعت صار «قرصان» «قرصًا» */
    for (const suf of ["ات", "ون", "ين", "ه"]) {
      if (s.length - suf.length >= 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
    }
    return s;
  }

  /* لواحقُ تجعل الكلمةَ الأطول «من عائلة» الأقصر: نسبةٌ وتأنيثٌ وجمعٌ سالم */
  const FAMILY_SUFFIXES = new Set(["ي", "يه", "ه", "ات", "يات", "ون", "يون", "ين", "يين", "اوي", "اويه"]);
  /** الأطولُ هو الأقصرُ مع لاحقةٍ من العائلة («قمري» = «قمر» + ي)، أو يشتركان
      في بدايةٍ من خمسة أحرفٍ فأكثر («برتقالي»/«برتقالة»).
      وليس مجرّدُ احتواء الحروف: العربيّةُ تتداخل فيها الكلماتُ صدفة — «فيلم»
      تبدأ بـ«فيل»، و«مطرقة» بـ«مطر»، و«كاميرا» فيها «امير» — وحذفُها ظلم. */
  function family(x, y) {
    const [a, b] = x.length <= y.length ? [x, y] : [y, x];
    if (a.length < 3 || !b.startsWith(a)) return false;
    return FAMILY_SUFFIXES.has(b.slice(a.length)) || a.length >= 5;
  }

  /** أكثرُ من كلمة: مسافةٌ أو شَرطةٌ بين حرفين («كرة قدم»، «آيس-كريم») */
  const isMulti = raw => /[^\s\-_ـ][\s\-_]+[^\s\-_]/u.test(String(raw || "").trim());

  /** التلميحُ هو الكلمةُ نفسها، أو مفردُها/جمعُها السالم، أو من عائلتها
      بلاحقة («تفاح» ⊂ «تفاحة»، «شمسية» ⊃ «شمس»، «قمري» ⊃ «قمر»): يُحذف. */
  function related(clue, target) {
    const c = norm(clue), t = norm(target);
    if (!c || !t) return false;
    if (c === t) return true;
    const sc = stem(c), st = stem(t);
    if (Math.min(sc.length, st.length) >= 3 && sc === st) return true;
    return family(c, t);
  }

  /** تلميحان «يُشبهان» بعضهما (مفردٌ وجمع، أو من عائلةٍ واحدة): لا يُحذفان
      آليًّا — القاعدةُ تحذف المتطابقَ ١٠٠٪ — بل يُنبَّه إليهما المصوّتون. */
  function similar(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y || x === y) return false;
    const sx = stem(x), sy = stem(y);
    if (Math.min(sx.length, sy.length) >= 3 && sx === sy) return true;
    return family(x, y);
  }

  /** مسافةُ التحرير (ليفنشتاين) — للخطأ الإملائيّ الصغير في التخمين */
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  /** هل أصاب المخمّن؟ الكلمةُ نفسها بعد التطبيع، أو مفردُها/جمعُها السالم،
      أو خطأٌ بحرفٍ واحدٍ في كلمةٍ من خمسة أحرفٍ فأكثر. */
  function guessOK(guess, target) {
    const g = norm(guess), t = norm(target);
    if (!g || !t) return false;
    if (g === t) return true;
    const sg = stem(g), st = stem(t);
    if (Math.min(sg.length, st.length) >= 3 && sg === st) return true;
    return t.length >= 5 && lev(g, t) <= 1;
  }

  const API = { norm, stem, isMulti, related, similar, lev, guessOK };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.JNORM = API;
})(typeof window !== "undefined" ? window : this);
