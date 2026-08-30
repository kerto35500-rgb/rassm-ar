// 🔊 قراءة أسئلة «قمّة الهرم» بصوت ElevenLabs
// ─────────────────────────────────────────────────────────────
// • الصوت يُولَّد مرة واحدة ويُخزَّن في قاعدة البيانات (جدول blobs)
//   ثم يُقدَّم من /tts/<معرّف> مع كاش طويل، فلا يتكرر الاستهلاك أبدًا.
// • المفتاح يُقرأ من متغيّر البيئة ELEVEN_KEY ولا يُكتب في الكود إطلاقًا.
// • ترويسة character-cost في كل ردّ تخبرنا بالاستهلاك الحقيقي فنجمعه.

const crypto = require("crypto");
const qbank = require("./qbank");

const API = "https://api.elevenlabs.io/v1/text-to-speech/";
const VOICE = process.env.ELEVEN_VOICE || "9UuRdBvDIzU2SZY4KiIG"; // Laloosh – Engaging & Confident E-Comm
const MODEL = process.env.ELEVEN_MODEL || "eleven_v3";
// 44.1kHz/192kbps: الجودة لا تُحتسب على الكريديت إطلاقًا (المحاسبة على الحروف فقط)،
// و22kHz/32kbps كان يقصّ كل ما فوق 11kHz فيطلع الصوت مكتومًا بلا حروف صفير.
const FORMAT = process.env.ELEVEN_FORMAT || "mp3_44100_192";
const KEY = () => (process.env.ELEVEN_KEY || "").trim();

const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
const SETTINGS = {
  stability: num(process.env.ELEVEN_STABILITY, 0.70),
  similarity_boost: num(process.env.ELEVEN_SIMILARITY, 0.52),
  speed: num(process.env.ELEVEN_SPEED, 1.08),
  use_speaker_boost: true
};

const PREFIX = "tts_";
const MIME = "audio/mpeg";

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
async function synth(text) {
  const key = KEY();
  if (!key) throw new Error("ELEVEN_KEY غير مضبوط");
  const t = clean(text);
  if (!t) throw new Error("نص فارغ");
  if (t.length > 4800) throw new Error("النص أطول من حدّ الموديل");

  const res = await fetch(API + VOICE + "?output_format=" + FORMAT, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: t,
      model_id: MODEL,
      voice_settings: SETTINGS
    })
  });

  if (!res.ok) {
    let msg = "";
    try { msg = (await res.text()).slice(0, 300); } catch (e) {}
    const err = new Error("ElevenLabs " + res.status + ": " + msg);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const cost = Number(res.headers.get("character-cost") || 0) || Math.round(t.length * 0.555);
  return { buf, cost, chars: t.length };
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
function allTexts(cats) {
  const list = (cats && cats.length ? cats : qbank.categories());
  const out = [];
  const seen = new Set();
  for (const c of list) {
    for (const row of qbank.poolOf(c)) {
      const id = idOf(row[0]);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, cat: c, text: clean(row[0]) });
    }
  }
  return out;
}

// مدّة كل مقطع بالثواني { معرّف: ثواني } — تُحفظ لنضبط طول مرحلة القراءة.
// mp3 بمعدّل بت ثابت ⇒ بايتات الثانية = kbps × 125، تُشتقّ من اسم الصيغة نفسها
// حتى لا تنكسر الحسبة لو غيّرنا الجودة لاحقًا.
const BITRATE_BPS = (Number((FORMAT.match(/_(\d+)$/) || [])[1]) || 32) * 125;

function setupTts(app, deps) {
  const { store } = deps;
  let DUR = {};
  let durTimer = null;
  store.getKV("ttsDur").then(v => { if (v && typeof v === "object") DUR = v; }).catch(() => {});
  function noteDur(id, bytes) {
    DUR[id] = Math.round((bytes / BITRATE_BPS) * 10) / 10;
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
          const { buf, cost } = await synth(it.text);
          await store.putBlob(keyOf(it.id), MIME, buf);
          noteDur(it.id, buf.length);
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
        byCat, voice: VOICE, model: MODEL, format: FORMAT, hasKey: !!KEY()
      };
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
    async previewOne(text) {
      const { buf, cost, chars } = await synth(text);
      const id = idOf(text);
      await store.putBlob(keyOf(id), MIME, buf);
      noteDur(id, buf.length);
      return { id, cost, chars, bytes: buf.length, secs: DUR[id] };
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

module.exports = { setupTts, idOf, clean, VOICE, MODEL, FORMAT };
