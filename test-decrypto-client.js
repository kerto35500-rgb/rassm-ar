// اختبار واجهة «فكّ الشفرة» من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/decrypto/app.js **الحقيقيّ** (مع norm.js وtheme.js) داخل DOM
// مصغّرٍ يُبنى من public/decrypto/index.html نفسه (الـDOM منقولٌ من اختبار
// واجهة «كلمة واحدة فقط»)، ونصله بخادم decryptosrv.js **الحقيقيّ** عبر
// socket.io مُحاكى تمرّ رسائلُه بـJSON كالشبكة. ثمّ نلعب **بالنقر والكتابة
// وحدهما**: الانتقالُ بين الفريقين، وخاناتُ التلميح، وأرقامُ الورقة المشتركة،
// و«موافق»، والتبويبتان، و«التالي»، والدردشتان.
//
// ما يصطاده: أيُّ استثناءٍ في أيّ مسارٍ من الواجهة، ثمّ حقائقُ لا تراها إلا
// الواجهة: صفحةُ الخصم لا تحمل كلماتِنا في أيّ عنصرٍ أبدًا، والمُشفِّرُ وحده
// يرى الشفرة، وتنبيهُ «إحدى كلماتكم» قبل الإرسال، والجدولان يفرزان التلميحات
// تحت أرقامها، والدردشةُ السرّيّة لا تصل الخصم، ونافذةُ النهاية بالكلمات.
//
// لقطاتٌ للعين: DC_SNAP=مجلد ⇒ تُكتب كلُّ لقطةٍ صفحةً مستقلّةً بأنماطها.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupDecryptoOnline } = require("./decryptosrv");

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

const WORDS = ["شمس", "باب", "تفاحة", "قطار", "قمر", "كتاب", "بحر", "سيارة"];
const stats = [];
const api = setupDecryptoOnline({ of: () => nsp }, {
  store: { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } }, graceMs: 400, encGraceMs: 300, secsScale: 1,
  deal: n => WORDS.slice(0, n)
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
const HTML = fs.readFileSync(PUB("decrypto/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { norm: fs.readFileSync(PUB("justone/norm.js"), "utf8"), app: fs.readFileSync(PUB("decrypto/app.js"), "utf8"),
              theme: fs.readFileSync(PUB("theme.js"), "utf8") };

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
    location: { search, origin: "http://dc.test", href: "http://dc.test/decrypto/" + search, reload() { ctx.reloaded = true; } },
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

const SNAP = process.env.DC_SNAP || null;
function snap(W, name) {
  if (!SNAP) return;
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1] + "\n" + fs.readFileSync(PUB("kawaii.css"), "utf8");
  const body = W.doc.body.outerHTML;
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, name + ".html"),
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + "</style></head>" + body + "</html>");
}
const typeIn = (el, text) => { el.value = text; el.dispatch("input"); };

let CODE = null;
const room = () => api.rooms.get(CODE);
const pidOf = W => { const s = JSON.parse(W.ctx._store.dcResume || "{}"); const p = room().players.find(x => x.token === s.token); return p && p.id; };
const teamOf = W => room().players.find(p => p.id === pidOf(W)).team;

(async () => {
  console.log("\n═══ واجهة «فكّ الشفرة» (app.js الحقيقيّ على decryptosrv.js الحقيقيّ) ═══\n");

  console.log("① الدخول واللوبي والفريقان");
  const A = openPage("سعود");
  await until(() => A.$("pName"));
  ok(A.doc.body.classList.contains("kw-decrypto") && A.doc.body.classList.contains("kw-salfa"), "السمة: kw-salfa + kw-decrypto", A.doc.body.className);
  A.$("pName").value = "سعود"; A.click("createBtn");
  ok(await until(() => A.shown("lobby") && /^\d{5}$/.test(A.$("roomCode").textContent)), "أنشأ غرفةً ودخل الانتظار");
  CODE = A.$("roomCode").textContent;
  ok(A.$("startBtn").disabled && /٤/.test(A.$("needMore").textContent), "زرُّ البدء معطّلٌ وتنبيه «٤ لاعبين»", A.$("needMore").textContent);
  const W = [A];
  for (const nm of ["نورة", "فهد", "ريم"]) {
    const X = openPage(nm, "?r=" + CODE);
    await until(() => X.$("pName"));
    X.$("pName").value = nm; X.click("joinBtn");
    ok(await until(() => X.shown("lobby")), nm + " دخل بالدعوة");
    W.push(X);
  }
  const [, B, C, D] = W;
  ok(await until(() => A.doc.querySelectorAll(".dcTeamCol").length === 2 && A.doc.querySelectorAll(".dcLp").length === 4), "عمودا الفريقين وفيهما الأربعة");
  ok(await until(() => !A.$("startBtn").disabled), "اثنان في كلّ فريق ⇒ البدءُ متاح");
  /* فهد ينتقل إلى الوردي ثمّ يعود */
  const jt = () => C.doc.querySelector(".dcJoinTeam");
  ok(jt() && /الوردي/.test(jt().textContent), "زرُّ «انتقل إلى الوردي» عند فهد");
  jt().dispatch("click");
  ok(await until(() => room().players.find(p => p.name === "فهد").team === 1 && A.$("startBtn").disabled), "انتقل ⇒ الأزرقُ بلاعبٍ واحد فيتعطّل البدء");
  ok(await until(() => C.doc.querySelector(".dcJoinTeam") && /الأزرق/.test(C.doc.querySelector(".dcJoinTeam").textContent)), "(وزرُّ العودة)");
  C.doc.querySelector(".dcJoinTeam").dispatch("click");
  ok(await until(() => room().players.find(p => p.name === "فهد").team === 0 && !A.$("startBtn").disabled), "وعاد");
  ok(A.$("shuffleBtn") && A.$("hostArea").style.display === "flex" && B.$("hostArea").style.display === "none", "التوزيعُ والإعداداتُ للمضيف وحده");
  snap(A, "1-lobby");

  console.log("② البداية والحجب");
  A.click("startBtn");
  ok(await until(() => W.every(X => X.shown("play"))), "بدأت عند الجميع");
  const m = room().match;
  const encOf = t => W.find(X => pidOf(X) === m.cur[t].encryptor);
  const blue = W.filter(X => teamOf(X) === 0), pink = W.filter(X => teamOf(X) === 1);
  const E0 = encOf(0), E1 = encOf(1);
  const A0 = blue.find(X => X !== E0), A1 = pink.find(X => X !== E1);
  ok(await until(() => blue.every(X => X.doc.querySelectorAll("#mineWords .dcWord").length === 4)), "بطاقاتُ كلماتنا الأربع");
  const blueWords = m.teams[0].secretWords, pinkWords = m.teams[1].secretWords;
  const leaks = (X, words) => words.some(w => X.html().includes(w));
  /* الكلمةُ كاملةً لا جزءًا من أخرى («كتاب» في «كتابة التلميحات» ليست تسريبًا) */
  const whole = (h, w) => new RegExp("(^|[^\\p{L}])" + w + "([^\\p{L}]|$)", "u").test(h);
  const leakInfo = [];
  for (const [side, words] of [[pink, blueWords], [blue, pinkWords]])
    for (const X of side) for (const w of words) if (whole(X.html(), w)) leakInfo.push([X.name, w]);
  ok(!leakInfo.length, "صفحةُ الخصم لا تحمل كلماتِنا في أيّ عنصر", leakInfo);
  ok(await until(() => E0.doc.querySelectorAll("#mineRound input.dcClueIn").length === 3), "المُشفِّرُ يرى ثلاثَ خاناتٍ للتلميح");
  const codeTxt = X => X.doc.querySelectorAll("#mineRound .dcCode .dcDig").map(d => d.textContent).join("");
  ok(codeTxt(E0).length === 3 && !A0.doc.querySelector("#mineRound .dcDig"), "والشفرةُ عنده وحده", { e: codeTxt(E0) });
  ok(/يكتب تلميحاتِ فريقكم/.test(A0.$("mineRound").textContent), "والمحلّلُ ينتظر");
  snap(E0, "2-clue-input");

  console.log("③ التلميحات");
  const ins = E0.doc.querySelectorAll("#mineRound input.dcClueIn");
  typeIn(ins[0], "التفاحة"); typeIn(ins[1], "أصفر"); typeIn(ins[2], "سكة");
  ok(/إحدى كلماتكم/.test(E0.$("clueWarn").textContent) && E0.$("clueSend").disabled, "تنبيهٌ قبل الإرسال: «إحدى كلماتكم»، والزرُّ معطّل", E0.$("clueWarn").textContent);
  typeIn(ins[0], "أحمر فاتح");
  ok(/كلمةٌ واحدة/.test(E0.$("clueWarn").textContent), "ومسافةٌ ⇒ «كلمةٌ واحدة»");
  typeIn(ins[0], "أحمر");
  ok(!E0.$("clueWarn").textContent && !E0.$("clueSend").disabled, "تلميحاتٌ سليمة ⇒ الزرُّ متاح");
  E0.click("clueSend");
  ok(await until(() => m.cur[0].clues), "أُرسلت");
  ok(await until(() => /ساعةُ الرمل/.test(E1.$("dcBanner").textContent)), "المُشفِّرُ الآخر يرى «ساعةُ الرمل!»");
  ok(await until(() => /أرسلتَ/.test(E0.$("mineRound").textContent)), "والمرسِلُ يرى ما أرسل");
  const e1in = E1.doc.querySelectorAll("#mineRound input.dcClueIn");
  typeIn(e1in[0], "ليل"); typeIn(e1in[1], "ورق"); typeIn(e1in[2], "موج");
  E1.click("clueSend");
  ok(await until(() => m.phase === "guess"), "أرسلا ⇒ التخمين");

  console.log("④ الورقة المشتركة");
  ok(await until(() => A0.doc.querySelectorAll('#mineRound .dcSheet[data-kind="dec"] .dcRow').length === 3), "المحلّلُ يرى تلميحاتِ زميله وأمام كلٍّ الأرقام");
  ok(/أحمر/.test(A0.$("mineRound").textContent) && /أحمر/.test(A1.$("enemyRound").textContent), "والتلميحاتُ عند الفريقين معًا");
  ok(/الجولة الأولى/.test(A1.$("enemyRound").textContent) && !A1.doc.querySelector("#enemyRound .dcPick"), "الجولةُ الأولى: تلميحاتُ الخصم بلا اعتراض");
  const code0 = m.cur[0].code;
  for (let i = 0; i < 3; i++) {
    const btn = () => A0.doc.querySelectorAll('#mineRound .dcSheet[data-kind="dec"] .dcRow')[i].querySelector('[data-n="' + code0[i] + '"]');
    btn().dispatch("click");
    await until(() => m.cur[0].dec.draft[i] === code0[i]);
  }
  ok(JSON.stringify(m.cur[0].dec.draft) === JSON.stringify(code0), "النقرُ على الأرقام يملأ الورقة");
  ok(await until(() => E0.doc.querySelectorAll("#mineRound .dcPick button.on").length === 3), "والمُشفِّرُ يراها حيّةً (للقراءة)");
  ok(/راقب بصمت/.test(E0.$("mineRound").textContent), "«راقب بصمت»");
  snap(A0, "3-decipher");
  A0.doc.querySelector("#mineRound [data-agree]").dispatch("click");
  ok(await until(() => m.cur[0].dec.locked), "«موافق» من المحلّل الوحيد ⇒ قُفلت");
  ok(await until(() => /قُفلت إجابتُكم/.test(A0.$("mineRound").textContent)), "ويرى «قُفلت إجابتُكم»");
  /* الوردي يخطئ */
  const code1 = m.cur[1].code, wrong1 = [code1[1], code1[0], code1[2]];
  for (let i = 0; i < 3; i++) {
    A1.doc.querySelectorAll('#mineRound .dcSheet[data-kind="dec"] .dcRow')[i].querySelector('[data-n="' + wrong1[i] + '"]').dispatch("click");
    await until(() => m.cur[1].dec.draft[i] === wrong1[i]);
  }
  A1.doc.querySelector("#mineRound [data-agree]").dispatch("click");
  ok(await until(() => m.phase === "reveal"), "قُفلت الأوراق ⇒ الكشف");

  console.log("⑤ الكشف والجدولان");
  ok(await until(() => /سوءُ فهم/.test(A1.$("mineRound").textContent) && /أصبنا/.test(A0.$("mineRound").textContent)), "كلٌّ يرى نتيجةَ فكّه");
  ok(await until(() => A1.doc.querySelectorAll("#dcHud .dcTok.mis.on").length === 1), "ورمزُ سوءِ الفهم في الشريط");
  /* جدولُ الوردي لتلميحات الأزرق: «أحمر» تحت رقمها الحقيقيّ */
  const colOf = (X, grid, n) => X.doc.querySelectorAll("#" + grid + " .dcCol")[n - 1].querySelector(".lst").textContent;
  ok(await until(() => /أحمر/.test(colOf(A1, "enemyGrid", code0[0])) && /أصفر/.test(colOf(A1, "enemyGrid", code0[1])) && /سكة/.test(colOf(A1, "enemyGrid", code0[2]))),
     "الخصمُ يرى تلميحاتِنا مفرزةً تحت أرقامها الحقيقيّة", [1, 2, 3, 4].map(n => colOf(A1, "enemyGrid", n)));
  ok(/أحمر/.test(colOf(A0, "mineGrid", code0[0])), "وجدولُ فريقي كذلك");
  ok(A1.doc.querySelectorAll("#enemyGrid .dcCol .wd").every(e => e.textContent === "؟"), "وكلماتُ الخصم علاماتُ استفهام");
  /* ملاحظةٌ فوق عمودٍ للخصم: في الجهاز وحده */
  const note = A1.doc.querySelectorAll("#enemyGrid input.dcNote")[code0[0] - 1];
  typeIn(note, "تفاحة؟");
  ok(/تفاحة؟/.test(A1.ctx._store.dcNotes || ""), "تخمينُ كلمة الخصم يُحفظ في الجهاز");
  A1.$("tabEnemy").dispatch("click");
  ok(A1.$("paneEnemy").classList.contains("on") && !A1.$("paneMine").classList.contains("on"), "التبويبةُ الثانية");
  snap(A1, "4-reveal-enemy");
  await until(() => W.every(X => X.$("dcNext")));
  W.forEach(X => X.$("dcNext").dispatch("click"));
  ok(await until(() => m.round === 2 && m.phase === "clues"), "«التالي» من الجميع ⇒ الجولة الثانية");
  ok(await until(() => A1.$("paneMine").classList.contains("on")), "وجولةٌ جديدة تُعيد تبويبة «فريقي»");

  console.log("⑥ الدردشتان");
  const chatN = X => X.doc.querySelectorAll("#msgs .msg").length;
  const n0 = W.map(chatN);
  const encNow = encOf(0);
  const talker = blue.find(X => X !== encNow);
  talker.click("chatBtn");
  talker.$("chatInput").value = "أظنّ الأولى " + blueWords[0];
  talker.$("chatForm").dispatch("submit");
  ok(await until(() => blue.every((X, i) => chatN(X) > n0[W.indexOf(X)])), "دردشةُ «فريقي» تصل الأزرق");
  await sleep(40);
  ok(pink.every(X => chatN(X) === n0[W.indexOf(X)]) && !pink.some(X => whole(X.html(), blueWords[0])), "ولا تصل الوردي (ولا كلماتُنا فيها)");
  encNow.click("chatBtn");
  encNow.$("chatInput").value = "ركّزوا";
  encNow.$("chatForm").dispatch("submit");
  ok(await until(() => /المُشفِّر/.test(encNow.$("toast").textContent)), "والمُشفِّرُ صامت", encNow.$("toast").textContent);

  console.log("⑦ الاعتراض حتى الفوز");
  /* جولتان: الأزرقُ يفكّ ويعترض، والورديُّ يفكّ ولا يعترض — يكتبون بالنقر */
  async function sendFrom(X, list) {
    await until(() => X.doc.querySelectorAll("#mineRound input.dcClueIn").length === 3);
    X.doc.querySelectorAll("#mineRound input.dcClueIn").forEach((inp, i) => typeIn(inp, list[i]));
    X.click("clueSend");
  }
  async function fill(X, pane, kind, code) {
    const rows = () => X.doc.querySelectorAll("#" + pane + ' .dcSheet[data-kind="' + kind + '"] .dcRow');
    await until(() => rows().length === 3 && !rows()[0].querySelector("button").disabled);
    for (let i = 0; i < 3; i++) {
      const sh = room().match.cur[teamOf(X)][kind];
      if (sh.draft[i] === code[i]) continue;
      rows()[i].querySelector('[data-n="' + code[i] + '"]').dispatch("click");
      await until(() => room().match.cur[teamOf(X)][kind].draft[i] === code[i]);
    }
  }
  async function agreeAll(team, kind) {
    const mm = room().match;
    for (const X of W.filter(Y => teamOf(Y) === team && mm.editors(team, kind).includes(pidOf(Y)))) {
      const pane = kind === "dec" ? "mineRound" : "enemyRound";
      await until(() => X.doc.querySelector("#" + pane + ' [data-agree="1"]') && !X.doc.querySelector("#" + pane + ' [data-agree="1"]').disabled);
      X.doc.querySelector("#" + pane + ' [data-agree="1"]').dispatch("click");
      await until(() => mm.cur[team][kind].ok.has(pidOf(X)) || mm.cur[team][kind].locked);
    }
  }
  let k = 0;
  for (let r = 0; r < 2; r++) {
    const mm = room().match;
    await sendFrom(encOf(0), ["نهر" + r, "جبل" + r, "غيم" + r]);
    await sendFrom(encOf(1), ["ثلج" + r, "رمل" + r, "نار" + r]);
    ok(await until(() => mm.phase === "guess"), "الجولة " + (mm.round) + ": التخمين");
    if (r === 0) {
      const badge = () => blue.find(X => X !== encOf(0)).$("tabEnemy").querySelector(".dot");
      ok(await until(() => badge().classList.contains("on")), "شارةٌ على «اختراق الخصم»: الاعتراضُ ينتظرك");
    }
    const an0 = blue.find(X => X !== encOf(0)), an1 = pink.find(X => X !== encOf(1));
    await fill(an0, "mineRound", "dec", mm.cur[0].code); await agreeAll(0, "dec");
    await fill(an1, "mineRound", "dec", mm.cur[1].code); await agreeAll(1, "dec");
    an0.$("tabEnemy").dispatch("click");
    await fill(an0, "enemyRound", "int", mm.cur[1].code);
    if (r === 0) snap(an0, "5-intercept");
    await agreeAll(0, "int");
    const c0 = mm.cur[0].code;
    await fill(an1, "enemyRound", "int", [c0[1], c0[0], c0[2]]); await agreeAll(1, "int");
    ok(await until(() => mm.phase === "reveal" || mm.phase === "over"), "قُفلت ⇒ الكشف");
    if (mm.phase === "reveal") {
      ok(await until(() => /اعترضناها/.test(an0.$("enemyRound").textContent)), "«✅ اعترضناها!»");
      await until(() => W.every(X => X.$("dcNext")));
      const rd = mm.round;
      W.forEach(X => X.$("dcNext").dispatch("click"));
      await until(() => mm.round > rd);
    }
  }
  ok(await until(() => W.every(X => X.$("endModal").classList.contains("on")), 4000), "اعتراضان ⇒ نافذةُ النهاية عند الجميع");
  ok(/فاز فريقُك/.test(A.$("endWin").textContent) && /فاز/.test(B.$("endWin").textContent) && !/فريقُك/.test(B.$("endWin").textContent),
     "الأزرقُ يرى «فاز فريقُك»، والورديُّ يرى من فاز", [A.$("endWin").textContent, B.$("endWin").textContent]);
  ok(pinkWords.every(w => B.$("endWords").textContent.includes(w)) && blueWords.every(w => B.$("endWords").textContent.includes(w)), "وكلماتُ الفريقين تُكشف");
  ok(B.doc.querySelectorAll("#endHist .hrow").length === 3, "وسجلُّ الجولات الثلاث");
  snap(B, "6-end");
  A.doc.querySelector("#endModal [data-close]").dispatch("click");
  ok(await until(() => A.shown("lobby")), "إلى الانتظار");

  console.log("⑧ الأخطاء");
  ok(errors.length === 0, "لا استثناءَ في أيّ مسار", errors.map(e => String(e && e.stack || e).slice(0, 300)));

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
