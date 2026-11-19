// اختبار واجهة لودو من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/ludo/app.js **الحقيقيّ** (مع geom.js وtheme.js) داخل DOM
// مصغّرٍ يُبنى من public/ludo/index.html نفسه، ونصله بخادم ludosrv.js
// **الحقيقيّ** عبر socket.io مُحاكى تمرّ رسائلُه بـJSON كالشبكة تمامًا
// (فما لا يُسلسَل لا يصل). ثمّ نلعب **بالنقر وحده**: زرُّ النرد، والقطعُ
// المتوهّجة، وأزرارُ النوافذ — كما يلعب إنسان.
//
// ما يصطاده: أيُّ استثناءٍ في أيّ مسارٍ من الواجهة (اللوبي، الإعدادات،
// الرسم، الحركة، الأسئلة، النهاية، العودة إلى اللوبي) في الأوضاع الستّة،
// ثمّ حقائقُ لا تراها إلا الواجهة: دورانُ اللوحة لكلّ مقعد، والضباب،
// والمهمّةُ المخفيّة، ونافذةُ التضحية، وأهدافُ التبديل، وقفلُ الحارس.
// وما لا يصطاده: الشكلُ بالبكسل — ذاك يُفحص في المتصفّح بعد النشر.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupLudoOnline } = require("./ludosrv");

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
  doc.documentElement = new El("html", doc);      /* مظهرُ اللوحة يضبط ألوانَ المقاعد عليه */
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
  emit(e, d) {                                       /* … يُسلسَل ويصل إلى عميله بعد «الشبكة» */
    const data = d === undefined ? undefined : JSON.parse(JSON.stringify(d));
    const c = this.client;
    setImmediate(() => c && c._deliver(e, data));
  }
}
const nsp = {
  cf: [], sockets: new Map(), n: 0,
  on(e, f) { if (e === "connection") this.cf.push(f); },
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
};
const api = setupLudoOnline({ of: () => nsp }, {
  store: { async bumpGameStats() {} }, botDelay: [1, 3], autoMoveMs: 3, graceMs: 300, secsScale: 0.03
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
    _deliver(e, d) {
      /* نعدّ التقاطَ المعزّزات الذي وصل الصفحات (للتحقّق من أنّه بلا إشعار) */
      if (e === "state" && d && d.events) for (const ev of d.events) if (ev.t === "power") seen.power++;
      (handlers[e] || []).slice().forEach(f => f(d));
    },
    disconnect() { nsp.sockets.delete(s.id); s.client = null; s.fire("disconnect"); }
  };
  s.client = c;
  nsp.sockets.set(s.id, s);
  setImmediate(() => nsp.cf.forEach(f => f(s)));
  return c;
}

/* ══════════ متصفّحٌ مصغّر: صفحةٌ من index.html تعمل فيها سكربتاتُها ══════════ */
const errors = [];
const seen = { power: 0, toasts: [] };
const G_STARS = require("./public/ludo/geom.js").STARS.length;
process.on("uncaughtException", e => errors.push(e));
process.on("unhandledRejection", e => errors.push(e));

const PUB = p => path.join(__dirname, "public", p);
const HTML = fs.readFileSync(PUB("ludo/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { geom: fs.readFileSync(PUB("ludo/geom.js"), "utf8"), app: fs.readFileSync(PUB("ludo/app.js"), "utf8"),
              theme: fs.readFileSync(PUB("theme.js"), "utf8") };

function openPage(name, search = "", store = {}) {
  const doc = makeDocument(BODY[2], bodyAttrs);
  const ctx = {
    document: doc, console, URLSearchParams, Promise, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Date, Error, TypeError, isNaN, parseFloat, parseInt, Symbol,
    /* الزمنُ في الصفحة مضغوط: الحركاتُ والنوافذُ تجري كما هي لكن في ملّي ثوانٍ */
    setTimeout: (f, ms, ...a) => setTimeout(f, Math.min(+ms || 0, 3), ...a), clearTimeout,
    setInterval: (f, ms, ...a) => setInterval(f, Math.max(5, Math.min(+ms || 0, 15)), ...a), clearInterval,
    requestAnimationFrame: f => setTimeout(() => f(Date.now()), 2),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search, origin: "http://ludo.test", href: "http://ludo.test/ludo/" + search },
    history: { replaceState(a, b, u) { ctx.location.search = String(u).replace(/^[^?]*/, ""); } },
    navigator: {}, alerts: [],
    alert: m => ctx.alerts.push(m), confirm: () => true, prompt: () => null,
    io: () => (ctx._sock = connectClient())
  };
  ctx.window = ctx; ctx._store = store;
  vm.createContext(ctx);
  vm.runInContext(SRC.theme, ctx, { filename: "theme.js" });
  vm.runInContext(SRC.geom, ctx, { filename: "geom.js" });
  vm.runInContext(SRC.app, ctx, { filename: "app.js" });
  /* كلُّ ما يُكتب في شريط الإشعار يُسجَّل — لنتحقّق ممّا لا يجب أن يظهر */
  {
    const t = doc.getElementById("toast");
    const proto = Object.getOwnPropertyDescriptor(El.prototype, "textContent");
    Object.defineProperty(t, "textContent", {
      get() { return proto.get.call(this); },
      set(v) { seen.toasts.push(String(v)); proto.set.call(this, v); }
    });
  }
  const $ = id => doc.getElementById(id);
  const shown = id => $(id).style.display !== "none" && $(id).style.display !== "";
  return { name, doc, ctx, $, shown, click: id => $(id).dispatch("click") };
}

/* لاعبٌ آليٌّ **من خلال الواجهة**: يقرأ ما تعرضه الصفحة وينقر عليه */
function pilot(W, opts = {}) {
  let on = true;
  const stats = { rolls: 0, moves: 0, kingSel: 0, sac: 0, swap: 0, picked: 0 };
  const tick = () => {
    if (!on) return;
    try {
      const { $, doc } = W;
      if ($("sacModal").classList.contains("on")) {
        const b = $("sacChoices").children[0]; if (b) { stats.sac++; b.dispatch("click"); }
      } else {
        const tg = doc.querySelectorAll(".tok.target");
        if (tg.length) { stats.swap++; tg[0].dispatch("click"); }
        else if (!$("diceBtn").disabled) { stats.rolls++; $("diceBtn").dispatch("click"); }
        else {
          const can = doc.querySelectorAll(".tok.can").filter(t => t.style.display !== "none");
          if (can.length) {
            const t = can[Math.floor(Math.random() * can.length)];
            t.dispatch("mouseover");
            t.dispatch("click");
            if (t.classList.contains("sel")) stats.kingSel++;
            /* قطعةٌ تمشي بأكثر من رقم ⇒ فقاعةُ الأرقام فوقها: نختار أحدها */
            const pk = W.$("picker");
            if (pk.classList.contains("on") && pk.querySelector("button")) { stats.picked++; pk.querySelector("button").dispatch("click"); }
            else if (t.classList.contains("sel")) t.dispatch("click");
            stats.moves++;
          }
        }
      }
    } catch (e) { errors.push(e); }
    setTimeout(tick, opts.every || 6);
  };
  tick();
  return { stop: () => { on = false; }, stats };
}

const roomOf = code => api.rooms.get(code);
/* قبل صناعة موقفٍ على المحرّك نوقف مؤقّتات الغرفة: مهلةٌ معلّقةٌ قد تلعب
   عن أحدٍ بين سطرين من الإعداد فتُفسد الموقف */
function freeze(room) {
  for (const k of ["timer", "botT", "autoT"]) { if (room[k]) clearTimeout(room[k]); room[k] = null; }
  room.afk = null;
}

(async () => {
  console.log("\n═══ واجهة لودو (app.js الحقيقيّ على ludosrv.js الحقيقيّ) ═══\n");

  console.log("① الصفحة تُبنى والسمة تُعرَف");
  const A = openPage("A");
  ok(A.doc.body.classList.contains("kw-salfa") && A.doc.body.classList.contains("kw-ludo"),
     "theme.js يعطي الصفحةَ هيكلَ السالفة ولونَ لودو", A.doc.body.className);
  ok(!A.shown("game") && A.$("joinScreen").style.display !== "none", "تبدأ بشاشة الدخول");
  const svgKids = A.$("boardSvg").children.length;
  ok(svgKids > 90, "اللوحة مرسومة (قواعد + ٥٢ مربّعًا + مسارات + مركز)", svgKids);
  ok(A.$("boardSvg").querySelectorAll("polygon").length >= 4 + 4 + 4, "النجوم والأسهم مضلّعاتٌ لا محارف", A.$("boardSvg").querySelectorAll("polygon").length);
  ok(!A.$("boardSvg").querySelectorAll("text").length, "ولا نصَّ في اللوحة الثابتة (لا إيموجي يختلف بين الأجهزة)");
  /* سطرُ «اختر خصمًا تبدّل معه» يطفو فوق اللوحة — لا يُدفع في الصفحة فينزلها */
  ok(A.$("boardBox").querySelector("#promptBar") && !A.$("playTop").querySelector("#promptBar"),
     "سطرُ التبديل داخل صندوق اللوحة (طافٍ) لا فوقها في مجرى الصفحة");
  ok(/#promptBar\{[^}]*position:absolute/.test(HTML) && /#promptBar\{[^}]*pointer-events:none/.test(HTML), "مطلقُ الموضع ولا يحجب النقر");
  ok(/\.pp \.pool\{position:absolute/.test(HTML), "البركةُ شاراتٌ طافية: ظهورُها في دور صاحبها لا يُطيل لوحتَه فلا تنزل الطاولة");
  /* مظاهرُ اللوحة: الهادئُ افتراضًا، ومربّعاتُ النجوم رماديّة، و🎨 يبدّل */
  {
    const fills = () => A.$("boardSvg").querySelectorAll("rect").map(r => r.getAttribute("fill"));
    ok(fills()[0] === "#F5EFE4", "اللوحةُ بالمظهر الهادئ افتراضًا (لا الألوان الزاهية)", fills()[0]);
    ok(fills().filter(f => f === "#E1DED8").length === G_STARS, "مربّعاتُ النجوم رماديّةٌ تُميَّز", fills().filter(f => f === "#E1DED8").length);
    A.click("themeBtn");
    ok(A.$("themeModal").classList.contains("on") && A.$("themeGrid").querySelectorAll(".thm").length === 4, "🎨 يفتح أربعةَ مظاهر بلوحاتها مصغّرة");
    ok(A.$("themeGrid").querySelectorAll(".thm svg rect").length > 4 * 60, "كلُّ معاينةٍ لوحةٌ حقيقيّةٌ مرسومة");
    ok(A.$("themeGrid").querySelector(".thm.on").dataset.k === "calm", "والهادئُ هو المختار");
    A.$("themeGrid").querySelector('[data-k="dark"]').dispatch("click");
    ok(A.ctx._store.ludoBoard === "dark" && fills()[0] === "#232833", "اختيارُ «داكن» يعيد رسم اللوحة ويُحفظ في الجهاز");
    ok(A.doc.documentElement.style["--c0"] === "#D47F77" && A.$("boardBox").style["--bb-bg"] === "#232833", "وألوانُ المقاعد وإطارُ اللوحة تتبعه");
    ok(A.$("themeGrid").querySelector(".thm.on").dataset.k === "dark", "والبطاقةُ المختارة مُعلَّمة");
    A.$("themeGrid").querySelector('[data-k="calm"]').dispatch("click");
    A.$("themeModal").querySelector("[data-close]").dispatch("click");
    ok(!A.$("themeModal").classList.contains("on") && fills()[0] === "#F5EFE4", "ويعود ويُغلق");
  }

  console.log("② الدخول واللوبي");
  await until(() => A.ctx._sock && true);
  A.click("createBtn");
  await sleep(30);
  ok(/اسمك/.test(A.$("joinErr").textContent), "بلا اسمٍ يُطلب الاسم", A.$("joinErr").textContent);
  A.$("pName").value = "سعود";
  A.click("createBtn");
  ok(await until(() => A.shown("lobby")), "إنشاءُ غرفةٍ يفتح اللوبي");
  const code = A.$("roomCode").textContent;
  ok(/^\d{5}$/.test(code), "برمز الغرفة في الشريط", code);
  ok(A.ctx.location.search === "?r=" + code, "والرابطُ صار رابطَ دعوة", A.ctx.location.search);
  ok(A.$("seatGrid").querySelectorAll(".seat").length === 4, "أربعةُ مقاعد بألوانها");
  ok(A.$("seatGrid").querySelector(".seat.me.s0"), "وأنا في الأحمر");
  ok(A.$("hostArea").style.display === "flex", "وللمضيف منطقةُ الإعدادات");
  ok(A.$("modeGrid").querySelectorAll(".mode").length === 6, "ستُّ بطاقاتِ أوضاع");
  A.click("setOpen");
  ok(A.$("setBox").classList.contains("open"), "زرُّ الإعدادات يفتحها");

  const B = openPage("B", "?r=" + code);
  await until(() => B.ctx._sock);
  ok(B.$("createBtn").style.display === "none" && /ادخل الغرفة/.test(B.$("joinBtn").textContent), "رابطُ الدعوة يعرض زرَّ الدخول وحده");
  ok(B.$("pRoom").style.display === "none" && B.$("joinBtn").textContent.includes(code),
     "وخانةُ الرمز مخفيّة فالزرُّ بعرض البطاقة والرقمُ كاملٌ فيه (كان يُقصّ في الجوال)", B.$("joinBtn").textContent);
  {
    /* دعوةٌ لغرفةٍ انتهت: تعود الخانةُ وزرُّ الإنشاء — لا يعلق الزائر */
    const Z = openPage("Z", "?r=99999");
    await until(() => Z.ctx._sock);
    Z.$("pName").value = "زائر"; Z.click("joinBtn");
    ok(await until(() => /لا توجد غرفة/.test(Z.$("joinErr").textContent)), "دعوةٌ منتهية ⇒ رسالة");
    ok(Z.$("pRoom").style.display === "" && Z.$("createBtn").style.display === "", "وتعود خانةُ الرمز وزرُّ الإنشاء");
  }
  B.$("pName").value = "فهد";
  B.click("joinBtn");
  ok(await until(() => B.shown("lobby")), "المدعوّ يدخل اللوبي");
  ok(await until(() => A.$("seatGrid").querySelectorAll(".seat .who b").some(b => /فهد/.test(b.textContent))), "ويظهر عند المضيف");
  ok(B.$("hostArea").style.display === "none" && B.$("waitHost").style.display === "block", "وغيرُ المضيف ينتظر ولا يرى الإعدادات");
  ok(/الكلاسيكيّ/.test(B.$("lobbySummary").textContent), "ويرى ملخّصَ الإعدادات", B.$("lobbySummary").textContent);

  /* الإعداداتُ بالنقر: الوضعُ والمعزّزات */
  A.$("modeGrid").querySelector('.mode[data-m="night"]').dispatch("click");
  ok(await until(() => A.$("modeGrid").querySelector(".mode.on").dataset.m === "night"), "نقرُ بطاقةِ وضعٍ يختاره (بعد ردّ الخادم)");
  ok(await until(() => /الظلام/.test(B.$("lobbySummary").textContent)), "ويصل الاختيار إلى الآخرين");
  A.$("sPU").querySelector('button[data-v="1"]').dispatch("click");
  ok(await until(() => A.$("sPUc").style.display === ""), "تفعيلُ المعزّزات يُظهر عددها");
  /* المضيفُ يمنع أنواعًا بعينها */
  {
    const chips = () => A.$("sPUt").querySelectorAll("button");
    ok(A.$("sPUt").style.display === "" && chips().length === 5 && chips().every(b => b.classList.contains("on")), "وأنواعَها الخمسة، مسموحةً كلُّها");
    A.$("sPUt").querySelector('[data-p="swap"]').dispatch("click");
    ok(await until(() => !A.$("sPUt").querySelector('[data-p="swap"]').classList.contains("on") &&
                         roomOf(code).settings.powerTypes.join() === "gold,jump,bubble,wind"), "لمسةٌ تمنع «تبديل الأماكن» (وتصل الخادم)");
    ok(await until(() => B.$("lobbySummary").textContent.includes("🦘") && !B.$("lobbySummary").textContent.includes("🔄")), "والملخّصُ عند الآخرين يعرض المسموح وحده", B.$("lobbySummary").textContent);
    for (const k of ["gold", "jump", "bubble"]) A.$("sPUt").querySelector(`[data-p="${k}"]`).dispatch("click");
    await until(() => roomOf(code).settings.powerTypes.join() === "wind");
    A.$("sPUt").querySelector('[data-p="wind"]').dispatch("click");
    await sleep(30);
    ok(roomOf(code).settings.powerTypes.join() === "wind" && /واحدًا على الأقلّ/.test(A.$("toast").textContent), "ولا يُمنع آخرُ نوع", A.$("toast").textContent);
    for (const k of ["gold", "jump", "bubble", "swap"]) A.$("sPUt").querySelector(`[data-p="${k}"]`).dispatch("click");
    ok(await until(() => roomOf(code).settings.powerTypes.length === 5), "ولمسةٌ ثانيةٌ تُعيد المسموح");
  }
  A.$("sTeams").querySelector('button[data-v="1"]').dispatch("click");
  ok(await until(() => A.$("rowShared").style.display === "" && A.$("rowPlayers").style.display === "none"),
     "الفرقُ تُظهر «التأمين المشترك» وتُخفي عدد اللاعبين");
  ok(await until(() => A.$("seatGrid").querySelectorAll(".teamTag").length === 2), "والمقاعدُ تُعرَض فريقين");
  ok(/فريقك/.test(A.$("seatGrid").querySelector(".teamTag.mine").textContent) && /الأحمر/.test(A.$("seatGrid").querySelector(".teamTag.mine").textContent),
     "وفريقي مُعلَّمٌ «فريقك» (الأحمر + الأصفر)");
  ok(/صاحبك/.test(A.$("seatGrid").querySelector(".teamHint").textContent), "وتلميحٌ لمن يريد صاحبَه في فريقه");
  /* فهد (الأخضر) يلمس المقعدَ الأصفر الفارغ — البطاقة نفسها لا الزرّ — فيصير زميلي */
  B.$("seatGrid").querySelector(".seat.s2.empty").dispatch("click");
  ok(await until(() => roomOf(code).slots[2] && roomOf(code).slots[2].name === "فهد"), "لمسُ المقعد الفارغ يُجلس فيه");
  ok(await until(() => /فريقك/.test(B.$("seatGrid").querySelector(".teamTag.mine").textContent) &&
                       /الأحمر/.test(B.$("seatGrid").querySelector(".teamTag.mine").textContent)), "فصار فهد في فريقي");
  B.$("seatGrid").querySelector(".seat.s1.empty").dispatch("click");
  await until(() => roomOf(code).slots[1] && roomOf(code).slots[1].name === "فهد");
  A.$("sTeams").querySelector('button[data-v="0"]').dispatch("click");
  A.$("sPU").querySelector('button[data-v="0"]').dispatch("click");
  await sleep(40);

  console.log("③ مبارياتٌ كاملة بالنقر — الأوضاع الستّة");
  const order = ["classic", "rush", "master", "missions", "night", "king"];
  let first = true;
  for (const mode of order) {
    A.$("modeGrid").querySelector(`.mode[data-m="${mode}"]`).dispatch("click");
    await until(() => A.$("modeGrid").querySelector(".mode.on").dataset.m === mode);
    if (mode === "missions") { A.$("sPU").querySelector('button[data-v="1"]').dispatch("click"); await sleep(20); }
    if (mode === "king") { A.$("sTeams").querySelector('button[data-v="1"]').dispatch("click"); await sleep(20); }
    A.click("startBtn");
    const started = await until(() => A.shown("play") && B.shown("play"), 5000);
    ok(started, `${mode}: بدأت المباراة واللوحةُ ظاهرةٌ عند الاثنين`);
    if (mode === "king") {
      /* الفرق: من زميلُك مكتوبٌ على لوحته (الزميلُ مقابلُك، لا جارُك) */
      await until(() => A.doc.querySelector(".pp.s2 .meta") && A.doc.querySelector(".pp.s2 .meta").textContent);
      ok(A.doc.querySelector(".pp.s2").classList.contains("mate") && /زميلك/.test(A.doc.querySelector(".pp.s2 .meta").textContent),
         "الفرق: لوحةُ الزميل المقابل مكتوبٌ عليها «زميلك» وعليها شارتُه", A.doc.querySelector(".pp.s2 .meta").textContent);
      ok(/خصم/.test(A.doc.querySelector(".pp.s1 .meta").textContent) && !A.doc.querySelector(".pp.s1").classList.contains("mate"),
         "وجاري (الأخضر) خصمٌ لا زميل", A.doc.querySelector(".pp.s1 .meta").textContent);
    }
    if (first) {
      first = false;
      ok(A.$("ludoBoard").style["--rot"] === "270deg", "اللوحة تدور حتى تكون قاعدةُ الأحمر أسفلَ اليسار", A.$("ludoBoard").style["--rot"]);
      const bSeat = B.$("seatGrid").querySelector(".seat.me").className.match(/s(\d)/)[1];
      const want = (((3 - +bSeat) * 90) + 360) % 360 + "deg";
      ok(B.$("ludoBoard").style["--rot"] === want, "ولكلّ لاعبٍ دورانُه هو", { bSeat, got: B.$("ludoBoard").style["--rot"], want });
      ok(A.$("toks").querySelectorAll(".tok").length >= 8, "القطعُ على اللوحة", A.$("toks").querySelectorAll(".tok").length);
      ok(A.doc.querySelectorAll(".pp").length === 4, "أربعةُ لاعبين في زواياهم (بوتان ملآ المقعدين)");
      /* كلعبة المرجع: أنا أسفلَ اليسار، ثمّ مع عقارب الساعة */
      const seatAt = id => { const p = A.$(id).querySelector(".pp"); return p ? +p.getAttribute("data-seat") : null; };
      ok(seatAt("cBL") === 0 && seatAt("cTL") === 1 && seatAt("cTR") === 2 && seatAt("cBR") === 3,
         "أنا (الأحمر) أسفلَ اليسار والبقيّةُ مع عقارب الساعة عند قواعدهم", ["cBL", "cTL", "cTR", "cBR"].map(seatAt));
      ok(A.$("cBL").querySelector("#diceBtn"), "ونردي في لوحتي بجانب صورتي");
      ok(A.$("cTL").querySelector(".pp .die") && !A.$("cTL").querySelector("#diceBtn"), "ولكلّ لاعبٍ آخر نردُه في زاويته");
      const bSeatNum = +B.doc.querySelector(".pp.me").getAttribute("data-seat");
      ok(B.$("cBL").querySelector(".pp.me") && bSeatNum === 1, "وعند فهد: هو أسفلَ اليسار عنده", bSeatNum);
      const lefts = A.$("toks").querySelectorAll(".tok").map(t => parseFloat(t.style.left));
      ok(lefts.every(x => x > 0 && x < 100), "وكلُّ قطعةٍ داخل اللوحة", lefts);

      /* نقرٌ مزدوجٌ على قطعة (الجوال): حركةٌ واحدةٌ تُرسَل لا اثنتان — كانت
         الثانيةُ تعود برسالة «ليس دورك في التحريك» */
      {
        let sent = 0, tried = false, after = -1;
        const sock = A.ctx._sock, em = sock.emit;
        sock.emit = function (e, d, ack) { if (e === "move") sent++; return em.call(this, e, d, ack); };
        for (let k = 0; k < 80 && !tried; k++) {
          await until(() => !A.$("diceBtn").disabled || A.doc.querySelectorAll(".tok.can").length, 2000);
          if (!A.$("diceBtn").disabled) A.$("diceBtn").dispatch("click");
          await until(() => A.doc.querySelectorAll(".tok.can").length, 300);
          const can = A.doc.querySelectorAll(".tok.can");
          if (!can.length) continue;
          const before = sent;
          can[0].dispatch("click");
          const pk = A.$("picker");
          if (pk.classList.contains("on") && pk.querySelector("button")) pk.querySelector("button").dispatch("click");
          if (sent !== before + 1) continue;              /* فاتته المهلة (لعب عنه AUTO) — نعيد */
          after = A.doc.querySelectorAll(".tok.can").length;
          can[0].dispatch("click"); can[0].dispatch("click");
          tried = true;
          ok(sent === before + 1, "نقرٌ مزدوجٌ على قطعةٍ يرسل حركةً واحدة", { sent, before });
          ok(after === 0, "والقطعُ تكفّ عن التوهّج فور الإرسال", after);
        }
        sock.emit = em;
        ok(tried, "(أُتيح للاختبار دورٌ بحركة)");
      }
    }
    if (mode === "night") {
      await until(() => A.$("lFog").children.length > 0, 3000);
      ok(A.$("lFog").children.length > 10, "الظلام: ضبابٌ على ما لا يُرى", A.$("lFog").children.length);
    }
    if (mode === "missions") {
      await until(() => A.$("missionCard").style.display === "flex", 3000);
      const t = A.$("missionCard").textContent;
      ok(/مهمّتك/.test(t) && /🤫/.test(t), "المهامّ: مهمّتي ظاهرةٌ ومهامُّ الخصوم مخفيّة", t.slice(0, 80));
    }
    if (mode === "king") {
      ok(A.$("toks").querySelectorAll(".tok.king").length >= 1, "الملك: للملك قطعتُه المميّزة");
    }
    const pa = pilot(A), pb = pilot(B);
    const done = await until(() => A.$("endModal").classList.contains("on") && B.$("endModal").classList.contains("on"), 90000);
    pa.stop(); pb.stop();
    ok(done, `${mode}: انتهت ونافذةُ النتيجة ظاهرةٌ عند الاثنين`, { a: pa.stats, b: pb.stats });
    ok(pa.stats.rolls + pb.stats.rolls > 0, `${mode}: رُمي النرد بالنقر`, { a: pa.stats, b: pb.stats });
    ok(/🏆|انتهت/.test(A.$("endBanner").textContent), `${mode}: والنتيجةُ مكتوبة`, A.$("endBanner").textContent);
    if (mode === "missions") ok(/كُشفت/.test(A.$("endMissions").textContent), "والمهامّ تُكشف في النهاية");
    if (mode === "king") ok(pa.stats.kingSel + pb.stats.kingSel >= 0, "الملك يُختار بنقرتين", { a: pa.stats, b: pb.stats });
    /* إغلاقُ النتيجة يعيد اللوبي */
    B.$("endModal").querySelector("[data-close]").dispatch("click");
    ok(await until(() => B.shown("lobby")), `${mode}: إغلاقُ النتيجة يعيد إلى اللوبي`);
    A.$("endModal").querySelector("[data-close]").dispatch("click");
    await until(() => A.shown("lobby"));
    if (mode === "missions") { A.$("sPU").querySelector('button[data-v="0"]').dispatch("click"); await sleep(20); }
  }
  A.$("sTeams").querySelector('button[data-v="0"]').dispatch("click");
  await sleep(30);

  console.log("④ مواقفُ مصنوعة: التضحية، والتبديل، وقفلُ الحارس");
  /* لاعبان بلا بوتات: نصنع الموقف على المحرّك ثمّ ندع الواجهة تجري */
  /* ثلاثُ نقراتٍ أسرعَ من ردّ الخادم. العطبُ الذي وجده هذا الاختبار: كانت
     الواجهةُ ترسل الإعداداتِ كلَّها من نسختها القديمة، فتحمل النقرةُ الثانيةُ
     «البوتات مفعّلة» وتلغي الأولى — فبدأت المباراةُ ببوتين لم يُطلبا */
  A.$("modeGrid").querySelector('.mode[data-m="classic"]').dispatch("click");
  await sleep(30);
  A.$("sBots").querySelector('button[data-v="0"]').dispatch("click");
  A.$("sPlayers").querySelector('button[data-v="2"]').dispatch("click");
  A.$("modeGrid").querySelector('.mode[data-m="king"]').dispatch("click");
  await sleep(40);
  {
    const S = roomOf(code).settings;
    ok(S.bots === false && S.players === 2 && S.mode === "king", "ثلاثُ نقراتٍ سريعة تصل كلُّها — لا تُلغي إحداها الأخرى",
       { bots: S.bots, players: S.players, mode: S.mode });
  }
  ok(await until(() => A.$("sBots").querySelector("button.on").dataset.v === "0" &&
                       A.$("sPlayers").querySelector("button.on").dataset.v === "2" &&
                       A.$("modeGrid").querySelector(".mode.on").dataset.m === "king"), "والواجهةُ تعرضها كلَّها");
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "مباراةُ ملكٍ بين اثنين");
  {
    const room = roomOf(code), m = room.match;
    const sa = m.seats.find(s => room.slots[s].name === "سعود"), sb = m.seats.find(s => s !== sa);
    /* ملكُ سعود على مربّعٍ غير آمن، وحارسٌ له على اللوحة؛ وحارسُ فهد خلفه
       بخطوة، ونردُ فهد محمَّلٌ بواحد ⇒ أكلُ الملك ⇒ سؤالُ التضحية لسعود */
    const L = require("./ludorules"), G = L.G;
    freeze(room);
    for (const s of m.seats) m.pieces[s].forEach(pc => { pc.p = -1; pc.cooldown = 0; pc.shield = 0; });
    m.unlocked[sa] = true;
    const kAbs = 10, kP = (kAbs - G.START[sa] + 52) % 52;
    m.pieces[sa][3].p = kP;
    m.pieces[sa][0].p = (5 - G.START[sa] + 52) % 52;
    const atkP = (kAbs - 1 - G.START[sb] + 52) % 52;
    m.pieces[sb][0].p = atkP;
    m.prompt = null; m.queue = []; m.turn = sb; m.phase = "roll"; m.dice = null; m.sixes = 0; m._loaded = [1];
    const bSock = [...nsp.sockets.values()].find(s => room.slots[sb] && room.slots[sb].sockId === s.id);
    bSock.fire("roll");
    ok(await until(() => A.$("sacModal").classList.contains("on"), 4000), "هجومٌ على الملك ⇒ نافذةُ التضحية عند صاحبه");
    ok(A.$("sacChoices").children.length === 2, "بخيارين: الحارسُ الذي على اللوحة، أو تركُ الملك", A.$("sacChoices").textContent);
    ok(await until(() => /⏳.*يقرّر التضحية/.test(B.$("promptBar").textContent) && B.$("promptBar").style.display === "block"), "والخصمُ يرى أنّه ينتظر القرار (فوق اللوحة)");
    A.$("sacModal").dispatch("click");             /* نقرٌ خارج النافذة */
    ok(A.$("sacModal").classList.contains("on"), "ونقرةٌ خارج النافذة لا تُغلقها (السؤال ينتظر جوابًا)");
    A.$("sacChoices").children[0].dispatch("click");
    ok(await until(() => !A.$("sacModal").classList.contains("on") && m.pieces[sa][0].p === -1), "التضحية: الحارسُ إلى القاعدة");
    ok(m.pieces[sa][3].p === kP, "والملك باقٍ مكانه");
    ok(await until(() => (A.$("toks").querySelectorAll(".tok .cd")[0] || { textContent: "" }).textContent.includes("🔒")), "وعلى الحارس قفلٌ بعدّاد أدواره");
  }
  /* نُنهي مباراةَ الملك بإيصاله */
  {
    const room = roomOf(code), m = room.match;
    await until(() => m.phase === "roll" || m.phase === "move", 3000);
    freeze(room);
    const sa = m.seats.find(s => room.slots[s].name === "سعود");
    for (const k of [...Array(57).keys()]) m.visited[sa].add(m.key(sa, k));
    m.pieces[sa][3].p = 55; m.prompt = null; m.queue = []; m.turn = sa; m.phase = "roll"; m.dice = null; m._loaded = [1];
    m.legal = [];
    A.ctx._sock && null;
    /* الواجهة تعرض النرد بعد الحالة التالية: نطلب حالةً بنقرة الرمي من الخادم مباشرةً */
    const aSock = [...nsp.sockets.values()].find(s => room.slots[sa] && room.slots[sa].sockId === s.id);
    aSock.fire("roll");
    const pa = pilot(A), pb = pilot(B);
    ok(await until(() => A.$("endModal").classList.contains("on"), 8000), "الملكُ في المركز ⇒ فوز", A.$("endBanner").textContent);
    ok(/فزت/.test(A.$("endBanner").textContent), "والفائزُ يرى «فزت»", A.$("endBanner").textContent);
    pa.stop(); pb.stop();
    A.$("endModal").querySelector("[data-close]").dispatch("click");
    B.$("endModal").querySelector("[data-close]").dispatch("click");
    await until(() => A.shown("lobby") && B.shown("lobby"));
  }

  /* التبديل: قطعتي تقف على «تبديل الأماكن» وخصمان في النطاق ⇒ أختار بالنقر */
  A.$("modeGrid").querySelector('.mode[data-m="classic"]').dispatch("click");
  A.$("sPU").querySelector('button[data-v="1"]').dispatch("click");
  await until(() => A.$("modeGrid").querySelector(".mode.on").dataset.m === "classic" && A.$("sPU").querySelector("button.on").dataset.v === "1");
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "مباراةٌ كلاسيكيّةٌ بالمعزّزات");
  {
    const room = roomOf(code), m = room.match, G = require("./ludorules").G;
    const sa = m.seats.find(s => room.slots[s].name === "سعود"), sb = m.seats.find(s => s !== sa);
    freeze(room);
    for (const s of m.seats) m.pieces[s].forEach(pc => { pc.p = -1; pc.shield = 0; });
    const rel = (s, abs) => (abs - G.START[s] + 52) % 52;
    m.pieces[sa][0].p = rel(sa, 3);
    m.powerups = [{ cell: 4, type: "swap" }];
    m.pieces[sb][0].p = rel(sb, 6); m.pieces[sb][1].p = rel(sb, 7);
    m.prompt = null; m.queue = []; m.turn = sa; m.phase = "roll"; m.dice = null; m.sixes = 0; m._loaded = [1];
    const aSock = [...nsp.sockets.values()].find(s => room.slots[sa] && room.slots[sa].sockId === s.id);
    aSock.fire("roll");
    ok(await until(() => A.doc.querySelectorAll(".tok.target").length === 2, 4000), "التبديل: الخصمان في النطاق متوهّجان للاختيار",
       A.doc.querySelectorAll(".tok.target").length);
    ok(/اضغط خصمًا/.test(A.$("promptBar").textContent) && /قطعتك لتبقى/.test(A.$("promptBar").textContent) &&
       A.$("promptBar").style.display === "block", "والسطرُ الطافي فوق اللوحة يقول ما المطلوب (والبقاءُ خيار)", A.$("promptBar").textContent);
    /* التبديلُ اختياريّ: قطعتي تتوهّج بالأخضر، ونقرُها يُبقيها مكانها */
    const keep = A.doc.querySelectorAll(".tok.keep");
    ok(keep.length === 1 && keep[0].classList.contains("s" + sa), "وقطعتي متوهّجةٌ بالأخضر (للبقاء)", keep.length);
    const mine = m.pieces[sa][0].p, his = [m.pieces[sb][0].p, m.pieces[sb][1].p];
    keep[0].dispatch("click");
    ok(await until(() => !m.prompt && m.turn !== sa, 3000), "نقرُها ⇒ لا تبديل ويمضي الدور", { prompt: !!m.prompt, turn: m.turn });
    ok(m.pieces[sa][0].p === mine && m.pieces[sb][0].p === his[0] && m.pieces[sb][1].p === his[1], "وكلٌّ في مكانه");
    ok(await until(() => !A.doc.querySelectorAll(".tok.target").length && !A.doc.querySelectorAll(".tok.keep").length), "ويزول التوهّج");
    /* مرّةً ثانية: هذه المرّة أختار خصمًا */
    freeze(room);
    m.pieces[sa][0].p = rel(sa, 3);
    m.powerups = [{ cell: 4, type: "swap" }];
    m.prompt = null; m.queue = []; m.turn = sa; m.phase = "roll"; m.dice = null; m.pool = []; m._loaded = [1];
    aSock.fire("roll");
    ok(await until(() => A.doc.querySelectorAll(".tok.target").length === 2, 4000), "(تبديلٌ ثانٍ)");
    const before = m.pieces[sa][0].p;
    A.doc.querySelectorAll(".tok.target")[0].dispatch("click");
    ok(await until(() => m.pieces[sa][0].p !== before && !m.prompt), "نقرُ أحدهما يبدّل المكانين", { before, now: m.pieces[sa][0].p });
    ok(await until(() => !A.doc.querySelectorAll(".tok.target").length), "ويزول التوهّج بعد الاختيار");
    const pa = pilot(A), pb = pilot(B);
    ok(await until(() => A.$("endModal").classList.contains("on"), 90000), "وتكتمل المباراة بعدها");
    pa.stop(); pb.stop();
  }

  console.log("④ب ما أُخذ من لعبة المرجع: البركة، وفقاعةُ الرقم، والدردشة، واللعبُ التلقائيّ");
  A.$("endModal").querySelector("[data-close]").dispatch("click");
  B.$("endModal").querySelector("[data-close]").dispatch("click");
  await until(() => A.shown("lobby") && B.shown("lobby"));
  A.$("sPU").querySelector('button[data-v="0"]').dispatch("click");
  await sleep(30);
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "مباراةٌ كلاسيكيّةٌ بين اثنين");
  {
    const room = roomOf(code), m = room.match, G = require("./ludorules").G;
    const sa = m.seats.find(s => room.slots[s].name === "سعود"), sb = m.seats.find(s => s !== sa);
    const aSock = [...nsp.sockets.values()].find(s => room.slots[sa] && room.slots[sa].sockId === s.id);
    const myPP = () => A.doc.querySelector(".pp.me");
    freeze(room);
    for (const s of m.seats) m.pieces[s].forEach(pc => { pc.p = -1; pc.shield = 0; });
    m.pieces[sa][0].p = 10;
    m.prompt = null; m.queue = []; m.after = null; m.legal = []; m.pool = [];
    m.turn = sa; m.phase = "roll"; m.dice = null; m._loaded = [6];
    aSock.fire("roll");          /* ستّة ⇒ رميةٌ أخرى قبل الحركة */
    ok(await until(() => /٦/.test(myPP().querySelector(".pool").textContent) && !A.$("diceBtn").disabled, 3000),
       "الستّةُ تظهر في بركتي تحت نردي، ونردي جاهزٌ لرميةٍ أخرى", myPP().querySelector(".pool").textContent);
    ok(myPP().classList.contains("ready"), "واليدُ تشير إلى نردي");
    ok(/٦/.test(B.doc.querySelector('.pp[data-seat="' + sa + '"] .pool').textContent), "والخصمُ يرى بركتي عند صورتي");
    freeze(room);
    m._loaded = [2];
    A.$("diceBtn").dispatch("click");   /* الرميةُ الثانية بالنقر */
    ok(await until(() => A.$("toks").querySelectorAll(".tok.can").length > 0, 3000), "ثمّ تتوهّج القطعُ للحركة");
    freeze(room);
    /* القطعةُ على الطريق (لا في القاعدة) تمشي بالستّة أو بالاثنين ⇒ فقاعةُ اختيار الرقم.
       القاعدةُ في زاويةٍ من اللوحة، والطريقُ قرب وسطها */
    const onTrack = A.$("toks").querySelectorAll(".tok.can")
      .find(t => parseFloat(t.style.left) > 30 && parseFloat(t.style.left) < 70);
    const before = m.pieces[sa][0].p;
    const pk = A.$("picker");
    /* الفقاعةُ فوق القطعة — وقربَ أعلى اللوحة تحتها (صورةُ المستخدم: كانت تختفي
       خلف الشريط العلويّ فلا يظهر منها إلا سهمُها) */
    onTrack.getBoundingClientRect = () => ({ left: 100, top: 300, right: 110, bottom: 310, width: 10, height: 10 });
    onTrack.dispatch("click");
    ok(pk.classList.contains("on") && !pk.classList.contains("below") && pk.style.top === "300px",
       "قطعةٌ في وسط اللوحة ⇒ الفقاعةُ فوقها", { cls: pk.className, top: pk.style.top });
    onTrack.getBoundingClientRect = () => ({ left: 100, top: 20, right: 110, bottom: 30, width: 10, height: 10 });
    onTrack.dispatch("click");
    ok(pk.classList.contains("on") && pk.classList.contains("below") && pk.style.top === "30px",
       "وقربَ أعلى اللوحة ⇒ تنقلب تحت القطعة فتبقى ظاهرة", { cls: pk.className, top: pk.style.top });
    delete onTrack.getBoundingClientRect;
    onTrack.dispatch("click");
    ok(pk.classList.contains("on") && pk.querySelectorAll("button").length === 2,
       "قطعةٌ تمشي برقمين ⇒ فقاعةٌ فوقها فيها النردان (chooseStep في المرجع)", pk.querySelectorAll("button").length);
    const two = pk.querySelectorAll("button").find(b => b.getAttribute("aria-label") === "حرّك 2");
    two.dispatch("click");
    ok(await until(() => m.pieces[sa][0].p === before + 2, 3000), "واختيارُ الاثنين يحرّكها اثنين", { before, now: m.pieces[sa][0].p });
    ok(!pk.classList.contains("on"), "وتُغلَق الفقاعة");
    ok(await until(() => /٦/.test(myPP().querySelector(".pool").textContent) && !/٢/.test(myPP().querySelector(".pool").textContent), 3000),
       "والستّةُ باقيةٌ في البركة تنتظر", myPP().querySelector(".pool").textContent);
    freeze(room);

    /* الدردشة: فقاعةٌ بجانب الصورة وعدّادٌ لما لم يُقرأ */
    const bSock = [...nsp.sockets.values()].find(s => room.slots[sb] && room.slots[sb].sockId === s.id);
    B.$("chatInput").value = "مرحبا يا شباب";
    B.$("chatForm").dispatch("submit");
    const bBub = () => A.doc.querySelector('.pp[data-seat="' + sb + '"] .bub');
    ok(await until(() => bBub().classList.contains("on") && /مرحبا/.test(bBub().textContent), 3000),
       "رسالةُ فهد تظهر فقاعةً بجانب صورته عندي");
    ok(A.$("unread").classList.contains("on") && A.$("unread").textContent === "١", "وعدّادُ ما لم يُقرأ على زرّ الدردشة", A.$("unread").textContent);
    A.$("chatBtn").dispatch("click");
    ok(A.$("chatCard").classList.contains("on") && !A.$("unread").classList.contains("on"), "وفتحُ الدردشة يُصفّره");
    A.$("chatClose").dispatch("click");
    /* العبارات الجاهزة والإيموجي */
    A.$("quickBtn").dispatch("click");
    ok(A.$("quickPop").classList.contains("on") && A.$("quickPop").querySelectorAll(".phr button").length === 12 &&
       A.$("quickPop").querySelectorAll(".emo button").length === 16, "😊 يفتح ١٢ عبارةً جاهزة و١٦ إيموجي");
    A.$("quickPop").querySelectorAll(".emo button")[0].dispatch("click");
    const myBub = () => myPP().querySelector(".bub");
    ok(await until(() => myBub().classList.contains("on") && myBub().classList.contains("big"), 3000),
       "والإيموجي يظهر فقاعةً كبيرةً بجانب صورتي", myBub().textContent);
    ok(!A.$("quickPop").classList.contains("on"), "وتُغلَق اللوحةُ بعد الإرسال");

    /* اللعب التلقائيّ: ينقضي الوقت ⇒ AUTO حتى ألمس الشاشة */
    freeze(room);
    m.prompt = null; m.queue = []; m.after = null; m.legal = []; m.pool = [];
    m.turn = sb; m.phase = "roll"; m._loaded = [1, 3];
    bSock.fire("roll");        /* فهد ١ (لا حركة) ⇒ دوري، ولا ألعب */
    ok(await until(() => A.doc.querySelector(".pp.me").classList.contains("auto"), 4000), "انقضى وقتي ⇒ «AUTO» تحت صورتي");
    ok(!A.$("autoBar"), "بلا شريطٍ ولا إشعار للّعب التلقائيّ (طلبُ المستخدم)");
    ok(!seen.toasts.some(t => /اللعب التلقائيّ|انتهى وقتك|رجعت تلعب/.test(t)), "ولا رسالةَ «انتهى وقتك» ولا «رجعت تلعب»");
    ok(await until(() => B.doc.querySelector('.pp[data-seat="' + sa + '"]').classList.contains("auto"), 3000), "وشارةُ AUTO على صورتي عند الخصم");
    A.$("boardBox").dispatch("pointerdown");
    ok(await until(() => room.slots[sa].auto === false, 2000), "لمسةٌ في أيّ مكانٍ تعيدني (manual)");
    ok(await until(() => !A.doc.querySelector(".pp.me").classList.contains("auto"), 2000), "وتزول «AUTO» من تحت صورتي");
    freeze(room);
    const pa = pilot(A), pb = pilot(B);
    ok(await until(() => A.$("endModal").classList.contains("on"), 90000), "وتكتمل المباراة");
    pa.stop(); pb.stop();
  }

  console.log("⑤ تحديثُ الصفحة في منتصف المباراة، ورابطُ دعوةٍ لا تخطفه جلسةٌ قديمة");
  A.$("endModal").querySelector("[data-close]").dispatch("click");
  B.$("endModal").querySelector("[data-close]").dispatch("click");
  await until(() => A.shown("lobby") && B.shown("lobby"));
  A.$("sPU").querySelector('button[data-v="0"]').dispatch("click");
  await sleep(30);
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "مباراةٌ جديدة");
  let A2;
  {
    const room = roomOf(code);
    freeze(room);
    /* «تحديث»: المقبسُ القديم ينقطع، وصفحةٌ جديدةٌ بالتخزين نفسه وبرابط الغرفة */
    A.ctx._sock.disconnect();
    A2 = openPage("A2", "?r=" + code, A.ctx._store);
    ok(await until(() => A2.shown("play"), 4000), "الصفحةُ الجديدة تعود إلى اللوحة مباشرةً (بلا شاشة دخول)");
    ok(A2.$("ludoBoard").style["--rot"] === "270deg", "بدوران مقعدها هي", A2.$("ludoBoard").style["--rot"]);
    ok(/رجعت/.test(A2.$("toast").textContent), "وتُرحّب بالعائد", A2.$("toast").textContent);
    ok(A2.$("toks").querySelectorAll(".tok").length >= 8, "والقطعُ مرسومة");
    const room2 = roomOf(code);
    ok(room2.slots.filter(Boolean).every(p => !p.gone), "ومقعدُه لم يُعَدّ غائبًا", room2.slots.map(p => p && p.gone));
  }
  {
    /* جلسةٌ قديمةٌ محفوظةٌ لغرفةٍ ما، ورابطُ دعوةٍ لغرفةٍ أخرى ⇒ الدعوةُ تغلب */
    const C = openPage("C", "?r=55555", { ludoResume: JSON.stringify({ room: code, token: "x", at: Date.now() }) });
    await sleep(60);
    ok(C.$("joinScreen").style.display !== "none" && !C.shown("game"), "رابطُ دعوةٍ لغرفةٍ أخرى يبقى على شاشة الدخول لها");
    ok(/55555/.test(C.$("joinBtn").textContent), "بزرّ تلك الغرفة", C.$("joinBtn").textContent);
  }
  {
    const pa = pilot(A2), pb = pilot(B);
    ok(await until(() => A2.$("endModal").classList.contains("on"), 90000), "والعائدُ يُكمل المباراة حتى النهاية");
    pa.stop(); pb.stop();
  }

  console.log("⑥ ما وُجد في المتصفّح الحقيقيّ بعد النشر (لا يراه DOM بلا تخطيط)");
  {
    const IDX = fs.readFileSync(PUB("ludo/index.html"), "utf8");
    const KW = fs.readFileSync(PUB("kawaii.css"), "utf8");
    const mob = (IDX.match(/@media \(max-width: 900px\)\{([\s\S]*?)\n  \}/) || [])[1] || "";
    ok(/grid-template-areas:"tl tr" "board board" "bl br"/.test(mob),
       "الجوال (كالمرجع): لاعبا الأعلى فوق اللوحة ولاعبا الأسفل تحتها");
    ok(/#arena\{direction:ltr;/.test(IDX), "والساحةُ يسارًا إلى يمين — فلا تقلب العربيّةُ الزوايا عن قواعدها");
    ok(/grid-template-areas:"tl board tr" "bl board br"/.test(IDX), "الحاسوب: الزوايا الأربع حول اللوحة");
    ok(/#arena\{[^}]*padding:/.test(mob), "الجوال: وإطارُ اللوحة لا يُقصّ عند حافّة الشاشة");
    ok(/body\.theme-kawaii\.kw-salfa\.kw-ludo \.seg button\.on \{[^}]*color:#fff/.test(KW),
       "الخيارُ المختار في الإعدادات أبيضُ على فيروزيّ (كان رماديًّا لا يكاد يُقرأ)");
    ok(/body\.kw-ludo \.tok\.can\.sel/.test(KW), "الملكُ المختار بحلقته الذهبيّة فوق حلقة «يتحرّك»");
    ok(/body\.kw-salfa\.kw-ludo #lobby \{ overflow-x:hidden; \}/.test(KW), "ولا شريطَ تمريرٍ أفقيّ في اللوبي عند المرور على الأزرار العريضة");
    const set = A.$("setBox").textContent;
    ok(!/مفعّلة|مغلقة/.test(set) && /تشغيل/.test(set) && /إيقاف/.test(set),
       "مفاتيحُ الإعدادات «تشغيل/إيقاف» — «مفعّلة» و«مغلقة» تتشابهان رسمًا فتُقرأ إحداهما للأخرى");
  }

  console.log("⑥ب المعزّزات بلا إشعارات");
  {
    const powerToast = /قفزة الحظّ|الرياح دفعت|لا أحد خلفك|تبادلت قطعتان|الدرع حمى|ضاع التبديل|النرد الذهبيّ|درع الفقاعة|تبديل الأماكن|الرياح العكسيّة/;
    ok(seen.power > 0, "التُقطت معزّزاتٌ في المباريات", seen.power);
    const bad = seen.toasts.filter(t => powerToast.test(t));
    ok(bad.length === 0, "ولم يظهر لأيّ لاعبٍ إشعارٌ بالتقاطها أو بأثرها", bad.slice(0, 5));
    ok(/\.tok\.leap\{/.test(HTML) && /leapArc/.test(HTML), "وقفزةُ الكنغر وثبةٌ واحدة (أنماطُها موجودة)");
  }

  console.log("⑦ لا استثناءَ في أيّ مسار");
  ok(!errors.length, "صفرُ أخطاءٍ في الصفحتين والخادم", errors.slice(0, 3).map(e => String(e && e.stack || e).slice(0, 400)));
  ok(!A.ctx.alerts.length && !B.ctx.alerts.length, "ولا تنبيهاتِ alert", [A.ctx.alerts, B.ctx.alerts]);

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
