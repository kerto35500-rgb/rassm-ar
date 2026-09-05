/* 🎥 ساحة بالوت — الكاميرا والحركة والرسم.
 *
 * منقولةٌ حرفًا بحرفٍ تقريبًا من ساحة «اونو» في هذا الموقع: المسرح الذي
 * يتمدّد على أيّ شاشة، وطيرانُ الورقة بقوسٍ وذيلٍ من نور، ومراوحُ الأيدي،
 * والمقاعدُ ولوحاتُها ومؤقّتاتُها، والرايةُ والفقاعات. تُرِكت كما هي عمدًا —
 * فما أعجب اللاعب في اونو هو هذا بعينه، ولا معنى لإعادة اختراعه.
 *
 * والفرق الجوهريّ واحد: اونو كومةٌ في الوسط تتراكم، وبالوت **أكلة** من
 * أربع أوراقٍ كلٌّ أمام مقعدها ثمّ تُجمَع كلُّها إلى الفائز. فأُضيفت
 * `flyTrick`، وحلّت أربعُ خاناتٍ محلَّ الكومة.
 *
 * الترتيب الفيزيائيّ للمقاعد: ٠ أنا (أسفل) · ١ يمين · ٢ أعلى (شريكي) ·
 * ٣ يسار. واللعب يدور ٠←١←٢←٣ فيوافق دورانَ بالوت عكس عقارب الساعة.
 */

"use strict";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── المسرح: تصميمٌ بمقاس ١٦٠٠×٩٠٠ يُقاس إلى أيّ شاشة ── */
const APP = { s: 1, ox: 0, oy: 0, w: 1600, h: 900 };
function fitStage() {
  const W = window.innerWidth, H = window.innerHeight, portrait = H > W && H < 1200;
  document.body.classList.toggle("portrait", portrait);
  const s = Math.min(W / 1600, H / 900);
  APP.s = s; APP.ox = 0; APP.oy = 0; APP.w = Math.round(W / s); APP.h = Math.round(H / s);
  const app = $("#app");
  app.style.width = APP.w + "px"; app.style.height = APP.h + "px"; app.style.transform = `scale(${s})`;
  fitTrail();
  /* `G` تعريفٌ معجميّ لا خاصّيّةٌ على window — فلا تُفحَص بـwindow.G */
  if (typeof G !== "undefined" && G) { try { renderHand(); } catch (e) {} }
}
function rect(el) {
  const r = el.getBoundingClientRect();
  return { x: (r.left - APP.ox) / APP.s, y: (r.top - APP.oy) / APP.s, w: r.width / APP.s, h: r.height / APP.s };
}

/* ── الصوت: نغماتٌ مركَّبة لا ملفّات، فلا تُحمَّل شيئًا ── */
let AC = null;
document.addEventListener("pointerdown", () => {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (e) {}
}, { once: true });
function snd(type) {
  if (typeof SET !== "undefined" && SET.sound === false) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    const P = {
      click: [620, .05, "square", .05], card: [230, .09, "triangle", .12],
      deal: [180, .07, "triangle", .09], take: [420, .22, "sine", .10],
      win: [660, .6, "square", .12], bad: [120, .32, "sawtooth", .14],
      turn: [520, .08, "sine", .08], bid: [700, .18, "sine", .10],
      proj: [880, .4, "triangle", .12], baloot: [520, .5, "square", .12]
    }[type] || [440, .1, "sine", .1];
    o.type = P[2]; o.frequency.setValueAtTime(P[0], t);
    if (type === "card" || type === "deal") o.frequency.exponentialRampToValueAtTime(95, t + P[1]);
    if (type === "take") o.frequency.exponentialRampToValueAtTime(900, t + P[1]);
    if (type === "win" || type === "proj" || type === "baloot") {
      o.frequency.setValueAtTime(P[0] * 1.25, t + .12);
      o.frequency.setValueAtTime(P[0] * 1.5, t + .24);
    }
    g.gain.setValueAtTime(P[3], t); g.gain.exponentialRampToValueAtTime(.001, t + P[1]);
    o.start(t); o.stop(t + P[1] + .02);
  } catch (e) {}
}

/* ── الذيل النورانيّ خلف الورقة الطائرة ── */
const trailC = $("#trail"), trailX = trailC.getContext("2d");
let trails = [], trailRaf = null;
function fitTrail() {
  trailC.width = APP.w; trailC.height = APP.h;
  trailC.style.width = APP.w + "px"; trailC.style.height = APP.h + "px";
}
function trailTick() {
  trailX.clearRect(0, 0, trailC.width, trailC.height);
  const now = performance.now();
  trails = trails.filter(t => t.live || (t.pts.length && now - t.pts[t.pts.length - 1].t < 260));
  for (const t of trails) {
    const pts = t.pts.filter(p => now - p.t < 260);
    if (pts.length < 2) continue;
    for (let i = 1; i < pts.length; i++) {
      const age = (now - pts[i].t) / 260, w = t.w * (1 - age);
      trailX.strokeStyle = `rgba(255,255,255,${(1 - age) * .5})`;
      trailX.lineWidth = Math.max(1, w); trailX.lineCap = "round";
      trailX.shadowColor = "rgba(255,255,255,.8)"; trailX.shadowBlur = 14;
      trailX.beginPath(); trailX.moveTo(pts[i - 1].x, pts[i - 1].y); trailX.lineTo(pts[i].x, pts[i].y); trailX.stroke();
    }
  }
  trailRaf = trails.length ? requestAnimationFrame(trailTick) : null;
}
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/**
 * تُطيّر ورقةً من مستطيلٍ إلى مستطيل.
 * `node` عنصرُ ورقةٍ جاهز (BCARD.cardNode)، و`opts.flipTo` وجهٌ تنقلب إليه
 * في منتصف الطريق — فتصل مكشوفةً بدل أن ينكشف وجهُها بعد أن تستقرّ.
 */
function flyCard(from, to, node, opts = {}) {
  return new Promise(res => {
    const f = document.createElement("div");
    f.className = "fly";
    f.appendChild(node);
    $("#app").appendChild(f);
    const dur = opts.dur || (opts.small ? 250 : 460);
    const arc = opts.arc == null ? Math.min(220, Math.hypot(to.x - from.x, to.y - from.y) * .32) : opts.arc;
    const rotEnd = opts.rot ? (Math.random() * 26 - 13) : (opts.rotTo || 0);
    const tiltFrom = opts.tiltFrom || 0, tiltTo = opts.tiltTo || 0;
    const tr = { pts: [], w: opts.small ? 10 : 16, live: true };
    trails.push(tr); if (!trailRaf) trailRaf = requestAnimationFrame(trailTick);
    const t0 = performance.now();
    let flipped = false, done = false;
    /* requestAnimationFrame يتوقّف حين يُخفى اللسان (تبديل تبويب، قفل الجوّال).
       أونلاين يعني أن طابور الحالات يقف والخادم يواصل — فيعود اللاعب ودورُه
       قد مضى. صمّامٌ زمنيّ يُنهي الطيران مهما حدث. */
    const finish = () => { if (done) return; done = true; tr.live = false; f.remove(); res(); };
    const guard = setTimeout(finish, dur + 350);
    const step = () => {
      if (done) return;
      const u = Math.min(1, (performance.now() - t0) / dur), e = ease(u);
      const cx = from.x + from.w / 2 + (to.x + to.w / 2 - from.x - from.w / 2) * e;
      const cy = from.y + from.h / 2 + (to.y + to.h / 2 - from.y - from.h / 2) * e - Math.sin(u * Math.PI) * arc;
      const w = from.w + (to.w - from.w) * e, h = from.h + (to.h - from.h) * e;
      const sc = 1 + Math.sin(u * Math.PI) * .2;
      let flip = 1;
      if (opts.flipTo) {
        flip = Math.max(Math.abs(Math.cos(Math.min(u, 1) * Math.PI)), .04);
        if (!flipped && u >= .5) {
          flipped = true;
          f.innerHTML = ""; f.appendChild(opts.flipTo);
        }
      }
      f.style.width = w + "px"; f.style.height = h + "px";
      f.style.transform = `translate(${cx - w / 2}px,${cy - h / 2}px) perspective(900px) ` +
        `rotateX(${tiltFrom + (tiltTo - tiltFrom) * e}deg) scale(${sc}) scaleX(${flip}) rotate(${rotEnd * e}deg)`;
      tr.pts.push({ x: cx, y: cy, t: performance.now() });
      if (u < 1) requestAnimationFrame(step); else { clearTimeout(guard); finish(); }
    };
    step();
  });
}

/* ── توزيع ورقةٍ من المجموعة إلى مقعد ── */
const SEAT_IDS = ["seat-me", "seat-right", "seat-top", "seat-left"];
const ohandId = pi => ({ 1: "ohand-right", 2: "ohand-top", 3: "ohand-left" })[pi];
const handCardEl = card => $('#hand .bc[data-card="' + card + '"]');

async function flyDeal(pi, card, ms) {
  const from = rect($("#deck"));
  snd("deal");
  if (pi === 0) {
    renderHand(card);                       /* نحجز مكانها ثمّ نُطيّرها إليه */
    const el = handCardEl(card);
    const to = el ? rect(el) : from;
    /* وجهُها معروفٌ لي وحدي، فتنقلب في الهواء وتصل مكشوفة */
    await flyCard(from, to, BCARD.cardBack(), {
      small: true, tiltFrom: 46, tiltTo: 0, flipTo: card ? BCARD.cardFace(card) : null
    });
    renderHand(); renderSeat(0); renderDeck();
  } else {
    renderSeat(pi);
    const kids = $("#" + ohandId(pi)).children;
    const el = kids[kids.length - 1];
    let to;
    if (el) { el.style.visibility = "hidden"; to = rect(el); }
    else to = rect($("#" + SEAT_IDS[pi] + " .av"));
    await flyCard(from, to, BCARD.cardBack(true), { small: true });
    if (el) el.style.visibility = "";
    renderDeck();
  }
  if (ms) await sleep(ms);
}

/** لعبُ ورقةٍ: من اليد (أو من مروحة الخصم) إلى خانة الأكلة. */
async function flyPlay(pi, card) {
  const slot = $("#tk-" + pi);
  let from;
  if (pi === 0) {
    const el = handCardEl(card);
    from = rect(el || $("#hand"));
    if (el) el.classList.add("hidden");
  } else {
    const kids = $("#" + ohandId(pi)).children;
    const el = kids[kids.length - 1];
    from = rect(el || $("#" + SEAT_IDS[pi] + " .av"));
    if (el) el.style.visibility = "hidden";
  }
  snd("card");
  /* ورقةُ الخصم تصل مكشوفة: تنقلب في الهواء كما تنقلب على الطاولة حقيقةً */
  const opts = { rot: true };
  if (pi !== 0) { opts.flipTo = BCARD.cardFace(card); }
  await flyCard(from, rect(slot), pi === 0 ? BCARD.cardFace(card) : BCARD.cardBack(), opts);
  G.trick.push({ pi, card });
  if (pi === 0) G.hand = G.hand.filter(c => c !== card);
  else G.players[pi].n = Math.max(0, G.players[pi].n - 1);
  renderTrick(); renderSeat(pi); if (pi === 0) renderHand();
}

/** جمعُ الأكلة: الأوراق الأربع تطير معًا إلى مقعد الفائز ثمّ تختفي. */
async function flyTrick(winPi) {
  const to = rect($("#" + SEAT_IDS[winPi] + " .av"));
  $("#tk-" + winPi).classList.add("win");
  snd("take");
  const flights = [];
  for (const t of G.trick) {
    const slot = $("#tk-" + t.pi);
    const from = rect(slot);
    slot.innerHTML = "";
    flights.push(flyCard(from, to, BCARD.cardFace(t.card), { small: true, dur: 420, rot: true, arc: 90 }));
  }
  await Promise.all(flights);
  $("#tk-" + winPi).classList.remove("win");
  G.trick = [];
  renderTrick();
}

/* ══════════ الرسم ══════════ */
function renderAll() {
  renderTrick(); renderDeck(); renderBidCard();
  for (let i = 0; i < 4; i++) renderSeat(i);
  renderHand(); renderScore();
}

function renderDeck() {
  const d = $("#deck");
  d.classList.toggle("hide", !G || !G.deckN);
  if (G && G.deckN) d.querySelector(".cnt").textContent = G.deckN;
}

function renderBidCard() {
  const b = $("#bidcard");
  const show = !!(G && G.bidCard && G.phase === "bidding");
  b.classList.toggle("show", show);
  if (show) { b.innerHTML = ""; b.appendChild(BCARD.cardFace(G.bidCard)); }
}

function renderTrick() {
  for (let i = 0; i < 4; i++) {
    const slot = $("#tk-" + i);
    const t = G && G.trick ? G.trick.find(x => x.pi === i) : null;
    if (!t) { slot.innerHTML = ""; continue; }
    if (slot.firstChild && slot.firstChild.dataset && slot.firstChild.dataset.card === t.card) continue;
    slot.innerHTML = ""; slot.appendChild(BCARD.cardFace(t.card));
  }
  /* توهّجٌ بلون النمط: ذهبيٌّ في الصنّ، ولونُ الحكم في الحكم */
  const g = $("#glow");
  const HEX = { S: "#6b7cff", H: "#ff7d9c", D: "#ff9d6b", C: "#5fd3a8" };
  const c = G && G.mode === "hokum" ? HEX[G.trump] : (G && G.mode === "sun" ? "#ffd977" : null);
  g.style.boxShadow = c ? `0 0 130px 46px ${c}` : "none";
}

function renderSeat(pi) {
  if (!G) return;
  const p = G.players[pi], s = $("#" + SEAT_IDS[pi]);
  if (!p) return;
  s.querySelector(".plate span").textContent = p.name || "";
  s.querySelector(".plate i").textContent = (pi % 2 === 0) ? "لنا" : "لهم";
  s.classList.toggle("t0", pi % 2 === 0); s.classList.toggle("t1", pi % 2 === 1);
  const n = pi === 0 ? (G.hand ? G.hand.length : 0) : p.n;
  s.querySelector(".cc b").textContent = n;
  s.classList.toggle("active", G.turn === pi && !G.over);
  const img = s.querySelector(".av img");
  const src = avSrc(p.av);
  if (img.getAttribute("src") !== src) img.src = src;
  const fr = s.querySelector("img.fr");
  const fsrc = frSrc(p.frame);
  fr.style.display = p.frame ? "" : "none";
  if (fsrc && fr.getAttribute("src") !== fsrc) fr.src = fsrc;
  fitFrame(s.querySelector(".avw"));
  if (pi === 0) return;

  /* مروحة الخصم: أوراقٌ مقلوبةٌ مصفوفةٌ على الطاولة */
  const oh = $("#" + ohandId(pi));
  oh.innerHTML = "";
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) * .72;
  const cfg = { 1: { ang: 22, rot: 13 }, 2: { ang: 0, rot: 0 }, 3: { ang: -22, rot: -13 } }[pi];
  const sp = pi === 2 ? Math.min(cw * .5, 620 / Math.max(1, n)) : Math.min(cw * .42, 500 / Math.max(1, n));
  const a = cfg.ang * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const t = i - (n - 1) / 2;
    const c = BCARD.cardBack(true);
    c.style.left = (t * sp * Math.cos(a)) + "px";
    c.style.top = (t * sp * Math.sin(a)) + "px";
    c.style.transform = `rotate(${cfg.rot}deg)`;
    c.style.zIndex = i;
    oh.appendChild(c);
  }
}

/** يدي: مروحةٌ عريضةٌ أسفل الشاشة، والمسموح منها مضيءٌ والممنوع باهت. */
function renderHand(hideCard) {
  if (!G || !G.hand) return;
  const h = $("#hand"), n = G.hand.length;
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw"));
  const L = 470, R = APP.w - 60, avail = R - L, maxW = Math.min(avail - cw, 900);
  const sp = n > 1 ? Math.min(cw * .74, maxW / (n - 1)) : 0;
  const total = (n - 1) * sp + cw, x0 = Math.max(L, L + (avail - total) / 2);
  const legal = new Set(G.legal || []);
  const myTurn = G.turn === 0 && !G.over && G.phase === "playing";
  const existing = new Map([...h.children].map(c => [c.dataset.card, c]));
  G.hand.forEach((card, i) => {
    let c = existing.get(card);
    if (!c) {
      c = BCARD.cardFace(card);
      c.onclick = () => onHandClick(card);
      h.appendChild(c);
    }
    existing.delete(card);
    const t = n > 1 ? (i / (n - 1) - .5) : 0;
    c.style.left = (x0 + i * sp) + "px";
    c.style.zIndex = i;
    c.style.transform = `rotate(${t * Math.min(26, n * 3.2)}deg) translateY(${t * t * Math.min(70, n * 8)}px)`;
    c.classList.toggle("ok", myTurn && legal.has(card));
    c.classList.toggle("dim", myTurn && !legal.has(card));
    c.classList.toggle("hidden", card === hideCard);
  });
  existing.forEach(c => c.remove());
}

function renderScore() {
  if (!G) return;
  const us = G.myTeam, them = 1 - us;
  $("#sc-us").textContent = G.scores[us];
  $("#sc-them").textContent = G.scores[them];
  $("#rw-us").textContent = (G.rawPoints || [0, 0])[us];
  $("#rw-them").textContent = (G.rawPoints || [0, 0])[them];
  $("#tk-n").textContent = G.trickNo || 0;
  const md = $("#sc-mode");
  let html = "";
  if (G.mode === "sun") html = '<span class="badge">☀️ صنّ</span>';
  else if (G.mode === "hokum") {
    const red = BCARD.SUIT_RED[G.trump];
    html = `<span class="badge">👑 حكم <b style="color:${red ? "#e2506a" : "#2f2b35"}">${BCARD.SUIT_SYM[G.trump]}</b></span>`;
  }
  if (G.multiplier > 1) html += `<span class="mult">×${G.multiplier}</span>`;
  if (G.gahwa) html += '<span class="mult">☕ قهوة</span>';
  if (G.buyerPi != null && G.players[G.buyerPi]) {
    html += `<span style="font-size:12px;color:var(--ink2)">الشاري: ${esc(G.players[G.buyerPi].name)}</span>`;
  }
  md.innerHTML = html;
}

/* ── مساعداتُ واجهة ── */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const avSrc = a => "/uno/avatars/" + (a || "Adult_1") + ".webp";
const frSrc = f => f ? "/uno/frames/" + f + ".webp" : "";

/* نوافذ الإطارات: الصورةُ تُقصّ داخل نافذة الإطار الشفّافة، وإلا خرج الوجه
   من البرواز. النِّسَب مقيسةٌ آليًّا من قناة الشفافية لكلّ إطار — منقولةٌ
   كما هي من «اونو»، فالإطارات ملفّاتٌ واحدة تشترك فيها اللعبتان. */
const FRWIN = {"AC15":[0.1683,0.1683,0.66,0.66],"AnimeCatCafe":[0.165,0.2117,0.66,0.5833],"Balloon":[0.1977,0.1543,0.608,0.6747],"Bee":[0.2323,0.199,0.572,0.602],"Biscuit":[0.205,0.2117,0.5867,0.5633],"Brawlhalla":[0.1817,0.205,0.6367,0.5967],"Brunch":[0.195,0.2583,0.6167,0.5433],"CGChains":[0.1783,0.1717,0.6433,0.65],"CGCircus":[0.1952,0.1918,0.6063,0.6297],"CGTheater":[0.185,0.1683,0.6467,0.66],"Cake":[0.2008,0.2775,0.555,0.515],"Carp":[0.177,0.177,0.6427,0.646],"Castle":[0.2083,0.2717,0.5833,0.5467],"Cat":[0.1817,0.2317,0.63,0.55],"Classic":[0.195,0.195,0.6067,0.6067],"Cloud":[0.2283,0.2183,0.5767,0.54],"Cosy1":[0.186,0.2093,0.6113,0.5447],"Cosy2":[0.185,0.1983,0.62,0.6333],"Fabric":[0.185,0.1983,0.62,0.6267],"Flowers":[0.175,0.1783,0.65,0.6467],"IceCream":[0.195,0.2583,0.6367,0.5533],"IceCubes":[0.2017,0.1883,0.58,0.5567],"Island":[0.2012,0.1978,0.5943,0.5543],"LAPool":[0.2017,0.1917,0.6,0.6067],"LNY1":[0.2337,0.1803,0.5827,0.6193],"LNY2":[0.2217,0.2517,0.5533,0.5467],"Light":[0.175,0.155,0.6667,0.68],"Luxury":[0.1817,0.185,0.6367,0.6367],"NoMercy":[0.2778,0.2312,0.541,0.5377],"Princess":[0.1683,0.1683,0.6333,0.6667],"RetroAutumn":[0.185,0.1817,0.6433,0.6467],"Roses":[0.195,0.2317,0.6067,0.5667],"ShovelKnight":[0.204,0.1907,0.602,0.602],"Space":[0.2027,0.2127,0.5647,0.5813],"SteampunkCity":[0.2183,0.215,0.5833,0.5833],"Temple":[0.1983,0.1783,0.62,0.6567],"TwitchDrop1":[0.1983,0.1817,0.65,0.6633],"TwitchDrop2":[0.1717,0.1683,0.6767,0.6767],"UnderwaterBio":[0.225,0.235,0.56,0.5533],"WWAttackParticipated":[0.1817,0.215,0.6233,0.62],"WWAttackRanked":[0.1783,0.2183,0.6367,0.6167],"WWAttackWinner":[0.1817,0.2217,0.6333,0.6133],"WWBigHandsParticipated":[0.1817,0.215,0.6233,0.62],"WWBigHandsRanked":[0.1783,0.2183,0.6367,0.6167],"WWBigHandsWinner":[0.1817,0.2217,0.6333,0.6133],"WWFlippedParticipated":[0.1817,0.215,0.6233,0.62],"WWFlippedRanked":[0.1783,0.2183,0.6367,0.6167],"WWFlippedWinner":[0.1817,0.2217,0.6333,0.6133],"WWFogOfWarParticipated":[0.1817,0.215,0.6233,0.62],"WWFogOfWarRanked":[0.1783,0.2183,0.6367,0.6167],"WWFogOfWarWinner":[0.1817,0.2217,0.6333,0.6133],"WWTinyHandsParticipated":[0.1817,0.215,0.6233,0.62],"WWTinyHandsRanked":[0.1783,0.2183,0.6367,0.6167],"WWTinyHandsWinner":[0.1817,0.2217,0.6333,0.6133],"WWWhirlpoolParticipated":[0.1817,0.215,0.6233,0.62],"WWWhirlpoolRanked":[0.1783,0.2183,0.6367,0.6167],"WWWhirlpoolWinner":[0.1817,0.2217,0.6333,0.6133],"Wizard":[0.165,0.1717,0.62,0.65]};
const FR_S = 1.36, FR_O = -0.18;   /* الإطار يُرسم من ‎-18%‎ بعرض ‎136%‎ من الصندوق */
function fitFrame(box) {
  if (!box) return;
  const f = box.querySelector(":scope>img.f, :scope>img.fr");
  const av = box.querySelector(":scope>img.a, :scope>.av, :scope>img:not(.f):not(.fr)");
  if (!av) return;
  const src = f ? (f.getAttribute("src") || "") : "";
  const key = (f && f.style.display !== "none" && src) ? src.split("/").pop().replace(/\.webp$/, "") : null;
  const w = key ? FRWIN[key] : null;
  if (!w) { av.style.left = av.style.top = av.style.width = av.style.height = ""; return; }
  av.style.left = ((FR_O + w[0] * FR_S) * 100).toFixed(2) + "%";
  av.style.top = ((FR_O + w[1] * FR_S) * 100).toFixed(2) + "%";
  av.style.width = ((w[2] * FR_S) * 100).toFixed(2) + "%";
  av.style.height = ((w[3] * FR_S) * 100).toFixed(2) + "%";
}
const fitFrames = root => (root || document).querySelectorAll(".avw,.avbox").forEach(fitFrame);

let msgT = null;
function msg(t, ms = 2400) {
  const m = $("#msg div"); m.textContent = t; m.classList.add("show");
  clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove("show"), ms);
}
let toastT = null;
function toast(t) {
  const e = $("#toast"); e.textContent = t; e.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove("show"), 1900);
}
let bannerT = null;
function banner(t, sub, ms = 1400) {
  const b = $("#banner"); b.innerHTML = esc(t) + (sub ? `<small>${esc(sub)}</small>` : "");
  b.classList.add("show");
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove("show"), ms);
}
function seatBubble(pi, t, cls = "", ms = 1600) {
  const b = $("#" + SEAT_IDS[pi] + " .bubble");
  if (!b) return;
  b.textContent = t; b.className = "bubble show " + cls;
  setTimeout(() => b.classList.remove("show"), ms);
}

/* ── مؤقّت الدور: قوسٌ يتناقص حول صورة صاحب الدور ── */
let timerRaf = null;
function setTimerBar(deadline, pi) {
  if (timerRaf) cancelAnimationFrame(timerRaf);
  timerRaf = null;
  $$(".timer").forEach(t => t.style.setProperty("--p", "0%"));
  if (!deadline || pi == null) return;
  const total = deadline - Date.now();
  if (total <= 0) return;
  const el = $("#" + SEAT_IDS[pi] + " .timer");
  const tick = () => {
    const left = deadline - Date.now();
    const p = Math.max(0, Math.min(100, (left / total) * 100));
    if (el) el.style.setProperty("--p", p + "%");
    timerRaf = left > 0 ? requestAnimationFrame(tick) : null;
  };
  tick();
}

window.addEventListener("resize", fitStage);
window.addEventListener("orientationchange", () => setTimeout(fitStage, 300));
