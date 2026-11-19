/* 🌶️ «البسكويتة الحارّة» — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. وما يصله محجوبٌ على
 * الخادم أصلًا — أنواعُ ماكارونات غيري المقلوبة لا تصلني، لا أنّها تصل وتُخفى.
 *
 * الطاولة: مساحاتُ الخصوم فوق (لكلٍّ يدُه مقلوبةً وكومتُه ونجومُه)، ولوحةُ
 * الفعل في الوسط (الوضع، أو الإضافة والتحدّي، أو المزاد، أو الكشف)، ومساحتي
 * تحت بيدي مكشوفةً لي. والماكارونةُ وجهان تنقلب بينهما بـ rotateY — وكلُّ
 * ماكارونةٍ تُقلب أوّلَ مرّةٍ تُرسم مقلوبةً ثمّ تنقلب أمام العين، والحارّةُ
 * تهزّ الشاشة.
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);

  /* لكلّ مقعدٍ لونُ ماكاروناته (فاتحٌ وغامق) */
  const PAL = [
    { l: "#FFC6D5", d: "#E0577E" }, { l: "#BDEBD6", d: "#2E9E73" }, { l: "#D9CCFF", d: "#7A5CD0" },
    { l: "#FFD9B3", d: "#D9852E" }, { l: "#C4E3FA", d: "#3F8ED0" }, { l: "#FFEFA6", d: "#C9A20E" }
  ];
  const palOf = seat => PAL[(seat || 0) % PAL.length];

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let LOBBY = null, VIEW = null, SKEW = 0, DEFAULTS = null, settings = null;
  let OPTS = { turnSecs: [15, 25, 40], min: 3, max: 6 };
  let ended = false, lastTick = -1, bidN = 1, bidFor = "", centerKey = "";
  const flipped = new Set();          /* ماكاروناتٌ رأيناها تنقلب (فلا تنقلب ثانيةً مع كلّ رسم) */

  /* ══════════ الماكارونة: رسمٌ مستقلٌّ بلا خطوطٍ ولا محارف ══════════ */
  const base = (l, d) =>
    '<circle cx="32" cy="34" r="28" fill="' + d + '" opacity=".35"/>' +
    '<circle cx="32" cy="31" r="28" fill="' + l + '" stroke="#fff" stroke-width="3"/>' +
    '<circle cx="32" cy="31" r="22.5" fill="none" stroke="' + d + '" stroke-width="2" stroke-dasharray="1.5 3.2" stroke-linecap="round" opacity=".5"/>' +
    '<path d="M18 21 q7 -8 17 -6" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".75"/>';
  function svgBack(seat) {
    const c = palOf(seat);
    return '<svg viewBox="0 0 64 64">' + base(c.l, c.d) +
      '<path d="M32 22 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4z" fill="#fff" opacity=".85"/></svg>';
  }
  function svgSafe(seat) {
    const c = palOf(seat);
    return '<svg viewBox="0 0 64 64">' + base(c.l, c.d) +
      '<ellipse cx="19.5" cy="35" rx="3.6" ry="2.2" fill="' + c.d + '" opacity=".35"/><ellipse cx="44.5" cy="35" rx="3.6" ry="2.2" fill="' + c.d + '" opacity=".35"/>' +
      '<circle cx="25" cy="30" r="2.7" fill="#4A2E2B"/><circle cx="39" cy="30" r="2.7" fill="#4A2E2B"/>' +
      '<circle cx="25.9" cy="29.1" r=".9" fill="#fff"/><circle cx="39.9" cy="29.1" r=".9" fill="#fff"/>' +
      '<path d="M27 35.5 q5 4.6 10 0" stroke="#4A2E2B" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';
  }
  function svgTrap() {
    return '<svg viewBox="0 0 64 64">' + base("#FF9A7E", "#C8321F") +
      /* فلفلةٌ حمراءُ بعودٍ أخضر، وعليها وجهٌ مندهش، وفوقها بخار */
      '<path d="M19 41 C 26 47, 41 44, 46 27 C 47.5 22.5, 43.5 20.5, 41.5 24 C 38 33, 30 37.5, 21.5 37.5 C 18.5 37.5, 17 39.5, 19 41 Z" fill="#E8302A" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M42.5 23.5 q1.5 -6.5 7 -6.5" stroke="#2E9E5B" stroke-width="3.4" fill="none" stroke-linecap="round"/>' +
      '<circle cx="31" cy="36.5" r="1.9" fill="#fff"/><circle cx="37.5" cy="33" r="1.9" fill="#fff"/>' +
      '<ellipse cx="35" cy="38.6" rx="1.8" ry="2.3" fill="#7A1410"/>' +
      '<path d="M22 17 q-2 -4 1 -7 M28 15 q-2 -4 1 -7" stroke="#C8321F" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/></svg>';
  }
  const front = (t, seat) => t === "trap" ? svgTrap() : svgSafe(seat);
  /** ماكارونة: ظهرٌ ووجه، و«up» تعني أنّ الوجهَ ظاهر */
  function macHTML(o) {
    const cls = "mac" + (o.cls ? " " + o.cls : "") + (o.up ? " up" : "");
    return '<div class="' + cls + '"' + (o.k ? ' data-k="' + o.k + '"' : "") + (o.style ? ' style="' + o.style + '"' : "") + ">" +
      '<div class="in"><div class="fc back">' + svgBack(o.seat) + '</div><div class="fc front">' + (o.t ? front(o.t, o.seat) : "") + "</div></div>" +
      (o.peek ? '<span class="peek" title="لا يراها غيرُك">🙈</span>' : "") + "</div>";
  }

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
  const seatOf = id => { const p = VIEW && VIEW.players.find(x => x.id === id); return p ? p.seat : 0; };
  const initial = s => (String(s || "؟").trim()[0] || "؟");
  const avatar = (id, name, seat) => '<span class="av" style="--sd:' + palOf(seat).d + '">' + esc(initial(name)) + "</span>";
  const starsHTML = n => '<span class="spStars">' + [0, 1].map(i => '<i class="' + (n > i ? "on" : "") + '">⭐</i>').join("") + "</span>";

  /* أصواتٌ مركّبة */
  let AC = null, SND = true;
  try { SND = localStorage.getItem("spSnd") !== "0"; } catch (e) {}
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
      else if (kind === "bad") { tone(220, 0, .25, "sawtooth", .07); tone(150, .2, .4, "sawtooth", .07); }
      else if (kind === "flip") tone(760, 0, .07, "triangle", .07);
      else if (kind === "pop") tone(980, 0, .06, "sine", .05);
      else if (kind === "bid") { tone(520, 0, .09, "square", .04); tone(700, .08, .1, "square", .04); }
      else if (kind === "round") { tone(520, 0, .12, "sine", .07); tone(780, .1, .16, "sine", .07); }
      else if (kind === "tick") tone(1180, 0, .045, "square", .03);
      else tone(440, 0, .1, "sine", .06);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => {
    SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇";
    try { localStorage.setItem("spSnd", SND ? "1" : "0"); } catch (e) {}
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
      d.className = "spLp" + (p.id === ME ? " me" : "") + (p.gone ? " gone" : "");
      d.innerHTML = avatar(p.id, p.name, i) + '<span class="nm">' + esc(p.name) + "</span>" +
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
    for (let i = 0; i < bots; i++) pl.insertAdjacentHTML("beforeend", '<div class="spLp botSlot"><span class="av" style="--sd:#B9A99A">🤖</span><span class="nm">بوت</span></div>');
    $("plCount").textContent = "(" + AR(n + bots) + "/" + AR(L.max) + ")";
    const can = n + bots >= L.min;
    $("needMore").textContent = can ? "" : "تحتاجون " + AR(L.min) + " لاعبين على الأقلّ — فعّلوا البوتات أو انسخوا رابط الدعوة 🔗";
    $("startBtn").disabled = !can;
    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    $("lobbySummary").innerHTML = "🍪 الطاولة " + AR(S.bots ? Math.max(S.seats, n) : n) + (S.bots ? " (تكملها البوتات)" : " (بلا بوتات)") +
      " · ⏱️ " + AR(S.turnSecs) + "ث للخطوة" + (lr ? "<br>🏁 آخر لعبة: فاز " + esc(lr.winnerName || "") + " ⭐" : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }
  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    const seg = (id, list, fmt) => '<div class="seg" id="' + id + '">' + list.map(v => '<button data-v="' + v + '">' + fmt(v) + "</button>").join("") + "</div>";
    box.innerHTML =
      '<div class="setRow"><label>🍪 حجم الطاولة</label>' + seg("sSeats", [3, 4, 5, 6], v => AR(v)) +
        '<div class="hint">تكمل البوتاتُ المقاعدَ الفارغة إلى هذا العدد (إن كانت مفعّلة).</div></div>' +
      '<div class="setRow"><label>🤖 البوتات</label>' + seg("sBots", ["1", "0"], v => v === "1" ? "تشغيل" : "إيقاف") + "</div>" +
      '<div class="setRow"><label>⏱️ وقتُ كلّ خطوة</label>' + seg("sTurn", OPTS.turnSecs, v => AR(v) + "ث") +
        '<div class="hint">ينتهي الوقتُ فيُفعل عنك: وضعٌ عشوائيّ، أو إضافة، أو انسحاب، أو قلب.</div></div>';
    $("sSeats").querySelectorAll("button").forEach(b => b.onclick = () => push({ seats: +b.dataset.v }));
    $("sBots").querySelectorAll("button").forEach(b => b.onclick = () => push({ bots: b.dataset.v === "1" }));
    $("sTurn").querySelectorAll("button").forEach(b => b.onclick = () => push({ turnSecs: +b.dataset.v }));
  }
  function push(d) { Object.assign(settings, d); syncSettings(); socket.emit("updateSettings", d); }
  function syncSettings() {
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    on("sSeats", settings.seats); on("sBots", settings.bots ? "1" : "0"); on("sTurn", settings.turnSecs);
  }
  $("setOpen").onclick = () => $("setBox").classList.toggle("open");
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
    if (e.t === "round") { snd("round"); flipped.clear(); addMsg("🍪 الجولة " + AR(e.round) + " — يبدؤها " + nameOf(e.starter), true); }
    else if (e.t === "placed") snd("pop");
    else if (e.t === "auction") { snd("bid"); addMsg("🔥 " + nameOf(e.by) + " فتح المزاد: " + AR(e.amount), true); }
    else if (e.t === "raise") snd("bid");
    else if (e.t === "flip") {
      snd("flip");
      /* الحارّة: تنقلب أوّلًا ثمّ تهتزّ الشاشة */
      if (e.kind === "trap") setTimeout(() => {
        document.body.classList.remove("shake"); void document.body.offsetWidth;
        document.body.classList.add("shake"); $("spBurst").classList.add("on");
        setTimeout(() => { document.body.classList.remove("shake"); $("spBurst").classList.remove("on"); }, 600);
        snd("bad");
      }, 380);
    }
    else if (e.t === "success") { setTimeout(() => snd("ok"), 300); }
    else if (e.t === "lost") toast(e.kind === "trap" ? "🌶️ خسرت ماكارونتَك الحارّة — لا يعرف ذلك غيرُك" : "🍪 خسرت ماكارونةً لذيذة — لا يعرف ذلك غيرُك");
    else if (e.t === "eliminated") toast(e.id === v.me ? "🚫 نفدت ماكاروناتك — خرجت من اللعبة" : "🚫 خرج " + nameOf(e.id) + " — نفدت ماكاروناته");
  }

  const meP = v => v.players.find(p => p.id === v.me) || {};
  const waiting = v => v.phase === "placement" ? v.players.filter(p => !p.out && !p.stack.length).map(p => p.id)
    : (["action", "auction", "reveal"].includes(v.phase) && v.turn ? [v.turn] : []);
  const myTurn = v => waiting(v).includes(v.me);

  function render(v) {
    $("phaseInfo").textContent = (v.phase !== "over" ? "الجولة " + AR(v.round) + " · " : "") + phaseLine(v);
    renderHud(v);
    renderTable(v);
    renderMine(v);
    renderCenter(v);
    animateFlips();
    tickTimer();
  }
  function phaseLine(v) {
    if (v.paused) return "⏸️ بانتظار عودة اللاعبين…";
    const t = nameOf(v.turn), mine = myTurn(v);
    switch (v.phase) {
      case "placement": return mine ? "🍪 ضع ماكارونتك" : "⏳ الجميعُ يضعون";
      case "action": return mine ? "➕ أضف أو تحدَّ" : "⏳ دورُ " + t;
      case "auction": return mine ? "🔥 ارفع أو انسحب" : "🔥 المزاد — دورُ " + t;
      case "reveal": return "🎯 " + nameOf(v.bid.id) + " يقلب " + AR(v.bid.amount);
      case "result": return v.result && v.result.ok ? "⭐ نجح التحدّي" : "🌶️ حارّة!";
      case "over": return "🏁 انتهت اللعبة";
      default: return "…";
    }
  }
  function renderHud(v) {
    $("hRound").textContent = AR(v.round);
    $("hTotal").innerHTML = "على الطاولة <b>" + AR(v.total) + "</b>";
    const hb = $("hBid");
    hb.className = "spStat" + (v.bid ? " hot" : "");
    hb.innerHTML = v.bid ? "🔥 المزاد <b>" + AR(v.bid.amount) + "</b> — " + esc(nameOf(v.bid.id)) : "لا مزاد بعد";
  }

  /* ── مساحاتُ الخصوم: بترتيب الجلوس بدءًا بمن بعدي (اتّجاه الساعة) ── */
  function others(v) {
    const ps = v.players, i = ps.findIndex(p => p.id === v.me);
    return ps.slice(i + 1).concat(ps.slice(0, i));
  }
  function tagsOf(v, p) {
    const t = [];
    if (p.out) t.push('<span class="spTag out">🚫 خرج</span>');
    else if (v.bid && v.bid.id === p.id) t.push('<span class="spTag bid">' + (v.phase === "reveal" || v.phase === "result" ? "🎯 المتحدّي" : "🔥 الأعلى") + "</span>");
    else if (p.status === "passed") t.push('<span class="spTag pass">✋ انسحب</span>');
    if (v.starter === p.id && v.phase === "placement") t.push('<span class="spTag">▶️ يبدأ</span>');
    return t.join("");
  }
  function stackHTML(v, p, sm) {
    const n = p.stack.length;
    return '<div class="spStack" data-owner="' + p.id + '" style="--n:' + Math.max(1, n) + (sm ? "; --mac:" + (sm) + "px" : "") + '">' +
      p.stack.map((d, i) => {
        const k = v.round + ":" + p.id + ":" + i;
        const mine = p.id === v.me;
        /* المقلوبةُ أوّلَ مرّة تُرسم بظهرها ثمّ تنقلب (animateFlips) */
        const up = mine ? true : (d.up || (d.t && v.phase === "over")) && flipped.has(k);
        return macHTML({ seat: p.seat, t: d.t, up, k: (d.up || (d.t && v.phase === "over")) ? k : "", cls: mine && !d.up ? "mineDown" : "",
                         peek: mine && !d.up && v.phase !== "over", style: "--i:" + i });
      }).join("") + "</div>";
  }
  function renderTable(v) {
    const box = $("spTable");
    const list = others(v);
    const want = list.map(p => p.id).join(",");
    if (box.dataset.ids !== want) {
      box.dataset.ids = want;
      box.innerHTML = "";
      for (const p of list) {
        const d = document.createElement("div");
        d.dataset.id = p.id;
        d.style.setProperty("--sd", palOf(p.seat).d); d.style.setProperty("--sl", palOf(p.seat).l);
        d.innerHTML = '<div class="bub"></div><div class="mat"></div>';
        d.addEventListener("click", () => tryFlip(p.id));
        box.appendChild(d);
      }
    }
    const wait = waiting(v);
    for (const d of box.children) {
      const p = v.players.find(x => x.id === d.dataset.id);
      if (!p) continue;
      const can = v.flippable.includes(p.id);
      d.className = "spMat" + (wait.includes(p.id) ? " turn" : "") + (p.status === "passed" ? " passed" : "") + (p.out ? " out" : "") + (can ? " can" : "");
      const lost = Math.max(0, 4 - p.owned);
      d.querySelector(".mat").innerHTML =
        '<div class="hd">' + avatar(p.id, p.name, p.seat) + '<span class="nm">' + esc(p.name) + "</span>" + starsHTML(p.stars) + "</div>" +
        '<div style="display:flex; gap:4px; flex-wrap:wrap">' + tagsOf(v, p) + "</div>" +
        '<div class="spBody"><div class="spHand"><span class="spHandLbl">في اليد ' + AR(p.handN) + (lost ? " · خسر " + AR(lost) : "") + "</span>" +
          '<span class="slot"></span>'.repeat(p.handN) + '<span class="slot gone"></span>'.repeat(lost) + "</div>" +
          stackHTML(v, p) + "</div>";
    }
  }

  /* ── مساحتي: يدي مكشوفةٌ لي، وكومتي ── */
  function renderMine(v) {
    const me = meP(v);
    const box = $("spMine");
    const wait = waiting(v);
    const canFlip = v.flippable.includes(v.me);
    box.className = "card" + (wait.includes(v.me) ? " turn" : "") + (canFlip ? " can" : "");
    box.style.setProperty("--sd", palOf(me.seat).d); box.style.setProperty("--sl", palOf(me.seat).l);
    const canPlace = (v.phase === "placement" && !me.stack.length && !me.out) || (v.phase === "action" && v.turn === v.me && (me.hand || []).length);
    const lost = Array.isArray(me.lost) ? me.lost : [];
    /* فقاعةُ الدردشة باقيةٌ بين الرسمات (لا تُمحى مع كلّ حالة) */
    if (!box.querySelector(".mi")) box.innerHTML = '<div class="bub"></div><div class="mi"></div>';
    const mi = box.querySelector(".mi");
    mi.innerHTML = '<div class="hd">' + avatar(me.id, me.name, me.seat) + '<span class="nm">' + esc(me.name) + " (أنت)</span>" +
      starsHTML(me.stars) + tagsOf(v, me) +
      (lost.length ? '<span class="spTag" title="لا يعرف نوعَها غيرُك">خسرتَ: ' + lost.map(l => l.t === "trap" ? "🌶️" : "🍪").join(" ") + "</span>" : "") + "</div>" +
      '<div class="rowMine">' +
        '<div><div class="lbl">🍪 يدي' + (canPlace ? " — اضغط واحدةً لتضعها" : "") + '</div><div id="spHandMine">' +
          (me.hand || []).map(d => macHTML({ seat: me.seat, t: d.t, up: true, cls: canPlace ? "pick" : "", k: "" }).replace('class="mac', 'data-disc="' + d.id + '" class="mac')).join("") +
          (me.out ? '<span class="sub">🚫 خرجت من اللعبة</span>' : (!(me.hand || []).length ? '<span class="sub">يدي فارغة</span>' : "")) + "</div></div>" +
        (me.stack.length ? '<div><div class="lbl">📚 كومتي' + (canFlip ? " — اضغطها لتقلب 🔒" : "") + "</div>" + stackHTML(v, me) + "</div>" : "") +
      "</div>";
    mi.style.display = "flex"; mi.style.flexDirection = "column"; mi.style.gap = "8px";
    box.querySelectorAll("#spHandMine .mac.pick").forEach(el => el.addEventListener("click", () => {
      box.querySelectorAll("#spHandMine .mac").forEach(x => x.classList.remove("pick"));
      socket.emit("place", { disc: el.getAttribute("data-disc") });
    }));
    const st = box.querySelector(".spStack");
    if (st && canFlip) st.addEventListener("click", () => tryFlip(v.me));
  }
  function tryFlip(owner) {
    const v = VIEW;
    if (!v || !v.flippable.includes(owner)) return;
    socket.emit("flip", { owner });
  }
  /* الماكاروناتُ التي قُلبت للتوّ: تُرسم بظهرها ثمّ تنقلب أمام العين */
  function animateFlips() {
    document.querySelectorAll(".mac[data-k]").forEach(el => {
      const k = el.getAttribute("data-k");
      if (!k || flipped.has(k)) return;
      flipped.add(k);
      setTimeout(() => el.classList.add("up"), 40);
    });
  }

  /* ── لوحةُ الفعل في الوسط ── */
  function renderCenter(v) {
    const box = $("spCenter");
    const me = meP(v), mine = myTurn(v);
    const key = [v.round, v.phase, v.turn, v.bid ? v.bid.amount : 0, mine ? 1 : 0, v.total, (me.hand || []).length, v.revealed.length, v.paused ? 1 : 0].join("|");
    if (key === centerKey) return;
    centerKey = key;
    let h = "";
    if (v.paused) h = '<div class="tt">⏸️ توقّفت الطاولة</div><div class="ss">لا أحدَ من البشر حاضرٌ — تستأنف حين يعود أحد</div>';
    else if (v.phase === "placement") {
      h = !me.stack.length && !me.out
        ? '<div class="tt">🍪 ضع ماكارونةً مقلوبة</div><div class="ss">اضغط واحدةً من يدك تحت — لذيذةً أو 🌶️ الحارّة. لا يراها أحدٌ غيرُك</div>'
        : '<div class="tt">⏳ بانتظار البقيّة يضعون…</div><div class="ss">' + esc(waiting(v).map(nameOf).join("، ")) + "</div>";
    } else if (v.phase === "action") {
      if (mine) {
        const empty = !(me.hand || []).length;
        h = '<div class="tt">' + (empty ? "يدك فارغة — لا بدّ أن تتحدّى 🔥" : "دورك: أضف ماكارونة أو تحدَّ") + "</div>" +
          (empty ? "" : '<div class="ss">➕ اضغط ماكارونةً من يدك لتضعها فوق كومتك — أو 🔥 زايد على ما تقلبه بلا حارّة:</div>') +
          bidBox(v, 1, "🔥 تحدٍّ: أقلب ", false);
      } else h = '<div class="tt">⏳ دورُ ' + esc(nameOf(v.turn)) + '</div><div class="ss">يضيف ماكارونةً أو يفتح المزاد</div>';
    } else if (v.phase === "auction") {
      const passed = v.players.filter(p => p.status === "passed").map(p => p.name);
      if (mine) h = '<div class="tt">🔥 المزاد عند ' + AR(v.bid.amount) + " — ارفع أو انسحب</div>" +
        '<div class="ss">أعلى مزايد: ' + esc(nameOf(v.bid.id)) + " · على الطاولة " + AR(v.total) + "</div>" + bidBox(v, v.bid.amount + 1, "⬆️ ارفع إلى ", true);
      else h = '<div class="tt">🔥 المزاد عند ' + AR(v.bid.amount) + " (" + esc(nameOf(v.bid.id)) + ")</div>" +
        '<div class="ss">⏳ ' + esc(nameOf(v.turn)) + " يقرّر: يرفع أم ينسحب" + (passed.length ? "<br>✋ انسحب: " + esc(passed.join("، ")) : "") + "</div>";
    } else if (v.phase === "reveal") {
      const chall = v.bid.id === v.me;
      h = '<div class="tt">🎯 ' + (chall ? "تقلب " : esc(nameOf(v.bid.id)) + " يقلب ") + AR(v.bid.amount) + " بلا حارّة؟</div>" + progHTML(v) +
        '<div class="ss">' + (chall ? (v.flippable.includes(v.me) ? "🔒 اقلب كومتك أنت أوّلًا — اضغطها تحت" : "اختر لاعبًا واضغط كومته لتقلب أعلاها") : "كومتُه أوّلًا، ثمّ أعلى كوم البقيّة") + "</div>";
    } else if (v.phase === "result" || v.phase === "over") {
      const r = v.result;
      if (r) {
        h = progHTML(v) + (r.ok
          ? '<div class="spRes ok">⭐ ' + esc(nameOf(r.by)) + " قلب " + AR(r.amount) + " بلا حارّة!<small>" + (r.stars >= 2 ? "نجمته الثانية — فاز!" : "نجمةٌ أولى — واحدةٌ أخرى للفوز") + "</small></div>"
          : '<div class="spRes bad">🌶️ حارّة' + (r.trapOwner === r.by ? " من كومته هو" : " " + esc(nameOf(r.trapOwner))) + "!<small>" + esc(nameOf(r.by)) +
            " خسر ماكارونةً للأبد — بقيت له " + AR(r.left) + (r.left ? "" : " (خرج)") + "</small></div>");
        if (!r.ok && r.by === v.me && Array.isArray(me.lost) && me.lost.length) {
          const l = me.lost[me.lost.length - 1];
          h += '<div class="ss">🤫 خسرتَ ' + (l.t === "trap" ? "🌶️ الحارّة" : "🍪 ماكارونةً لذيذة") + " — لا يعرف ذلك غيرُك</div>";
        }
        if (v.phase === "result") h += '<div class="ss">الجولةُ التالية بعد لحظات…</div>';
      }
    }
    box.innerHTML = h;
    const bb = box.querySelector(".spBidBox");
    if (bb) wireBid(v, bb);
  }
  function progHTML(v) {
    if (!v.bid) return "";
    const rv = v.revealed;
    return '<div class="spProg">' + Array.from({ length: v.bid.amount }, (_, i) =>
      '<i class="' + (rv[i] ? (rv[i].t === "trap" ? "bad" : "on") : "") + '"></i>').join("") + "</div>";
  }
  function bidBox(v, min, label, canPass) {
    const max = v.total;
    const k = v.round + ":" + (v.bid ? v.bid.amount : 0);
    if (bidFor !== k) { bidFor = k; bidN = min; }
    bidN = Math.max(min, Math.min(max, bidN));
    return '<div class="spBidBox"><div class="spStep"><button type="button" data-d="-1">−</button><b id="bidN">' + AR(bidN) +
      '</b><button type="button" data-d="1">+</button></div>' +
      '<button class="btn btn-hot" type="button" id="bidGo" data-label="' + label + '">' + label + AR(bidN) + "</button>" +
      (canPass ? '<button class="btn btn-ghost" type="button" id="passBtn">✋ انسحب</button>' : "") + "</div>" +
      '<div class="ss">من ' + AR(min) + " إلى " + AR(max) + " (ما على الطاولة)</div>";
  }
  function wireBid(v, bb) {
    const min = v.phase === "auction" ? v.bid.amount + 1 : 1, max = v.total;
    const paint = () => {
      bb.querySelector("#bidN").textContent = AR(bidN);
      const go = bb.querySelector("#bidGo");
      go.textContent = go.dataset.label + AR(bidN);
      bb.querySelector('[data-d="-1"]').disabled = bidN <= min;
      bb.querySelector('[data-d="1"]').disabled = bidN >= max;
    };
    bb.querySelectorAll(".spStep button").forEach(b => b.onclick = () => { bidN = Math.max(min, Math.min(max, bidN + +b.dataset.d)); paint(); });
    bb.querySelector("#bidGo").onclick = () => socket.emit("raise", { amount: bidN });
    const ps = bb.querySelector("#passBtn");
    if (ps) ps.onclick = () => socket.emit("pass");
    paint();
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
    const hurry = left <= 5000 && v.phase !== "result";
    bar.classList.toggle("hurry", hurry);
    if (hurry && s !== lastTick && s > 0 && myTurn(v)) { lastTick = s; snd("tick"); }
  }
  setInterval(tickTimer, 200);

  /* ══════════ القواعد ══════════ */
  function rulesHTML() {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    return r("🍪 الفكرة", "لكلّ لاعبٍ أربعُ ماكارونات: ثلاثٌ لذيذة وواحدةٌ 🌶️ حارّة. تخدع أصحابك بما تضعه، وتزايد على ما تقدر تقلبه دون أن تلدغك الحارّة.") +
      r("١) الوضع", "في بداية كلّ جولة يضع كلُّ لاعبٍ ماكارونةً مقلوبةً أمامه (معًا) — لا يراها غيرُه.") +
      r("٢) دورك", "بالدور: ➕ أضف ماكارونةً أخرى من يدك فوق كومتك، أو 🔥 تحدَّ: أعلن كم ماكارونةً تقلب بلا حارّة (حتى مجموع ما على الطاولة). ومن فرغت يدُه لا بدّ أن يتحدّى.") +
      r("٣) المزاد", "بعد أوّل تحدٍّ لا إضافةَ لأحد: كلٌّ بدوره يرفع العدد أو ✋ ينسحب لهذه الجولة. يبقى أعلى مزايدٍ فيصير «المتحدّي» — ومن زايد بمجموع الطاولة كلِّها انتهى المزاد فورًا.") +
      r("٤) الكشف 🔒", "المتحدّي يقلب كومتَه هو كلَّها أوّلًا — لا يلمس كومةَ غيره قبلها. ثمّ يقلب من أعلى كوم الآخرين ما شاء (الأعلى قبل ما تحته).") +
      r("⭐ النجاح", "قلب العددَ كلَّه بلا حارّة ⇒ نجمة. نجمتان ⇒ فوز.") +
      r("🌶️ الفشل", "صادف حارّةً (ولو حارّتَه هو) ⇒ يخسر ماكارونةً عشوائيّةً من ماكاروناته للأبد — ولا يعرف أيَّها خسر إلا هو. ومن نفدت ماكاروناته خرج، وآخرُ من يبقى يفوز.") +
      r("⏱️ الوقت", "لكلّ خطوةٍ مهلة؛ تنتهي فيُفعل عنك (وضعٌ عشوائيّ، أو إضافة، أو انسحاب، أو قلب).");
  }
  $("rulesBtn").onclick = () => { $("rulesBody").innerHTML = rulesHTML(); openModal("rulesModal"); };

  /* ══════════ النهاية ══════════ */
  const REASON = { stars: "نجمتان ⭐⭐", last: "آخرُ من بقي على الطاولة" };
  function onEnd(res) {
    const iWon = res.winner === ME;
    $("endBanner").innerHTML = (iWon ? "🏆 فزت!" : "🏆 الفائز: " + esc(res.winnerName || "")) + "<small>" + esc(REASON[res.reason] || "") + "</small>";
    $("endBanner").style.background = iWon ? "linear-gradient(180deg,#7DDCA9,#36A96F)" : "";
    const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
    $("endRank").innerHTML = (res.ranking || []).map(x => {
      const seat = VIEW ? seatOf(x.id) : 0;
      return '<div class="rk' + (x.id === ME ? " me" : "") + '" style="--sd:' + palOf(seat).d + "; --sl:" + palOf(seat).l + '">' +
        '<span class="pl">' + (MEDAL[x.place] || AR(x.place)) + '</span><span class="nm">' + esc(x.name) + (x.id === ME ? " (أنت)" : "") + (x.bot ? " 🤖" : "") + "</span>" +
        '<span class="x">⭐ ' + AR(x.stars) + "</span>" + '<span class="x">' + (x.out ? "🚫 خرج" : "🍪 " + AR(x.discs)) + "</span></div>";
    }).join("");
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(iWon ? "ok" : "round");
  }
  onClose.endModal = () => {
    if (!ended) return;
    ended = false;
    if (!LOBBY || !LOBBY.playing) toLobby();
  };
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  /* 🚪 ترك الجلسة: خروجٌ متعمَّد إلى القائمة الرئيسيّة (يلعب بوتٌ مكانك) */
  function leaveNow() {
    try { localStorage.removeItem("spResume"); } catch (e) {}
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
  const PHRASES = ["السلام عليكم 👋", "بالتوفيق للجميع 🤝", "كومتي كلّها لذيذة 😇", "لا تصدّقونه! 🤨",
                   "حارّة حارّة 🌶️", "يا ساتر! 😱", "هههههه 😂", "تحدٍّ شجاع 🔥",
                   "ما أنسحب 😎", "انسحبت 🏳️", "مشكورين 🙏", "لعبة حلوة 👏"];
  const EMOJI = ["😂", "😎", "😇", "🤨", "😱", "🤔", "🥵", "🌶️", "🍪", "🔥", "👏", "🙈", "😈", "🤫", "💪", "❤️"];
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
    const host = id === ME ? $("spMine") : document.querySelector('#spTable [data-id="' + id + '"]');
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
  socket = io("/spicy");
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
    OPTS = { turnSecs: h.turnSecs || OPTS.turnSecs, min: h.min || 3, max: h.max || 6 };
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
    try { const s = JSON.parse(localStorage.getItem("spResume") || "null"); if (s && s.room === r) token = s.token; } catch (e) {}
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
    try { localStorage.setItem("spResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    if (first && !VIEW) showScreen("lobby");
  }
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("spResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("spResume"); } catch (e) {} return; }
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
    centerKey = ""; flipped.clear();
    $("spTable").dataset.ids = "";
    addMsg("🌶️ بدأت اللعبة — اخدعوا بلطف!", true);
  });
  socket.on("matchEnd", res => { ended = true; setTimeout(() => { if (ended) onEnd(res); }, 1400); });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", list => { $("msgs").innerHTML = ""; list.forEach(m => addMsg(m, false, true)); });
  socket.on("toast", t => toast(t));
  socket.on("replaced", () => openModal("replacedModal"));
  socket.on("kicked", () => {
    try { localStorage.removeItem("spResume"); } catch (e) {}
    alert("تم إخراجك من الغرفة"); location.href = "/spicy/";
  });
  $("roomChip").onclick = () => {
    const link = location.origin + "/spicy/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
