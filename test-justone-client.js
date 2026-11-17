// اختبار واجهة «كلمة واحدة فقط» من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/justone/app.js **الحقيقيّ** (مع norm.js وtheme.js) داخل DOM
// مصغّرٍ يُبنى من public/justone/index.html نفسه (الـDOM منقولٌ من اختبار
// واجهة لودو)، ونصله بخادم justonesrv.js **الحقيقيّ** عبر socket.io مُحاكى
// تمرّ رسائلُه بـJSON كالشبكة. ثمّ نلعب **بالنقر والكتابة وحدهما**: بطاقاتُ
// الأرقام، وخاناتُ التلميح، وأزرارُ الشطب والجاهزيّة، وخانةُ التخمين.
//
// ما يصطاده: أيُّ استثناءٍ في أيّ مسارٍ من الواجهة، ثمّ حقائقُ لا تراها إلا
// الواجهة: صفحةُ المخمّن لا تحمل الكلمة في أيّ عنصرٍ قبل الكشف، والملمّحُ
// يرى البطاقة، وتنبيهُ «ستُحذف» قبل الإرسال، والمسافةُ لا تُكتب، والكتابةُ
// الحيّة تظهر عند البقيّة، والعودةُ بعد انقطاع، ونافذةُ التصنيف في النهاية.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupJustOneOnline } = require("./justonesrv");

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
/* البطاقةُ الأولى معروفة (لنفحص ما يُعرض)، ثمّ بنكُ الكلمات الحقيقيّ */
const JB = require("./justonebank");
const realDeal = JB.deal;
const FIXED = [["تفاحة", "قمر", "سيارة", "مدرسة", "قلم"]];
JB.deal = (rng, used) => (FIXED.length ? FIXED.shift() : realDeal(rng, used));

const stats = [];
const api = setupJustOneOnline({ of: () => nsp }, {
  store: { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } }, graceMs: 400, secsScale: 1
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
const HTML = fs.readFileSync(PUB("justone/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { norm: fs.readFileSync(PUB("justone/norm.js"), "utf8"), app: fs.readFileSync(PUB("justone/app.js"), "utf8"),
              theme: fs.readFileSync(PUB("theme.js"), "utf8") };

function openPage(name, search = "", store = {}) {
  const doc = makeDocument(BODY[2], bodyAttrs);
  const ctx = {
    document: doc, console, URLSearchParams, Promise, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Date, Error, TypeError, isNaN, parseFloat, parseInt, Symbol, RegExp,
    setTimeout: (f, ms, ...a) => setTimeout(f, Math.min(+ms || 0, 3), ...a), clearTimeout,
    setInterval: (f, ms, ...a) => setInterval(f, Math.max(5, Math.min(+ms || 0, 15)), ...a), clearInterval,
    requestAnimationFrame: f => setTimeout(() => f(Date.now()), 2),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search, origin: "http://jo.test", href: "http://jo.test/justone/" + search },
    history: { replaceState(a, b, u) { ctx.location.search = String(u).replace(/^[^?]*/, ""); } },
    navigator: {}, alerts: [],
    alert: m => ctx.alerts.push(m), confirm: () => true, prompt: () => null,
    io: () => (ctx._sock = connectClient())
  };
  ctx.window = ctx; ctx._store = store;
  vm.createContext(ctx);
  vm.runInContext(SRC.theme, ctx, { filename: "theme.js" });
  vm.runInContext(SRC.norm, ctx, { filename: "norm.js" });
  vm.runInContext(SRC.app, ctx, { filename: "app.js" });
  const $ = id => doc.getElementById(id);
  const shown = id => $(id).style.display !== "none" && $(id).style.display !== "";
  return { name, doc, ctx, $, shown, click: id => $(id).dispatch("click"), html: () => doc.body.innerHTML };
}

/* لقطاتٌ للعين (اختياريّة): JO_SNAP=مجلد ⇒ تُكتب كلُّ لقطةٍ صفحةً مستقلّةً بأنماطها */
const SNAP = process.env.JO_SNAP || null;
function snap(W, name) {
  if (!SNAP) return;
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1] + "\n" + fs.readFileSync(PUB("kawaii.css"), "utf8");
  const body = W.doc.body.outerHTML;
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, name + ".html"),
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + "</style></head>" + body + "</html>");
}
const typeIn = (W, id, text) => { const el = W.$(id); el.value = text; el.dispatch("input"); };
const texts = (W, sel) => W.doc.querySelectorAll(sel).map(e => e.textContent);

let CODE = null;
const room = () => api.rooms.get(CODE);
const pidOf = W => { const s = JSON.parse(W.ctx._store.joResume || "{}"); const p = room().players.find(x => x.token === s.token); return p && p.id; };
const roleOf = W => (room().match && room().match.isGuesser(pidOf(W)) ? "G" : "C");

(async () => {
  console.log("\n═══ واجهة كلمة واحدة فقط (app.js الحقيقيّ على justonesrv.js الحقيقيّ) ═══\n");

  console.log("① الدخول واللوبي");
  const A = openPage("سعود");
  await until(() => A.$("pName"));
  ok(A.doc.body.classList.contains("kw-justone") && A.doc.body.classList.contains("kw-salfa"), "السمة: kw-salfa + kw-justone", A.doc.body.className);
  ok(A.shown("joinScreen") && !A.shown("game"), "تبدأ بشاشة الدخول");
  A.$("pName").value = "سعود"; A.click("createBtn");
  ok(await until(() => A.shown("lobby") && /^\d{5}$/.test(A.$("roomCode").textContent)), "أنشأ غرفةً ودخل الانتظار", A.$("roomCode").textContent);
  CODE = A.$("roomCode").textContent;
  ok(A.$("hostArea").style.display === "flex" && A.$("startBtn").disabled, "المضيفُ يرى زرّ البدء معطّلًا (أقلّ من ثلاثة)");
  ok(/٣/.test(A.$("needMore").textContent), "وتنبيه «تحتاجون ٣»", A.$("needMore").textContent);
  const B = openPage("فهد", "?r=" + CODE);
  await until(() => B.$("pName"));
  ok(B.$("createBtn").style.display === "none" && /ادخل الغرفة/.test(B.$("joinBtn").textContent), "رابطُ الدعوة يُخفي «إنشاء» ويعرض «ادخل الغرفة»");
  B.$("pName").value = "فهد"; B.click("joinBtn");
  const C = openPage("نورة", "?r=" + CODE);
  await until(() => C.$("pName"));
  C.$("pName").value = "نورة"; C.click("joinBtn");
  ok(await until(() => A.doc.querySelectorAll("#plist .lp").length === 3 && C.shown("lobby")), "ثلاثةٌ في الانتظار");
  snap(A, "0-lobby"); snap(openPage("زائر"), "0-join");
  ok(!A.$("startBtn").disabled && A.$("needMore").textContent === "", "والزرُّ فُعِّل");
  ok(B.$("waitHost").style.display === "block" && B.$("hostArea").style.display === "none", "غيرُ المضيف ينتظر");
  A.click("setOpen");
  ok(A.$("setBox").classList.contains("open") && A.doc.querySelectorAll("#sClue button").length === 4, "الإعدادات: أربعةُ أوقاتٍ للتلميح");
  A.doc.querySelector('#sClue [data-v="90"]').dispatch("click");
  ok(await until(() => /٩٠/.test(B.$("lobbySummary").textContent)), "اختار المضيف ٩٠ث فوصلت الجميع", B.$("lobbySummary").textContent);
  ok(A.doc.querySelector('#sClue [data-v="90"]').classList.contains("on"), "والخيارُ مُعلَّم");

  console.log("② البداية: شاشتان مختلفتان");
  A.click("startBtn");
  const pages = [A, B, C];
  ok(await until(() => pages.every(W => W.shown("play") && W.doc.querySelectorAll("#team .mate").length === 3)), "الكلّ في اللعب، والفريقُ ثلاثة");
  const G = pages.find(W => roleOf(W) === "G");
  let givers = pages.filter(W => W !== G);
  ok(!!G, "عرفنا المخمّن");
  ok(await until(() => G.doc.querySelectorAll("#picks .pcard").length === 5), "المخمّنُ يرى خمسَ بطاقاتٍ مقلوبة");
  ok(!/تفاحة|سيارة|مدرسة/.test(G.html()), "وصفحتُه لا تحمل أيَّ كلمةٍ من البطاقة");
  ok(givers.every(W => texts(W, ".wrow").join("|").includes("تفاحة") && W.doc.querySelectorAll(".wrow").length === 5), "والملمّحون يرون الكلمات الخمس مرقّمة");
  ok(/اختر رقمًا/.test(G.$("phaseInfo").textContent) && /يختار رقمًا/.test(givers[0].$("phaseInfo").textContent), "سطرُ المرحلة بحسب الدور");
  snap(G, "1-guesser-pick"); snap(givers[0], "1-giver-pick");
  ok(G.doc.querySelector("#team .mate.guesser") && /٢٠|١٩/.test(G.$("tsec").textContent), "شارةُ المخمّن، والمؤقّتُ عشرون ثانية", G.$("tsec").textContent);

  console.log("③ الاختيار بالنقر");
  G.doc.querySelector('#picks [data-n="1"]').dispatch("click");
  ok(await until(() => givers.every(W => W.doc.querySelector("#joStage .secret") && W.doc.querySelector("#joStage .secret .w").textContent === "تفاحة")),
     "الملمّحون يرون الكلمة السرّيّة");
  ok(await until(() => G.doc.querySelector("#joStage .wait")) && !/تفاحة/.test(G.html()), "والمخمّنُ «أغمض عينيك» بلا الكلمة");
  ok(givers.every(W => W.$("clue0") && W.$("clue1")), "ثلاثةُ لاعبين ⇒ خانتا تلميح");

  console.log("④ كتابةُ التلميح: كلمةٌ واحدة، وتنبيهٌ قبل الإرسال");
  const g1 = givers[0], g2 = givers[1];
  const ev = g1.$("clue0").dispatch("keydown", { key: " ", preventDefault() { this.dp = true; } });
  ok(ev.dp === true, "المسافةُ تُعترض (لا تُكتب)");
  ok(/بلا مسافات/.test(g1.$("toast").textContent), "ويُنبَّه صاحبها", g1.$("toast").textContent);
  typeIn(g1, "clue0", "ال تفاحه");
  ok(g1.$("clue0").value === "التفاحه", "ما يُلصَق تُنزع مسافاتُه", g1.$("clue0").value);
  ok(/ستُحذف/.test(g1.$("cw0").textContent) && g1.$("clue0").classList.contains("bad"), "تنبيه: الكلمةُ نفسها ستُحذف");
  typeIn(g1, "clue1", "Apple");
  ok(/لاتينيّة/.test(g1.$("cw1").textContent) && g1.$("clue1").classList.contains("warn"), "وتنبيهُ الترجمة");
  snap(g1, "2-giver-clue-warn");
  g1.click("sendClue");
  await sleep(30);
  ok(room().match.submitted.size === 0 && /نفسها/.test(g1.$("toast").textContent), "الإرسالُ يُمنع والتلميحُ محكومٌ بالحذف", g1.$("toast").textContent);
  typeIn(g1, "clue0", "أحمر"); typeIn(g1, "clue1", "شجرة");
  ok(g1.$("cw0").textContent === "" && g1.$("cw1").textContent === "", "تلميحان سليمان بلا تنبيه");
  g1.click("sendClue");
  ok(await until(() => g1.$("sentNote").classList.contains("on")), "وصل التلميح ⇒ «تقدر تعدّله»");
  ok(await until(() => G.doc.querySelectorAll("#team .mate.done").length === 1 && G.doc.querySelectorAll("#wDots i.on").length === 1),
     "المخمّنُ يرى أنّ واحدًا سلّم (بلا ما كتب)");
  ok(!/أحمر|شجرة/.test(G.html()), "ولا يصله ما كتب");
  typeIn(g2, "clue0", "احمر"); typeIn(g2, "clue1", "حلوة");
  g2.click("sendClue");

  console.log("⑤ المراجعة بالتصويت");
  ok(await until(() => givers.every(W => W.doc.querySelectorAll("#rvAlive .clue").length === 2)), "سلّم الجميع ⇒ المراجعة: نجا اثنان");
  ok(givers.every(W => W.doc.querySelectorAll("#rvOut .clue").length === 2 && texts(W, "#rvOut .why").every(t => /مكرّر/.test(t))),
     "والمتطابقان (أحمر/احمر) مشطوبان بسببهما", texts(g1, "#rvOut .why"));
  ok(!!G.doc.querySelector("#joStage .wait") && !/حلوة|شجرة|أحمر/.test(G.html()), "والمخمّنُ ينتظر بلا تلميحات");
  snap(G, "3-guesser-wait-review");
  const sweet = g1.doc.querySelectorAll("#rvAlive .clue").find(d => /حلوة/.test(d.textContent));
  sweet.querySelector(".strike").dispatch("click");
  ok(await until(() => g2.doc.querySelectorAll("#rvAlive .clue").some(d => /حلوة/.test(d.textContent) && /١\/٢/.test(d.textContent))),
     "الشطبُ يظهر للآخر بعدده (١/٢)");
  await sleep(30); snap(g2, "4-giver-review");
  g1.click("readyBtn"); g2.click("readyBtn");

  console.log("⑥ التخمين: بطاقاتٌ مبعثرة وكتابةٌ حيّة");
  ok(await until(() => G.doc.querySelectorAll("#gClues .clue").length === 2), "المخمّنُ يرى بطاقتين");
  ok(texts(G, "#gClues .t").sort().join() === ["حلوة", "شجرة"].sort().join(), "هما الناجيتان", texts(G, "#gClues .t"));
  ok(!/أحمر|احمر|تفاحة/.test(G.html()), "ولا أثرَ للمحذوف ولا للكلمة في صفحته");
  const tilts = G.doc.querySelectorAll("#gClues .clue").map(d => d.style["--r"]);
  ok(tilts.every(Boolean) && new Set(tilts).size === tilts.length, "كلُّ بطاقةٍ بزاويتها", tilts);
  ok(givers.every(W => W.doc.querySelectorAll("#gOut .clue").length === 2), "والملمّحون يرون المحذوفَ تحت");
  typeIn(G, "guessIn", "تفا");
  ok(await until(() => givers.every(W => /تفا/.test(W.$("live").textContent))), "ما يكتبه المخمّنُ يظهر عندهم حيًّا");
  /* الدردشة: الملمّحُ لا يكتب الكلمة */
  g1.$("chatInput").value = "الجواب تفاحه"; g1.$("chatForm").dispatch("submit");
  ok(await until(() => /السرّيّة/.test(g1.$("toast").textContent)), "الملمّحُ لا يكتب الكلمة في الدردشة", g1.$("toast").textContent);
  await sleep(720);
  g1.$("chatInput").value = "يلا 💪"; g1.$("chatForm").dispatch("submit");
  ok(await until(() => /يلا 💪/.test(G.$("msgs").textContent)), "والكلامُ العاديّ يصل");
  ok(G.doc.querySelectorAll("#team .bub.on").some(b => /يلا/.test(b.textContent)), "ويظهر فقاعةً عند صاحبه");
  ok(!/الجواب/.test(G.$("msgs").textContent), "والمرفوضُ لم يصل");
  snap(G, "5-guesser-guess"); snap(g2, "5-giver-live");
  typeIn(G, "guessIn", "التفاحه");
  G.click("guessBtn");

  console.log("⑦ الكشف");
  ok(await until(() => pages.every(W => W.doc.querySelector(".resBanner.correct"))), "إصابة! عند الجميع");
  ok(/تفاحة/.test(G.doc.querySelector("#joStage .secret .w").textContent), "والمخمّنُ يرى الكلمةَ الآن");
  ok(G.doc.querySelectorAll("#rvAll .clue").length === 4, "وكلَّ التلميحات");
  snap(G, "6-reveal");
  ok(G.$("scoreN").textContent === "١", "النقاط: ١", G.$("scoreN").textContent);
  api._expire(CODE);
  ok(await until(() => room().match.round === 2 && pages.every(W => /الجولة ٢/.test(W.$("phaseInfo").textContent))), "الجولةُ الثانية");
  const G2 = pages.find(W => roleOf(W) === "G");
  ok(G2 !== G, "بمخمّنٍ جديد");

  console.log("⑧ «ما أعرف الكلمة» والعودةُ بعد انقطاع");
  G2.doc.querySelector('#picks [data-n="3"]').dispatch("click");
  givers = pages.filter(W => W !== G2);
  ok(await until(() => givers.every(W => W.$("unknownBtn"))), "الملمّحون في التلميح");
  givers[0].click("unknownBtn");
  ok(/متأكد/.test(givers[0].$("unknownBtn").textContent) && room().match.phase === "clues", "النقرةُ الأولى تسأل «متأكد؟»");
  givers[0].click("unknownBtn");
  ok(await until(() => G2.doc.querySelector('#picks [data-n="3"]') && G2.doc.querySelector('#picks [data-n="3"]').classList.contains("x")),
     "الثانية تعيد الاختيار والرقمُ ٣ معطّل عند المخمّن");
  G2.doc.querySelector('#picks [data-n="4"]').dispatch("click");
  ok(await until(() => givers.every(W => W.$("clue0"))), "اختار ٤");
  /* ملمّحٌ يكتب ثمّ «ينقطع» ويعود: الصفحةُ الجديدة بالتخزين نفسه تعود إلى مكانها */
  const leaver = givers[1];
  typeIn(leaver, "clue0", "مدرّس"); typeIn(leaver, "clue1", "حصة");
  const sec = room().match.secret;
  if (window_related(sec, "مدرّس") || window_related(sec, "حصة")) { typeIn(leaver, "clue0", "زرافة"); typeIn(leaver, "clue1", "قرنفل"); }
  leaver.click("sendClue");
  await until(() => leaver.$("sentNote").classList.contains("on"));
  leaver.ctx._sock.disconnect();
  await sleep(20);
  const back = openPage(leaver.name + "2", "?r=" + CODE, leaver.ctx._store);
  pages[pages.indexOf(leaver)] = back;
  ok(await until(() => back.shown("play") && back.$("clue0")), "أعاد فتح الصفحة فعاد إلى اللعب");
  ok(back.$("clue0").value !== "" && back.$("sentNote").classList.contains("on"), "وتلميحُه في خانته «وصل»", back.$("clue0").value);
  ok(/رجعت/.test(back.$("toast").textContent), "و«رجعت للغرفة»");

  console.log("⑨ بقيّةُ المباراة بالنقر حتى التصنيف");
  const WORDS = ["سماء", "جبل", "نهر", "وردة", "غيمة", "رمل", "ثلج", "فراشة", "قلعة", "مصباح", "زيتون", "صحراء", "مركب", "حديقة", "كهف", "نخلة"];
  let n = 0, wrongDone = false, reveals = 0;
  const pilot = setInterval(() => {
    try {
      const r = room();
      if (!r || !r.match) return;
      const m = r.match;
      if (m.phase === "reveal") { reveals++; api._expire(CODE); return; }
      for (const W of pages) {
        const $ = W.$;
        const pk = W.doc.querySelectorAll("#picks .pcard").filter(b => !b.disabled);
        if (pk.length && roleOf(W) === "G" && m.phase === "pick") { pk[0].dispatch("click"); continue; }
        if ($("clue0") && m.phase === "clues" && !$("sentNote").classList.contains("on")) {
          const secret = $("joStage").querySelector(".secret .w").textContent;
          const pickW = () => { let w; do { w = WORDS[n++ % WORDS.length]; } while (window_related(secret, w)); return w; };
          typeIn(W, "clue0", pickW());
          if ($("clue1")) typeIn(W, "clue1", pickW());
          W.click("sendClue");
          continue;
        }
        if ($("readyBtn") && m.phase === "review" && !$("readyBtn").disabled) { W.click("readyBtn"); continue; }
        if ($("guessIn") && m.phase === "guess" && !$("guessBtn").disabled) {
          if (!wrongDone && m.round >= 4) { wrongDone = true; typeIn(W, "guessIn", "غلطمقصود"); W.click("guessBtn"); }
          else if (m.round === 6) { W.click("skipBtn"); W.click("skipBtn"); }
          else { typeIn(W, "guessIn", m.secret); W.click("guessBtn"); }
        }
      }
    } catch (e) { errors.push(e); }
  }, 6);
  ok(await until(() => pages.every(W => W.$("endModal").classList.contains("on")), 60000), "انتهت المباراة ⇒ نافذةُ التصنيف عند الجميع");
  clearInterval(pilot);
  snap(pages[0], "7-end");
  const last = pages[0].$("endRating");
  ok(/من ١٣/.test(last.textContent) && last.querySelector(".ar").textContent.length > 0, "التصنيفُ ونتيجةُ الفريق من ١٣", last.textContent);
  const hist = pages[0].doc.querySelectorAll("#endHist .hrow");
  ok(hist.length >= 10 && hist.length <= 13, "سجلُّ الجولات", hist.length);
  ok(hist.some(h => /❌/.test(h.textContent)) && hist.some(h => /⏭️/.test(h.textContent)) && hist.some(h => /✅/.test(h.textContent)), "فيه الإصابةُ والخطأُ والتخطّي");
  /* الصفحةُ التي أُعيد فتحها قد تكون صفحةَ المضيف: نعرفه من الخادم */
  const H = pages.find(W => pidOf(W) === room().hostId), O = pages.find(W => W !== H);
  ok(H && H.$("endAgain").style.display !== "none" && O.$("endAgain").style.display === "none", "«لعبة جديدة» للمضيف وحده");
  O.doc.querySelector("#endModal [data-close]").dispatch("click");
  ok(await until(() => O.shown("lobby")), "إغلاقُ النافذة ⇒ الانتظار");
  ok(/آخر لعبة/.test(O.$("lobbySummary").textContent), "وفيه نتيجةُ آخر لعبة", O.$("lobbySummary").textContent);
  H.click("endAgain");
  ok(await until(() => H.shown("play") && room().match && room().match.round === 1), "المضيفُ يبدأ لعبةً جديدة من النافذة");
  ok(await until(() => O.shown("play")), "ومن عاد للانتظار يدخلها");

  console.log("⑩ لا أخطاء");
  ok(errors.length === 0, "لا استثناءَ في أيّ صفحة", errors.slice(0, 3).map(e => String(e && e.stack || e).slice(0, 400)));
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function window_related(secret, w) { return require("./public/justone/norm").related(w, secret); }
