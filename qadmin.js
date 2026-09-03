// 📚 لوحة إدارة أسئلة «قمّة الهرم»
// تُركَّب تحت نفس المسار السري للوحة المراقبة وتستعمل نفس الجلسة.
const { ADMIN_PATH, adminEnabled, verifySession, parseCookies } = require("./admin");
const qbank = require("./qbank");

function readJson(req, limit = 8e6) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > limit) { req.destroy(); resolve(null); } });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(null); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "X-Frame-Options": "DENY" });
  res.end(JSON.stringify(obj));
}
function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function setupQuestionAdmin(app, deps) {
  const { store } = deps;

  // الحالة المحفوظة: { extra:{فئة:[صفوف]}, removed:[نصوص], over:{نص:صف}, imgs:{id:{t,d}} }
  let bank = { extra: {}, removed: [], over: {}, imgs: {} };
  let saveTimer = null;

  store.getKV("quizBank").then(v => {
    if (v) {
      bank = { extra: v.extra || {}, removed: v.removed || [], over: v.over || {}, imgs: v.imgs || {} };
      qbank.setExtra(bank.extra);
      qbank.setRemoved(bank.removed);
      qbank.setOverrides(bank.over);
      const n = Object.values(bank.extra).flat().length, m = Object.keys(bank.over).length;
      if (n || m) console.log(`📚 أسئلة مخصصة: ${n} · تعديلات: ${m}`);
    }
  }).catch(() => {});

  function persist() {
    qbank.setExtra(bank.extra);
    qbank.setRemoved(bank.removed);
    qbank.setOverrides(bank.over);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.saveKV("quizBank", bank).catch(e => console.error("qbank save:", e.message)), 800);
  }

  // ── صور الأسئلة: تُخزَّن في قاعدة البيانات وتُقدَّم من /qimg/<id> ──
  app.get("/qimg/:id", (req, res) => {
    const im = bank.imgs[String(req.params.id || "")];
    if (!im) { res.status(404).end("not found"); return; }
    const buf = Buffer.from(im.d, "base64");
    res.writeHead(200, {
      "Content-Type": im.t || "image/jpeg",
      "Content-Length": buf.length,
      "Cache-Control": "public, max-age=604800"
    });
    res.end(buf);
  });

  if (!adminEnabled) return null;

  const guard = (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); res.end("forbidden"); return false; }
    return true;
  };

  app.get(ADMIN_PATH + "/q", (req, res) => {
    if (!guard(req, res)) return;
    html(res, page());
  });

  // إحصاءات الفئات
  app.get(ADMIN_PATH + "/q/list", (req, res) => {
    if (!guard(req, res)) return;
    const cats = qbank.categories().map(c => {
      const base = (qbank.BANK[c] || []).length;
      const extra = (bank.extra[c] || []).length;
      const active = qbank.poolOf(c).length;
      const imgs = qbank.poolOf(c).filter(r => r[6]).length;
      return { cat: c, base, extra, active, imgs };
    });
    json(res, 200, {
      total: qbank.countAll(), removed: bank.removed.length,
      edited: Object.keys(bank.over).length, cats,
      links: qbank.LINKS.length, sorts: qbank.SORTS.length
    });
  });

  // أسئلة فئة (مع بحث وتقسيم صفحات)
  app.get(ADMIN_PATH + "/q/cat", (req, res) => {
    if (!guard(req, res)) return;
    const url = new URL(req.url, "http://x");
    const c = url.searchParams.get("c") || "";
    const term = (url.searchParams.get("s") || "").trim();
    const filter = url.searchParams.get("f") || "all";
    const page0 = Math.max(0, parseInt(url.searchParams.get("p") || "0", 10));
    const gen = {};
    (qbank.poolOf(c) || []).forEach(r => gen[r[0]] = true);
    const mk = (r, src) => ({
      q: r[0], a: r.slice(1, 5), d: r[5], img: r[6] || null, src,
      off: bank.removed.includes(r[0]), edited: !!bank.over[r[0]]
    });
    let items = [
      ...(bank.extra[c] || []).map(r => mk(r, "مخصص")),
      ...(qbank.BANK[c] || []).map(r => mk(bank.over[r[0]] ? [r[0], ...bank.over[r[0]].slice(1)] : r, "أساسي"))
    ];
    // المولّدة آلياً (ليست في BANK ولا في extra)
    const known = new Set(items.map(i => i.q));
    (qbank.poolOf(c) || []).forEach(r => { if (!known.has(r[0])) items.push(mk(r, "مولّد")); });
    if (term) items = items.filter(i => i.q.includes(term) || i.a.some(a => String(a).includes(term)));
    if (filter === "custom") items = items.filter(i => i.src === "مخصص");
    if (filter === "off") items = items.filter(i => i.off);
    if (filter === "img") items = items.filter(i => i.img);
    if (filter === "edited") items = items.filter(i => i.edited);
    const per = 40, total = items.length;
    json(res, 200, { cat: c, total, page: page0, pages: Math.ceil(total / per) || 1,
      items: items.slice(page0 * per, page0 * per + per) });
  });

  // إضافة سؤال
  app.post(ADMIN_PATH + "/q/add", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    if (!b) return json(res, 400, { ok: false, error: "بيانات غير صالحة" });
    const v = validateRow(b);
    if (!v.ok) return json(res, 400, v);
    const cat = String(b.cat || "").trim() || "عام";
    bank.extra[cat] = bank.extra[cat] || [];
    if (allTexts().has(v.row[0])) return json(res, 400, { ok: false, error: "السؤال موجود مسبقاً" });
    bank.extra[cat].push(v.row);
    bank.removed = bank.removed.filter(x => x !== v.row[0]);
    persist();
    json(res, 200, { ok: true, total: qbank.countAll() });
  });

  // تعديل سؤال (مخصص أو أساسي أو مولّد)
  app.post(ADMIN_PATH + "/q/edit", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    if (!b) return json(res, 400, { ok: false, error: "بيانات غير صالحة" });
    const orig = String(b.orig || "").trim();
    const v = validateRow(b);
    if (!v.ok) return json(res, 400, v);
    if (!orig) return json(res, 400, { ok: false, error: "السؤال الأصلي مفقود" });
    let inExtra = false;
    Object.keys(bank.extra).forEach(c => {
      bank.extra[c] = bank.extra[c].map(r => {
        if (r[0] === orig) { inExtra = true; return v.row; }
        return r;
      });
    });
    if (!inExtra) bank.over[orig] = v.row;   // تعديل فوق سؤال أساسي/مولّد
    persist();
    json(res, 200, { ok: true, total: qbank.countAll() });
  });

  // إلغاء التعديل والعودة للأصل
  app.post(ADMIN_PATH + "/q/reset", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    const t = b && String(b.q || "");
    if (t && bank.over[t]) { delete bank.over[t]; persist(); return json(res, 200, { ok: true }); }
    json(res, 200, { ok: false });
  });

  // تعطيل/تفعيل
  app.post(ADMIN_PATH + "/q/toggle", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    const t = b && String(b.q || "");
    if (!t) return json(res, 400, { ok: false });
    if (bank.removed.includes(t)) bank.removed = bank.removed.filter(x => x !== t);
    else bank.removed.push(t);
    persist();
    json(res, 200, { ok: true, off: bank.removed.includes(t), total: qbank.countAll() });
  });

  // حذف سؤال مخصص
  app.post(ADMIN_PATH + "/q/del", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    const t = b && String(b.q || "");
    let hit = false;
    Object.keys(bank.extra).forEach(c => {
      const before = bank.extra[c].length;
      bank.extra[c] = bank.extra[c].filter(r => r[0] !== t);
      if (bank.extra[c].length !== before) hit = true;
      if (!bank.extra[c].length) delete bank.extra[c];
    });
    persist();
    json(res, 200, { ok: hit, total: qbank.countAll() });
  });

  // رفع صورة (base64) → تُحفظ وتُعاد بمسارها
  app.post(ADMIN_PATH + "/q/img", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    const data = b && String(b.data || "");
    const m = data.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/);
    if (!m) return json(res, 400, { ok: false, error: "صيغة صورة غير مدعومة" });
    const raw = m[3];
    if (raw.length > 1.4e6) return json(res, 400, { ok: false, error: "الصورة كبيرة (الحد ~1 ميغابايت)" });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    bank.imgs[id] = { t: m[1], d: raw };
    persist();
    json(res, 200, { ok: true, url: "/qimg/" + id });
  });

  // استيراد جماعي
  app.post(ADMIN_PATH + "/q/import", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    if (!b || typeof b.text !== "string") return json(res, 400, { ok: false, error: "لا يوجد نص" });
    const r = parseBulk(b.text, String(b.cat || "").trim());
    const have = allTexts();
    let added = 0, dup = 0;
    r.rows.forEach(({ cat, row }) => {
      if (have.has(row[0])) { dup++; return; }
      have.add(row[0]);
      bank.extra[cat] = bank.extra[cat] || [];
      bank.extra[cat].push(row);
      added++;
    });
    if (added) persist();
    json(res, 200, { ok: true, added, dup, errors: r.errors, total: qbank.countAll() });
  });

  // تصدير كل شيء
  app.get(ADMIN_PATH + "/q/export", (req, res) => {
    if (!guard(req, res)) return;
    const out = {};
    qbank.categories().forEach(c => out[c] = qbank.poolOf(c));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=questions.json" });
    res.end(JSON.stringify(out, null, 1));
  });

  function allTexts() {
    const s = new Set();
    qbank.categories().forEach(c => qbank.poolOf(c).forEach(r => s.add(r[0])));
    Object.values(bank.extra).flat().forEach(r => s.add(r[0]));
    return s;
  }

  // ═══ 🚩 بلاغات اللاعبين عن الأسئلة ═══
  let reports = [];
  let rSaveT = null;
  store.getKV("qReports").then(v => { if (Array.isArray(v)) reports = v; }).catch(() => {});
  function persistR() {
    clearTimeout(rSaveT);
    rSaveT = setTimeout(() => store.saveKV("qReports", reports).catch(() => {}), 600);
  }

  // نقطة عامة (بلا جلسة أدمن): زر 🚩 داخل اللعبة يرسل إليها.
  // بلاغ مكرر على نفس السؤال يرفع عدّاده بدل أن يغرق القائمة.
  app.post("/api/qreport", async (req, res) => {
    const b = await readJson(req, 4e4);
    if (!b) return json(res, 400, { ok: false });
    const q = String(b.q || "").trim().slice(0, 400);
    const reason = String(b.reason || "").trim().slice(0, 400);
    const cat = String(b.cat || "").trim().slice(0, 60);
    const room = String(b.room || "").trim().slice(0, 12);
    if (!q && !reason) return json(res, 400, { ok: false, error: "بلاغ فارغ" });
    const same = q && reports.find(r => r.q === q);
    if (same) {
      same.n = (same.n || 1) + 1;
      same.at = Date.now();
      if (reason && !(same.reasons || []).includes(reason)) (same.reasons = same.reasons || []).push(reason);
    } else {
      reports.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        q, cat, room, reasons: reason ? [reason] : [], n: 1, at: Date.now() });
      if (reports.length > 300) reports.length = 300;
    }
    persistR();
    json(res, 200, { ok: true });
  });

  // قائمة البلاغات للأدمن — تُثرى بصفّ السؤال الحالي من البنك للتحرير المباشر
  app.get(ADMIN_PATH + "/q/reports", (req, res) => {
    if (!guard(req, res)) return;
    const out = reports.map(r => {
      let row = null, rcat = r.cat || null;
      for (const c of qbank.categories()) {
        const hit = qbank.poolOf(c).find(x => x[0] === r.q);
        if (hit) { row = hit; rcat = c; break; }
      }
      return { ...r, cat: rcat, row: row ? { a: row.slice(1, 5), d: row[5] || 1, img: row[6] || "" } : null };
    });
    json(res, 200, { reports: out });
  });

  app.post(ADMIN_PATH + "/q/report-del", async (req, res) => {
    if (!guard(req, res)) return;
    const b = await readJson(req);
    if (!b) return json(res, 400, { ok: false });
    if (b.id === "*") reports = [];
    else reports = reports.filter(r => r.id !== b.id);
    persistR();
    json(res, 200, { ok: true, left: reports.length });
  });

  console.log("📚 إدارة الأسئلة مفعّلة على " + ADMIN_PATH + "/q");
  return { bank, persist };
}

// ====== تحقق وتحليل ======
function validateRow(b) {
  const q = String(b.q || "").trim();
  const opts = [b.a1, b.a2, b.a3, b.a4].map(x => String(x == null ? "" : x).trim());
  const d = Number(b.d) || 1;
  const img = String(b.img || "").trim();
  if (q.length < 5) return { ok: false, error: "نص السؤال قصير جداً" };
  if (opts.some(o => !o)) return { ok: false, error: "كل الخيارات الأربعة مطلوبة" };
  if (new Set(opts).size !== 4) return { ok: false, error: "الخيارات مكررة" };
  if (![1, 2, 3].includes(d)) return { ok: false, error: "الصعوبة يجب أن تكون 1 أو 2 أو 3" };
  const row = [q, opts[0], opts[1], opts[2], opts[3], d];
  if (img) row.push(img);
  return { ok: true, row };
}

/**
 * تحليل الاستيراد الجماعي.
 *   السؤال | الإجابة الصحيحة | خطأ | خطأ | خطأ | الصعوبة | الفئة
 * ويقبل JSON: مصفوفة كائنات {q,a1..a4,d,cat,img} أو مصفوفة مصفوفات.
 */
function parseBulk(text, defaultCat) {
  const rows = [], errors = [];
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      let j = JSON.parse(t);
      if (!Array.isArray(j)) j = j.items || j.questions || [];
      j.forEach((it, i) => {
        let cat = defaultCat, row = null;
        if (Array.isArray(it)) {
          row = validateRow({ q: it[0], a1: it[1], a2: it[2], a3: it[3], a4: it[4], d: it[5] || 1, img: it[6] });
          if (it[7]) cat = String(it[7]).trim();
        } else {
          row = validateRow({ q: it.q || it.question, a1: it.a1 || (it.a && it.a[0]), a2: it.a2 || (it.a && it.a[1]),
            a3: it.a3 || (it.a && it.a[2]), a4: it.a4 || (it.a && it.a[3]), d: it.d || it.diff || 1, img: it.img });
          if (it.cat || it.category) cat = String(it.cat || it.category).trim();
        }
        if (!row.ok) errors.push(`عنصر ${i + 1}: ${row.error}`);
        else rows.push({ cat: cat || "عام", row: row.row });
      });
    } catch (e) { errors.push("JSON غير صالح: " + e.message); }
    return { rows, errors };
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    const parts = s.split(/\s*[|\t]\s*|\s*،\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 5) { errors.push(`سطر ${i + 1}: يحتاج ٥ حقول على الأقل`); return; }
    const d = parts[5] && /^[123]$/.test(parts[5]) ? Number(parts[5]) : 1;
    const cat = parts[6] || defaultCat;
    const v = validateRow({ q: parts[0], a1: parts[1], a2: parts[2], a3: parts[3], a4: parts[4], d });
    if (!v.ok) errors.push(`سطر ${i + 1}: ${v.error}`);
    else rows.push({ cat: cat || "عام", row: v.row });
  });
  return { rows, errors };
}

function page() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>إدارة الأسئلة</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{background:#0f1c2e;color:#e8eef6;padding:14px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
.sub{color:#8ea6c0;font-size:13px;margin-bottom:12px}
.card{background:#16273d;border:1px solid #24405f;border-radius:14px;padding:12px;margin-bottom:12px}
.cats{display:flex;flex-wrap:wrap;gap:6px}
.cat{border:1px solid #2c4a6d;background:#1d3350;color:#cfe0f2;border-radius:10px;
  padding:6px 10px;cursor:pointer;font-size:13px;font-weight:600}
.cat.on{background:#2f7ad6;border-color:#57a2ff;color:#fff}
.cat b{color:#7fd4a8;font-weight:700}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
input,select,textarea{background:#0e1b2c;border:1px solid #2c4a6d;color:#e8eef6;border-radius:9px;padding:8px 10px;font-size:14px}
input[type=text],input[type=search]{min-width:220px}
button{background:#2f7ad6;border:0;color:#fff;border-radius:9px;padding:8px 13px;cursor:pointer;font-size:13.5px;font-weight:600}
button.g{background:#2b8a5b}button.r{background:#c0392b}button.s{background:#3a5a80;padding:5px 9px;font-size:12.5px}
.item{border:1px solid #24405f;border-radius:12px;padding:10px;margin-bottom:8px;background:#122032}
.item.off{opacity:.5}
.qt{font-weight:700;margin-bottom:6px;line-height:1.6}
.opts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.opt{background:#0e1b2c;border:1px solid #24405f;border-radius:8px;padding:4px 8px;font-size:12.5px}
.opt.ok{background:#14442c;border-color:#2b8a5b;color:#a8f0c8}
.meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:#8ea6c0}
.tag{background:#24405f;border-radius:6px;padding:2px 7px}
.tag.x{background:#7a4a12}.tag.e{background:#5a2f7a}.tag.i{background:#134a5a}
.thumb{max-height:70px;border-radius:8px;margin:4px 0;display:block}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.full{grid-column:1/-1}
label{font-size:12.5px;color:#8ea6c0;display:block;margin-bottom:3px}
.pag{display:flex;gap:6px;justify-content:center;margin-top:10px}
#msg{margin:8px 0;font-size:13px}
.ok{color:#7fd4a8}.err{color:#ff8a80}
</style></head><body><div class="wrap">
<h1>📚 إدارة أسئلة قمّة الهرم</h1>
<div style="margin:4px 0 10px;font-size:13px"><a href="ADMIN_URL" style="color:#8fd3ff;text-decoration:none;margin-inline-end:14px">← لوحة المراقبة</a><a href="ADMIN_URL/v" style="color:#8fd3ff;text-decoration:none;margin-inline-end:14px">🔊 صوت قراءة الأسئلة</a><a href="ADMIN_URL/vo" style="color:#8fd3ff;text-decoration:none">🎙️ أصوات المعلّق</a></div>
<div class="sub" id="tot">…</div>

<div class="card" id="rpCard" style="display:none">
  <div class="bar" style="margin:0 0 8px">
    <h3 style="font-size:15px">🚩 بلاغات اللاعبين <span class="tag" id="rpN">0</span></h3>
    <span style="flex:1"></span>
    <button class="s r" onclick="rpClear()">مسح الكل</button>
  </div>
  <div id="rpList"></div>
</div>

<div class="card"><div class="cats" id="cats"></div></div>

<div class="card">
  <div class="bar">
    <input type="search" id="q" placeholder="ابحث في السؤال أو الخيارات…">
    <select id="f">
      <option value="all">الكل</option>
      <option value="custom">المخصصة</option>
      <option value="edited">المعدَّلة</option>
      <option value="img">المصوّرة</option>
      <option value="off">المعطّلة</option>
    </select>
    <button onclick="loadCat(0)">بحث</button>
    <button class="g" onclick="openNew()">+ سؤال جديد</button>
    <button class="s" onclick="location.href='ADMIN_URL/q/export'">تصدير JSON</button>
    <button class="s" onclick="document.getElementById('imp').style.display='block'">استيراد</button>
  </div>
  <div id="msg"></div>
  <div id="list"></div>
  <div class="pag" id="pag"></div>
</div>

<div class="card" id="ed" style="display:none">
  <h3 id="edTitle">تعديل سؤال</h3>
  <div class="row" style="margin-top:8px">
    <div class="full"><label>نص السؤال</label><input type="text" id="eq" style="width:100%"></div>
    <div><label>الإجابة الصحيحة</label><input type="text" id="e1" style="width:100%"></div>
    <div><label>خطأ ١</label><input type="text" id="e2" style="width:100%"></div>
    <div><label>خطأ ٢</label><input type="text" id="e3" style="width:100%"></div>
    <div><label>خطأ ٣</label><input type="text" id="e4" style="width:100%"></div>
    <div><label>الصعوبة</label><select id="ed_d" style="width:100%"><option value="1">سهل</option><option value="2">متوسط</option><option value="3">صعب</option></select></div>
    <div><label>الفئة</label><select id="ec" style="width:100%"></select></div>
    <div class="full"><label>الصورة (اختياري)</label>
      <div class="bar" style="margin:0">
        <input type="text" id="ei" placeholder="/qimg/... أو رابط صورة" style="flex:1">
        <input type="file" id="ef" accept="image/*" style="max-width:230px">
        <button class="s" onclick="clearImg()">إزالة</button>
      </div>
      <img id="ep" class="thumb" style="display:none">
    </div>
  </div>
  <div class="bar">
    <button class="g" onclick="save()">حفظ</button>
    <button class="s" onclick="closeEd()">إلغاء</button>
    <span id="edMsg"></span>
  </div>
</div>

<div class="card" id="imp" style="display:none">
  <h3>استيراد جماعي</h3>
  <div class="sub">سطر لكل سؤال: السؤال | الصحيحة | خطأ | خطأ | خطأ | الصعوبة | الفئة — أو JSON</div>
  <textarea id="impTxt" rows="7" style="width:100%"></textarea>
  <div class="bar"><select id="impCat"></select><button class="g" onclick="doImport()">استيراد</button>
  <button class="s" onclick="document.getElementById('imp').style.display='none'">إغلاق</button></div>
  <div id="impMsg"></div>
</div>

<script>
const B="ADMIN_URL/q";
let CATS=[],CUR="",PAGE=0,EDIT=null;
const $=i=>document.getElementById(i);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function api(p,b){const r=await fetch(B+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});return r.json();}

async function load(){
  const d=await (await fetch(B+"/list")).json();
  CATS=d.cats;
  $("tot").textContent="المجموع الفعّال: "+d.total+" سؤال · معطّلة: "+d.removed+" · معدّلة: "+d.edited+" · تحديات: "+d.links+" ربط و"+d.sorts+" تصنيف";
  $("cats").innerHTML=d.cats.map(c=>'<div class="cat'+(c.cat===CUR?" on":"")+'" onclick="pick(\\''+esc(c.cat)+'\\')">'+esc(c.cat)+' <b>'+c.active+'</b>'+(c.imgs?' 🖼'+c.imgs:'')+'</div>').join("");
  const opts=d.cats.map(c=>'<option>'+esc(c.cat)+'</option>').join("");
  $("ec").innerHTML=opts;$("impCat").innerHTML=opts;
  if(!CUR&&d.cats.length){CUR=d.cats[0].cat;loadCat(0);load2();}
}
function load2(){$("cats").querySelectorAll(".cat").forEach(e=>e.classList.toggle("on",e.textContent.trim().startsWith(CUR)));}
function pick(c){CUR=c;PAGE=0;load2();loadCat(0);}

async function loadCat(p){
  if(p!==undefined)PAGE=p;
  const u=B+"/cat?c="+encodeURIComponent(CUR)+"&s="+encodeURIComponent($("q").value)+"&f="+$("f").value+"&p="+PAGE;
  const d=await (await fetch(u)).json();
  $("list").innerHTML=d.items.map(it=>{
    const qq=esc(it.q).replace(/'/g,"\\'");
    const dataAttr=encodeURIComponent(JSON.stringify(it));
    return '<div class="item'+(it.off?" off":"")+'">'+
      '<div class="qt">'+esc(it.q)+'</div>'+
      (it.img?'<img class="thumb" src="'+esc(it.img)+'">':'')+
      '<div class="opts">'+it.a.map((a,i)=>'<span class="opt'+(i===0?" ok":"")+'">'+esc(a)+'</span>').join("")+'</div>'+
      '<div class="meta"><span class="tag'+(it.src==="مخصص"?" x":"")+'">'+it.src+'</span>'+
      '<span class="tag">صعوبة '+it.d+'</span>'+
      (it.edited?'<span class="tag e">معدَّل</span>':'')+
      (it.img?'<span class="tag i">صورة</span>':'')+
      '<button class="s" onclick=\\'openEd('+JSON.stringify(it).replace(/'/g,"&#39;")+')\\'>تعديل</button>'+
      '<button class="s" onclick="tog(\\''+qq+'\\')">'+(it.off?"تفعيل":"تعطيل")+'</button>'+
      (it.src==="مخصص"?'<button class="s r" onclick="del(\\''+qq+'\\')">حذف</button>':'')+
      (it.edited?'<button class="s" onclick="reset(\\''+qq+'\\')">إلغاء التعديل</button>':'')+
      '</div></div>';
  }).join("")||'<div class="sub">لا نتائج</div>';
  let pg="";
  for(let i=0;i<d.pages&&i<30;i++)pg+='<button class="s" style="'+(i===d.page?"background:#2f7ad6":"")+'" onclick="loadCat('+i+')">'+(i+1)+'</button>';
  $("pag").innerHTML=d.pages>1?pg:"";
  $("msg").innerHTML='<span class="ok">'+d.total+' سؤال في «'+esc(CUR)+'»</span>';
}

function openNew(){EDIT=null;$("edTitle").textContent="سؤال جديد";$("eq").value="";$("e1").value="";$("e2").value="";$("e3").value="";$("e4").value="";$("ed_d").value="1";$("ei").value="";$("ep").style.display="none";$("ec").value=CUR;$("ed").style.display="block";$("edMsg").textContent="";window.scrollTo(0,document.body.scrollHeight);}
function openEd(btn){
  const it=JSON.parse(decodeURIComponent(btn.dataset.it));
  EDIT=it.q;$("edTitle").textContent="تعديل سؤال";$("eq").value=it.q;$("e1").value=it.a[0];$("e2").value=it.a[1];$("e3").value=it.a[2];$("e4").value=it.a[3];$("ed_d").value=it.d;$("ei").value=it.img||"";$("ec").value=CUR;
  if(it.img){$("ep").src=it.img;$("ep").style.display="block";}else $("ep").style.display="none";
  $("ed").style.display="block";$("edMsg").textContent="";$("ed").scrollIntoView({behavior:"smooth"});}
function closeEd(){$("ed").style.display="none";EDIT=null;}
function clearImg(){$("ei").value="";$("ep").style.display="none";$("ef").value="";}

$("ef").onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  $("edMsg").innerHTML="جارٍ الرفع…";
  const rd=new FileReader();
  rd.onload=async()=>{
    const r=await api("/img",{data:rd.result});
    if(r.ok){$("ei").value=r.url;$("ep").src=r.url;$("ep").style.display="block";$("edMsg").innerHTML='<span class="ok">تم رفع الصورة</span>';}
    else $("edMsg").innerHTML='<span class="err">'+esc(r.error||"فشل الرفع")+'</span>';
  };
  rd.readAsDataURL(f);
};

async function save(){
  const b={q:$("eq").value,a1:$("e1").value,a2:$("e2").value,a3:$("e3").value,a4:$("e4").value,
    d:+$("ed_d").value,cat:$("ec").value,img:$("ei").value};
  let r;
  if(EDIT){b.orig=EDIT;r=await api("/edit",b);}else r=await api("/add",b);
  if(r.ok){$("edMsg").innerHTML='<span class="ok">تم الحفظ</span>';closeEd();load();loadCat();}
  else $("edMsg").innerHTML='<span class="err">'+esc(r.error||"خطأ")+'</span>';
}
async function tog(q){await api("/toggle",{q});load();loadCat();}
async function del(q){if(!confirm("حذف نهائي؟"))return;await api("/del",{q});load();loadCat();}
async function reset(q){await api("/reset",{q});load();loadCat();}
async function doImport(){
  const r=await api("/import",{text:$("impTxt").value,cat:$("impCat").value});
  $("impMsg").innerHTML=r.ok?'<span class="ok">أُضيف '+r.added+' · مكرر '+r.dup+'</span>'+(r.errors&&r.errors.length?'<div class="err">'+r.errors.slice(0,8).map(esc).join("<br>")+'</div>':''):'<span class="err">'+esc(r.error||"خطأ")+'</span>';
  load();loadCat();
}
$("q").addEventListener("keydown",e=>{if(e.key==="Enter")loadCat(0);});

/* ═══ 🚩 البلاغات ═══ */
let RP=[];
async function loadReports(){
  const d=await (await fetch(B+"/reports")).json();
  RP=d.reports||[];
  $("rpCard").style.display=RP.length?"block":"none";
  $("rpN").textContent=RP.length;
  $("rpList").innerHTML=RP.map(r=>{
    const dt=new Date(r.at).toLocaleString("ar",{dateStyle:"short",timeStyle:"short"});
    return '<div class="item"><div class="qt">'+esc(r.q||"(بلاغ عام بلا سؤال)")+'</div>'+
      (r.row?'<div class="opts">'+r.row.a.map((a,i)=>'<span class="opt'+(i===0?" ok":"")+'">'+esc(a)+'</span>').join("")+'</div>':
        (r.q?'<div class="sub">⚠ السؤال غير موجود في البنك حاليًا (رُبّما حُذف أو عُدّل نصّه)</div>':""))+
      ((r.reasons&&r.reasons.length)?'<div class="sub">💬 '+r.reasons.map(esc).join(" · ")+'</div>':'')+
      '<div class="meta"><span class="tag">'+dt+'</span>'+
      (r.n>1?'<span class="tag x">بلّغ عنه '+r.n+'</span>':'')+
      (r.cat?'<span class="tag">'+esc(r.cat)+'</span>':'')+
      (r.room?'<span class="tag">غرفة '+esc(r.room)+'</span>':'')+
      (r.row?'<button class="s" onclick="rpEdit(\\''+r.id+'\\')">✏ فتح في المحرّر</button>'+
             '<button class="s" onclick="rpOff(\\''+r.id+'\\')">⛔ تعطيل السؤال</button>':'')+
      '<button class="s r" onclick="rpDel(\\''+r.id+'\\')">تمّت المعالجة ✓</button>'+
      '</div></div>';
  }).join("");
}
function rpFind(id){return RP.find(r=>r.id===id);}
function rpEdit(id){
  const r=rpFind(id);if(!r||!r.row)return;
  EDIT=r.q;$("edTitle").textContent="تعديل سؤال (من بلاغ)";
  $("eq").value=r.q;$("e1").value=r.row.a[0];$("e2").value=r.row.a[1];
  $("e3").value=r.row.a[2];$("e4").value=r.row.a[3];$("ed_d").value=r.row.d;
  $("ei").value=r.row.img||"";$("ec").value=r.cat||CUR;
  if(r.row.img){$("ep").src=r.row.img;$("ep").style.display="block";}else $("ep").style.display="none";
  $("ed").style.display="block";$("edMsg").textContent="";
  $("ed").scrollIntoView({behavior:"smooth"});
}
async function rpOff(id){
  const r=rpFind(id);if(!r)return;
  await api("/toggle",{q:r.q});
  await api("/report-del",{id});
  loadReports();load();loadCat();
}
async function rpDel(id){await api("/report-del",{id});loadReports();}
async function rpClear(){if(!confirm("مسح كل البلاغات؟"))return;await api("/report-del",{id:"*"});loadReports();}
loadReports();
load();
</script></div></body></html>`.replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupQuestionAdmin, parseBulk, validateRow };
