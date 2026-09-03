// 🎙️ إدارة أصوات المعلّق — <ADMIN_PATH>/vo
// المقاطع الأساسية مرفوعة مع الكود في public/vo/<الحدث>-<الرقم>.mp3 ومددها في vo.js.
// من هذه الصفحة: استماع، تعطيل/تفعيل، رفع مقاطع جديدة (تُحفظ في قاعدة البيانات
// وتُخدَم من /vo/<الحدث>-<الرقم>.mp3 بالمسار نفسه)، وحذف المرفوع.
// الإعدادات في KV باسم voCfg: { off:[مفاتيح معطَّلة], db:{ "hurry-5": 4.2 } }
const { ADMIN_PATH, adminEnabled, verifySession, parseCookies } = require("./admin");
const voc = require("./vo");

const BLOB = "vo_";
const MAX_MP3 = 3 * 1024 * 1024;

/* الأحداث: الاسم العربي، أين يُسمَع، وكم يُفضَّل طول المقطع */
const EVENTS = [
  ["first_door",    "شرح الأبواب (أول مرّة)",        "عند ظهور أبواب الفئات في أول مباراة للغرفة",                  "١٠–١٥ ث"],
  ["door",          "التصويت على الباب",             "كل مرّة تظهر الأبواب بعد الأولى",                              "٢–٥ ث"],
  ["door_enter",    "دخول الباب",                    "بعد فوز فئة بالتصويت",                                         "٤–٦ ث"],
  ["tie_roulette",  "تعادل الروليت",                 "حين يتعادل التصويت وتُدار الروليت",                            "٥–١٠ ث"],
  ["first_powers",  "شرح البطاقات (أول مرّة)",       "أول مرحلة فخاخ في المباراة",                                   "١٠–١٥ ث"],
  ["powers_intro",  "مرحلة البطاقات",                "كل مرحلة فخاخ بعد الأولى",                                     "٢–٦ ث"],
  ["hurry",         "استعجال (قرب انتهاء الوقت)",    "قبل نهاية وقت السؤال بثوانٍ — الأقصر من ٤.٦ ث فقط يُختار",      "≤ ٤.٦ ث"],
  ["reveal",        "كشف الإجابة",                   "لحظة إظهار الإجابة الصحيحة في الأسئلة",                        "١–٣ ث"],
  ["question_timeup","انتهى الوقت — الأسئلة",       "حين ينتهي وقت السؤال ولم يُجب أحد",                            "٢–٥ ث"],
  ["pyramid_timeup", "انتهى الوقت — الهرم",         "حين ينتهي وقت سؤال الهرم ولم يُجب الجميع",                      "٢–٥ ث"],
  ["attack_timeup",  "انتهى الوقت — الفخاخ",        "حين ينتهي وقت اختيار الفخّ",                                    "٢–٥ ث"],
  ["sort_timeup",   "انتهى الوقت — التصنيف",        "نهاية لعبة التصنيف",                                            "٤–٨ ث"],
  ["link_timeup",   "انتهى الوقت — التوصيل",        "نهاية لعبة التوصيل",                                            "٤–٨ ث"],
  ["trap_freeze",   "فخّ التجميد",                   "حين يُصاب لاعب بالتجميد",                                       "١–٣ ث"],
  ["trap_gloop",    "فخّ الوحل",                     "حين يُصاب لاعب بالوحل",                                         "١–٣ ث"],
  ["trap_bombs",    "فخّ القنابل",                   "حين يُصاب لاعب بالقنابل",                                       "١–٣ ث"],
  ["trap_nibble",   "فخّ أكلة الحروف",               "حين يُصاب لاعب بأكلة الحروف",                                   "١–٣ ث"],
  ["trap_double",   "بطاقة المضاعفة",                "حين يلعب أحدٌ بطاقة المضاعفة",                                  "١–٣ ث"],
  ["trap_bet",      "بطاقة الرهان",                  "حين يراهن أحدٌ على لاعب",                                       "٢–٥ ث"],
  ["trap_multi",    "عدّة فخاخ معًا",                "حين يُصاب لاعب بأكثر من فخّ في الجولة",                         "١–٣ ث"],
  ["pyramid_intro", "شرح الهرم",                     "مع فيلم مقدّمة الهرم",                                          "٢٠–٣٠ ث"],
  ["near_top",      "قرب القمة",                     "حين يقترب لاعب من قمّة الهرم",                                  "٢–٥ ث"],
  ["winner",        "الفائز",                        "شاشة النهاية",                                                  "٨–١٥ ث"],
  ["sort_intro",    "شرح التصنيف",                   "مع فيلم مقدّمة التصنيف",                                        "١٠–٢٠ ث"],
  ["link_intro",    "شرح التوصيل",                   "مع فيلم مقدّمة التوصيل",                                        "١٠–١٥ ث"],
  ["pyramid_skip",  "تخطّي شرح الهرم",               "حين يضغط المدير «تخطّي» في مقدّمة الهرم",                       "٤–٨ ث"],
  ["minigame_skip", "تخطّي شرح الألعاب",             "حين يُتخطّى شرح التصنيف أو التوصيل",                            "٣–٥ ث"],
  ["skip",          "تخطّي عام",                     "احتياطي حين لا يوجد تخطّي خاص",                                 "٥–٨ ث"]
];

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
function html(res, s) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
  res.end(s);
}
const validKey = k => /^[a-z_]+-\d{1,3}$/.test(k);

function setupVoiceOverAdmin(app, { store }) {
  let cfg = { off: [], db: {} };
  store.getKV("voCfg").then(v => {
    if (v && typeof v === "object") { cfg = { off: [].concat(v.off || []), db: { ...(v.db || {}) } }; voc.apply(cfg); }
    console.log("🎙️ أصوات المعلّق: " + Object.keys(cfg.db).length + " مرفوع · " + cfg.off.length + " معطَّل");
  }).catch(() => {});
  const save = async () => { voc.apply(cfg); await store.saveKV("voCfg", cfg); };

  /* المدد الفعّالة للعميل (يختار محلّيًّا تعليقات الفخاخ) */
  app.get("/vo/dur.json", (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(voc.durations()));
  });
  /* المقاطع المرفوعة من الأدمن — ما لم يوجد ملفٌ ثابت بالاسم نفسه (الثابت يخدمه express.static قبلنا) */
  app.get("/vo/:file", async (req, res, next) => {
    const m = String(req.params.file).match(/^([a-z_]+-\d{1,3})\.mp3$/);
    if (!m) return next();
    try {
      const b = await store.getBlob(BLOB + m[1]);
      if (!b) return next();
      res.writeHead(200, { "Content-Type": b.mime || "audio/mpeg", "Content-Length": b.data.length, "Cache-Control": "public, max-age=86400" });
      res.end(b.data);
    } catch (e) { next(); }
  });

  if (!adminEnabled) return null;
  const guard = (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); res.end("forbidden"); return false; }
    return true;
  };

  app.get(ADMIN_PATH + "/vo", (req, res) => { if (!guard(req, res)) return; html(res, page()); });

  app.get(ADMIN_PATH + "/vo/list", (req, res) => {
    if (!guard(req, res)) return;
    const off = new Set(cfg.off);
    const events = EVENTS.map(([key, name, where, len]) => {
      const base = (voc.BASE[key] || []).map((d, i) => ({ n: i + 1, dur: d, src: "base", off: off.has(key + "-" + (i + 1)) }));
      const db = Object.keys(cfg.db).filter(k => k.startsWith(key + "-")).map(k => ({ n: +k.split("-").pop(), dur: cfg.db[k], src: "db", off: off.has(k) }));
      const clips = base.concat(db).sort((a, b) => a.n - b.n);
      return { key, name, where, len, clips, active: clips.filter(c => !c.off).length };
    });
    json(res, 200, { events });
  });

  app.post(ADMIN_PATH + "/vo/toggle", async (req, res) => {
    if (!guard(req, res)) return;
    const v = await readJson(req) || {};
    if (!validKey(v.key)) return json(res, 400, { error: "مفتاح غير صالح" });
    const i = cfg.off.indexOf(v.key);
    if (i >= 0) cfg.off.splice(i, 1); else cfg.off.push(v.key);
    await save();
    json(res, 200, { ok: true, off: i < 0 });
  });

  /* رفع: { event, dur, b64 } — الرقم يُختار تلقائيًّا بعد آخر رقمٍ موجود */
  app.post(ADMIN_PATH + "/vo/upload", async (req, res) => {
    if (!guard(req, res)) return;
    const v = await readJson(req, MAX_MP3 * 1.4 + 1000);
    if (!v) return json(res, 400, { error: "الطلب كبيرٌ أو غير صالح (الحدّ ٣ ميجا)" });
    const ev = EVENTS.find(e => e[0] === v.event);
    if (!ev) return json(res, 400, { error: "حدث غير معروف" });
    const dur = Math.round((Number(v.dur) || 0) * 10) / 10;
    if (!(dur > 0.2 && dur < 120)) return json(res, 400, { error: "مدّة المقطع غير صالحة" });
    let buf;
    try { buf = Buffer.from(String(v.b64).replace(/^data:[^,]*,/, ""), "base64"); } catch (e) { buf = null; }
    if (!buf || buf.length < 1000) return json(res, 400, { error: "ملف فارغ" });
    if (buf.length > MAX_MP3) return json(res, 400, { error: "الملف أكبر من ٣ ميجا" });
    const isMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    if (!isMp3) return json(res, 400, { error: "الملف ليس mp3" });
    const used = (voc.BASE[v.event] || []).length;
    const dbNums = Object.keys(cfg.db).filter(k => k.startsWith(v.event + "-")).map(k => +k.split("-").pop());
    const n = Math.max(used, 0, ...dbNums) + 1;
    const key = v.event + "-" + n;
    await store.putBlob(BLOB + key, "audio/mpeg", buf);
    cfg.db[key] = dur;
    await save();
    json(res, 200, { ok: true, key, n, dur });
  });

  app.post(ADMIN_PATH + "/vo/del", async (req, res) => {
    if (!guard(req, res)) return;
    const v = await readJson(req) || {};
    if (!validKey(v.key) || !(v.key in cfg.db)) return json(res, 400, { error: "لا يُحذف إلا المرفوع من هنا" });
    delete cfg.db[v.key];
    cfg.off = cfg.off.filter(k => k !== v.key);
    await store.delBlobs([BLOB + v.key]).catch(() => {});
    await save();
    json(res, 200, { ok: true });
  });

  return { events: EVENTS };
}

function page() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>أصوات المعلّق</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{background:#0f1729;color:#e8ecf5;padding:22px 16px 60px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px} .sub{color:#8b95ad;font-size:13px;margin-bottom:16px;line-height:1.7}
.nav a{color:#8fd3ff;text-decoration:none;font-size:13px;margin-inline-end:14px}
.card{background:#151f36;border:1px solid #243052;border-radius:14px;padding:14px 16px;margin-bottom:12px}
.card.warn{border-color:#8a5a12;background:#231c12}
.head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.head h2{font-size:16px} .head .k{font-family:monospace;color:#8fd3ff;font-size:12px;direction:ltr}
.head .w{color:#8b95ad;font-size:12px;flex:1;min-width:200px} .head .len{font-size:11px;color:#c9d1e6;background:#24304f;border-radius:99px;padding:2px 9px}
.badge{font-size:11px;border-radius:99px;padding:2px 9px;background:#1f3d2b;color:#9be7b5}
.badge.zero{background:#4a2a12;color:#ffc46b}
.clips{display:flex;flex-wrap:wrap;gap:8px}
.clip{display:flex;align-items:center;gap:8px;background:#0f1729;border:1px solid #243052;border-radius:10px;padding:6px 10px}
.clip.off{opacity:.45} .clip .n{font-weight:800;min-width:26px;text-align:center} .clip .d{color:#8b95ad;font-size:12px;min-width:40px}
.clip .src{font-size:10px;color:#8fd3ff} .clip.playing{border-color:#39e08a;box-shadow:0 0 0 2px rgba(57,224,138,.25)}
button{border:0;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer;font-size:12px;color:#fff;background:#2d3b60}
button.p{background:#1f6feb} button.r{background:#7a2333} button.g{background:#1e8e5a} button:disabled{opacity:.5;cursor:default}
.up{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px;color:#8b95ad}
input[type=file]{color:#c9d1e6;font-size:12px}
.msg{font-size:12px;color:#9be7b5} .msg.err{color:#ff8a8a}
.tools{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
input.s{background:#0f1729;border:1px solid #243052;color:#e8ecf5;border-radius:8px;padding:7px 10px;font-size:13px;min-width:220px}
</style></head><body><div class="wrap">
<h1>🎙️ أصوات المعلّق</h1>
<div class="sub">كل حدثٍ في اللعبة وله مقاطعه: اسمع، عطّل ما لا يعجبك، أو ارفع mp3 جديدًا فيدخل التدوير فورًا بلا نشر. المقاطع الأساسية (مع الكود) لا تُحذف لكن تُعطَّل. المدّة تُقاس تلقائيًّا من الملف عند الرفع.</div>
<div class="nav"><a href="ADMIN_URL">← لوحة المراقبة</a><a href="ADMIN_URL/q">📚 الأسئلة</a><a href="ADMIN_URL/v">🔊 صوت قراءة الأسئلة</a></div>
<div class="tools"><input class="s" id="q" placeholder="ابحث في اسم الحدث…" oninput="draw()"><label><input type="checkbox" id="onlyEmpty" onchange="draw()"> الأحداث بلا مقاطع فقط</label><span id="tot" class="msg"></span></div>
<div id="list"></div>
</div>
<script>
const B="ADMIN_URL/vo"; const $=id=>document.getElementById(id);
let DATA=[]; let A=null, AEL=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function load(){ const d=await (await fetch(B+"/list")).json(); DATA=d.events; draw(); }
function draw(){
  const q=$("q").value.trim(), oe=$("onlyEmpty").checked;
  let evs=DATA.filter(e=>!q||e.name.includes(q)||e.key.includes(q)||e.where.includes(q));
  if(oe) evs=evs.filter(e=>!e.active);
  const totalClips=DATA.reduce((a,e)=>a+e.clips.length,0), act=DATA.reduce((a,e)=>a+e.active,0), empty=DATA.filter(e=>!e.active).length;
  $("tot").textContent=DATA.length+" حدثًا · "+act+" مقطعًا فعّالًا من "+totalClips+(empty?" · "+empty+" بلا مقاطع":"");
  $("list").innerHTML=evs.map(e=>'<div class="card'+(e.active?'':' warn')+'" id="ev-'+e.key+'">'+
    '<div class="head"><h2>'+esc(e.name)+'</h2><span class="k">'+e.key+'</span><span class="badge'+(e.active?'':' zero')+'">'+(e.active?e.active+' فعّال':'لا مقاطع — لن يُسمَع شيء')+'</span><span class="len">الطول المفضّل '+esc(e.len)+'</span><span class="w">'+esc(e.where)+'</span></div>'+
    '<div class="clips">'+e.clips.map(c=>{const key=e.key+"-"+c.n;return '<div class="clip'+(c.off?' off':'')+'" id="c-'+key+'">'+
      '<span class="n">'+c.n+'</span><span class="d">'+c.dur+' ث</span><span class="src">'+(c.src==="db"?"مرفوع":"أساسي")+'</span>'+
      '<button class="p" onclick="play(\\''+key+'\\')">▶</button>'+
      '<button onclick="tog(\\''+key+'\\')">'+(c.off?'تفعيل':'تعطيل')+'</button>'+
      (c.src==="db"?'<button class="r" onclick="del(\\''+key+'\\')">حذف</button>':'')+
      '</div>';}).join("")+(e.clips.length?'':'<span class="msg err">ارفع مقطعًا واحدًا على الأقل ليعمل هذا الحدث</span>')+'</div>'+
    '<div class="up"><input type="file" accept="audio/mpeg,.mp3" id="f-'+e.key+'"><button class="g" onclick="up(\\''+e.key+'\\')">⬆ رفع مقطع جديد</button><span class="msg" id="m-'+e.key+'"></span></div>'+
    '</div>').join("");
}
function play(key){
  if(A){A.pause();A=null;} document.querySelectorAll(".clip.playing").forEach(x=>x.classList.remove("playing"));
  const el=$("c-"+key); if(AEL===el){AEL=null;return;}
  A=new Audio("/vo/"+key+".mp3?t="+Date.now()); AEL=el; el.classList.add("playing");
  A.onended=A.onerror=()=>{el.classList.remove("playing");if(AEL===el)AEL=null;};
  A.play().catch(()=>{});
}
async function api(p,body){ const r=await fetch(B+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); return r.json(); }
async function tog(key){ const r=await api("/toggle",{key}); if(r.error)return alert(r.error); load(); }
async function del(key){ if(!confirm("حذف المقطع المرفوع "+key+" نهائيًّا؟"))return; const r=await api("/del",{key}); if(r.error)return alert(r.error); load(); }
function measure(file){ return new Promise((ok,bad)=>{ const u=URL.createObjectURL(file); const a=new Audio(); a.preload="metadata";
  a.onloadedmetadata=()=>{ const d=a.duration; URL.revokeObjectURL(u); isFinite(d)&&d>0?ok(Math.round(d*10)/10):bad(new Error("تعذّر قياس المدّة")); };
  a.onerror=()=>bad(new Error("الملف ليس صوتًا صالحًا")); a.src=u; }); }
async function up(ev){
  const f=$("f-"+ev).files[0], m=$("m-"+ev); m.className="msg";
  if(!f){m.className="msg err";m.textContent="اختر ملف mp3 أولًا";return;}
  if(f.size>3*1024*1024){m.className="msg err";m.textContent="الملف أكبر من ٣ ميجا";return;}
  try{
    m.textContent="أقيس المدّة…"; const dur=await measure(f);
    m.textContent="أرفع ("+dur+" ث)…";
    const b64=await new Promise(ok=>{const r=new FileReader();r.onload=()=>ok(r.result);r.readAsDataURL(f);});
    const r=await api("/upload",{event:ev,dur,b64});
    if(r.error){m.className="msg err";m.textContent=r.error;return;}
    m.textContent="رُفع كـ "+r.key+" ("+r.dur+" ث) — يعمل الآن";
    await load(); setTimeout(()=>{const x=$("c-"+r.key); if(x)x.scrollIntoView({block:"center"});},50);
  }catch(e){m.className="msg err";m.textContent=e.message;}
}
load();
</script></body></html>`.replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupVoiceOverAdmin, EVENTS };
