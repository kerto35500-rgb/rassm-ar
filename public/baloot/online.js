/* 🔌 بالوت — طبقة الشبكة والحركة.
 *
 * الخادم هو المرجع: كلّ فعلٍ يُرسَل ويعود في «حالة» فيها منظورُك أنت
 * و«أحداثٌ» تصف ما جرى منذ آخر حالة. الواجهة لا تُخمّن بالفرق بين حالتين —
 * تقرأ الأحداث فتُحرّكها واحدًا واحدًا، ثمّ تستقرّ على الحالة الأخيرة.
 *
 * ولهذا طابور: الحالات تصل أسرعَ من الحركة (بوتٌ يلعب في مئة مِلّي، والطيران
 * أربعُ مئة)، فلو رسمنا كلَّ واردٍ فورًا لقفزت الأوراق. نصفُّها ونستهلكها
 * واحدةً واحدة، والحالة الأخيرة هي الحقيقة دائمًا.
 */

"use strict";

const ONL = {
  sock: null, on: false, code: null, me: null, mySeat: 0,
  view: null, lobby: null, started: false, animating: false, solo: false
};
let G = null;
const Q = [];
let draining = false;
let pendingPlay = null;                       /* ورقةٌ تنتظر قرار إعلان المشاريع */

const phys = seat => (seat == null ? null : (seat - ONL.mySeat + 4) % 4);

/* ══════════ الاتّصال ══════════ */
function olConnect() {
  if (ONL.sock) return ONL.sock;
  const s = io("/baloot", { transports: ["websocket", "polling"] });
  ONL.sock = s;

  s.on("lobby", l => { ONL.lobby = l; if (curScreen === "room") renderRoom(); });
  s.on("started", () => {
    ONL.started = true; ONL.animating = false; Q.length = 0;
    showBoard(); loadChatMeta();
  });
  s.on("state", v => { Q.push(v); drain(); });
  s.on("matchEnd", d => onMatchEnd(d));
  s.on("kicked", () => { toast("أُخرِجتَ من الطاولة"); olReset(); openScreen("main"); });
  s.on("err", d => { toast((d && d.msg) || "تعذّر الفعل"); });
  s.on("invited", d => showInvite(d));
  s.on("chatLog", list => { (list || []).forEach(m => addChat(m, true)); });
  s.on("chat", m => addChat(m));
  s.on("quick", d => { if (d) seatBubble(phys(d.seat), d.text, d.emoji ? "hot" : "", 2000); });
  s.on("gift", d => flyGift(d));
  s.on("disconnect", () => { if (ONL.on) toast("انقطع الاتّصال — نحاول العودة…"); });
  return s;
}

function identity() {
  return { name: P.name, av: P.avatar, frame: P.frame };
}

/* ══════════ الدردشة والعبارات والهدايا ══════════ */
const CHAT = { open: false, unread: 0, meta: null };

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || document.activeElement !== $("#chatin")) return;
  e.preventDefault(); sendChat();
});
function toggleChat() {
  CHAT.open = !CHAT.open;
  $("#chatbox").classList.toggle("show", CHAT.open);
  if (CHAT.open) { CHAT.unread = 0; renderChatDot(); $("#chatin").focus(); }
  snd("click");
}
function renderChatDot() {
  const b = $("#chatdot");
  b.textContent = CHAT.unread > 9 ? "9+" : CHAT.unread;
  b.classList.toggle("show", CHAT.unread > 0);
}
function addChat(m, quiet) {
  if (!m) return;
  const log = $("#chatlog");
  const d = document.createElement("div");
  const mine = !m.sys && m.seat === ONL.mySeat;
  d.className = "m" + (m.sys ? " sys" : "") + (mine ? " me" : "");
  d.innerHTML = m.sys ? esc(m.text) : "<b>" + esc(m.name || "لاعب") + "</b>" + esc(m.text);
  log.appendChild(d);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  if (!quiet && !CHAT.open) { CHAT.unread++; renderChatDot(); }
}
function sendChat() {
  const el = $("#chatin"), t = el.value.trim();
  if (!t || !ONL.sock) return;
  ONL.sock.emit("chat", { text: t });
  el.value = "";
}
function loadChatMeta() {
  if (!ONL.sock) return;
  ONL.sock.emit("chatMeta", {}, d => {
    if (!d || !d.ok) return;
    CHAT.meta = d;
    const q = $("#chatquick");
    q.innerHTML =
      d.phrases.map(p => `<button onclick="quick('${p.id}')">${esc(p.t)}</button>`).join("") +
      d.emojis.map(e => `<button class="emo" onclick="quick('${e}')">${e}</button>`).join("") +
      (d.gifts.length ? `<button class="gift" onclick="openGifts()">🎁 هديّة</button>` : "");
    $("#chatrow").style.display = d.chatOpen ? "" : "none";
  });
}
function quick(id) { if (ONL.sock) ONL.sock.emit("quick", { id }); }

/* الهديّة: اختَر اللاعب ثمّ الهديّة — لا العكس، فاللاعب هو المقصود */
function openGifts() {
  if (!CHAT.meta || !CHAT.meta.gifts.length) return;
  const others = (ONL.view && ONL.view.players || []).filter(p => p.seat !== ONL.mySeat && !p.bot);
  if (!others.length) return toast("لا لاعبَ حقيقيًّا لتُهديه");
  const l = $("#swaplist");
  l.innerHTML = others.map(p =>
    `<button onclick="pickGift(${p.seat})"><img src="${avSrc(p.av)}">${esc(p.name)}</button>`).join("");
  $("#swap-title").textContent = "لمن تُهدي؟";
  $("#ov-swap").classList.add("show");
}
function pickGift(seat) {
  const l = $("#swaplist");
  l.innerHTML = CHAT.meta.gifts.map(g =>
    `<button onclick="sendGift(${seat},'${g.id}')"><span style="font-size:34px">${g.icon}</span>
       ${esc(g.name)}<small>${g.price} ذهبًا</small></button>`).join("");
  $("#swap-title").textContent = "اختر الهديّة";
}
function sendGift(seat, id) {
  $("#ov-swap").classList.remove("show");
  ONL.sock.emit("gift", { seat, id }, r => {
    if (!r || !r.ok) return toast((r && r.error) || "تعذّر الإهداء");
    ACC.load().then(() => renderMain());
  });
}
/* الهديّة تطير من مقعدٍ إلى مقعد — الرمز نفسه، بلا صورةٍ تُحمَّل */
async function flyGift(d) {
  if (!d || !G) return;
  const a = phys(d.from), b = phys(d.to);
  const from = rect($("#" + SEAT_IDS[a] + " .av")), to = rect($("#" + SEAT_IDS[b] + " .av"));
  const el = document.createElement("div");
  el.className = "giftfly";
  el.textContent = d.icon;
  $("#app").appendChild(el);
  snd("proj");
  const t0 = performance.now(), dur = 900;
  let done = false;
  const finish = () => { if (done) return; done = true; el.remove(); seatBubble(b, d.icon + " " + d.name, "hot", 1800); };
  setTimeout(finish, dur + 300);
  const step = () => {
    if (done) return;
    const u = Math.min(1, (performance.now() - t0) / dur), e = ease(u);
    const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e - Math.sin(u * Math.PI) * 160;
    el.style.transform = `translate(${x}px,${y}px) scale(${1 + Math.sin(u * Math.PI) * .7}) rotate(${u * 360}deg)`;
    if (u < 1) requestAnimationFrame(step); else finish();
  };
  step();
}

/* ══════════ طاولات الرهان ══════════ */
function renderBet() {
  const b = $("#bet-body");
  b.innerHTML = '<p style="text-align:center;color:var(--ink2)">جارٍ التحميل…</p>';
  const s = olConnect();
  s.emit("betRooms", {}, d => {
    if (!d || !d.ok) { b.innerHTML = '<p style="text-align:center;color:var(--ink2)">تعذّر التحميل</p>'; return; }
    if (!d.open) {
      b.innerHTML = '<p style="text-align:center;color:var(--ink2);font-weight:700;line-height:1.9">' +
        'الرهان مغلقٌ حاليًّا.<br>جرّب الأونلاين العاديّ — الجائزة فيه بلا مخاطرة.</p>';
      return;
    }
    if (!d.me) {
      b.innerHTML = '<p style="text-align:center;color:var(--ink2);font-weight:700;line-height:1.9">' +
        'طاولات الرهان للمسجَّلين وحدهم.</p><div style="text-align:center;margin-top:12px">' +
        '<button class="btn b" onclick="location.href=\'/me\'">سجّل حسابك</button></div>';
      return;
    }
    b.innerHTML = d.tiers.map(t => {
      const afford = P.coins >= t.min;
      const open = t.rooms.length
        ? t.rooms.map(r => `<button class="btn sm b" onclick="olJoinCode('${r.code}')">${r.code} · ${r.n}/٤</button>`).join("")
        : '<span style="color:var(--ink2);font-weight:700;font-size:13px">لا طاولاتٍ مفتوحة</span>';
      return `<div class="row" style="align-items:flex-start">
        <div class="lbl">الطاولة ${t.name}
          <small>الرهان ${t.bet} ذهبًا · تحتاج ${t.min} في محفظتك</small>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${open}</div></div>
        <button class="btn ${afford ? "p" : "k"} sm" ${afford ? "" : "disabled"}
          onclick="olCreate(false,'${t.tier}')">افتح طاولة</button></div>`;
    }).join("") +
    `<p style="text-align:center;color:var(--ink2);font-weight:700;margin-top:14px;font-size:13px">
       رصيدك ${P.coins} ذهبًا · لا بوتات ولا ضيوف على طاولة رهان · من انقطع يلعب البوت مكانه ورهانُه باقٍ</p>`;
  });
}
function olJoinCode(code) {
  $("#ol-code") && ($("#ol-code").value = code);
  const s = olConnect();
  s.emit("join", { code, ...identity() }, r => {
    if (!r || !r.ok) return toast((r && r.error) || "تعذّر الانضمام");
    ONL.on = true; ONL.code = r.code; ONL.me = r.id;
    openScreen("room");
  });
}

function olCreate(solo, tier) {
  const s = olConnect();
  ONL.solo = !!solo;
  s.emit("create", { ...identity(), tier: tier || null }, r => {
    if (!r || !r.ok) return olErr((r && r.error) || "تعذّر إنشاء الطاولة");
    ONL.on = true; ONL.code = r.code; ONL.me = r.id;
    if (solo) {
      s.emit("settings", { bots: true, botDiff: 2 });
      setTimeout(() => s.emit("start"), 220);
    } else openScreen("room");
  });
}
function startLocal() { snd("click"); olCreate(true); }

function olJoin() {
  const code = ($("#ol-code").value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return olErr("الرمز أربعُ خاناتٍ");
  const s = olConnect();
  s.emit("join", { code, ...identity() }, r => {
    if (!r || !r.ok) return olErr((r && r.error) || "تعذّر الانضمام");
    ONL.on = true; ONL.code = r.code; ONL.me = r.id;
    openScreen("room");
  });
}
const olErr = m => { const e = $("#ol-err"); if (e) e.textContent = m; toast(m); };

function olQuit() {
  if (ONL.sock) ONL.sock.emit("leaveRoom");
  olReset();
  openScreen("main");
}
function leaveMatch() {
  if (!confirm("الخروج من الصكّة؟ سيلعب بوتٌ مكانك.")) return;
  olQuit();
}
function olReset() {
  ONL.on = false; ONL.code = null; ONL.me = null; ONL.started = false;
  ONL.view = null; ONL.lobby = null; ONL.animating = false; ONL.solo = false;
  Q.length = 0; draining = false; G = null;
  $$(".ov").forEach(o => o.classList.remove("show"));
  /* الدردشة تخصّ الطاولة: من خرج منها لا يحمل رسائلها إلى التالية */
  CHAT.open = false; CHAT.unread = 0;
  $("#chatbox").classList.remove("show");
  $("#chatlog").innerHTML = "";
  renderChatDot();
}
function olStart() { if (ONL.sock) ONL.sock.emit("start"); }
function olCopyLink() {
  const url = location.origin + "/baloot/?r=" + ONL.code;
  try { navigator.clipboard.writeText(url); toast("نُسخ الرابط ✔"); }
  catch (e) { $("#rm-link").select(); toast("انسخ الرابط يدويًّا"); }
}
function renderOnlineMe() {
  $("#ol-err").textContent = "";
  $("#ol-me").innerHTML =
    `<div class="slot" style="justify-content:center;margin-bottom:6px">
       <div class="avw"><img class="a" src="${avSrc(P.avatar)}"><img class="f" src="${frSrc(P.frame)}"
         style="${P.frame ? "" : "display:none"}"></div>
       <div><div class="nm">${esc(P.name)}</div>
         <div class="tg">${P.guest ? "ضيف — لا ذهب" : "حسابٌ مسجَّل"}</div></div>
     </div>`;
  fitFrames($("#ol-me"));
}

/* ══════════ غرفة الانتظار ══════════ */
const RULE_ROWS = [
  ["targetScore", "نقاط الصكّة", "متى تنتهي المباراة", [102, 152, 202]],
  ["turnSeconds", "وقت الدور", "ثوانٍ للعب الورقة", [0, 15, 20, 30]],
  ["bidSeconds", "وقت الشراء", "ثوانٍ للشراء والمضاعفة", [0, 10, 15, 25]],
  ["allowAshkal", "أشكل", "أوّل لاعبٍ يترك الشراء لشريكه", "bool"],
  ["allowDouble", "دبل / ثري / فور", "المضاعفة في الحكم", "bool"],
  ["allowGahwa", "قهوة", "من بلغ مئةً يراهن بالصكّة كلّها", "bool"],
  ["projects", "المشاريع", "سرا وخمسين ومية وأربعمية", "bool"],
  ["balootProject", "بلوت", "شايب الحكم وبنته", "bool"],
  ["mustOvertrump", "إجبار القطع بالأعلى", "من قطع وجب أن يعلو", "bool"],
  ["partnerWinningNoTrump", "لا قطعَ على أكلة الشريك", "إذا شريكُك آخذُها فأنت حُرّ", "bool"]
];

function renderRoom() {
  const l = ONL.lobby;
  if (!l) return;
  $("#rm-code").textContent = l.code;
  $("#rm-link").value = location.origin + "/baloot/?r=" + l.code;
  const bt = $("#rm-bet");
  if (bt) bt.innerHTML = l.tier
    ? `<div style="text-align:center;font-weight:900;background:linear-gradient(#fff,var(--pink));
         border-radius:20px;padding:10px;margin-bottom:8px">
         🎲 طاولة ${l.tierName} · الرهان ${l.bet} ذهبًا للاعب · المجموع ${l.bet * 4}
         <div style="font-weight:700;font-size:12px;color:var(--ink2);margin-top:3px">
           يُحجَز من الأربعة عند البدء، والفريق الفائز يقتسمه</div></div>`
    : "";

  const box = $("#rm-seats");
  box.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const p = l.players[i];
    const d = document.createElement("div");
    d.className = "slot t" + (i % 2) + (p ? "" : " empty");
    if (!p) d.textContent = (i % 2 === 0 ? "لنا" : "لهم") + " — مقعدٌ فارغ";
    else {
      d.innerHTML =
        `<div class="avw"><img class="a" src="${avSrc(p.av)}"><img class="f" src="${frSrc(p.frame)}"
           style="${p.frame ? "" : "display:none"}"></div>
         <div style="flex:1"><div class="nm">${esc(p.name)}${p.host ? " 👑" : ""}</div>
           <div class="tg">${i % 2 === 0 ? "لنا" : "لهم"}${p.bot ? " · بوت" : ""}${p.gone ? " · غائب" : ""}</div></div>` +
        (isHost() && !p.host ? `<button class="btn sm k" onclick="ONL.sock.emit('kick',{id:'${p.id}'})">طرد</button>` : "");
    }
    box.appendChild(d);
  }
  fitFrames(box);

  const st = $("#rm-settings");
  const host = isHost();
  st.innerHTML = `<div class="row"><div class="lbl">بوتات تملأ المقاعد<small>مباراةٌ فيها بوتٌ لا تمنح ذهبًا</small></div>
      <div class="sw ${l.settings.bots ? "on" : ""}" data-k="bots"></div></div>` +
    RULE_ROWS.map(([k, name, hint, opt]) => {
      const v = l.settings[k];
      const ctl = opt === "bool"
        ? `<div class="sw ${v ? "on" : ""}" data-k="${k}"></div>`
        : `<div class="seg" data-k="${k}">` + opt.map(o =>
            `<button data-v="${o}" class="${+v === o ? "on" : ""}">${o === 0 ? "بلا" : o}</button>`).join("") + "</div>";
      return `<div class="row"><div class="lbl">${name}<small>${hint}</small></div>${ctl}</div>`;
    }).join("");
  if (host) {
    st.querySelectorAll(".sw").forEach(sw => sw.onclick = () => {
      const k = sw.dataset.k;
      ONL.sock.emit("settings", { [k]: !sw.classList.contains("on") });
      snd("click");
    });
    st.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
      const k = b.parentElement.dataset.k;
      ONL.sock.emit("settings", { [k]: +b.dataset.v });
      snd("click");
    });
  } else st.style.opacity = ".65";

  renderRoomFriends();
  $("#rm-start").style.display = host ? "" : "none";
  const real = l.players.filter(p => p && !p.bot).length;
  $("#rm-note").textContent = host
    ? (real === 4 ? "الطاولة مكتملة — ابدأ!" :
       l.settings.bots ? `${real}/٤ — البوتات ستملأ الباقي (بلا ذهب)` :
       `${real}/٤ — تنتظر ${4 - real} لاعبين، أو فعّل البوتات`)
    : "بانتظار المضيف…";
}
const isHost = () => !!(ONL.lobby && ONL.lobby.host === ONL.me);

/* ══════════ الأصدقاء: دعوةٌ من داخل الطاولة ══════════ */
function renderRoomFriends() {
  const box = $("#rm-friends");
  if (!box || !ONL.sock) return;
  ONL.sock.emit("friends", {}, d => {
    if (!d || !d.ok || !d.list.length) { box.innerHTML = ""; return; }
    const on = d.list.filter(f => f.online), off = d.list.filter(f => !f.online);
    box.innerHTML =
      '<div style="font-weight:900;margin:14px 0 6px">ادعُ صديقًا</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      on.map(f => `<button class="btn sm g" onclick="olInvite(${f.id},this)">
          ${esc(f.name)} <span style="color:var(--mint2)">●</span></button>`).join("") +
      off.map(f => `<button class="btn sm k" disabled>${esc(f.name)} <span style="opacity:.5">○</span></button>`).join("") +
      "</div>" +
      (on.length ? "" : '<div style="color:var(--ink2);font-weight:700;font-size:13px;margin-top:6px">' +
        "لا أحد من أصدقائك في اللعبة الآن — انسخ الرابط وأرسله</div>");
  });
}
function olInvite(id, btn) {
  ONL.sock.emit("invite", { id }, r => {
    if (!r || !r.ok) return toast((r && r.error) || "تعذّرت الدعوة");
    toast("أُرسلت الدعوة ✔");
    if (btn) { btn.textContent = "أُرسلت ✔"; btn.disabled = true; }
  });
}
function showInvite(d) {
  if (!d || !d.code) return;
  if (ONL.on && ONL.code === d.code) return;        /* أنا فيها أصلًا */
  const t = $("#invite");
  t.innerHTML =
    `<b>${esc(d.from)}</b> يدعوك إلى طاولة <b>${esc(d.code)}</b>` +
    (d.tier ? ` <span style="color:#b06070">(رهان ${d.bet})</span>` : "") +
    `<div style="margin-top:8px"><button class="btn sm g" onclick="acceptInvite('${esc(d.code)}')">ادخل</button>` +
    `<button class="btn sm k" onclick="$('#invite').classList.remove('show')">لاحقًا</button></div>`;
  t.classList.add("show");
  snd("bid");
  clearTimeout(showInvite._t);
  showInvite._t = setTimeout(() => t.classList.remove("show"), 30000);
}
function acceptInvite(code) {
  $("#invite").classList.remove("show");
  if (ONL.on) olQuit();
  setTimeout(() => olJoinCode(code), 150);
}

/* ══════════ طابور الحالات ══════════ */
function drain() {
  if (draining) return;
  draining = true;
  (async () => {
    try { while (Q.length) await applyOne(Q.shift()); }
    finally { draining = false; }
  })();
}

function build(v) {
  const players = new Array(4).fill(null);
  (v.players || []).forEach(p => {
    const i = phys(p.seat);
    players[i] = { name: p.name, av: p.av, frame: p.frame, bot: p.bot, gone: p.gone, n: v.handCounts[p.seat] || 0, _seat: p.seat };
  });
  for (let i = 0; i < 4; i++) if (!players[i]) players[i] = { name: "", av: "Adult_1", frame: "", n: 0 };
  const acting = v.phase === "bidding" ? v.bidTurn : v.phase === "doubling" ? v.doubleTurn : v.turn;
  return {
    players,
    hand: (v.me && v.me.hand) ? v.me.hand.slice() : [],
    legal: (v.me && v.me.legal) ? v.me.legal.slice() : [],
    trick: (v.trick || []).map(t => ({ pi: phys(t.seat), card: t.card })),
    deckN: v.phase === "bidding" ? 11 : 0,
    bidCard: v.bidCard, mode: v.mode, trump: v.trump, phase: v.phase,
    turn: phys(acting), scores: v.scores.slice(), myTeam: ONL.mySeat % 2,
    rawPoints: (v.rawPoints || [0, 0]).slice(), trickNo: v.trickNo || 0,
    multiplier: v.multiplier || 1, gahwa: !!v.gahwa,
    buyerPi: v.buyerSeat == null ? null : phys(v.buyerSeat),
    over: !!v.finished
  };
}

async function applyOne(v) {
  ONL.view = v;
  if (ONL.mySeat !== (v.me ? v.me.seat : 0)) ONL.mySeat = v.me ? v.me.seat : 0;
  if (!ONL.started) { ONL.started = true; showBoard(); }

  const next = build(v);
  const events = v.events || [];
  const first = !G;
  if (first) G = next;

  ONL.animating = true;
  hideBidUI();
  try {
    for (const e of events) await animate(e, v, next);
  } catch (err) { console.warn("baloot anim:", err); }
  ONL.animating = false;

  G = next;
  renderAll();
  setTimerBar(v.deadline, G.turn);
  showBidUI(v);
}

/* ══════════ الحركة ══════════ */
async function animate(e, v, next) {
  switch (e.t) {
    case "deal": {
      /* يدٌ جديدة: نمسح الطاولة ثمّ نوزّع ٣ ثمّ ٢ عكس عقارب الساعة */
      G = { ...next, hand: [], legal: [], trick: [], bidCard: null, deckN: 32, trickNo: 0, rawPoints: [0, 0] };
      G.players.forEach(p => p.n = 0);
      renderAll();
      banner("اليد " + e.hand, "", 1000);
      await sleep(500);
      const order = [];
      for (let k = 0; k < 4; k++) order.push(phys((e.first + k) % 4));
      const mine = (v.me && v.me.hand) ? v.me.hand.slice(0, 5) : [];
      let mi = 0;
      for (const rnd of [3, 2]) {
        for (const pi of order) {
          for (let i = 0; i < rnd; i++) {
            if (pi === 0) { G.hand.push(mine[mi++]); await flyDeal(0, G.hand[G.hand.length - 1], 0); }
            else { G.players[pi].n++; G.deckN--; await flyDeal(pi, null, 0); }
            if (pi === 0) G.deckN--;
          }
        }
      }
      break;
    }
    case "bidcard": {
      G.bidCard = e.card; G.phase = "bidding"; G.deckN--;
      renderDeck();
      const b = $("#bidcard");
      b.classList.add("show"); b.innerHTML = "";
      const from = rect($("#deck"));
      await flyCard(from, rect(b), BCARD.cardBack(), { flipTo: BCARD.cardFace(e.card), dur: 520 });
      b.appendChild(BCARD.cardFace(e.card));
      snd("bid");
      break;
    }
    case "bid": {
      const pi = phys(e.seat);
      const L = { sun: "صنّ ☀️", hokum: "حكم " + (e.suit ? BCARD.SUIT_SYM[e.suit] : ""), ashkal: "أشكل!", gahwa: "قهوة ☕", pass: "بس" };
      seatBubble(pi, L[e.choice] || e.choice, e.choice === "pass" ? "" : "hot");
      snd(e.choice === "pass" ? "click" : "bid");
      await sleep(360);
      break;
    }
    case "bidround":
      banner("اللفّة الثانية", "كلُّ الأنواع مفتوحة", 1100);
      await sleep(700);
      break;
    case "redeal":
      banner("إعادة التوزيع", "مرّ الجميع", 1200);
      await sleep(900);
      break;
    case "buy": {
      const pi = phys(e.seat);
      G.buyerSeatRaw = e.seat;
      G.mode = e.mode; G.trump = e.trump; G.buyerPi = pi; G.gahwa = e.gahwa;
      const name = (G.players[pi] || {}).name || "";
      const t = e.mode === "sun" ? "صنّ ☀️" : "حكم " + BCARD.SUIT_SYM[e.trump];
      banner(t, (e.ashkal ? "أشكل — " : "الشاري ") + name, 1500);
      renderTrick(); renderScore();
      snd("proj");
      await sleep(900);
      break;
    }
    case "complete": {
      /* الإكمال: ورقةُ الشراء تطير أوّلًا إلى الشاري (فيرى الجميعُ أين ذهبت)،
         ثمّ يُكمَل التوزيع: الشاري ورقتان والباقي ثلاث. */
      G.phase = "playing";
      const mineNow = (v.me && v.me.hand) ? v.me.hand.slice() : [];
      const have = new Set(G.hand);
      const added = mineNow.filter(c => !have.has(c));
      let ai = 0;

      const bpi = phys(e.buyer);
      const bc = $("#bidcard");
      if (bc.classList.contains("show")) {
        const from = rect(bc);
        bc.classList.remove("show"); bc.innerHTML = "";
        if (bpi === 0) {
          const c = added.length ? added.splice(added.indexOf(G.bidCard) >= 0 ? added.indexOf(G.bidCard) : 0, 1)[0] : null;
          if (c) { G.hand.push(c); renderHand(c); const el = handCardEl(c);
            await flyCard(from, el ? rect(el) : from, BCARD.cardFace(c), { small: true });
            renderHand(); renderSeat(0); }
        } else {
          G.players[bpi].n++;
          renderSeat(bpi);
          const kids = $("#" + ohandId(bpi)).children, el = kids[kids.length - 1];
          if (el) el.style.visibility = "hidden";
          await flyCard(from, el ? rect(el) : rect($("#" + SEAT_IDS[bpi] + " .av")),
                        BCARD.cardFace(G.bidCard), { small: true, flipTo: BCARD.cardBack(true) });
          if (el) el.style.visibility = "";
        }
      }

      const order = [];
      for (let k = 0; k < 4; k++) order.push((v.firstSeat + k) % 4);
      for (const seat of order) {
        const pi = phys(seat);
        const n = e.counts[seat] || 0;
        for (let i = 0; i < n; i++) {
          if (pi === 0) { const c = added[ai++]; if (!c) continue; G.hand.push(c); await flyDeal(0, c, 0); }
          else { G.players[pi].n++; G.deckN = Math.max(0, G.deckN - 1); await flyDeal(pi, null, 0); }
        }
      }
      G.deckN = 0; renderDeck();
      break;
    }
    case "phase":
      if (e.phase === "doubling") { G.phase = "doubling"; renderScore(); }
      if (e.phase === "playing") { G.phase = "playing"; renderAll(); }
      break;
    case "double": {
      const pi = phys(e.seat);
      const L = { double: "دبل ×٢", three: "ثري ×٣", four: "فور ×٤", gahwa: "قهوة ☕", pass: "بس" };
      seatBubble(pi, L[e.choice] || e.choice, e.choice === "pass" ? "" : "hot");
      if (e.choice !== "pass") { G.multiplier = { double: 2, three: 3, four: 4 }[e.choice] || G.multiplier; renderScore(); }
      snd(e.choice === "pass" ? "click" : "bid");
      await sleep(420);
      break;
    }
    case "project": {
      const pi = phys(e.seat);
      const names = e.projects.map(p => p.label).join(" · ");
      seatBubble(pi, names, "hot", 2200);
      snd("proj");
      await sleep(500);
      break;
    }
    case "projects": {
      const mine = e.team === (ONL.mySeat % 2);
      banner("المشاريع " + (mine ? "لنا" : "لهم"),
        e.counted.map(c => c.project.label).join(" · "), 1600);
      await sleep(900);
      break;
    }
    case "baloot": {
      const pi = phys(e.seat);
      seatBubble(pi, "بلوت! 🂮🂭", "hot", 2000);
      snd("baloot");
      await sleep(500);
      break;
    }
    case "play": {
      const pi = phys(e.seat);
      if (pi === 0 && !G.hand.includes(e.card)) G.hand.push(e.card);   /* أمانٌ لو سبقت الحالة */
      await flyPlay(pi, e.card);
      break;
    }
    case "trick": {
      const pi = phys(e.winner);
      await sleep(420);                       /* لحظةُ تأمّلٍ قبل الجمع */
      await flyTrick(pi);
      G.trickNo = e.no;
      G.rawPoints = v.rawPoints ? v.rawPoints.slice() : G.rawPoints;
      seatBubble(pi, "+" + e.points, "hot", 1100);
      renderScore();
      break;
    }
    case "timeout": {
      const pi = phys(e.seat);
      seatBubble(pi, "انتهى الوقت", "bad", 1200);
      break;
    }
    case "handend":
      G.scores = e.scores.slice();
      renderScore();
      await sleep(300);
      showHandResult(e.result, e.scores, v);
      await sleep(1600);
      break;
    case "matchend":
      break;
  }
}

/* ══════════ نوافذ الشراء والمضاعفة والمشاريع ══════════ */
const SUIT_ORDER = ["S", "H", "D", "C"];

function hideBidUI() {
  $("#ov-bid").classList.remove("show");
  $("#ov-double").classList.remove("show");
}

function showBidUI(v) {
  if (!v || v.finished) return;
  const me = v.me || {};
  if (v.phase === "bidding" && v.bidTurn === ONL.mySeat && (me.bidOptions || []).length) {
    $("#bid-title").textContent = v.bidRound === 1 ? "الشراء — اللفّة الأولى" : "الشراء — اللفّة الثانية";
    $("#bid-sub").textContent = v.bidCard
      ? "ورقة الشراء: " + BCARD.RANK_AR[BCARD.cRank(v.bidCard)] + " " + BCARD.SUIT_AR[BCARD.cSuit(v.bidCard)]
      : "";
    const box = $("#bid-opts");
    box.innerHTML = "";
    for (const o of me.bidOptions) {
      const b = document.createElement("button");
      if (o.id === "hokum" && v.bidRound === 2) {
        b.className = "btn b suitbtn" + (BCARD.SUIT_RED[o.suit] ? " red" : "");
        b.innerHTML = `<s>${BCARD.SUIT_SYM[o.suit]}</s>حكم`;
      } else {
        b.className = "btn " + ({ sun: "g", hokum: "b", ashkal: "p", gahwa: "", pass: "k" }[o.id] || "");
        b.textContent = o.label;
      }
      b.onclick = () => { snd("click"); hideBidUI(); ONL.sock.emit("bid", { choice: o.id, suit: o.suit }); };
      box.appendChild(b);
    }
    $("#ov-bid").classList.add("show");
    runBar($("#bid-timer i"), v.deadline);
    return;
  }
  if (v.phase === "doubling" && (me.doubleOptions || []).length) {
    $("#dbl-sub").textContent = "الحكم " + BCARD.SUIT_SYM[v.trump] +
      " · المضاعفة الحاليّة ×" + (v.multiplier || 1);
    const box = $("#dbl-opts");
    box.innerHTML = "";
    for (const o of me.doubleOptions) {
      const b = document.createElement("button");
      b.className = "btn " + (o.id === "pass" ? "k" : "p");
      b.textContent = o.label;
      b.onclick = () => { snd("click"); hideBidUI(); ONL.sock.emit("double", { choice: o.id }); };
      box.appendChild(b);
    }
    $("#ov-double").classList.add("show");
    runBar($("#bid-timer2 i"), v.deadline);
  }
}

let barRaf = null;
function runBar(el, deadline) {
  if (barRaf) cancelAnimationFrame(barRaf);
  barRaf = null;
  if (!el) return;
  if (!deadline) { el.style.width = "100%"; return; }
  const total = deadline - Date.now();
  if (total <= 0) { el.style.width = "0%"; return; }
  const tick = () => {
    const left = deadline - Date.now();
    el.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + "%";
    barRaf = left > 0 ? requestAnimationFrame(tick) : null;
  };
  tick();
}

/* ══════════ لعبُ ورقة ══════════ */
function onHandClick(card) {
  if (!ONL.on || !ONL.view || ONL.animating) return;
  const v = ONL.view;
  if (v.phase !== "playing" || v.turn !== ONL.mySeat) { shake(card); return; }
  if (!(v.me.legal || []).includes(card)) { shake(card); return; }

  /* المشاريع تُعلَن مع أوّل ورقةٍ في الأكلة الأولى — فنسأل مرّةً واحدة */
  if (v.trickNo === 0 && (v.me.projects || []).length) {
    pendingPlay = card;
    const list = $("#proj-list");
    list.innerHTML = v.me.projects.map(p =>
      `<div class="pj">${p.label}<small>${(p.cards || []).map(c =>
        BCARD.cRank(c) + BCARD.SUIT_SYM[BCARD.cSuit(c)]).join(" ")}</small></div>`).join("");
    $("#ov-proj").classList.add("show");
    return;
  }
  sendPlay(card, false);
}
function declProjects(yes) {
  snd("click");
  $("#ov-proj").classList.remove("show");
  const card = pendingPlay; pendingPlay = null;
  if (card) sendPlay(card, yes);
}
function sendPlay(card, declare) {
  const v = ONL.view;
  const baloot = (v.me.balootCards || []).includes(card);   /* البلوت مكسبٌ دائمًا — يُعلَن آليًّا */
  ONL.sock.emit("play", { card, declare: !!declare, baloot });
}
function shake(card) {
  const el = handCardEl(card);
  if (!el) return;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 400);
  snd("bad");
}

/* ══════════ النتائج ══════════ */
function showHandResult(r, scores, v) {
  const us = ONL.mySeat % 2, them = 1 - us;
  const won = r.buyerTeam === us ? r.buyerWon : !r.buyerWon;
  $("#hand-title").textContent = r.capot !== null
    ? (r.capot === us ? "كبوت لنا! 🎉" : "كبوت عليهم 😬")
    : (won ? "اليد لنا 👏" : "اليد لهم");
  $("#hand-body").innerHTML =
    `<table class="sc">
       <tr><th></th><th>لنا</th><th>لهم</th></tr>
       <tr><td>نقاط الأوراق</td><td>${r.raw[us]}</td><td>${r.raw[them]}</td></tr>
       <tr><td>المشاريع</td><td>${r.projRaw[us]}</td><td>${r.projRaw[them]}</td></tr>
       <tr class="${r.abnat[us] >= r.abnat[them] ? "win" : ""}"><td><b>الأبناط</b></td>
         <td><b>${r.abnat[us]}</b></td><td><b>${r.abnat[them]}</b></td></tr>
       <tr><td>المجموع</td><td>${scores[us]}</td><td>${scores[them]}</td></tr>
     </table>
     <p style="font-weight:800">${r.mode === "sun" ? "☀️ صنّ" : "👑 حكم " + BCARD.SUIT_SYM[v.trump]}
       ${r.multiplier > 1 ? " · ×" + r.multiplier : ""}${r.gahwa ? " · ☕ قهوة" : ""}</p>`;
  $("#ov-hand").classList.add("show");
  snd(won ? "win" : "bad");
  setTimeout(() => $("#ov-hand").classList.remove("show"), 4200);
}

function onMatchEnd(d) {
  ONL.animating = false;
  Q.length = 0;
  $$(".ov").forEach(o => o.classList.remove("show"));
  const us = d.myTeam, them = 1 - us;
  $("#end-title").textContent = d.won ? "🏆 ربحتم الصكّة!" : "انتهت الصكّة";
  const mates = (d.players || []).filter(p => p.team === us);
  const opps = (d.players || []).filter(p => p.team !== us);
  const card = (p, w) =>
    `<div class="pd ${w ? "w" : ""}">
       <div class="avw"><img class="a" src="${avSrc(p.av)}"><img class="f" src="${frSrc(p.frame)}"
         style="${p.frame ? "" : "display:none"}"></div>
       <div class="nm">${esc(p.name)}</div><div class="tm">${p.bot ? "بوت" : ""}</div></div>`;
  $("#end-podium").innerHTML =
    `<div><div style="font-weight:900;margin-bottom:6px">لنا · ${d.scores[us]}</div>
       <div style="display:flex;gap:10px">${mates.map(p => card(p, d.won)).join("")}</div></div>
     <div><div style="font-weight:900;margin-bottom:6px">لهم · ${d.scores[them]}</div>
       <div style="display:flex;gap:10px">${opps.map(p => card(p, !d.won)).join("")}</div></div>`;
  const betLine = d.bet
    ? (d.betWon
        ? `<p style="font-weight:900;color:#c9821a;font-size:20px">🎲 ربحتَ ${d.betWon} من رهانٍ مجموعه ${d.pot}</p>`
        : `<p style="font-weight:900;color:#b06070;font-size:17px">🎲 خسرتَ رهانك (${d.bet} ذهبًا)</p>`)
    : "";
  $("#end-body").innerHTML =
    `<p style="font-weight:800">${d.hands} يدًا</p>` + betLine +
    (d.gold ? `<p style="font-weight:900;color:#c9821a;font-size:18px">+${d.gold} ذهبًا 🪙</p>`
            : `<p style="color:var(--ink2);font-weight:700">${esc(d.reason || "لا جائزة")}</p>`);
  if (d.betWon || d.gold) ACC.load().then(() => renderMain());
  fitFrames($("#end-podium"));
  $("#ov-end").classList.add("show");
  snd(d.won ? "win" : "bad");
}

function againMatch() {
  snd("click");
  $("#ov-end").classList.remove("show");
  G = null; ONL.started = false; Q.length = 0;
  if (ONL.solo) { ONL.sock.emit("leaveRoom"); olReset(); olCreate(true); }
  else openScreen("room");
}
