// اختبار مسارات الخادم + التأكد أن لعبة الرسم لم تتأثر
const http = require("http");
require("./server");

const PORT = process.env.PORT || 3000;
let PASS = 0, FAIL = 0;
const ok = (c, l, x) => { c ? (PASS++, console.log("  ✅ " + l)) : (FAIL++, console.log("  ❌ " + l + (x ? " → " + x : ""))); };

function get(p) {
  return new Promise(res => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: p, timeout: 5000 }, r => {
      let b = "";
      r.on("data", d => b += d);
      r.on("end", () => res({ code: r.statusCode, body: b }));
    });
    req.on("error", e => res({ code: 0, body: "", err: e.message }));
    req.on("timeout", () => { req.destroy(); res({ code: 0, body: "" }); });
  });
}

setTimeout(async () => {
  console.log("\n═══ اختبار الخادم والمسارات ═══\n");

  console.log("① المسارات ترد بنجاح");
  for (const p of ["/", "/draw", "/rassm", "/bomb", "/qunbula", "/healthz"]) {
    const r = await get(p);
    ok(r.code === 200, `${p} → ${r.code} (${r.body.length} حرف)`, r.err);
  }

  console.log("\n② الصفحة الرئيسية = اختيار اللعبتين");
  const hub = (await get("/")).body;
  // البوابة تبني البطاقات من مصفوفة GAMES، فالرابط يظهر كقيمة href داخل السكربت
  ok(/href\s*[:=]\s*"\/draw"/.test(hub), "فيها رابط لعبة الرسم");
  ok(/href\s*[:=]\s*"\/bomb"/.test(hub), "فيها رابط لعبة القنبلة");
  ok(/ارسمها!/.test(hub) && /القنبلة/.test(hub), "تعرض اسمي اللعبتين");

  console.log("\n③ لعبة الرسم لم تتأثر إطلاقاً");
  const draw = (await get("/draw")).body;
  ok(/id="board"/.test(draw), "لوحة الرسم موجودة");
  ok(/id="colors"/.test(draw), "لوحة الألوان موجودة");
  ok(/flex-direction:row/.test(draw), "إصلاح ألوان الجوال ما زال موجوداً");
  ok(/id="lobbyScreen"/.test(draw) && /id="gameScreen"/.test(draw), "شاشات اللعبة سليمة");
  ok(draw.length > 60000, `حجم الملف طبيعي (${draw.length} حرف)`);

  console.log("\n④ صفحة لعبة القنبلة");
  const bomb = (await get("/bomb")).body;
  ok(/id="wordInput"/.test(bomb), "مربع إدخال الكلمة موجود");
  ok(/id="alphaGrid"/.test(bomb), "لوحة الحروف الأبجدية موجودة");
  ok(/id="setModal"/.test(bomb), "نافذة إعدادات المضيف موجودة");
  ok(/io\("\/bomb"/.test(bomb), "يتصل بـ namespace المستقل /bomb");
  ok(/visualViewport/.test(bomb), "حماية مساحة الرؤية للجوال مفعّلة");

  console.log("\n⑤ socket.io يخدم اللعبتين");
  const sio = await get("/socket.io/socket.io.js");
  ok(sio.code === 200 && sio.body.length > 1000, "ملف socket.io يُخدم");

  console.log("\n" + "═".repeat(34));
  console.log(`  ✅ نجح: ${PASS}    ❌ فشل: ${FAIL}`);
  console.log("═".repeat(34) + "\n");
  process.exit(FAIL ? 1 : 0);
}, 3500);
