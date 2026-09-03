// 🎙️ مقاطع المعلّق: مدّة كل مقطع بالثواني، مرتّبة حسب رقم الملف.
// الملفات في public/vo باسم <الحدث>-<الرقم>.mp3
// الخادم هو من يختار المقطع لسببين:
//   • يعرف مدّته فيمدّ المرحلة بقدرها فلا ينقطع الصوت في منتصفه.
//   • يسمع اللاعبون كلهم نفس التعليق بدل أن يختار كل متصفح مقطعًا مختلفًا.
const VO = {
  first_door:    [13.6],
  door:          [4.4, 2.4, 3.9],
  door_enter:    [5.3, 4.4, 5.4, 4.2],
  tie_roulette:  [7.4, 9.7, 5.8, 6.4],
  first_powers:  [13.3],
  powers_intro:  [4.8, 5.7, 2.4, 2.7],
  hurry:         [7.0, 6.3, 4.1, 6.0],
  reveal:        [2.3, 2.5, 1.6, 2.8, 3.2, 2.3],
  trap_freeze:   [1.9, 2.1, 1.3],
  trap_gloop:    [1.9, 2.4, 1.6],
  trap_bombs:    [1.5, 1.2, 2.4],
  trap_nibble:   [2.4, 2.1, 2.4],
  trap_double:   [2.9, 1.8],
  trap_bet:      [4.4, 2.0],
  trap_multi:    [2.4, 2.8, 1.3, 2.5, 2.1, 2.8, 1.5],
  near_top:      [2.4, 4.7, 3.2],
  winner:        [13.5, 14.0, 8.0, 8.6],
  pyramid_intro: [26.8],
  sort_intro:    [15.6],
  link_intro:    [13.1],
  sort_timeup:   [7.7],
  link_timeup:   [9.7],
  pyramid_skip:  [8.4, 5.1, 6.3],
  minigame_skip: [4.8, 4.2, 5.0, 3.0],
  skip:          [7.9, 5.9, 6.6]
};

/* ═══ الإعدادات الديناميكية (صفحة الأدمن /vo) ═══
   BASE = المقاطع المرفوعة مع الكود (أعلاه). فوقها طبقةٌ من قاعدة البيانات:
     off : مفاتيح مقاطع معطَّلة ("hurry-2")
     db  : مقاطع مرفوعة من الأدمن {"hurry-5": 4.2} تُخدَم من /vo/hurry-5.mp3
   EFF = القائمة الفعّالة لكل حدث: [{i, dur}] — pick وmaxOf يعملان عليها. */
/* ═══ الاستعجال منفصلٌ لكل مرحلة ═══
   حدثٌ لكل لعبة: الأسئلة والتصنيف والتوصيل (الهرم بلا استعجالٍ بطلب صاحب
   اللعبة). الثلاثة تبدأ بمقاطع
   «hurry» نفسها (لا نُكرّر الملفّات على القرص)، فيُبدّلها المدير أو يعطّلها
   لكل مرحلةٍ على حدة من صفحة /vo. ALIAS يقول: مقاطع هذا الحدث الأساسية
   ملفّاتها باسم الحدث الأصل. */
const ALIAS = { hurry_question: "hurry", hurry_sort: "hurry", hurry_link: "hurry" };
const BASE = VO;
Object.keys(ALIAS).forEach(k => { BASE[k] = BASE[ALIAS[k]].slice(); });
let CFG = { off: [], db: {} };
let EFF = build(CFG);

function build(cfg) {
  const off = new Set(cfg.off || []);
  const db = cfg.db || {};
  const eff = {};
  const keys = new Set(Object.keys(BASE));
  Object.keys(db).forEach(k => { const m = k.match(/^(.+)-(\d+)$/); if (m) keys.add(m[1]); });
  keys.forEach(k => {
    const list = [];
    const src = ALIAS[k] || k;      /* اسم الملفّ على القرص للمقاطع الأساسية */
    (BASE[k] || []).forEach((d, idx) => {
      const key = k + "-" + (idx + 1);
      if (!off.has(key)) list.push({ i: idx + 1, dur: d, f: src + "-" + (idx + 1) });
    });
    Object.keys(db).forEach(key => {
      const m = key.match(/^(.+)-(\d+)$/);
      if (m && m[1] === k && !off.has(key)) list.push({ i: +m[2], dur: Number(db[key]) || 1, f: key });
    });
    list.sort((a, b) => a.i - b.i);
    eff[k] = list;
  });
  return eff;
}
function apply(cfg) { CFG = { off: [].concat(cfg && cfg.off || []), db: { ...(cfg && cfg.db || {}) } }; EFF = build(CFG); return EFF; }
function effective() { return EFF; }
function config() { return CFG; }
/* للعميل: المدد بالفهرس الحقيقي (الفجوات = مقاطعُ معطَّلة = صفر)، ومعها
   خريطةُ الملفّات لأنّ حدثًا قد تكون ملفّاته باسم حدثٍ آخر (ALIAS). */
function durations() {
  const dur = {}, file = {};
  for (const k in EFF) {
    const arr = [];
    EFF[k].forEach(e => { arr[e.i - 1] = e.dur; if (e.f !== k + "-" + e.i) file[k + "-" + e.i] = e.f; });
    dur[k] = Array.from(arr, v => v || 0);
  }
  return { dur, file };
}

// أطول مقطع في الحدث — يُستعمل حين يختار العميل بنفسه (تعليقات المقالب مثلًا)
function maxOf(...keys) {
  let m = 0;
  for (const k of keys) for (const e of (EFF[k] || [])) if (e.dur > m) m = e.dur;
  return m;
}

// اختيار مقطع عشوائي من حدث واحد أو من عدة أحداث مجتمعة
const last = {};
function pick(keys, budget) {
  const list = [];
  for (const k of [].concat(keys)) {
    (EFF[k] || []).forEach(e => {
      if (!budget || e.dur <= budget) list.push({ key: k, i: e.i, dur: e.dur, f: e.f });
    });
  }
  if (!list.length) return null;
  const tag = [].concat(keys).join("+");
  let n = Math.floor(Math.random() * list.length);
  // لا نعيد نفس المقطع مرتين متتاليتين ما دام هناك بديل
  if (list.length > 1 && list[n].key + list[n].i === last[tag]) n = (n + 1) % list.length;
  last[tag] = list[n].key + list[n].i;
  return list[n];
}

module.exports = { VO, BASE, ALIAS, pick, maxOf, apply, effective, config, durations };
