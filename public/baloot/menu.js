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
async function renderLeader() {
  const b = $("#lead-body");
  b.innerHTML = '<p style="text-align:center;color:var(--ink2)">جارٍ التحميل…</p>';
  let d;
  try { d = await (await fetch("/api/league", { credentials: "same-origin" })).json(); }
  catch (e) { d = null; }
  if (!d || !d.ok) { b.innerHTML = '<p style="text-align:center;color:var(--ink2)">تعذّر التحميل</p>'; return; }
  if (!d.open) {
    b.innerHTML = '<p style="text-align:center;color:var(--ink2);font-weight:700">الدوري موقوفٌ حاليًّا</p>';
    return;
  }
  const row = (u, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
    const prize = d.prizes[i] ? ` <small style="color:#c9821a">+${d.prizes[i]}</small>` : "";
    const short = u.games < d.minGames
      ? ' <small style="color:var(--ink2)">(لم يكمل الحدّ الأدنى)</small>' : "";
    return `<tr><td>${medal}</td><td>${esc(u.name)}${short}</td>` +
           `<td><b>${u.points}</b>${prize}</td><td>${u.wins}/${u.games}</td></tr>`;
  };
  b.innerHTML =
    `<p class="sub">أسبوع ${d.week} · الفوز ${d.points.win} نقاط والمشاركة ${d.points.play} ·
       الجوائز تُصرَف تلقائيًّا مع بداية الأسبوع التالي لمن أكمل ${d.minGames} مباريات</p>` +
    (d.justPaid ? `<div style="background:linear-gradient(#fff,var(--lemon));border-radius:20px;
        padding:10px;text-align:center;font-weight:900;margin-bottom:10px">
        🎉 صُرفت جوائز الأسبوع الماضي: ${d.justPaid.map(p => esc(p.name) + " +" + p.amount).join(" · ")}</div>` : "") +
    (d.top.length
      ? '<table class="sc"><tr><th>#</th><th>اللاعب</th><th>نقاط</th><th>فوز/لعب</th></tr>' +
        d.top.map(row).join("") + "</table>"
      : '<p style="text-align:center;color:var(--ink2);font-weight:700">لا مباريات هذا الأسبوع بعد — كن أوّل المتصدّرين 🂡</p>') +
    (d.me
      ? `<p style="text-align:center;font-weight:900;margin-top:8px">ترتيبك ${d.me.rank} من ${d.me.of} ·
           ${d.me.points} نقطة · ${d.me.wins}/${d.me.games}</p>`
      : '<p style="text-align:center;color:var(--ink2);font-weight:700;margin-top:8px">' +
        "الْعب مباراةً أونلاين بلا بوتات لتدخل الدوري</p>") +
    (d.lastTop.length
      ? '<div style="margin-top:14px"><b>أبطال الأسبوع الماضي</b><table class="sc">' +
        d.lastTop.map(row).join("") + "</table></div>"
      : "");
}

/* ── الجائزة اليوميّة ──
   تظهر كفقاعةٍ فوق بطاقة اللاعب حين تكون متاحة. لا نافذةَ تقفز في وجهه
   عند كلّ دخول — من أرادها ضغطها. */
async function loadDaily() {
  if (P.guest) return;
  let d;
  try { d = await (await fetch("/api/daily", { credentials: "same-origin" })).json(); }
  catch (e) { return; }
  const el = $("#daily");
  if (!el) return;
  if (!d || !d.ok || !d.open || d.taken) { el.classList.remove("show"); return; }
  el.innerHTML = `🎁 هديّة اليوم <b>+${d.amount}</b>` +
    (d.streak ? `<small>سلسلة ${d.streak} ${d.streak === 1 ? "يوم" : "أيّام"}</small>` : "");
  el.onclick = claimDaily;
  el.classList.add("show");
}
async function claimDaily() {
  snd("click");
  const el = $("#daily");
  el.classList.remove("show");
  try {
    const r = await (await fetch("/api/daily/claim", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}"
    })).json();
    if (!r.ok) return toast(r.error || "تعذّر الاستلام");
    P.coins = (r.wallet && r.wallet.gold) != null ? r.wallet.gold : P.coins + r.amount;
    renderMain();
    banner("+" + r.amount, "هديّة اليوم · سلسلة " + r.streak, 1800);
    snd("win");
  } catch (e) { toast("تعذّر الاتّصال"); }
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
  loadDaily();

  /* دعوةٌ برابط: /baloot/?r=ABCD تدخل الطاولة مباشرة */
  const code = new URLSearchParams(location.search).get("r");
  if (code && /^[A-Za-z0-9]{4}$/.test(code)) {
    openScreen("online");
    $("#ol-code").value = code.toUpperCase();
    setTimeout(() => olJoin(), 300);
  }
}
