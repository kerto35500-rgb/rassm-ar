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
ok(/Math\.round\(T \* 2 \/ 3\)/.test(SRV), "أول حرف عند بقاء ثلثي الوقت");
ok(/T <= 20 \? Math\.round\(T \* 0\.25\) : 10/.test(SRV), "آخر حرف عند ١٠ث (أو ربع الوقت للمُدد القصيرة)");
const budget = w => { const n = w.replace(/ /g, "").length; return n <= 1 ? 0 : Math.max(1, Math.min(n - 1, Math.round(n / 2))); };
function plan(word, T) {
  const b = budget(word), first = Math.round(T * 2 / 3);
  const last = Math.max(1, Math.min(first - 1, T <= 20 ? Math.round(T * 0.25) : 10));
  const out = [];
  for (let k = 1; k <= b; k++) out.push(b === 1 ? first : Math.round(first - (first - last) * (k - 1) / (b - 1)));
  return out;
}
[[40, 27, 10], [60, 40, 10], [80, 53, 10], [120, 80, 10]].forEach(([T, f, l]) => {
  const p = plan("كمبيوتر", T);
  ok(p[0] === f, `وقت ${T}ث: أول تلميح عند ${p[0]}ث متبقٍ (بعد ${T - p[0]}ث ≈ ثلث الوقت)`);
  ok(p[p.length - 1] === l, `وقت ${T}ث: آخر تلميح عند ${p[p.length - 1]}ث متبقٍ`);
  ok(p.every((t, i) => i === 0 || t < p[i - 1]), `وقت ${T}ث: الحروف موزّعة تنازلياً بلا تكرار`);
});
ok(plan("قط", 80).length === 1 && plan("كتاب", 80).length === 2, "عدد الحروف = نصف الكلمة (كما سبق)");

// ───────── ٣ · شريط الأدوات سطران ─────────
console.log("\n③ شريط الأدوات = سطران فقط");
ok(/id="toolBar"/.test(DRAW) && !/id="toolsLeft"/.test(DRAW), "الشريط الجديد بدل العمود الجانبي");
ok((DRAW.match(/class="tbRow"/g) || []).length === 2, "عدد الأسطر = " + (DRAW.match(/class="tbRow"/g) || []).length);
ok(/\.tbRow \{[\s\S]*?overflow-x:auto/.test(DRAW), "كل سطر يمرّر أفقياً بدل أن يلتف لسطر ثالث");
ok(!/flex-wrap:wrap/.test(DRAW.match(/\.tbRow \{[^}]*\}/)[0]), "لا التفاف داخل السطر");
ok((DRAW.match(/class="tbSep"/g) || []).length >= 3, "فواصل بين المجموعات: " + (DRAW.match(/class="tbSep"/g) || []).length);
ok(/class="toolBtn danger" id="clearBtn"/.test(DRAW), "زر المسح في مجموعته الخاصة ومميّز باللون");
ok(/#colors \{ display:flex/.test(DRAW), "الألوان في سطر أفقي واحد");
ok(/#toolBar \{ display:none; order:2/.test(DRAW), "الشريط أسفل اللوحة (مساحة رسم أوسع)");
ok(/#stageRow \{ display:flex; flex-direction:column/.test(DRAW), "اللوحة والشريط في عمود");

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
ok(/#stage\.compact #alphaBox \{ display:none; \}/.test(BOMB), "الشريط المسطّح يختفي (لا تكرار)");
ok(/Math\.cos\(a\) \* rx/.test(BOMB) && /Math\.sin\(a\) \* ry/.test(BOMB), "بيضاوي يستغل العرض والارتفاع");
ok(/id="fabs"/.test(BOMB) && /id="fabChat"/.test(BOMB) && /id="fabPl"/.test(BOMB), "زرّان عائمان: دردشة ولاعبون");
ok(/#side \{ position:fixed[\s\S]*?transform:translateY\(102%\)/.test(BOMB), "القوائم صارت نافذة سفلية منزلقة");
ok(/#side\.open \{ transform:translateY\(0\); \}/.test(BOMB), "تنزلق للأعلى عند الفتح");
ok(/id="sheetBack"/.test(BOMB) && /\$\("sheetBack"\)\.onclick = sheetClose/.test(BOMB), "الضغط على الخلفية يغلقها");
ok(/unread\+\+; paintBadges\(\)/.test(BOMB), "شارة غير المقروء على زر الدردشة");
ok(/id="ringNote"/.test(BOMB), "عدّاد الحروف أسفل الحلقة");
// محاكاة التوزيع: لا تداخل بين الحروف
function ringPos(n, W, H, half, t) {
  const rx = Math.max(half + t * 0.9, W / 2 - t * 0.85);
  const ry = Math.max(half + t * 0.75, H / 2 - t * 0.95);
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i / n) - Math.PI / 2;
    return [W / 2 + Math.cos(a) * rx, H / 2 + Math.sin(a) * ry];
  });
}
[[412, 520], [360, 430], [412, 300]].forEach(([W, H]) => {
  const pts = ringPos(28, W, H, 54, 28);
  let minD = Infinity, outside = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    minD = Math.min(minD, Math.hypot(x1 - x2, y1 - y2));
    if (Math.hypot(x1 - W / 2, y1 - H / 2) < 54 + 6) outside++;   // داخل القنبلة؟
    if (x1 < 0 || x1 > W || y1 < 0 || y1 > H) outside++;          // خارج الشاشة؟
  }
  ok(minD >= 14, `${W}×${H}: أقرب مسافة بين حرفين ${minD.toFixed(1)}px (بلا تراكب قاتل)`);
  ok(outside === 0, `${W}×${H}: كل الحروف داخل الشاشة وخارج القنبلة`);
});

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
ok(/flex-wrap:nowrap;\s*overflow:hidden;\s*min-height:66px/.test(DRAW),
   "الشريط العلوي سطر واحد بارتفاع ثابت (كان يلتف ويرتد)");
ok(/#hintBox \{[\s\S]*?flex-wrap:nowrap/.test(DRAW), "التلميح لا يلتف فيدفع الشريط");
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
