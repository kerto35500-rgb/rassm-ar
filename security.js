// 🛡️ أمان الخادم — رؤوس الحماية وحدود المعدّل، بلا اعتماديّات خارجية.
//
// لماذا بأيدينا لا بـhelmet وexpress-rate-limit؟ لأن ما نحتاجه منهما بضعة رؤوسٍ
// وعدّادٌ بسيط، وكتابتهما هنا تُبقي التثبيت خفيفًا على الخطة المجانية، وتُبقي
// السلوك مقروءًا ومضبوطًا على حالة الموقع (سكربتات سطرية، خطوط جوجل، سوكِت).

/* ═══════════ ١ · رؤوس الحماية ═══════════
   CSP مضبوطة على واقع الصفحات: كل السكربتات والأنماط سطرية داخل HTML
   (ولا eval ولا new Function في المشروع كلّه)، والخطوط من جوجل، والصور قد
   تكون data: (اللوحات المرسومة). فنسمح بذلك تحديدًا ونمنع ما عداه. */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'"
].join("; ");

function securityHeaders({ csp = true } = {}) {
  return function (req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    // HSTS خلف بروكسي Render فقط — لا نُرسله على http المحلّي كي لا يُقفل المتصفّح على https
    if (req.secure || req.headers["x-forwarded-proto"] === "https")
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    if (csp) res.setHeader("Content-Security-Policy", CSP);
    next();
  };
}

/* ═══════════ ٢ · حدّ المعدّل ═══════════
   نافذةٌ ثابتة في الذاكرة: تكفي لخادمٍ واحد (وهو حالنا)، وتُنظَّف دوريًّا
   فلا تتضخّم. المفتاح افتراضًا هو IP، ويمكن تخصيصه (اسم المستخدم مثلًا). */
const buckets = new Map();
let sweeper = null;

function ipOf(req) {
  // trust proxy مضبوطٌ في server.js فيصير req.ip صحيحًا خلف Render
  return (req.ip || req.connection?.remoteAddress || "?").replace(/^::ffff:/, "");
}

function rateLimit({ windowMs = 60000, max = 60, key = ipOf, name = "rl",
                     message = "طلباتٌ كثيرة، انتظر قليلًا.", skip = null } = {}) {
  if (!sweeper) {
    sweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }, 60000);
    if (sweeper.unref) sweeper.unref();
  }
  return function (req, res, next) {
    if (skip && skip(req)) return next();
    const k = name + "|" + key(req);
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
    b.n++;
    const left = Math.max(0, max - b.n);
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", left);
    res.setHeader("RateLimit-Reset", Math.ceil((b.reset - now) / 1000));
    if (b.n > max) {
      res.setHeader("Retry-After", Math.ceil((b.reset - now) / 1000));
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: message }));
    }
    next();
  };
}

/* عدّ الفاشل فقط: لا نعاقب من ينجح. يُستدعى `fail(req)` عند كل محاولةٍ خاطئة. */
function failLimiter({ windowMs = 600000, max = 8, key = ipOf, name = "fl",
                       message = "محاولاتٌ كثيرة فاشلة، انتظر قليلًا." } = {}) {
  const mw = function (req, res, next) {
    const k = name + "|" + key(req);
    const b = buckets.get(k);
    if (b && b.reset > Date.now() && b.n >= max) {
      res.setHeader("Retry-After", Math.ceil((b.reset - Date.now()) / 1000));
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: message }));
    }
    next();
  };
  mw.fail = function (req) {
    const k = name + "|" + key(req);
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset <= now) b = { n: 0, reset: now + windowMs };
    b.n++; buckets.set(k, b);
  };
  mw.clear = function (req) { buckets.delete(name + "|" + key(req)); };
  return mw;
}

/* للاختبار والفحص */
function _stats() { return { keys: buckets.size }; }
function _reset() { buckets.clear(); }

module.exports = { securityHeaders, rateLimit, failLimiter, ipOf, CSP, _stats, _reset };
