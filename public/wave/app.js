/* 📡 «التخاطر» — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. والهدفُ لا يصله إلا
 * إن كان الوسيطَ قبل أن يكتب (أو عند الكشف) — لا أنّه يصل ويُخفى.
 *
 * العدّاد SVG: نصفُ دائرةٍ (٠ يسارًا عند طرف البطاقة الأيسر و١٨٠ يمينًا)، فوقه
 * منطقةُ الهدف بالباستيل (٢ نعناعيّ، ٣ كهرمانيّ، ٤ ورديّ في المركز)، ثمّ الستارة
 * — نصفُ دائرةٍ تدور حول المركز فتنزل تحت الأفق — ثمّ المؤشر. المؤشرُ يُرسم كلَّ
 * إطار (requestAnimationFrame): يتبع إصبعَ من يسحبه مباشرةً، ويقترب بنعومةٍ من
 * آخر قيمةٍ وصلت من غيره، فيتحرّك عند الجميع بسلاسة.
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
  const TEAM = ["الأزرق", "الوردي"], TCLS = ["tb", "tp"], TICON = ["🔵", "🌸"];
  const CX = 200, CY = 205, R = 182;

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let LOBBY = null, VIEW = null, SKEW = 0, DEFAULTS = null, settings = null;
  let OPTS = { clueSecs: [60, 90, 120, 0], dialSecs: [60, 120, 180, 0], guessSecs: [30, 45, 60, 0], wins: [7, 10, 15] };
  let ended = false, lastTick = -1, actKey = "";

  /* ══════════ أدوات ══════════ */
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.add("on");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2800);
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
  const nameOf = id => { const p = playerOf(id); return p ? p.name : "لاعب"; };
  const teamOfId = id => { const p = playerOf(id); return p ? p.team : 0; };
  const initial = s => (String(s || "؟").trim()[0] || "؟");
  const avatar = (id, name, cls) => '<span class="av ' + TCLS[teamOfId(id)] + (cls ? " " + cls : "") + '" title="' + esc(name) + '">' + esc(initial(name)) + "</span>";
  const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));

  let AC = null, SND = true;
  try { SND = localStorage.getItem("wvSnd") !== "0"; } catch (e) {}
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
      if (kind === "ok") { tone(660, 0, .16, "sine", .09); tone(880, .12, .18, "sine", .09); tone(1320, .26, .32, "sine", .08); }
      else if (kind === "bad") { tone(300, 0, .22, "triangle", .1); tone(200, .18, .34, "triangle", .1); }
      else if (kind === "curtain") { tone(300, 0, .5, "sine", .05); tone(450, .2, .5, "sine", .05); }
      else if (kind === "pop") tone(980, 0, .06, "sine", .05);
      else if (kind === "lock") { tone(400, 0, .07, "square", .04); tone(600, .07, .1, "square", .04); }
      else if (kind === "round") { tone(520, 0, .12, "sine", .07); tone(780, .1, .16, "sine", .07); }
      else if (kind === "tick") tone(1180, 0, .045, "square", .03);
      else tone(440, 0, .1, "sine", .06);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => { SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇"; try { localStorage.setItem("wvSnd", SND ? "1" : "0"); } catch (e) {} };

  /* ══════════ العدّاد ══════════ */
  const rad = a => a * Math.PI / 180;
  const pt = (a, r) => (CX - r * Math.cos(rad(a))).toFixed(2) + " " + (CY - r * Math.sin(rad(a))).toFixed(2);
  const sector = (a1, a2, r) => "M" + CX + " " + CY + " L" + pt(a1, r) + " A" + r + " " + r + " 0 0 1 " + pt(a2, r) + " Z";
  const label = (a, r, t, fill) => { const [x, y] = pt(a, r).split(" "); return '<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="900" fill="' + fill + '">' + t + "</text>"; };
  function buildGauge() {
    const g = $("wvGauge");
    let ticks = "";
    for (let a = 0; a <= 180; a += 15) {
      const [x1, y1] = pt(a, R - 4).split(" "), [x2, y2] = pt(a, R - (a % 45 ? 12 : 18)).split(" ");
      ticks += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#E2D3BC" stroke-width="' + (a % 45 ? 2 : 3) + '" stroke-linecap="round"/>';
    }
    let dots = "";
    for (let a = 12; a < 180; a += 24) for (const r of [60, 110, 155]) { const [x, y] = pt(a + (r === 110 ? 12 : 0), r).split(" "); dots += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#fff" opacity=".45"/>'; }
    g.innerHTML =
      '<defs><clipPath id="wvClip"><rect x="0" y="0" width="400" height="' + (CY + 1) + '"/></clipPath>' +
      '<linearGradient id="wvCurt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9CCFF"/><stop offset="1" stop-color="#B9A3F0"/></linearGradient></defs>' +
      '<path d="' + sector(0, 180, R + 9) + '" fill="#F2E6D6"/>' +
      '<g clip-path="url(#wvClip)">' +
        '<path d="' + sector(0, 180, R) + '" fill="#FFFDF8" stroke="#fff" stroke-width="6"/>' + ticks +
        '<g id="wvTarget" style="display:none">' +
          '<path d="' + sector(75, 105, R - 2) + '" fill="#BDEBD6"/>' +
          '<path d="' + sector(82, 98, R - 2) + '" fill="#FFE08A"/>' +
          '<path d="' + sector(87, 93, R - 2) + '" fill="#FFB3C7"/>' +
          '<path d="M' + CX + " " + CY + " L" + pt(90, R - 2) + '" stroke="#E0577E" stroke-width="2" stroke-dasharray="3 4" opacity=".7"/>' +
          label(78.5, R - 30, "٢", "#2A9A70") + label(85, R - 30, "٣", "#A86A08") + label(90, R - 30, "٤", "#C23A64") +
          label(95, R - 30, "٣", "#A86A08") + label(101.5, R - 30, "٢", "#2A9A70") +
        "</g>" +
        '<g id="wvCurtain"><path d="' + sector(0, 180, R + 2) + '" fill="url(#wvCurt)" stroke="#fff" stroke-width="5"/>' + dots +
          '<text x="' + CX + '" y="' + (CY - 70) + '" text-anchor="middle" font-size="58" font-weight="900" fill="#fff" opacity=".9">؟</text></g>' +
        '<g id="wvNeedle"><line class="stick" x1="' + CX + '" y1="' + CY + '" x2="' + CX + '" y2="' + (CY - R + 14) + '" stroke="#E8553A" stroke-width="7" stroke-linecap="round"/>' +
          '<circle cx="' + CX + '" cy="' + (CY - R + 18) + '" r="11" fill="#fff" stroke="#E8553A" stroke-width="5"/></g>' +
      "</g>" +
      '<rect x="8" y="' + (CY - 2) + '" width="384" height="16" rx="8" fill="#E9DCC8" stroke="#fff" stroke-width="3"/>' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="17" fill="#4A2E2B" stroke="#fff" stroke-width="4"/>';
  }
  buildGauge();

  /* المؤشر: يُرسم كلَّ إطار — مباشرةً تحت إصبع صاحبه، وبنعومةٍ نحو القيمة الواصلة */
  let shown = 90, want = 90, dragging = false, lastSent = 0;
  function paintNeedle() {
    const n = $("wvNeedle");
    if (n) n.setAttribute("transform", "rotate(" + (shown - 90).toFixed(2) + " " + CX + " " + CY + ")");
  }
  function frame() {
    if (!dragging && Math.abs(want - shown) > 0.02) { shown += (want - shown) * 0.28; paintNeedle(); }
    else if (!dragging && shown !== want) { shown = want; paintNeedle(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  paintNeedle();

  const canDial = v => v && v.phase === "dial" && (v.players.find(p => p.id === v.me) || {}).role === "analyst";
  function angleAt(e) {
    const svg = $("wvGauge");
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    let a = Math.atan2(CY - q.y, CX - q.x) * 180 / Math.PI;
    if (a < 0) a = q.x < CX ? 0 : 180;          /* تحت الأفق: أقربُ طرف */
    return clamp(a, 0, 180);
  }
  function sendDial(end) {
    const now = Date.now();
    if (!end && now - lastSent < 40) return;
    lastSent = now;
    socket.emit("dial", { a: Math.round(want * 10) / 10, end: !!end });
  }
  const svgEl = $("wvGauge");
  svgEl.addEventListener("pointerdown", e => {
    if (!canDial(VIEW)) return;
    dragging = true;
    try { svgEl.setPointerCapture(e.pointerId); } catch (x) {}
    try { shown = want = angleAt(e); paintNeedle(); sendDial(); } catch (x) {}
  });
  svgEl.addEventListener("pointermove", e => {
    if (!dragging) return;
    try { shown = want = angleAt(e); paintNeedle(); sendDial(); } catch (x) {}
  });
  const endDrag = () => { if (!dragging) return; dragging = false; sendDial(true); };
  svgEl.addEventListener("pointerup", endDrag);
  svgEl.addEventListener("pointercancel", endDrag);
  /* ضبطٌ دقيق بدرجة (للجوال) */
  $("wvFine").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (!canDial(VIEW)) return;
    want = clamp(Math.round(want) + +b.dataset.d, 0, 180);
    sendDial(true);
  });

  /* ══════════ الشاشات ══════════ */
  function showScreen(which) {
    $("joinScreen").style.display = which === "join" ? "flex" : "none";
    $("game").style.display = which === "join" ? "none" : "flex";
    $("lobby").style.display = which === "lobby" ? "flex" : "none";
    $("play").style.display = which === "play" ? "flex" : "none";
  }
  function toLobby() {
    showScreen("lobby");
    VIEW = null; actKey = "";
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
    const meP = L.players.find(p => p.id === ME);
    const box = $("wvTeams");
    box.innerHTML = "";
    for (let t = 0; t < 2; t++) {
      const ps = L.players.filter(p => p.team === t);
      const n = ps.filter(p => !p.gone).length;
      const col = document.createElement("div");
      col.className = "wvTeamCol " + TCLS[t];
      col.innerHTML = '<div class="hd">' + TICON[t] + " الفريق " + TEAM[t] + " <small>(" + AR(n) + ")</small></div>";
      for (const p of ps) {
        const d = document.createElement("div");
        d.className = "wvLp " + TCLS[t] + (p.id === ME ? " me" : "") + (p.gone ? " gone" : "");
        d.innerHTML = '<span class="av ' + TCLS[t] + '">' + esc(initial(p.name)) + '</span><span class="nm">' + esc(p.name) + "</span>" +
          (p.id === ME ? "<small>أنت</small>" : "") + (p.gone ? "<small>غائب</small>" : "") + (p.host ? '<span class="crown">👑</span>' : "");
        if (host && p.id !== ME) {
          const k = document.createElement("button");
          k.className = "kick"; k.textContent = "✕"; k.title = "إخراج";
          k.onclick = () => { if (confirm("إخراج " + p.name + "؟")) socket.emit("kick", { id: p.id }); };
          d.appendChild(k);
        }
        col.appendChild(d);
      }
      if (!ps.length) col.insertAdjacentHTML("beforeend", '<div class="wvEmpty">لا أحد بعد</div>');
      if (meP && meP.team !== t && n < (L.teamMax || 6)) {
        const j = document.createElement("button");
        j.className = "wvJoinTeam"; j.type = "button";
        j.textContent = "↩️ انتقل إلى " + TEAM[t];
        j.onclick = () => socket.emit("team", { team: t });
        col.appendChild(j);
      }
      box.appendChild(col);
    }
    const here = L.players.filter(p => !p.gone);
    const a = here.filter(p => p.team === 0).length, b = here.filter(p => p.team === 1).length;
    $("plCount").textContent = "(" + AR(here.length) + ")";
    const ready = a >= 2 && b >= 2;
    $("needMore").textContent = ready ? "" : here.length < 4
      ? "تحتاجون ٤ لاعبين على الأقلّ (اثنين في كلّ فريق) — انسخوا رابط الدعوة من الأعلى 🔗"
      : "لكلّ فريقٍ لاعبان على الأقلّ — انتقلوا أو وزّعوا عشوائيًّا";
    $("startBtn").disabled = !ready;
    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    $("lobbySummary").innerHTML = "🎯 الفوز بـ" + AR(settings.win) + " · ⏱️ التلميح " + secsTxt(settings.clueSecs) + " · المؤشر " + secsTxt(settings.dialSecs) +
      " · الخصم " + secsTxt(settings.guessSecs) + (lr ? "<br>🏁 آخر لعبة: فاز " + TICON[lr.winner] + " " + TEAM[lr.winner] + " (" + AR(lr.scores[0]) + "–" + AR(lr.scores[1]) + ")" : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }
  const secsTxt = s => s ? AR(s) + "ث" : "بلا وقت";
  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    const seg = (id, list, fmt) => '<div class="seg" id="' + id + '">' + list.map(v => '<button data-v="' + v + '">' + fmt(v) + "</button>").join("") + "</div>";
    box.innerHTML =
      '<div class="setRow"><label>🎯 النقاطُ للفوز</label>' + seg("sWin", OPTS.wins, v => AR(v)) + "</div>" +
      '<div class="setRow"><label>🔮 وقتُ التلميح</label>' + seg("sClue", OPTS.clueSecs, secsTxt) + '<div class="hint">لم يكتب الوسيطُ في الوقت ⇒ تضيع جولةُ فريقه.</div></div>' +
      '<div class="setRow"><label>🧭 وقتُ المؤشر</label>' + seg("sDial", OPTS.dialSecs, secsTxt) + '<div class="hint">ينتهي الوقتُ فيُثبَّت المؤشرُ حيث هو.</div></div>' +
      '<div class="setRow"><label>🛡️ وقتُ الخصم</label>' + seg("sGuess", OPTS.guessSecs, secsTxt) + "</div>";
    const wire = (id, key) => $(id).querySelectorAll("button").forEach(b => b.onclick = () => push({ [key]: +b.dataset.v }));
    wire("sWin", "win"); wire("sClue", "clueSecs"); wire("sDial", "dialSecs"); wire("sGuess", "guessSecs");
  }
  function push(d) { Object.assign(settings, d); syncSettings(); socket.emit("updateSettings", d); }
  function syncSettings() {
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    on("sWin", settings.win); on("sClue", settings.clueSecs); on("sDial", settings.dialSecs); on("sGuess", settings.guessSecs);
  }
  $("setOpen").onclick = () => $("setBox").classList.toggle("open");
  $("shuffleBtn").onclick = () => socket.emit("shuffle");
  $("startBtn").onclick = () => socket.emit("startGame");

  /* ══════════ الحالة ══════════ */
  function onState(v) {
    VIEW = v;
    SKEW = (v.serverNow || Date.now()) - Date.now();
    if (!ended) showScreen("play");
    for (const e of v.events || []) onEvent(e, v);
    render(v);
  }
  function onEvent(e, v) {
    if (e.t === "round") { snd("round"); addMsg("📡 الجولة " + AR(e.round) + " — الوسيط: " + nameOf(e.psychic) + " (" + TEAM[e.team] + ")", true); }
    else if (e.t === "clue") snd("pop");
    else if (e.t === "locked") snd("lock");
    else if (e.t === "reveal") {
      snd("curtain");
      const mine = v.myTeam === v.cur.team;
      setTimeout(() => snd(e.pts >= 3 ? "ok" : e.pts ? "pop" : "bad"), 700);
      if (e.pts === 4) setTimeout(() => toast("🎯 في المركز تمامًا! +٤"), 900);
    }
    else if (e.t === "psychic") toast("🔁 " + nameOf(e.id) + " صار الوسيط (" + nameOf(e.was) + " غاب)");
    else if (e.t === "timeout") {
      if (e.phase === "clue") toast("⏱️ لم يكتب الوسيطُ في الوقت — ضاعت الجولة");
      else if (e.phase === "dial") toast("⏱️ انتهى الوقت — ثُبّت المؤشرُ حيث هو");
    }
  }
  const meP = v => v.players.find(p => p.id === v.me) || {};
  const roleOf = v => meP(v).role || "";

  function render(v) {
    const C = v.cur;
    $("phaseInfo").textContent = (v.phase !== "over" ? "الجولة " + AR(v.round) + " · " : "") + phaseLine(v);
    renderHud(v);
    renderBanner(v);
    /* العدّاد: البطاقة والتلميح والستارة والهدف والمؤشر */
    $("endL").textContent = C ? C.card.left : "—";
    $("endR").textContent = C ? C.card.right : "—";
    const clue = $("wvClue");
    clue.classList.toggle("empty", !(C && C.clue));
    clue.textContent = C && C.clue ? "«" + C.clue + "»"
      : (v.phase === "clue" ? (C.psychic === v.me ? "✍️ اكتب تلميحك تحت — والهدفُ أمامك" : "🔮 " + nameOf(C.psychic) + " يكتب التلميح…") : "—");
    const g = $("wvGauge");
    const open = C && C.target != null;
    g.classList.toggle("open", !!open);
    g.classList.toggle("can", canDial(v));
    g.classList.toggle("locked", !!(C && C.locked != null));
    g.classList.toggle("noNeedle", v.phase === "clue");
    const tg = $("wvTarget");
    if (open) { tg.style.display = ""; tg.setAttribute("transform", "rotate(" + (C.target - 90) + " " + CX + " " + CY + ")"); }
    else { tg.style.display = "none"; tg.removeAttribute("transform"); }
    if (C && !dragging) want = C.locked != null ? C.locked : C.dial;
    if (v.phase === "clue") { want = shown = 90; paintNeedle(); }
    $("wvFine").classList.toggle("on", canDial(v));
    renderAct(v);
    tickTimer();
  }
  function phaseLine(v) {
    if (v.paused) return "⏸️ بانتظار عودة اللاعبين…";
    const C = v.cur, r = roleOf(v);
    switch (v.phase) {
      case "clue": return r === "psychic" ? "🔮 اكتب تلميحك" : "⏳ الوسيطُ يكتب";
      case "dial": return r === "analyst" ? "🧭 حرّكوا المؤشر" : "🧭 فريقُ " + TEAM[C.team] + " يحرّك المؤشر";
      case "guess": return r === "opponent" ? "🛡️ يسارًا أم يمينًا؟" : "🛡️ الخصمُ يخمّن";
      case "reveal": return "🎯 الكشف";
      case "over": return "🏁 انتهت اللعبة";
      default: return "…";
    }
  }
  function renderHud(v) {
    for (let t = 0; t < 2; t++) {
      const el = $(t === 0 ? "scoreA" : "scoreB");
      el.className = "wvScore " + TCLS[t] + (t === v.myTeam ? " mine" : "") + (v.cur && v.cur.team === t && v.phase !== "over" ? " turn" : "");
      el.innerHTML = TICON[t] + " " + TEAM[t] + (t === v.myTeam ? " (أنت)" : "") + " <b>" + AR(v.scores[t]) + "</b>/" + AR(v.win);
    }
    $("wvRound").textContent = "الجولة " + AR(v.round);
  }
  function renderBanner(v) {
    const C = v.cur, r = roleOf(v);
    const ROLE = { psychic: "🔮 أنت الوسيط هذه الجولة", analyst: "🧭 أنت محلّلٌ في فريق الدور", opponent: "🛡️ أنت في الفريق الخصم هذه الجولة" };
    $("wvBanner").querySelector(".tt").textContent = v.paused ? "⏸️ توقّفت الساعة — فريقٌ لا حاضرَ فيه" : (ROLE[r] || "");
    const box = $("wvStrip");
    const want = v.players.map(p => p.id).join(",");
    if (box.dataset.ids !== want) {
      box.dataset.ids = want;
      box.innerHTML = "";
      for (const t of [0, 1]) for (const p of v.players.filter(x => x.team === t)) {
        const d = document.createElement("div");
        d.dataset.id = p.id;
        d.innerHTML = avatar(p.id, p.name) + '<span class="nm">' + esc(p.name) + '</span><span class="role"></span><div class="bub"></div>';
        box.appendChild(d);
      }
    }
    for (const d of box.children) {
      const p = v.players.find(x => x.id === d.dataset.id);
      if (!p) continue;
      const voted = C && C.votes.some(x => x.id === p.id);
      const done = (v.phase === "dial" && p.ok) || (v.phase === "guess" && voted) || (v.phase === "reveal" && p.ready);
      d.className = "wvMate " + TCLS[p.team] + (p.id === v.me ? " me" : "") + (p.on ? "" : " off") + (done ? " done" : "");
      d.querySelector(".role").textContent = p.role === "psychic" ? "🔮" : "";
    }
  }

  /* ── لوحةُ الفعل ── */
  function renderAct(v) {
    const box = $("wvAct"), C = v.cur, r = roleOf(v);
    const key = [v.round, v.phase, r, v.paused ? 1 : 0].join("|");
    const build = key !== actKey;
    actKey = key;
    if (v.phase === "clue") {
      if (r === "psychic") {
        if (build) {
          box.innerHTML = '<div class="tt">🔮 الهدفُ أمامك — والستارةُ مفتوحةٌ لك وحدك</div>' +
            '<div class="ss" id="wvClueHint"></div>' +
            '<div class="wvClueBox"><input class="wvClueIn" id="clueIn" maxlength="60" autocomplete="off" placeholder="تلميحُك…">' +
            '<button class="btn btn-green" id="clueSend" type="button">إرسال 📡</button></div>' +
            '<button class="btn btn-ghost" id="rerollBtn" type="button" style="width:auto; padding:9px 18px">🔄 بطاقةٌ أخرى</button>';
          const send = () => { const t = $("clueIn").value.trim(); if (!t) return toast("اكتب تلميحًا"); $("clueSend").disabled = true; socket.emit("clue", { text: t }); setTimeout(() => { const b = $("clueSend"); if (b) b.disabled = false; }, 1500); };
          $("clueSend").onclick = send;
          $("clueIn").onkeydown = e => { if (e.key === "Enter") send(); };
          $("rerollBtn").onclick = () => socket.emit("reroll");
          setTimeout(() => { try { $("clueIn").focus(); } catch (e) {} }, 60);
        }
        $("wvClueHint").textContent = "اكتب ما يدلّ على مكان المنطقة الورديّة بين «" + C.card.left + "» و«" + C.card.right + "»";
        const rb = $("rerollBtn");
        rb.textContent = "🔄 بطاقةٌ أخرى (" + AR(C.rerollsLeft) + ")";
        rb.disabled = C.rerollsLeft <= 0;
      } else if (build) {
        box.innerHTML = '<div class="tt">⏳ ' + esc(nameOf(C.psychic)) + " يتأمّل الهدف…</div>" +
          '<div class="ss">' + (r === "analyst" ? "بعد التلميح تحرّكون المؤشر معًا" : "بعد أن يثبّتوا المؤشر تخمّنون: الهدفُ يسارَه أم يمينَه؟") + "</div>";
      }
    } else if (v.phase === "dial") {
      if (r === "analyst") {
        const eds = v.players.filter(p => p.role === "analyst" && p.on);
        const mine = meP(v).ok;
        box.innerHTML = '<div class="tt">🧭 اسحبوا المؤشر حيث يقصد ' + esc(nameOf(C.psychic)) + "</div>" +
          '<div class="ss">يتحرّك عند الجميع حيًّا — وأيُّ تحريكٍ يُسقط الموافقات</div>' +
          '<div class="wvAgree"><span class="who">' + eds.map(p => avatar(p.id, p.name, p.ok ? "ok" : "")).join("") + "</span>" +
          '<button class="btn ' + (mine ? "btn-ghost" : "btn-green") + '" id="agreeBtn" type="button" data-on="' + (mine ? 0 : 1) + '">' + (mine ? "↩️ تراجع" : "✓ موافق — ثبّتوه") + "</button>" +
          '<span class="ss">' + AR(eds.filter(p => p.ok).length) + "/" + AR(eds.length) + " وافقوا</span></div>";
        $("agreeBtn").onclick = () => { $("agreeBtn").disabled = true; socket.emit("agree", { on: $("agreeBtn").dataset.on === "1" }); };
      } else if (build || true) {
        box.innerHTML = r === "psychic"
          ? '<div class="tt">🤐 فريقُك يحرّك المؤشر — راقب بصمت</div><div class="ss">الستارةُ أُغلقت عليك أيضًا: لا تلميحَ بعد الآن</div>'
          : '<div class="tt">⏳ فريقُ ' + TEAM[C.team] + " يحرّك المؤشر…</div><div class=\"ss\">جهّزوا رأيكم: هل سيقع الهدفُ يسارَ مؤشرهم أم يمينَه؟</div>";
      }
    } else if (v.phase === "guess") {
      const L = C.votes.filter(x => x.side === "left").length, Rn = C.votes.length - L;
      const my = (C.votes.find(x => x.id === v.me) || {}).side;
      if (r === "opponent") {
        box.innerHTML = '<div class="tt">🛡️ الهدفُ يسارَ المؤشر أم يمينَه؟</div>' +
          '<div class="wvVote ' + TCLS[v.myTeam] + '"><button class="btn btn-blue' + (my === "left" ? " on" : "") + '" type="button" data-s="left">⬅️ يسارَه<small>نحو «' + esc(C.card.left) + "» · " + AR(L) + " صوت</small></button>" +
          '<button class="btn btn-violet' + (my === "right" ? " on" : "") + '" type="button" data-s="right">يمينَه ➡️<small>نحو «' + esc(C.card.right) + "» · " + AR(Rn) + " صوت</small></button></div>" +
          '<div class="ss">بالأغلبيّة — والتعادلُ لأوّل من صوّت. أصبتم ولم يصب الفريقُ المركز ⇒ نقطةٌ لكم</div>';
        box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => socket.emit("vote", { side: b.dataset.s }));
      } else {
        box.innerHTML = '<div class="tt">🔒 ثُبّت المؤشر — الخصمُ يصوّت</div><div class="ss">⬅️ يسار: ' + AR(L) + " · يمين ➡️: " + AR(Rn) + "</div>";
      }
    } else if (v.phase === "reveal" || v.phase === "over") {
      const res = C.result || {};
      const t = C.team, o = 1 - t;
      let h;
      if (res.skipped) h = '<div class="tt">⏭️ لم يكتب الوسيطُ في الوقت — ضاعت جولةُ ' + TEAM[t] + "</div>";
      else {
        const zone = { 4: "🎯 في المركز!", 3: "قريبٌ جدًّا", 2: "على الطرف" }[res.pts] || "خارج الهدف";
        h = '<div class="wvRes"><div class="wvPts ' + TCLS[t] + (res.pts ? "" : " zero") + '">+' + AR(res.pts) + " " + TEAM[t] + "<small>" + zone + " · على بُعد " + AR(res.diff) + "°</small></div>" +
          '<div class="wvPts ' + TCLS[o] + (res.opp ? "" : " zero") + '">+' + AR(res.opp) + " " + TEAM[o] + "<small>" +
            (C.guess ? (res.opp ? "أصاب الاتّجاه" : res.pts === 4 ? "المركز لا يُخمَّن عليه" : "أخطأ الاتّجاه") + " (" + (C.guess === "left" ? "⬅️ يسار" : "يمين ➡️") + ")" : "لم يخمّن") + "</small></div></div>";
      }
      if (v.phase === "reveal") {
        const on = v.players.filter(p => p.on), me = meP(v);
        h += '<button class="btn btn-violet" id="nextBtn" type="button" style="width:auto; padding:10px 28px"' + (me.ready ? " disabled" : "") + ">" +
          (me.ready ? "✓ بانتظار البقيّة (" + AR(on.filter(p => p.ready).length) + "/" + AR(on.length) + ")" : "التالي ▶") + "</button>";
      }
      box.innerHTML = h;
      const nb = $("nextBtn");
      if (nb) nb.onclick = () => { nb.disabled = true; socket.emit("next"); };
    }
  }

  function tickTimer() {
    const v = VIEW;
    const bar = $("tbar"), sec = $("tsec");
    if (!v || v.phase === "over" || v.paused || !v.deadline) {
      bar.firstElementChild.style.width = v && v.paused ? "100%" : "0%";
      bar.classList.toggle("paused", !!(v && v.paused));
      bar.classList.toggle("none", !!(v && !v.paused && v.phase !== "over" && !v.deadline));
      bar.classList.remove("hurry");
      sec.textContent = v && v.paused ? "⏸️" : v && v.phase !== "over" && !v.deadline ? "∞" : "—";
      return;
    }
    bar.classList.remove("paused", "none");
    const left = Math.max(0, v.deadline - (Date.now() + SKEW));
    bar.firstElementChild.style.width = Math.max(0, Math.min(100, left / (v.span || 1) * 100)).toFixed(1) + "%";
    const s = Math.ceil(left / 1000);
    sec.textContent = AR(s);
    const hurry = left <= 8000 && v.phase !== "reveal";
    bar.classList.toggle("hurry", hurry);
    const r = roleOf(v);
    const mine = (v.phase === "clue" && r === "psychic") || (v.phase === "dial" && r === "analyst") || (v.phase === "guess" && r === "opponent");
    if (hurry && s !== lastTick && s > 0 && s <= 5 && mine) { lastTick = s; snd("tick"); }
  }
  setInterval(tickTimer, 200);

  /* ══════════ القواعد ══════════ */
  function rulesHTML() {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    return r("📡 الفكرة", "فريقان يتناوبان. في كلّ جولةٍ يلعب فريقٌ واحد: منه «وسيطٌ» يتناوب، والبقيّةُ «محلّلون»، والفريقُ الآخر «خصم». على الشاشة بطاقةٌ بطرفين متعاكسين (رخيص ↔ غالٍ) ونصفُ دائرةٍ بينهما.") +
      r("🔮 ١) الوسيط", "يرى وحده منطقةَ الهدف المخفيّة على نصف الدائرة، فيكتب تلميحًا يدلّ على موقعها بين الطرفين (مثلًا «قهوة المطار» قربَ «غالٍ»). يستطيع تبديل البطاقة مرّتين. ثمّ تُغلق الستارةُ عليه أيضًا.") +
      r("🧭 ٢) المحلّلون", "يسحبون المؤشر حيث يظنّون الهدف — يتحرّك عند الجميع حيًّا — ثمّ يوافقون جميعًا فيُثبَّت. وأيُّ تحريكٍ يُسقط الموافقات.") +
      r("🛡️ ٣) الخصم", "يصوّت: مركزُ الهدف يسارَ المؤشر أم يمينَه؟ بالأغلبيّة، والتعادلُ لأوّل من صوّت.") +
      r("🎯 ٤) الكشف", "تُفتح الستارة: المركز الورديّ ٤ نقاط، الكهرمانيّ ٣، النعناعيّ ٢، وخارجها لا شيء. وإن لم يصب الفريقُ المركز وأصاب الخصمُ الاتّجاه ⇒ نقطةٌ للخصم.") +
      r("🏆 الفوز", "أوّلُ فريقٍ يبلغ الهدف (١٠ افتراضًا) يفوز. وإن بلغاه معًا فالأعلى، والتعادلُ يُكمل اللعب.");
  }
  $("rulesBtn").onclick = () => { $("rulesBody").innerHTML = rulesHTML(); openModal("rulesModal"); };

  /* ══════════ النهاية ══════════ */
  function onEnd(res) {
    const myT = VIEW ? VIEW.myTeam : teamOfId(ME);
    const w = res.winner;
    const win = $("endWin");
    win.className = "wvWin " + TCLS[w];
    win.innerHTML = '<div class="ic">' + (w === myT ? "🏆" : "📡") + '</div><div class="ar">' + (w === myT ? "فاز فريقُك — " : "فاز ") + TICON[w] + " " + TEAM[w] + "</div>" +
      '<div class="ln">' + TICON[0] + " " + AR(res.scores[0]) + " — " + AR(res.scores[1]) + " " + TICON[1] + "</div>";
    const names = res.names || {};
    $("endHist").innerHTML = (res.history || []).map(h => '<div class="hrow ' + TCLS[h.team] + '"><span class="tag">' + AR(h.round) + " · " + esc(names[h.psychic] || "") + "</span>" +
      "<span>" + esc(h.card.left) + " ↔ " + esc(h.card.right) + (h.clue ? " — «" + esc(h.clue) + "»" : " — ⏭️") + '</span><span class="pts">+' + AR(h.pts || 0) + (h.opp ? " / +" + AR(h.opp) : "") + "</span></div>").join("") ||
      '<div class="sub">لا جولات</div>';
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(w === myT ? "ok" : "round");
  }
  onClose.endModal = () => { if (!ended) return; ended = false; if (!LOBBY || !LOBBY.playing) toLobby(); };
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  function leaveNow() {
    try { localStorage.removeItem("wvResume"); } catch (e) {}
    try { socket.emit("leaveRoom"); } catch (e) {}
    setTimeout(() => { location.href = "/"; }, 150);
  }
  $("leaveBtn").onclick = () => { if (VIEW && VIEW.phase !== "over" && !ended) openModal("leaveModal"); else leaveNow(); };
  $("leaveYes").onclick = leaveNow;
  $("endLeave").onclick = leaveNow;

  /* ══════════ الدردشة ══════════ */
  const PHRASES = ["السلام عليكم 👋", "يلا يا فريق 💪", "تلميح عبقري 🧠", "أحسنت! 👏",
                   "يمين أكثر ➡️", "يسار أكثر ⬅️", "هنا بالضبط 🎯", "هههههه 😂",
                   "ما فهمت 🤔", "قريب جدًّا! 🔥", "مشكورين 🙏", "موافق ✅"];
  const EMOJI = ["😂", "😎", "😍", "🤯", "😭", "🥳", "😱", "🤔", "👍", "👏", "🔥", "💪", "🤝", "🙈", "🧠", "📡"];
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
  function paintUnread() { const u = $("unread"); u.textContent = unread > 9 ? "+٩" : AR(unread); u.classList.toggle("on", unread > 0); }
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
    const chip = document.querySelector('#wvStrip [data-id="' + id + '"]');
    if (!chip) return;
    const b = chip.querySelector(".bub");
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
    else { d.innerHTML = "<b>" + esc(m.name) + ":</b> " + esc(m.text); d.querySelector("b").style.color = teamOfId(m.id) === 1 ? "var(--pkd)" : "var(--bld)"; }
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
  socket = io("/wave");
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
    OPTS = { clueSecs: h.clueSecs || OPTS.clueSecs, dialSecs: h.dialSecs || OPTS.dialSecs, guessSecs: h.guessSecs || OPTS.guessSecs, wins: h.wins || OPTS.wins };
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
    try { const s = JSON.parse(localStorage.getItem("wvResume") || "null"); if (s && s.room === r) token = s.token; } catch (e) {}
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
    try { localStorage.setItem("wvResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    if (first && !VIEW) showScreen("lobby");
  }
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("wvResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("wvResume"); } catch (e) {} return; }
      const back = !!ROOM;
      enter(res);
      if (!back) toast("رجعت للغرفة 👋");
    });
  }
  socket.on("lobby", L => renderLobby(L));
  socket.on("state", v => onState(v));
  /* المؤشرُ الحيّ: من غيري (ومن نفسي إن لم أكن أسحب الآن) */
  socket.on("dial", d => {
    if (!VIEW || !VIEW.cur || VIEW.phase !== "dial") return;
    if (dragging && d.by === ME) return;
    VIEW.cur.dial = d.a;
    if (!dragging) want = d.a;
  });
  socket.on("started", () => {
    ended = false;
    $("endModal").classList.remove("on");
    actKey = ""; $("wvStrip").dataset.ids = "";
    addMsg("📡 بدأت اللعبة — بالتوفيق!", true);
  });
  socket.on("matchEnd", res => { ended = true; setTimeout(() => { if (ended) onEnd(res); }, 1600); });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", list => { $("msgs").innerHTML = ""; list.forEach(m => addMsg(m, false, true)); });
  socket.on("toast", t => toast(t));
  socket.on("replaced", () => openModal("replacedModal"));
  socket.on("kicked", () => { try { localStorage.removeItem("wvResume"); } catch (e) {} alert("تم إخراجك من الغرفة"); location.href = "/wave/"; });
  $("roomChip").onclick = () => {
    const link = location.origin + "/wave/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
