/* 🏠 قوائم بالوت — الشاشات والحساب والإعدادات.
 *
 * البنية نفسها التي في «اونو»: بطاقةُ لاعبٍ أعلى اليسار، شريطُ أيقونات
 * أعلى اليمين، وبلاطاتٌ في الوسط. أمّا الستايل فمارشميلو: ألوانٌ باستيل
 * وحوافُّ منتفخة وأيقوناتٌ مستديرة — وهو ما طلبه صاحب الموقع للواجهة
 * والأيقونات دون الأوراق، فالأوراق تبقى كلاسيكيّةً تُقرأ من بعيد.
 *
 * والمحلّيّ هنا ليس محرّكًا في المتصفّح: هو طاولةٌ على الخادم يملؤها ثلاثة
 * بوتات. وهذا مقصود — محرّكان (واحدٌ في المتصفّح وآخر على الخادم) يعنيان
 * قاعدتين تتباعدان مع الوقت، وخلافًا بين ما تراه محلّيًّا وما يحدث أونلاين.
 */

"use strict";

/* ── إعداداتٌ محلّيّة (الصوت وحده الآن) ── */
const SET = { sound: true };
try { Object.assign(SET, JSON.parse(localStorage.getItem("bl-set") || "{}")); } catch (e) {}
const saveSet = () => { try { localStorage.setItem("bl-set", JSON.stringify(SET)); } catch (e) {} };

/* ── ملفّ اللاعب ── */
const P = { name: "لاعب", avatar: "Adult_1", frame: "Classic", coins: 0, xp: 0, level: 1, guest: true };

const ACC = {
  async load() {
    try {
      const r = await fetch("/api/shop/mine?game=uno", { credentials: "same-origin" });
      const j = await r.json();
      if (!j.ok || j.guest) return false;
      P.guest = false;
      P.coins = (j.wallet || {}).gold || 0;
      const lo = j.loadout || {};
      if (lo.avatars) P.avatar = lo.avatars;
      if (lo.frames) P.frame = lo.frames;
      return true;
    } catch (e) { return false; }
  },
  async me() {
    try {
      const r = await fetch("/api/account/me", { credentials: "same-origin" });
      const j = await r.json();
      if (!j || !j.ok || j.guest) return;
      P.guest = false;
      P.name = j.displayName || j.login || P.name;
      if (j.avatar) P.avatar = j.avatar;
      if (j.frame) P.frame = j.frame;
      const s = j.stats || {};
      P.xp = s.xp || 0;
      P.level = s.level || 1;
    } catch (e) {}
  }
};

/* ══════════ الشاشات ══════════ */
let curScreen = "main";
const SCREENS = {
  main: "#main", online: "#scr-online", room: "#scr-room", rules: "#scr-rules",
  options: "#scr-options", leader: "#scr-leader", profile: "#scr-profile", bet: "#scr-bet"
};
function openScreen(name) {
  snd("click");
  curScreen = name;
  $("#board").classList.remove("show");
  Object.values(SCREENS).forEach(s => $(s) && $(s).classList.remove("show"));
  const el = $(SCREENS[name]);
  if (el) el.classList.add("show");
  if (name === "main") renderMain();
  if (name === "rules") renderRules();
  if (name === "options") renderOptions();
  if (name === "leader") renderLeader();
  if (name === "profile") renderProfile();
  if (name === "online") renderOnlineMe();
  if (name === "bet") renderBet();
}
function showBoard() {
  Object.values(SCREENS).forEach(s => $(s) && $(s).classList.remove("show"));
  $("#board").classList.add("show");
  curScreen = "board";
}
function toMenu() {
  $("#ov-end").classList.remove("show");
  $("#ov-hand").classList.remove("show");
  openScreen("main");
}

function renderMain() {
  $("#pc-name").textContent = P.name;
  $("#pc-coins").textContent = P.guest ? "—" : P.coins;
  $("#pc-av").src = avSrc(P.avatar);
  const fr = $("#pc-fr");
  fr.src = frSrc(P.frame); fr.style.display = P.frame ? "" : "none";
  $("#pc-lvl").textContent = P.level;
  const l = P.level - 1, a = l * l * 100, b = (l + 1) * (l + 1) * 100;
  $("#pc-xp").style.width = Math.max(0, Math.min(100, ((P.xp - a) / (b - a)) * 100)) + "%";
  fitFrames($("#pcard"));
}

/* ══════════ القواعد ══════════ */
function renderRules() {
  $("#rules-body").innerHTML = `
  <p><b>بالوت</b> أربعةُ لاعبين، فريقان: أنت وشريكُك المقابل ضدّ الاثنين على جانبيك.
  والصكّة تنتهي عند <b>١٥٢ بنطًا</b> (يمكن تغييرها من إعدادات الطاولة).</p>

  <h3 style="margin:16px 0 6px">التوزيع والشراء</h3>
  <p>تُوزَّع <b>٣ ثمّ ٢</b> عكس عقارب الساعة، وتُكشَف <b>ورقة الشراء</b> في الوسط. ثمّ تدور
  <b>لفّتان</b>:</p>
  <ul style="margin-inline-start:22px">
    <li><b>صنّ</b> — لا حكم، والأكة أعلى ورقة.</li>
    <li><b>حكم</b> — نوع ورقة الشراء يصير سيّدًا: الولد ثمّ التسعة فوق كلّ شيء.</li>
    <li><b>أشكل</b> — لأوّل لاعبٍ وحده: يترك الشراء لشريكه بنوع الورقة المكشوفة.</li>
    <li><b>بس</b> — تمرير. فإن مرّ الجميع لفّتين أُعيد التوزيع.</li>
  </ul>
  <p>وفي اللفّة الأولى <b>الصنّ يعلو الحكم</b>. وبعد الحسم يأخذ الشاري ورقة الشراء
  ويُكمَل التوزيع: الشاري ورقتان والباقي ثلاث — فتصير الأيدي ثمانيًا.</p>

  <h3 style="margin:16px 0 6px">القيَم</h3>
  <table class="sc"><tr><th></th><th>A</th><th>10</th><th>K</th><th>Q</th><th>J</th><th>9</th></tr>
  <tr><td><b>صنّ</b></td><td>١١</td><td>١٠</td><td>٤</td><td>٣</td><td>٢</td><td>٠</td></tr>
  <tr><td><b>حكم (نوعه)</b></td><td>١١</td><td>١٠</td><td>٤</td><td>٣</td><td><b>٢٠</b></td><td><b>١٤</b></td></tr></table>
  <p>وآخر أكلةٍ فيها <b>١٠ زائدة</b>.</p>

  <h3 style="margin:16px 0 6px">اللعب</h3>
  <p>اتّباع النوع واجب. فإن عجزتَ في الحكم وجب أن تقطع، إلا أن يكون <b>شريكُك آخذَ الأكلة</b>.
  وإن سبقك قاطعٌ وجب أن تعلوه، فإن لم تستطع فأنت حُرّ.</p>

  <h3 style="margin:16px 0 6px">المشاريع</h3>
  <p>تُعلَن في <b>الأكلة الأولى</b> وحدها، والأعلى مشروعًا يأخذ فريقُه مشاريعَه كلَّها
  وتسقط مشاريع الخصم:</p>
  <ul style="margin-inline-start:22px">
    <li><b>سرا</b> ٣ متتالية = ٢٠ · <b>خمسين</b> ٤ = ٥٠ · <b>مية</b> ٥ = ١٠٠</li>
    <li><b>مية</b> أربعُ متشابهاتٍ (شايب/بنت/ولد/عشرة) · <b>أربعمية</b> أربع أكَكٍ في الصنّ = ٢٠٠</li>
    <li><b>بلوت</b> شايبُ الحكم وبنتُه = ٢٠، ويُعلَن عند لعب إحداهما.</li>
  </ul>

  <h3 style="margin:16px 0 6px">المضاعفة والكبوت والقهوة</h3>
  <p>في الحكم يجوز للخصم <b>دبل</b>، فيردّ الشاري <b>ثري</b> ثمّ <b>فور</b> — والفائز يأخذ الكلّ مضروبًا.
  ومن أخذ الأكلات الثماني فله <b>الكبوت</b> (٤٤ صنًّا · ٢٥ حكمًا).
  ومن بلغ فريقُه مئةً فله أن يقول <b>قهوة</b>: يربح الصكّة كلَّها أو يخسرها.</p>`;
}

/* ══════════ الخيارات ══════════ */
function renderOptions() {
  const b = $("#opt-body");
  b.innerHTML = `
    <div class="row"><div class="lbl">الصوت<small>نغماتُ التوزيع واللعب والفوز</small></div>
      <div class="sw ${SET.sound ? "on" : ""}" id="sw-sound"></div></div>
    <div class="row"><div class="lbl">ملء الشاشة<small>أفضل تجربةٍ على الجوّال</small></div>
      <button class="btn sm b" id="opt-fs">⛶ ملء الشاشة</button></div>
    <div class="row"><div class="lbl">حسابي<small>${P.guest ? "تلعب كضيف — الضيوف لا يكسبون ذهبًا" : esc(P.name)}</small></div>
      <button class="btn sm k" onclick="location.href='/me'">${P.guest ? "سجّل الآن" : "ملفّي"}</button></div>`;
  $("#sw-sound").onclick = e => { SET.sound = !SET.sound; saveSet(); e.currentTarget.classList.toggle("on", SET.sound); snd("click"); };
  $("#opt-fs").onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    try { await screen.orientation.lock("landscape"); } catch (e) {}
    setTimeout(fitStage, 400);
  };
}

/* ══════════ المتصدرون ══════════ */
function renderLeader() {
  /* لوحةُ المتصدّرين والدوري الأسبوعيّ مرحلةٌ قادمة — ولا نعرض جدولًا فارغًا
     يوهم اللاعب أنّ شيئًا تعطّل. إحصاءاتُه الشخصيّة متاحةٌ الآن في صفحة حسابه. */
  $("#lead-body").innerHTML =
    `<p style="text-align:center;color:var(--ink2);font-weight:700;line-height:1.9">
       ترتيبُ بالوت والدوري الأسبوعيّ في الطريق.<br>
       أمّا مبارياتُك وفوزُك فمحفوظةٌ من الآن — تجدها في صفحة حسابك.</p>
     <div style="text-align:center;margin-top:14px">
       <button class="btn b" onclick="location.href='/me'">👤 إحصاءاتي</button></div>`;
}

/* ══════════ البروفايل ══════════ */
function renderProfile() {
  $("#prof-body").innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;justify-content:center;margin-bottom:18px">
      <div class="avw" style="position:relative;width:120px;height:120px">
        <div class="av" style="position:absolute;inset:0;border-radius:26px;overflow:hidden;box-shadow:inset 0 0 0 5px #fff">
          <img src="${avSrc(P.avatar)}" style="width:100%;height:100%;object-fit:cover"></div>
        <img class="fr" src="${frSrc(P.frame)}" style="position:absolute;inset:0;width:100%;height:100%;${P.frame ? "" : "display:none"}">
      </div>
      <div><div style="font-size:26px;font-weight:900">${esc(P.name)}</div>
        <div style="color:var(--ink2);font-weight:800">المستوى ${P.level} · ${P.guest ? "ضيف" : P.coins + " ذهبًا"}</div></div>
    </div>
    <p style="text-align:center;color:var(--ink2);font-weight:700">الصورة والبرواز يُختاران من المتجر — وهما مشتركان بين ألعاب الموقع كلِّها.</p>
    <div style="text-align:center;margin-top:14px">
      <button class="btn b" onclick="location.href='/shop'">🛍️ المتجر</button>
      <button class="btn k" onclick="location.href='/me'">👤 حسابي</button></div>`;
  fitFrames($("#prof-body"));
}

/* ══════════ الإقلاع ══════════ */
async function boot() {
  document.body.classList.toggle("mobile",
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    ("ontouchstart" in window && window.innerWidth < 1300));
  fitStage();
  $("#fsbtn").onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    try { await screen.orientation.lock("landscape"); } catch (e) {}
    setTimeout(fitStage, 400);
  };
  await ACC.me();
  await ACC.load();
  renderMain();

  /* دعوةٌ برابط: /baloot/?r=ABCD تدخل الطاولة مباشرة */
  const code = new URLSearchParams(location.search).get("r");
  if (code && /^[A-Za-z0-9]{4}$/.test(code)) {
    openScreen("online");
    $("#ol-code").value = code.toUpperCase();
    setTimeout(() => olJoin(), 300);
  }
}
