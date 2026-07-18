// لوحة المراقبة الإدارية - آمنة ومنفصلة
// بيانات الدخول من متغيرات البيئة فقط (ليست في الكود)
const crypto = require("crypto");
const path = require("path");

// ====== الإعدادات من البيئة ======
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
// مسار سري غير مألوف (يُضبط من البيئة، وإلا مسار افتراضي طويل)
const ADMIN_PATH = process.env.ADMIN_PATH || "/lohat-tahakom-x7k2";
// سر توقيع الجلسات
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const enabled = !!(ADMIN_USER && ADMIN_PASS);

// ====== مقارنة آمنة ضد هجمات التوقيت ======
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // مقارنة وهمية لتوحيد التوقيت
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// ====== جلسات موقعة (بدون تخزين، HMAC) ======
function signSession() {
  const payload = `admin.${Date.now()}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}
function verifySession(token) {
  if (!token || typeof token !== "string") return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (!safeEqual(sig, expected)) return false;
  // صلاحية 12 ساعة
  const ts = +payload.split(".")[1];
  if (!ts || Date.now() - ts > 12 * 3600 * 1000) return false;
  return true;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(c => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

// ====== حماية من التخمين (حظر بعد محاولات فاشلة) ======
const attempts = new Map(); // ip -> { count, until }
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}
function isBlocked(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now();
}
function recordFail(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= 5) { a.until = Date.now() + 15 * 60 * 1000; a.count = 0; } // حظر 15 دقيقة
  attempts.set(ip, a);
}
function recordSuccess(ip) { attempts.delete(ip); }

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e4) req.destroy(); });
    req.on("end", () => {
      const out = {};
      new URLSearchParams(data).forEach((v, k) => out[k] = v);
      resolve(out);
    });
  });
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}

// ====== إعداد المراقبة: يُركّب على السيرفر ويجمع الإحصائيات ======
function setupAdmin(app, deps) {
  const { getLiveStats, store } = deps;

  // إحصائيات محفوظة (زيارات، ألعاب)
  let metrics = { totalVisits: 0, totalGames: 0, days: {}, peakConcurrent: 0 };
  store.getMetrics().then(m => { if (m) metrics = { ...metrics, ...m }; }).catch(() => {});
  let saveTimer = null;
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.saveMetrics(metrics).catch(() => {}), 2000); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dayRec() { return (metrics.days[today()] = metrics.days[today()] || { visits: 0, games: 0, newUsers: 0 }); }

  const api = {
    trackVisit() { metrics.totalVisits++; dayRec().visits++; persist(); },
    trackGame() { metrics.totalGames++; dayRec().games++; persist(); },
    trackNewUser() { dayRec().newUsers++; persist(); },
    trackConcurrent(n) { if (n > metrics.peakConcurrent) { metrics.peakConcurrent = n; persist(); } }
  };

  if (!enabled) {
    console.log("⚠️  لوحة المراقبة معطلة (لم تُضبط ADMIN_USER / ADMIN_PASS)");
    return api;
  }
  console.log(`🔒 لوحة المراقبة مفعّلة على مسار سري`);

  // صفحة الدخول
  app.get(ADMIN_PATH, (req, res) => {
    const cookies = parseCookies(req);
    if (verifySession(cookies.adm)) return dashboard(req, res);
    send(res, 200, loginPage(""));
  });

  app.post(ADMIN_PATH, async (req, res) => {
    const ip = clientIp(req);
    if (isBlocked(ip)) return send(res, 429, loginPage("محاولات كثيرة، انتظر 15 دقيقة"));
    const body = await readBody(req);
    const okUser = safeEqual(body.u || "", ADMIN_USER);
    const okPass = safeEqual(body.p || "", ADMIN_PASS);
    if (okUser && okPass) {
      recordSuccess(ip);
      const cookie = `adm=${signSession()}; HttpOnly; Path=${ADMIN_PATH}; Max-Age=43200; SameSite=Strict${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
      res.writeHead(302, { "Set-Cookie": cookie, "Location": ADMIN_PATH });
      return res.end();
    }
    recordFail(ip);
    send(res, 401, loginPage("بيانات الدخول خاطئة"));
  });

  // بيانات حية (JSON) - تتطلب جلسة
  app.get(ADMIN_PATH + "/data", async (req, res) => {
    if (!verifySession(parseCookies(req).adm)) { res.writeHead(403); return res.end("forbidden"); }
    let userCount = 0, top = [];
    try { userCount = await store.countUsers(); top = await store.top(20); } catch (e) {}
    const live = getLiveStats();
    api.trackConcurrent(live.online);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ live, metrics, userCount, top }));
  });

  app.get(ADMIN_PATH + "/logout", (req, res) => {
    res.writeHead(302, { "Set-Cookie": `adm=; HttpOnly; Path=${ADMIN_PATH}; Max-Age=0`, "Location": ADMIN_PATH });
    res.end();
  });

  function dashboard(req, res) { send(res, 200, dashboardPage()); }

  return api;
}

// ====== صفحات HTML ======
function loginPage(err) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>دخول</title><style>
*{box-sizing:border-box;font-family:system-ui,Tahoma,sans-serif;margin:0}
body{background:#0f1826;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{background:#1a2740;padding:30px;border-radius:14px;width:100%;max-width:340px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
h1{color:#e3e8ee;font-size:20px;margin-bottom:20px;text-align:center}
input{width:100%;padding:12px;margin-bottom:12px;border:1px solid #2d4160;background:#0f1826;color:#e3e8ee;border-radius:8px;font-size:15px}
button{width:100%;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:15px}
.err{color:#f87171;font-size:13px;text-align:center;margin-bottom:12px;min-height:18px}
</style></head><body><form class="box" method="post" autocomplete="off">
<h1>🔒 لوحة المراقبة</h1><div class="err">${err ? err.replace(/[<>]/g, "") : ""}</div>
<input name="u" placeholder="اسم المستخدم" autocomplete="off" required>
<input name="p" type="password" placeholder="كلمة المرور" autocomplete="new-password" required>
<button type="submit">دخول</button></form></body></html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>لوحة المراقبة</title><style>
*{box-sizing:border-box;font-family:system-ui,Tahoma,sans-serif;margin:0}
body{background:#0f1826;color:#e3e8ee;padding:16px;min-height:100vh}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px}
h1{font-size:22px}
.logout{color:#f87171;text-decoration:none;font-size:14px;background:#2a1a24;padding:6px 14px;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.card{background:#1a2740;padding:16px;border-radius:12px}
.card .n{font-size:32px;font-weight:900;color:#60a5fa}
.card .l{font-size:13px;color:#9fb3c8;margin-top:4px}
.card.live .n{color:#4ade80}
.sec{background:#1a2740;padding:16px;border-radius:12px;margin-bottom:16px}
.sec h2{font-size:16px;margin-bottom:12px;color:#cbd5e1}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:right;padding:8px;border-bottom:1px solid #2d4160}
th{color:#9fb3c8;font-weight:600}
.rooms{display:flex;flex-direction:column;gap:8px}
.room{background:#0f1826;padding:10px 12px;border-radius:8px;font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}
.room .players{color:#9fb3c8;font-size:13px}
.muted{color:#64748b;font-size:13px}
.bar{height:8px;background:#0f1826;border-radius:4px;overflow:hidden;margin-top:6px}
.bar>i{display:block;height:100%;background:#3b82f6}
.dot{width:8px;height:8px;background:#4ade80;border-radius:50%;display:inline-block;margin-left:6px;animation:p 1.5s infinite}
@keyframes p{50%{opacity:.3}}
</style></head><body>
<div class="head"><h1>🎨 لوحة مراقبة ارسمها <span class="dot"></span></h1>
<a class="logout" href="LOGOUT">خروج</a></div>
<div class="grid">
<div class="card live"><div class="n" id="online">–</div><div class="l">متصل الآن</div></div>
<div class="card live"><div class="n" id="rooms">–</div><div class="l">غرف نشطة</div></div>
<div class="card"><div class="n" id="users">–</div><div class="l">حسابات مسجلة</div></div>
<div class="card"><div class="n" id="peak">–</div><div class="l">ذروة المتصلين</div></div>
<div class="card"><div class="n" id="visits">–</div><div class="l">إجمالي الزيارات</div></div>
<div class="card"><div class="n" id="games">–</div><div class="l">إجمالي الألعاب</div></div>
</div>
<div class="sec"><h2>الغرف النشطة الآن</h2><div class="rooms" id="roomList"><div class="muted">جارٍ التحميل...</div></div></div>
<div class="sec"><h2>آخر 7 أيام</h2><div id="daily"></div></div>
<div class="sec"><h2>أفضل اللاعبين</h2><table><thead><tr><th>#</th><th>الاسم</th><th>انتصارات</th><th>ألعاب</th><th>نقاط</th></tr></thead><tbody id="topUsers"></tbody></table></div>
<script>
const $=id=>document.getElementById(id);
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
async function load(){
  try{
    const r=await fetch("DATA_URL",{cache:"no-store"});
    if(r.status===403){location.href="ADMIN_URL";return;}
    const d=await r.json();
    $("online").textContent=d.live.online;
    $("rooms").textContent=d.live.rooms.length;
    $("users").textContent=d.userCount;
    $("peak").textContent=d.metrics.peakConcurrent;
    $("visits").textContent=d.metrics.totalVisits;
    $("games").textContent=d.metrics.totalGames;
    $("roomList").innerHTML=d.live.rooms.length?d.live.rooms.map(rm=>
      '<div class="room"><span>غرفة '+esc(rm.id)+' • '+esc(rm.state)+' • '+esc(rm.mode)+'</span><span class="players">'+rm.players+' لاعب'+(rm.owner?' • قائد: '+esc(rm.owner):'')+'</span></div>').join(""):'<div class="muted">لا توجد غرف نشطة</div>';
    const days=Object.entries(d.metrics.days||{}).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7);
    const mx=Math.max(1,...days.map(x=>x[1].visits));
    $("daily").innerHTML=days.length?days.map(([day,v])=>
      '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>'+day+'</span><span class="muted">'+v.visits+' زيارة • '+v.games+' لعبة • '+v.newUsers+' جديد</span></div><div class="bar"><i style="width:'+(v.visits/mx*100)+'%"></i></div></div>').join(""):'<div class="muted">لا بيانات بعد</div>';
    $("topUsers").innerHTML=d.top.length?d.top.map((u,i)=>
      '<tr><td>'+(i+1)+'</td><td>'+esc(u.name)+'</td><td>'+u.wins+'</td><td>'+u.games+'</td><td>'+u.totalScore+'</td></tr>').join(""):'<tr><td colspan="5" class="muted">لا يوجد لاعبون</td></tr>';
  }catch(e){}
}
load();setInterval(load,5000);
</script></body></html>`.replace(/LOGOUT/g, ADMIN_PATH + "/logout").replace(/DATA_URL/g, ADMIN_PATH + "/data").replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupAdmin, ADMIN_PATH, adminEnabled: enabled };
