// 🔊 لوحة تحكم أصوات الأسئلة — تُركَّب تحت نفس المسار السري للوحة المراقبة.
const { ADMIN_PATH, verifySession, parseCookies } = require("./admin");
const qbank = require("./qbank");
const { rateLimit } = require("./security");

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
    const cats = Array.isArray(v.cats) ? v.cats.filter(c => qbank.categories().includes(c) || c === "تحديات") : [];
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

  app.get(ADMIN_PATH + "/v/cfg", (req, res) => {
    if (!guard(req, res)) return;
    json(res, 200, tts.getCfg());
  });

  app.post(ADMIN_PATH + "/v/cfg", async (req, res) => {
    if (!guard(req, res)) return;
    const v = await readJson(req) || {};
    try { json(res, 200, await tts.setCfg(v)); }
    catch (e) { json(res, 500, { error: e.message }); }
  });

  // تجربة إعدادات على جملة واحدة دون المساس بالمقطع المعتمد للسؤال
  app.post(ADMIN_PATH + "/v/trial", async (req, res) => {
    if (!guard(req, res)) return;
    if (!tts.hasKey()) return json(res, 400, { error: "ELEVEN_KEY غير مضبوط" });
    const v = await readJson(req) || {};
    const t = String(v.text || "").trim();
    if (!t) return json(res, 400, { error: "أرسل نصًا" });
    const over = {};
    ["voice", "model", "format"].forEach(k => { if (v[k]) over[k] = String(v[k]).slice(0, 40); });
    ["stability", "similarity", "speed"].forEach(k => { if (v[k] !== undefined && v[k] !== "") over[k] = Number(v[k]); });
    try { json(res, 200, await tts.trial(t, over)); }
    catch (e) { json(res, 500, { error: e.message }); }
  });

  /* ═══ إدخال يدويّ من موقع ElevenLabs ═══
     الخطة المجانية تمنع أصوات المكتبة عبر الـAPI لكنها تسمح بها من الموقع.
     فيُولَّد الصوت من صفحة الموقع في متصفّح المدير ويُرسَل إلى هنا برمز
     مؤقّت (ساعتان) لا يُعطى إلا لصاحب جلسة الأدمن. CORS لأصل elevenlabs.io فقط. */
  const INGEST = { token: "", exp: 0 };
  const ingestOk = t => t && t === INGEST.token && Date.now() < INGEST.exp;
  app.get(ADMIN_PATH + "/v/ingest-token", async (req, res) => {
    if (!guard(req, res)) return;
    INGEST.token = require("crypto").randomBytes(24).toString("hex");
    INGEST.exp = Date.now() + 2 * 3600e3;
    const cats = String(req.query.cats || "").split(",").map(c => c.trim()).filter(Boolean);
    const missing = await tts.missing(cats.length ? cats : null);
    json(res, 200, { token: INGEST.token, exp: INGEST.exp, missing: missing.map(m => ({ id: m.id, cat: m.cat, text: m.text })) });
  });
  const cors = (req, res) => {
    const o = req.headers.origin || "";
    if (!/^https:\/\/([a-z0-9-]+\.)*elevenlabs\.io$/.test(o)) return false;
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Ingest-Token");
    res.setHeader("Access-Control-Max-Age", "600");
    return true;
  };
  app.options("/tts-ingest", (req, res) => { cors(req, res); res.writeHead(204); res.end(); });
  app.post("/tts-ingest", rateLimit({ name: "ingest", windowMs: 60000, max: 40 }), async (req, res) => {
    if (!cors(req, res)) { res.writeHead(403); return res.end("origin"); }
    if (!ingestOk(req.headers["x-ingest-token"])) return json(res, 403, { error: "رمز الإدخال منتهٍ أو خاطئ" });
    const v = await readJson(req, 4e6);
    if (!v || !v.text || !v.b64) return json(res, 400, { error: "طلب ناقص" });
    let buf; try { buf = Buffer.from(String(v.b64).replace(/^data:[^,]*,/, ""), "base64"); } catch (e) { buf = null; }
    if (!buf || buf.length < 800) return json(res, 400, { error: "ملف فارغ" });
    const isMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    if (!isMp3) return json(res, 400, { error: "ليس mp3" });
    try {
      const id = await tts.putClip(String(v.text), buf, Number(v.secs) || 0);
      json(res, 200, { ok: true, id, bytes: buf.length });
    } catch (e) { json(res, 500, { error: e.message }); }
  });

  app.get(ADMIN_PATH + "/v/list", (req, res) => {
    if (!guard(req, res)) return;
    try {
      json(res, 200, tts.list({
        q: String(req.query.q || ""),
        cat: String(req.query.cat || ""),
        page: Math.max(0, Number(req.query.p) || 0),
        mode: ["ready", "missing", "all"].includes(req.query.m) ? req.query.m : "ready"
      }));
    } catch (e) { json(res, 500, { error: e.message }); }
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
.list{margin-top:12px;max-height:430px;overflow:auto;border:1px solid var(--line);border-radius:10px}
.it{display:flex;align-items:center;gap:10px;padding:8px 11px;border-bottom:1px solid var(--line)}
.it:last-child{border-bottom:0}
.it:hover{background:#150f2b}
.it.play{background:#221a44}
.it .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.it .no{color:var(--dim);font-size:12px;min-width:44px}
.pbtn{width:34px;height:34px;border-radius:50%;padding:0;font-size:14px;flex:none}
.rbtn{background:#241c44;border:1px solid var(--line);color:var(--dim);font-size:12px;padding:5px 10px;flex:none}
.miss{opacity:.5}
</style></head><body>
<h1>🔊 أصوات الأسئلة</h1>
<div class="sub">
  الصوت: <b id="vVoice">—</b> · الموديل: <b id="vModel">—</b> · الصيغة: <b id="vFmt">—</b>
  · <a href="ADMIN_URL/q">إدارة الأسئلة</a> · <a href="ADMIN_URL/vo">🎙️ أصوات المعلّق</a>
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
  <h3 style="margin:0 0 10px">مختبر الإعدادات</h3>
  <div class="row">
    <input type="text" id="pvText" value="ما الحضارة التي بنت أهرامات الجيزة؟" style="min-width:320px">
  </div>
  <div class="row" style="margin-top:10px">
    <label>الموديل <select id="cModel">
      <option value="eleven_v3">eleven_v3 (تعبيري)</option>
      <option value="eleven_multilingual_v2">multilingual_v2 (الأثبت)</option>
      <option value="eleven_flash_v2_5">flash_v2_5 (الأرخص)</option>
    </select></label>
    <label>الثبات <input type="number" id="cStab" step="0.05" min="0" max="1" style="width:88px"></label>
    <label>التشابه <input type="number" id="cSim" step="0.01" min="0" max="1" style="width:88px"></label>
    <label>السرعة <input type="number" id="cSpd" step="0.01" min="0.5" max="1.5" style="width:88px"></label>
  </div>
  <div class="row" style="margin-top:10px">
    <label>الصوت <input type="text" id="cVoice" style="min-width:210px"></label>
    <label>الجودة <select id="cFmt">
      <option value="mp3_44100_192">44.1kHz / 192kbps</option>
      <option value="mp3_44100_128">44.1kHz / 128kbps</option>
      <option value="mp3_44100_64">44.1kHz / 64kbps</option>
      <option value="mp3_22050_32">22kHz / 32kbps</option>
    </select></label>
  </div>
  <div class="row" style="margin-top:10px">
    <button id="pvGo">🎧 جرّب واسمع</button>
    <button id="cSave" class="ghost">اعتماد هذه الإعدادات</button>
    <button id="cReset" class="ghost">استرجاع المعتمد</button>
    <span class="mini" id="pvOut"></span>
  </div>
  <div class="mini" style="margin-top:6px">
    التجربة لا تمسّ صوت السؤال المعتمد · الاعتماد يسري فورًا على أي توليد لاحق بلا إعادة نشر.
  </div>
  <div id="trials" class="list" style="max-height:260px"></div>
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
  <h3 style="margin:0 0 10px">معاينة الأصوات المولَّدة</h3>
  <div class="row">
    <input type="text" id="lq" placeholder="ابحث في نص السؤال…">
    <select id="lcat"><option value="">كل الفئات</option></select>
    <select id="lmode">
      <option value="ready">المولَّدة فقط</option>
      <option value="missing">غير المولَّدة</option>
      <option value="all">الكل</option>
    </select>
    <button id="lgo">عرض</button>
    <span class="mini" id="lcount"></span>
  </div>
  <div id="llist" class="list"></div>
  <div class="row" style="margin-top:10px">
    <button id="lprev" class="ghost">◀ السابق</button>
    <span class="mini" id="lpage">—</span>
    <button id="lnext" class="ghost">التالي ▶</button>
  </div>
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
  const c=s.cfg||{};
  $("vVoice").textContent=c.voice; $("vModel").textContent=c.model; $("vFmt").textContent=c.format;
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
    const opts='<option value="">كل الفئات</option>'+CATS.map(c=>'<option>'+c+'</option>').join("");
    $("bCat").innerHTML=opts; $("lcat").innerHTML=opts;
    loadList();
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

/* ── مختبر الإعدادات ── */
function cfgForm(){ return { model:$("cModel").value, voice:$("cVoice").value.trim(),
  format:$("cFmt").value, stability:+$("cStab").value, similarity:+$("cSim").value, speed:+$("cSpd").value }; }
function fillCfg(c){
  $("cModel").value=c.model; $("cVoice").value=c.voice; $("cFmt").value=c.format;
  $("cStab").value=c.stability; $("cSim").value=c.similarity; $("cSpd").value=c.speed;
}
async function loadCfg(){ fillCfg(await (await fetch(A+"/v/cfg")).json()); }

$("pvGo").onclick=async()=>{
  const c=cfgForm();
  $("pvOut").textContent="… يولّد";
  const r=await (await fetch(A+"/v/trial",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(Object.assign({text:$("pvText").value},c))})).json();
  if(r.error){ $("pvOut").innerHTML='<span class="err">'+r.error+'</span>'; return; }
  $("pvOut").innerHTML=r.chars+' حرف · <b>'+r.cost+'</b> كريديت · '+r.secs+'ث';
  const lbl=c.model.replace("eleven_","")+" · ثبات "+c.stability+" · سرعة "+c.speed+" · "+c.format.replace("mp3_","");
  const row=document.createElement("div");
  row.className="it";
  row.innerHTML='<button class="pbtn">▶</button><span class="tx">'+lbl+'</span><span class="no">'+r.secs+'ث</span>';
  row.querySelector("button").onclick=()=>new Audio("/tts/"+r.id).play();
  $("trials").prepend(row);
  new Audio("/tts/"+r.id).play().catch(()=>{});
};
$("cSave").onclick=async()=>{
  const r=await (await fetch(A+"/v/cfg",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(cfgForm())})).json();
  if(r.error){ $("pvOut").innerHTML='<span class="err">'+r.error+'</span>'; return; }
  fillCfg(r); $("pvOut").innerHTML='<span class="done">اعتُمدت — تسري على أي توليد لاحق.</span>';
  loadStats();
};
$("cReset").onclick=loadCfg;

/* ── معاينة الأصوات ── */
let LP=0, LAUD=null;
async function loadList(){
  const u=A+"/v/list?q="+encodeURIComponent($("lq").value)+"&cat="+encodeURIComponent($("lcat").value)+"&m="+$("lmode").value+"&p="+LP;
  const j=await (await fetch(u)).json();
  if(j.error){ $("llist").innerHTML='<div class="it err">'+j.error+'</div>'; return; }
  LP=j.page;
  $("lcount").textContent=nf(j.total)+" نتيجة";
  $("lpage").textContent="صفحة "+(j.page+1)+" من "+nf(j.pages);
  $("lprev").disabled=j.page<=0; $("lnext").disabled=j.page>=j.pages-1;
  $("llist").innerHTML=j.items.map(it=>
    '<div class="it'+(it.secs?'':' miss')+'" data-id="'+it.id+'">'+
    '<button class="pbtn" '+(it.secs?'':'disabled')+'>▶</button>'+
    '<span class="tx" title="'+it.text.replace(/"/g,"&quot;")+'">'+it.text+'</span>'+
    '<span class="no">'+(it.secs?it.secs+"ث":"—")+'</span>'+
    '<span class="no">'+it.cat+'</span>'+
    '<button class="rbtn">إعادة توليد</button></div>').join("")
    || '<div class="it">لا نتائج.</div>';
}
$("llist").onclick=async e=>{
  const row=e.target.closest(".it"); if(!row) return;
  const id=row.dataset.id;
  if(e.target.classList.contains("pbtn")){
    if(LAUD){ try{LAUD.pause();}catch(x){} }
    document.querySelectorAll(".it.play").forEach(n=>n.classList.remove("play"));
    row.classList.add("play");
    LAUD=new Audio("/tts/"+id);
    LAUD.onended=()=>row.classList.remove("play");
    LAUD.play().catch(()=>row.classList.remove("play"));
  }
  if(e.target.classList.contains("rbtn")){
    const txt=row.querySelector(".tx").textContent;
    e.target.textContent="…";
    const r=await (await fetch(A+"/v/preview",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:txt})})).json();
    e.target.textContent=r.error?"فشل":"تم ("+r.cost+")";
    if(!r.error){ row.classList.remove("miss"); row.querySelector(".pbtn").disabled=false; row.querySelector(".no").textContent=r.secs+"ث"; }
  }
};
$("lgo").onclick=()=>{ LP=0; loadList(); };
$("lq").onkeydown=e=>{ if(e.key==="Enter"){ LP=0; loadList(); } };
$("lmode").onchange=()=>{ LP=0; loadList(); };
$("lcat").onchange=()=>{ LP=0; loadList(); };
$("lprev").onclick=()=>{ if(LP>0){ LP--; loadList(); } };
$("lnext").onclick=()=>{ LP++; loadList(); };

$("clr").onclick=async()=>{
  if(!confirm("متأكد؟ سيُحذف كل الصوت المولَّد.")) return;
  const r=await (await fetch(A+"/v/clear",{method:"POST"})).json();
  $("jobOut").textContent=r.error||("حُذف "+r.removed+" ملف.");
  loadStats();
};

loadCfg(); loadStats(); loadJob(); setInterval(loadJob,1500);
</script></body></html>`;

module.exports = { setupVoiceAdmin };
