// اختبار مسارات المتجر حيّةً: التصفّح كضيف، ثم التسجيل والشراء والتجهيز.
// يشغّل الخادم كاملًا على قاعدة db.json مؤقّتة، فما يُختبَر هو ما يُنشَر.
const http = require("http"), fs = require("fs"), path = require("path");

process.env.PORT = process.env.PORT || "3711";
require("./server");

/* اسمٌ فريدٌ لكل تشغيلة: الخادم يعمل على db.json نفسه الذي يعمل عليه
   التطوير، فلو ثبّتنا الاسم فشل التشغيل الثاني بـ«الاسم محجوز». */
const WHO = "زبون" + Date.now().toString(36);

const PORT = +process.env.PORT;
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

let COOKIE = "";
function req(method, p, body) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: "127.0.0.1", port: PORT, path: p, method, timeout: 8000,
      headers: Object.assign({ Cookie: COOKIE }, data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {})
    }, x => {
      let b = "";
      x.on("data", d => b += d);
      x.on("end", () => {
        const sc = x.headers["set-cookie"];
        if (sc) COOKIE = sc.map(s => s.split(";")[0]).join("; ");
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ code: x.statusCode, json: j, body: b });
      });
    });
    r.on("error", e => res({ code: 0, err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0 }); });
    if (data) r.write(data);
    r.end();
  });
}
const get = p => req("GET", p);
const post = (p, b) => req("POST", p, b);

setTimeout(async () => {
  console.log("\n═══ المتجر عبر الشبكة ═══\n");

  console.log("① الصفحة والكتالوج للضيف");
  let r = await get("/shop");
  ok(r.code === 200 && /sh-wrap/.test(r.body), "‎/shop‎ تُقدَّم", r.code);
  ok(!/class="card"|class="btn"/.test(r.body), "لا أصنافَ عامّة تصطدم بـkawaii.css");

  r = await get("/api/shop/catalog");
  ok(r.code === 200 && r.json.ok, "الكتالوج يُفتَح بلا حساب", r.code);
  ok(r.json.guest === true, "ويعرف أننا ضيوف");
  ok(r.json.items.length > 150, `يعرض ${r.json.items && r.json.items.length} عنصرًا`);
  ok(r.json.items.every(i => i.price !== undefined && !("active" in i)), "لا يُسرّب حقولًا داخلية");
  ok(!!r.json.sections.uno, "أقسامُ الألعاب مرفقة");
  const paid = r.json.items.find(i => i.price > 0 && i.kind === "frames");
  const freeItem = r.json.items.find(i => i.price === 0);
  ok(freeItem && freeItem.owned === true, "المجّانيّ مملوكٌ للجميع");

  console.log("\n② الضيف لا يشتري");
  r = await post("/api/shop/buy", { id: paid.id });
  ok(r.code === 401, "الشراء بلا حساب مرفوض ٤٠١", r.code);
  r = await post("/api/shop/equip", { id: paid.id });
  ok(r.code === 401, "والتجهيز كذلك", r.code);

  console.log("\n③ التسجيل وهديّة الترحيب");
  r = await post("/api/account/register", { name: WHO, pass: "كلمة سرّ طويلة" });
  ok(r.code === 200 && r.json.ok, "أُنشئ الحساب", r.json);
  r = await get("/api/shop/catalog");
  ok(r.json.ok && !r.json.guest, "الكتالوج يعرفنا الآن");
  ok(r.json.wallet.gold === 500, "وصلت هديّة الترحيب ٥٠٠", r.json.wallet);
  r = await get("/api/shop/catalog");
  ok(r.json.wallet.gold === 500, "ولا تتكرّر مع كل زيارة", r.json.wallet);

  console.log("\n④ الشراء");
  r = await post("/api/shop/buy", { id: paid.id });
  ok(r.code === 400 && /لا يكفي/.test(r.json.error || ""), "غالي على رصيدنا", r.json);

  const cheap = (await get("/api/shop/catalog")).json.items
    .filter(i => i.price > 0 && i.price <= 500).sort((a, b) => a.price - b.price)[0];
  ok(!!cheap, "الهديّة تكفي لعنصرٍ حقيقيّ — لا رصيدَ للفرجة", cheap && cheap.price);
  r = await post("/api/shop/buy", { id: cheap.id });
  if (!cheap) { ok(false, "تخطّينا الشراء"); }
  else {
    ok(r.code === 200 && r.json.ok, "اشترينا", r.json);
    ok(r.json.wallet.gold === 500 - cheap.price, "خُصم السعر", r.json.wallet);
    r = await post("/api/shop/buy", { id: cheap.id });
    ok(r.code === 409, "الشراء مرّتين ٤٠٩", r.code);

    console.log("\n⑤ التجهيز والمخزون");
    r = await post("/api/shop/equip", { id: cheap.id });
    ok(r.code === 200 && r.json.key === cheap.key, "جُهِّز", r.json);
    r = await get("/api/shop/mine?game=uno");
    ok(r.json.owned.includes(cheap.id), "يظهر في مخزون اللعبة", r.json.owned);
    ok(r.json.loadout[cheap.kind] === cheap.key, "والتجهيز مقروءٌ من اللعبة", r.json.loadout);
    r = await get("/api/shop/catalog");
    ok(r.json.items.find(i => i.id === cheap.id).owned === true, "والكتالوج يعلّمه مملوكًا");
  }

  console.log("\n⑥ ما لا يجوز");
  r = await post("/api/shop/buy", { id: "uno:frames:لا-يوجد" });
  ok(r.code === 404, "عنصرٌ وهميّ ٤٠٤", r.code);
  r = await post("/api/shop/equip", { id: paid.id });
  ok(r.code === 403, "تجهيز ما لا نملك ٤٠٣", r.code);
  const before = (await get("/api/shop/catalog")).json.wallet.gold;
  r = await post("/api/shop/buy", { id: paid.id, price: 1 });
  ok(r.code === 400, "سعرٌ من العميل لا يُقبَل", r.code);
  ok((await get("/api/shop/catalog")).json.wallet.gold === before, "والرصيد لم يمسّه أحد");

  console.log("\n⑦ جائزة «وحدة» المنفردة");
  const g0 = (await get("/api/shop/catalog")).json.wallet.gold;
  r = await post("/api/uno/solo", { rank: 0 });
  ok(r.json.ok && r.json.amount === 20, "المركز الأوّل ٢٠ ذهبًا", r.json);
  ok((await get("/api/shop/catalog")).json.wallet.gold === g0 + 20, "وصلت المحفظة");
  r = await post("/api/uno/solo", { rank: 9 });
  ok(r.json.ok && r.json.amount === 4, "رتبةٌ خارج المدى تُقصَر لا تُكسِر", r.json);
  r = await post("/api/uno/solo", { rank: -5 });
  ok(r.json.ok && r.json.amount === 20, "والسالبة كذلك", r.json);

  console.log("\n⑧ الدفتر يحكي القصّة");
  r = await get("/api/account/wallet");
  const reasons = (r.json.ledger || []).map(x => x.reason);
  ok(reasons.some(x => /^شراء:uno:/.test(x)), "سطرُ شراء", reasons.slice(0, 4));
  ok(reasons.some(x => /^لعب:uno:منفرد$/.test(x)), "سطرُ جائزة");
  ok(reasons.some(x => /ترحيب/.test(x)), "سطرُ هديّة الترحيب");

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
}, 2500);
