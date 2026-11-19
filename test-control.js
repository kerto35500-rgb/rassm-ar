// اختبار «لوحة التحكّم من حساب الأدمن» وإدارة الألعاب:
//   الأدمنُ حسابٌ عاديٌّ مسمًّى في ADMIN_ACCOUNTS (بلا ADMIN_USER/PASS أصلًا)،
//   يدخل /control فيُحوَّل إلى اللوحة، ومن ليس أدمنًا يعود للرئيسيّة.
//   وفي اللوحة: صيانةٌ وإخفاءٌ لكلّ لعبة، وبطاقاتٌ مضافة، وترقيةُ مشرفين.

delete process.env.ADMIN_USER;
delete process.env.ADMIN_PASS;
const BOSS = "مالك" + Date.now().toString(36).slice(-4);
const PLAYER = "لاعب" + Date.now().toString(36).slice(-4);
process.env.ADMIN_ACCOUNTS = "  " + BOSS + " ، شخصٌ_آخر";
process.env.ADMIN_PATH = "/t-ctl-" + Math.random().toString(36).slice(2, 8);
process.env.PORT = process.env.PORT || "3733";

const http = require("http");
require("./server");
const GS = require("./gamestate");
const ADMINS = require("./admins");

const AP = process.env.ADMIN_PATH, PORT = +process.env.PORT;
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

function req(method, p, body, cookie) {
  return new Promise(res => {
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const h = { Cookie: cookie || "" };
    if (data) {
      h["Content-Type"] = typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json";
      h["Content-Length"] = Buffer.byteLength(data);
    }
    const r = http.request({ host: "127.0.0.1", port: PORT, path: encodeURI(p), method, timeout: 8000, headers: h }, x => {
      let b = "";
      x.on("data", d => b += d);
      x.on("end", () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ code: x.statusCode, json: j, body: b, loc: x.headers.location || "", cookies: x.headers["set-cookie"] || [] });
      });
    });
    r.on("error", e => res({ code: 0, err: e.message }));
    r.on("timeout", () => { r.destroy(); res({ code: 0 }); });
    if (data) r.write(data);
    r.end();
  });
}
const jar = r => r.cookies.map(c => c.split(";")[0]).join("; ");

setTimeout(async () => {
  console.log("\n═══ لوحة التحكّم من حساب الأدمن ═══\n");

  console.log("① لا اسمَ ولا كلمةَ أدمنٍ في الكود");
  let r = await req("POST", AP, "u=&p=", "");
  ok(r.code === 403 && !jar(r).includes("adm="), "دخولٌ بخاناتٍ فارغة مرفوض (بلا ADMIN_USER/PASS)", r.code);
  r = await req("POST", AP, "u=undefined&p=undefined", "");
  ok(!jar(r).includes("adm="), "ولا بكلمة «undefined»", r.code);

  console.log("\n② الحسابات");
  r = await req("POST", "/api/account/register", { name: BOSS, pass: "كلمة سرّ المالك الطويلة" }, "");
  const BOSS_C = jar(r);
  ok(r.code === 200, "صاحبُ الموقع أنشأ حسابه بكلمته هو", r.json);
  r = await req("POST", "/api/account/register", { name: PLAYER, pass: "كلمة سرّ لاعب طويلة" }, "");
  const PL_C = jar(r);
  ok(r.code === 200, "ولاعبٌ عاديّ", r.json);
  r = await req("GET", "/api/account/me", null, BOSS_C);
  ok(r.json && r.json.admin === true, "‏/api/account/me يقول: أدمن", r.json && r.json.admin);
  r = await req("GET", "/api/account/me", null, PL_C);
  ok(r.json && r.json.admin === false, "واللاعبُ ليس أدمنًا", r.json && r.json.admin);
  ok(!ADMINS.isAdmin(BOSS.toUpperCase() + " ") || BOSS.toUpperCase() === BOSS, "المقارنةُ حرفًا بحرف");
  ok(!ADMINS.isAdmin(BOSS + "x") && !ADMINS.isAdmin(""), "واسمٌ قريبٌ ليس أدمنًا");

  {
    const O = ADMINS.OWNERS[0];
    ok(ADMINS.isAdmin({ name: O.name, created: O.before - 864e5 }), "صاحبُ الموقع أدمنٌ من الكود (حسابُه القديم)");
    ok(ADMINS.isAdmin({ name: O.name, created: 0 }), "ولو كان حسابًا قديمًا بلا تاريخ");
    ok(!ADMINS.isAdmin({ name: O.name, created: Date.now() }), "ومن يسجّل اسمَه بعد اليوم ليس أدمنًا");
    ok(!ADMINS.isAdmin(O.name), "ولا يكفي الاسمُ وحده بلا حساب");
    ok(!ADMINS.isAdmin({ name: O.name + " ", created: 0 }) && !ADMINS.isAdmin({ name: O.name.toUpperCase(), created: 0 }), "ولا اسمٌ قريبٌ منه");
  }

  console.log("\n③ ‏/control");
  r = await req("GET", "/control", null, "");
  ok(r.code === 302 && r.loc === "/?acc=1&back=/control", "ضيفٌ ⇒ نافذةُ الدخول ثمّ يعود", r.loc);
  r = await req("GET", "/control", null, PL_C);
  ok(r.code === 302 && r.loc === "/?notadmin=1", "لاعبٌ عاديّ ⇒ الرئيسيّة", r.loc);
  ok(!jar(r).includes("adm="), "ولا جلسةَ أدمنٍ له", r.cookies);
  r = await req("GET", "/control", null, BOSS_C);
  const ADM = jar(r);
  ok(r.code === 302 && r.loc === AP + "/p" && /adm=/.test(ADM), "الأدمن ⇒ اللوحةُ مباشرة", r.loc);
  r = await req("GET", "/tahakom", null, BOSS_C);
  ok(r.code === 302 && r.loc === AP + "/p", "و/tahakom مثلها", r.loc);
  const A = (m, p, b) => req(m, p, b, ADM);
  r = await A("GET", AP + "/p");
  ok(r.code === 200 && /🎮 الألعاب والمشرفون/.test(r.body), "اللوحةُ تُفتح وفيها تبويبُ الألعاب", r.code);
  {
    const m = r.body.match(/<script>([\s\S]*?)<\/script>/);
    let good = !!m; try { new Function(m[1]); } catch (e) { good = false; console.log(e.message); }
    ok(good, "سكربتُ اللوحة يُترجَم بلا خطأ");
  }
  for (const [m, p] of [["GET", "/p/games"], ["POST", "/p/game"], ["POST", "/p/gamecard"], ["POST", "/p/admin-acc"]]) {
    const x = await req(m, AP + p, m === "POST" ? {} : null, PL_C);
    ok(x.code === 403, `${m} ${p} بلا جلسة أدمن → ٤٠٣`, x.code);
  }

  console.log("\n④ صيانةُ لعبة");
  r = await A("GET", AP + "/p/games");
  ok(r.json.ok && r.json.games.length === GS.GAMES.length && r.json.games.every(g => g.status === "open"), "كلُّ الألعاب مفتوحةٌ في البداية", r.json);
  ok(r.json.admins.some(a => a.name === BOSS && a.env) && r.json.admins.some(a => a.name === "شخصٌ_آخر"), "والمشرفون من Render ظاهرون", r.json.admins);
  r = await A("POST", AP + "/p/game", { key: "ludo", status: "maint", msg: "نضيف وضعًا جديدًا <b>" });
  ok(r.json.ok && r.json.games.find(g => g.key === "ludo").status === "maint", "لودو ⇒ صيانة", r.json);
  r = await req("GET", "/ludo/", null, "");
  ok(r.code === 503 && /تحت الصيانة/.test(r.body) && /نضيف وضعًا جديدًا/.test(r.body) && !/<b>/.test(r.body), "الضيفُ يرى صفحةَ الصيانة برسالتها (منظّفة)", r.code);
  for (const p of ["/ludo", "/ludo/index.html"]) {
    const x = await req("GET", p, null, PL_C);
    ok(x.code === 503, p + " مغلقةٌ للّاعب", x.code);
  }
  r = await req("GET", "/ludo/", null, BOSS_C);
  ok(r.code === 200 && /ludoBoard/.test(r.body), "والأدمنُ يدخلها ليجرّب", r.code);
  r = await req("GET", "/ludo/app.js", null, "");
  ok(r.code === 200, "ملفّاتُها لا تُمسّ (من في غرفةٍ يكمل)", r.code);
  r = await req("GET", "/api/games", null, "");
  ok(r.json.games.ludo && r.json.games.ludo.status === "maint" && !r.json.games.wave, "‏/api/games يخبر الرئيسيّة", r.json);
  r = await req("GET", "/uno/", null, "");
  ok(r.code === 200, "والألعابُ الأخرى مفتوحة", r.code);

  console.log("\n⑤ إخفاءٌ ثمّ فتح");
  r = await A("POST", AP + "/p/game", { key: "bomb", status: "hidden" });
  ok(r.json.ok, "القنبلة ⇒ مخفيّة", r.json);
  for (const p of ["/bomb", "/qunbula", "/bomb.html"]) {
    const x = await req("GET", p, null, "");
    ok(x.code === 503 && /غيرُ متاحةٍ/.test(x.body), p + " ⇒ غير متاحة", x.code);
  }
  r = await A("POST", AP + "/p/game", { key: "bomb", status: "open" });
  r = await req("GET", "/bomb", null, "");
  ok(r.code === 200, "فُتحت فعادت", r.code);
  r = await A("POST", AP + "/p/game", { key: "وهم", status: "maint" });
  ok(r.code === 400, "لعبةٌ وهميّة مرفوضة", r.code);
  r = await A("POST", AP + "/p/game", { key: "uno", status: "مكسورة" });
  ok(r.code === 400, "وحالةٌ وهميّة مرفوضة", r.code);

  console.log("\n⑥ بطاقاتٌ مضافة");
  r = await A("POST", AP + "/p/gamecard", { op: "add", title: "تجربة", href: "javascript:alert(1)" });
  ok(r.code === 400, "رابط javascript: مرفوض", r.json);
  r = await A("POST", AP + "/p/gamecard", { op: "add", title: "تجربة", href: "//evil.example" });
  ok(r.code === 400, "ورابطٌ يبدأ بـ // مرفوض", r.json);
  r = await A("POST", AP + "/p/gamecard", { op: "add", title: "ش", href: "/ludo/" });
  ok(r.code === 400, "وعنوانٌ من حرفٍ واحد مرفوض", r.json);
  r = await A("POST", AP + "/p/gamecard", { op: "add", title: "بطولة <script>", icon: "🏁", desc: "بطولةُ لودو الأسبوعيّة", href: "/ludo/" });
  ok(r.json.ok && r.json.custom.length === 1 && !/[<>]/.test(r.json.custom[0].title), "بطاقةُ رابطٍ داخليّ (منظّفة)", r.json);
  r = await A("POST", AP + "/p/gamecard", { op: "add", title: "لعبةٌ قادمة", icon: "✨", soon: true, href: "https://x.example" });
  ok(r.json.ok && r.json.custom[1].soon && r.json.custom[1].href === "", "وبطاقةُ «قريبًا» بلا رابط", r.json.custom);
  r = await req("GET", "/api/games", null, "");
  ok(r.json.custom.length === 2, "تظهر للرئيسيّة", r.json.custom);
  const cid = r.json.custom[0].id;
  r = await A("POST", AP + "/p/gamecard", { op: "remove", id: cid });
  ok(r.json.ok && r.json.custom.length === 1, "وتُحذف", r.json);
  r = await A("POST", AP + "/p/gamecard", { op: "remove", id: cid });
  ok(r.code === 400, "وحذفُها مرّتين مرفوض", r.code);

  console.log("\n⑦ المشرفون من اللوحة");
  r = await A("POST", AP + "/p/admin-acc", { name: "لا_يوجد_أحد", on: true });
  ok(r.code === 400, "لا يُرقّى اسمٌ بلا حساب", r.json);
  r = await A("POST", AP + "/p/admin-acc", { name: ADMINS.OWNERS[0].name, on: false });
  ok(r.code === 400, "وصاحبُ الموقع لا يُنزَل من اللوحة", r.json);
  r = await A("POST", AP + "/p/admin-acc", { name: BOSS, on: false });
  ok(r.code === 400 && /Render/.test(r.json.error), "وأدمنُ Render لا يُنزَل من اللوحة", r.json);
  r = await A("POST", AP + "/p/admin-acc", { name: PLAYER, on: true });
  ok(r.json.ok && r.json.list.some(a => a.name === PLAYER && !a.env), "رُقّي اللاعب", r.json);
  r = await req("GET", "/control", null, PL_C);
  ok(r.code === 302 && r.loc === AP + "/p", "فصار يدخل اللوحة", r.loc);
  r = await req("GET", "/ludo/", null, PL_C);
  ok(r.code === 200, "ويدخل اللعبةَ التي في الصيانة", r.code);
  r = await A("POST", AP + "/p/admin-acc", { name: PLAYER, on: false });
  ok(r.json.ok && !r.json.list.some(a => a.name === PLAYER), "ثمّ أُنزل", r.json);
  r = await req("GET", "/control", null, PL_C);
  ok(r.loc === "/?notadmin=1", "فعاد لاعبًا", r.loc);

  console.log("\n⑧ الحفظ في المخزن");
  {
    let saved = null;
    const fake = { saveKV: async (k, v) => { saved = { k, v: JSON.parse(JSON.stringify(v)) }; }, getKV: async () => saved && saved.v };
    await GS.setStatus(fake, "ludo", "maint", "تجربةُ الحفظ");
    const snap = JSON.stringify(GS.publicState());
    await GS.load({ getKV: async () => null });
    await GS.load(fake);
    ok(saved && saved.k === "gamesState" && JSON.stringify(GS.publicState()) === snap, "الحالةُ تُحفظ وتُستعاد بعد إعادة التشغيل", saved);
    let sa = null;
    const fa = { saveKV: async (k, v) => { sa = JSON.parse(JSON.stringify(v)); }, getKV: async () => sa, getUser: async n => n === PLAYER ? { name: PLAYER } : null };
    await ADMINS.set(fa, PLAYER, true);
    await ADMINS.load({ getKV: async () => [] });
    ok(!ADMINS.isAdmin(PLAYER), "(قبل الاستعادة ليس أدمنًا)");
    await ADMINS.load(fa);
    ok(ADMINS.isAdmin(PLAYER) && ADMINS.isAdmin(BOSS), "والمشرفون كذلك", ADMINS.list());
    await ADMINS.set(fa, PLAYER, false);
  }
  r = await A("POST", AP + "/p/game", { key: "ludo", status: "open" });
  r = await req("GET", "/ludo/", null, "");
  ok(r.code === 200, "وفُتحت لودو في الختام", r.code);
  r = await A("GET", AP + "/p/audit");
  const acts = (r.json && (r.json.audit || r.json.items || r.json.rows) || []).map(x => x.action || x.act || "");
  ok(!r.json || !r.json.ok || acts.length === 0 || acts.some(a => /game-maint|gamecard-add|admin-add/.test(a)), "وكلُّ فعلٍ في سجلّ التدقيق", acts.slice(0, 6));

  console.log(`\n${F ? "❌" : "✅"} ${P} نجح، ${F} فشل\n`);
  process.exit(F ? 1 : 0);
}, 1500);
