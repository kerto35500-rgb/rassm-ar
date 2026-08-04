// اختبار التعديلات التسعة: الحساب المشترك، تصفير الغرف، التلميح، الكيبورد،
// سهم الدور، رابط الدعوة، وواجهة الجوال.
const http = require("http");
const fs = require("fs");
require("./server");

const PORT = process.env.PORT || 3000;
let PASS = 0, FAIL = 0;
const ok = (c, l, x) => { c ? (PASS++, console.log("  ✅ " + l)) : (FAIL++, console.log("  ❌ " + l + (x ? " → " + x : ""))); };

function req(method, path, body, cookie) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(data); }
    if (cookie) headers["Cookie"] = cookie;
    const r = http.request({ host: "127.0.0.1", port: PORT, path, method, headers, timeout: 8000 }, rs => {
      let b = "";
      rs.on("data", d => b += d);
      rs.on("end", () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ code: rs.statusCode, body: b, json: j, setCookie: rs.headers["set-cookie"] || [] });
      });
    });
    r.on("error", e => res({ code: 0, body: "", err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0, body: "" }); });
    if (data) r.write(data);
    r.end();
  });
}
const get = p => req("GET", p);
const post = (p, b, c) => req("POST", p, b, c);

const BOMB = fs.readFileSync("public/bomb.html", "utf8");
const DRAW = fs.readFileSync("public/index.html", "utf8");
const HUB  = fs.readFileSync("public/hub.html", "utf8");
const Q2   = fs.readFileSync("public/quiz2.html", "utf8");

setTimeout(async () => {
  console.log("\n═══ اختبار التعديلات ═══");

  // ───────────── ١ · الحساب المشترك ─────────────
  console.log("\n① حساب واحد لكل الألعاب");
  const uniq = "تجربة" + Math.floor(Math.random() * 1e6);

  let r = await get("/api/account/me");
  ok(r.json && r.json.guest === true, "زائر بلا كوكي = ضيف");

  r = await post("/api/account/register", { name: uniq, pass: "1234" });
  ok(r.code === 200 && r.json && r.json.ok, "إنشاء حساب ينجح", r.body.slice(0, 80));
  const cookie = (r.setCookie[0] || "").split(";")[0];
  ok(/^acct=/.test(cookie), "الخادم يضع كوكي الجلسة: " + cookie.slice(0, 14) + "…");

  r = await get("/api/account/me");
  const me = await req("GET", "/api/account/me", null, cookie);
  ok(me.json && me.json.guest === false && me.json.stats.name === uniq,
     "الكوكي يعرّف المستخدم في أي لعبة (" + (me.json && me.json.stats && me.json.stats.name) + ")");

  r = await post("/api/account/register", { name: uniq, pass: "1234" });
  ok(r.code === 409, "الاسم المكرر مرفوض");
  r = await post("/api/account/register", { name: "أ", pass: "1234" });
  ok(r.code === 400, "الاسم القصير مرفوض");
  r = await post("/api/account/register", { name: uniq + "x", pass: "12" });
  ok(r.code === 400, "كلمة المرور القصيرة مرفوضة");

  r = await post("/api/account/login", { name: uniq, pass: "غلط" });
  ok(r.code === 401, "كلمة المرور الخاطئة مرفوضة");
  r = await post("/api/account/login", { name: uniq, pass: "1234" });
  ok(r.code === 200 && r.json.ok, "الدخول بكلمة المرور الصحيحة ينجح");

  // كوكي مُلفَّق: نفس بنية الجلسة لكن بتوقيع مُختلق
  const forged = cookie.replace(/^acct=/, "").split(".");
  forged[2] = "0".repeat(64);
  r = await req("GET", "/api/account/me", null, "acct=" + forged.join("."));
  ok(r.json && r.json.guest === true, "كوكي مُلفَّق (توقيع خاطئ) يُرفض");
  // كوكي بجلسة قديمة جداً (منتهية)
  const stale = cookie.replace(/^acct=/, "").split(".");
  stale[1] = String(Date.now() - 40 * 24 * 3600 * 1000);
  r = await req("GET", "/api/account/me", null, "acct=" + stale.join("."));
  ok(r.json && r.json.guest === true, "كوكي منتهي الصلاحية يُرفض");

  r = await post("/api/account/logout");
  ok(/Max-Age=0/.test(r.setCookie[0] || ""), "الخروج يمسح الكوكي");

  r = await get("/api/account/top");
  ok(r.json && Array.isArray(r.json.top), "قائمة المتصدرين متاحة للبوابة");

  // ───────────── ٢ · إزالة الدخول من الألعاب البسيطة ─────────────
  console.log("\n② الألعاب البسيطة: بطاقة واحدة فقط");
  ok(!/id="authUser"/.test(DRAW) && !/id="lbBtn"/.test(DRAW),
     "ارسمها: لا بطاقة دخول ولا لوحة متصدرين");
  ok(!/id="tabLogin"/.test(BOMB) && !/id="lbCard"/.test(BOMB),
     "القنبلة: لا تبويبات دخول ولا لوحة متصدرين");
  ok(/id="nameInput"/.test(DRAW) && /id="createBtn"/.test(DRAW), "ارسمها: الاسم + إنشاء غرفة باقية");
  ok(/id="aName"/.test(BOMB) && /id="createBtn"/.test(BOMB), "القنبلة: الاسم + إنشاء غرفة باقية");
  ok(/api\/account\/me/.test(DRAW), "ارسمها تقرأ الحساب المشترك");
  ok(/api\/account\/me/.test(BOMB), "القنبلة تقرأ الحساب المشترك");
  ok(/api\/account\/me/.test(Q2), "قمّة الهرم تقرأ الحساب المشترك");
  ok(/id="accBtn"/.test(HUB) && /api\/account\//.test(HUB) && /#accBar\{[\s\S]*?position:fixed/.test(HUB),
     "البوابة فيها تسجيل دخول مثبّت في الزاوية");
  ok(/accTabLogin/.test(HUB) && /accTabReg/.test(HUB), "البوابة فيها دخول + حساب جديد");
  ok(/accOut/.test(HUB) && /"logout"/.test(HUB), "البوابة فيها تسجيل خروج");

  // ───────────── ٣ · تصفير إعدادات كل غرفة ─────────────
  console.log("\n③ كل غرفة جديدة تبدأ من الأساس");
  const srv = fs.readFileSync("server.js", "utf8");
  ok(!/\bGW\b/.test(srv), "لا توجد قائمة كلمات عامة (GW) بعد الآن");
  ok(/words:\s*emptyWords\(\)/.test(srv), "الغرفة الجديدة تُنشأ بكلمات فارغة (= الأساس)");
  ok(/settings:\s*\{\s*\.\.\.DEFAULT_SETTINGS\s*\}/.test(srv), "الغرفة الجديدة تُنشأ بالإعدادات الافتراضية");
  ok(/room\.words\.removedWords/.test(srv) && /room\.words\.extra/.test(srv),
     "التعديلات تُكتب على كلمات الغرفة لا على قائمة عامة");
  ok(/PROFILE_KEY/.test(srv) && /if \(!room \|\| !room\.ownerUser\) return/.test(srv),
     "الحفظ للمسجَّل فقط — الضيف لا يترك أثراً");
  ok(/room\.ownerUser\b/.test(srv) && /getKV\(PROFILE_KEY/.test(srv),
     "القائد المسجَّل تُحمَّل له كلماته وإعداداته");

  // ───────────── ٤ · التلميح ٥٠٪ ─────────────
  console.log("\n④ تلميح ارسمها = نصف الحروف");
  ok(/function hintBudget/.test(srv), "دالة حساب نصيب التلميح موجودة");
  const hintBudget = (word) => {
    const n = word.replace(/ /g, "").length;
    if (n <= 1) return 0;
    return Math.max(1, Math.min(n - 1, Math.round(n / 2)));
  };
  // نتأكد أن الدالة في الخادم مطابقة نصّاً للمنطق المتوقع
  const m = srv.match(/function hintBudget[\s\S]*?\n\}/);
  ok(m && /Math\.round\(n \/ 2\)/.test(m[0]) && /Math\.min\(n - 1/.test(m[0]),
     "المنطق: round(n/2) مع إبقاء حرف مخفي");
  [["حرفان", "قط", 1], ["ثلاثة", "شمس", 2], ["أربعة", "كتاب", 2],
   ["خمسة", "مدرسة", 3], ["ستة", "طائرات", 3], ["سبعة", "كمبيوتر", 4]]
    .forEach(([lbl, w, exp]) => ok(hintBudget(w) === exp, `${lbl} (${w}) → ${hintBudget(w)} حرف`));

  // ───────────── ٥ · كيبورد القنبلة ─────────────
  console.log("\n⑤ كيبورد عربي في القنبلة");
  ok(/id="vkb"/.test(BOMB) && /id="kbBtn"/.test(BOMB), "اللوحة وزر التبديل موجودان");
  ok(/const KB_ROWS/.test(BOMB), "صفوف الحروف معرّفة");
  const rows = BOMB.match(/const KB_ROWS = \[([\s\S]*?)\];/);
  const letters = rows ? (rows[1].match(/"[^"]+"/g) || []).map(s => s.slice(1, -1)) : [];
  ok(letters.length >= 30, "عدد المفاتيح: " + letters.length);
  ["ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","ه","و","ي"]
    .forEach(ch => { if (!letters.includes(ch)) ok(false, "الحرف ناقص: " + ch); });
  ok(["ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","ه","و","ي"]
      .every(ch => letters.includes(ch)), "كل الحروف الـ٢٨ موجودة");
  ok(/i\.value \+= ch/.test(BOMB), "الإدراج في نهاية النص (يمنع انعكاس الحروف)");
  ok(/i\.readOnly = true/.test(BOMB), "كيبورد الجهاز لا يظهر مع اللوحة الداخلية");
  ok(/if \(kbOpen\) return;/.test(BOMB), "focusInput لا يستدعي كيبورد الجهاز");

  // ───────────── ٦ · سهم الدور ─────────────
  console.log("\n⑥ سهم يؤشر على صاحب الدور");
  ok(/\.turnArrow/.test(BOMB), "نمط السهم موجود");
  ok(/\.pl\.turn \.turnArrow, \.chip\.turn \.turnArrow/.test(BOMB), "يظهر لصاحب الدور فقط");
  ok((BOMB.match(/class="turnArrow"/g) || []).length >= 2, "السهم في الحلقة والشريط");
  ok(/@keyframes bob/.test(BOMB), "السهم متحرّك (يقفز)");

  // ───────────── ٧ · واجهة الجوال ─────────────
  console.log("\n⑦ ترتيب أعلى شاشة القنبلة في الجوال");
  ok(/id="plStrip"/.test(BOMB), "شريط اللاعبين الأفقي موجود");
  ok(/function renderStrip/.test(BOMB) && /renderStrip\(\);/.test(BOMB), "الشريط يُرسم مع كل تحديث");
  ok(/#ring \.pl \{ display:none; \}/.test(BOMB), "الأسماء الدائرية مخفية في الجوال (لا تداخل)");
  ok(/#plStrip \{ display:flex; \}/.test(BOMB), "الشريط يظهر في الجوال");
  ok(/scrollIntoView\(\{ inline:"center"/.test(BOMB), "صاحب الدور يُجلب داخل الشريط تلقائياً");
  ok(/overflow-x:auto/.test(BOMB), "الشريط يستغل العرض كاملاً بالتمرير");

  // ───────────── ٨ · السكرول مع الكيبورد ─────────────
  console.log("\n⑧ السكرول والمقطع مع الكيبورد المفتوح");
  ok(/--appH/.test(BOMB) && /visualViewport/.test(BOMB), "الارتفاع يتبع الشاشة المرئية");
  ok(/function fitApp/.test(BOMB), "دالة ضبط الارتفاع موجودة");
  ok(/#stage \{ overflow-y:auto; \}/.test(BOMB), "منطقة اللعب قابلة للتمرير في الجوال");
  ok(/id="sylPill"/.test(BOMB) && /id="pillSyl"/.test(BOMB), "شارة المقطع فوق مربع الكتابة");
  ok(/pillTime/.test(BOMB), "الوقت المتبقي يظهر في الشارة أيضاً");

  // ───────────── ٩ · رابط الدعوة ─────────────
  console.log("\n⑨ رابط دعوة يدخل الغرفة مباشرة");
  ok(/\/draw\?r="/.test(DRAW), "ارسمها: زر النسخ ينتج رابطاً كاملاً");
  ok(/inviteRoom/.test(DRAW), "ارسمها: تقرأ ?r= وتجهّز الدخول");
  ok(/\/bomb\?r=/.test(BOMB), "القنبلة: رابط الدعوة كامل");
  ok(/if \(myAccount\) doJoin/.test(BOMB), "القنبلة: المسجَّل يدخل بلا أي خطوة");
  ok(/\$\("joinBtn"\)\.click\(\)/.test(DRAW), "ارسمها: المسجَّل يدخل بلا أي خطوة");

  // ───────────── ١٠ · رابط الرجوع ─────────────
  console.log("\n⑩ رابط «رجوع لاختيار الألعاب» بارز");
  ok(/class="backLink"/.test(DRAW), "أُضيف في ارسمها (كان غير موجود)");
  ok(/\.backLink \{[\s\S]*?font-weight:900/.test(DRAW), "ارسمها: خط عريض");
  ok(/\.brand a\.back \{[\s\S]*?font-weight:900/.test(BOMB), "القنبلة: خط عريض");
  ok(/\.brand a\.back \{[\s\S]*?background:rgba/.test(BOMB), "القنبلة: خلفية تميّزه");
  ok(/\.logo \.back\{[\s\S]*?font-weight:900/.test(Q2), "قمّة الهرم: خط عريض");
  const bombBack = BOMB.match(/\.brand a\.back \{[\s\S]*?\}/)[0];
  ok(/font-size:15\.5px/.test(bombBack), "الحجم كُبِّر إلى 15.5px (كان 13.5px)");

  // ───────────── ١١ · لعبة الرسم لم تتأثر ─────────────
  console.log("\n⑪ سلامة لعبة الرسم");
  const d = await get("/draw");
  ok(d.code === 200 && /id="board"/.test(d.body), "لوحة الرسم موجودة");
  ok(/id="colorsSection"|colorsSection/.test(d.body), "قسم الألوان موجود");
  ok(/flex-direction:row/.test(d.body), "إصلاح ألوان الجوال باقٍ");
  ok(/id="vkb"/.test(d.body), "كيبورد الرسم العربي باقٍ");
  const h = await get("/");
  ok(h.code === 200 && /GAMES/.test(h.body), "البوابة تعمل");
  const b = await get("/bomb");
  ok(b.code === 200 && /io\("\/bomb"\)|namespace/.test(b.body) === true || b.code === 200, "صفحة القنبلة تعمل");

  console.log("\n══════════════════════════════════");
  console.log("  ✅ نجح: " + PASS + "    ❌ فشل: " + FAIL);
  console.log("══════════════════════════════════\n");
  process.exit(FAIL ? 1 : 0);
}, 1200);
