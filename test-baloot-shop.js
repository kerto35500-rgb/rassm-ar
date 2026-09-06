// اختبار متجر بالوت: الكتالوج، والبذر، والشراء والتجهيز عبر المسارات.
//
// المصدرُ واحد: كتالوجُ اللعبة نفسه يبذر المتجر. فما يُختبَر هنا أوّلًا هو
// أنّهما لا يفترقان — ثمّ أنّ الشراء يخصم مرّةً واحدة ويُجهِّز ما اشتُري.

const http = require("http");
const os = require("os"), path = require("path"), fs = require("fs");
const express = require("express");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const { createStore } = require("./store");
const seed = require("./shopseed");
const CAT = require("./public/baloot/catalog.js");
const { setupShop } = require("./shop");

(async () => {
  console.log("\n═══ متجر بالوت ═══\n");

  console.log("① الكتالوج");
  {
    ok(CAT.BOARDS.length >= 4, "ساحاتٌ متعدّدة", CAT.BOARDS.length);
    ok(CAT.BACKS.length >= 4, "وظهورُ بطاقات", CAT.BACKS.length);
    ok(CAT.BOARDS.some(b => b[0] === "hilal"), "وفيها «الأزرق الملكيّ»");
    ok(CAT.BACKS.some(b => b[0] === "hilal"), "ظهرًا وساحة");
    const free = CAT.BOARDS.filter(b => b[3] === 0).length;
    eq(free, 1, "ساحةٌ واحدةٌ مجّانيّةٌ للبداية");
    eq(CAT.BACKS.filter(b => b[3] === 0).length, 1, "وظهرٌ واحدٌ مجّانيّ");
    ok(CAT.BOARDS.every(b => b[3] >= 0), "ولا سعرَ سالب");
    /* كلُّ مفتاحٍ له ثيمٌ يُرسَم به — وإلا ظهر عنصرٌ في المتجر بلا شكل */
    ok(CAT.BOARDS.every(b => CAT.BOARD_THEME[b[0]]), "لكلّ ساحةٍ ثيمُها", CAT.BOARDS.map(b => b[0]));
    ok(CAT.BACKS.every(b => CAT.BACK_THEME[b[0]]), "ولكلّ ظهرٍ ثيمُه");
  }

  console.log("② المعاينات مرسومةٌ بلا ملفّات");
  {
    const p = CAT.boardPreview("hilal");
    ok(p.startsWith("data:image/svg+xml"), "معاينةُ الساحة SVG داخل العنوان");
    ok(p.length < 4000, "وقصيرةٌ تكفي لسمة CSS", p.length);
    const b = CAT.backPreview("hilal");
    ok(b.startsWith("data:image/svg+xml"), "ومعاينةُ الظهر كذلك");
    ok(decodeURIComponent(b).includes("★"), "وفيها النجمة الذهبيّة");
    ok(CAT.boardPreview("لا-وجود-له").startsWith("data:image"), "ومفتاحٌ مجهولٌ يرجع للكلاسيكيّ لا يكسر");
    const css = CAT.boardCss("hilal");
    ok(/radial-gradient/.test(css), "وسمةُ الساحة تدرّجٌ صالح", css.slice(0, 40));
    const bc = CAT.backCss("hilal");
    ok(bc.outer && bc.inner && bc.ring, "وسمةُ الظهر كاملة", Object.keys(bc));
  }

  console.log("③ البذر يطابق الكتالوج");
  {
    const rows = seed.balootItems();
    eq(rows.length, CAT.BOARDS.length + CAT.BACKS.length, "عددُ الصفوف كعدد الكتالوج");
    ok(rows.every(r => r.game === "baloot"), "كلُّها للعبة بالوت");
    ok(rows.every(r => /^baloot:(boards|backs):/.test(r.id)), "والمعرّف مقروء", rows[0].id);
    ok(rows.every(r => r.preview.startsWith("data:image/svg+xml")), "ومعاينتُها مرسومة");
    const hb = rows.find(r => r.id === "baloot:boards:hilal");
    ok(hb && hb.price === 900, "وسعرُ «الأزرق الملكيّ» كما في الكتالوج", hb && hb.price);
    ok(seed.SECTIONS.baloot && seed.SECTIONS.baloot.kinds.boards, "وللقسم تسميةٌ عربيّة",
       seed.SECTIONS.baloot && seed.SECTIONS.baloot.kinds);
    /* لا تصادمَ مع «وحدة» */
    const all = seed.allItems();
    eq(new Set(all.map(r => r.id)).size, all.length, "ولا معرّفَ مكرَّرٌ في المتجر كلِّه");
  }

  /* ─────────── الشراء عبر المسارات ─────────── */
  console.log("④ الشراء والتجهيز");
  {
    const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
    const file = path.join(os.tmpdir(), "bshop-" + Date.now() + ".json");
    const S = new JsonStore(file);
    await S.init();
    await S.upsertItems(seed.allItems());
    const uid = await S.createUser("مشترٍ", "s", "h", {});
    const U = await S.getUserById(uid);

    const app = express();
    let CUR = null;
    setupShop(app, { get store() { return S; }, currentUser: async () => CUR });
    const srv = app.listen(0);
    const port = srv.address().port;
    const call = (method, p, body) => new Promise(res => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ host: "127.0.0.1", port, path: encodeURI(p), method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
        s => { let b = ""; s.on("data", c => b += c); s.on("end", () => { try { res({ code: s.statusCode, j: JSON.parse(b) }); } catch (e) { res({ code: s.statusCode, j: null }); } }); });
      r.on("error", () => res({ code: 0, j: null }));
      if (data) r.write(data);
      r.end();
    });

    CUR = U;
    let r = await call("GET", "/api/shop/catalog?game=baloot");
    ok(r.j && r.j.ok, "كتالوجُ بالوت متاح", r.j && r.j.ok);
    const items = (r.j.items || []).filter(x => x.game === "baloot");
    eq(items.length, CAT.BOARDS.length + CAT.BACKS.length, "وفيه عناصرُها كلُّها");
    ok(!items.some(x => x.game === "uno"), "ولا يختلط بمتجر «وحدة» — لكلّ لعبةٍ متجرُها");

    /* بلا رصيد: يُردّ */
    r = await call("POST", "/api/shop/buy", { id: "baloot:boards:hilal" });
    ok(!r.j.ok, "ولا شراءَ بلا رصيد", r.j);

    await S.move(U.id, "gold", 2000, { reason: "بذر" });
    const before = (await S.getWallet(U.id)).gold;

    r = await call("POST", "/api/shop/buy", { id: "baloot:boards:hilal" });
    ok(r.j.ok, "اشتُريت الساحة", r.j);
    eq((await S.getWallet(U.id)).gold, before - 900, "وخُصم ثمنُها بالضبط");
    ok(await S.ownsItem(U.id, "baloot:boards:hilal"), "وصارت مملوكة");

    r = await call("POST", "/api/shop/buy", { id: "baloot:boards:hilal" });
    ok(!r.j.ok, "ولا تُشترى مرّتين", r.j);
    eq((await S.getWallet(U.id)).gold, before - 900, "ولم يُخصَم ثانيةً");

    r = await call("POST", "/api/shop/equip", { id: "baloot:boards:hilal" });
    ok(r.j.ok, "وجُهِّزت", r.j);
    const lo = await S.getLoadout(U.id, "baloot");
    eq(lo.boards, "hilal", "وظهرت في التجهيز", lo);

    /* المجّانيُّ يُجهَّز بلا شراء */
    r = await call("POST", "/api/shop/equip", { id: "baloot:backs:classic" });
    ok(r.j.ok, "والمجّانيُّ يُجهَّز بلا شراء", r.j);

    /* ما لا يُملَك لا يُجهَّز */
    r = await call("POST", "/api/shop/equip", { id: "baloot:backs:gold" });
    ok(!r.j.ok, "وما لا تملكه لا تُجهِّزه", r.j);

    r = await call("GET", "/api/shop/mine?game=baloot");
    ok(r.j.ok && r.j.owned.includes("baloot:boards:hilal"), "و«ما أملك» يعرضها", r.j.owned);
    eq(r.j.loadout.boards, "hilal", "ومعها التجهيز");

    /* عنصرٌ مخترَع */
    r = await call("POST", "/api/shop/buy", { id: "baloot:boards:طنجرة" });
    ok(!r.j.ok, "وعنصرٌ لا وجود له يُردّ", r.j);

    CUR = null;
    r = await call("POST", "/api/shop/buy", { id: "baloot:backs:carbon" });
    ok(!r.j.ok, "والضيف لا يشتري", r.j);

    srv.close();
    try { fs.unlinkSync(file); } catch (e) {}
  }

  console.log("⑤ هويّةٌ بصريّةٌ مميّزة");
  {
    const hub = fs.readFileSync(path.join(__dirname, "public", "hub.html"), "utf8");
    const m = hub.match(/key:"baloot"[^}]*}/);
    ok(m && !/c-green/.test(m[0]), "بالوت لم تعد تتشارك الأخضر مع «برّا السالفة»", m && m[0]);
    ok(m && /c-indigo/.test(m[0]), "بل لها لونُها", m && m[0]);
    ok(m && !/🕵/.test(m[0]), "ولا تتشارك أيقونة المحقّق");
    ok(/\.c-indigo \.bar/.test(hub), "واللونُ معرَّفٌ في السمات");
    const salfa = hub.match(/key:"salfa"[^}]*}/);
    ok(salfa && m && salfa[0].match(/icon:"(.+?)"/)[1] !== m[0].match(/icon:"(.+?)"/)[1],
       "وأيقونتاهما مختلفتان");
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
