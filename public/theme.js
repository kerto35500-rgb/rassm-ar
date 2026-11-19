/* 🍡 ستايل الموقع — «كاواي مارشميلو» هو الستايل الوحيد والافتراضي.
   لم يعد هناك مبدّل ستايلات: الملف يضع body.theme-kawaii فوراً
   ثم يضيف صنف اللعبة الحالية (بوابة / رسم / سالفة / قنبلة / هرم)
   حتى يأخذ كل لعبة لونها الخاص من kawaii.css. */
(function () {
  "use strict";

  /* نضعه في أسرع لحظة ممكنة لتفادي ومضة الستايل القديم */
  function markBody() {
    if (document.body) { document.body.classList.add("theme-kawaii"); return true; }
    return false;
  }
  markBody();

  /* خربشات الخلفية العائمة: أدوات رسم — قلم، باليتة ألوان، فرشاة (SVG مرسومة في CSS) */
  var DOODLES = ["kw-pencil", "kw-palette", "kw-brush", "kw-pencil", "kw-palette", "kw-pencil",
                 "kw-brush", "kw-palette", "kw-pencil", "kw-brush", "kw-pencil", "kw-palette",
                 "kw-pencil", "kw-brush", "kw-palette", "kw-pencil"];
  function doodleLayer() {
    if (document.querySelector(".kw-doodles")) return;
    var d = document.createElement("div");
    d.className = "kw-doodles";
    d.setAttribute("aria-hidden", "true");
    for (var i = 0; i < DOODLES.length; i++) {
      var s = document.createElement("span");
      s.className = DOODLES[i];
      s.style.left = ((i * 61 + 5) % 94) + "%";
      s.style.top = ((i * 37 + 9) % 92) + "%";
      s.style.animationDelay = (-(i * 0.8) % 6) + "s";
      /* أحجام متنوعة (لا نستخدم transform حتى لا يتعارض مع حركة الطفو) */
      var base = DOODLES[i] === "kw-pencil" ? [110, 64] : DOODLES[i] === "kw-palette" ? [44, 44] : [40, 40];
      var sc = 0.7 + ((i * 13) % 7) / 10;
      s.style.width = Math.round(base[0] * sc) + "px";
      s.style.height = Math.round(base[1] * sc) + "px";
      d.appendChild(s);
    }
    document.body.appendChild(d);
  }

  /* خط عربي مدوّر للستايل — يُحمَّل مرة واحدة */
  function ensureFont() {
    if (document.getElementById("kwFont")) return;
    var l = document.createElement("link");
    l.id = "kwFont"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@500;700;800&display=swap";
    document.head.appendChild(l);
  }

  function apply() {
    markBody();
    var b = document.body.classList;
    /* الصفحة الرئيسية (البوابة): فيها #grid ولا يوجد بها مشهد الهرم
       (البطاقات .g تُبنى لاحقاً بالجافاسكربت فلا نعتمد عليها) */
    b.toggle("kw-hub", !!document.getElementById("grid") && !document.getElementById("pyScene"));
    /* برّا السالفة: نسخة خضراء (تُميَّز بوجود شاشة الدخول الخاصة بها) */
    b.toggle("kw-salfa", !!document.getElementById("joinScreen"));
    /* لودو: هيكلُها هيكلُ السالفة نفسه (فتلبس قواعدها كلَّها: اللوبي والإعدادات
       والدردشة) — ويُضاف فوقه لونُها الفيروزيّ. تُميَّز بلوحتها */
    b.toggle("kw-ludo", !!document.getElementById("ludoBoard"));
    /* كلمة واحدة فقط: الهيكلُ نفسه، ولونُها عبّاد الشمس. تُميَّز بمسرحها */
    b.toggle("kw-justone", !!document.getElementById("joStage"));
    /* فكّ الشفرة: الهيكلُ نفسه، ولونُها برقوقيّ بين الفريقين. تُميَّز بتبويبتيها */
    b.toggle("kw-decrypto", !!document.getElementById("dcTabs"));
    /* البسكويتة الحارّة: الهيكلُ نفسه، ولونُها خوخيٌّ فلفليّ. تُميَّز بطاولتها */
    b.toggle("kw-spicy", !!document.getElementById("spTable"));
    /* التخاطر: الهيكلُ نفسه، ولونُها نعناعيٌّ سماويّ. تُميَّز بعدّادها */
    b.toggle("kw-wave", !!document.getElementById("wvGauge"));
    /* رسالة حب: الهيكلُ نفسه، ولونُها ورديٌّ مخمليّ. تُميَّز بطاولتها */
    b.toggle("kw-love", !!document.getElementById("llTable"));
    /* القنبلة: نسخة برتقالية */
    b.toggle("kw-bomb", !!document.getElementById("bombCircle"));
    /* قمّة الهرم: نسخة بنفسجية (تُميَّز بمشهد الهرم) */
    b.toggle("kw-quiz", !!document.getElementById("pyScene"));
    ensureFont();
    doodleLayer();
  }

  /* شاشةُ دخول اللعبة (فيها #whoLine): للضيف رابطٌ يفتح نافذةَ الحساب في الرئيسيّة
     — دخولٌ أو حسابٌ جديد — ثمّ يرجعه إلى اللعبة نفسها (برمز الدعوة إن كان). */
  function accountHint() {
    var who = document.getElementById("whoLine");
    if (!who || document.getElementById("kwAccLink") || document.getElementById("grid") || typeof fetch !== "function") return;
    fetch("/api/account/me", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.guest || document.getElementById("kwAccLink")) return;
      var a = document.createElement("a");
      a.id = "kwAccLink";
      a.href = "/?acc=reg&back=" + encodeURIComponent(location.pathname + location.search);
      a.textContent = "🔑 سجّل دخولك أو أنشئ حسابًا — تُحفظ نتائجك وفوزك";
      a.style.cssText = "display:block;text-align:center;font-size:13px;font-weight:800;margin:2px 0 8px;" +
        "padding:7px 10px;border-radius:12px;background:rgba(255,255,255,.55);border:2px dashed rgba(122,74,56,.35);" +
        "color:#7A4A38;text-decoration:none";
      who.parentNode.insertBefore(a, who.nextSibling);
    }).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(); accountHint(); });
  else { apply(); accountHint(); }
})();
