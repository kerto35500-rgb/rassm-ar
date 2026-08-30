// 🔊 لوحة تحكم أصوات الأسئلة — تُركَّب تحت نفس المسار السري للوحة المراقبة.
const { ADMIN_PATH, verifySession, parseCookies } = require("./admin");
const qbank = require("./qbank");

function readJson(req, limit = 2e5) {
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

function setupVoiceAdmin(app, deps) {
  const { tts } = deps;
  const guard = (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); res.end("forbidden"); return false; }
    return true;
  };

  app.get(ADMIN_PATH + "/v", (req, res) => {
    if (!guard(req, res)) return;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
    res.end(PAGE.replace(/ADMIN_URL/g, ADMIN_PATH));
  });

  app.get(ADMIN_PATH + "/v/stats", async (req, res) => {
    if (!guard(req, res)) return;
    try { json(res, 200, await tts.stats()); }
    catch (e) { json(res, 500, { error: e.message }); }
  });

  app.get(ADMIN_PATH + "/v/job", (req, res) => {
    if (!guard(req, res)) return;
    json(res, 200, tts.job());
  });

  app.post(ADMIN_PATH + "/v/build", async (req, res) => {
    if (!guard(req, res)) return;
    if (!tts.hasKey()) return json(res, 400, { error: "ELEVEN_KEY غير مضبوط في إعدادات الخادم" });
    if (tts.job().running) return json(res, 400, { error: "هناك مهمة تعمل بالفعل" });
    const v = await readJson(req) || {};
    const cats = Array.isArray(v.cats) ? v.cats.filter(c => qbank.categories().includes(c)) : [];
    tts.startBuild({
      cats,
      limit: Math.max(0, Math.min(6000, Number(v.limit) || 0)),
      budget: Math.max(0, Math.min(2e6, Number(v.budget) || 0)),
      force: !!v.force,
      concurrency: Math.max(1, Math.min(4, Number(v.concurrency) || 3))
    });
    json(res, 200, { ok: true });
  });

  app.post(ADMIN_PATH + "/v/stop", (req, res) => {
    if (!guard(req, res)) return;
    tts.stop();
    json(res, 200, { ok: true });
  });

  app.post(ADMIN_PATH + "/v/preview", async (req, res) => {
    if (!guard(req, res)) return;
    if (!tts.hasKey()) return json(res, 400, { error: "ELEVEN_KEY غير مضبوط" });
    const v = await readJson(req) || {};
    const t = String(v.text || "").trim();
    if (!t) return json(res, 400, { error: "أرسل نصًا" });
    try { json(res, 200, await tts.previewOne(t)); }
    catch (e) { json(res, 500, { error: e.message }); }
  });

  app.post(ADMIN_PATH + "/v/clear", async (req, res) => {
    if (!guard(req, res)) return;
    if (tts.job().running) return json(res, 400, { error: "أوقف المهمة أولًا" });
    try { json(res, 200, { removed: await tts.clear() }); }
    catch (e) { json(res, 500, { error: e.message }); }
  });

  console.log("🔊 لوحة الأصوات مفعّلة على " + ADMIN_PATH + "/v");
}

const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>أصوات الأسئلة</title>
<style>
:root{--bg:#0e0b16;--card:#191330;--line:#2f2650;--ink:#efeaff;--dim:#a79dc9;--c1:#8b5cf6;--ok:#34d399;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Segoe UI",Tahoma,sans-serif;padding:18px}
a{color:var(--c1)}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--dim);font-size:13px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.kpi div{background:#120e22;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:20px}
.kpi span{color:var(--dim);font-size:12px}
button{background:var(--c1);color:#fff;border:0;border-radius:9px;padding:9px 16px;font:inherit;cursor:pointer}
button.ghost{background:#241c44;color:var(--ink);border:1px solid var(--line)}
button.danger{background:#7f1d1d}
button:disabled{opacity:.45;cursor:not-allowed}
input,select{background:#120e22;color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:8px 11px;font:inherit}
input[type=text]{min-width:260px}
.bar{height:12px;background:#120e22;border:1px solid var(--line);border-radius:99px;overflow:hidden;margin:10px 0}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#8b5cf6,#22d3ee);width:0;transition:width .4s}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right}
th{color:var(--dim);font-weight:600;font-size:12px}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;background:#241c44}
.done{color:var(--ok)}.err{color:var(--bad)}
.mini{color:var(--dim);font-size:12px}
label{font-size:13px;color:var(--dim)}
</style></head><body>
<h1>🔊 أصوات الأسئلة</h1>
<div class="sub">
  الصوت: <b id="vVoice">—</b> · الموديل: <b id="vModel">—</b> · الصيغة: <b id="vFmt">—</b>
  · <a href="ADMIN_URL/q">إدارة الأسئلة</a>
</div>

<div class="card">
  <div class="kpi">
    <div><b id="kTotal">—</b><span>إجمالي الأسئلة</span></div>
    <div><b id="kReady">—</b><span>جاهزة صوتيًا</span></div>
    <div><b id="kLeft">—</b><span>المتبقية</span></div>
    <div><b id="kCost">—</b><span>كريديت متوقّع للمتبقي</span></div>
    <div><b id="kSize">—</b><span>حجم التخزين</span></div>
    <div><b id="kKey">—</b><span>المفتاح</span></div>
  </div>
  <div class="bar"><i id="barAll"></i></div>
</div>

<div class="card">
  <h3 style="margin:0 0 10px">تجربة سريعة</h3>
  <div class="row">
    <input type="text" id="pvText" value="ما هي عاصمة اليابان؟">
    <button id="pvGo">استمع</button>
    <span class="mini" id="pvOut"></span>
  </div>
  <audio id="pvAudio" controls style="width:100%;margin-top:10px;display:none"></audio>
</div>

<div class="card">
  <h3 style="margin:0 0 10px">توليد بالدفعات</h3>
  <div class="row">
    <label>الفئة <select id="bCat"><option value="">كل الفئات</option></select></label>
    <label>عدد الأسئلة <input type="number" id="bLimit" value="50" min="0" style="width:110px"></label>
    <label>سقف الكريديت <input type="number" id="bBudget" value="0" min="0" style="width:120px"></label>
    <label>التزامن <select id="bConc"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></label>
    <button id="bGo">ابدأ</button>
    <button id="bStop" class="ghost" disabled>إيقاف</button>
  </div>
  <div class="mini" style="margin-top:6px">٠ في العدد = بلا حدّ · ٠ في السقف = بلا حدّ · المولَّد سابقًا يُتخطّى تلقائيًا.</div>
  <div class="bar"><i id="barJob"></i></div>
  <div id="jobOut" class="mini">جاهز.</div>
</div>

<div class="card">
  <h3 style="margin:0 0 10px">التفصيل حسب الفئة</h3>
  <table><thead><tr><th>الفئة</th><th>الأسئلة</th><th>جاهزة</th><th>حروف</th><th>كريديت متوقّع</th><th>التقدّم</th></tr></thead>
  <tbody id="tb"></tbody></table>
</div>

<div class="card">
  <button id="clr" class="danger">حذف كل الأصوات المخزّنة</button>
  <span class="mini">يعيدك لنقطة الصفر — لا تضغطه إلا لو تبي تعيد التوليد بصوت مختلف.</span>
</div>

<script>
const A="ADMIN_URL";
const $=id=>document.getElementById(id);
const nf=n=>Number(n||0).toLocaleString("ar-EG");
const mb=b=>(b/1048576).toFixed(1)+" م.ب";
let CATS=[];

async function loadStats(){
  const s=await (await fetch(A+"/v/stats")).json();
  if(s.error){ $("jobOut").innerHTML='<span class="err">'+s.error+'</span>'; return; }
  $("vVoice").textContent=s.voice; $("vModel").textContent=s.model; $("vFmt").textContent=s.format;
  $("kTotal").textContent=nf(s.total);
  $("kReady").textContent=nf(s.ready);
  const left=s.total-s.ready;
  $("kLeft").textContent=nf(left);
  $("kSize").textContent=mb(s.storedBytes);
  $("kKey").innerHTML=s.hasKey?'<span class="done">مضبوط</span>':'<span class="err">مفقود</span>';
  $("barAll").style.width=(s.total?100*s.ready/s.total:0)+"%";

  let leftChars=0;
  const rows=Object.entries(s.byCat).sort((a,b)=>b[1].n-a[1].n);
  $("tb").innerHTML=rows.map(([c,v])=>{
    const avg=v.n?v.chars/v.n:0;
    const lc=Math.round(avg*(v.n-v.ready)); leftChars+=lc;
    const p=v.n?Math.round(100*v.ready/v.n):0;
    return '<tr><td>'+c+'</td><td>'+nf(v.n)+'</td><td>'+nf(v.ready)+'</td><td>'+nf(v.chars)+
      '</td><td>'+nf(Math.round(lc*0.555))+'</td><td><span class="pill">'+p+'%</span></td></tr>';
  }).join("");
  $("kCost").textContent=nf(Math.round(leftChars*0.555));

  if(!CATS.length){
    CATS=rows.map(r=>r[0]);
    $("bCat").innerHTML='<option value="">كل الفئات</option>'+CATS.map(c=>'<option>'+c+'</option>').join("");
  }
}

async function loadJob(){
  const j=await (await fetch(A+"/v/job")).json();
  const p=j.total?Math.round(100*j.done/j.total):0;
  $("barJob").style.width=p+"%";
  $("bGo").disabled=j.running; $("bStop").disabled=!j.running;
  let t="";
  if(j.running||j.total){
    t='تمّ '+nf(j.done)+' من '+nf(j.total)+' · مولَّد '+nf(j.made)+
      ' · متخطّى '+nf(j.skipped)+' · فشل '+nf(j.failed)+
      ' · استهلك <b>'+nf(j.cost)+'</b> كريديت · '+mb(j.bytes);
    if(j.last) t+='<br><span class="mini">آخر سؤال ['+j.cat+']: '+j.last+'</span>';
    if(j.error) t+='<br><span class="err">'+j.error+'</span>';
    if(!j.running&&j.finished) t+='<br><span class="done">انتهت المهمة.</span>';
  } else t="جاهز.";
  $("jobOut").innerHTML=t;
  if(!j.running&&window.__wasRunning){ loadStats(); }
  window.__wasRunning=j.running;
}

$("bGo").onclick=async()=>{
  const b={ cats:$("bCat").value?[$("bCat").value]:[], limit:+$("bLimit").value||0,
            budget:+$("bBudget").value||0, concurrency:+$("bConc").value };
  const r=await (await fetch(A+"/v/build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json();
  if(r.error) $("jobOut").innerHTML='<span class="err">'+r.error+'</span>';
  window.__wasRunning=true; loadJob();
};
$("bStop").onclick=()=>fetch(A+"/v/stop",{method:"POST"}).then(loadJob);

$("pvGo").onclick=async()=>{
  $("pvOut").textContent="…";
  const r=await (await fetch(A+"/v/preview",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text:$("pvText").value})})).json();
  if(r.error){ $("pvOut").innerHTML='<span class="err">'+r.error+'</span>'; return; }
  $("pvOut").innerHTML=r.chars+' حرف · <b>'+r.cost+'</b> كريديت · '+Math.round(r.bytes/1024)+' ك.ب';
  const a=$("pvAudio"); a.src="/tts/"+r.id; a.style.display="block"; a.play().catch(()=>{});
};

$("clr").onclick=async()=>{
  if(!confirm("متأكد؟ سيُحذف كل الصوت المولَّد.")) return;
  const r=await (await fetch(A+"/v/clear",{method:"POST"})).json();
  $("jobOut").textContent=r.error||("حُذف "+r.removed+" ملف.");
  loadStats();
};

loadStats(); loadJob(); setInterval(loadJob,1500);
</script></body></html>`;

module.exports = { setupVoiceAdmin };
