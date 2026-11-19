/* 💌 «رسالة حب» — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. وما يصله محجوبٌ على
 * الخادم أصلًا — يدُ غيري والكومةُ والمحروقة لا تصلني، لا أنّها تصل وتُخفى.
 *
 * الطاولة: مساحاتُ الخصوم فوق (بطاقاتُهم مقلوبة، وما رموه مكشوف، ونجومُهم)،
 * ولوحةُ الوسط (آخرُ ما لُعب ونتيجةُ الجولة)، ومساحتي تحت بيدي. وعلى الجانب
 * ثلثُ الشاشة لعدّ البطاقات (ما لُعب، وما معي، وما بقي مجهولًا) ولسجلّ الجولة.
 * ولعبُ بطاقةٍ تحتاج هدفًا يفتح نافذةً: الهدف، ثمّ التخمين، ثمّ التأكيد —
 * ولا يُرسل شيءٌ إلى الخادم قبل التأكيد.
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);

  /* ══════════ البطاقات ══════════ */
  const COPIES = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1 };
  const NAMES = { 1: "الحارس", 2: "الكاهن", 3: "البارون", 4: "الخادمة", 5: "الأمير", 6: "الملك", 7: "الكونتيسة", 8: "الأميرة" };
  const FX = {
    1: "خمّن بطاقةَ خصم (غيرَ الحارس) — أصبتَ؟ يخرج",
    2: "انظر سرًّا إلى بطاقة خصم",
    3: "قارن بطاقتك سرًّا بخصم — الأقلّ يخرج",
    4: "أنت محميٌّ حتى دورك القادم",
    5: "لاعبٌ (أو أنت) يرمي بطاقته ويسحب غيرها",
    6: "بادِل بطاقتك مع خصم",
    7: "مع الملك أو الأمير لا بدّ أن تُرمى",
    8: "إن رُميت لأيّ سببٍ خرجتَ من الجولة"
  };
  const NEEDS = new Set([1, 2, 3, 5, 6]);
  /* أيقوناتٌ مرسومةٌ بخطوطٍ بسيطة (C = لونُ البطاقة) */
  const ICON = {
    1: '<path d="M24 5 L39 10.5 V23 C39 32.5 32.5 39 24 43 C15.5 39 9 32.5 9 23 V10.5 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><path d="M24 12 V36 M15.5 21 H32.5" stroke="C" stroke-width="3" stroke-linecap="round"/>',
    2: '<path d="M4 24 C12 12 36 12 44 24 C36 36 12 36 4 24 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="C"/><circle cx="26.5" cy="21.5" r="2.2" fill="#fff"/><path d="M24 6 v3 M12 9 l2 2.6 M36 9 l-2 2.6" stroke="C" stroke-width="2.4" stroke-linecap="round"/>',
    3: '<path d="M24 9 V40 M15 41 H33 M9 15 H39" stroke="C" stroke-width="3" stroke-linecap="round"/><path d="M9 15 L3.5 28 H14.5 Z M39 15 L33.5 28 H44.5 Z" fill="#fff" stroke="C" stroke-width="2.6" stroke-linejoin="round"/><circle cx="24" cy="8" r="3.2" fill="C"/>',
    4: '<path d="M8 19 H34 V26 C34 33 29 37 21 37 C13 37 8 33 8 26 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><path d="M34 22 C41.5 22 41.5 31 33.5 31" fill="none" stroke="C" stroke-width="3" stroke-linecap="round"/><path d="M5 41.5 H37" stroke="C" stroke-width="3" stroke-linecap="round"/><path d="M16 7 q-3 3 0 6 M23 6 q-3 3 0 6" stroke="C" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>',
    5: '<path d="M10 36 L8 17 L17.5 24 L24 12 L30.5 24 L40 17 L38 36 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><path d="M10 36 H38" stroke="C" stroke-width="3"/><circle cx="24" cy="29.5" r="2.8" fill="C"/><circle cx="24" cy="10" r="2.4" fill="C"/>',
    6: '<path d="M7 33 L5 13 L15 21 L19 9 L24 19 L29 9 L33 21 L43 13 L41 33 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><rect x="7" y="33" width="34" height="7" rx="2.5" fill="C"/><circle cx="16" cy="27" r="2.3" fill="C"/><circle cx="24" cy="27" r="2.3" fill="C"/><circle cx="32" cy="27" r="2.3" fill="C"/>',
    7: '<circle cx="24" cy="18" r="11.5" fill="#fff" stroke="C" stroke-width="3"/><path d="M24 18 m-5 0 a5 5 0 1 0 5 -5 a2.6 2.6 0 1 0 2.6 2.6" fill="none" stroke="C" stroke-width="2.4" stroke-linecap="round"/><path d="M24 29.5 V44 M24 38 C18 38 14.5 34 14.5 31 C19.5 31 24 34 24 38" stroke="C" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    8: '<path d="M6 34 C10 23 16 19 24 19 C32 19 38 23 42 34" fill="none" stroke="C" stroke-width="3" stroke-linecap="round"/><path d="M24 31 C24 31 14 24 14 17.5 C14 13.5 17 11 20 11 C22 11 23.5 12.2 24 13.6 C24.5 12.2 26 11 28 11 C31 11 34 13.5 34 17.5 C34 24 24 31 24 31 Z" fill="#fff" stroke="C" stroke-width="3" stroke-linejoin="round"/><circle cx="9" cy="28.5" r="2.4" fill="C"/><circle cx="39" cy="28.5" r="2.4" fill="C"/><path d="M6 39 H42" stroke="C" stroke-width="3" stroke-linecap="round"/>'
  };
  const INK = { 1: "#3F6E9C", 2: "#7A5CD0", 3: "#C77A2E", 4: "#2E9E73", 5: "#D0566F", 6: "#B88A0A", 7: "#C8433A", 8: "#B04AA0" };
  const BACK = '<rect x="7" y="13" width="34" height="23" rx="3.5" fill="#fff" stroke="#D0566F" stroke-width="2.6"/><path d="M7 15.5 L24 28 L41 15.5" fill="none" stroke="#D0566F" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 33 c0 0 -5.5 -3.6 -5.5 -7 c0 -2.2 1.6 -3.3 3.2 -3.3 c1.1 0 1.9 .6 2.3 1.4 c.4 -.8 1.2 -1.4 2.3 -1.4 c1.6 0 3.2 1.1 3.2 3.3 c0 3.4 -5.5 7 -5.5 7z" fill="#E86A7E" stroke="#fff" stroke-width="1.2"/>';
  const svg = (body, v) => '<svg viewBox="0 0 48 48">' + body.replace(/"C"/g, '"' + (INK[v] || "#D0566F") + '"') + "</svg>";
  function cardHTML(v, cls, attrs) {
    return '<div class="llCard c' + v + (cls ? " " + cls : "") + '" data-v="' + v + '"' + (attrs || "") + ' title="' + esc(NAMES[v] + " (" + v + ") — " + FX[v]) + '">' +
      '<span class="num">' + AR(v) + '</span><div class="ico">' + svg(ICON[v], v) + '</div><b class="cn">' + NAMES[v] + '</b><small class="fx">' + FX[v] + "</small></div>";
  }
  const backHTML = cls => '<div class="llCard back' + (cls ? " " + cls : "") + '"><div class="ico">' + svg(BACK) + "</div></div>";
  const cname = v => "«" + NAMES[v] + " " + AR(v) + "»";

  /* لكلّ مقعدٍ لون */
  const PAL = [{ l: "#FFC6D5", d: "#E0577E" }, { l: "#C4E3FA", d: "#3F8ED0" }, { l: "#BDEBD6", d: "#2E9E73" }, { l: "#D9CCFF", d: "#7A5CD0" }];
  const palOf = seat => PAL[(seat || 0) % PAL.length];

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let LOBBY = null, VIEW = null, SKEW = 0, DEFAULTS = null, settings = null;
  let OPTS = { min: 2, max: 4 };
  let ended = false, lastTick = -1, centerKey = "", PM = null;

  /* ══════════ أدوات ══════════ */
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.add("on");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3200);
  }
  const onClose = {};
  function openModal(id) { $(id).classList.add("on"); }
  function closeModal(id) {
    const m = $(id);
    if (!m.classList.contains("on")) return;
    m.classList.remove("on");
    if (onClose[id]) onClose[id]();
  }
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => {
    if (e.target.hasAttribute("data-close") || (e.target === m && !m.hasAttribute("data-sticky"))) closeModal(m.id);
  }));
  const playerOf = id => (VIEW && VIEW.players.find(p => p.id === id)) || (LOBBY && LOBBY.players.find(p => p.id === id)) || null;
  const nameOf = id => (p => p ? p.name : "لاعب")(playerOf(id));
  const meMark = id => nameOf(id) + (id === ME ? " (أنت)" : "");
  const nameB = id => '<b style="--sd:' + palOf(seatOf(id)).d + '; color:var(--sd)">' + esc(meMark(id)) + "</b>";
  const seatOf = id => { const p = VIEW && VIEW.players.find(x => x.id === id); return p ? p.seat : 0; };
  const initial = s => (String(s || "؟").trim()[0] || "؟");
  const avatar = (name, seat) => '<span class="av" style="--sd:' + palOf(seat).d + '">' + esc(initial(name)) + "</span>";

  /* أصواتٌ مركّبة */
  let AC = null, SND = true;
  try { SND = localStorage.getItem("llSnd") !== "0"; } catch (e) {}
  function snd(kind) {
    if (!SND) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime;
      const tone = (f, at, dur, type, vol) => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.connect(g); g.connect(AC.destination);
        o.type = type; o.frequency.setValueAtTime(f, t + at);
        g.gain.setValueAtTime(vol, t + at); g.gain.exponentialRampToValueAtTime(.001, t + at + dur);
        o.start(t + at); o.stop(t + at + dur + .02);
      };
      if (kind === "win") { tone(660, 0, .16, "sine", .09); tone(880, .12, .18, "sine", .09); tone(1320, .26, .32, "sine", .08); }
      else if (kind === "out") { tone(330, 0, .2, "triangle", .08); tone(220, .16, .35, "triangle", .08); }
      else if (kind === "card") { tone(880, 0, .05, "triangle", .06); tone(1180, .05, .07, "triangle", .05); }
      else if (kind === "turn") { tone(740, 0, .1, "sine", .07); tone(990, .1, .16, "sine", .07); }
      else if (kind === "peek") { tone(1046, 0, .12, "sine", .06); tone(1318, .1, .18, "sine", .05); }
      else if (kind === "round") { tone(520, 0, .12, "sine", .07); tone(780, .1, .16, "sine", .07); }
      else if (kind === "tick") tone(1180, 0, .045, "square", .03);
      else tone(440, 0, .1, "sine", .06);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => {
    SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇";
    try { localStorage.setItem("llSnd", SND ? "1" : "0"); } catch (e) {}
  };

  /* ══════════ الشاشات ══════════ */
  function showScreen(which) {
    $("joinScreen").style.display = which === "join" ? "flex" : "none";
    $("game").style.display = which === "join" ? "none" : "flex";
    $("lobby").style.display = which === "lobby" ? "flex" : "none";
    $("play").style.display = which === "play" ? "flex" : "none";
  }
  function toLobby() {
    showScreen("lobby");
    VIEW = null; centerKey = "";
    $("phaseInfo").textContent = "في الانتظار…";
    $("chatCard").classList.remove("on"); $("quickPop").classList.remove("on");
  }

  /* ══════════ اللوبي ══════════ */
  function renderLobby(L) {
    LOBBY = L;
    settings = { ...L.settings };
    const host = L.host === ME;
    if (!L.playing && !ended) toLobby();
    $("roomCode").textContent = L.code;
    const pl = $("plist");
    pl.innerHTML = "";
    const humans = L.players.filter(p => !p.bot);
    humans.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "llLp" + (p.id === ME ? " me" : "") + (p.gone ? " gone" : "");
      d.innerHTML = avatar(p.name, i) + '<span class="nm">' + esc(p.name) + "</span>" +
        (p.id === ME ? "<small>أنت</small>" : "") + (p.gone ? "<small>غائب</small>" : "") + (p.host ? '<span class="crown">👑</span>' : "");
      if (host && p.id !== ME) {
        const k = document.createElement("button");
        k.className = "kick"; k.textContent = "✕"; k.title = "إخراج";
        k.onclick = () => { if (confirm("إخراج " + p.name + "؟")) socket.emit("kick", { id: p.id }); };
        d.appendChild(k);
      }
      pl.appendChild(d);
    });
    const n = humans.filter(p => !p.gone).length;
    const S = settings;
    const bots = S.bots ? Math.max(0, Math.min(L.max, Math.max(S.seats, n)) - n) : 0;
    for (let i = 0; i < bots; i++) pl.insertAdjacentHTML("beforeend", '<div class="llLp botSlot"><span class="av" style="--sd:#B9A99A">🤖</span><span class="nm">بوت</span></div>');
    $("plCount").textContent = "(" + AR(n + bots) + "/" + AR(L.max) + ")";
    const can = n + bots >= L.min;
    $("needMore").textContent = can ? "" : "تحتاجون لاعبَين على الأقلّ — فعّلوا البوتات أو انسخوا رابط الدعوة 🔗";
    $("startBtn").disabled = !can;
    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    const seats = S.bots ? Math.max(S.seats, n) : n;
    const STAR = { 2: 7, 3: 5, 4: 4 };
    $("lobbySummary").innerHTML = "💌 الطاولة " + AR(seats) + (S.bots ? " (تكملها البوتات)" : " (بلا بوتات)") +
      " · ⭐ " + AR(STAR[Math.max(2, Math.min(4, seats))] || 4) + " نجوم للفوز · ⏱️ ٤٥ث للدور" +
      (lr ? "<br>🏁 آخر لعبة: فاز " + esc(lr.winnerName || "") + " 💌" : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }
  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    const seg = (id, list, fmt) => '<div class="seg" id="' + id + '">' + list.map(v => '<button data-v="' + v + '">' + fmt(v) + "</button>").join("") + "</div>";
    box.innerHTML =
      '<div class="setRow"><label>💌 حجم الطاولة</label>' + seg("sSeats", [2, 3, 4], v => AR(v)) +
        '<div class="hint">تكمل البوتاتُ المقاعدَ الفارغة إلى هذا العدد (إن كانت مفعّلة). النجومُ للفوز: لاعبان ٧، ثلاثة ٥، أربعة ٤.</div></div>' +
      '<div class="setRow"><label>🤖 البوتات</label>' + seg("sBots", ["1", "0"], v => v === "1" ? "تشغيل" : "إيقاف") +
        '<div class="hint">البوتُ يعدّ البطاقات ويخمّن بذكاء — ويلعب عن من يخرج أو يغيب.</div></div>';
    $("sSeats").querySelectorAll("button").forEach(b => b.onclick = () => push({ seats: +b.dataset.v }));
    $("sBots").querySelectorAll("button").forEach(b => b.onclick = () => push({ bots: b.dataset.v === "1" }));
  }
  function push(d) { Object.assign(settings, d); syncSettings(); socket.emit("updateSettings", d); }
  function syncSettings() {
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    on("sSeats", settings.seats); on("sBots", settings.bots ? "1" : "0");
  }
  $("setOpen").onclick = () => $("setBox").classList.toggle("open");
  $("startBtn").onclick = () => socket.emit("startGame");

  /* ══════════ الحالة ══════════ */
  function onState(v) {
    const prev = VIEW;
    VIEW = v;
    SKEW = (v.serverNow || Date.now()) - Date.now();
    if (!ended) showScreen("play");
    for (const e of v.events || []) onEvent(e, v, prev);
    render(v);
  }
  function shakeOf(id) {
    const el = id === v0().me ? $("llMine") : document.querySelector('#llTable [data-id="' + id + '"]');
    if (!el) return;
    el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
    setTimeout(() => el.classList.remove("hit"), 700);
  }
  const v0 = () => VIEW || {};
  function onEvent(e, v) {
    if (e.t === "round") { snd("round"); addMsg("💌 الجولة " + AR(e.round) + " — يبدؤها " + nameOf(e.starter), true); }
    else if (e.t === "turn") { if (e.turn === v.me) snd("turn"); }
    else if (e.t === "play") snd("card");
    else if (e.t === "drew" && e.by === "prince") toast("🤴 رُميت بطاقتك — وسحبت " + cname(e.card));
    else if (e.t === "peek") {
      snd("peek");
      info('<div class="llPm"><div class="t" style="font-size:19px; font-weight:900">🔮 بطاقةُ ' + esc(nameOf(e.target)) + "</div>" + cardHTML(e.card, "lg new") +
        '<div class="llNote">لا يراها غيرُك — وتبقى في مساحته (🔮) ما دامت معه</div></div>');
    }
    else if (e.t === "baron") {
      const res = e.mine > e.theirs ? "✨ بطاقتُك أعلى — خرج " + esc(nameOf(e.by === v.me ? e.vs : e.by))
        : e.mine < e.theirs ? "💔 بطاقتُك أقلّ — خرجتَ من الجولة" : "🤝 تعادل — لا يخرج أحد";
      const other = e.by === v.me ? e.vs : e.by;
      info('<div class="llPm"><div style="font-size:19px; font-weight:900">⚖️ البارون: مقارنةٌ سرّيّة</div><div class="llVs">' +
        '<div class="side">' + cardHTML(e.mine, "md new") + "أنت</div><div class=\"mid\">⚖️</div>" +
        '<div class="side">' + cardHTML(e.theirs, "md new") + esc(nameOf(other)) + "</div></div>" +
        '<div class="' + (e.mine < e.theirs ? "llWarn" : "llNote") + '">' + res + "</div></div>");
    }
    else if (e.t === "swap") {
      const other = e.by === v.me ? e.vs : e.by;
      toast("👑 " + (e.by === v.me ? "بادلتَ " + nameOf(other) : nameOf(other) + " بادلك") + ": أعطيتَ " + cname(e.gave) + " وأخذتَ " + cname(e.got));
    }
    else if (e.t === "out") {
      snd("out");
      setTimeout(() => shakeOf(e.id), 60);
      if (e.id === v.me) toast("💔 خرجتَ من هذه الجولة" + (e.cards && e.cards.length ? " (كانت معك " + cname(e.cards[0]) + ")" : ""));
    }
    else if (e.t === "roundEnd") {
      const mine = (e.winners || []).includes(v.me);
      snd(mine ? "win" : "round");
      addMsg("⭐ " + (e.winners || []).map(meMark).join(" و") + " — نجمة " + (e.reason === "last" ? "(آخرُ من بقي)" : "(أعلى بطاقة)"), true);
    }
  }
  function info(html) {
    $("imBody").innerHTML = html;
    openModal("infoModal");
    clearTimeout(info._t);
    info._t = setTimeout(() => closeModal("infoModal"), 6500);
  }

  const meP = v => v.players.find(p => p.id === v.me) || {};
  const myTurn = v => v.phase === "turn" && v.turn === v.me && !!v.legal;

  function render(v) {
    $("phaseInfo").textContent = (v.phase !== "over" ? "الجولة " + AR(v.round) + " · " : "") + phaseLine(v);
    renderHud(v);
    renderTable(v);
    renderMine(v);
    renderCenter(v);
    renderSide(v);
    if (!myTurn(v) && PM) { PM = null; closeModal("playModal"); }
    tickTimer();
  }
  function phaseLine(v) {
    if (v.paused) return "⏸️ بانتظار عودة اللاعبين…";
    if (v.phase === "turn") return myTurn(v) ? "💌 دورك — العب بطاقة" : "⏳ دورُ " + nameOf(v.turn);
    if (v.phase === "result") return "⭐ انتهت الجولة";
    if (v.phase === "over") return "🏁 انتهت اللعبة";
    return "…";
  }
  function renderHud(v) {
    $("hRound").textContent = AR(v.round);
    $("hDeck").innerHTML = "🂠 الكومة <b>" + AR(v.deckN) + "</b>";
    $("hTarget").innerHTML = "⭐ للفوز <b>" + AR(v.target) + "</b>";
    const f = $("hFace");
    f.style.display = (v.faceUp || []).length ? "" : "none";
    f.querySelector(".llAside").innerHTML = (v.faceUp || []).map(c => cardHTML(c, "xs")).join("");
  }

  /* ── مساحاتُ الخصوم: بترتيب الجلوس بدءًا بمن بعدي ── */
  function others(v) {
    const ps = v.players, i = ps.findIndex(p => p.id === v.me);
    return ps.slice(i + 1).concat(ps.slice(0, i));
  }
  function tagsOf(v, p) {
    const t = [];
    if (p.out) t.push('<span class="llTag out">💔 خرج من الجولة</span>');
    if (p.protected) t.push('<span class="llTag prot">🫖 محميّ</span>');
    if (v.phase === "turn" && v.turn === p.id) t.push('<span class="llTag turn">' + (p.id === v.me ? "💌 دورك" : "⏳ دورُه") + "</span>");
    return t.length ? '<div class="llTags">' + t.join("") + "</div>" : "";
  }
  const starsHTML = (p, v) => '<span class="llStars" title="النجوم — ' + AR(v.target) + ' للفوز">⭐ ' + AR(p.stars) + " من " + AR(v.target) + "</span>";
  function discHTML(p, lbl) {
    return '<div class="llDisc">' + (lbl ? '<span class="llDiscLbl">' + lbl + "</span>" : "") +
      (p.discards.length ? p.discards.map(c => cardHTML(c, "xs")).join("") : '<span class="llDiscLbl">—</span>') + "</div>";
  }
  function renderTable(v) {
    const box = $("llTable");
    const list = others(v);
    const want = list.map(p => p.id).join(",");
    if (box.dataset.ids !== want) {
      box.dataset.ids = want;
      box.innerHTML = "";
      for (const p of list) {
        const d = document.createElement("div");
        d.dataset.id = p.id;
        d.style.setProperty("--sd", palOf(p.seat).d);
        d.innerHTML = '<div class="bub"></div><div class="mat" style="display:flex; flex-direction:column; gap:6px"></div>';
        box.appendChild(d);
      }
    }
    const reveal = v.phase === "result" || v.phase === "over";
    for (const d of box.children) {
      const p = v.players.find(x => x.id === d.dataset.id);
      if (!p) continue;
      d.className = "llMat" + (v.phase === "turn" && v.turn === p.id ? " turn" : "") + (p.out ? " out" : "");
      const kn = v.known && v.known[p.id];
      const handPart = reveal && p.hand ? p.hand.map(c => cardHTML(c, "sm" + (v.result && v.result.winners.includes(p.id) ? " glow" : ""))).join("")
        : Array.from({ length: p.handN }, () => backHTML("xs")).join("");
      d.querySelector(".mat").innerHTML =
        '<div class="hd">' + avatar(p.name, p.seat) + '<span class="nm">' + esc(p.name) + "</span>" + starsHTML(p, v) + "</div>" +
        tagsOf(v, p) +
        (kn && !reveal ? '<span class="llKnown" title="عرفتَها بالكاهن أو البارون أو الملك">' + cardHTML(kn, "xs") + "🔮 معه " + NAMES[kn] + "</span>" : "") +
        '<div class="llRowP"><div class="llBacks">' + handPart + "</div>" + discHTML(p, "رمى:") + "</div>";
    }
  }

  /* ── مساحتي: يدي، وما رميتُه ── */
  function renderMine(v) {
    const me = meP(v);
    const box = $("llMine");
    const mine = myTurn(v);
    box.className = "card" + (mine ? " turn" : "");
    box.style.setProperty("--sd", palOf(me.seat).d);
    if (!box.querySelector(".mi")) box.innerHTML = '<div class="bub"></div><div class="mi" style="display:flex; flex-direction:column; gap:8px"></div>';
    const hand = me.hand || [];
    const playable = mine ? v.legal.cards : [];
    const key = [v.round, v.phase, v.turn, hand.join(""), me.out ? 1 : 0, me.protected ? 1 : 0, me.stars, me.discards.join(""), mine ? playable.join("") : ""].join("|");
    if (box.dataset.k === key) return;
    const fresh = box.dataset.hand !== hand.join("") && v.phase === "turn";
    box.dataset.k = key; box.dataset.hand = hand.join("");
    const lbl = me.out ? "💔 خرجتَ من هذه الجولة — انتظر التالية"
      : mine ? (v.legal.forced ? "🌹 معك الكونتيسة مع " + (hand.includes(6) ? "الملك" : "الأمير") + " — لا بدّ أن ترميها" : "💌 دورك: اضغط البطاقةَ التي تلعبها")
      : (v.phase === "turn" ? "يدك — تلعب حين يأتي دورك" : "يدك");
    box.querySelector(".mi").innerHTML =
      '<div class="hd">' + avatar(me.name, me.seat) + '<span class="nm">' + esc(me.name) + " (أنت)</span>" + starsHTML(me, v) + tagsOf(v, me) + "</div>" +
      '<div class="lbl">' + lbl + "</div>" +
      '<div id="llHand">' + hand.map((c, i) => {
        const cls = "lg" + (mine ? (playable.includes(c) ? " pick" : " lock") : "") + (fresh && i === hand.length - 1 && hand.length === 2 ? " new" : "");
        return cardHTML(c, cls);
      }).join("") + (!hand.length ? '<span class="sub">' + (me.out ? "💔" : "—") + "</span>" : "") + "</div>" +
      '<div class="llRowP">' + discHTML(me, "رميتُ:") + "</div>";
    box.querySelectorAll("#llHand .llCard.pick").forEach(el => el.addEventListener("click", () => openPlay(+el.dataset.v)));
    box.querySelectorAll("#llHand .llCard.lock").forEach(el => el.addEventListener("click", () => toast("🌹 الكونتيسة مع الملك أو الأمير: لا بدّ أن ترميها هي")));
  }

  /* ══════════ نافذةُ اللعب: الهدف ← التخمين ← التأكيد ══════════ */
  function unseen(v) {
    const u = { ...COPIES };
    const sub = c => { if (u[c] > 0) u[c]--; };
    for (const p of v.players) for (const c of p.discards) sub(c);
    for (const c of v.faceUp || []) sub(c);
    for (const c of meP(v).hand || []) sub(c);
    return u;
  }
  function openPlay(card) {
    const v = VIEW;
    if (!myTurn(v) || !v.legal.cards.includes(card)) return;
    PM = { card, target: null, guess: null };
    const tg = v.legal.targets[card] || [];
    if (NEEDS.has(card) && tg.length === 1 && card !== 5) PM.target = tg[0];
    paintPlay();
    openModal("playModal");
  }
  onClose.playModal = () => { PM = null; };
  function paintPlay() {
    const v = VIEW;
    if (!PM || !v || !v.legal) return;
    const c = PM.card;
    const me = meP(v);
    const keep = (() => { const h = (me.hand || []).slice(); h.splice(h.indexOf(c), 1); return h[0]; })();
    const tg = v.legal.targets[c] || [];
    let h = '<div class="llPm"><div class="llPmHd">' + cardHTML(c, "md") + '<div><div class="t">' + NAMES[c] + " · " + AR(c) + '</div><div class="d">' + FX[c] + "</div>" +
      (keep ? '<div class="d">وتبقى معك: ' + cname(keep) + "</div>" : "") + "</div></div>";
    if (NEEDS.has(c)) {
      const cands = v.players.filter(p => !p.out && (p.id !== v.me || c === 5));
      h += '<div class="llStep">١) ' + (c === 5 ? "من يرمي بطاقته؟" : "اختر الخصم") + "</div>";
      if (!tg.length) h += '<div class="llNote">🫖 الكلُّ محميٌّ بالخادمة — تُلعب بلا أثر</div>';
      else h += '<div class="llPick">' + cands.map(p => {
        const okT = tg.includes(p.id);
        const why = p.protected ? "<small>🫖 محميّ</small>" : "";
        return '<button class="llTgt' + (PM.target === p.id ? " on" : "") + '" type="button" data-t="' + p.id + '"' + (okT ? "" : " disabled") + ">" +
          avatar(p.name, p.seat) + (p.id === v.me ? "أنا" : esc(p.name)) + why +
          (v.known[p.id] ? "<small>🔮 " + NAMES[v.known[p.id]] + "</small>" : "") + "</button>";
      }).join("") + "</div>";
      if (c === 1 && tg.length) {
        const U = unseen(v);
        const kn = PM.target && v.known[PM.target];
        h += '<div class="llStep">٢) خمّن بطاقتَه' + (PM.target ? "" : " (بعد اختيار الخصم)") + "</div>" +
          '<div class="llGuess">' + [2, 3, 4, 5, 6, 7, 8].map(g =>
            '<button type="button" data-g="' + g + '" class="' + (PM.guess === g ? "on" : "") + (U[g] ? "" : " zero") + '"' + (PM.target ? "" : " disabled") + ">" +
              cardHTML(g, "sm") + "<small>" + NAMES[g] + "<br>" + (kn === g ? "🔮 معه!" : "مجهول " + AR(U[g])) + "</small></button>").join("") + "</div>";
      }
    }
    if (c === 8) h += '<div class="llWarn">⚠️ رميُ الأميرة يُخرجك من الجولة!</div>';
    if (c === 5 && PM.target === v.me && keep === 8) h += '<div class="llWarn">⚠️ سترمي الأميرة — وتخرج!</div>';
    if (c === 6 && keep === 8) h += '<div class="llWarn">⚠️ ستعطي الأميرةَ لخصمك</div>';
    if (c === 3 && PM.target && v.known[PM.target]) h += '<div class="llNote">🔮 تعرف أنّ معه ' + cname(v.known[PM.target]) + " — ومعك " + cname(keep) + "</div>";
    h += "</div>";
    $("pmBody").innerHTML = h;
    $("pmBody").querySelectorAll(".llTgt[data-t]").forEach(b => b.onclick = () => {
      PM.target = b.dataset.t;
      if (c === 1 && v.known[PM.target] && v.known[PM.target] !== 1) PM.guess = v.known[PM.target];
      paintPlay();
    });
    $("pmBody").querySelectorAll(".llGuess button[data-g]").forEach(b => b.onclick = () => { PM.guess = +b.dataset.g; paintPlay(); });
    const ready = !NEEDS.has(c) || !tg.length || (PM.target && (c !== 1 || PM.guess));
    $("pmGo").disabled = !ready;
    $("pmGo").textContent = c === 8 ? "ارمِ الأميرة 💔" : "العب " + NAMES[c] + " ✓";
  }
  $("pmGo").onclick = () => {
    if (!PM) return;
    const d = { card: PM.card };
    if (PM.target) d.target = PM.target;
    if (PM.guess) d.guess = PM.guess;
    socket.emit("play", d);
    PM = null;
    closeModal("playModal");
  };

  /* ══════════ لوحةُ الوسط ══════════ */
  function entryText(e) {
    const by = nameB(e.by), tg = e.target ? nameB(e.target) : "";
    switch (e.card) {
      case 1: return e.noEffect ? "🛡️ " + by + " لعب الحارس — بلا أثر (الكلُّ محميّ)"
        : "🛡️ " + by + " خمّن " + cname(e.guess) + " عند " + tg + (e.hit ? " — ✔️ أصاب، خرج!" : " — ✖️ أخطأ");
      case 2: return e.noEffect ? "🔮 " + by + " لعب الكاهن — بلا أثر" : "🔮 " + by + " نظر سرًّا إلى بطاقة " + tg;
      case 3: return e.noEffect ? "⚖️ " + by + " لعب البارون — بلا أثر"
        : "⚖️ " + by + " قارن مع " + tg + (e.loser ? " — خرج " + nameB(e.loser) + " ومعه " + cname(e.loserCard) : " — تعادل");
      case 4: return "🫖 " + by + " محميٌّ حتى دوره القادم";
      case 5: return "🤴 " + by + " جعل " + (e.target === e.by ? "نفسَه" : tg) + " يرمي " + cname(e.discarded) + (e.discarded === 8 ? " — خرج! 💔" : e.fromBurn ? " (وسحب المحروقة)" : "");
      case 6: return e.noEffect ? "👑 " + by + " لعب الملك — بلا أثر" : "👑 " + by + " بادل بطاقتَه مع " + tg;
      case 7: return "🌹 " + by + " رمى الكونتيسة";
      case 8: return "👸 " + by + " رمى الأميرة — خرج! 💔";
    }
    return "";
  }
  function renderCenter(v) {
    const box = $("llCenter");
    const key = [v.round, v.phase, v.turn, v.log.length, v.paused ? 1 : 0, myTurn(v) ? 1 : 0].join("|");
    if (key === centerKey) return;
    centerKey = key;
    let h = "";
    const last = v.log[v.log.length - 1];
    const lastHTML = last ? '<div class="llPlay">' + cardHTML(last.card, "md new") + '<div class="txt">' + entryText(last) + "</div></div>" : "";
    if (v.paused) h = '<div class="tt">⏸️ توقّفت الطاولة</div><div class="ss">لا أحدَ من البشر حاضرٌ — تستأنف حين يعود أحد</div>';
    else if (v.phase === "turn") {
      h = lastHTML + (myTurn(v)
        ? '<div class="tt">💌 دورك — اختر بطاقةً من يدك تحت</div>'
        : '<div class="ss">⏳ دورُ ' + esc(nameOf(v.turn)) + " يختار بطاقته…</div>");
      if (!last) h = '<div class="tt">💌 الجولة ' + AR(v.round) + "</div>" + h;
    } else if ((v.phase === "result" || v.phase === "over") && v.result) {
      const r = v.result;
      const mine = r.winners.includes(v.me);
      const who = r.winners.map(meMark).join(" و");
      h = lastHTML + '<div class="llRes' + (mine ? " mine" : "") + '">⭐ ' + esc(who) + (r.winners.length > 1 ? " — نجمةٌ لكلٍّ" : " يكسب نجمة") +
        "<small>" + (r.reason === "last" ? "آخرُ من بقي في الجولة" : r.tie ? "تعادلت البطاقات — فحسمها مجموعُ ما رُمي" : "نفدت الكومة — وبطاقتُه الأعلى") + "</small></div>";
      const hs = Object.keys(r.hands);
      if (r.reason === "deck" && hs.length > 1) h += '<div class="llHands">' + hs.map(id => '<div class="h1">' + cardHTML(r.hands[id], "sm" + (r.winners.includes(id) ? " glow" : "")) +
        "<span>" + esc(meMark(id)) + "</span></div>").join("") + "</div>";
      if (r.burned) h += '<div class="ss">🔥 البطاقةُ المحروقة كانت: ' + cname(r.burned) + "</div>";
      if (v.phase === "result") h += '<div class="ss">الجولةُ التالية بعد لحظات…</div>';
    }
    box.innerHTML = h;
  }

  /* ══════════ الجانب: عدُّ البطاقات والسجلّ ══════════ */
  function renderSide(v) {
    const seen = {}, mine = {};
    for (const p of v.players) for (const c of p.discards) seen[c] = (seen[c] || 0) + 1;
    for (const c of v.faceUp || []) seen[c] = (seen[c] || 0) + 1;
    for (const c of meP(v).hand || []) mine[c] = (mine[c] || 0) + 1;
    $("llCount").innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(c => {
      const s = seen[c] || 0, m = mine[c] || 0, left = Math.max(0, COPIES[c] - s - m);
      const pips = Array.from({ length: COPIES[c] }, (_, i) => '<i class="' + (i < s ? "gone" : i < s + m ? "mine" : "") + '"></i>').join("");
      return '<div class="llCnt c' + c + (left ? "" : " zero") + '">' + cardHTML(c, "xs") + '<span class="nm">' + NAMES[c] + '</span><span class="llPips">' + pips +
        '</span><span class="left">' + (left ? "مجهول " + AR(left) : "✓ كلّها") + "</span></div>";
    }).join("");
    const key = v.round + ":" + v.log.length;
    const lg = $("llLog");
    if (lg.dataset.k === key) return;
    lg.dataset.k = key;
    lg.innerHTML = v.log.slice().reverse().map(e => '<div class="llL' + (e.hit || e.loser || e.card === 8 || e.discarded === 8 ? " hot" : "") + '">' + entryText(e) + "</div>").join("") +
      '<div class="llL sys">💌 بدأت الجولة ' + AR(v.round) + " — يبدؤها " + esc(nameOf(v.starter)) + "</div>";
  }

  /* ── المؤقّت ── */
  function tickTimer() {
    const v = VIEW;
    const bar = $("tbar"), sec = $("tsec");
    if (!v || v.phase === "over" || !v.deadline || v.paused) {
      bar.firstElementChild.style.width = v && v.paused ? "100%" : "0%";
      bar.classList.toggle("paused", !!(v && v.paused));
      bar.classList.remove("hurry");
      sec.textContent = v && v.paused ? "⏸️" : "—";
      return;
    }
    bar.classList.remove("paused");
    const left = Math.max(0, v.deadline - (Date.now() + SKEW));
    bar.firstElementChild.style.width = Math.max(0, Math.min(100, left / (v.span || 1) * 100)).toFixed(1) + "%";
    const s = Math.ceil(left / 1000);
    sec.textContent = AR(s);
    const hurry = left <= 8000 && v.phase === "turn";
    bar.classList.toggle("hurry", hurry);
    if (hurry && s !== lastTick && s > 0 && myTurn(v)) { lastTick = s; snd("tick"); }
  }
  setInterval(tickTimer, 200);

  /* ══════════ القواعد ══════════ */
  function rulesHTML() {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    return r("💌 الفكرة", "١٦ بطاقة فقط، ولكلّ لاعبٍ بطاقةٌ واحدة في يده. في دورك تسحب فيصير معك اثنتان، وتلعب إحداهما مكشوفةً فتنفّذ قدرتها. اخرج خصومك من الجولة — أو ابقَ للنهاية بأعلى بطاقة.") +
      '<div class="rule">' + [1, 2, 3, 4, 5, 6, 7, 8].map(c => '<div class="llRule">' + cardHTML(c, "sm") + '<div class="x"><b>' + NAMES[c] + " · " + AR(c) + "</b> (×" + AR(COPIES[c]) + ") — " + FX[c] + "</div></div>").join("") + "</div>" +
      r("🔥 البداية", "تُحرق بطاقةٌ سرًّا في كلّ جولة (فلا يُعرف كلُّ شيء)، ومع لاعبَين تُبعد ثلاثٌ أخرى مكشوفة.") +
      r("🫖 الخادمة", "لا يستهدفك أحدٌ حتى يعود دورك. وإن كان الكلُّ محميًّا لُعبت البطاقةُ بلا أثر — إلا الأمير فيكون على نفسك.") +
      r("🌹 الكونتيسة", "إن اجتمعت في يدك مع الملك أو الأمير فلا بدّ أن ترميها — وقد ترميها خداعًا وليس معك أحدُهما.") +
      r("⭐ نهاية الجولة", "آخرُ من بقي يكسب نجمة. أو تنفد الكومة فتُكشف الأيدي: الأعلى يكسب، والتعادلُ يحسمه مجموعُ ما رماه كلٌّ، فإن بقي تعادلٌ كسبوا جميعًا.") +
      r("🏆 الفوز", "لاعبان: ٧ نجوم · ثلاثة: ٥ · أربعة: ٤.") +
      r("⏱️ الوقت", "٤٥ ثانيةً للدور؛ تنتهي فتُلعب عنك بطاقةٌ جائزة.");
  }
  $("rulesBtn").onclick = () => { $("rulesBody").innerHTML = rulesHTML(); openModal("rulesModal"); };

  /* ══════════ النهاية ══════════ */
  function onEnd(res) {
    const iWon = res.winner === ME;
    $("endBanner").innerHTML = (iWon ? "💌 فزت! وصلت رسالتُك للأميرة" : "🏆 الفائز: " + esc(res.winnerName || "")) + "<small>" + AR(res.target || 0) + " نجوم ⭐</small>";
    $("endBanner").style.background = iWon ? "linear-gradient(180deg,#7DDCA9,#36A96F)" : "";
    const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
    $("endRank").innerHTML = (res.ranking || []).map(x => {
      const seat = VIEW ? seatOf(x.id) : 0;
      return '<div class="rk' + (x.id === ME ? " me" : "") + '" style="--sd:' + palOf(seat).d + "; --sl:" + palOf(seat).l + '">' +
        '<span class="pl">' + (MEDAL[x.place] || AR(x.place)) + '</span><span class="nm">' + esc(x.name) + (x.id === ME ? " (أنت)" : "") + (x.bot ? " 🤖" : "") + "</span>" +
        '<span class="x">⭐ ' + AR(x.stars) + "</span></div>";
    }).join("");
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(iWon ? "win" : "round");
  }
  onClose.endModal = () => {
    if (!ended) return;
    ended = false;
    if (!LOBBY || !LOBBY.playing) toLobby();
  };
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  /* 🚪 ترك الجلسة: خروجٌ متعمَّد إلى القائمة الرئيسيّة (يلعب بوتٌ مكانك) */
  function leaveNow() {
    try { localStorage.removeItem("llResume"); } catch (e) {}
    try { socket.emit("leaveRoom"); } catch (e) {}
    setTimeout(() => { location.href = "/"; }, 150);
  }
  $("leaveBtn").onclick = () => {
    if (VIEW && VIEW.phase !== "over" && !ended) openModal("leaveModal");
    else leaveNow();
  };
  $("leaveYes").onclick = leaveNow;
  $("endLeave").onclick = leaveNow;

  /* ══════════ الدردشة ══════════ */
  const PHRASES = ["السلام عليكم 👋", "بالتوفيق للجميع 🤝", "معي الأميرة 😇", "لا تصدّقونه! 🤨",
                   "حارس على مين؟ 🛡️", "يا ساتر! 😱", "هههههه 😂", "ضربة معلّم 👏",
                   "الخادمة تحميني 🫖", "خمّنت صح! 🎯", "مشكورين 🙏", "لعبة حلوة 💌"];
  const EMOJI = ["😂", "😎", "😇", "🤨", "😱", "🤔", "💌", "👸", "🤴", "👑", "🛡️", "🔮", "👏", "🙈", "💔", "❤️"];
  (function buildQuick() {
    const qp = $("quickPop");
    const phr = document.createElement("div"); phr.className = "phr";
    const emo = document.createElement("div"); emo.className = "emo";
    const send = t => { socket.emit("chat", { text: t }); qp.classList.remove("on"); };
    for (const t of PHRASES) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", () => send(t)); phr.appendChild(b); }
    for (const t of EMOJI) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", () => send(t)); emo.appendChild(b); }
    qp.appendChild(phr); qp.appendChild(emo);
  })();
  let unread = 0;
  function paintUnread() {
    const u = $("unread");
    u.textContent = unread > 9 ? "+٩" : AR(unread);
    u.classList.toggle("on", unread > 0);
  }
  $("quickBtn").onclick = e => { e.stopPropagation(); $("chatCard").classList.remove("on"); $("quickPop").classList.toggle("on"); };
  $("chatBtn").onclick = e => {
    e.stopPropagation();
    $("quickPop").classList.remove("on");
    const on = $("chatCard").classList.toggle("on");
    if (on) { unread = 0; paintUnread(); $("msgs").scrollTop = $("msgs").scrollHeight; }
  };
  $("chatClose").onclick = () => $("chatCard").classList.remove("on");
  document.addEventListener("pointerdown", e => {
    if (!e.target || !e.target.closest) return;
    if (!e.target.closest("#quickPop") && !e.target.closest("#quickBtn")) $("quickPop").classList.remove("on");
  });
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u;
  function bubble(id, text) {
    const host = id === ME ? $("llMine") : document.querySelector('#llTable [data-id="' + id + '"]');
    if (!host) return;
    const b = host.querySelector(".bub");
    if (!b) return;
    b.textContent = text;
    b.classList.toggle("big", EMOJI_ONLY.test(text) && text.length <= 8);
    b.classList.add("on");
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove("on"), 4000);
  }
  function addMsg(m, sys, quiet) {
    const d = document.createElement("div");
    d.className = "msg" + (sys ? " system" : "");
    if (sys) d.textContent = m;
    else { d.innerHTML = "<b>" + esc(m.name) + ":</b> " + esc(m.text); d.querySelector("b").style.color = palOf(seatOf(m.id)).d; }
    $("msgs").appendChild(d);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    if (sys || quiet) return;
    bubble(m.id, m.text);
    if (VIEW && m.id !== ME && !$("chatCard").classList.contains("on")) { unread++; paintUnread(); }
  }
  $("chatForm").onsubmit = e => {
    e.preventDefault();
    const t = $("chatInput").value.trim();
    if (!t) return;
    socket.emit("chat", { text: t });
    $("chatInput").value = "";
  };

  /* ══════════ الاتّصال والدخول ══════════ */
  socket = io("/love");
  const invite = new URLSearchParams(location.search).get("r");
  const BIDI = s => "⁨" + s + "⁩";
  if (invite) {
    const code = invite.trim().slice(0, 6);
    $("pRoom").value = code;
    $("pRoom").style.display = "none";
    $("createBtn").style.display = "none";
    $("joinBtn").textContent = "🚪 ادخل الغرفة " + BIDI(code);
    document.querySelector(".divider").textContent = "— دعوة لغرفة " + BIDI(code) + " —";
  }
  function inviteFailed() {
    if (!invite) return;
    $("pRoom").style.display = "";
    $("createBtn").style.display = "";
    $("joinBtn").textContent = "انضمام 🚪";
    document.querySelector(".divider").textContent = "— أو انضم لغرفة موجودة —";
  }
  socket.on("hello", h => {
    DEFAULTS = h.defaults;
    OPTS = { min: h.min || 2, max: h.max || 4 };
    settings = settings || { ...DEFAULTS };
    if (h.you) { $("whoLine").innerHTML = "مسجّل باسم <b>" + esc(h.you) + "</b>"; $("whoLine").style.display = "block"; $("pName").value = h.you; }
    tryRejoin();
  });
  function needName() {
    const n = $("pName").value.trim();
    if (!n) { $("joinErr").textContent = "اكتب اسمك أولًا"; $("pName").focus(); return null; }
    return n;
  }
  $("createBtn").onclick = () => {
    const n = needName(); if (!n) return;
    socket.emit("createRoom", { name: n }, res => res.ok ? enter(res) : ($("joinErr").textContent = res.error || "تعذّر إنشاء الغرفة"));
  };
  $("joinBtn").onclick = () => {
    const n = needName(); if (!n) return;
    const r = $("pRoom").value.trim();
    if (!r) return ($("joinErr").textContent = "اكتب رمز الغرفة");
    let token = null;
    try { const s = JSON.parse(localStorage.getItem("llResume") || "null"); if (s && s.room === r) token = s.token; } catch (e) {}
    socket.emit("joinRoom", { name: n, roomId: r, token }, res => {
      if (res.ok) return enter(res);
      $("joinErr").textContent = res.error || "تعذّر الانضمام";
      inviteFailed();
    });
  };
  $("pName").onkeydown = e => { if (e.key === "Enter") ($("pRoom").value.trim() ? $("joinBtn") : $("createBtn")).click(); };
  $("pRoom").onkeydown = e => { if (e.key === "Enter") $("joinBtn").click(); };
  function enter(res) {
    const first = ROOM !== res.roomId;
    ME = res.you; TOKEN = res.token; ROOM = res.roomId;
    try { localStorage.setItem("llResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    if (first && !VIEW) showScreen("lobby");
  }
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("llResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("llResume"); } catch (e) {} return; }
      const back = !!ROOM;
      enter(res);
      if (!back) toast("رجعت للطاولة 👋");
    });
  }
  socket.on("lobby", L => renderLobby(L));
  socket.on("state", v => onState(v));
  socket.on("started", () => {
    ended = false;
    $("endModal").classList.remove("on");
    centerKey = "";
    $("llTable").dataset.ids = "";
    $("llMine").dataset.k = "";
    addMsg("💌 بدأت اللعبة — لعلّ رسالتك تصل!", true);
  });
  socket.on("matchEnd", res => { ended = true; setTimeout(() => { if (ended) onEnd(res); }, 1800); });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", list => { $("msgs").innerHTML = ""; list.forEach(m => addMsg(m, false, true)); });
  socket.on("toast", t => toast(t));
  socket.on("replaced", () => openModal("replacedModal"));
  socket.on("kicked", () => {
    try { localStorage.removeItem("llResume"); } catch (e) {}
    alert("تم إخراجك من الغرفة"); location.href = "/love/";
  });
  $("roomChip").onclick = () => {
    const link = location.origin + "/love/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
