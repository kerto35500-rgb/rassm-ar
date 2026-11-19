// اختبار واجهة «رسالة حب» من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/love/app.js **الحقيقيّ** (مع theme.js) داخل DOM مصغّرٍ يُبنى من
// public/love/index.html نفسه، ونصله بخادم lovesrv.js **الحقيقيّ** عبر socket.io
// مُحاكى تمرّ رسائلُه بـJSON كالشبكة. ثمّ نلعب **بالنقر وحده**: بطاقةُ اليد، ثمّ
// نافذةُ الاستهداف (الخصم ثمّ التخمين ثمّ التأكيد)، والكاهنُ يكشف سرًّا،
// والكونتيسةُ الإجباريّة، ونهايةُ الجولة بكشف الأيدي، ونافذةُ النهاية.
//
// ما يصطاده: أيُّ استثناءٍ في الواجهة، وأنّ صفحةَ الخصم لا تحمل بطاقتي،
// وأنّ ما رآه الكاهنُ لا يظهر عند غيره، وأنّ عدّادَ البطاقات يتبع ما لُعب.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupLoveOnline } = require("./lovesrv");

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
const api = setupLoveOnline({ of: () => nsp }, {
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
const HTML = fs.readFileSync(PUB("love/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { app: fs.readFileSync(PUB("love/app.js"), "utf8"), theme: fs.readFileSync(PUB("theme.js"), "utf8") };

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
    location: { search, origin: "http://ll.test", href: "http://ll.test/love/" + search, reload() {} },
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
const SNAP = process.env.LL_SNAP || null;
function snap(W, name) {
  if (!SNAP) return;
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1] + "\n" + fs.readFileSync(PUB("kawaii.css"), "utf8");
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, name + ".html"),
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + "</style></head>" + W.doc.body.outerHTML + "</html>");
}
let CODE = null;
const room = () => api.rooms.get(CODE);
const pidOf = W => { const s = JSON.parse(W.ctx._store.llResume || "{}"); const p = room().players.find(x => x.token === s.token); return p && p.id; };
const cardsIn = (W, sel) => W.doc.querySelectorAll(sel + " .llCard").map(el => +el.getAttribute("data-v")).filter(Boolean);

(async () => {
  console.log("\n═══ واجهة «رسالة حب» (app.js الحقيقيّ على lovesrv.js الحقيقيّ) ═══\n");

  console.log("① الدخول واللوبي");
  const A = openPage("سعود");
  await until(() => A.$("pName"));
  ok(A.doc.body.classList.contains("kw-love") && A.doc.body.classList.contains("kw-salfa"), "السمة: kw-salfa + kw-love", A.doc.body.className);
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
  ok(await until(() => room().settings.seats === 3 && A.doc.querySelectorAll(".llLp.botSlot").length === 1), "طاولةُ ثلاثة: مقعدُ بوتٍ يظهر");
  ok(/٥ نجوم للفوز/.test(A.$("lobbySummary").textContent), "والملخّص: ٥ نجوم للفوز", A.$("lobbySummary").textContent);
  snap(A, "1-lobby");

  console.log("② الطاولة");
  A.click("startBtn");
  ok(await until(() => A.shown("play") && B.shown("play")), "بدأت عند الاثنين");
  const m = room().match;
  const a = pidOf(A), b = pidOf(B);
  const bot = m.players.find(x => x.id !== a && x.id !== b).id;
  ok(await until(() => A.doc.querySelectorAll("#llTable .llMat").length === 2), "مساحتان للخصمين");
  ok(await until(() => A.doc.querySelectorAll("#llCount .llCnt").length === 8), "عدّادُ البطاقات: ثمانيةُ أنواع");
  ok(/٥/.test(A.$("hTarget").textContent), "⭐ للفوز ٥", A.$("hTarget").textContent);
  /* نمسك الموقف: دورُ سعود بيده حارسٌ وكاهن */
  const force = (hand, others) => {
    for (const x of m.players) { x.out = false; x.protected = false; }
    m.phase = "turn"; m.turn = a; m.p(a).hand = hand.slice();
    m.p(b).hand = [others[0]]; m.p(bot).hand = [others[1]];
    if (m.deck.length < 3) m.deck.push(1, 1, 1);
    api._tick(CODE);
  };
  force([1, 2], [5, 3]);
  ok(await until(() => A.doc.querySelector('#llHand .llCard.pick[data-v="1"]') && A.doc.querySelector('#llHand .llCard.pick[data-v="2"]')), "يدي: حارسٌ وكاهنٌ ينتظران النقر");
  ok(await until(() => A.$("llMine").classList.contains("turn") && /دورك/.test(A.$("llCenter").textContent)), "ودوري ظاهر");
  ok(await until(() => B.doc.querySelector('#llTable [data-id="' + a + '"] .llBacks')), "(مساحتي عند نورة)");
  const backsInB = B.doc.querySelector('#llTable [data-id="' + a + '"] .llBacks');
  ok(backsInB.querySelectorAll(".llCard").length === 2 && backsInB.querySelectorAll(".llCard.back").length === 2, "وعند نورة: ظهرا بطاقتيّ فقط", backsInB.innerHTML.slice(0, 120));
  ok(!B.doc.querySelector("#llHand .llCard.pick"), "ونورة لا تلعب في دوري");
  snap(A, "2-myturn");

  console.log("③ الحارس: الخصم ← التخمين ← التأكيد");
  A.doc.querySelector('#llHand .llCard[data-v="1"]').dispatch("click");
  ok(await until(() => A.$("playModal").classList.contains("on")), "نافذةُ اللعب انفتحت");
  ok(A.doc.querySelectorAll("#pmBody .llTgt").length === 2 && A.$("pmGo").disabled, "خصمان للاختيار — والتأكيدُ مقفلٌ قبله");
  ok(A.doc.querySelectorAll("#pmBody .llGuess button").length === 7, "سبعُ بطاقاتٍ للتخمين (لا حارس)");
  A.doc.querySelector('#pmBody .llTgt[data-t="' + b + '"]').dispatch("click");
  ok(await until(() => A.doc.querySelector('#pmBody .llTgt.on[data-t="' + b + '"]')) && A.$("pmGo").disabled, "اخترتُ نورة — وما زال التأكيدُ مقفلًا (بلا تخمين)");
  ok(m.log.length === 0, "ولم يُرسل شيءٌ بعد");
  A.doc.querySelector('#pmBody .llGuess button[data-g="5"]').dispatch("click");
  ok(await until(() => !A.$("pmGo").disabled), "خمّنتُ الأمير ⇒ التأكيدُ متاح");
  snap(A, "3-target");
  A.click("pmGo");
  ok(await until(() => m.log.length >= 1 && m.log[0].hit === true && m.p(b).out), "أصاب الحارس ⇒ خرجت نورة", m.log[0]);
  ok(await until(() => !A.$("playModal").classList.contains("on")), "وانغلقت النافذة");
  ok(await until(() => A.doc.querySelector('#llTable [data-id="' + b + '"]').classList.contains("out")), "مساحتُها باهتةٌ عندي");
  ok(await until(() => /أصاب/.test(A.$("llLog").textContent) && /أصاب/.test(B.$("llLog").textContent)), "السجلّ عند الجميع: «أصاب»");
  ok(await until(() => A.doc.querySelector("#llCount .llCnt.c1 .llPips i.gone") && A.doc.querySelector("#llCount .llCnt.c5 .llPips i.gone")), "العدّاد: حارسٌ لُعب وأميرٌ كُشف بخروجها");
  ok(await until(() => /خرجتَ/.test(B.$("llMine").textContent)), "ونورة تعرف أنّها خرجت");

  console.log("④ الكاهن: سرٌّ لصاحبه");
  await until(() => m.turn === a || m.phase !== "turn", 3000);
  force([2, 4], [5, 7]);
  m.p(b).out = true; m.p(b).hand = [];
  api._tick(CODE);
  ok(await until(() => A.doc.querySelector('#llHand .llCard.pick[data-v="2"]')), "(كاهنٌ في يدي)");
  A.doc.querySelector('#llHand .llCard[data-v="2"]').dispatch("click");
  ok(await until(() => A.$("playModal").classList.contains("on") && !A.$("pmGo").disabled), "هدفٌ واحدٌ جائز ⇒ اختير وحده");
  A.click("pmGo");
  ok(await until(() => A.$("infoModal").classList.contains("on") && A.doc.querySelector('#imBody .llCard[data-v="7"]')), "رأيتُ بطاقةَ البوت: الكونتيسة");
  ok(!B.$("infoModal").classList.contains("on"), "ونورة لا ترى شيئًا");
  ok(await until(() => A.doc.querySelector('#llTable [data-id="' + bot + '"] .llKnown')), "وتبقى في مساحته عندي 🔮");
  ok(!B.doc.querySelector(".llKnown"), "ولا تظهر عند نورة");
  snap(A, "4-peek");
  A.doc.querySelector("#infoModal [data-close]").dispatch("click");

  console.log("⑤ الكونتيسةُ الإجباريّة");
  await until(() => m.turn === a || m.phase !== "turn", 3000);
  force([7, 6], [5, 3]);
  m.p(b).out = true; m.p(b).hand = [];
  api._tick(CODE);
  ok(await until(() => A.doc.querySelector('#llHand .llCard.pick[data-v="7"]') && A.doc.querySelector('#llHand .llCard.lock[data-v="6"]')), "الملكُ مقفل، والكونتيسةُ وحدها تُلعب");
  ok(/لا بدّ أن ترميها/.test(A.$("llMine").textContent), "ويقول السببَ");
  A.doc.querySelector('#llHand .llCard[data-v="6"]').dispatch("click");
  ok(await until(() => /الكونتيسة/.test(A.$("toast").textContent)) && !A.$("playModal").classList.contains("on"), "نقرُ الملك: تنبيهٌ بلا نافذة");
  A.doc.querySelector('#llHand .llCard[data-v="7"]').dispatch("click");
  ok(await until(() => A.$("playModal").classList.contains("on") && !A.$("pmGo").disabled), "الكونتيسة: بلا هدف — التأكيدُ مباشرة");
  const n7 = m.log.length;
  A.click("pmGo");
  ok(await until(() => m.log.length > n7 && m.log[n7].card === 7 && m.p(a).hand.includes(6)), "رُميت واحتفظتُ بالملك");

  console.log("⑥ نهايةُ الجولة: الكومةُ تفرغ");
  await until(() => m.turn === a || m.phase !== "turn", 3000);
  force([4, 8], [5, 3]);
  m.p(b).out = true; m.p(b).hand = [];
  m.deck = [];
  api._tick(CODE);
  ok(await until(() => A.doc.querySelector('#llHand .llCard.pick[data-v="4"]')), "(خادمةٌ وأميرة، والكومةُ فارغة)");
  A.doc.querySelector('#llHand .llCard[data-v="8"]').dispatch("click");
  ok(await until(() => /الأميرة يُخرجك/.test(A.$("pmBody").textContent)), "رميُ الأميرة: تحذيرٌ قبل التأكيد");
  A.doc.querySelector("#playModal [data-close]").dispatch("click");
  ok(await until(() => !A.$("playModal").classList.contains("on")) && m.p(a).hand.includes(8), "ألغيتُ — ولم يحدث شيء");
  A.doc.querySelector('#llHand .llCard[data-v="4"]').dispatch("click");
  await until(() => A.$("playModal").classList.contains("on"));
  A.click("pmGo");
  ok(await until(() => m.phase === "result" && m.result.winners.includes(a)), "نفدت الكومة ⇒ الأميرةُ أعلى ⇒ نجمةٌ لي", m.result);
  ok(await until(() => /نفدت الكومة/.test(A.$("llCenter").textContent) && A.doc.querySelector("#llCenter .llRes.mine")), "النتيجة في الوسط (خضراءُ لي)");
  ok(await until(() => B.doc.querySelector('#llTable [data-id="' + a + '"] .llBacks .llCard[data-v="8"]')), "والأيدي تُكشف للجميع بعد الجولة");
  ok(/المحروقة/.test(A.$("llCenter").textContent), "والمحروقةُ تُكشف");
  snap(A, "6-result");
  ok(await until(() => m.round === 2 && m.phase === "turn", 12000), "ثمّ جولةٌ جديدة");
  ok(await until(() => /الجولة ٢/.test(A.$("llLog").textContent)), "والسجلّ يبدأ من جديد");

  console.log("⑦ النهاية");
  m.p(a).stars = m.target;
  m.end(a);
  api._tick(CODE);
  ok(await until(() => A.$("endModal").classList.contains("on") && B.$("endModal").classList.contains("on"), 6000), "نافذةُ النهاية عند الاثنين");
  ok(/فزت/.test(A.$("endBanner").textContent) && /الفائز/.test(B.$("endBanner").textContent), "«فزت» للفائز و«الفائز: …» للبقيّة");
  ok(A.$("endRank").querySelectorAll(".rk").length === 3 && /🥇/.test(A.$("endRank").textContent), "والترتيبُ بالثلاثة");
  snap(A, "7-end");
  A.doc.querySelector("#endModal [data-close]").dispatch("click");
  ok(await until(() => A.shown("lobby")), "إلى الانتظار");

  console.log("⑧ ترك الجلسة والقواعد");
  A.click("rulesBtn");
  ok(A.$("rulesModal").classList.contains("on") && A.doc.querySelectorAll("#rulesBody .llRule").length === 8, "القواعد: البطاقاتُ الثمان");
  A.doc.querySelector("#rulesModal [data-close]").dispatch("click");
  A.click("leaveBtn");
  ok(await until(() => A.ctx.location.href === "/"), "🚪 من اللوبي: إلى القائمة الرئيسيّة فورًا");

  console.log("⑨ الأخطاء");
  ok(errors.length === 0, "لا استثناءَ في أيّ مسار", errors.map(e => String(e && e.stack || e).slice(0, 300)));
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
