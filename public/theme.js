/* 🎨 مدير الستايلات — يبدّل بين الثيمات ويحفظ الاختيار.
   الثيم الأصلي هو الافتراضي دائماً؛ الثيمات الإضافية طبقة فوقه فقط.
   لإضافة ستايل جديد: أضف عنصراً في THEMES وملف CSS مفعّلاً بـ body.theme-<id>. */
(function () {
  "use strict";

  var THEMES = [
    { id: "classic", name: "الأصلي", icon: "🌊" },
    { id: "kawaii",  name: "كاواي مارشميلو", icon: "🍡" }
  ];
  var KEY = "gameTheme";

  function current() {
    try {
      var t = localStorage.getItem(KEY);
      return THEMES.some(function (x) { return x.id === t; }) ? t : "classic";
    } catch (e) { return "classic"; }
  }

  /* خربشات الخلفية العائمة: أدوات رسم — قلم، باليتة ألوان، فرشاة (SVG مرسومة في CSS) */
  var DOODLES = ["kw-pencil", "kw-palette", "kw-brush", "kw-pencil", "kw-palette", "kw-pencil",
                 "kw-brush", "kw-palette", "kw-pencil", "kw-brush", "kw-pencil", "kw-palette",
                 "kw-pencil", "kw-brush", "kw-palette", "kw-pencil"];
  function doodleLayer(on) {
    var old = document.querySelector(".kw-doodles");
    if (!on) { if (old) old.remove(); return; }
    if (old) return;
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

  /* خط عربي مدوّر للثيم الكاواي — يُحمَّل مرة واحدة عند الحاجة */
  function ensureFont() {
    if (document.getElementById("kwFont")) return;
    var l = document.createElement("link");
    l.id = "kwFont"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@500;700;800&display=swap";
    document.head.appendChild(l);
  }

  function apply(id) {
    THEMES.forEach(function (t) {
      if (t.id !== "classic") document.body.classList.toggle("theme-" + t.id, id === t.id);
    });
    /* الصفحة الرئيسية (البوابة): فيها #grid ولا يوجد بها مشهد الهرم
       (البطاقات .g تُبنى لاحقاً بالجافاسكربت فلا نعتمد عليها) */
    document.body.classList.toggle("kw-hub", id === "kawaii" &&
      !!document.getElementById("grid") && !document.getElementById("pyScene"));
    /* برّا السالفة: نسخة خضراء من المارشميلو (تُميَّز بوجود شاشة الدخول الخاصة بها) */
    document.body.classList.toggle("kw-salfa", id === "kawaii" && !!document.getElementById("joinScreen"));
    /* القنبلة: نسخة برتقالية */
    document.body.classList.toggle("kw-bomb", id === "kawaii" && !!document.getElementById("bombCircle"));
    /* قمّة الهرم: نسخة بنفسجية (تُميَّز بمشهد الهرم) */
    document.body.classList.toggle("kw-quiz", id === "kawaii" && !!document.getElementById("pyScene"));
    if (id === "kawaii") ensureFont();
    doodleLayer(id === "kawaii");
    var pop = document.getElementById("kwThemePop");
    if (pop) {
      pop.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("on", b.dataset.theme === id);
      });
    }
  }

  function save(id) {
    try { localStorage.setItem(KEY, id); } catch (e) {}
    apply(id);
  }

  function buildUI() {
    if (document.getElementById("kwThemeBtn")) return;
    var btn = document.createElement("button");
    btn.id = "kwThemeBtn"; btn.title = "تغيير الستايل"; btn.textContent = "🎨";
    btn.setAttribute("aria-label", "تغيير الستايل");

    var pop = document.createElement("div");
    pop.id = "kwThemePop";
    pop.innerHTML = "<h4>ستايل الموقع</h4>";
    THEMES.forEach(function (t) {
      var b = document.createElement("button");
      b.dataset.theme = t.id;
      b.textContent = t.icon + " " + t.name;
      b.onclick = function (e) { e.stopPropagation(); save(t.id); };
      pop.appendChild(b);
    });

    function toggle(anchorStart) {
      pop.style.insetInlineEnd = anchorStart ? "auto" : "12px";
      pop.style.insetInlineStart = anchorStart ? "12px" : "auto";
      pop.classList.toggle("on");
    }
    btn.onclick = function (e) { e.stopPropagation(); toggle(false); };

    /* داخل لعبة الرسم: زر إضافي في الشريط العلوي (الزر العائم يختفي أثناء اللعب) */
    var tb = document.getElementById("tbLeft");
    var topBtn = null;
    if (tb) {
      topBtn = document.createElement("button");
      topBtn.id = "kwThemeBtnTop"; topBtn.title = "تغيير الستايل"; topBtn.textContent = "🎨";
      topBtn.onclick = function (e) { e.stopPropagation(); toggle(true); };
      tb.appendChild(topBtn);
    }

    document.addEventListener("click", function (e) {
      if (!pop.contains(e.target) && e.target !== btn && e.target !== topBtn) pop.classList.remove("on");
    });

    document.body.appendChild(btn);
    document.body.appendChild(pop);
  }

  function init() {
    buildUI();
    apply(current());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
