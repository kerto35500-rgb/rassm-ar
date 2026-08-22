// قاموس عربي للعبة "القنبلة" — كلمات يومية شائعة + مقاطع منطقية
// المصدر الأساسي: ar-words.txt (كلمة<مسافة>طبقة) — 1 شائعة جداً، 2 شائعة، 3 موسّعة.
// احتياطياً: ar.dic (هَنسبِل) ثم القائمة المدمجة.
const fs = require("fs");
const path = require("path");

// الحروف الأبجدية العربية الـ 28 (بعد التوحيد)
const ALPHABET = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي".split("");
const LETTER_SET = new Set(ALPHABET);

// ====== توحيد الحروف ======
// يتجاهل التشكيل والتطويل، ويوحّد الهمزات والتاء المربوطة والألف المقصورة
function normalize(s) {
  return String(s == null ? "" : s)
    .replace(/[ً-ْٰـ]/g, "") // تشكيل + تطويل + ألف خنجرية
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ -> ا
    .replace(/ؤ/g, "و")                     // ؤ -> و
    .replace(/ئ/g, "ي")                     // ئ -> ي
    .replace(/ء/g, "")                      // ء تُحذف
    .replace(/ة/g, "ه")                     // ة -> ه
    .replace(/ى/g, "ي")                     // ى -> ي
    .replace(/ـ/g, "")
    .trim();
}

function isPureArabic(w) {
  if (!w) return false;
  for (const ch of w) if (!LETTER_SET.has(ch)) return false;
  return true;
}

// ====== حدود ======
const MIN_LEN = 2;   // أقصر كلمة مقبولة في القاموس
const MAX_LEN = 12;  // أطول كلمة (لتوفير الذاكرة)

// ====== القائمة المدمجة (احتياطية) ======
// كلمات عربية شائعة تكفي للعب فوراً قبل تركيب القاموس الضخم
const FALLBACK = `
كتاب كاتب مكتب مكتبة كتابة مكتوب كتب يكتب اكتب كتيب
قلم اقلام قرطاس ورق ورقة اوراق دفتر دفاتر ملف ملفات
مدرسة مدارس معلم معلمة تلميذ طالب طالبة دراسة دروس درس
جامعة كلية معهد فصل صف قاعة امتحان اختبار نجاح رسوب
بيت بيوت منزل منازل دار ديار سكن مسكن شقة غرفة غرف
باب ابواب نافذة نوافذ شباك جدار جدران سقف ارضية سلم
مطبخ حمام صالة مجلس مدخل ممر حديقة سطح قبو مخزن
كرسي كراسي طاولة مكتبه سرير خزانة رف مرآة ستارة سجادة
مصباح نور ضوء اضاءة شمعة فانوس كهرباء طاقة بطارية سلك
ماء مياه بحر بحار نهر انهار بحيرة محيط خليج شاطئ ساحل
موج امواج سفينة سفن قارب مركب زورق ميناء مرسى شراع
سماء سحاب غيوم مطر امطار ثلج برد رعد برق عاصفة
شمس قمر نجم نجوم كوكب فضاء مجرة فلك شروق غروب
ارض تراب طين رمل صخر حجر جبل جبال تل هضبة
وادي سهل صحراء واحة غابة شجر شجرة اشجار ورد زهرة
زهور نبات عشب حشيش زرع زراعة حصاد بذرة جذر ساق
ورقة ثمرة ثمار فاكهة تفاح موز عنب تين رمان
برتقال ليمون مانجو فراولة بطيخ شمام خوخ مشمش كرز
تمر بلح نخلة نخيل زيتون زيت عسل سكر ملح
خبز عيش رز ارز لحم دجاج سمك بيض حليب لبن
جبن زبدة قشطة شاي قهوة عصير ماء مشروب طعام
اكل غداء عشاء فطور وجبة مطعم مقهى طباخ طبخ
سكين ملعقة شوكة صحن طبق كوب فنجان قدر مقلاة
انسان بشر رجل رجال امرأة نساء ولد اولاد بنت بنات
طفل اطفال شاب شباب شيخ عجوز صغير كبير
اب ام والد والدة ابن ابنة اخ اخت جد جدة
عم عمة خال خالة ابن عم قريب اقارب عائلة اسرة
صديق اصدقاء صاحب رفيق زميل جار جيران ضيف
راس رؤوس وجه عين عيون انف اذن فم شفة
لسان سن اسنان خد جبين شعر رقبة كتف ذراع
يد يدين اصبع اصابع ظفر صدر بطن ظهر قدم
ساق ركبة كعب قلب رئة كبد معدة دم عظم
جلد عضلة عصب دماغ عقل فكر ذاكرة روح نفس
حب حبيب عشق ود مودة صداقة كره بغض حقد
فرح سعادة سرور بهجة حزن الم وجع بكاء دمع
ضحك ابتسامة خوف رعب قلق راحة سكينة هدوء
غضب رضا امل ياس شوق حنين ذكرى نسيان
عمل عامل شغل مهنة وظيفة موظف مدير رئيس
تاجر تجارة بيع شراء سوق دكان محل متجر
مال نقود فلوس ثمن سعر ربح خسارة دين قرض
بنك مصرف حساب راتب اجر مرتب ضريبة زكاة
طبيب طب دواء علاج مرض صحة عافية شفاء
مستشفى عيادة صيدلية ممرض جراحة حقنة دهان
مهندس هندسة بناء بناية عمارة برج جسر طريق
شارع طرق ميدان ساحة رصيف زقاق حي مدينة
مدن قرية قرى بلد بلاد دولة وطن عاصمة
سيارة سيارات حافلة باص قطار طائرة دراجة
سائق ركوب سفر رحلة سياحة زيارة وصول ذهاب
مطار محطة ميناء تذكرة جواز حقيبة شنطة
كتابة قراءة قارئ مقال خبر اخبار صحيفة جريدة
مجلة كتاب رواية قصة قصص شعر شاعر قصيدة
ادب لغة كلمة كلمات حرف حروف جملة نص
معنى تفسير شرح ترجمة قاموس معجم مفردات
علم عالم علوم بحث دراسة تجربة نظرية قانون
رياضيات حساب جمع طرح ضرب قسمة عدد ارقام
فيزياء كيمياء احياء جغرافيا تاريخ فلسفة منطق
حاسوب كمبيوتر برنامج تطبيق موقع شبكة انترنت
هاتف جوال شاشة لوحة زر ملف مجلد صورة
فيديو صوت موسيقى اغنية لحن نغمة طرب غناء
مطرب فنان فن رسم رسام لوحة لون الوان
احمر ازرق اخضر اصفر ابيض اسود بني رمادي
برتقالي بنفسجي وردي ذهبي فضي فاتح غامق
كبير صغير طويل قصير عريض ضيق سميك رفيع
ثقيل خفيف قوي ضعيف سريع بطيء جديد قديم
نظيف وسخ جميل قبيح حلو مر حامض مالح
حار بارد دافئ ساخن رطب جاف ناعم خشن
يوم ايام ليل نهار صباح مساء ظهر عصر
فجر غروب شروق ساعة دقيقة ثانية وقت زمن
اسبوع شهر سنة عام قرن فصل ربيع صيف
خريف شتاء موسم تاريخ امس اليوم غدا
باب مفتاح قفل حبل خيط ابرة قماش ثوب
ملابس قميص بنطال فستان جلباب عباءة حجاب
حذاء نعل جورب قبعة وشاح حزام ساعة خاتم
سوق تسوق بضاعة سلعة زبون بائع صندوق
حرب سلام جيش جندي سلاح معركة نصر هزيمة
قائد امير ملك سلطان رئيس حاكم حكومة وزير
شعب امة قبيلة عشيرة نسب اصل جذور
دين ايمان اسلام صلاة صوم زكاة حج عمرة
مسجد جامع محراب منبر مئذنة قبلة مصحف
قران سورة اية حديث سنة فقه شريعة
جنة نار ثواب عقاب توبة مغفرة رحمة
عدل ظلم حق باطل صدق كذب امانة خيانة
كرم بخل شجاعة جبن صبر عجلة حكمة جهل
خير شر حسن سيء نفع ضرر فائدة
باب طريق سبيل وسيلة هدف غاية قصد نية
سؤال جواب حل مشكلة صعوبة سهولة تحدي
لعب لعبة لاعب فريق مباراة ملعب كرة هدف
فوز خسارة تعادل بطولة كاس ميدالية جائزة
سباق جري سباحة قفز رمي تمرين رياضة
حيوان حيوانات اسد نمر فهد ذئب ثعلب دب
قط قطة كلب حصان خيل حمار بغل جمل
بقرة ثور خروف ماعز غزال ارنب فار
طير طيور عصفور حمامة نسر صقر بومة
دجاجة ديك بطة اوزة غراب ببغاء
سمك حوت قرش دولفين سلحفاة ضفدع
ثعبان حية عقرب عنكبوت نملة نحلة ذبابة
بعوضة فراشة جراد دودة صرصور
منزل غرفة مطبخ سرير وسادة بطانية
مروحة مكيف ثلاجة فرن غسالة مكواة
تلفاز راديو ساعة مرآة سجاد ستائر
شمعة عطر صابون منشفة فرشاة مشط
قلم ممحاة مسطرة مقص لاصق دبوس
حقيبة محفظة مفتاح نظارة مظلة
`.trim().split(/\s+/);

// ====== الحالة ======
let LOADED = false;
let SOURCE = "مدمج";
const WORDS = new Set();        // كل الكلمات (بعد التوحيد)
const SIMPLE = new Set();       // الطبقة الشائعة (قاموس مبسّط)
const TIER = new Map();         // كلمة -> 1|2|3
// فهارس المقاطع — واحدة لكل قاموس (شامل / مبسّط)
const IDX = {
  full:   { syl2: [], syl3: [], count: new Map() },
  simple: { syl2: [], syl3: [], count: new Map() }
};

// أسماء ملفات القاموس التي نبحث عنها بالترتيب
const CANDIDATES = ["ar-words.txt", "ar.dic", "ar.txt", "arabic.txt", "words.txt"];

function findDictFile() {
  for (const name of CANDIDATES) {
    const p = path.join(__dirname, name);
    try { if (fs.existsSync(p) && fs.statSync(p).size > 50000) return p; } catch (e) {}
  }
  return null;
}

function addWord(raw, tier) {
  // hunspell: الكلمة قد تكون "كلمة/FLAGS"
  let w = raw;
  const slash = w.indexOf("/");
  if (slash !== -1) w = w.slice(0, slash);
  w = normalize(w);
  if (w.length < MIN_LEN || w.length > MAX_LEN) return;
  if (!isPureArabic(w)) return;
  WORDS.add(w);
  const t = tier || 2;
  const prev = TIER.get(w);
  if (prev === undefined || t < prev) TIER.set(w, t);
  if (t <= 2) SIMPLE.add(w);
}

/* ═══ اختيار المقاطع ═══
   المقطع يجب أن يكون "طبيعياً": لا حروف مكررة متجاورة، ولا يبدأ بسابقة لصيقة. */
const CLITIC_START = new Set(["و", "ف", "ب", "ك", "ل"]);
function badSyllable(s) {
  if (!s || s.length < 2) return true;
  for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return true;   // وو، اا، لل
  if (CLITIC_START.has(s[0]) && (s[1] === "ا" || s[1] === "ل")) return true; // وال، بال، لل
  if (/^[اوي]+$/.test(s)) return true;                                      // حروف علة فقط
  return false;
}

function buildIndex(wordSet, target) {
  const c2 = new Map(), c3 = new Map();
  // نزن المقاطع بشيوع الكلمات: الشائعة جداً ×3، الشائعة ×1، الموسّعة لا تُحتسب
  for (const w of wordSet) {
    const t = TIER.get(w) || 3;
    const weight = t === 1 ? 3 : t === 2 ? 1 : 0;
    if (!weight) continue;
    const L = w.length;
    const seen2 = new Set(), seen3 = new Set();
    for (let i = 0; i + 2 <= L; i++) {
      const s = w.slice(i, i + 2);
      if (!seen2.has(s)) { seen2.add(s); c2.set(s, (c2.get(s) || 0) + weight); }
    }
    for (let i = 0; i + 3 <= L; i++) {
      const s = w.slice(i, i + 3);
      if (!seen3.has(s)) { seen3.add(s); c3.set(s, (c3.get(s) || 0) + weight); }
    }
  }
  target.count = new Map([...c2, ...c3]);
  const min2 = 400, min3 = 120;
  target.syl2 = [...c2].filter(([s, n]) => n >= min2 && !badSyllable(s)).sort((a, b) => b[1] - a[1]);
  target.syl3 = [...c3].filter(([s, n]) => n >= min3 && !badSyllable(s)).sort((a, b) => b[1] - a[1]);
}

function buildSyllables() {
  buildIndex(WORDS, IDX.full);
  buildIndex(SIMPLE, IDX.simple);
}

function load() {
  if (LOADED) return;
  const file = findDictFile();
  if (file) {
    try {
      const txt = fs.readFileSync(file, "utf8");
      const lines = txt.split(/\r?\n/);
      const tiered = path.basename(file) === "ar-words.txt";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line[0] === "#") continue;
        if (tiered) {
          const sp = line.lastIndexOf(" ");
          if (sp > 0) addWord(line.slice(0, sp), parseInt(line.slice(sp + 1), 10) || 2);
          else addWord(line, 2);
        } else {
          addWord(line, 2);
        }
      }
      SOURCE = path.basename(file);
    } catch (e) {
      console.error("dict: فشل قراءة الملف:", e.message);
    }
  }
  // القائمة المدمجة دائماً ضمن الطبقة الأولى (كلمات يومية مضمونة)
  for (const w of FALLBACK) addWord(w, 1);
  buildSyllables();
  LOADED = true;
  console.log(`📖 القاموس: ${WORDS.size.toLocaleString("en")} كلمة (المصدر: ${SOURCE}) — مقاطع: ${IDX.full.syl2.length} ثنائي / ${IDX.full.syl3.length} ثلاثي`);
}

// ====== واجهة الاستعمال ======

function pool(dictName) {
  return dictName === "simple" ? SIMPLE : WORDS;
}

// هل الكلمة موجودة في القاموس؟
function has(word, dictName) {
  return pool(dictName).has(normalize(word));
}

// اختيار مقطع حسب الصعوبة (0 = أسهل، 100 = أصعب) والقاموس المستعمل
function pickSyllable(difficulty = 40, allowTriple = true, dictName = "full") {
  const idx = IDX[dictName === "simple" ? "simple" : "full"];
  const d = Math.min(100, Math.max(0, Number(difficulty) || 0));
  // كلما زادت الصعوبة، اخترنا مقاطع أندر (أبعد في القائمة المرتبة)
  const useTriple = allowTriple && Math.random() < (0.10 + d / 350);
  const list = (useTriple && idx.syl3.length > 40) ? idx.syl3 : idx.syl2;
  if (!list.length) return { syllable: "ال", pool: 0 };
  // نافذة الاختيار: الأسهل يبقى في أشيع المقاطع، والأصعب يصل ~83% من القائمة
  const start = Math.floor(list.length * (d / 100) * 0.55);
  const span = Math.max(15, Math.floor(list.length * 0.28));
  const end = Math.min(list.length, start + span);
  const at = start + Math.floor(Math.random() * Math.max(1, end - start));
  const [syllable, n] = list[Math.min(at, list.length - 1)];
  return { syllable, pool: n };
}

// التحقق الكامل من إجابة اللاعب
// يعيد { ok, reason }
function check(word, syllable, opts = {}) {
  const minLen = Math.max(1, Number(opts.minLength) || 1);
  const dictName = opts.dictionary || "full";
  const used = opts.used;               // Set من الكلمات المستعملة (بعد التوحيد)
  const w = normalize(word);
  if (!w) return { ok: false, reason: "empty" };
  if (!isPureArabic(w)) return { ok: false, reason: "notArabic" };
  if (w.length < minLen) return { ok: false, reason: "tooShort" };
  const syl = normalize(syllable);
  if (syl && !w.includes(syl)) return { ok: false, reason: "noSyllable" };
  if (used && used.has(w)) return { ok: false, reason: "used" };
  if (!pool(dictName).has(w)) return { ok: false, reason: "notFound", word: w };
  return { ok: true, word: w };
}

// الحروف المستخدمة في كلمة (ضمن الأبجدية الـ28)
function lettersOf(word) {
  const out = new Set();
  for (const ch of normalize(word)) if (LETTER_SET.has(ch)) out.add(ch);
  return out;
}

/* إضافة كلمات وافق عليها الأدمن (تدخل الطبقة الشائعة مباشرة) */
function addApproved(list) {
  let n = 0;
  for (const raw of (list || [])) {
    const w = normalize(raw);
    if (!w || !isPureArabic(w) || w.length < MIN_LEN || w.length > MAX_LEN) continue;
    if (!WORDS.has(w)) n++;
    addWord(w, 1);
  }
  return n;
}

function stats() {
  return {
    size: WORDS.size, simple: SIMPLE.size, source: SOURCE,
    syl2: IDX.full.syl2.length, syl3: IDX.full.syl3.length
  };
}

// كم كلمة تحتوي هذا المقطع (للعرض/التشخيص)
function syllablePool(syl, dictName) {
  const idx = IDX[dictName === "simple" ? "simple" : "full"];
  return idx.count.get(normalize(syl)) || 0;
}

module.exports = {
  load, has, check, pickSyllable, lettersOf, normalize, stats,
  syllablePool, addApproved, ALPHABET, isPureArabic
};
