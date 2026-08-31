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

// أطول مقطع في الحدث — يُستعمل حين يختار العميل بنفسه (تعليقات المقالب مثلًا)
function maxOf(...keys) {
  let m = 0;
  for (const k of keys) for (const d of (VO[k] || [])) if (d > m) m = d;
  return m;
}

// اختيار مقطع عشوائي من حدث واحد أو من عدة أحداث مجتمعة
const last = {};
function pick(keys, budget) {
  const list = [];
  for (const k of [].concat(keys)) {
    (VO[k] || []).forEach((d, i) => {
      if (!budget || d <= budget) list.push({ key: k, i: i + 1, dur: d });
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

module.exports = { VO, pick, maxOf };
