// ═══════════════════════════════════════════════════════════════
//  الحسابات المشتركة بين كل الألعاب
//  تسجيل الدخول يحدث مرة واحدة من الصفحة الرئيسية، وكل لعبة
//  تتعرّف على المستخدم من الكوكي — لا حاجة لبطاقة دخول في كل لعبة.
// ═══════════════════════════════════════════════════════════════
const crypto = require("crypto");
const { rateLimit } = require("./security");

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "acct";
const MAX_AGE = 30 * 24 * 3600;          // ٣٠ يوماً
const TTL_MS = MAX_AGE * 1000;

// ─── توقيع الجلسة (HMAC، بلا تخزين على الخادم) ───
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}
function sign(name) {
  const payload = Buffer.from(name, "utf8").toString("base64url") + "." + Date.now();
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return payload + "." + sig;
}
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[0] + "." + parts[1];
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  if (!safeEqual(parts[2], expected)) return null;
  const ts = +parts[1];
  if (!ts || Date.now() - ts > TTL_MS) return null;
  try {
    const name = Buffer.from(parts[0], "base64url").toString("utf8");
    return name && name.length <= 20 ? name : null;
  } catch (e) { return null; }
}

function parseCookies(raw) {
  const out = {};
  String(raw || "").split(";").forEach(c => {
    const i = c.indexOf("=");
    if (i > 0) {
      try { out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }
      catch (e) { /* كوكي معطوب — نتجاهله */ }
    }
  });
  return out;
}

/** اسم المستخدم المسجّل من طلب HTTP، أو null للضيف */
function nameFromReq(req) {
  return verify(parseCookies(req && req.headers && req.headers.cookie)[COOKIE]);
}
/** اسم المستخدم المسجّل من اتصال socket.io، أو null للضيف */
function nameFromSocket(socket) {
  const h = socket && socket.handshake;
  return verify(parseCookies(h && h.headers && h.headers.cookie)[COOKIE]);
}

function cookieHeader(req, token, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

// ─── حماية من تخمين كلمات المرور ───
const fails = new Map();                  // ip -> { n, until }
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}
function blocked(ip) { const a = fails.get(ip); return !!(a && a.until > Date.now()); }
function recordFail(ip) {
  const a = fails.get(ip) || { n: 0, until: 0 };
  a.n++;
  if (a.n >= 8) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  fails.set(ip, a);
}
setInterval(() => {
  const now = Date.now();
  fails.forEach((a, ip) => { if (a.until && a.until < now) fails.delete(ip); });
}, 10 * 60 * 1000).unref?.();

/**
 * يُركّب مسارات الحساب على تطبيق express.
 * deps: { store, hashPass, publicStats }
 */
function setupAccounts(app, deps) {
  const { store, hashPass, publicStats } = deps;
  const json = require("express").json({ limit: "4kb" });

  app.get("/api/account/me", async (req, res) => {
    const name = nameFromReq(req);
    if (!name) return res.json({ ok: true, guest: true });
    try {
      const u = await store.getUser(name);
      if (!u) return res.json({ ok: true, guest: true });
      res.json({ ok: true, guest: false, stats: publicStats(u) });
    } catch (e) {
      res.json({ ok: true, guest: true });
    }
  });

  app.post("/api/account/login", rateLimit({name:"login",windowMs:600000,max:20,message:"محاولات دخولٍ كثيرة، انتظر قليلًا."}), json, async (req, res) => {
    const ip = clientIp(req);
    if (blocked(ip)) return res.status(429).json({ ok: false, error: "محاولات كثيرة، انتظر ١٠ دقائق" });
    const name = String(req.body?.name || "").trim().slice(0, 20);
    const pass = String(req.body?.pass || "");
    try {
      const u = await store.getUser(name);
      if (!u || hashPass(pass, u.salt) !== u.hash) {
        recordFail(ip);
        return res.status(401).json({ ok: false, error: "الاسم أو كلمة المرور خاطئة" });
      }
      res.setHeader("Set-Cookie", cookieHeader(req, sign(u.name || name), MAX_AGE));
      res.json({ ok: true, stats: publicStats(u) });
    } catch (e) {
      console.error("account login:", e.message);
      res.status(500).json({ ok: false, error: "خطأ في الخادم" });
    }
  });

  app.post("/api/account/register", rateLimit({name:"reg",windowMs:3600000,max:6,message:"حساباتٌ كثيرة من هذا الجهاز، حاول لاحقًا."}), json, async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 20);
    const pass = String(req.body?.pass || "");
    if (name.length < 2) return res.status(400).json({ ok: false, error: "الاسم قصير جدًا (حرفان على الأقل)" });
    if (pass.length < 4) return res.status(400).json({ ok: false, error: "كلمة المرور قصيرة (٤ أحرف على الأقل)" });
    try {
      if (await store.getUser(name)) return res.status(409).json({ ok: false, error: "الاسم مستخدم، جرّب الدخول" });
      const salt = crypto.randomBytes(16).toString("hex");
      await store.createUser(name, salt, hashPass(pass, salt));
      if (deps.onNewUser) deps.onNewUser();
      res.setHeader("Set-Cookie", cookieHeader(req, sign(name), MAX_AGE));
      res.json({ ok: true, stats: { name, wins: 0, games: 0, totalScore: 0 } });
    } catch (e) {
      console.error("account register:", e.message);
      res.status(500).json({ ok: false, error: "خطأ في الخادم" });
    }
  });

  app.post("/api/account/logout", (req, res) => {
    res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
    res.json({ ok: true });
  });

  app.get("/api/account/top", async (req, res) => {
    try { res.json({ ok: true, top: await store.top(10) }); }
    catch (e) { res.json({ ok: true, top: [] }); }
  });
}

module.exports = { setupAccounts, nameFromReq, nameFromSocket, COOKIE };
