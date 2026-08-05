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
ok(/@keyframes slideIn/.test(BOMB), "السهم يتحرك نحو الهدف");

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
ok(/Math\.cos\(a\) \* r\.rx/.test(BOMB) && /Math\.sin\(a\) \* r\.ry/.test(BOMB), "بيضاوي يستغل العرض والارتفاع");
ok(/id="fabChat"/.test(BOMB), "فقاعة دردشة عائمة واحدة");
ok(/#side \{ position:fixed[\s\S]*?transform:translateY\(102%\)/.test(BOMB), "القوائم صارت نافذة سفلية منزلقة");
ok(/#side\.open \{ transform:translateY\(0\); \}/.test(BOMB), "تنزلق للأعلى عند الفتح");
ok(/id="sheetBack"/.test(BOMB) && /\$\("sheetBack"\)\.onclick = sheetClose/.test(BOMB), "الضغط على الخلفية يغلقها");
ok(/unread\+\+; paintBadges\(\)/.test(BOMB), "شارة غير المقروء على زر الدردشة");
ok(/id="ringNote"/.test(BOMB), "عدّاد الحروف أسفل الحلقة");
ok(/#stage\.compact\.tight #alphaRing \{ display:none; \}/.test(BOMB),
   "لو ضاقت المساحة نرجع للشريط المسطّح بدل حلقة متراكبة");
ok(/function ellipsePerimeter/.test(BOMB), "قياس المحيط يقرّر إن كانت المساحة تكفي");
ok(/const nIn = Math\.round\(n \* 0\.43\)/.test(BOMB), "الحروف على حلقتين متداخلتين (مفاتيح أكبر)");
ok(/\.ral \{[\s\S]*?width:42px/.test(BOMB), "المفاتيح صارت 42px (كانت 30px)");
ok(/\.ral \{ width:38px/.test(BOMB), "وعلى الجوال الصغير 38px — لا تعود 27px");
ok(!/\.ral \{ width:27px/.test(BOMB), "لا قاعدة قديمة تُصغّرها");
ok(BOMB.indexOf('id="fabChat"') > BOMB.indexOf('id="ringNote"'),
   "الفقاعة داخل منطقة اللعب فلا تصادم «ابدأ اللعبة»");
ok(/#sylHead\.hide \{ display:none !important; \}/.test(BOMB) && /classList\.toggle\("hide", !playing\)/.test(BOMB),
   "ترويسة المقطع تختفي قبل بدء اللعب (لا شرطة سابحة)");
ok(/border-radius:13px/.test(BOMB) && /box-shadow:0 4px 10px/.test(BOMB), "مفاتيح ناعمة بظل — كالتصميم المرجعي");
ok(/innerBase = half \+ t \* 0\.68/.test(BOMB), "الحلقة الداخلية تلامس قرص القنبلة (لا مبعدة)");
ok(/Math\.PI \/ nIn/.test(BOMB), "الحلقة الداخلية مُزاحة نصف خطوة فلا تحجب الخارجية");
// قرص القنبلة بنمط التصميم المرجعي
ok(/#stage\.compact #bombCircle \{[\s\S]*?border-radius:50%[\s\S]*?background:#fff/.test(BOMB),
   "قرص أبيض دائري ناعم");
ok(/#stage\.compact #timeNum \{ font-size:31px/.test(BOMB), "الرقم كبير داخل القرص");
ok(/id="timeUnit"/.test(BOMB) && /#stage\.compact #timeUnit \{ display:block; \}/.test(BOMB), "كلمة «ثانية» تحت الرقم");
ok(/#stage\.compact #syl \{ display:none; \}/.test(BOMB), "المقطع خرج من داخل القرص");
ok(/id="sylHead"/.test(BOMB) && /id="sylBig"/.test(BOMB), "المقطع كبير وواضح فوق الحلقة");
ok(/✨ أكمل بالكلمة/.test(BOMB), "نص «أكمل بالكلمة» كالمرجع");
// زرّان مختلفان لا متشابهان
ok(!/id="fabPl"/.test(BOMB) && !/plBadge/.test(BOMB), "زر «اللاعبون» المكرَّر حُذف — بقيت الدردشة فقط");
ok(/#fabChat \{ display:none; position:absolute[\s\S]*?border-radius:50%/.test(BOMB), "فقاعة دائرية بأيقونة فقط");
ok(!/>الدردشة</.test(BOMB.match(/<button id="fabChat"[^>]*>[\s\S]{0,80}/)[0]), "بلا نص على الفقاعة");
ok(/function makeDraggable/.test(BOMB), "الفقاعة قابلة للسحب");
ok(/pointerdown/.test(BOMB) && /pointermove/.test(BOMB) && /pointerup/.test(BOMB), "سحب بالمؤشّر/اللمس");
ok(/if \(moved < 7\) return sheetToggle\(\)/.test(BOMB), "نقرة تفتح الدردشة وسحبة تحرّكها");
ok(/localStorage\.setItem\("bombChatPos"/.test(BOMB), "الموضع يُحفظ للمرة القادمة");
ok(/function clampInto/.test(BOMB), "لا تخرج عن حدود منطقة اللعب");
ok(/id="chatToast"/.test(BOMB) && /function showToast/.test(BOMB), "إشعار يظهر عند وصول رسالة");
ok(/toastT = setTimeout\(\(\)=>\{ t\.classList\.remove\("on"\); \}, 3200\)/.test(BOMB), "الإشعار يختفي تلقائياً");
// محاكاة التوزيع الفعلي على كل المقاسات: بلا تراكب ولا خروج عن الشاشة
function per(rx, ry) { return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))); }
function layout(W, H, half, t, n) {
  const maxRx = W / 2 - t * 0.55, maxRy = H / 2 - t * 0.58, gap = t * 1.12, innerBase = half + t * 0.68;
  const nIn = Math.round(n * 0.43), nOut = n - nIn;
  const ring = (R, pad) => ({ rx: Math.min(R * 1.22, maxRx - pad), ry: Math.min(R, maxRy - pad) });
  const inR = ring(innerBase, gap), outR = ring(innerBase + gap, 0);
  const fits = (r, c) => r.rx > half + t * 0.45 && r.ry > half + t * 0.45 && per(r.rx, r.ry) / c >= t * 1.04;
  if (!(fits(inR, nIn) && fits(outR, nOut))) return { tight: true };
  const place = (i, c, r, off) => { const a = Math.PI * 2 * i / c - Math.PI / 2 + off; return [W / 2 + Math.cos(a) * r.rx, H / 2 + Math.sin(a) * r.ry]; };
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(i < nOut ? place(i, nOut, outR, 0) : place(i - nOut, nIn, inR, Math.PI / nIn));
  let mn = Infinity, inBomb = 0, off = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) mn = Math.min(mn, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    if (Math.hypot(pts[i][0] - W / 2, pts[i][1] - H / 2) < half + t * 0.42) inBomb++;
    if (pts[i][0] < t / 2 || pts[i][0] > W - t / 2 || pts[i][1] < t / 2 || pts[i][1] > H - t / 2) off++;
  }
  return { tight: false, minGap: +mn.toFixed(1), inBomb, off };
}
[[398, 260], [398, 340], [398, 380], [398, 420], [398, 480], [398, 560], [346, 420], [360, 340]]
  .forEach(([W, H]) => {
    const r = layout(W, H, 68, 42, 28);   // الكمبيوتر/التابلت: مفتاح 42px
    ok(r.tight || (r.minGap >= 42 * 0.96 && r.inBomb === 0 && r.off === 0),
       `${W}×${H}: ` + (r.tight ? "شريط مسطّح (ضيق)" : `حلقتان · أقرب ${r.minGap}px بين أي مفتاحين · بلا تراكب`));
  });
// جوال ≤520px: مفتاح 38px
[[398, 300], [398, 380], [398, 480], [346, 380], [360, 340], [320, 420], [398, 270]]
  .forEach(([W, H]) => {
    const r = layout(W, H, 68, 38, 28);
    ok(r.tight || (r.minGap >= 38 * 0.96 && r.inBomb === 0 && r.off === 0),
       `جوال ${W}×${H}: ` + (r.tight ? "شريط مسطّح" : `حلقتان · أقرب ${r.minGap}px · بلا تراكب`));
  });
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

console.log("\n══════════════════════════════════");
console.log("  ✅ نجح: " + PASS + "    ❌ فشل: " + FAIL);
console.log("══════════════════════════════════\n");
process.exitCode = FAIL ? 1 : 0;
