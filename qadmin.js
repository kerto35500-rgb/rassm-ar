// 📚 لوحة إدارة أسئلة «قمّة الهرم»
// تُركَّب تحت نفس المسار السري للوحة المراقبة وتستعمل نفس الجلسة.
const { ADMIN_PATH, adminEnabled, verifySession, parseCookies } = require("./admin");
const qbank = require("./qbank");

function readJson(req, limit = 4e6) {
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
  if (!adminEnabled) return null;

  // الحالة المحفوظة: { extra: {فئة:[صفوف]}, removed: [نصوص] }
  let bank = { extra: {}, removed: [] };
  let saveTimer = null;

  store.getKV("quizBank").then(v => {
    if (v) {
      bank = { extra: v.extra || {}, removed: v.removed || [] };
      qbank.setExtra(bank.extra);
      qbank.setRemoved(bank.removed);
      const n = Object.values(bank.extra).flat().length;
      if (n) console.log(`📚 أسئلة مخصصة محمّلة: ${n}`);
    }
  }).catch(() => {});

  function persist() {
    qbank.setExtra(bank.extra);
    qbank.setRemoved(bank.removed);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.saveKV("quizBank", bank).catch(e => console.error("qbank save:", e.message)), 800);
  }

  const guard = (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); res.end("forbidden"); return false; }
    return true;
  };

  // صفحة الإدارة
  app.get(ADMIN_PATH + "/q", (req, res) => {
    if (!guard(req, res)) return;
    html(res, page());
  });

  // قائمة الأسئلة
  app.get(ADMIN_PATH + "/q/list", (req, res) => {
    if (!guard(req, res)) return;
    const cats = qbank.categories().map(c => {
      const base = (qbank.BANK[c] || []).length;
      const extra = (bank.extra[c] || []).length;
      const active = qbank.poolOf(c).length;
      return { cat: c, base, extra, active };
    });
    json(res, 200, {
      total: qbank.countAll(),
      removed: bank.removed.length,
      cats,
      links: qbank.LINKS.length,
      sorts: qbank.SORTS.length
    });
  });

  // أسئلة فئة معيّنة
  app.get(ADMIN_PATH + "/q/cat", (req, res) => {
    if (!guard(req, res)) return;
    const url = new URL(req.url, "http://x");
    const c = url.searchParams.get("c") || "";
    const base = (qbank.BANK[c] || []).map(r => ({ q: r[0], a: r.slice(1, 5), d: r[5], src: "أساسي", off: bank.removed.includes(r[0]) }));
    const extra = (bank.extra[c] || []).map(r => ({ q: r[0], a: r.slice(1, 5), d: r[5], src: "مخصص", off: bank.removed.includes(r[0]) }));
    json(res, 200, { cat: c, items: [...extra, ...base] });
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

  // تعطيل/تفعيل سؤال
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

  // حذف سؤال مخصص نهائياً
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

  function allTexts() {
    const s = new Set();
    qbank.categories().forEach(c => qbank.poolOf(c).forEach(r => s.add(r[0])));
    Object.values(bank.extra).flat().forEach(r => s.add(r[0]));
    return s;
  }

  console.log("📚 إدارة الأسئلة مفعّلة على " + ADMIN_PATH + "/q");
  return { bank, persist };
}

// ====== تحقق وتحليل ======
function validateRow(b) {
  const q = String(b.q || "").trim();
  const opts = [b.a1, b.a2, b.a3, b.a4].map(x => String(x == null ? "" : x).trim());
  const d = Number(b.d) || 1;
  if (q.length < 5) return { ok: false, error: "نص السؤال قصير جداً" };
  if (opts.some(o => !o)) return { ok: false, error: "كل الخيارات الأربعة مطلوبة" };
  if (new Set(opts).size !== 4) return { ok: false, error: "الخيارات مكررة" };
  if (![1, 2, 3].includes(d)) return { ok: false, error: "الصعوبة يجب أن تكون 1 أو 2 أو 3" };
  return { ok: true, row: [q, opts[0], opts[1], opts[2], opts[3], d] };
}

/**
 * تحليل الاستيراد الجماعي.
 * يقبل سطراً لكل سؤال بصيغة:
 *   السؤال | الإجابة الصحيحة | خطأ | خطأ | خطأ | الصعوبة | الفئة
 * الصعوبة والفئة اختياريتان. الفاصل | أو ، أو تبويب.
 * ويقبل أيضاً JSON: مصفوفة كائنات {q,a1..a4,d,cat} أو مصفوفة مصفوفات.
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
          row = validateRow({ q: it[0], a1: it[1], a2: it[2], a3: it[3], a4: it[4], d: it[5] || 1 });
          if (it[6]) cat = String(it[6]).trim();
        } else {
          row = validateRow({ q: it.q || it.question, a1: it.a1 || (it.a && it.a[0]), a2: it.a2 || (it.a && it.a[1]),
            a3: it.a3 || (it.a && it.a[2]), a4: it.a4 || (it.a && it.a[3]), d: it.d || it.diff || 1 });
          if (it.cat || it.category) cat = String(it.cat || it.category).trim();
        }
        if (!row.ok) errors.push(`عنصر ${i + 1}: ${row.error}`);
        else rows.push({ cat: cat || "عام", row: row.row });
      });
    } catch (e) { errors.push("JSON غير صالح: " + e.message); }
    return { rows, errors };
  }
  t.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return;
    const parts = s.split(/\s*[|\t]\s*|\s*،\s*/).map(x => x.trim()).filter((x, idx) => idx < 7);
    if (parts.length < 5) { errors.push(`سطر ${i + 1}: يحتاج على الأقل سؤال + ٤ خيارات`); return; }
    const d = parts[5] ? Number(parts[5]) : 1;
    const v = validateRow({ q: parts[0], a1: parts[1], a2: parts[2], a3: parts[3], a4: parts[4], d: [1, 2, 3].includes(d) ? d : 1 });
    if (!v.ok) { errors.push(`سطر ${i + 1}: ${v.error}`); return; }
    rows.push({ cat: (parts[6] || defaultCat || "عام").trim(), row: v.row });
  });
  return { rows, errors };
}

// ====== الصفحة ======
function page() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>إدارة الأسئلة</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{background:#0f1c2e;color:#e8eef6;padding:16px}
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px}.sub{opacity:.6;font-size:13px;margin-bottom:16px}
a.back{color:#7fb5ff;font-size:13px;text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.kpi{background:#16273d;border-radius:12px;padding:14px}
.kpi b{display:block;font-size:26px}.kpi span{font-size:12px;opacity:.65}
.card{background:#16273d;border-radius:14px;padding:16px;margin-bottom:14px}
.card h2{font-size:16px;margin-bottom:12px}
input,select,textarea{width:100%;padding:10px 12px;border:2px solid #27405f;background:#0f1c2e;color:#e8eef6;border-radius:9px;font-size:14px;margin-bottom:8px;font-family:inherit}
input:focus,select:focus,textarea:focus{outline:none;border-color:#5b9bff}
textarea{min-height:150px;resize:vertical;line-height:1.7}
button{padding:10px 18px;border:none;border-radius:9px;background:#2f6fd0;color:#fff;font-weight:800;cursor:pointer;font-size:14px}
button:hover{filter:brightness(1.1)}button.g{background:#2e9e5b}button.r{background:#c0392b}button.s{padding:5px 10px;font-size:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.msg{font-size:13px;margin-top:8px;min-height:18px}
.ok{color:#5fd08a}.bad{color:#ff8a8a}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:right;padding:7px 6px;border-bottom:1px solid #22344e}
th{opacity:.6;font-weight:600;font-size:12px}
tr.off{opacity:.42}
.tag{font-size:10.5px;padding:2px 7px;border-radius:99px;background:#27405f}
.tag.x{background:#2e9e5b}
.hint{font-size:12px;opacity:.6;line-height:1.7;margin-bottom:8px}
code{background:#0b1524;padding:2px 6px;border-radius:5px;font-size:12px}
</style></head><body><div class="wrap">
<a class="back" href="ADMIN_URL">← لوحة المراقبة</a>
<h1>📚 إدارة أسئلة قمّة الهرم</h1>
<div class="sub">أضف أسئلة، عطّل الخاطئة، واستورد دفعات كاملة</div>

<div class="grid" id="kpis"></div>

<div class="card">
  <h2>➕ إضافة سؤال</h2>
  <input id="q" placeholder="نص السؤال">
  <div class="row">
    <input id="a1" placeholder="✔ الإجابة الصحيحة">
    <input id="a2" placeholder="خيار خاطئ">
  </div>
  <div class="row">
    <input id="a3" placeholder="خيار خاطئ">
    <input id="a4" placeholder="خيار خاطئ">
  </div>
  <div class="row">
    <select id="cat"></select>
    <select id="d"><option value="1">سهل</option><option value="2">متوسط</option><option value="3">صعب</option></select>
  </div>
  <button onclick="addQ()">إضافة</button>
  <div class="msg" id="m1"></div>
</div>

<div class="card">
  <h2>📥 استيراد دفعة واحدة</h2>
  <div class="hint">
    سطر لكل سؤال، الحقول مفصولة بـ <code>|</code> :<br>
    <code>السؤال | الصحيحة | خطأ | خطأ | خطأ | الصعوبة | الفئة</code><br>
    الصعوبة (1-3) والفئة اختياريتان. ويُقبل أيضاً لصق JSON مباشرة.
  </div>
  <select id="icat"></select>
  <textarea id="bulk" placeholder="ما عاصمة اليابان؟ | طوكيو | سيول | بكين | بانكوك | 1 | جغرافيا&#10;كم عدد أيام الأسبوع؟ | سبعة | ستة | خمسة | ثمانية | 1 | عام"></textarea>
  <button class="g" onclick="imp()">استيراد</button>
  <div class="msg" id="m2"></div>
</div>

<div class="card">
  <h2>🗂️ تصفح وتعديل</h2>
  <select id="browse" onchange="loadCat()"></select>
  <div id="tbl"></div>
</div>

<script>
const B="ADMIN_URL/q";
function esc(s){const d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML;}
async function api(p,body){
  const r=await fetch(B+p,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
  return r.json();
}
let CATS=[];
async function load(){
  const d=await api("/list");
  CATS=d.cats.map(c=>c.cat);
  document.getElementById("kpis").innerHTML=
    '<div class="kpi"><b>'+d.total+'</b><span>سؤال فعّال</span></div>'+
    '<div class="kpi"><b>'+d.cats.length+'</b><span>فئة</span></div>'+
    '<div class="kpi"><b>'+d.removed+'</b><span>معطّل</span></div>'+
    '<div class="kpi"><b>'+d.links+'</b><span>جولة ربط</span></div>'+
    '<div class="kpi"><b>'+d.sorts+'</b><span>جولة تصنيف</span></div>';
  const opts=CATS.map(c=>'<option>'+esc(c)+'</option>').join("");
  ["cat","icat","browse"].forEach(id=>{
    const el=document.getElementById(id),v=el.value;
    el.innerHTML=opts+(id==="cat"||id==="icat"?'<option value="__new">➕ فئة جديدة…</option>':"");
    if(v)el.value=v;
  });
  const tb=document.getElementById("tbl");
  if(!tb.dataset.loaded){tb.dataset.loaded="1";loadCat();}
}
["cat","icat"].forEach(id=>document.getElementById(id).addEventListener("change",e=>{
  if(e.target.value==="__new"){
    const n=prompt("اسم الفئة الجديدة:");
    if(n){const o=document.createElement("option");o.textContent=n;e.target.insertBefore(o,e.target.firstChild);e.target.value=n;}
    else e.target.value=CATS[0]||"";
  }
}));
async function addQ(){
  const b={q:val("q"),a1:val("a1"),a2:val("a2"),a3:val("a3"),a4:val("a4"),cat:document.getElementById("cat").value,d:+document.getElementById("d").value};
  const r=await api("/add",b);
  const m=document.getElementById("m1");
  if(r.ok){m.className="msg ok";m.textContent="✅ أُضيف — الإجمالي "+r.total;["q","a1","a2","a3","a4"].forEach(i=>document.getElementById(i).value="");load();loadCat();}
  else{m.className="msg bad";m.textContent="❌ "+r.error;}
}
function val(id){return document.getElementById(id).value.trim();}
async function imp(){
  const r=await api("/import",{text:document.getElementById("bulk").value,cat:document.getElementById("icat").value});
  const m=document.getElementById("m2");
  if(!r.ok){m.className="msg bad";m.textContent="❌ "+(r.error||"فشل");return;}
  m.className="msg ok";
  m.innerHTML="✅ أُضيف "+r.added+" سؤال · متكرر "+r.dup+" · الإجمالي "+r.total+
    (r.errors&&r.errors.length?'<div class="bad" style="margin-top:6px">'+r.errors.slice(0,8).map(esc).join("<br>")+(r.errors.length>8?"<br>…و"+(r.errors.length-8)+" أخرى":"")+'</div>':"");
  if(r.added){document.getElementById("bulk").value="";load();loadCat();}
}
async function loadCat(){
  const c=document.getElementById("browse").value;
  if(!c)return;
  const d=await api("/cat?c="+encodeURIComponent(c));
  document.getElementById("tbl").innerHTML='<table><tr><th>السؤال</th><th>الصحيحة</th><th>صعوبة</th><th>المصدر</th><th></th></tr>'+
    d.items.map(it=>'<tr class="'+(it.off?"off":"")+'"><td>'+esc(it.q)+'</td><td>'+esc(it.a[0])+'</td><td>'+["","سهل","متوسط","صعب"][it.d]+
      '</td><td><span class="tag '+(it.src==="مخصص"?"x":"")+'">'+it.src+'</span></td><td style="white-space:nowrap">'+
      '<button class="s" onclick="tog(\\''+esc(it.q).replace(/'/g,"\\\\'")+'\\')">'+(it.off?"تفعيل":"تعطيل")+'</button> '+
      (it.src==="مخصص"?'<button class="s r" onclick="del(\\''+esc(it.q).replace(/'/g,"\\\\'")+'\\')">حذف</button>':"")+
      '</td></tr>').join("")+'</table>';
}
async function tog(q){await api("/toggle",{q});load();loadCat();}
async function del(q){if(!confirm("حذف نهائي؟"))return;await api("/del",{q});load();loadCat();}
load();
</script></div></body></html>`.replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupQuestionAdmin, parseBulk, validateRow };
