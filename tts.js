// 🔊 قراءة أسئلة «قمّة الهرم» بصوت ElevenLabs
// ─────────────────────────────────────────────────────────────
// • الصوت يُولَّد مرة واحدة ويُخزَّن في قاعدة البيانات (جدول blobs)
//   ثم يُقدَّم من /tts/<معرّف> مع كاش طويل، فلا يتكرر الاستهلاك أبدًا.
// • المفتاح يُقرأ من متغيّر البيئة ELEVEN_KEY ولا يُكتب في الكود إطلاقًا.
// • ترويسة character-cost في كل ردّ تخبرنا بالاستهلاك الحقيقي فنجمعه.
// • إعدادات الصوت حيّة: تُحفظ في قاعدة البيانات وتُعدَّل من اللوحة بلا إعادة نشر.

const crypto = require("crypto");
const qbank = require("./qbank");

const API = "https://api.elevenlabs.io/v1/text-to-speech/";
const KEY = () => (process.env.ELEVEN_KEY || "").trim();
const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));

const DEFAULTS = {
  voice: process.env.ELEVEN_VOICE || "9UuRdBvDIzU2SZY4KiIG", // Laloosh – Engaging & Confident E-Comm
  model: process.env.ELEVEN_MODEL || "eleven_v3",
  // 44.1kHz/192kbps: الجودة لا تُحتسب على الكريديت إطلاقًا (المحاسبة على الحروف فقط)،
  // و22kHz/32kbps كان يقصّ كل ما فوق 11kHz فيطلع الصوت مكتومًا بلا حروف صفير.
  format: process.env.ELEVEN_FORMAT || "mp3_44100_192",
  stability: num(process.env.ELEVEN_STABILITY, 0.7),
  similarity: num(process.env.ELEVEN_SIMILARITY, 0.52),
  speed: num(process.env.ELEVEN_SPEED, 1.08)
};
let CFG = { ...DEFAULTS };
let STORE = null;   // يُضبط في setupTts — لحفظ هبوط الصيغة تلقائيًّا

const PREFIX = "tts_";
const MIME = "audio/mpeg";

// mp3 بمعدّل بت ثابت ⇒ بايتات الثانية = kbps × 125، تُشتقّ من اسم الصيغة نفسها.
const bpsOf = f => (Number((String(f).match(/_(\d+)$/) || [])[1]) || 32) * 125;

// نظّف النص قبل النطق: نحذف رموز التنسيق ونوحّد المسافات.
function clean(t) {
  return String(t == null ? "" : t)
    .replace(/[*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// معرّف ثابت للسؤال = بصمة نصّه (فلو تعدّل السؤال يتولّد صوت جديد تلقائيًا).
function idOf(text) {
  const t = clean(text);
  if (!t) return "";
  return crypto.createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
}
const keyOf = id => PREFIX + id;

// ─── نداء ElevenLabs ───
async function synth(text, over) {
  const key = KEY();
  if (!key) throw new Error("ELEVEN_KEY غير مضبوط");
  const t = clean(text);
  if (!t) throw new Error("نص فارغ");
  if (t.length > 4800) throw new Error("النص أطول من حدّ الموديل");

  const c = { ...CFG, ...(over || {}) };
  const call = fmt => fetch(API + c.voice + "?output_format=" + fmt, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: t,
      model_id: c.model,
      voice_settings: {
        stability: c.stability,
        similarity_boost: c.similarity,
        speed: c.speed,
        use_speaker_boost: true
      }
    })
  });
  let res = await call(c.format);
  /* 192kbps متاحٌ من فئة Creator فقط؛ على الفئات الأدنى تردّ ElevenLabs 403
     output_format_not_allowed. نهبط تلقائيًّا إلى 128kbps (متاحٌ للجميع) ونثبّته
     كي لا يتكرّر النداء الفاشل مع كل سؤال. */
  if (res.status === 403 && /output_format_not_allowed|Output format/i.test(await res.clone().text().catch(() => ""))
      && c.format !== "mp3_44100_128") {
    console.warn("🔊 صيغة " + c.format + " غير متاحة لهذه الفئة — التحويل إلى mp3_44100_128");
    CFG.format = "mp3_44100_128"; c.format = "mp3_44100_128";
    if (STORE) STORE.saveKV("ttsCfg", CFG).catch(() => {});
    res = await call(c.format);
  }

  if (!res.ok) {
    let msg = "";
    try { msg = (await res.text()).slice(0, 300); } catch (e) {}
    const err = new Error("ElevenLabs " + res.status + ": " + msg);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const cost = Number(res.headers.get("character-cost") || 0) || Math.round(t.length * 0.555);
  const secs = Math.round((buf.length / bpsOf(c.format)) * 10) / 10;
  return { buf, cost, chars: t.length, secs };
}

// ─── حالة مهمة التوليد بالدفعات ───
const job = {
  running: false, stop: false,
  total: 0, done: 0, made: 0, skipped: 0, failed: 0,
  cost: 0, bytes: 0, cat: "", last: "", error: "", started: 0, finished: 0
};

function jobSnapshot() {
  return {
    running: job.running, total: job.total, done: job.done, made: job.made,
    skipped: job.skipped, failed: job.failed, cost: job.cost, bytes: job.bytes,
    cat: job.cat, last: job.last, error: job.error,
    started: job.started, finished: job.finished
  };
}

// كل نصوص الأسئلة (اختياريًا لفئات محدّدة)
/* نصوص التحديات (التوصيل والتصنيف) تُقرأ في صفحة القراءة قبل اللعبة بالصيغة
   نفسها التي يبنيها quiz.js — فتُولَّد مسبقًا هنا تحت فئةٍ وهمية «تحديات». */
const CHALLENGE_CAT = "تحديات";
function challengeTexts() {
  const out = [];
  (qbank.LINKS || []).forEach(l => { if (l && l.t) out.push(l.t); });
  (qbank.SORTS || []).forEach(s => { if (s && s.a && s.b) out.push(`صنّف: ${s.a} أم ${s.b}؟`); });
  return out;
}
function allTexts(cats) {
  const list = (cats && cats.length ? cats : qbank.categories().concat(CHALLENGE_CAT));
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const rows = c === CHALLENGE_CAT ? challengeTexts().map(t => [t]) : qbank.poolOf(c);
    for (const row of rows) {
      const id = idOf(row[0]);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, cat: c, text: clean(row[0]) });
    }
  }
  return out;
}

function setupTts(app, deps) {
  const { store } = deps;
  let DUR = {};          // { معرّف: ثواني } لضبط طول مرحلة القراءة
  let durTimer = null;

  // فهرس المدد. لو ضاع لسبب ما بينما الصوت باقٍ في القاعدة، نعيد بناءه من
  // وجود الملفات نفسها بمدّة تقديرية — فلا تصمت اللعبة أبدًا بسبب فهرس مفقود.
  store.getKV("ttsDur").then(async v => {
    if (v && typeof v === "object" && Object.keys(v).length) { DUR = v; return; }
    const items = allTexts();
    const have = new Set();
    for (let i = 0; i < items.length; i += 400) {
      const chunk = items.slice(i, i + 400).map(x => keyOf(x.id));
      (await store.hasBlobs(chunk)).forEach(k => have.add(k));
    }
    if (!have.size) return;
    for (const it of items) {
      if (have.has(keyOf(it.id))) DUR[it.id] = Math.round(Math.max(1.2, it.text.length * 0.075) * 10) / 10;
    }
    await store.saveKV("ttsDur", DUR).catch(() => {});
    console.log("🔊 أُعيد بناء فهرس مدد الصوت: " + have.size + " مقطعًا (مدد تقديرية)");
  }).catch(() => {});
  STORE = store;
  store.getKV("ttsCfg").then(v => {
    if (v && typeof v === "object") {
      CFG = { ...DEFAULTS, ...v };
      console.log("🔊 إعدادات صوت محفوظة: " + CFG.model + " · ثبات " + CFG.stability + " · سرعة " + CFG.speed);
    }
  }).catch(() => {});

  function noteDur(id, secs) {
    DUR[id] = secs;
    // حفظ دوري لا مؤجَّل: أثناء التوليد المتواصل لا تمرّ لحظة سكون فينتهي الأمر
    // بلا حفظ إطلاقًا، فلو تعطّل الخادم ضاع فهرس المقاطع وإن بقي الصوت في القاعدة.
    if (!durTimer) durTimer = setTimeout(() => {
      durTimer = null;
      store.saveKV("ttsDur", DUR).catch(() => {});
    }, 4000);
  }

  // ── تقديم الصوت للاعبين ──
  app.get("/tts/:id", async (req, res) => {
    const id = String(req.params.id || "").replace(/[^a-f0-9]/g, "").slice(0, 16);
    if (!id) { res.status(400).end("bad id"); return; }
    try {
      const b = await store.getBlob(keyOf(id));
      if (!b) { res.status(404).end("not generated"); return; }
      const data = Buffer.isBuffer(b.data) ? b.data : Buffer.from(b.data);
      res.writeHead(200, {
        "Content-Type": b.mime || MIME,
        "Content-Length": data.length,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "none"
      });
      res.end(data);
    } catch (e) {
      console.error("tts serve:", e.message);
      res.status(500).end("error");
    }
  });

  // ── محرّك التوليد ──
  async function runBuild({ cats, limit, budget, force, concurrency }) {
    if (job.running) return;
    const items = allTexts(cats);

    // تخطَّ ما هو مولَّد أصلًا (إلا لو طُلبت إعادة التوليد)
    let pending = items;
    if (!force) {
      const have = new Set();
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400).map(x => keyOf(x.id));
        (await store.hasBlobs(chunk)).forEach(k => have.add(k));
      }
      pending = items.filter(x => !have.has(keyOf(x.id)));
      job.skipped = items.length - pending.length;
    } else {
      job.skipped = 0;
    }
    if (limit > 0) pending = pending.slice(0, limit);

    Object.assign(job, {
      running: true, stop: false, total: pending.length, done: 0, made: 0,
      failed: 0, cost: 0, bytes: 0, cat: "", last: "", error: "",
      started: Date.now(), finished: 0
    });

    const N = Math.max(1, Math.min(4, concurrency || 3)); // حد التزامن في باقة Creator = 5
    let cursor = 0;

    async function worker() {
      while (!job.stop && cursor < pending.length) {
        if (budget > 0 && job.cost >= budget) { job.stop = true; job.error = "بلغنا سقف الكريديت المحدّد"; break; }
        const it = pending[cursor++];
        try {
          const { buf, cost, secs } = await synth(it.text);
          await store.putBlob(keyOf(it.id), MIME, buf);
          noteDur(it.id, secs);
          job.made++; job.cost += cost; job.bytes += buf.length;
          job.cat = it.cat; job.last = it.text.slice(0, 60);
        } catch (e) {
          job.failed++;
          job.error = e.message;
          // 401/403 = مشكلة مفتاح، و429 = تجاوز الحصة → أوقف فورًا
          if (e.status === 401 || e.status === 403 || e.status === 429) { job.stop = true; }
          else await new Promise(r => setTimeout(r, 700));
        }
        job.done++;
      }
    }

    try {
      await Promise.all(Array.from({ length: N }, worker));
    } finally {
      job.running = false;
      job.finished = Date.now();
      console.log(`🔊 التوليد انتهى: ${job.made} ملف · ${job.cost} كريديت · ${(job.bytes / 1048576).toFixed(1)} ميجا`);
    }
  }

  return {
    idOf,
    hasKey: () => !!KEY(),
    // معرّف الصوت للسؤال إن كان مولَّدًا فعلًا (وإلا null فلا يطلبه اللاعب عبثًا)
    idFor(text) { const id = idOf(text); return id && DUR[id] ? id : null; },
    durationOf(text) { const id = idOf(text); return (id && DUR[id]) || 0; },
    job: jobSnapshot,
    stop: () => { job.stop = true; },
    startBuild: opts => { runBuild(opts).catch(e => { job.running = false; job.error = e.message; }); },
    allTexts,
    synth,

    getCfg: () => ({ ...CFG, defaults: DEFAULTS }),
    async setCfg(obj) {
      const o = obj || {};
      const c = { ...CFG };
      if (o.voice) c.voice = String(o.voice).trim().slice(0, 40);
      if (o.model) c.model = String(o.model).trim().slice(0, 40);
      if (o.format) c.format = String(o.format).trim().slice(0, 30);
      if (o.stability !== undefined) c.stability = Math.max(0, Math.min(1, num(o.stability, c.stability)));
      if (o.similarity !== undefined) c.similarity = Math.max(0, Math.min(1, num(o.similarity, c.similarity)));
      if (o.speed !== undefined) c.speed = Math.max(0.5, Math.min(1.5, num(o.speed, c.speed)));
      CFG = c;
      await store.saveKV("ttsCfg", CFG);
      return { ...CFG };
    },

    // تجربة إعدادات دون المساس بالمقطع المعتمد للسؤال
    async trial(text, over) {
      const { buf, cost, chars, secs } = await synth(text, over);
      const id = crypto.randomBytes(8).toString("hex");
      await store.putBlob(keyOf(id), MIME, buf);
      return { id, cost, chars, secs, bytes: buf.length };
    },

    // تصفّح المقاطع المولَّدة للاستماع إليها
    list({ q = "", cat = "", page = 0, size = 40, mode = "ready" }) {
      const items = allTexts(cat ? [cat] : null);
      const s = clean(q);
      let f = s ? items.filter(x => x.text.includes(s)) : items;
      if (mode === "ready") f = f.filter(x => DUR[x.id]);
      else if (mode === "missing") f = f.filter(x => !DUR[x.id]);
      const total = f.length;
      const p = Math.max(0, Math.min(page, Math.ceil(total / size) - 1 || 0));
      return {
        total, page: p, pages: Math.ceil(total / size) || 1,
        items: f.slice(p * size, p * size + size).map(x => ({
          id: x.id, cat: x.cat, text: x.text, secs: DUR[x.id] || 0
        }))
      };
    },

    async stats(cats) {
      const items = allTexts(cats);
      const have = new Set();
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400).map(x => keyOf(x.id));
        (await store.hasBlobs(chunk)).forEach(k => have.add(k));
      }
      const byCat = {};
      for (const it of items) {
        const b = byCat[it.cat] || (byCat[it.cat] = { n: 0, ready: 0, chars: 0 });
        b.n++; b.chars += it.text.length;
        if (have.has(keyOf(it.id))) b.ready++;
      }
      const blob = await store.blobStats(PREFIX);
      const chars = items.reduce((s, x) => s + x.text.length, 0);
      return {
        total: items.length, ready: have.size, chars,
        estCost: Math.round(chars * 0.555),
        storedBytes: blob.bytes, storedCount: blob.n,
        byCat, cfg: { ...CFG }, hasKey: !!KEY()
      };
    },

    /* إدخال مقطعٍ جاهز (مولَّد من موقع ElevenLabs يدويًّا) بالمفتاح نفسه الذي
       يستعمله التوليد الآليّ — فيُقدَّم من /tts/<id> كأيّ مقطعٍ آخر. */
    async putClip(text, buf, secs) {
      const id = idOf(text);
      if (!id) throw new Error("نص فارغ");
      await store.putBlob(keyOf(id), MIME, buf);
      noteDur(id, secs > 0 ? secs : Math.round((buf.length / bpsOf("mp3_44100_128")) * 10) / 10);
      return id;
    },
    async missing(cats) {
      const items = allTexts(cats);
      const have = new Set();
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400).map(x => keyOf(x.id));
        (await store.hasBlobs(chunk)).forEach(k => have.add(k));
      }
      return items.filter(x => !have.has(keyOf(x.id)));
    },

    async previewOne(text) {
      const { buf, cost, chars, secs } = await synth(text);
      const id = idOf(text);
      await store.putBlob(keyOf(id), MIME, buf);
      noteDur(id, secs);
      return { id, cost, chars, secs, bytes: buf.length };
    },

    async clear() {
      const items = allTexts();
      let n = 0;
      for (let i = 0; i < items.length; i += 400) {
        n += await store.delBlobs(items.slice(i, i + 400).map(x => keyOf(x.id)));
      }
      DUR = {};
      await store.saveKV("ttsDur", DUR).catch(() => {});
      return n;
    }
  };
}

module.exports = { setupTts, idOf, clean, DEFAULTS };
