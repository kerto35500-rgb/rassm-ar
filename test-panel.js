// اختبار لوحة الإدارة: الصلاحية أوّلًا، ثم الأفعال وحدودها وسجلّ التدقيق.
//
// يُشغّل الخادم كاملًا بحساب أدمن مؤقّت، فما يُختبَر هو ما يُنشَر — بما فيه
// أن كل مسارٍ يردّ ٤٠٣ بلا جلسة، وأن كل فعلٍ يترك أثرًا.

process.env.ADMIN_USER = "t-admin";
process.env.ADMIN_PASS = "كلمة أدمن طويلة للاختبار";
process.env.ADMIN_PATH = "/t-panel-" + Math.random().toString(36).slice(2, 8);
process.env.PORT = process.env.PORT || "3731";

const http = require("http");
require("./server");
const SET = require("./settings");

const AP = process.env.ADMIN_PATH, PORT = +process.env.PORT;
const WHO = "مُدار" + Date.now().toString(36);
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

let ADM = "", USR = "";
function req(method, p, body, cookie) {
  return new Promise(res => {
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const h = { Cookie: cookie || "" };
    if (data) {
      h["Content-Type"] = typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json";
      h["Content-Length"] = Buffer.byteLength(data);
    }
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, timeout: 8000, headers: h }, x => {
      let b = "";
      x.on("data", d => b += d);
      x.on("end", () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ code: x.statusCode, json: j, body: b, cookies: x.headers["set-cookie"] || [] });
      });
    });
    r.on("error", e => res({ code: 0, err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0 }); });
    if (data) r.write(data);
    r.end();
  });
}
const A = (m, p, b) => req(m, p, b, ADM);          /* بجلسة أدمن */
const N = (m, p, b) => req(m, p, b, "");           /* بلا جلسة */

setTimeout(async () => {
  console.log("\n═══ لوحة الإدارة ═══\n");

  console.log("① لا شيء بلا جلسة");
  for (const [m, p] of [["GET", "/p/users"], ["GET", "/p/items"], ["GET", "/p/settings"],
                        ["GET", "/p/audit"], ["POST", "/p/ban"], ["POST", "/p/gift"],
                        ["POST", "/p/grant"], ["POST", "/p/settings"], ["POST", "/p/item"],
                        ["POST", "/p/logout-all"]]) {
    const r = await N(m, AP + p, m === "POST" ? {} : null);
    ok(r.code === 403, `${m} ${p} → ٤٠٣`, r.code);
  }
  let r = await N("GET", AP + "/p");
  ok(r.code === 302, "الصفحة نفسها تُحوّل للدخول", r.code);

  console.log("\n② الدخول");
  r = await req("POST", AP, "u=" + encodeURIComponent(process.env.ADMIN_USER) +
                            "&p=" + encodeURIComponent(process.env.ADMIN_PASS), "");
  ADM = r.cookies.map(c => c.split(";")[0]).join("; ");
  ok(r.code === 302 && /adm=/.test(ADM), "جلسة أدمن", r.code);
  r = await A("GET", AP + "/p");
  ok(r.code === 200 && /🎛️/.test(r.body), "الصفحة تُقدَّم", r.code);

  console.log("\n③ لاعبٌ للتجربة");
  r = await req("POST", "/api/account/register", { name: WHO, pass: "كلمة سرّ طويلة" }, "");
  USR = r.cookies.map(c => c.split(";")[0]).join("; ");
  ok(r.code === 200, "سُجّل لاعب", r.json);
  r = await A("GET", AP + "/p/users?q=" + encodeURIComponent(WHO));
  const me = r.json.users.find(u => u.name === WHO);
  ok(!!me, "البحث يجده", r.json.users && r.json.users.length);
  const ID = me.id;
  r = await A("GET", AP + "/p/user/" + ID);
  ok(r.json.ok && r.json.user.name === WHO, "التفصيل يفتح", r.json.error);
  ok(r.json.wallet && r.json.sessions.length >= 1, "ومعه المحفظة والأجهزة", r.json.sessions);

  console.log("\n④ الهديّة وحدودها");
  r = await A("POST", AP + "/p/gift", { id: ID, amount: 250, currency: "gold", why: "اختبار" });
  ok(r.json.ok && r.json.wallet.gold === 250, "منحُ ٢٥٠", r.json);
  r = await A("POST", AP + "/p/gift", { id: ID, amount: -100, why: "تصحيح" });
  ok(r.json.ok && r.json.wallet.gold === 150, "والخصم يعمل", r.json);
  r = await A("POST", AP + "/p/gift", { id: ID, amount: 9e9 });
  ok(r.code === 400, "مبلغٌ فلكيّ مرفوض", r.code);
  r = await A("POST", AP + "/p/gift", { id: ID, amount: 0 });
  ok(r.code === 400, "وصفرٌ مرفوض", r.code);
  r = await A("POST", AP + "/p/gift", { id: ID, amount: -99999 });
  ok(r.code === 400 && /لا يكفي/.test(r.json.error || ""), "وخصمٌ أكبر من الرصيد مرفوض", r.json);
  r = await A("GET", AP + "/p/user/" + ID);
  ok(r.json.wallet.gold === 150, "والرصيد سليمٌ بعد كل ذلك", r.json.wallet);

  console.log("\n⑤ منح عنصر");
  const item = (await A("GET", AP + "/p/items")).json.items.find(i => i.price > 0);
  r = await A("POST", AP + "/p/grant", { id: ID, item: item.id });
  ok(r.json.ok, "مُنح بلا خصم", r.json);
  r = await A("GET", AP + "/p/user/" + ID);
  ok(r.json.inventory.some(x => x.id === item.id), "يظهر في مخزونه", r.json.inventory);
  ok(r.json.wallet.gold === 150, "ورصيده لم يتغيّر");
  r = await A("POST", AP + "/p/grant", { id: ID, item: item.id });
  ok(!r.json.ok, "ولا يُمنح مرّتين", r.json);
  r = await A("POST", AP + "/p/grant", { id: ID, item: "uno:frames:وهم" });
  ok(r.code === 404, "عنصرٌ وهميّ ٤٠٤", r.code);

  console.log("\n⑥ الحظر");
  r = await req("GET", "/api/account/me", null, USR);
  ok(r.json.ok && !r.json.guest, "اللاعب داخلٌ قبل الحظر");
  r = await A("POST", AP + "/p/ban", { id: ID, days: 3, reason: "اختبار" });
  ok(r.json.ok && r.json.banned, "حُظر ٣ أيام", r.json);
  r = await req("GET", "/api/account/me", null, USR);
  ok(r.json.guest === true, "وأُخرج من جهازه فورًا", r.json);
  r = await A("POST", AP + "/p/ban", { id: ID, days: 99999 });
  ok(r.code === 400, "مدّةٌ خياليّة مرفوضة", r.code);
  r = await A("POST", AP + "/p/ban", { id: ID, days: 0 });
  ok(r.json.ok && r.json.banned === false, "وصفرٌ يرفع الحظر", r.json);
  r = await A("POST", AP + "/p/ban", { id: 999999, days: 1 });
  ok(r.code === 404, "لاعبٌ غير موجود ٤٠٤", r.code);

  console.log("\n⑦ الإعدادات: المدى في الكود");
  r = await A("GET", AP + "/p/settings");
  ok(r.json.ok && r.json.settings.economy.length > 10, "الإعدادات تُوصَف", r.json.error);
  r = await A("POST", AP + "/p/settings", { scope: "economy", key: "quizWin", value: 77 });
  ok(r.json.ok && r.json.value === 77, "غُيّرت جائزة الهرم", r.json);
  ok(SET.get("economy", "quizWin") === 77, "والذاكرة الحيّة تحدّثت فورًا", SET.get("economy", "quizWin"));
  r = await A("POST", AP + "/p/settings", { scope: "economy", key: "quizWin", value: 999999 });
  ok(r.code === 400, "قيمةٌ فوق المدى مرفوضة", r.json);
  ok(SET.get("economy", "quizWin") === 77, "ولم تُفسد الرفضةُ القيمة القائمة");
  r = await A("POST", AP + "/p/settings", { scope: "economy", key: "quizWin", value: -5 });
  ok(r.code === 400, "وسالبةٌ مرفوضة", r.code);
  r = await A("POST", AP + "/p/settings", { scope: "economy", key: "لا-يوجد", value: 1 });
  ok(r.code === 400, "ومفتاحٌ مجهول مرفوض", r.code);
  r = await A("POST", AP + "/p/settings", { scope: "site", key: "registerOpen", value: false });
  ok(r.json.ok, "أُغلق التسجيل", r.json);
  r = await req("POST", "/api/account/register", { name: "لن_يُسجّل", pass: "كلمة سرّ طويلة" }, "");
  ok(r.code === 503, "فامتنع التسجيل فعلًا", r.code);
  await A("POST", AP + "/p/settings", { scope: "site", key: "registerOpen", value: true });
  r = await A("POST", AP + "/p/settings", { scope: "site", key: "shopOpen", value: false });
  r = await req("POST", "/api/shop/buy", { id: item.id }, USR);
  ok(r.code === 401 || r.code === 503, "والمتجر يُغلَق كذلك", r.code);
  await A("POST", AP + "/p/settings", { scope: "site", key: "shopOpen", value: true });
  await A("POST", AP + "/p/settings", { scope: "economy", key: "quizWin", value: 60 });

  console.log("\n⑧ تسعير المتجر");
  r = await A("POST", AP + "/p/item", { id: item.id, price: 12345 });
  ok(r.json.ok && r.json.item.price === 12345, "تغيّر السعر", r.json);
  r = await req("GET", "/api/shop/catalog", null, "");
  ok(r.json.items.find(i => i.id === item.id).price === 12345, "وظهر في المتجر العام");
  r = await A("POST", AP + "/p/item", { id: item.id, price: -1 });
  ok(r.code === 400, "سعرٌ سالب مرفوض", r.code);
  r = await A("POST", AP + "/p/item", { id: item.id, active: false });
  ok(r.json.ok, "أُخفي العنصر");
  r = await req("GET", "/api/shop/catalog", null, "");
  ok(!r.json.items.some(i => i.id === item.id), "فاختفى من المتجر العام");
  await A("POST", AP + "/p/item", { id: item.id, active: true, price: item.price });

  console.log("\n⑨ سجلّ التدقيق يحفظ كل ذلك");
  r = await A("GET", AP + "/p/audit");
  const acts = r.json.log.map(x => x.action);
  for (const a of ["gift", "deduct", "grant", "ban", "unban", "setting", "item-price", "item-active"])
    ok(acts.includes(a), `سُجّل «${a}»`, acts.slice(0, 8));
  const bad = r.json.log.find(x => x.action === "setting-rejected");
  ok(!!bad, "وحتى المرفوض يُسجَّل — فالمحاولة نفسها معلومة", acts.slice(0, 8));
  ok(r.json.log.every(x => x.ip), "لكل سطرٍ عنوان");
  r = await A("GET", AP + "/p/user/" + ID);
  ok(r.json.audit.length >= 4, "وسجلُّ اللاعب يُعرَض في صفحته", r.json.audit.length);

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
}, 2500);
