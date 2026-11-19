// اختبار واجهة «البسكويتة الحارّة» من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/spicy/app.js **الحقيقيّ** (مع theme.js) داخل DOM مصغّرٍ يُبنى من
// public/spicy/index.html نفسه، ونصله بخادم spicysrv.js **الحقيقيّ** عبر
// socket.io مُحاكى تمرّ رسائلُه بـJSON كالشبكة. ثمّ نلعب **بالنقر وحده**:
// ماكاروناتُ اليد، والمزايدةُ بالزرّين، والكوم في الكشف (كومتي أوّلًا 🔒).
//
// ما يصطاده: أيُّ استثناءٍ في الواجهة، وأنّ صفحةَ الخصم لا تحمل وجهَ ماكارونتي
// قبل قلبها، وأنّ المقلوبة تنقلب (up)، واهتزازَ الشاشة عند الحارّة، وأنّ نوعَ
// الخسارة لصاحبها وحده، ونافذةَ النهاية بالترتيب.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupSpicyOnline } = require("./spicysrv");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) { /* لم يجهز بعد */ } await sleep(4); }
  return false;
}

/* ══════════ DOM مصغّر ══════════ */
const VOID = new Set(["input", "br", "img", "meta", "link", "hr", "source", "area", "base", "col", "embed", "wbr"]);
const escH = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unH = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class Text {
  constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; }
  get textContent() { return this.data; }
  get outerHTML() { return escH(this.data); }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
}
function makeStyle() {
  const s = {};
  Object.defineProperties(s, {
    setProperty: { value: (k, v) => { s[k] = String(v); } },
    getPropertyValue: { value: k => (s[k] != null ? String(s[k]) : "") },
    removeProperty: { value: k => { delete s[k]; } }
  });
  return s;
}
class El {
  constructor(tag, doc) {
    this.nodeType = 1; this.localName = tag; this.tagName = tag.toUpperCase(); this.ownerDocument = doc;
    this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = makeStyle();
    this._ls = {}; this.value = ""; this.disabled = false; this.scrollTop = 0;
    const el = this;
    /* dataset ينعكس على السمات كما في المتصفّح: ‎el.dataset.m = "x"‎ ⇒ ‎[data-m="x"]‎ */
    const ds = this._ds = {};
    this.dataset = new Proxy(ds, {
      set: (o, k, v) => { o[k] = String(v); el.attrs["data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())] = String(v); return true; },
      deleteProperty: (o, k) => { delete o[k]; delete el.attrs["data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())]; return true; }
    });
    const get = () => (el.attrs.class || "").split(/\s+/).filter(Boolean);
    const set = a => { el.attrs.class = a.join(" "); };
    this.classList = {
      add: (...c) => { const a = get(); c.forEach(x => a.includes(x) || a.push(x)); set(a); },
      remove: (...c) => set(get().filter(x => !c.includes(x))),
      toggle: (c, f) => { const has = get().includes(c); const want = f === undefined ? !has : !!f;
        if (want && !has) set([...get(), c]); if (!want && has) set(get().filter(x => x !== c)); return want; },
      contains: c => get().includes(c)
    };
  }
  get id() { return this.attrs.id || ""; } set id(v) { this.attrs.id = String(v); }
  get className() { return this.attrs.class || ""; } set className(v) { this.attrs.class = String(v); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get scrollHeight() { return 1000; }
  get offsetWidth() { return 100; }
  setAttribute(k, v) {
    v = String(v); this.attrs[k] = v;
    if (k.startsWith("data-")) this._ds[camel(k.slice(5))] = v;
    if (k === "disabled") this.disabled = true;
    if (k === "value") this.value = v;
    if (k === "style") for (const d of v.split(";")) { const i = d.indexOf(":"); if (i > 0) this.style[camel(d.slice(0, i).trim())] = d.slice(i + 1).trim(); }
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  _detach(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  appendChild(n) { if (n.parentNode) n.parentNode._detach(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode._detach(n);
    const i = this.childNodes.indexOf(ref); n.parentNode = this;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n;
  }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (v != null && v !== "") this.appendChild(new Text(String(v))); }
  get innerHTML() { return this.childNodes.map(n => n.outerHTML).join(""); }
  set innerHTML(h) { this.textContent = ""; parseInto(this, String(h)); }
  get outerHTML() {
    /* الأنماطُ المضبوطة بالسكربت تُكتب في سمة style — فتُرسَم اللقطةُ كما هي */
    const css = Object.keys(this.style).map(k => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())) + ":" + this.style[k]).join(";");
    const at = { ...this.attrs }; if (css) at.style = css; else delete at.style;
    const a = Object.entries(at).map(([k, v]) => ` ${k}="${escH(v)}"`).join("");
    return `<${this.localName}${a}>${VOID.has(this.localName) ? "" : this.innerHTML + `</${this.localName}>`}`;
  }
  insertAdjacentHTML(pos, h) { parseInto(this, String(h)); }
  addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
  removeEventListener() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }; }
  /* حدثٌ يصعد إلى الآباء كما في المتصفّح (نافذةُ النتيجة تلتقط نقرة زرّها هكذا)،
     ثمّ إلى مستمعي document (الفقاعةُ ولوحةُ العبارات واللعبُ التلقائيّ هناك).
     ونقرةُ المتصفّح يسبقها pointerdown — فنرسله أوّلًا كما يفعل هو */
  dispatch(type, ev = {}) {
    if (type === "click" && !ev._fromClick) this.dispatch("pointerdown", { _fromClick: true });
    ev.type = type; ev.target = ev.target || this;
    let stop = false;
    ev.preventDefault = ev.preventDefault || (() => {}); ev.stopPropagation = () => { stop = true; };
    const doc = this.ownerDocument;
    /* مستمعو الالتقاط على document أوّلًا (addEventListener(..., true)) */
    if (doc && doc._cap && doc._cap[type]) doc._cap[type].slice().forEach(f => f(ev));
    for (let n = this; n && n.nodeType === 1 && !stop; n = n.parentNode) {
      ev.currentTarget = n;
      (n._ls[type] || []).slice().forEach(f => f.call(n, ev));
      if (typeof n["on" + type] === "function") n["on" + type].call(n, ev);
    }
    if (!stop && doc && doc._ls && doc._ls[type]) doc._ls[type].slice().forEach(f => f(ev));
    return ev;
  }
  /* المحدِّدات: وسمٌ ‎#معرّف ‎.صنف ‎[سمة] مركّبةً، وفراغٌ للسلالة — يكفي app.js */
  matches(sel) {
    const parts = sel.trim().split(/\s+/);
    if (!matchOne(this, parts[parts.length - 1])) return false;
    let n = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (n && n.nodeType === 1 && !matchOne(n, parts[i])) n = n.parentNode;
      if (!n || n.nodeType !== 1) return false;
      n = n.parentNode;
    }
    return true;
  }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function matchOne(el, s) {
  const m = s.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/);
  if (!m) throw new Error("محدِّدٌ غير مدعوم: " + s);
  if (m[1] && el.localName.toLowerCase() !== m[1].toLowerCase()) return false;
  for (const p of (m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [])) {
    if (p[0] === "#" && el.id !== p.slice(1)) return false;
    if (p[0] === "." && !el.classList.contains(p.slice(1))) return false;
    if (p[0] === "[") {
      const [k, v] = p.slice(1, -1).split("=");
      if (!el.hasAttribute(k)) return false;
      if (v != null && el.getAttribute(k) !== v.replace(/^["']|["']$/g, "")) return false;
    }
  }
  return true;
}
function parseInto(root, html) {
  const doc = root.ownerDocument;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let cur = root, last = 0, m;
  const text = t => { if (t) cur.appendChild(new Text(unH(t))); };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {                                   /* وسمُ إغلاق */
      let n = cur;
      while (n && n !== root && n.localName.toLowerCase() !== tag) n = n.parentNode;
      if (n && n !== root) cur = n.parentNode;
      continue;
    }
    const el = new El(m[2], doc);
    const ar = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
    while ((a = ar.exec(m[3]))) el.setAttribute(a[1], unH(a[2] ?? a[3] ?? a[4] ?? ""));
    cur.appendChild(el);
    if (tag === "script" || tag === "style") {
      const end = html.toLowerCase().indexOf("</" + tag, last);
      last = end < 0 ? html.length : html.indexOf(">", end) + 1;
      re.lastIndex = last;
      continue;
    }
    if (!VOID.has(tag) && !m[4]) cur = el;
  }
  text(html.slice(last));
}
function makeDocument(bodyHtml, bodyAttrs) {
  const doc = { readyState: "complete" };
  doc.body = new El("body", doc); doc.head = new El("head", doc);
  for (const [k, v] of Object.entries(bodyAttrs)) doc.body.setAttribute(k, v);
  doc.createElement = t => new El(t, doc);
  doc.createElementNS = (ns, t) => new El(t, doc);
  doc.getElementById = id => doc.body.querySelector("#" + id) || doc.head.querySelector("#" + id);
  doc.querySelector = s => doc.body.querySelector(s) || doc.head.querySelector(s);
  doc.querySelectorAll = s => [...doc.head.querySelectorAll(s), ...doc.body.querySelectorAll(s)];
  doc._ls = {}; doc._cap = {};
  doc.addEventListener = (t, f, cap) => { const m = cap ? doc._cap : doc._ls; (m[t] = m[t] || []).push(f); };
  parseInto(doc.body, bodyHtml);
  return doc;
}

/* ══════════ الخادم الحقيقيّ و socket.io مُحاكى ══════════ */
class FS {                                           /* مقبسُ الخادم */
  constructor(id) { this.id = id; this.rooms = new Set([id]); this.h = {}; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  get handshake() { return { headers: {}, address: "1.2.3.4" }; }
  emit(e, d) {
    const data = d === undefined ? undefined : JSON.parse(JSON.stringify(d));
    const c = this.client;
    setImmediate(() => c && c._deliver(e, data));
  }
  /* بثٌّ للغرفة إلا المرسل (كـ socket.to) */
  to(r) { return { emit: (e, d) => nsp.sockets.forEach(s => { if (s !== this && s.rooms.has(r)) s.emit(e, d); }) }; }
}
const nsp = {
  cf: [], sockets: new Map(), n: 0,
  on(e, f) { if (e === "connection") this.cf.push(f); },
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
};

const stats = [];
const api = setupSpicyOnline({ of: () => nsp }, {
  store: { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } }, graceMs: 400, secsScale: 1, botDelay: [60, 90]
});
function connectClient() {
  const handlers = {};
  const s = new FS("s" + (++nsp.n));
  const c = {
    on(e, f) { (handlers[e] = handlers[e] || []).push(f); return c; },
    emit(e, d, ack) {
      const data = d === undefined ? undefined : JSON.parse(JSON.stringify(d));
      setImmediate(() => s.fire(e, data, typeof ack === "function"
        ? res => { const r = JSON.parse(JSON.stringify(res)); setImmediate(() => ack(r)); } : undefined));
    },
    io: { on() {} },
    _deliver(e, d) { (handlers[e] || []).slice().forEach(f => f(d)); },
    disconnect() { nsp.sockets.delete(s.id); s.client = null; s.fire("disconnect"); }
  };
  s.client = c;
  nsp.sockets.set(s.id, s);
  setImmediate(() => nsp.cf.forEach(f => f(s)));
  return c;
}

/* ══════════ متصفّحٌ مصغّر ══════════ */
const errors = [];
process.on("uncaughtException", e => errors.push(e));
process.on("unhandledRejection", e => errors.push(e));

const PUB = p => path.join(__dirname, "public", p);
const HTML = fs.readFileSync(PUB("spicy/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { app: fs.readFileSync(PUB("spicy/app.js"), "utf8"), theme: fs.readFileSync(PUB("theme.js"), "utf8") };

function openPage(name, search = "", store = {}) {
  const doc = makeDocument(BODY[2], bodyAttrs);
  doc.documentElement = doc.body;
  const ctx = {
    document: doc, console, URLSearchParams, Promise, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Date, Error, TypeError, isNaN, parseFloat, parseInt, Symbol, RegExp,
    setTimeout: (f, ms, ...a) => setTimeout(f, Math.min(+ms || 0, 3), ...a), clearTimeout,
    setInterval: (f, ms, ...a) => setInterval(f, Math.max(5, Math.min(+ms || 0, 15)), ...a), clearInterval,
    requestAnimationFrame: f => setTimeout(() => f(Date.now()), 2),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search, origin: "http://sp.test", href: "http://sp.test/spicy/" + search, reload() {} },
    history: { replaceState(a, b, u) { ctx.location.search = String(u).replace(/^[^?]*/, ""); } },
    navigator: {}, alerts: [],
    alert: m => ctx.alerts.push(m), confirm: () => true, prompt: () => null,
    io: () => (ctx._sock = connectClient())
  };
  ctx.window = ctx; ctx._store = store;
  vm.createContext(ctx);
  vm.runInContext(SRC.theme, ctx, { filename: "theme.js" });
  vm.runInContext(SRC.app, ctx, { filename: "app.js" });
  const $ = id => doc.getElementById(id);
  const shown = id => $(id).style.display !== "none" && $(id).style.display !== "";
  return { name, doc, ctx, $, shown, click: id => $(id).dispatch("click"), html: () => doc.body.innerHTML };
}
const SNAP = process.env.SP_SNAP || null;
function snap(W, name) {
  if (!SNAP) return;
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1] + "\n" + fs.readFileSync(PUB("kawaii.css"), "utf8");
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, name + ".html"),
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + "</style></head>" + W.doc.body.outerHTML + "</html>");
}
let CODE = null;
const room = () => api.rooms.get(CODE);
const pidOf = W => { const s = JSON.parse(W.ctx._store.spResume || "{}"); const p = room().players.find(x => x.token === s.token); return p && p.id; };

(async () => {
  console.log("\n═══ واجهة «البسكويتة الحارّة» (app.js الحقيقيّ على spicysrv.js الحقيقيّ) ═══\n");

  console.log("① الدخول واللوبي");
  const A = openPage("سعود");
  await until(() => A.$("pName"));
  ok(A.doc.body.classList.contains("kw-spicy") && A.doc.body.classList.contains("kw-salfa"), "السمة: kw-salfa + kw-spicy", A.doc.body.className);
  A.$("pName").value = "سعود"; A.click("createBtn");
  ok(await until(() => A.shown("lobby") && /^\d{5}$/.test(A.$("roomCode").textContent)), "أنشأ غرفةً ودخل الانتظار");
  CODE = A.$("roomCode").textContent;
  const B = openPage("نورة", "?r=" + CODE);
  await until(() => B.$("pName"));
  B.$("pName").value = "نورة"; B.click("joinBtn");
  ok(await until(() => B.shown("lobby")), "نورة دخلت بالدعوة");
  A.click("setOpen");
  ok(await until(() => A.$("sSeats")), "إعداداتُ المضيف");
  A.$("sSeats").querySelector('[data-v="3"]').dispatch("click");
  ok(await until(() => room().settings.seats === 3 && A.doc.querySelectorAll(".spLp.botSlot").length === 1), "طاولةُ ثلاثة: مقعدُ بوتٍ يظهر في القائمة");
  ok(!A.$("startBtn").disabled, "والبدءُ متاح (البوتُ يكمل)");
  snap(A, "1-lobby");

  console.log("② الوضعُ الإجباريّ بالنقر");
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "بدأت عند الاثنين");
  ok(await until(() => /على الطاولة/.test(A.$("hTotal").textContent) && !/[٠-٩]{3}/.test(A.$("hTotal").textContent)), "«على الطاولة» عددُ الماكارونات (لا المهلة)", A.$("hTotal").textContent);
  const m = room().match;
  const a = pidOf(A), b = pidOf(B);
  m.starter = b;                                    /* لتبدأ نورةُ الدور (نسيطر على الموقف) */
  ok(await until(() => A.doc.querySelectorAll("#spTable .spMat").length === 2), "مساحتان للخصمين عند سعود");
  ok(await until(() => A.doc.querySelectorAll("#spHandMine .mac.pick").length === 4), "يدي: أربعُ ماكاروناتٍ تنتظر النقر");
  const trapEl = A.doc.querySelectorAll("#spHandMine .mac").find(el => m.p(a).discs[el.getAttribute("data-disc")] === "trap");
  ok(!!trapEl, "وأرى أيّها الحارّة");
  trapEl.dispatch("click");
  ok(await until(() => m.p(a).stack.length === 1), "نقرتُ الحارّة ⇒ وُضعت مقلوبة");
  ok(await until(() => A.doc.querySelector("#spMine .spStack .mac") && A.doc.querySelector("#spMine .peek")), "وأراها في كومتي بعينٍ مغمضة 🙈");
  await until(() => B.doc.querySelector('#spTable [data-id="' + a + '"] .spStack .mac'));
  const aStackInB = B.doc.querySelector('#spTable [data-id="' + a + '"] .spStack .mac');
  ok(aStackInB && !aStackInB.querySelector(".fc.front").innerHTML && !aStackInB.classList.contains("up"), "وعند نورة: ظهرُها فقط — لا وجهَ في الصفحة أصلًا");
  const bSafe = B.doc.querySelectorAll("#spHandMine .mac").find(el => m.p(b).discs[el.getAttribute("data-disc")] === "safe");
  bSafe.dispatch("click");
  ok(await until(() => m.phase === "action"), "وضع الجميع (والبوتُ وحده) ⇒ الدور");
  ok(m.turn === b, "(دورُ نورة)");
  snap(B, "2-action");

  console.log("③ التحدّي والقفلُ الذكيّ والحارّة");
  ok(await until(() => B.$("bidGo")), "نورة ترى زرَّ التحدّي والعدّاد");
  for (let k = 0; k < 5; k++) { const plus = B.doc.querySelector('.spStep [data-d="1"]'); if (plus && !plus.disabled) plus.dispatch("click"); }
  ok(/٣/.test(B.$("bidN").textContent) && B.doc.querySelector('.spStep [data-d="1"]').disabled, "العدّادُ لا يتجاوز ما على الطاولة (٣)", B.$("bidN").textContent);
  B.click("bidGo");
  ok(await until(() => m.phase === "reveal" && m.bid.id === b), "تحدٍّ بمجموع الطاولة ⇒ الكشفُ فورًا");
  ok(await until(() => B.$("spMine").classList.contains("can") && !B.doc.querySelector("#spTable .spMat.can")), "🔒 كومتُها وحدها تتوهّج أوّلًا");
  B.doc.querySelector('#spTable [data-id="' + a + '"]').dispatch("click");
  await sleep(20);
  ok(m.revealed.length === 0, "ونقرُ كومة غيرها لا يفعل شيئًا");
  B.doc.querySelector("#spMine .spStack").dispatch("click");
  ok(await until(() => m.revealed.length === 1), "قلبت كومتَها");
  ok(await until(() => B.doc.querySelectorAll("#spTable .spMat.can").length === 2), "ثمّ تتوهّج كومُ الآخرين");
  let shook = false;
  const watch = setInterval(() => { if (B.doc.body.classList.contains("shake") && A.doc.body.classList.contains("shake")) shook = true; }, 1);
  B.doc.querySelector('#spTable [data-id="' + a + '"]').dispatch("click");
  ok(await until(() => m.phase === "result" && !m.result.ok), "قلبت حارّةَ سعود ⇒ فشل");
  ok(await until(() => shook, 2000), "واهتزّت الشاشةُ عند الجميع 🌶️");
  clearInterval(watch);
  const flippedInA = A.doc.querySelector("#spMine .spStack .mac");
  ok(await until(() => B.doc.querySelector('#spTable [data-id="' + a + '"] .spStack .mac.up') &&
                       /E8302A/.test(B.doc.querySelector('#spTable [data-id="' + a + '"] .spStack .mac.up').innerHTML)), "وانقلبت الحارّةُ أمام عين نورة (up) بوجه الفلفل");
  ok(await until(() => /حارّة/.test(B.$("spCenter").textContent) && /خسرتَ/.test(B.$("spCenter").textContent)), "نورة ترى ما خسرته (لا يعرفه غيرُها)");
  ok(!/خسرتَ/.test(A.$("spCenter").textContent) && /خسر ماكارونةً/.test(A.$("spCenter").textContent), "وسعود يرى أنّها خسرت — بلا نوع");
  ok(await until(() => B.doc.querySelector("#spMine .spTag") && /خسرتَ/.test(B.$("spMine").textContent)), "وشارةُ «خسرتَ» في مساحتها");
  snap(B, "3-fail");

  console.log("④ جولةٌ جديدة ثمّ النهاية");
  ok(await until(() => m.round === 2 && m.phase === "placement", 8000), "بعد النتيجة: جولةٌ جديدة");
  ok(await until(() => A.doc.querySelectorAll("#spHandMine .mac.pick").length === 4 && B.doc.querySelectorAll("#spHandMine .mac.pick").length === 3), "الماكاروناتُ عادت (ونورة بثلاث)");
  m.p(a).stars = 1;
  m.end(a, "stars");
  api._tick(CODE);
  ok(await until(() => A.$("endModal").classList.contains("on") && B.$("endModal").classList.contains("on")), "نافذةُ النهاية عند الاثنين");
  ok(/فزت/.test(A.$("endBanner").textContent) && /الفائز/.test(B.$("endBanner").textContent), "«فزت» للفائز و«الفائز: …» للبقيّة");
  ok(A.$("endRank").querySelectorAll(".rk").length === 3 && /🥇/.test(A.$("endRank").textContent), "والترتيبُ بالثلاثة");
  snap(A, "4-end");
  A.doc.querySelector("#endModal [data-close]").dispatch("click");
  ok(await until(() => A.shown("lobby")), "إلى الانتظار");

  console.log("⑤ ترك الجلسة");
  A.click("leaveBtn");
  ok(await until(() => A.ctx.location.href === "/"), "🚪 من اللوبي: إلى القائمة الرئيسيّة فورًا");
  ok(!A.ctx._store.spResume, "ولا عودةَ تلقائيّة");

  console.log("⑥ الأخطاء");
  ok(errors.length === 0, "لا استثناءَ في أيّ مسار", errors.map(e => String(e && e.stack || e).slice(0, 300)));
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
