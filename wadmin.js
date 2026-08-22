// 💬 لوحة إدارة كلمات لعبة القنبلة
// الكلمات التي كتبها اللاعبون ولم يجدها القاموس تصل هنا للمراجعة.
// تُركَّب تحت نفس المسار السري للوحة المراقبة وتستعمل نفس الجلسة.
const { ADMIN_PATH, adminEnabled, verifySession, parseCookies } = require("./admin");

function readJson(req, limit = 2e6) {
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

function setupWordAdmin(app, deps) {
  const { getBank } = deps;
  if (!adminEnabled) return null;

  const guard = (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); res.end("forbidden"); return false; }
    return true;
  };
  const bank = () => (getBank && getBank()) || null;

  app.get(ADMIN_PATH + "/w", (req, res) => { if (!guard(req, res)) return; html(res, page()); });

  app.get(ADMIN_PATH + "/w/list", (req, res) => {
    if (!guard(req, res)) return;
    const b = bank();
    if (!b) return json(res, 200, { ok: false, msg: "بنك الكلمات غير جاهز" });
    json(res, 200, { ok: true, pending: b.list(), counts: b.counts(), approved: b.approvedList().slice(-400).reverse() });
  });

  app.post(ADMIN_PATH + "/w/approve", async (req, res) => {
    if (!guard(req, res)) return;
    const b = bank(); const body = await readJson(req);
    if (!b || !body) return json(res, 400, { ok: false });
    json(res, 200, { ok: true, n: b.approve(body.words || []) });
  });

  app.post(ADMIN_PATH + "/w/reject", async (req, res) => {
    if (!guard(req, res)) return;
    const b = bank(); const body = await readJson(req);
    if (!b || !body) return json(res, 400, { ok: false });
    json(res, 200, { ok: true, n: b.reject(body.words || []) });
  });

  app.post(ADMIN_PATH + "/w/add", async (req, res) => {
    if (!guard(req, res)) return;
    const b = bank(); const body = await readJson(req);
    if (!b || !body) return json(res, 400, { ok: false });
    const words = String(body.text || "").split(/[\s,،\n]+/).filter(Boolean);
    json(res, 200, { ok: true, n: b.addDirect(words) });
  });

  app.post(ADMIN_PATH + "/w/removeApproved", async (req, res) => {
    if (!guard(req, res)) return;
    const b = bank(); const body = await readJson(req);
    if (!b || !body) return json(res, 400, { ok: false });
    json(res, 200, { ok: true, n: b.removeApproved(body.words || []) });
  });

  console.log("💬 إدارة كلمات القنبلة مفعّلة على " + ADMIN_PATH + "/w");
  return true;
}

function page() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>💬 كلمات القنبلة</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;font-family:"Segoe UI",Tahoma,sans-serif;background:#0e1b2c;color:#eaf2fb;padding:14px}
 h1{font-size:20px;margin:0 0 4px}
 .sub{color:#8fa8c4;font-size:13px;margin-bottom:14px}
 .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
 .btn{border:none;border-radius:10px;padding:9px 15px;font-weight:800;cursor:pointer;font-family:inherit;font-size:14px;color:#fff}
 .g{background:#2e9e5b}.r{background:#e5484d}.b{background:#1668c7}.gh{background:#22354d;color:#cfe0f2}
 .card{background:#15263c;border-radius:14px;padding:14px;margin-bottom:14px}
 table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{padding:8px 6px;text-align:start;border-bottom:1px solid #22354d}
 th{color:#8fa8c4;font-size:12px;font-weight:700}
 .w{font-size:17px;font-weight:900}
 .by{color:#8fa8c4;font-size:12px}
 .cnt{background:#1668c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:900}
 input[type=checkbox]{width:18px;height:18px}
 textarea{width:100%;min-height:70px;background:#0e1b2c;color:#eaf2fb;border:2px solid #22354d;border-radius:10px;padding:10px;font-family:inherit;font-size:15px}
 .chip{display:inline-flex;align-items:center;gap:6px;background:#1c3049;border-radius:999px;padding:4px 11px;margin:3px;font-size:13px}
 .chip button{border:none;background:none;color:#ff9a9a;cursor:pointer;font-size:14px;padding:0}
 .empty{color:#8fa8c4;text-align:center;padding:18px}
</style></head><body>
<h1>💬 كلمات القنبلة</h1>
<div class="sub">كلمات كتبها اللاعبون ولم يجدها القاموس — اقبلها لتُضاف فوراً للعبة.</div>

<div class="card">
  <div class="bar">
    <b id="cnt">…</b>
    <button class="btn gh" onclick="load()">🔄 تحديث</button>
    <button class="btn gh" onclick="sel(true)">تحديد الكل</button>
    <button class="btn gh" onclick="sel(false)">إلغاء التحديد</button>
    <button class="btn g" onclick="act('approve')">✅ قبول المحدد</button>
    <button class="btn r" onclick="act('reject')">✖️ رفض المحدد</button>
  </div>
  <table><thead><tr><th style="width:34px"></th><th>الكلمة</th><th style="width:70px">مرات</th><th>من كتبها</th></tr></thead>
  <tbody id="rows"><tr><td colspan="4" class="empty">جارٍ التحميل…</td></tr></tbody></table>
</div>

<div class="card">
  <b>➕ إضافة كلمات مباشرة</b>
  <div class="sub">افصل بمسافة أو سطر جديد</div>
  <textarea id="addBox" placeholder="مثال: شاورما كنبة لابتوب"></textarea>
  <div class="bar" style="margin-top:8px"><button class="btn b" onclick="addWords()">إضافة للقاموس</button></div>
</div>

<div class="card">
  <b>✅ الكلمات المعتمدة</b> <span class="sub" id="apCnt"></span>
  <div id="approved" style="margin-top:8px"></div>
</div>

<script>
const U = "ADMIN_URL/w";
let PEND = [];
async function load(){
  const r = await fetch(U+"/list");
  if(r.status===403){location.href="ADMIN_URL";return;}
  const d = await r.json();
  if(!d.ok){ document.getElementById("cnt").textContent = d.msg||"غير جاهز"; return; }
  PEND = d.pending;
  document.getElementById("cnt").textContent = "بالانتظار: "+d.counts.pending+" • معتمدة: "+d.counts.approved+" • مرفوضة: "+d.counts.rejected;
  document.getElementById("apCnt").textContent = "("+d.counts.approved+")";
  const tb = document.getElementById("rows");
  tb.innerHTML = PEND.length ? PEND.map(function(e){
    return '<tr><td><input type="checkbox" value="'+e.word+'"></td>'+
      '<td class="w">'+e.word+'</td>'+
      '<td><span class="cnt">'+e.count+'</span></td>'+
      '<td class="by">'+(e.by||[]).join("، ")+'</td></tr>';
  }).join("") : '<tr><td colspan="4" class="empty">لا توجد كلمات بالانتظار 👌</td></tr>';
  document.getElementById("approved").innerHTML = (d.approved||[]).map(function(w){
    return '<span class="chip">'+w+'<button title="حذف" onclick="delApproved(&quot;'+w+'&quot;)">✖</button></span>';
  }).join("") || '<div class="empty">لا شيء بعد</div>';
}
function sel(v){ document.querySelectorAll("#rows input[type=checkbox]").forEach(function(c){ c.checked=v; }); }
function picked(){ return [...document.querySelectorAll("#rows input:checked")].map(function(c){ return c.value; }); }
async function act(kind){
  const words = picked();
  if(!words.length) return alert("حدد كلمات أولاً");
  await fetch(U+"/"+kind, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({words:words})});
  load();
}
async function addWords(){
  const t = document.getElementById("addBox").value.trim();
  if(!t) return;
  const r = await fetch(U+"/add", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})});
  const d = await r.json();
  document.getElementById("addBox").value = "";
  alert("أُضيفت "+(d.n||0)+" كلمة");
  load();
}
async function delApproved(w){
  await fetch(U+"/removeApproved", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({words:[w]})});
  load();
}
load(); setInterval(load, 20000);
</scr" + "ipt></body></html>`.replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupWordAdmin };
