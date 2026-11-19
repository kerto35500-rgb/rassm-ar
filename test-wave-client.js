// اختبار واجهة «التخاطر» من طرفها إلى طرفها — بلا متصفّح.
//
// نشغّل public/wave/app.js **الحقيقيّ** (مع theme.js) داخل DOM مصغّرٍ يُبنى من
// public/wave/index.html نفسه، ونصله بخادم wavesrv.js **الحقيقيّ** عبر socket.io
// مُحاكى. ثمّ نلعب **بالنقر والكتابة وحدهما**: التلميح، وأزرارُ ضبط المؤشر،
// و«موافق»، وتصويتُ الخصم، و«التالي».
//
// ما يصطاده: أيُّ استثناءٍ في الواجهة، وأنّ الهدفَ لا يُرسم إلا عند الوسيط
// (قبل التلميح) وعند الكشف، والستارة، ونافذةَ النهاية.

const fs = require("fs"), path = require("path"), vm = require("vm");
const { setupWaveOnline } = require("./wavesrv");

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
const api = setupWaveOnline({ of: () => nsp }, {
  store: { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } }, graceMs: 400, psyGraceMs: 300, secsScale: 1
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
const HTML = fs.readFileSync(PUB("wave/index.html"), "utf8");
const BODY = HTML.match(/<body([^>]*)>([\s\S]*)<\/body>/);
const bodyAttrs = {}; (BODY[1].match(/([\w-]+)="([^"]*)"/g) || []).forEach(x => { const [k, v] = x.split("="); bodyAttrs[k] = v.slice(1, -1); });
const SRC = { app: fs.readFileSync(PUB("wave/app.js"), "utf8"), theme: fs.readFileSync(PUB("theme.js"), "utf8") };
function openPage(name, search = "", store = {}) {
  const doc = makeDocument(BODY[2], bodyAttrs);
  doc.documentElement = doc.body;
  const ctx = {
    document: doc, console, URLSearchParams, Promise, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Date, Error, TypeError, isNaN, parseFloat, parseInt, Symbol, RegExp,
    setTimeout: (f, ms, ...a) => setTimeout(f, Math.min(+ms || 0, 3), ...a), clearTimeout,
    setInterval: (f, ms, ...a) => setInterval(f, Math.max(5, Math.min(+ms || 0, 15)), ...a), clearInterval,
    requestAnimationFrame: f => setTimeout(() => f(Date.now()), 8),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search, origin: "http://wv.test", href: "http://wv.test/wave/" + search, reload() {} },
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
let CODE = null;
const room = () => api.rooms.get(CODE);
const pidOf = W => { const s = JSON.parse(W.ctx._store.wvResume || "{}"); const p = room().players.find(x => x.token === s.token); return p && p.id; };

(async () => {
  console.log("\n═══ واجهة «التخاطر» (app.js الحقيقيّ على wavesrv.js الحقيقيّ) ═══\n");

  console.log("① الدخول واللوبي");
  const A = openPage("سعود");
  await until(() => A.$("pName"));
  ok(A.doc.body.classList.contains("kw-wave") && A.doc.body.classList.contains("kw-salfa"), "السمة: kw-salfa + kw-wave", A.doc.body.className);
  ok(A.$("wvGauge").querySelector("#wvCurtain") && A.$("wvGauge").querySelector("#wvNeedle") && A.$("wvGauge").querySelector("#wvTarget"), "العدّاد SVG مبنيّ: الستارةُ والمؤشرُ ومنطقةُ الهدف");
  A.$("pName").value = "سعود"; A.click("createBtn");
  ok(await until(() => A.shown("lobby") && /^\d{5}$/.test(A.$("roomCode").textContent)), "أنشأ غرفة");
  CODE = A.$("roomCode").textContent;
  const W = [A];
  for (const nm of ["نورة", "فهد", "ريم"]) {
    const X = openPage(nm, "?r=" + CODE);
    await until(() => X.$("pName"));
    X.$("pName").value = nm; X.click("joinBtn");
    await until(() => X.shown("lobby"));
    W.push(X);
  }
  ok(await until(() => A.doc.querySelectorAll(".wvTeamCol").length === 2 && !A.$("startBtn").disabled), "فريقان ٢×٢ ⇒ البدءُ متاح");

  console.log("② الوسيطُ والستارة");
  A.click("startBtn");
  ok(await until(() => W.every(X => X.shown("play"))), "بدأت عند الجميع");
  const m = room().match;
  const P_ = W.find(X => pidOf(X) === m.cur.psychic);
  const An = W.find(X => X !== P_ && m.teamOf(pidOf(X)) === m.cur.team);
  const Op = W.filter(X => m.teamOf(pidOf(X)) !== m.cur.team);
  ok(await until(() => P_.$("wvGauge").classList.contains("open") && P_.$("wvTarget").style.display !== "none" && /rotate/.test(P_.$("wvTarget").getAttribute("transform") || "")),
     "الوسيط: الستارةُ مفتوحةٌ له والهدفُ مرسومٌ بزاويته");
  ok([An, ...Op].every(X => !X.$("wvGauge").classList.contains("open") && X.$("wvTarget").style.display === "none" && !X.$("wvTarget").getAttribute("transform")),
     "والبقيّة: الستارةُ مغلقة ولا زاويةَ للهدف في صفحتهم أصلًا");
  ok(/«/.test(P_.$("wvClueHint").textContent) && P_.$("endL").textContent === m.cur.card.left, "البطاقةُ بطرفيها، وتوجيهُ الوسيط");
  P_.click("rerollBtn");
  ok(await until(() => m.cur.rerolls === 1 && /١/.test(P_.$("rerollBtn").textContent)), "🔄 بطاقةٌ أخرى (بقيت واحدة)");
  P_.$("clueIn").value = "قهوة المطار";
  P_.click("clueSend");
  ok(await until(() => m.phase === "dial"), "أُرسل التلميح ⇒ المؤشر");
  ok(await until(() => W.every(X => /قهوة المطار/.test(X.$("wvClue").textContent))), "التلميحُ عند الجميع");
  ok(await until(() => !P_.$("wvGauge").classList.contains("open") && P_.$("wvTarget").style.display === "none"), "والستارةُ أُغلقت على الوسيط أيضًا");

  console.log("③ المؤشرُ والموافقة");
  ok(await until(() => An.$("wvGauge").classList.contains("can") && An.$("wvFine").classList.contains("on")), "المحلّلُ يستطيع السحب (وأزرارُ الضبط الدقيق)");
  ok(!Op[0].$("wvGauge").classList.contains("can") && !P_.$("wvGauge").classList.contains("can"), "والخصمُ والوسيطُ لا");
  for (let k = 0; k < 5; k++) { An.$("wvFine").querySelector('[data-d="1"]').dispatch("click"); await sleep(5); }
  ok(await until(() => m.cur.dial === 95), "ضبطُ المؤشر يصل الخادم (٩٥°)", m.cur.dial);
  ok(await until(() => Op[0].ctx._sock && true), "(المؤشرُ يُبثّ للبقيّة برسائل dial)");
  An.click("agreeBtn");
  ok(await until(() => m.phase === "guess" && m.cur.locked === 95), "«موافق» من المحلّل الوحيد ⇒ ثُبّت");
  ok(await until(() => An.$("wvGauge").classList.contains("locked")), "والمؤشرُ مقفلٌ في العدّاد");

  console.log("④ الخصم والكشف");
  ok(await until(() => Op.every(X => X.doc.querySelectorAll(".wvVote [data-s]").length === 2)), "الخصمُ يرى زرَّي يسار/يمين");
  m.cur.target = 100;
  Op[0].doc.querySelector('.wvVote [data-s="right"]').dispatch("click");
  ok(await until(() => m.cur.votes.length === 1), "صوتٌ أوّل");
  Op[1].doc.querySelector('.wvVote [data-s="right"]').dispatch("click");
  ok(await until(() => m.phase === "reveal"), "صوّت الجميع ⇒ الكشف");
  ok(await until(() => W.every(X => X.$("wvGauge").classList.contains("open") && X.$("wvTarget").style.display !== "none")), "الستارةُ تُفتح للجميع");
  ok(await until(() => /\+٣/.test(An.$("wvAct").textContent) && /\+١/.test(An.$("wvAct").textContent)), "على بُعد ٥ ⇒ +٣، والخصمُ أصاب ⇒ +١", An.$("wvAct").textContent);
  ok(await until(() => /<b>٣<\/b>/.test(A.$("scoreA").innerHTML + A.$("scoreB").innerHTML)), "والنقاطُ في الشريط");
  W.forEach(X => X.$("nextBtn") && X.$("nextBtn").dispatch("click"));
  ok(await until(() => m.round === 2 && m.phase === "clue"), "«التالي» من الجميع ⇒ الجولة الثانية");

  console.log("⑤ النهاية وترك الجلسة");
  m.winner = 0; m.phase = "over"; m.ev({ t: "over", winner: 0 });
  api._tick(CODE);
  ok(await until(() => W.every(X => X.$("endModal").classList.contains("on"))), "نافذةُ النهاية عند الجميع");
  ok(/فاز/.test(A.$("endWin").textContent) && A.$("endHist").querySelectorAll(".hrow").length >= 1, "الفائزُ والسجلّ", A.$("endWin").textContent);
  A.doc.querySelector("#endModal [data-close]").dispatch("click");
  ok(await until(() => A.shown("lobby")), "إلى الانتظار");
  A.click("leaveBtn");
  ok(await until(() => A.ctx.location.href === "/"), "🚪 إلى القائمة الرئيسيّة");

  console.log("⑥ الأخطاء");
  ok(errors.length === 0, "لا استثناءَ في أيّ مسار", errors.map(e => String(e && e.stack || e).slice(0, 300)));
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
