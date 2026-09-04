// 🔐 طبقة الهوية — كلمات السرّ والجلسات.
//
// ما الذي تغيّر عن السابق ولماذا:
//  ١) التجزئة كانت scryptSync: تُجمّد حلقة الأحداث لكل دخول (والخادم واحد
//     لكل الألعاب). صارت غير متزامنة، وبصيغةٍ تحمل معاملاتها فنستطيع تقويتها
//     لاحقًا بلا كسر الحسابات القائمة.
//  ٢) الجلسة كانت توقيعًا بلا تخزين: لا يمكن إبطالها، ولا «خروج من كل
//     الأجهزة»، ولا معرفة أجهزة الحساب. صارت صفًّا في جدول sessions،
//     والكوكي يحمل رمزًا عشوائيًّا لا يُخزَّن إلا مُجزَّأً.
//  ٣) الهوية صارت بمعرّفٍ رقميّ لا بالاسم، فيصير تغيير الاسم ممكنًا لاحقًا.

const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

/* ═══════════ كلمات السرّ ═══════════
   الصيغة: s2$N$r$p$salt$hash — كلها base64url.
   N=2^15 توازنٌ معقولٌ على خادمٍ مجانيّ (~٦٠ م.ث للتجزئة الواحدة). */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const b64 = b => b.toString("base64url");

async function hashPassword(pass, params = PARAMS) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pass), salt, params.keylen,
    { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem });
  return `s2$${params.N}$${params.r}$${params.p}$${b64(salt)}$${b64(key)}`;
}

/** تحقّقٌ من الصيغة الجديدة. يعيد false بهدوءٍ لأي تشويهٍ في النصّ. */
async function verifyNew(pass, stored) {
  try {
    const [tag, N, r, p, salt, hash] = String(stored).split("$");
    if (tag !== "s2") return false;
    const key = await scrypt(String(pass), Buffer.from(salt, "base64url"),
      Buffer.from(hash, "base64url").length,
      { N: +N, r: +r, p: +p, maxmem: PARAMS.maxmem });
    return timingEqual(key, Buffer.from(hash, "base64url"));
  } catch (e) { return false; }
}

/** الصيغة القديمة: عمودا salt وhash مع scryptSync الافتراضيّ (keylen 64). */
async function verifyLegacy(pass, salt, hash) {
  try {
    const key = await scrypt(String(pass), String(salt), 64);   // N الافتراضيّ 16384
    return timingEqual(key, Buffer.from(String(hash), "hex"));
  } catch (e) { return false; }
}

function timingEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

/** هل تحتاج هذه التجزئة ترقيةً إلى المعاملات الحالية؟ */
function needsUpgrade(stored) {
  if (!stored || !String(stored).startsWith("s2$")) return true;   // قديمة
  const [, N, r, p] = String(stored).split("$");
  return +N !== PARAMS.N || +r !== PARAMS.r || +p !== PARAMS.p;
}

/* ═══════════ قوّة كلمة السرّ ═══════════
   لا نُرهق الناس بقواعدٍ عبثيّة (رمزٌ ورقمٌ وحرفٌ كبير)، بل نمنع الشائع
   والقصير — وهو ما يُكسَر فعلًا. */
const COMMON = new Set([
  "123456", "1234567", "12345678", "123456789", "1234567890", "password",
  "111111", "000000", "123123", "qwerty", "abc123", "iloveyou", "admin",
  "welcome", "monkey", "dragon", "letmein", "football", "master", "sunshine",
  "123321", "654321", "aaaaaa", "1q2w3e4r", "zaq12wsx", "qwerty123",
  "كلمةالسر", "كلمهالسر", "الحمدلله", "بسمالله", "123456a", "a123456"
]);
function passwordProblem(pass, name) {
  const p = String(pass || "");
  if (p.length < 8) return "كلمة السرّ قصيرة — ثمانية أحرفٍ على الأقلّ";
  if (p.length > 200) return "كلمة السرّ طويلة جدًّا";
  const low = p.toLowerCase();
  if (COMMON.has(low)) return "كلمة السرّ شائعةٌ جدًّا — اختر غيرها";
  if (name && low === String(name).toLowerCase()) return "لا تجعل كلمة السرّ اسمك نفسه";
  if (/^(.)\1+$/.test(p)) return "كلمة السرّ حرفٌ مكرّر — اختر غيرها";
  if (/^\d+$/.test(p) && p.length < 12) return "أرقامٌ فقط سهلةُ التخمين — أضف حروفًا";
  return null;
}

/* ═══════════ الجلسات ═══════════
   الكوكي يحمل رمزًا عشوائيًّا (٣٢ بايت). نخزّن تجزئته فقط، فلو تسرّبت
   القاعدة لم تُنتحَل جلسة. */
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;
const newToken = () => crypto.randomBytes(32).toString("base64url");
const tokenHash = t => crypto.createHash("sha256").update(String(t)).digest("hex");

function makeSessions(store) {
  return {
    async create(userId, { ua = "", ip = "" } = {}) {
      const token = newToken();
      const now = Date.now();
      await store.createSession({
        userId, tokenHash: tokenHash(token),
        ua: String(ua).slice(0, 200), ip: String(ip).slice(0, 60),
        createdAt: now, expiresAt: now + SESSION_MS
      });
      return { token, expiresAt: now + SESSION_MS };
    },
    async userOf(token) {
      if (!token) return null;
      const s = await store.findSession(tokenHash(token));
      if (!s || s.revokedAt || s.expiresAt <= Date.now()) return null;
      return store.getUserById(s.userId);
    },
    async revoke(token) { if (token) await store.revokeSession(tokenHash(token)); },
    async revokeAll(userId) { await store.revokeUserSessions(userId); },
    async list(userId) { return store.listSessions(userId); }
  };
}

module.exports = {
  hashPassword, verifyNew, verifyLegacy, needsUpgrade, passwordProblem,
  makeSessions, tokenHash, newToken, timingEqual,
  SESSION_DAYS, SESSION_MS, PARAMS
};
