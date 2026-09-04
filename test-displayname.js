// اختبار الاسم المعروض: اسم الدخول سرٌّ ومفتاح، والمعروض وجهٌ أمام الناس.
process.env.PORT = process.env.PORT || "3771";
const http = require("http");
require("./server");

const PORT = +process.env.PORT;
const LOGIN = "دخول" + Date.now().toString(36);
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

let C = "";
function req(method, p, body) {
  return new Promise(res => {
    const d = body == null ? null : JSON.stringify(body);
    const h = { Cookie: C };
    if (d) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(d); }
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, timeout: 8000, headers: h }, x => {
      let b = ""; x.on("data", c2 => b += c2);
      x.on("end", () => {
        const sc = x.headers["set-cookie"];
        if (sc) C = sc.map(s => s.split(";")[0]).join("; ");
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ code: x.statusCode, json: j, body: b });
      });
    });
    r.on("error", e => res({ code: 0, err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0 }); });
    if (d) r.write(d); r.end();
  });
}

setTimeout(async () => {
  console.log("\n═══ الاسم المعروض ═══\n");

  let r = await req("POST", "/api/account/register", { name: LOGIN, pass: "كلمة سرّ طويلة" });
  ok(r.code === 200, "سُجّل الحساب", r.json);
  r = await req("GET", "/api/account/me");
  ok(r.json.login === LOGIN, "اسم الدخول يُعاد كما هو", r.json.login);
  ok(r.json.displayName === LOGIN, "وبلا اسمٍ معروض يقع عليه الافتراضيّ", r.json.displayName);

  console.log("\n① التغيير");
  r = await req("POST", "/api/account/name", { displayName: "أبو تركي" });
  ok(r.json.ok && r.json.displayName === "أبو تركي", "غُيّر الاسم المعروض", r.json);
  r = await req("GET", "/api/account/me");
  ok(r.json.displayName === "أبو تركي", "وثبت", r.json.displayName);
  ok(r.json.login === LOGIN, "واسم الدخول لم يمسّه شيء", r.json.login);
  ok(r.json.stats.name === "أبو تركي", "والإحصاءات العامّة تحمله", r.json.stats);

  console.log("\n② الدخول يبقى باسم الدخول");
  r = await req("POST", "/api/account/login", { name: "أبو تركي", pass: "كلمة سرّ طويلة" });
  ok(r.code === 401, "لا يُدخَل بالاسم المعروض", r.code);
  r = await req("POST", "/api/account/login", { name: LOGIN, pass: "كلمة سرّ طويلة" });
  ok(r.code === 200, "ويُدخَل باسم الدخول", r.json);

  console.log("\n③ التنظيف والحدود");
  r = await req("POST", "/api/account/name", { displayName: "   أبو   تركي   " });
  ok(r.json.displayName === "أبو تركي", "المسافات الزائدة تُنظَّف", r.json.displayName);
  r = await req("POST", "/api/account/name", { displayName: "أ​ب‮و" });
  ok(!/[​‮]/.test(r.json.displayName || ""), "ومحارف الاتّجاه الخفيّة تُحذَف", JSON.stringify(r.json.displayName));
  r = await req("POST", "/api/account/name", { displayName: "ا" });
  ok(r.code === 400, "وحرفٌ واحد يُرفَض", r.code);
  r = await req("POST", "/api/account/name", { displayName: "ط".repeat(60) });
  ok(r.json.displayName.length === 20, "والطويل يُقصّ عند ٢٠", r.json.displayName.length);
  r = await req("POST", "/api/account/name", { displayName: "" });
  ok(r.json.ok && r.json.displayName === LOGIN, "وإفراغه يُرجع اسم الدخول", r.json);

  console.log("\n④ الاسم نفسه مسموحٌ لاثنين (ليس مفتاحًا)");
  await req("POST", "/api/account/name", { displayName: "متشابه" });
  const c1 = C; C = "";
  r = await req("POST", "/api/account/register", { name: LOGIN + "ب", pass: "كلمة سرّ طويلة" });
  r = await req("POST", "/api/account/name", { displayName: "متشابه" });
  ok(r.json.ok, "الثاني أخذ الاسم نفسه بلا مشكلة", r.json);
  C = c1;
  r = await req("GET", "/api/account/me");
  ok(r.json.displayName === "متشابه" && r.json.login === LOGIN, "والأوّل باقٍ كما هو", r.json.displayName);

  console.log("\n⑤ الصورة والإطار من المتجر");
  r = await req("GET", "/api/shop/catalog?game=uno");
  const freeAv = r.json.items.find(i => i.kind === "avatars" && i.price === 0);
  const paidAv = r.json.items.find(i => i.kind === "avatars" && i.price > 0);
  ok(!!freeAv && freeAv.owned, "الصور المجّانيّة مملوكةٌ للجميع", freeAv && freeAv.key);
  ok(!!paidAv && !paidAv.owned, "والمدفوعة لا", paidAv && paidAv.key);
  r = await req("POST", "/api/shop/equip", { id: freeAv.id });
  ok(r.json.ok, "جُهِّزت صورةٌ مجّانيّة", r.json);
  r = await req("GET", "/api/account/me");
  ok(r.json.avatar === freeAv.key, "و‎/me‎ يُرجعها", r.json.avatar);
  r = await req("POST", "/api/shop/equip", { id: paidAv.id });
  ok(r.code === 403, "ولا تُجهَّز صورةٌ لا تملكها", r.code);
  r = await req("GET", "/api/account/me");
  ok(r.json.avatar === freeAv.key, "والمجهَّزة لم تتغيّر", r.json.avatar);
  const fr = (await req("GET", "/api/shop/catalog?game=uno")).json.items.find(i => i.kind === "frames" && i.price === 0);
  await req("POST", "/api/shop/equip", { id: fr.id });
  r = await req("GET", "/api/account/me");
  ok(r.json.frame === fr.key, "والإطار كذلك", r.json.frame);

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
}, 2500);
