// ═══════════════════════════════════════════════════════════════
//  الحسابات المشتركة بين كل الألعاب
//  تسجيل الدخول يحدث مرة واحدة من الصفحة الرئيسية، وكل لعبة
//  تتعرّف على المستخدم من الكوكي — لا حاجة لبطاقة دخول في كل لعبة.
//
//  الجلسة صارت صفًّا في قاعدة البيانات لا توقيعًا عابرًا: يمكن إبطالها،
//  والخروج من كل الأجهزة، ورؤية أين أنت مسجَّل. والكوكي القديم (التوقيع)
//  يبقى مقبولًا لفترة كي لا يخرج أحدٌ من حسابه عند النشر — ويُبدَّل بجلسةٍ
//  حقيقية بصمتٍ عند أوّل طلب.
// ═══════════════════════════════════════════════════════════════
const crypto = require("crypto");
const { rateLimit } = require("./security");
const A = require("./auth");

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "acct";
const MAX_AGE = A.SESSION_DAYS * 24 * 3600;
const TTL_MS = MAX_AGE * 1000;

// ─── الكوكي القديم: توقيعٌ بلا تخزين (يُقبَل انتقاليًّا) ───
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}
function verifyLegacyCookie(token) {
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
const cookieOf = req => parseCookies(req && req.headers && req.headers.cookie)[COOKIE];

/** اسم المستخدم من الكوكي القديم فقط — يبقى للتوافق مع نداءاتٍ متزامنة */
function nameFromReq(req) { return verifyLegacyCookie(cookieOf(req)); }

/** اسم المستخدم من اتصال socket.io.
 *  الوسيط في server.js يحلّ الجلسة قبل الاتصال ويضع socket.userName،
 *  فنُعيدها كما هي؛ ولا نلجأ للكوكي القديم إلا إن لم يعمل الوسيط. */
function nameFromSocket(socket) {
  if (socket && socket._authDone) return socket.userName || null;
  const h = socket && socket.handshake;
  return verifyLegacyCookie(parseCookies(h && h.headers && h.headers.cookie)[COOKIE]);
}

function cookieHeader(req, token, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" || req.secure ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

const clientIp = req =>
  (req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "?")
    .toString().replace(/^::ffff:/, "").trim();

/* حظرٌ بعد محاولاتٍ فاشلة — لكل عنوانٍ ولكل اسمٍ على حدة، فلا يُقفَل حسابٌ
   بسبب مهاجمٍ من عنوانٍ آخر، ولا يُجرَّب اسمٌ واحدٌ من ألف عنوان. */
const fails = new Map();
function blocked(k) { const a = fails.get(k); return !!(a && a.until > Date.now()); }
function recordFail(k, max = 8) {
  const a = fails.get(k) || { n: 0, until: 0 };
  a.n++;
  if (a.n >= max) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  fails.set(k, a);
}
function clearFail(k) { fails.delete(k); }
setInterval(() => {
  const now = Date.now();
  fails.forEach((a, k) => { if (a.until && a.until < now) fails.delete(k); });
}, 10 * 60 * 1000).unref?.();

/** يربط هويّة الجلسة بكل اتصالات socket.io قبل أن تصل إلى منطق الألعاب. */
function attachSocketAuth(io, store, namespaces = ["/", "/bomb", "/quiz", "/salfa"]) {
  const S = A.makeSessions(store);
  const mw = async (socket, next) => {
    socket._authDone = true;
    socket.userName = null;
    socket.userId = null;
    try {
      const raw = parseCookies(socket.handshake?.headers?.cookie)[COOKIE];
      if (raw) {
        const u = await S.userOf(raw);
        if (u) { socket.userName = u.name; socket.userId = u.id; }
        else {
          // كوكي قديم لم يُبدَّل بعد: نقبله للتعرّف فقط
          const n = verifyLegacyCookie(raw);
          if (n) {
            const old = await store.getUser(n);
            if (old) { socket.userName = old.name; socket.userId = old.id; }
          }
        }
      }
    } catch (e) { /* الضيف يلعب على أي حال */ }
    next();
  };
  namespaces.forEach(n => { try { io.of(n).use(mw); } catch (e) {} });
}

/**
 * يُركّب مسارات الحساب على تطبيق express.
 * deps: { store, hashPass, publicStats, onNewUser }
 */
function setupAccounts(app, deps) {
  const { publicStats } = deps;
  const json = require("express").json({ limit: "4kb" });
  /* المخزن يُنشأ بعد تركيب المسارات (اتصال القاعدة غير متزامن)، فنقرأه عند
     الاستعمال لا عند التركيب — وإلا التقطناه قبل وجوده. */
  const st = () => deps.store;
  const S = A.makeSessions({
    createSession: (...a) => st().createSession(...a),
    findSession: (...a) => st().findSession(...a),
    revokeSession: (...a) => st().revokeSession(...a),
    revokeUserSessions: (...a) => st().revokeUserSessions(...a),
    listSessions: (...a) => st().listSessions(...a),
    getUserById: (...a) => st().getUserById(...a)
  });

  /* تنظيف الجلسات المنتهية مرّةً كل ست ساعات */
  setInterval(() => { st()?.purgeSessions?.().catch(() => {}); }, 6 * 3600 * 1000).unref?.();

  /** يحلّ المستخدم من الكوكي: جلسةٌ حقيقية أوّلًا، ثم الكوكي القديم.
   *  ويُبدّل القديم بجلسةٍ حقيقية في الطريق (بلا أن يشعر أحد). */
  async function currentUser(req, res) {
    const raw = cookieOf(req);
    if (!raw) return null;
    const u = await S.userOf(raw);
    if (u) return u;
    const name = verifyLegacyCookie(raw);
    if (!name) return null;
    const old = await st().getUser(name);
    if (!old) return null;
    if (res) {
      const { token } = await S.create(old.id, { ua: req.headers["user-agent"], ip: clientIp(req) });
      res.setHeader("Set-Cookie", cookieHeader(req, token, MAX_AGE));
    }
    return old;
  }

  app.get("/api/account/me", async (req, res) => {
    try {
      const u = await currentUser(req, res);
      if (!u) return res.json({ ok: true, guest: true });
      res.json({
        ok: true, guest: false, stats: publicStats(u),
        email: u.email || null, emailVerified: !!u.emailVerifiedAt
      });
    } catch (e) { res.json({ ok: true, guest: true }); }
  });

  app.post("/api/account/login",
    rateLimit({ name: "login", windowMs: 600000, max: 20, message: "محاولات دخولٍ كثيرة، انتظر قليلًا." }),
    json, async (req, res) => {
    const ip = clientIp(req);
    const name = String(req.body?.name || "").trim().slice(0, 20);
    if (blocked("ip:" + ip) || blocked("nm:" + name))
      return res.status(429).json({ ok: false, error: "محاولات كثيرة، انتظر ١٠ دقائق" });
    const pass = String(req.body?.pass || "");
    try {
      const u = await st().getUser(name);
      let good = false;
      if (u) {
        if (u.passHash) good = await A.verifyNew(pass, u.passHash);
        else if (u.salt && u.hash) good = await A.verifyLegacy(pass, u.salt, u.hash);
      }
      if (!good) {
        recordFail("ip:" + ip); recordFail("nm:" + name, 12);
        return res.status(401).json({ ok: false, error: "الاسم أو كلمة المرور خاطئة" });
      }
      if (u.bannedUntil && u.bannedUntil > Date.now())
        return res.status(403).json({ ok: false, error: "الحساب موقوف: " + (u.banReason || "مخالفة") });

      clearFail("ip:" + ip); clearFail("nm:" + name);
      /* ترقيةٌ صامتة: كلمة السرّ نفسها تُعاد تجزئتها بالمعاملات الحالية */
      if (A.needsUpgrade(u.passHash)) {
        try {
          await st().updateUser(u.id, { passHash: await A.hashPassword(pass), passChangedAt: Date.now() });
        } catch (e) { /* الدخول ينجح حتى لو تعذّرت الترقية */ }
      }
      const { token } = await S.create(u.id, { ua: req.headers["user-agent"], ip });
      await st().updateUser(u.id, { lastSeenAt: Date.now() }).catch(() => {});
      res.setHeader("Set-Cookie", cookieHeader(req, token, MAX_AGE));
      res.json({ ok: true, stats: publicStats(u) });
    } catch (e) {
      console.error("account login:", e.message);
      res.status(500).json({ ok: false, error: "خطأ في الخادم" });
    }
  });

  app.post("/api/account/register",
    rateLimit({ name: "reg", windowMs: 3600000, max: 6, message: "حساباتٌ كثيرة من هذا الجهاز، حاول لاحقًا." }),
    json, async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 20);
    const pass = String(req.body?.pass || "");
    if (name.length < 2) return res.status(400).json({ ok: false, error: "الاسم قصير جدًا (حرفان على الأقل)" });
    const bad = A.passwordProblem(pass, name);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    try {
      if (await st().getUser(name)) return res.status(409).json({ ok: false, error: "الاسم مستخدم، جرّب الدخول" });
      const passHash = await A.hashPassword(pass);
      /* salt/hash القديمان يبقيان فارغين — الحسابات الجديدة بالصيغة الجديدة وحدها */
      const id = await st().createUser(name, "", "", { passHash });
      if (deps.onNewUser) deps.onNewUser();
      const { token } = await S.create(id, { ua: req.headers["user-agent"], ip: clientIp(req) });
      res.setHeader("Set-Cookie", cookieHeader(req, token, MAX_AGE));
      res.json({ ok: true, stats: { name, wins: 0, games: 0, totalScore: 0 } });
    } catch (e) {
      console.error("account register:", e.message);
      res.status(500).json({ ok: false, error: "خطأ في الخادم" });
    }
  });

  app.post("/api/account/logout", async (req, res) => {
    try { await S.revoke(cookieOf(req)); } catch (e) {}
    res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
    res.json({ ok: true });
  });

  /* خروجٌ من كل الأجهزة — يفيد عند الشكّ في تسرّب كلمة السرّ */
  app.post("/api/account/logout-all", async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      await S.revokeAll(u.id);
      res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: "خطأ في الخادم" }); }
  });

  /* الأجهزة المسجَّلة: متى دخلت ومن أين — بلا تفاصيل تُعرّف أحدًا غيره */
  app.get("/api/account/sessions", async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const list = (await S.list(u.id)).map(s => ({
        ua: String(s.ua || "").slice(0, 120), createdAt: s.createdAt, expiresAt: s.expiresAt
      }));
      res.json({ ok: true, sessions: list });
    } catch (e) { res.json({ ok: true, sessions: [] }); }
  });

  /* تغيير كلمة السرّ — يُبطل بقيّة الجلسات ويُبقي الحالية */
  app.post("/api/account/password",
    rateLimit({ name: "passchg", windowMs: 3600000, max: 10 }), json, async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const cur = String(req.body?.current || ""), next = String(req.body?.next || "");
      let good = u.passHash ? await A.verifyNew(cur, u.passHash)
                            : await A.verifyLegacy(cur, u.salt, u.hash);
      if (!good) return res.status(401).json({ ok: false, error: "كلمة السرّ الحالية خاطئة" });
      const bad = A.passwordProblem(next, u.name);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      await st().updateUser(u.id, { passHash: await A.hashPassword(next), passChangedAt: Date.now() });
      await S.revokeAll(u.id);
      const { token } = await S.create(u.id, { ua: req.headers["user-agent"], ip: clientIp(req) });
      res.setHeader("Set-Cookie", cookieHeader(req, token, MAX_AGE));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: "خطأ في الخادم" }); }
  });

  /* المحفظة: الرصيد وآخر الحركات وما بقي من سقف اليوم */
  app.get("/api/account/wallet", async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const E = require("./economy");
      const [w, led, rem] = await Promise.all([
        st().getWallet(u.id),
        st().ledgerOf(u.id, 15),
        E.remainingToday(st(), u.id)
      ]);
      res.json({ ok: true, wallet: w, ledger: led, today: rem });
    } catch (e) { res.json({ ok: true, wallet: { gold: 0, gems: 0 }, ledger: [], today: null }); }
  });

  /* إحصاءات اللاعب في كل لعبة — من الجدول الموحّد */
  app.get("/api/account/games", async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const rows = (await st().getGameStats?.(u.id)) || [];
      res.json({ ok: true, games: rows });
    } catch (e) { res.json({ ok: true, games: [] }); }
  });

  /* ربط بريدٍ اختياريّ — لا يُطلب عند التسجيل كي لا نُتعب أحدًا، ويُطلب
     هنا لمن أراد أن يستطيع استرجاع حسابه. التأكيد يأتي في خطوةٍ لاحقة. */
  app.post("/api/account/email",
    rateLimit({ name: "mail", windowMs: 3600000, max: 10 }), json, async (req, res) => {
    try {
      const u = await currentUser(req, null);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
      /* فحصٌ عمليّ لا معياريّ كامل: يمنع الأخطاء الشائعة ولا يرفض بريدًا صحيحًا */
      if (!/^[^@\s]+@[^@\s.]+\.[a-z]{2,}$/i.test(email))
        return res.status(400).json({ ok: false, error: "صيغة البريد غير صحيحة" });
      const taken = await st().getUserByEmail(email);
      if (taken && taken.id !== u.id)
        return res.status(409).json({ ok: false, error: "هذا البريد مرتبطٌ بحسابٍ آخر" });
      if ((u.email || "").toLowerCase() === email)
        return res.json({ ok: true, unchanged: true });
      await st().updateUser(u.id, { email, emailVerifiedAt: null });
      res.json({ ok: true });
    } catch (e) {
      console.error("account email:", e.message);
      res.status(500).json({ ok: false, error: "خطأ في الخادم" });
    }
  });

  app.get("/api/account/top", async (req, res) => {
    try { res.json({ ok: true, top: await st().top(10) }); }
    catch (e) { res.json({ ok: true, top: [] }); }
  });

  /* تُعاد لبقيّة الوحدات (المتجر، الدعم) كي تحلّ الهويّة بالطريقة نفسها
     بدل أن تُعيد كلٌّ منها فكّ الكوكي على هواها. */
  return { currentUser };
}

module.exports = { setupAccounts, attachSocketAuth, nameFromReq, nameFromSocket, COOKIE };
