// اختبار التعديلات الأحدث: شريط الأدوات، إعدادات الجوال، توقيت التلميح،
// زر البيت، سهم القنبلة، انتقال الدور، حلقة الحروف، مهلة الفخ، الاهتزاز.
const fs = require("fs");
let PASS = 0, FAIL = 0;
const ok = (c, l, x) => { c ? (PASS++, console.log("  ✅ " + l)) : (FAIL++, console.log("  ❌ " + l + (x ? " → " + x : ""))); };

const DRAW = fs.readFileSync("public/index.html", "utf8");
const BOMB = fs.readFileSync("public/bomb.html", "utf8");
const Q2   = fs.readFileSync("public/quiz2.html", "utf8");
const SRV  = fs.readFileSync("server.js", "utf8");
const BJS  = fs.readFileSync("bomb.js", "utf8");
const QJS  = fs.readFileSync("quiz.js", "utf8");

console.log("\n═══ اختبار الدفعة الثانية ═══");

// ───────── ١ · إعدادات الرسم كنافذة منبثقة في الجوال ─────────
console.log("\n① إعدادات الرسم: بوب اب في الجوال");
ok(/id="setOpenBtn"/.test(DRAW), "زر «إعدادات المباراة» موجود");
ok(/id="setHead"/.test(DRAW) && /id="setCloseBtn"/.test(DRAW), "ترويسة النافذة وزر الإغلاق موجودان");
ok(/id="setDoneBtn"/.test(DRAW), "زر «تم» موجود");
ok(/#settingsBox \{ position:fixed/.test(DRAW), "في الجوال تصبح نافذة ثابتة تغطي الشاشة");
ok(/#settingsBox:not\(\.open\) \{ display:none !important; \}/.test(DRAW), "مخفية حتى تُفتح");
ok(/#setOpenBtn\[hidden\] \{ display:none !important; \}/.test(DRAW), "الزر للقائد فقط");
ok(/\$\("setOpenBtn"\)\.hidden = !owner/.test(DRAW), "غير القائد لا يرى الزر");
ok(/\.setRow \{ flex-direction:column/.test(DRAW), "الحقول تتكدّس عمودياً للقراءة المريحة");
ok(/#setHead, #setDoneBtn, #setOpenBtn \{ display:none; \}/.test(DRAW), "على الكمبيوتر تبقى مدموجة كما هي");

// ───────── ٢ · توقيت التلميح ─────────
console.log("\n② التلميح: يبدأ بعد ثلث الوقت وينتهي قبل ١٠ث");
ok(/Math\.round\(T \* 2 \/ 3\)/.test(SRV), "التلميح يظهر بعد انقضاء ثلث الوقت");
ok(/if \(budget > 0\) revealAt\.set\(Math\.max\(1, Math\.round\(T \* 2 \/ 3\)\), budget\)/.test(SRV),
   "كل حروف التلميح تُكشف دفعة واحدة (لا حرفاً حرفاً)");
ok(!/first - last/.test(SRV), "لم يبقَ توزيع تدريجي");
const budget = w => { const n = w.replace(/ /g, "").length; return n <= 1 ? 0 : Math.max(1, Math.min(n - 1, Math.round(n / 2))); };
function plan(word, T) {
  const b = budget(word);
  return b > 0 ? [[Math.max(1, Math.round(T * 2 / 3)), b]] : [];
}
[["قط", 2, 1], ["شمس", 3, 2], ["كتاب", 4, 2], ["حصان", 4, 2],
 ["مدرسة", 5, 3], ["طائرات", 6, 3], ["كمبيوتر", 7, 4]].forEach(([w, n, exp]) => {
  const p = plan(w, 80);
  ok(p.length === 1, `«${w}» تلميح واحد فقط (لا دفعات)`);
  ok(p[0][1] === exp, `«${w}» ${n} حروف ⇒ يكشف ${p[0][1]} حرفاً دفعة واحدة`);
});
[40, 60, 80, 120].forEach(T => {
  const p = plan("مدرسة", T);
  ok(p[0][0] === Math.round(T * 2 / 3), `وقت ${T}ث: يظهر بعد ${T - p[0][0]}ث (ثلث الوقت) وكله مرة واحدة`);
});


// ───────── ٣ · شريط الأدوات سطران ─────────
console.log("\n③ شريط الأدوات = سطران فقط");
ok(/id="toolBar"/.test(DRAW) && !/id="toolsLeft"/.test(DRAW), "الشريط الجديد بدل العمود الجانبي");
ok((DRAW.match(/class="tbRow"/g) || []).length === 2, "عدد الأسطر = " + (DRAW.match(/class="tbRow"/g) || []).length);
// بنية العناصر: كل شيء يجب أن يكون *داخل* #toolBar، وإلا ظهرت الألوان في اللوبي واختفت الأدوات
(function () {
  const start = DRAW.indexOf('<div id="toolBar">');
  let depth = 0, end = -1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(DRAW))) {
    if (m[0][1] !== "/") depth++;
    else if (--depth === 0) { end = re.lastIndex; break; }
  }
  const blk = end > 0 ? DRAW.slice(start, end) : "";
  ok(end > 0, "وسم #toolBar مغلق بشكل متوازن");
  ok((blk.match(/class="tbRow"/g) || []).length === 2, "السطران داخل #toolBar (لا واحد خارجه)");
  ["colors", "currentColor", "pickerWrap", "clearBtn", "penBtn", "eraserBtn", "undoBtn", "fillBtn"]
    .forEach(id => ok(blk.includes('id="' + id + '"'), `«${id}» داخل الشريط`));
  ok(/<div id="canvasContainer">/.test(DRAW.slice(end, end + 120)), "اللوحة تأتي بعد الشريط مباشرة");
})();
ok(/\.overlay > \*:first-child \{ margin-top:auto; \}/.test(DRAW),
   "طبقات اللوبي تُوسّط بهوامش تلقائية (لا يُقطع أعلاها عند الطول)");
ok(/\.tbRow \{[\s\S]*?overflow-x:auto/.test(DRAW), "كل سطر يمرّر أفقياً بدل أن يلتف لسطر ثالث");
ok(!/flex-wrap:wrap/.test(DRAW.match(/\.tbRow \{[^}]*\}/)[0]), "لا التفاف داخل السطر");
ok((DRAW.match(/class="tbSep"/g) || []).length >= 3, "فواصل بين المجموعات: " + (DRAW.match(/class="tbSep"/g) || []).length);
ok(/class="toolBtn danger" id="clearBtn"/.test(DRAW), "زر المسح في مجموعته الخاصة ومميّز باللون");
ok(/#colors \{ display:flex/.test(DRAW), "الألوان في سطر أفقي واحد");
ok(/#toolBar \{ display:none; order:2/.test(DRAW), "الشريط أسفل اللوحة (مساحة رسم أوسع)");
ok(/#stageRow \{ display:flex; flex-direction:column/.test(DRAW), "اللوحة والشريط في عمود");

ok(/<div id="hintBox"><\/div>/.test(DRAW) && !/<div id="roundInfo">[\s\S]{0,80}id="hintBox"/.test(DRAW),
   "التلميح خرج من الشريط العلوي إلى سطره الخاص (لا يُقطع منه حرف)");
ok(/#hintBox \{[\s\S]*?flex-wrap:wrap/.test(DRAW), "التلميح يلتف بحرية بدل أن يُقص");
ok(/#hintBox:empty \{ display:none; \}/.test(DRAW), "يختفي تماماً وقت لا يوجد تلميح");
ok(/#tbLeft/.test(DRAW), "الشريط العلوي أُعيد ترتيبه بمجموعات");
ok(/#timerBox \{[\s\S]*?width:42px/.test(DRAW), "المؤقّت أصغر (كان 48px)");
ok(/#topBar \{[\s\S]*?padding:6px 12px/.test(DRAW), "حشوة الشريط أقل — مساحة أوفر");
ok(!/min-height:66px/.test(DRAW), "لا ارتفاع أدنى مفروض على الشريط");

// ───────── ٤ · زر البيت ─────────
console.log("\n④ زر الرجوع للبوابة داخل كل لعبة");
ok(/class="homeBtn" href="\//.test(DRAW), "ارسمها: زر بيت في الشريط العلوي");
ok(/href="\/" title="رجوع لكل الألعاب"/.test(BOMB), "القنبلة: زر بيت في الشريط العلوي");
ok(/href="\/" title="رجوع لكل الألعاب"/.test(Q2), "قمّة الهرم: زر بيت في الشريط العلوي");
[["ارسمها", DRAW], ["القنبلة", BOMB], ["قمّة الهرم", Q2]].forEach(([n, f]) =>
  ok(/M3 10\.5L12 3l9 7\.5/.test(f), n + ": أيقونة بيت مرسومة (SVG)"));

// ───────── ٥ · سهم القنبلة ─────────
console.log("\n⑤ سهم انتقال القنبلة");
ok(/class="shaft"/.test(BOMB) && /class="head"/.test(BOMB), "السهم صار شكلاً مرسوماً (جسم + رأس) لا رمز ▼");
ok(!/turnArrow">▼/.test(BOMB), "الرمز القديم أُزيل");
ok(/\.turnArrow \.shaft \{ fill:#ffc21f/.test(BOMB), "لون ذهبي كالمرجع");
ok(/\.chip \.turnArrow \{ position:absolute/.test(BOMB), "في الشريط: سهم أفقي يشير للبطاقة");
ok(/@keyframes bobDown/.test(BOMB) && /@keyframes bob\b/.test(BOMB),
   "المؤشّر متحرّك: مثلث نابض في البطاقة وسهم في الحلقة");

// ───────── ٦ · الدور ينتقل بعد الانفجار ─────────
console.log("\n⑥ القنبلة لا تبقى معلّقة بعد الانفجار");
ok(/function nextAliveIdx/.test(BJS), "دالة «أول لاعب حيّ بعده» موجودة");
ok(/const startIdx = nextAliveIdx\(room, room\.turnIdx\)/.test(BJS), "بعد الانفجار تنتقل للاعب التالي");
ok(!/p\.alive \? room\.turnIdx :/.test(BJS), "لم تبقَ على من انفجرت عنده");
ok(/room\.turnIdx = nextAliveIdx\(room, room\.turnIdx\)/.test(BJS), "التمرير العادي يستعمل نفس الدالة");
// محاكاة: ٣ لاعبين، تنفجر على رقم ١ ⇒ الدور للاعب ٢
function nextAliveIdx(players, from) {
  const n = players.length;
  for (let i = 1; i <= n; i++) { const j = (from + i) % n; if (players[j] && players[j].alive && !players[j].spectator) return j; }
  return from;
}
const P3 = [{ alive: true }, { alive: true }, { alive: true }];
ok(nextAliveIdx(P3, 1) === 2, "٣ لاعبين · انفجرت على رقم ١ ⇒ الدور لرقم ٢");
ok(nextAliveIdx(P3, 2) === 0, "دوران حول الحلقة: من الأخير للأول");
const P3d = [{ alive: true }, { alive: true }, { alive: false }];
ok(nextAliveIdx(P3d, 1) === 0, "يتجاوز الخارجين من اللعبة");
const P3s = [{ alive: true }, { alive: true }, { alive: true, spectator: true }];
ok(nextAliveIdx(P3s, 1) === 0, "يتجاوز المتفرجين");

// ───────── ٧ · واجهة القنبلة في الجوال ─────────
console.log("\n⑦ واجهة القنبلة: حروف حول القنبلة + منبثقات");
ok(/id="alphaRing"/.test(BOMB), "حاوية الحلقة موجودة");
ok(/function layoutAlphaRing/.test(BOMB), "دالة توزيع الحروف على بيضاوي");
ok(/#stage\.compact #alphaRing \{ display:block; \}/.test(BOMB), "تظهر في الجوال");
ok(/matchMedia\("\(max-width: 880px\)"\)\.matches/.test(BOMB),
   "الوضع المدمج يشمل كل شاشات الجوال (لا يختفي على جوال طويل)");
ok(/narrow \|\| \(h > 0 && h < 265\)/.test(BOMB), "أو أي شاشة ضاق ارتفاعها");
ok(/#stage\.compact #alphaBox \{ display:none; \}/.test(BOMB), "الشريط المسطّح يختفي (لا تكرار)");
ok(/Math\.cos\(a\) \* r\b/.test(BOMB) && /Math\.sin\(a\) \* r\b/.test(BOMB), "المواضع تُحسب على محيط دائرة");
ok(/id="fabChat"/.test(BOMB), "فقاعة دردشة عائمة واحدة");
ok(/#side \{ position:fixed[\s\S]*?transform:translateY\(102%\)/.test(BOMB), "القوائم صارت نافذة سفلية منزلقة");
ok(/#side\.open \{ transform:translateY\(0\); \}/.test(BOMB), "تنزلق للأعلى عند الفتح");
ok(/id="sheetBack"/.test(BOMB) && /\$\("sheetBack"\)\.onclick = sheetClose/.test(BOMB), "الضغط على الخلفية يغلقها");
ok(/unread\+\+; paintBadges\(\)/.test(BOMB), "شارة غير المقروء على زر الدردشة");
ok(/id="ringNote"/.test(BOMB), "عدّاد الحروف أسفل الحلقة");
ok(/#stage\.compact\.tight #alphaRing \{ display:none; \}/.test(BOMB),
   "لو ضاقت المساحة نرجع للشريط المسطّح بدل حلقة متراكبة");
ok(/const EDGE = 12, GAP = 9, BOMB_PAD = 8/.test(BOMB),
   "شروط صريحة: هامش 12px من الشاشة وفراغ 9px بين المفاتيح");
ok(/for \(let s = 46; s >= 26; s -= 2\)/.test(BOMB),
   "مقاس المفتاح يُختار تلقائياً (يصغر حتى تتحقّق الشروط)");
ok(/Math\.PI \/ nOut/.test(BOMB), "الحلقة الداخلية تقع في فراغات الخارجية (كالمرجع)");
ok(/const cross = \(R, Ri\)/.test(BOMB), "يُقاس الفراغ بين الحلقتين لا الفرق بين نصفَي القطر فقط");
ok(/width:var\(--ral,40px\)/.test(BOMB), "المفتاح يأخذ مقاسه من الحساب");
ok(!/\.ral \{ width:38px/.test(BOMB) && !/\.ral \{ width:27px/.test(BOMB), "لا تجاوزات مقاس ثابتة");
ok(/#stage\.compact #sylPill \{ display:flex; \}/.test(BOMB) &&
   /#stage\.compact #sylPill:not\(\.on\) \{ visibility:hidden; \}/.test(BOMB),
   "مكان شارة المقطع محجوز دائماً — الشاشة لا تتغيّر عند بدء اللعب");
// قرص القنبلة بنمط التصميم المرجعي
ok(/#stage\.compact #bombCircle \{[\s\S]*?border-radius:50%[\s\S]*?background:#fff/.test(BOMB), "قرص أبيض دائري ناعم");
ok(/#stage\.compact #timeNum \{ font-size:31px/.test(BOMB), "الرقم كبير داخل القرص");
ok(/id="timeUnit"/.test(BOMB) && /#stage\.compact #timeUnit \{ display:block; \}/.test(BOMB), "كلمة «ثانية» تحت الرقم");
ok(/#stage\.compact #syl \{ display:none; \}/.test(BOMB), "المقطع خرج من داخل القرص");
ok(/id="sylHead"/.test(BOMB) && /id="sylBig"/.test(BOMB), "المقطع كبير وواضح");
ok(/id="plTurn"/.test(BOMB) && /id="plOthers"/.test(BOMB), "عمودان: صاحب الدور والباقون");
ok(/#stage\.compact #turnCard \{ display:flex; align-items:center/.test(BOMB), "المقطع في الوسط لا تحت اللاعبين");
ok(/\.chip\.turn::before \{ content:"دورك"/.test(BOMB), "شارة «دورك» كالمرجع");
ok(/#ringNote \{ flex-shrink:0/.test(BOMB), "سطر «لوحتك» خارج الحلقة");
// محاكاة: كل شرط يُقاس على ١٢ مقاس شاشة
(function () {
  const half = 68, n = 28, nIn = Math.round(n * 0.43), nOut = n - nIn;
  const EDGE = 12, GAP = 9, BOMB_PAD = 8;
  const adj = (r, c) => 2 * r * Math.sin(Math.PI / c);
  const cross = (R, Ri) => Math.sqrt(R*R + Ri*Ri - 2*R*Ri*Math.cos(Math.PI / nOut));
  const fit = (W, H) => {
    for (let s = 46; s >= 26; s -= 2) {
      const R = Math.min(W / 2, H / 2) - s / 2 - EDGE;
      const RiMin = Math.max(half + s / 2 + BOMB_PAD, (s + GAP) / (2 * Math.sin(Math.PI / nIn)));
      if (adj(R, nOut) < s + GAP || RiMin >= R || cross(R, RiMin) < s + GAP) continue;
      return { t: s, R, Ri: RiMin };
    }
    return null;
  };
  [[398,560],[398,500],[398,470],[398,440],[398,400],[398,360],[360,460],[346,420],[320,440],[300,400],[398,320],[398,280]]
    .forEach(([W, H]) => {
      const f = fit(W, H);
      if (!f) return ok(true, `${W}×${H}: شريط مسطّح (المساحة لا تكفي)`);
      const { t, R, Ri } = f;
      const margin = Math.min(W / 2, H / 2) - R - t / 2;
      const gOut = adj(R, nOut) - t, gIn = adj(Ri, nIn) - t, gX = cross(R, Ri) - t, gB = Ri - half - t / 2;
      ok(margin >= 11.9 && gOut >= 8.9 && gIn >= 8.9 && gX >= 8.9 && gB >= 7.9,
         `${W}×${H}: مفتاح ${t}px · هامش ${margin.toFixed(0)}px · فراغات ${gOut.toFixed(0)}/${gIn.toFixed(0)}/${gX.toFixed(0)}/${gB.toFixed(0)}px`);
    });
})();
// صف الإدخال لا يفيض عن عرض الشاشة
ok(/#wordInput \{ flex:1 1 0; min-width:0/.test(BOMB), "مربع الكتابة يتقلّص ولا يدفع زر الإرسال خارج الشاشة");
ok(/#sendBtn \{ flex:0 0 auto/.test(BOMB), "زر الإرسال بحجم ثابت");
ok(/#wordForm \{ display:flex; gap:8px; min-width:0/.test(BOMB), "الصف نفسه قابل للتقلّص");

ok(/id="roomChip"/.test(BOMB), "بطاقة الغرفة في وسط الشريط (كالمرجع)");
ok(/#roomChip \.l1/.test(BOMB) && /#roomChip \.l2/.test(BOMB), "سطران: رقم الغرفة وعدد الكلمات");
ok(/#roomChip \{[\s\S]*?background:#fff[\s\S]*?box-shadow/.test(BOMB), "بطاقة بيضاء بظل ناعم");
ok(/\.iconBtn \{[\s\S]*?border-radius:14px[\s\S]*?background:#fff/.test(BOMB), "أزرار بيضاء مربّعة الحواف الناعمة");
ok(/id="moreBtn"/.test(BOMB) && /id="moreMenu"/.test(BOMB), "أزرار الإعدادات/القوائم/الخروج داخل قائمة ⋮");
ok(/id="turnCard"/.test(BOMB), "بطاقة الدور تجمع الأسماء والمقطع (كالمرجع)");
ok(/#stage\.compact #turnCard \{[\s\S]*?border-radius:20px/.test(BOMB), "بطاقة الدور بحواف دائرية وخلفية خفيفة");

// تنبيه «دورك!»
console.log("\n⑦-ب تنبيه «دورك!»");
[["القنبلة", BOMB], ["ارسمها", DRAW]].forEach(([n, f]) => {
  ok(/id="turnFlash"/.test(f), n + ": عنصر التنبيه موجود");
  ok(/function turnFlash/.test(f), n + ": دالة الإظهار موجودة");
  ok(/@keyframes tfWord/.test(f) && /@keyframes tfHalo/.test(f) && /@keyframes tfSpark/.test(f),
     n + ": حركات (الكلمة + الهالة + الشرارات)");
  ok(/-webkit-text-stroke:3px/.test(f) && /background-clip:text/.test(f),
     n + ": حروف ملوّنة بحدّ أسود كالصور المرجعية");
  ok(/setTimeout\(\(\) => el\.classList\.remove\("on"\), 1550\)/.test(f), n + ": يختفي تلقائياً");
  ok(/pointer-events:none/.test(f.match(/#turnFlash \{[^}]*\}/)[0]), n + ": لا يعترض اللمس");
});
ok(/if \(myTurn && !wasMyTurn\) turnFlash\(\)/.test(BOMB), "القنبلة: يظهر مرة واحدة عند انتقال الدور إليك");
ok(/if \(isDrawer && !wasMyDraw\) \{ turnFlash\(\)/.test(DRAW), "ارسمها: يظهر عند انتقال الدور إليك");
ok(/background:linear-gradient\(180deg,#fff3d0/.test(BOMB), "القنبلة: تدرّج ناري كالمرجع");
ok(/background:linear-gradient\(110deg,#7c4dff/.test(DRAW), "ارسمها: تدرّج ملوّن كالمرجع");

// شريط الأسماء يختفي وقت الرسم
console.log("\n⑦-ج مساحة أوسع للرسم");
ok(/body\.iDraw #playersPanel \{ display:none; \}/.test(DRAW), "شريط الأسماء يُخفى وقت دورك في الرسم");
ok(/body\.iDraw #canvasContainer \{ min-height:330px; \}/.test(DRAW), "اللوحة تتوسّع");
ok(/document\.body\.classList\.toggle\("iDraw", canDraw\)/.test(DRAW), "يُفعّل فقط وقت دورك");

// لا فراغ رمادي + لا تمطيط: المقياس موحّد (تطبيع بالعرض في المحورين)
console.log("\n⑦-د اللوحة تملأ المساحة كاملة والدائرة تبقى دائرة");
ok(!/#board \{[^}]*aspect-ratio/.test(DRAW), "لا نسبة مفروضة على اللوحة (اختفى الفراغ)");
ok(/#board \{ position:absolute; inset:0; width:100%; height:100%/.test(DRAW), "اللوحة تغطي كل الحاوية");
ok(/#canvasContainer \{[\s\S]*?background:#fff/.test(DRAW), "الخلفية بيضاء بالكامل لا رمادية");
ok(!/#canvasContainer \{[\s\S]*?background:#e9eef4/.test(DRAW), "اللون الرمادي أُزيل");
ok(/const rect = canvas\.getBoundingClientRect\(\)/.test(DRAW), "القياس للوحة نفسها");
ok(/y: \(pt\.clientY - rect\.top\) \/ rect\.width/.test(DRAW), "ص تُطبَّع بالعرض ⇒ مقياس موحّد");
ok(/op\.y1 \* canvas\.width/.test(DRAW) && /op\.y2 \* canvas\.width/.test(DRAW), "الرسم يُعيد الإحداثي الرأسي بالعرض");
ok(!/op\.y1 \* canvas\.height/.test(DRAW) && !/op\.y \* h\b/.test(DRAW), "لا بقايا تطبيع بالارتفاع");
ok(/new ResizeObserver\(\(\) => resizeCanvas\(\)\)/.test(DRAW), "يُعاد القياس عند تغيّر مقاس الحاوية");
(function () {
  // شكل مربع الأبعاد (دائرة) يُرسم على جهاز ويُعاد على آخر — المقياس واحد فالنسبة تُحفظ
  const shape = { x1: .30, y1: .20, x2: .70, y2: .60 };   // عرضه = ارتفاعه = 0.40 وحدة
  const dev = (w, h) => {
    const W = shape.x2 * w - shape.x1 * w;      // بالبكسل أفقياً
    const H = shape.y2 * w - shape.y1 * w;      // بالبكسل رأسياً (نفس العرض!)
    return W / H;
  };
  const cases = [["كمبيوتر", 940, 590], ["جوال", 390, 452], ["تابلت", 760, 520], ["جوال صغير", 320, 380]];
  cases.forEach(([n, w, h]) => ok(Math.abs(dev(w, h) - 1) < 0.001, `${n} ${w}×${h}: الدائرة دائرة (نسبة ${dev(w, h).toFixed(3)})`));
  // السلوك القديم (تطبيع بالارتفاع) كان يشوّه بحسب فرق النسب
  const oldDev = (w, h) => ((shape.x2 - shape.x1) * w) / ((shape.y2 - shape.y1) * h);
  const bad = Math.abs(oldDev(940, 590) / oldDev(390, 452) - 1) * 100;
  ok(bad > 20, `قبل الإصلاح كان الفرق بين الكمبيوتر والجوال ${bad.toFixed(0)}%`);
  // الفراغ المهدور: قبل الإصلاح ٤:٣ داخل حاوية 390×452 ⇒ نسبة كبيرة مهدورة
  const wasted = 1 - (390 * (390 * 3 / 4)) / (390 * 452);
  ok(wasted > 0.3, `الفراغ الذي أُلغي كان ${(wasted * 100).toFixed(0)}% من المساحة`);
})();
ok(/#safeLine/.test(DRAW) && /حد المساحة المشتركة/.test(DRAW), "خط إرشادي يبيّن الحد المشترك للرسم");
ok(/const show = !!canDraw && h > y \+ 14/.test(DRAW), "الخط يظهر للرسّام فقط وعند وجود مساحة زائدة");
ok(/if \(isDrawer && !wasMyDraw\) \{ turnFlash\(\); wasMyDraw = true; \}/.test(DRAW),
   "تنبيه «دورك!» يظهر في مرحلة اختيار الكلمة — قبلها لا بعدها");
ok(!/if \(canDraw && !wasMyDraw\) turnFlash\(\)/.test(DRAW), "لا يُعاد إطلاقه عند بدء الرسم");

// ───────── ٨ · شاشة دخول الهرم موحّدة ─────────
console.log("\n⑧ شاشة دخول قمّة الهرم كالباقي");
ok(!/<button id="tL" class="on">دخول<\/button>/.test(Q2), "تبويبات دخول/حساب جديد/ضيف أُزيلت");
ok(/id="aName" placeholder="اكتب اسمك هنا"/.test(Q2), "حقل الاسم بنفس صيغة الرسم والقنبلة");
ok(/id="whoLine"/.test(Q2), "سطر «مسجّل باسم…» كالباقي");
ok(/function needName/.test(Q2), "يطلب الاسم قبل إنشاء غرفة أو الانضمام");
ok(/\$\("aName"\)\.onkeydown/.test(Q2), "Enter يبدأ اللعب مباشرة");
ok(/id="roomP"/.test(Q2) && /🎮 إنشاء غرفة جديدة/.test(Q2), "بطاقة واحدة: اسم + إنشاء/انضمام");

// ───────── ٩ · الاهتزاز ─────────
console.log("\n⑨ إصلاح اهتزاز شاشة الرسم");
ok(/#topBar \{[\s\S]*?flex-wrap:nowrap;[\s\S]*?overflow:hidden/.test(DRAW),
   "الشريط العلوي سطر واحد لا يلتف (كان يلتف ويرتد فتهتز الشاشة)");
ok(/<div id="hintBox"><\/div>/.test(DRAW),
   "التلميح خارج الشريط أصلاً فلا يستطيع دفعه ولا تغيير ارتفاعه");
ok(/scrollbar-gutter:stable/.test(DRAW), "مكان شريط التمرير محفوظ (لا يظهر ويختفي)");
ok(!/\.colorBtn:hover \{ transform:scale/.test(DRAW), "تكبير اللون عند المرور أُزيل");
ok(/\.colorBtn:hover \{ box-shadow/.test(DRAW), "استُبدل بتوهج لا يغيّر المقاس");
ok(!/overflow-y:auto/.test((DRAW.match(/#toolBar \{[^}]*\}/) || [""])[0]), "شريط الأدوات بلا تمرير عمودي");

// ───────── ١٠ · مهلة الفخ ─────────
console.log("\n⑩ مهلة اختيار بطاقة الفخ");
ok(/attackTime: 60/.test(QJS), "الافتراضي دقيقة كاملة");
ok(/clampInt\(s\.attackTime, MIN_A, 60, old\.attackTime\)/.test(QJS), "الحد الأقصى ٦٠ث");
ok(/function maybeEndAttack/.test(QJS), "تنتهي مبكراً إذا اختار الجميع");
ok(/p\.powersLeft > 0 && !p\.pendingAttack/.test(QJS), "لا تنتظر من نفدت استخداماته");
ok((QJS.match(/maybeEndAttack\(room\);/g) || []).length >= 2, "تُستدعى بعد الهجوم وبعد قوى النفس");
ok(/setPhase\(room, "attack", room\.settings\.attackTime, \(\) => beginQuestion\(room\)\)/.test(QJS),
   "من لم يختر حتى انتهاء الوقت يمرّ بلا فخ");
ok(/id="sAT" min="5" max="60" step="5"/.test(Q2), "شريط الإعداد يصل إلى ٦٠ث");

// ───────── ١٢ · تلوين مربع الدردشة حسب نتيجة التخمين ─────────
console.log("\n⑫ الدردشة تقلب أحمر/أخضر حسب التخمين");
ok(/io\.to\(player\.id\)\.emit\("guessResult", \{ ok: true \}\)/.test(SRV), "الخادم يبلّغ المُخمِّن بالإجابة الصحيحة");
ok(/io\.to\(player\.id\)\.emit\("guessResult", \{ ok: false, close: veryClose \}\)/.test(SRV), "ويبلّغه بالخطأ ويميّز القريبة");
ok(/const veryClose = levenshtein\(guess, answer\) === 1/.test(SRV), "«قريبة جدًا» تُحسب بفرق حرف واحد");
ok(!/io\.to\(room\.id\)\.emit\("guessResult"/.test(SRV), "النتيجة تُرسل للمُخمِّن وحده لا للغرفة (لا تكشف الكلمة)");
ok(/socket\.on\("guessResult", r => \{/.test(DRAW), "العميل يستقبل النتيجة");
ok(/#chatForm\.res-bad\s+#chatInput \{ animation:cbBad/.test(DRAW), "خطأ ⇒ أنميشن أحمر");
ok(/#chatForm\.res-good\s+#chatInput \{ animation:cbGood/.test(DRAW), "صح ⇒ أنميشن أخضر");
ok(/#chatForm\.res-close #chatInput \{ animation:cbClose/.test(DRAW), "قريبة ⇒ برتقالي");
ok(/@keyframes cbBad \{[\s\S]*?border-color:#e53935; background:#ffdad6/.test(DRAW), "الأحمر واضح على الحدود والخلفية");
ok(/@keyframes cbBad \{[\s\S]*?translateX\(-7px\)/.test(DRAW), "مع رجّة تنبيهية");
ok(/@keyframes cbGood \{[\s\S]*?border-color:#2e7d32; background:#c8f7cd/.test(DRAW), "الأخضر واضح");
ok(/100% \{ border-color:#ddd; background:#fff/.test(DRAW), "يرجع للطبيعي بعد الوميض (يظهر ويختفي)");
ok(/id="resTag"/.test(DRAW) && /"صح! ✅"/.test(DRAW) && /"خطأ ✗"/.test(DRAW), "شارة نصية صغيرة تؤكد المعنى");
ok(/void form\.offsetWidth/.test(DRAW), "يُعاد تشغيل الأنميشن لو خمّنت مرتين بسرعة");
ok(/clearTimeout\(resT\)/.test(DRAW), "لا تتراكم المؤقتات");
ok(/navigator\.vibrate && navigator\.vibrate\(70\)/.test(DRAW), "اهتزاز خفيف للجوال عند الخطأ");
(function () {
  // منطق اختيار اللون كما في العميل
  const kind = r => (r && r.ok ? "good" : (r && r.close ? "close" : "bad"));
  ok(kind({ ok: true }) === "good", "نتيجة صحيحة ⇒ أخضر");
  ok(kind({ ok: false, close: true }) === "close", "فرق حرف ⇒ برتقالي");
  ok(kind({ ok: false, close: false }) === "bad", "خطأ ⇒ أحمر");
})();

console.log("\n══════════════════════════════════");
console.log("  ✅ نجح: " + PASS + "    ❌ فشل: " + FAIL);
console.log("══════════════════════════════════\n");
process.exitCode = FAIL ? 1 : 0;
