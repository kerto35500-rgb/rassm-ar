// اختبار مظاهر بالوت: التجاوز، والصور، والمزامنة مع المتجر، والمسارات.
//
// السؤالُ الذي يجيب عنه هذا الملفّ: إذا عدّلتِ الإدارةُ اسمًا أو سعرًا أو
// رفعت صورةً — هل يراها اللاعب؟ وهل تنجو من إعادة البذر عند النشر؟

const http = require("http");
const os = require("os"), path = require("path"), fs = require("fs");
const express = require("express");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const { createStore } = require("./store");
const seed = require("./shopseed");
const SKN = require("./balootskins");
const CAT = require("./public/baloot/catalog.js");

/* صورةُ PNG صغيرةٌ صالحةٌ (١×١ شفّافة) — يكفي أنّها بايتاتٌ حقيقيّة */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

(async () => {
  console.log("\n═══ مظاهر بالوت ═══\n");

  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const file = path.join(os.tmpdir(), "bskin-" + Date.now() + ".json");
  const S = new JsonStore(file);
  await S.init();
  await S.upsertItems(seed.allItems());

  console.log("① الدمج قبل أيّ تعديل");
  {
    const all = await SKN.listAll(S);
    eq(all.boards.length, CAT.BOARDS.length, "الساحاتُ كما في الملفّ");
    eq(all.backs.length, CAT.BACKS.length, "والظهورُ كذلك");
    ok(all.boards.every(s => s.builtin), "كلُّها مضمَّنةٌ بعد");
    ok(all.boards.every(s => s.active), "وكلُّها ظاهرة");
    ok(all.boards.every(s => !s.img), "ولا صورةَ لأحد");
    ok(all.boards.every(s => s.preview.startsWith("data:image/svg+xml")), "فالمعاينةُ رسمٌ");
    const h = all.boards.find(s => s.key === "hilal");
    ok(h && h.price === 900, "وسعرُ «الأزرق الملكيّ» من الكتالوج", h && h.price);
    ok(all.boards.every(s => s.theme && (s.theme.felt || s.theme.bg)), "ولكلٍّ ثيمُه المرسوم");
  }

  console.log("② تعديلُ اسمٍ وسعر");
  {
    await SKN.patch(S, "boards", "hilal", { name: "الأزرقُ الجديد", price: 1500 }, "t");
    await SKN.syncItem(S, "boards", "hilal");
    const all = await SKN.listAll(S);
    const h = all.boards.find(s => s.key === "hilal");
    eq(h.name, "الأزرقُ الجديد", "الاسمُ تغيّر");
    eq(h.price, 1500, "والسعرُ كذلك");
    const it = await S.getItem("baloot:boards:hilal");
    eq(it.name, "الأزرقُ الجديد", "وانتقل إلى عنصر المتجر");
    eq(it.price, 1500, "بسعره الجديد");
    eq(it.rarity, "rare", "ورتبتُه أُعيد حسابُها من السعر");
    /* ما لم يُرسَل لا يُمسّ */
    await SKN.patch(S, "boards", "hilal", { price: 1200 }, "t");
    const h2 = (await SKN.listAll(S)).boards.find(s => s.key === "hilal");
    eq(h2.name, "الأزرقُ الجديد", "وتعديلُ السعر وحده لا يمحو الاسم");
  }

  console.log("③ صورةٌ تحلّ محلّ الرسم");
  {
    const r = await SKN.putImage(S, "backs", "hilal", "image/png", PNG, "t");
    ok(r.ok, "رُفعت الصورة", r);
    const b = (await SKN.listAll(S)).backs.find(s => s.key === "hilal");
    ok(b.img && b.img.indexOf("/api/baloot/skin/backs/hilal") === 0, "وصار له عنوانٌ للصورة", b.img);
    ok(/\?v=\d+/.test(b.img), "ومعه مفتاحُ نسخةٍ يكسر الخبيئة", b.img);
    eq(b.preview, b.img, "والمعاينةُ صارت الصورة");
    ok(b.theme, "لكنّ الرسمَ باقٍ احتياطًا");
    const it = await S.getItem("baloot:backs:hilal");
    ok(it.preview.indexOf("/api/baloot/skin/") === 0, "وعنصرُ المتجر يشير إليها", it.preview);
    const blob = await S.getBlob("bskin:backs:hilal");
    ok(blob && blob.data && blob.data.length === PNG.length, "والبايتاتُ محفوظةٌ كما هي");

    /* الحذف يُرجع الرسم */
    await SKN.delImage(S, "backs", "hilal", "t");
    const b2 = (await SKN.listAll(S)).backs.find(s => s.key === "hilal");
    ok(!b2.img, "وحذفُها يُرجع الرسم");
    ok(b2.preview.startsWith("data:image/svg+xml"), "معاينةً مرسومةً كما كانت");
  }

  console.log("④ ما يُرفض");
  {
    let e = null;
    try { await SKN.putImage(S, "boards", "x1", "text/html", PNG, "t"); } catch (x) { e = x.message; }
    ok(e && /الصيغ/.test(e), "صيغةٌ غير صورةٍ تُردّ", e);
    e = null;
    try { await SKN.putImage(S, "boards", "x1", "image/png", Buffer.alloc(SKN.MAX_IMG + 1), "t"); } catch (x) { e = x.message; }
    ok(e && /ميغا/.test(e), "وملفٌّ أكبرُ من الحدّ يُردّ", e);
    e = null;
    try { await SKN.patch(S, "boards", "ساحة", { name: "x" }, "t"); } catch (x) { e = x.message; }
    ok(e, "ومفتاحٌ غيرُ لاتينيٍّ يُردّ", e);
    e = null;
    try { await SKN.patch(S, "طاولات", "x", { name: "y" }, "t"); } catch (x) { e = x.message; }
    ok(e, "ونوعٌ مجهولٌ يُردّ", e);
  }

  console.log("⑤ إضافةُ مظهرٍ جديدٍ لا وجود له في الملفّ");
  {
    await SKN.patch(S, "boards", "riyadh", { name: "طاولةُ الرياض", descr: "لونٌ خاصّ", price: 800, active: true }, "t");
    await SKN.putImage(S, "boards", "riyadh", "image/png", PNG, "t");
    const all = await SKN.listAll(S);
    const n = all.boards.find(s => s.key === "riyadh");
    ok(n, "ظهر المظهرُ الجديد");
    ok(n && !n.builtin, "ومعلَّمٌ أنّه مُضاف");
    eq(n && n.price, 800, "بسعره");
    const it = await S.getItem("baloot:boards:riyadh");
    ok(it, "وصار عنصرًا في المتجر يُشترى", it && it.id);
    /* ويُشترى فعلًا */
    const uid = await S.createUser("مشترٍ", "s", "h", {});
    await S.move(uid, "gold", 2000, { reason: "بذر" });
    const buy = await S.buyItem(uid, it);
    ok(buy.ok, "واشتُري بنجاح", buy);
    ok(await S.ownsItem(uid, "baloot:boards:riyadh"), "وصار مملوكًا");
  }

  console.log("⑥ الإخفاء");
  {
    await SKN.patch(S, "backs", "gold", { active: false }, "t");
    await SKN.syncItem(S, "backs", "gold");
    const it = await S.getItem("baloot:backs:gold");
    ok(it && it.active === false, "المخفيُّ مخفيٌّ في المتجر", it && it.active);
    const shown = await S.listItems({ game: "baloot" });
    ok(!shown.some(x => x.id === "baloot:backs:gold"), "ولا يظهر في العرض");
  }

  console.log("⑦ النجاةُ من إعادة البذر");
  {
    /* هذا هو الاختبارُ المهمّ: النشرُ يُعيد البذر من الملفّ، فلو ضاع تعديلُ
       الإدارة هنا ضاع مع كلّ نشرة — وهذا ما حدث لولا `applySkins`. */
    await seed.seedShop(S, () => {});
    const before = await S.getItem("baloot:boards:hilal");
    eq(before.name, "الأزرق الملكيّ", "البذرُ وحدَه يُرجع اسمَ الملفّ (كما هو متوقَّع)");
    await SKN.applySkins(S, () => {});
    const after = await S.getItem("baloot:boards:hilal");
    eq(after.name, "الأزرقُ الجديد", "ثمّ يُعيد تطبيقُ المظاهر اسمَ الإدارة");
    eq(after.price, 1200, "وسعرَها");
    const gold = await S.getItem("baloot:backs:gold");
    eq(gold.active, false, "والمخفيُّ يبقى مخفيًّا");
    const riyadh = await S.getItem("baloot:boards:riyadh");
    ok(riyadh, "والمُضافُ يبقى موجودًا");
    ok(riyadh.preview.indexOf("/api/baloot/skin/") === 0, "بصورته");
  }

  console.log("⑧ المسارات");
  {
    const app = express();
    SKN.setupBalootSkins(app, { get store() { return S; } });
    const srv = app.listen(0);
    const port = srv.address().port;
    const call = (p) => new Promise(res => {
      http.get({ host: "127.0.0.1", port, path: encodeURI(p) }, s => {
        const chunks = [];
        s.on("data", c => chunks.push(c));
        s.on("end", () => {
          const buf = Buffer.concat(chunks);
          let jj = null; try { jj = JSON.parse(buf.toString()); } catch (e) {}
          res({ code: s.statusCode, j: jj, buf, type: s.headers["content-type"] });
        });
      }).on("error", () => res({ code: 0 }));
    });

    let r = await call("/api/baloot/skins");
    ok(r.j && r.j.ok, "قائمةُ المظاهر متاحةٌ للّعبة", r.code);
    ok(r.j.boards.some(s => s.key === "riyadh"), "وفيها المُضاف");
    ok(!r.j.backs.some(s => s.key === "gold"), "وليس فيها المخفيّ");
    const rb = r.j.boards.find(s => s.key === "riyadh");
    ok(rb && rb.img, "وللمُضاف عنوانُ صورة", rb && rb.img);
    ok(r.j.boards.every(s => s.theme), "ولكلٍّ ثيمُه الاحتياطيّ");
    ok(!r.j.boards.some(s => s.preview), "ولا نُرسل المعاينةَ مرّتين — الحمولةُ خفيفة");

    r = await call("/api/baloot/skin/boards/riyadh");
    eq(r.code, 200, "والصورةُ تُقدَّم");
    ok(/^image\/png/.test(r.type || ""), "بنوعها الصحيح", r.type);
    ok(r.buf.length === PNG.length, "وببايتاتها كما رُفعت", r.buf.length);

    r = await call("/api/baloot/skin/boards/لا-وجود");
    eq(r.code, 404, "ومفتاحٌ غيرُ صالحٍ يُردّ ٤٠٤");
    r = await call("/api/baloot/skin/boards/night");
    eq(r.code, 404, "ومظهرٌ بلا صورةٍ يُردّ ٤٠٤ لا صورةً فارغة");

    srv.close();
  }

  console.log("⑨ الكتالوج في المتصفّح يقبل التجاوز");
  {
    /* نُقلّد المتصفّح: نُطبّق ما يردّه المسار ونتحقّق أنّ الرسم صار صورة. */
    CAT.applyOverrides({
      boards: [{ key: "riyadh", name: "طاولةُ الرياض", descr: "", price: 800,
                 img: "/api/baloot/skin/boards/riyadh?v=1", theme: CAT.BOARD_THEME.classic }],
      backs: [{ key: "classic", name: "الوردي", descr: "", price: 0, img: null,
                theme: CAT.BACK_THEME.classic }]
    });
    eq(CAT.BOARDS.length, 1, "استُبدلت قائمةُ الساحات");
    eq(CAT.BOARDS[0][0], "riyadh", "بما جاء من الخادم");
    ok(/^url\("\/api\/baloot\/skin/.test(CAT.boardCss("riyadh")), "وسمةُ الساحة صارت صورة", CAT.boardCss("riyadh"));
    eq(CAT.boardPreview("riyadh"), "/api/baloot/skin/boards/riyadh?v=1", "والمعاينةُ كذلك");
    const bc = CAT.backCss("classic");
    ok(!bc.img && /linear-gradient/.test(bc.outer), "وما لا صورةَ له يبقى مرسومًا", bc.outer.slice(0, 30));
    ok(/radial-gradient/.test(CAT.boardCss("لا-وجود")), "ومفتاحٌ مجهولٌ يرجع للكلاسيكيّ لا يكسر");
  }

  try { fs.unlinkSync(file); } catch (e) {}
  try { fs.rmSync(path.join(path.dirname(file), "blobs"), { recursive: true, force: true }); } catch (e) {}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
