// 💬 الدعم والإبلاغ — تذكرةٌ هي محادثة، لا نموذجٌ يذهب في الفراغ.
//
// ثلاثة قرارات تشرح شكل هذا الملفّ:
//
//  ١) الضيف يُبلّغ. من رأى شيئًا سيّئًا في غرفةٍ ولا حساب له، بلاغُه أهمّ
//     من قاعدتنا. لكنه لا يرى خيطًا لاحقًا — لا هويّة تربطه به، وربطُه
//     بالكوكي وحده يعني أن من مسح كوكيه قرأ تذاكر غيره.
//  ٢) الصور مفاتيحُ في blobs لا بايتاتٌ في صفّ الرسالة. وتُقدَّم من مسارٍ
//     يفحص الملكيّة، فلا يُخمّن أحدٌ مفتاحًا ويرى صورة غيره.
//  ٣) الإغلاق لا يُسكِت. ردُّ صاحب التذكرة يُعيد فتحها — فمشكلةٌ أُغلقت
//     وهي قائمة ليست مشكلةً محلولة.

const { rateLimit } = require("./security");

const KINDS = {
  help:    "مشكلة أو سؤال",
  report:  "إبلاغ عن لاعب",
  bug:     "خلل في الموقع",
  buy:     "شراء ورصيد",
  idea:    "اقتراح"
};

const MAX_IMAGES = 5;
const MAX_IMG_BYTES = 700 * 1024;      /* بعد الضغط في المتصفّح */
const MAX_BODY = 4000;
const MAX_SUBJECT = 120;
const OK_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** يفكّ data:URL ويتحقّق منه. يُرجع {mime,buf} أو null. */
function decodeImage(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !OK_MIME[m[1]]) return null;
  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch (e) { return null; }
  if (!buf.length || buf.length > MAX_IMG_BYTES) return null;
  /* توقيع الملفّ لا امتداده: من يُسمّي ملفًّا تنفيذيًّا image/png يُردّ هنا. */
  const sig = buf.subarray(0, 12);
  const isPng  = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47;
  const isJpg  = sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF;
  const isWebp = sig.subarray(0, 4).toString("latin1") === "RIFF" &&
                 sig.subarray(8, 12).toString("latin1") === "WEBP";
  if (!(isPng || isJpg || isWebp)) return null;
  return { mime: m[1], buf };
}

/** يحفظ صور رسالةٍ في blobs ويُرجع مفاتيحها. */
async function saveImages(store, ticketId, list) {
  const out = [];
  const arr = Array.isArray(list) ? list.slice(0, MAX_IMAGES) : [];
  for (let i = 0; i < arr.length; i++) {
    const img = decodeImage(arr[i]);
    if (!img) continue;                       /* صورةٌ فاسدة تُتجاهَل ولا تُسقط الرسالة */
    const key = `tkt_${ticketId}_${Date.now().toString(36)}_${i}`;
    await store.putBlob(key, img.mime, img.buf);
    out.push(key);
  }
  return out;
}

function setupSupport(app, deps) {
  const express = require("express");
  const st = () => deps.store;
  const who = (req, res) => deps.currentUser(req, res);
  /* حدٌّ أكبر لهذا المسار وحده: خمس صورٍ بعد الضغط قد تبلغ أربعة ميغا،
     ولا نرفع الحدّ العامّ من أجلها. */
  const bigJson = express.json({ limit: "6mb" });
  const smallJson = express.json({ limit: "8kb" });

  const ipOf = req =>
    ((req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "?")
      .toString().replace(/^::ffff:/, "").trim();

  app.get(["/support", "/da3m"], (req, res) =>
    res.sendFile(require("path").join(deps.pubDir, "support.html")));

  app.get("/api/support/kinds", (req, res) => res.json({ ok: true, kinds: KINDS }));

  /** فتح تذكرة. الضيف مسموحٌ له — لكنه لا يملك خيطًا يعود إليه. */
  app.post("/api/support/new",
    rateLimit({ name: "tkt", windowMs: 3600000, max: 6, message: "تذاكر كثيرة، انتظر قليلًا." }),
    bigJson, async (req, res) => {
    try {
      const u = await who(req, res);
      if (u && u.bannedUntil && u.bannedUntil > Date.now())
        return res.status(403).json({ ok: false, error: "الحساب موقوف" });

      const kind = KINDS[req.body?.kind] ? req.body.kind : "help";
      const subject = String(req.body?.subject || "").trim().slice(0, MAX_SUBJECT);
      const body = String(req.body?.body || "").trim().slice(0, MAX_BODY);
      if (subject.length < 3) return res.status(400).json({ ok: false, error: "اكتب عنوانًا مختصرًا" });
      if (body.length < 5) return res.status(400).json({ ok: false, error: "اشرح مشكلتك قليلًا" });

      const id = await st().createTicket({
        userId: u ? u.id : null, name: u ? u.name : (req.body?.name || "ضيف"),
        kind, subject, ip: ipOf(req)
      });
      const images = await saveImages(st(), id, req.body?.images);
      await st().addTicketMessage(id, { fromAdmin: false, body, images });
      res.json({ ok: true, id, guest: !u, images: images.length });
    } catch (e) {
      console.error("support new:", e.message);
      res.status(500).json({ ok: false, error: "تعذّر الإرسال" });
    }
  });

  app.get("/api/support/mine", async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.json({ ok: true, guest: true, tickets: [] });
      res.json({ ok: true, guest: false, tickets: await st().listTickets({ userId: u.id }) });
    } catch (e) { res.json({ ok: true, guest: true, tickets: [] }); }
  });

  /** خيط التذكرة — لصاحبها وحده. */
  app.get("/api/support/t/:id", async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const t = await st().getTicket(req.params.id);
      if (!t || t.userId !== u.id) return res.status(404).json({ ok: false, error: "لا توجد" });
      res.json({ ok: true, ticket: t, kinds: KINDS });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر الفتح" }); }
  });

  app.post("/api/support/t/:id/reply",
    rateLimit({ name: "tktr", windowMs: 3600000, max: 40 }),
    bigJson, async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const t = await st().getTicket(req.params.id);
      if (!t || t.userId !== u.id) return res.status(404).json({ ok: false, error: "لا توجد" });
      const body = String(req.body?.body || "").trim().slice(0, MAX_BODY);
      const images = await saveImages(st(), t.id, req.body?.images);
      if (!body && !images.length) return res.status(400).json({ ok: false, error: "اكتب شيئًا" });
      await st().addTicketMessage(t.id, { fromAdmin: false, body, images });
      res.json({ ok: true });
    } catch (e) {
      console.error("support reply:", e.message);
      res.status(500).json({ ok: false, error: "تعذّر الإرسال" });
    }
  });

  /** صورة مرفقة — لصاحب التذكرة أو للإدارة، ولا أحد غيرهما. */
  app.get("/api/support/img/:key", async (req, res) => {
    try {
      const key = String(req.params.key || "");
      const m = key.match(/^tkt_(\d+)_/);
      if (!m) return res.status(404).end();

      let allowed = false;
      try {
        const { verifySession, parseCookies } = require("./admin");
        allowed = verifySession(parseCookies(req).adm);
      } catch (e) {}
      if (!allowed) {
        const u = await who(req, res);
        const t = u ? await st().getTicket(m[1]) : null;
        allowed = !!(t && t.userId === u.id && t.messages.some(x => (x.images || []).includes(key)));
      }
      if (!allowed) return res.status(403).end();

      const b = await st().getBlob(key);
      if (!b) return res.status(404).end();
      res.set("Content-Type", b.mime);
      res.set("Cache-Control", "private, max-age=3600");
      res.send(b.data);
    } catch (e) { res.status(500).end(); }
  });

  console.log("💬 الدعم جاهز على /support");
  return { KINDS, decodeImage, saveImages, MAX_IMAGES };
}

module.exports = { setupSupport, KINDS, decodeImage, saveImages,
                   MAX_IMAGES, MAX_IMG_BYTES, MAX_BODY, MAX_SUBJECT };
