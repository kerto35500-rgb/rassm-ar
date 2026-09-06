// اختبار تعديلات «قمّة الهرم».
//
// أهمّها قاعدةُ القمّة: صعودُ اثنين معًا مقبولٌ في وسط الهرم، أمّا الدرجة
// الأخيرة فللأوّل وحده — وإلا انتهت المباراة بفائزٍ يُختار بفارق أجزاء
// الثانية بين قافزَين بلغا القمّة في اللحظة نفسها.

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const fs = require("fs");
const SRV = fs.readFileSync(require("path").join(__dirname, "quiz.js"), "utf8");
const CL = fs.readFileSync(require("path").join(__dirname, "public", "quiz2.html"), "utf8");

console.log("\n═══ تعديلات قمّة الهرم ═══\n");

/* ── منطق القمّة: نُعيد بناء الجزء المعنيّ ونجرّبه على حالاتٍ صريحة ──
   نسخةٌ مطابقة لما في `pyramidReveal` كي نختبر القاعدة لا الشبكة. */
function climbersFor({ H, N, corrects }) {
  const fastest = corrects[0] ? corrects[0].id : null;
  const climbN = N >= 5 ? 2 : 1;
  const climbers = new Set(corrects.slice(0, climbN).map(p => p.id));
  corrects.forEach(p => {
    if (p.id === fastest) return;
    if (climbers.has(p.id) && p.pyPos + 1 >= H) climbers.delete(p.id);
  });
  return climbers;
}

console.log("① وسط الهرم: الأوّل والثاني يصعدان");
{
  const c = climbersFor({ H: 6, N: 6, corrects: [
    { id: "a", pyPos: 2 }, { id: "b", pyPos: 2 }, { id: "c", pyPos: 1 }] });
  eq([...c].sort(), ["a", "b"], "الأسرعان يصعدان وهما بعيدان عن القمّة");
  ok(!c.has("c"), "والثالث لا يصعد");
}

console.log("② الدرجة الأخيرة: الأوّل وحده");
{
  /* كلاهما على ٥ من ٦: خطوةٌ واحدةٌ تفصلهما عن الفوز */
  const c = climbersFor({ H: 6, N: 6, corrects: [
    { id: "a", pyPos: 5 }, { id: "b", pyPos: 5 }, { id: "c", pyPos: 3 }] });
  ok(c.has("a"), "الأسرع يبلغ القمّة");
  ok(!c.has("b"), "والثاني لا يقفز معه — وهذا هو الإصلاح");
  eq(c.size, 1, "صاعدٌ واحدٌ لا اثنان");
}

console.log("③ الثاني يصعد إن لم تكن خطوتُه إلى القمّة");
{
  const c = climbersFor({ H: 6, N: 6, corrects: [
    { id: "a", pyPos: 5 }, { id: "b", pyPos: 3 }] });
  ok(c.has("a"), "الأوّل إلى القمّة");
  ok(c.has("b"), "والثاني يصعد درجةً عاديّة — القيد على القمّة وحدها");
}

console.log("④ الأوّل نفسه لا يُمنَع أبدًا");
{
  const c = climbersFor({ H: 6, N: 3, corrects: [{ id: "a", pyPos: 5 }] });
  ok(c.has("a"), "بلاعبين قلائل يصعد الأسرع وحده كما كان");
  eq(c.size, 1, "ولا أحد غيره");
}

console.log("⑤ لا صاعدَ بلا إجابةٍ صحيحة");
{
  eq(climbersFor({ H: 6, N: 6, corrects: [] }).size, 0, "لم يُصب أحد ⇒ لا صعود");
}

console.log("⑥ الكود المنشور يطابق القاعدة");
{
  ok(/climbers\.has\(p\.id\) && p\.pyPos \+ 1 >= H/.test(SRV),
     "شرطُ منع القفز للقمّة موجودٌ في quiz.js");
  ok(/if \(p\.id === fastest\) return;/.test(SRV), "والأسرع مستثنى منه");
}

console.log("⑦ وقت سؤال الهرم كوقت السؤال العاديّ");
{
  const def = SRV.match(/pyramidTime:\s*(\d+)/);
  eq(def && +def[1], 15, "الافتراضيّ خمس عشرة ثانية (كان سبعًا)");
  const q = SRV.match(/questionTime:\s*(\d+)/);
  eq(def && +def[1], q && +q[1], "ومساوٍ لوقت السؤال العاديّ");
  ok(/clampInt\(s\.pyramidTime, MIN_P, 30, old\.pyramidTime\)/.test(SRV),
     "والسقف ثلاثون كسقف السؤال العاديّ");
  ok(/id="sPT" min="4" max="30"/.test(CL), "وشريطُ الإعداد يبلغ ثلاثين");
}

console.log("⑧ الوحل: عتبةٌ أخفّ ومعادلةٌ واحدة للجهازين");
{
  ok(/const GLOOP_DONE=\.70;/.test(CL), "العتبة ٧٠٪ (كانت ٨٠٪)");
  ok(!/pct\(\)>=\.8/.test(CL), "ولا أثرَ للعتبة القديمة");
  ok(/const BRUSH=Math\.max\(42,Math\.min\(150,h\*1\.15\)\);/.test(CL),
     "والفرشاة نسبةٌ من الارتفاع لا رقمٌ يختلف بالشاشة");
  ok(!/const wide=innerWidth>699;/.test(CL), "ولا معادلتين مختلفتين بعد الآن");
  ok(/\+\+moves%4===0/.test(CL), "والفحص كلّ ٤ حركات (كان ٧)");
}

console.log("⑨ التجميد: الطبقة المكسورة تُخلي الطريق فورًا");
{
  ok(/el\.style\.pointerEvents="none";/.test(CL), "تُرفَع من اختبار النقر لحظةَ الكسر");
  ok(/el\.onclick=null;\n\s*el\.style\.pointerEvents/.test(CL) || /el\.onclick=null;/.test(CL),
     "ويُلغى مبتلعُ النقر");
  /* لا يجوز أن يبقى ابتلاعُ النقر ساريًا حتى نهاية الانيميشن */
  const seg = CL.slice(CL.indexOf("if(taps>=3){"), CL.indexOf("if(taps>=3){") + 700);
  ok(seg.includes("pointerEvents=\"none\""), "داخل فرع الكسر نفسه", seg.slice(0, 120));
}

console.log("⑩ لا تحديدَ نصٍّ عرضيّ");
{
  ok(/body\{user-select:none;-webkit-user-select:none/.test(CL), "قاعدةٌ عامّة على body");
  ok(/input,textarea,\[contenteditable\],\.selectable\{user-select:text/.test(CL),
     "ويُستثنى ما يُكتَب فيه");
}

console.log("⑪ شريط القفز التجريبيّ حُذف");
{
  ok(!/id="devBar"/.test(CL), "لا عنصرَ له في الصفحة");
  ok(!/class="djb"/.test(CL), "ولا أزرار");
  ok(!/devBarSync/.test(CL), "ولا دالّةَ مزامنة");
  ok(!/emit\("devJump"/.test(CL), "ولا إرسالَ من العميل");
  ok(/socket\.on\("devJump"/.test(SRV), "والحدثُ على الخادم باقٍ محروسًا (لا كودَ ميّتٌ يُكسَر)");
}

console.log("⑫ التحكّم بالصوت");
{
  ok(/id="sndB"/.test(CL) && /id="sndPop"/.test(CL), "زرٌّ ولوحةٌ في الشريط العلويّ");
  ok(/const SND=\{vol:1,muted:false\}/.test(CL), "ومستوًى عامٌّ واحد");
  ok(/localStorage\.getItem\("qzVol"\)/.test(CL), "محفوظٌ في المتصفّح");
  ok(/sndAttach\(a,1\)/.test(CL), "وقراءةُ السؤال تتبعه");
  ok(/sndAttach\(a,\.92\)/.test(CL), "وتعليقُ المعلّق كذلك");
  ok(/const gv=\(v\|\|\.05\)\*sndGain\(\);/.test(CL), "والمؤثّراتُ المولَّدة تُضرَب في المستوى");
  ok(/vol=\(vol\|\|\.12\)\*sndGain\(\);/.test(CL), "والضجيجُ كذلك");
  ok(/v\.volume=sndGain\(\)/.test(CL), "والفيديو كذلك");
  ok(!/a\.volume=1;/.test(CL) && !/a\.volume=\.92;/.test(CL), "ولا مستوًى ثابتٌ باقٍ");
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
