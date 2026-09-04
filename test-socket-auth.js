// اختبار هويّة السوكِت بلا عميل: نستدعي الوسيط مباشرةً بمقبسٍ وهميّ
process.env.SESSION_SECRET = "thesecret";
const path = "./";
const { attachSocketAuth, nameFromSocket } = require("./account.js");
const A = require("./auth.js");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };

// مخزنٌ وهميّ
const users = { 1: { id: 1, name: "سعيد" } };
const sessions = { [A.tokenHash("رمزٌ صالح")]: { userId: 1, expiresAt: Date.now() + 1e6, revokedAt: null } };
const store = {
  findSession: async h => sessions[h] || null,
  getUserById: async id => users[id] || null,
  getUser: async n => Object.values(users).find(u => u.name === n) || null
};

// io وهميّ يلتقط الوسيط
let mw = null;
const io = { of: () => ({ use: f => { mw = f; } }) };
attachSocketAuth(io, store, ["/quiz"]);

const mkSocket = cookie => ({ handshake: { headers: { cookie } } });
const run = s => new Promise(r => mw(s, r));

(async () => {
  console.log("\n═══ هويّة السوكِت ═══\n");
  ok(typeof mw === "function", "الوسيط رُكّب على مساحة الاسم");

  let s = mkSocket("acct=" + encodeURIComponent("رمزٌ صالح"));
  await run(s);
  ok(s.userName === "سعيد" && s.userId === 1, "جلسةٌ صالحة → يُعرَف اللاعب", { n: s.userName, id: s.userId });
  ok(nameFromSocket(s) === "سعيد", "nameFromSocket تُعيدها بلا استعلامٍ ثانٍ");

  s = mkSocket("acct=رمزٌ مزوّر");
  await run(s);
  ok(s.userName === null, "رمزٌ مزوّر → ضيف");
  ok(nameFromSocket(s) === null, "ولا يتسرّب اسمٌ من الكوكي القديم");

  s = mkSocket("");
  await run(s);
  ok(s.userName === null, "بلا كوكي → ضيف");

  // كوكي قديم (توقيع HMAC) يُقبل للتعرّف
  const crypto = require("crypto");
  const payload = Buffer.from("سعيد", "utf8").toString("base64url") + "." + Date.now();
  const sig = crypto.createHmac("sha256", "thesecret").update(payload).digest("hex");
  s = mkSocket("acct=" + encodeURIComponent(payload + "." + sig));
  await run(s);
  ok(s.userName === "سعيد", "الكوكي القديم ما زال يُعرَف (لا أحد يخرج عند النشر)");

  // جلسةٌ مُبطَلة
  sessions[A.tokenHash("مبطلة")] = { userId: 1, expiresAt: Date.now() + 1e6, revokedAt: Date.now() };
  s = mkSocket("acct=" + encodeURIComponent("مبطلة"));
  await run(s);
  ok(s.userName === null, "جلسةٌ مُبطَلة → ضيف");

  console.log(`\n  ${P} ناجح / ${F} فاشل\n`);
  process.exit(F ? 1 : 0);
})();
