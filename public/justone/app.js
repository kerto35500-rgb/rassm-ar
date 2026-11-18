/* 🔤 «كلمة واحدة فقط» — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. والحالةُ التي تصل
 * محجوبةٌ على الخادم أصلًا — فالمخمّنُ لا تصله الكلمةُ ولا التلميحات قبل
 * وقتها، لا أنّها تصله وتُخفى بالـCSS.
 *
 * شاشتان مختلفتان تمامًا لكلّ جولة: شاشةُ المخمّن (يختار رقمًا، ثمّ ينتظر
 * مغمضَ العينين، ثمّ يرى البطاقات المبعثرة ويخمّن)، وشاشةُ الملمّحين (يرون
 * الكلمة، ويكتبون، ويراجعون بالتصويت، ثمّ يشاهدونه يكتب حرفًا حرفًا).
 *
 * والمسرحُ يُبنى مرّةً لكلّ مرحلة ثمّ يُحدَّث في مكانه — كي لا تُمحى خانةُ
 * الكتابة تحت أصابع صاحبها كلّما سلّم غيرُه.
 */
(function () {
  "use strict";
  const N = window.JNORM;
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);

  /* لكلّ لاعبٍ لونُه (بترتيب الجلوس)، ولكلّ بطاقةٍ لونٌ من الأربعة */
  const AVC = ["#D95C84", "#C9850E", "#8462D2", "#2A9A70", "#2F8FD3", "#D9534A", "#7E8F22"];
  const PHASE_SECS = { pick: 20, review: 25, reveal: 8 };
  /* بعثرةُ البطاقات: زوايا وإزاحاتٌ ثابتةٌ لكلّ رقم (لا تتراقص مع كلّ تحديث) */
  const TILT = [-5, 4, -2.5, 6, -4, 2.5, -6, 3.5, -1.5, 5, -3, 1.5, -5.5, 4.5];
  const LIFT = [0, -6, 4, -3, 6, -5, 2, -2, 5, -4, 3, -6, 1, 4];

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let LOBBY = null, VIEW = null, SKEW = 0, DEFAULTS = null, settings = null;
  let OPTS = { clueSecs: [45, 60, 90, 120], guessSecs: [45, 60, 90] };
  let ended = false, stageKey = "", liveText = "", lastTick = -1;

  /* ══════════ أدوات ══════════ */
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.add("on");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2600);
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
    if (e.target.hasAttribute("data-close") || e.target === m) closeModal(m.id);
  }));
  const playerOf = id => (VIEW && VIEW.players.find(p => p.id === id)) || (LOBBY && LOBBY.players.find(p => p.id === id)) || null;
  const nameOf = id => { const p = playerOf(id); return p ? p.name : "لاعب"; };
  function colorOf(id) {
    const list = (VIEW && VIEW.players) || (LOBBY && LOBBY.players) || [];
    const i = list.findIndex(p => p.id === id);
    return AVC[(i < 0 ? 0 : i) % AVC.length];
  }
  const initial = s => (String(s || "؟").trim()[0] || "؟");
  const avatar = (id, name) => '<span class="av" style="--ac:' + colorOf(id) + '">' + esc(initial(name)) + "</span>";

  /* أصواتٌ مركّبة: لا ملفّات تُحمَّل */
  let AC = null, SND = true;
  try { SND = localStorage.getItem("joSnd") !== "0"; } catch (e) {}
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
      else if (kind === "skip") tone(520, 0, .2, "sine", .07);
      else if (kind === "round") { tone(520, 0, .12, "sine", .07); tone(780, .1, .16, "sine", .07); }
      else if (kind === "pick") tone(700, 0, .12, "triangle", .08);
      else if (kind === "pop") tone(980, 0, .06, "sine", .05);
      else if (kind === "tick") tone(1180, 0, .045, "square", .03);
      else tone(440, 0, .1, "sine", .06);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => {
    SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇";
    try { localStorage.setItem("joSnd", SND ? "1" : "0"); } catch (e) {}
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
    VIEW = null; stageKey = ""; liveText = "";
    $("joStage").innerHTML = "";
    $("phaseInfo").textContent = "في الانتظار…";
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
    for (const p of L.players) {
      const d = document.createElement("div");
      d.className = "lp" + (p.id === ME ? " me" : "") + (p.gone ? " gone" : "");
      d.innerHTML = avatar(p.id, p.name) + '<span class="nm">' + esc(p.name) + "</span>" +
        (p.id === ME ? "<small>أنت</small>" : "") + (p.gone ? "<small>غائب</small>" : "") +
        (p.host ? '<span class="crown">👑</span>' : "");
      if (host && p.id !== ME) {
        const k = document.createElement("button");
        k.className = "kick"; k.textContent = "✕"; k.title = "إخراج";
        k.onclick = () => { if (confirm("إخراج " + p.name + "؟")) socket.emit("kick", { id: p.id }); };
        d.appendChild(k);
      }
      pl.appendChild(d);
    }
    const n = L.players.filter(p => !p.gone).length;
    $("plCount").textContent = "(" + AR(n) + "/" + AR(L.max) + ")";
    $("needMore").textContent = n < L.min
      ? "تحتاجون " + AR(L.min) + " لاعبين على الأقلّ — انسخوا رابط الدعوة من الأعلى 🔗" : "";
    $("startBtn").disabled = n < L.min;
    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    $("lobbySummary").innerHTML = summary(settings) + (lr && lr.rating
      ? "<br>" + lr.rating.icon + " آخر لعبة: <b>" + AR(lr.score) + " من " + AR(lr.cards) + "</b> — " + esc(lr.rating.ar) : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }

  function summary(S) {
    return "⏱️ التلميح " + AR(S.clueSecs) + "ث · التخمين " + AR(S.guessSecs) + "ث";
  }

  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    const segOf = (id, list) => '<div class="seg" id="' + id + '">' + list.map(v => '<button data-v="' + v + '">' + AR(v) + "ث</button>").join("") + "</div>";
    box.innerHTML =
      '<div class="setRow"><label>✏️ وقت كتابة التلميح</label>' + segOf("sClue", OPTS.clueSecs) +
        '<div class="hint">ينتهي الوقتُ فيُغلَق باب التلميح بما وصل.</div></div>' +
      '<div class="setRow"><label>🎯 وقت التخمين</label>' + segOf("sGuess", OPTS.guessSecs) +
        '<div class="hint">ينتهي بلا تخمين ⇒ تخطٍّ (تضيع البطاقة وحدها).</div></div>' +
      '<div class="setRow"><label>📏 القواعد</label><div class="hint" style="width:auto">١٣ بطاقة · تلميحان لكلّ واحدٍ مع ثلاثة لاعبين · يُحذف ما شطبه أكثرُ من نصف الملمّحين</div></div>';
    const seg = (id, key) => $(id).querySelectorAll("button").forEach(b => b.onclick = () => push({ [key]: +b.dataset.v }));
    seg("sClue", "clueSecs");
    seg("sGuess", "guessSecs");
  }
  /* التغييرُ وحده لا الإعداداتُ كلُّها (كلودو): نقرتان أسرع من ردّ الخادم لا تُلغي إحداهما الأخرى */
  function push(d) {
    Object.assign(settings, d);
    syncSettings();
    socket.emit("updateSettings", d);
  }
  function syncSettings() {
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    on("sClue", settings.clueSecs); on("sGuess", settings.guessSecs);
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

  function onEvent(e, v) {
    if (e.t === "round") {
      liveText = "";
      snd("round");
      addMsg("🎴 الجولة " + AR(e.round) + " — المخمّن: " + nameOf(e.guesser), true);
    } else if (e.t === "picked") snd("pick");
    else if (e.t === "unknown") {
      toast("🤷 " + nameOf(e.by) + ": «ما أعرف الكلمة» — " + (v.isGuesser ? "اختر رقمًا آخر" : "اختيارٌ جديد"));
    } else if (e.t === "submitted") snd("pop");
    else if (e.t === "result") snd(e.result === "correct" ? "ok" : e.result === "wrong" ? "bad" : "skip");
    else if (e.t === "timeout") {
      if (e.phase === "pick") toast("⏱️ انتهى الوقت — اختير رقمٌ عشوائيّ");
      else if (e.phase === "clues") toast("⏱️ انتهى وقت التلميح");
      else if (e.phase === "guess") toast("⏱️ انتهى وقت التخمين");
    }
  }

  const meP = v => v.players.find(p => p.id === v.me) || {};
  const guesserName = v => nameOf(v.guesser);
  const giversOn = v => v.players.filter(p => p.role === "giver" && p.on);

  function phaseLine(v) {
    const g = guesserName(v), G = v.isGuesser;
    if (v.paused) return "⏸️ بانتظار عودة اللاعبين…";
    /* بلا تذكيرٍ ولا تأنيث: الاسمُ لا يُخبرنا من صاحبه */
    switch (v.phase) {
      case "pick": return G ? "🎴 اختر رقمًا" : "⏳ بانتظار اختيار " + g;
      case "clues": return G ? "🙈 الفريق يكتب لك التلميحات" : "✏️ اكتب تلميحك";
      case "review": return G ? "🔍 الفريق يراجع التلميحات" : "✂️ راجعوا التلميحات";
      case "guess": return G ? "🎯 خمّن الكلمة" : "👀 دورُ " + g + " في التخمين";
      case "reveal": return { correct: "✅ إصابة!", wrong: "❌ تخمينٌ خاطئ", skip: "⏭️ تخطٍّ", empty: "🫥 لم ينجُ تلميح" }[v.result] || "الكشف";
      case "over": return "🏁 انتهت اللعبة";
      default: return "…";
    }
  }

  function render(v) {
    $("phaseInfo").textContent = (v.phase !== "over" ? "الجولة " + AR(v.round) + " · " : "") + phaseLine(v);
    renderHud(v);
    renderTeam(v);
    const key = [v.round, v.phase, v.isGuesser ? "g" : "c", v.unknownsLeft, (v.disabled || []).join(".")].join("|");
    const build = key !== stageKey;
    stageKey = key;
    const S = { pick: stPick, clues: stClues, review: stReview, guess: stGuess, reveal: stReveal, over: stOver }[v.phase];
    if (S) S(v, build);
    tickTimer();
  }

  function renderHud(v) {
    $("deckN").textContent = AR(v.deckLeft);
    $("scoreN").textContent = AR(v.score);
    $("roundN").textContent = AR(v.round);
    const ds = $("deckStack");
    const n = Math.min(4, v.deckLeft);
    if (ds.dataset.n !== String(n)) {
      ds.dataset.n = String(n);
      ds.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const c = document.createElement("i");
        c.style.left = (i * 1.5) + "px"; c.style.top = (4 - i * 1.5) + "px";
        ds.appendChild(c);
      }
    }
  }

  function renderTeam(v) {
    const box = $("team");
    const want = v.players.map(p => p.id).join(",");
    if (box.dataset.ids !== want) {
      box.dataset.ids = want;
      box.innerHTML = "";
      for (const p of v.players) {
        const d = document.createElement("div");
        d.dataset.id = p.id;
        d.style.setProperty("--ac", colorOf(p.id));
        d.innerHTML = avatar(p.id, p.name) + '<span class="nm">' + esc(p.name) + '</span><span class="role"></span><div class="bub"></div>';
        box.appendChild(d);
      }
    }
    for (const d of box.children) {
      const p = v.players.find(x => x.id === d.dataset.id);
      if (!p) continue;
      d.className = "mate" + (p.role === "guesser" ? " guesser" : "") + (p.done ? " done" : "") + (p.on ? "" : " off") + (p.id === ME ? " me" : "");
      d.querySelector(".role").textContent = p.role === "guesser" ? "🔮" : "✏️";
      d.title = p.role === "guesser" ? "المخمّن" : "ملمّح";
    }
  }

  /* ── المؤقّت: شريطٌ ينقص، ونقرةٌ في الثواني الخمس الأخيرة لمن عليه الدور ── */
  function phaseTotal(v) {
    const S = v.settings || settings || DEFAULTS || {};
    if (v.phase === "clues") return (S.clueSecs || 60) * 1000;
    if (v.phase === "guess") return (S.guessSecs || 60) * 1000;
    return (PHASE_SECS[v.phase] || 20) * 1000;
  }
  function myTurnToAct(v) {
    const me = meP(v);
    if (v.phase === "pick" || v.phase === "guess") return v.isGuesser;
    if (v.phase === "clues" || v.phase === "review") return !v.isGuesser && !me.done;
    return false;
  }
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
    const pct = Math.max(0, Math.min(100, left / phaseTotal(v) * 100));
    bar.firstElementChild.style.width = pct.toFixed(1) + "%";
    const s = Math.ceil(left / 1000);
    sec.textContent = AR(s);
    const hurry = left <= 5000 && v.phase !== "reveal";
    bar.classList.toggle("hurry", hurry);
    if (hurry && s !== lastTick && s > 0 && myTurnToAct(v)) { lastTick = s; snd("tick"); }
  }
  setInterval(tickTimer, 200);

  /* ══════════ المسرح ══════════ */
  const stage = () => $("joStage");
  function waitScreen(icon, title, sub, dots) {
    return '<div class="wait"><div class="big">' + icon + '</div><div class="stTitle">' + title + "</div>" +
      (sub ? '<div class="stSub">' + sub + "</div>" : "") + (dots ? '<div class="dots" id="wDots"></div>' : "") + "</div>";
  }
  function paintDots(v, key) {
    const d = $("wDots");
    if (!d) return;
    const gs = giversOn(v);
    d.innerHTML = gs.map(p => '<i class="' + (p[key] ? "on" : "") + '" title="' + esc(p.name) + '"></i>').join("");
  }
  const secretCard = (v, mini) => '<div class="secret' + (mini ? " mini" : "") + '"><span class="lbl">🤫 الكلمة السرّيّة</span><div class="w">' +
    esc(v.secret || "؟") + "</div></div>";

  /* بطاقةُ تلميح: لونُها بترتيبها، وزاويتُها وإزاحتُها ثابتتان لرقمها */
  function clueCard(c, i, opts = {}) {
    const d = document.createElement("div");
    d.className = "clue k" + (i % 4) + (c.out ? " out" : "") + (opts.pop ? " pop" : "") + (c.mine ? " voted" : "");
    d.dataset.id = String(c.id);
    d.style.setProperty("--r", TILT[c.id % TILT.length] + "deg");
    d.style.setProperty("--y", LIFT[c.id % LIFT.length] + "px");
    if (opts.pop) d.style.setProperty("--d", (i * 0.09).toFixed(2) + "s");
    let h = '<div class="t">' + esc(c.text) + '</div><div class="by">' + esc(nameOf(c.by)) + "</div>";
    if (c.out) h += '<span class="why">✂️ ' + esc(c.outAr || "محذوف") + "</span>";
    else if (opts.hints) {
      if (c.sim) h += '<span class="hint">⚠️ يشبه تلميحًا آخر</span>';
      if (c.latin) h += '<span class="hint">🔤 حروفٌ لاتينيّة — ترجمة؟</span>';
    }
    d.innerHTML = h;
    return d;
  }

  /* ── ١) اختيار الرقم ── */
  function stPick(v, build) {
    if (!build) return;
    const st = stage();
    if (v.isGuesser) {
      st.innerHTML = '<div class="stTitle">🎴 اختر رقمًا</div>' +
        '<div class="stSub">الكلمةُ مخفيّةٌ عنك — اختر بطاقةً من الخمس، وسيلمّح لك الفريقُ بكلماتٍ مفردة.</div>' +
        '<div class="picks" id="picks"></div>' +
        (v.disabled.length ? '<div class="stNote">✕ = رقمٌ لم يعرف أحدُهم كلمتَه</div>' : "");
      const box = $("picks");
      for (let n = 1; n <= 5; n++) {
        const b = document.createElement("button");
        const off = v.disabled.includes(n);
        b.className = "pcard k" + ((n - 1) % 4) + (off ? " x" : "");
        b.dataset.n = String(n);
        b.textContent = AR(n);
        b.disabled = off;
        if (off) b.setAttribute("disabled", "");
        b.onclick = () => {
          if (b.disabled) return;
          box.querySelectorAll("button").forEach(x => { x.disabled = true; });
          b.classList.add("chosen");
          socket.emit("pick", { n });
        };
        box.appendChild(b);
      }
    } else {
      st.innerHTML = '<div class="stTitle">⏳ بانتظار اختيار ' + esc(guesserName(v)) + "…</div>" +
        '<div class="stSub">هذه بطاقةُ الجولة — هو لا يراها. لا تقل شيئًا! 🤫</div>' +
        '<div class="wlist">' + (v.card || []).map((w, i) =>
          '<div class="wrow k' + (i % 4) + (v.disabled.includes(i + 1) ? " off" : "") + '"><span class="n">' + AR(i + 1) + "</span>" + esc(w) + "</div>").join("") +
        "</div>";
    }
  }

  /* ── ٢) التلميح ── */
  function clueWarn(t, secret, other) {
    if (!t) return null;
    if (N.isMulti(t) || /\s/.test(t)) return ["bad", "كلمةٌ واحدة فقط — بلا مسافات"];
    if (!N.norm(t)) return ["bad", "اكتب حروفًا لا رموزًا"];
    if (secret && N.related(t, secret)) return ["bad", "⚠️ هذه الكلمة نفسها أو من عائلتها — ستُحذف"];
    if (other && N.norm(other) && N.norm(other) === N.norm(t)) return ["bad", "⚠️ تلميحاك متطابقان — سيُحذفان معًا"];
    if (/[a-z]/i.test(t)) return ["warn", "🔤 حروفٌ لاتينيّة؟ ترجمةُ الكلمة ممنوعة"];
    if (/\d/.test(t)) return ["warn", "🔢 الأرقام قد يشطبها الفريق"];
    return null;
  }
  function stClues(v, build) {
    const st = stage();
    if (v.isGuesser) {
      if (build) st.innerHTML = waitScreen("🙈", "أغمض عينيك…", "الفريقُ يكتب لك التلميحات الآن — كلُّ واحدٍ كلمةً واحدة" + (v.cluesPer > 1 ? " (أو كلمتين)" : "") + ".", true);
      paintDots(v, "done");
      return;
    }
    const me = meP(v);
    if (build) {
      st.innerHTML = secretCard(v) +
        '<div class="stSub">اكتب ' + (v.cluesPer > 1 ? "<b>تلميحين</b> (كلٌّ منهما كلمة)" : "<b>كلمةً واحدة</b>") +
        " لـ" + esc(guesserName(v)) + " — والمتطابقُ مع غيرك يُحذف، ففكّر بما لا يكتبه غيرُك!</div>" +
        '<div class="clueBox" id="clueBox"></div>' +
        '<div class="sentNote" id="sentNote">✓ وصل تلميحك — تقدر تعدّله حتى يُكمل الجميع</div>' +
        '<div class="row2b"><button class="btn btn-green" id="sendClue">أرسل التلميح ✓</button>' +
        '<button class="btn btn-ghost" id="unknownBtn">🤷 ما أعرف الكلمة</button></div>' +
        '<div class="stNote" id="cluesProg"></div>';
      const box = $("clueBox");
      const mine = (v.clues || []).map(c => c.text);
      const ins = [];
      for (let i = 0; i < v.cluesPer; i++) {
        const inp = document.createElement("input");
        inp.className = "clueIn"; inp.id = "clue" + i;
        inp.setAttribute("maxlength", "24"); inp.setAttribute("autocomplete", "off");
        inp.setAttribute("placeholder", v.cluesPer > 1 ? "التلميح " + (i ? "الثاني" : "الأوّل") : "تلميحك (كلمة واحدة)");
        inp.value = mine[i] || "";
        const w = document.createElement("div");
        w.className = "cwarn"; w.id = "cw" + i;
        box.appendChild(inp); box.appendChild(w);
        ins.push(inp);
      }
      const check = () => {
        let worst = null;
        ins.forEach((inp, i) => {
          const other = ins.length > 1 ? ins[1 - i].value.trim() : null;
          const r = clueWarn(inp.value.trim(), v.secret, other);
          inp.classList.toggle("bad", !!r && r[0] === "bad");
          inp.classList.toggle("warn", !!r && r[0] === "warn");
          const w = $("cw" + i);
          w.textContent = r ? r[1] : "";
          w.classList.toggle("w", !!r && r[0] === "warn");
          if (r && r[0] === "bad" && !worst) worst = r[1];
        });
        return worst;
      };
      const send = () => {
        const list = ins.map(x => x.value.trim());
        if (!list.some(Boolean)) return toast("اكتب تلميحًا أوّلًا");
        const bad = check();
        if (bad) return toast(bad.replace(/^⚠️ /, ""));
        socket.emit("clues", { list });
        snd("pop");
      };
      ins.forEach((inp, i) => {
        /* كلمةٌ واحدة: المسافةُ لا تُكتب، وما يُلصَق تُنزع مسافاتُه */
        inp.addEventListener("keydown", e => {
          if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); toast("كلمةٌ واحدة فقط — بلا مسافات ✋"); }
          else if (e.key === "Enter") { e.preventDefault(); if (i + 1 < ins.length && !ins[i + 1].value.trim()) ins[i + 1].focus(); else send(); }
        });
        inp.addEventListener("input", () => {
          const clean = inp.value.replace(/\s+/g, "");
          if (clean !== inp.value) inp.value = clean;
          check();
          $("sentNote").classList.remove("on");
        });
      });
      check();
      $("sendClue").onclick = send;
      const ub = $("unknownBtn");
      ub.onclick = () => {
        if (v.unknownsLeft <= 0) return toast("كفى تغييرًا في هذه الجولة");
        if (!ub.dataset.sure) {
          ub.dataset.sure = "1"; ub.textContent = "متأكد؟ اضغط مرّةً ثانية";
          setTimeout(() => { if (ub.dataset) { delete ub.dataset.sure; ub.textContent = "🤷 ما أعرف الكلمة"; } }, 3000);
          return;
        }
        socket.emit("unknown");
      };
      if (v.unknownsLeft <= 0) ub.disabled = true;
      if (ins[0] && !ins[0].value) ins[0].focus();
    }
    $("sentNote").classList.toggle("on", !!me.done);
    $("sendClue").textContent = me.done ? "تعديل التلميح ✎" : "أرسل التلميح ✓";
    const gs = giversOn(v);
    $("cluesProg").textContent = "سلّم " + AR(gs.filter(p => p.done).length) + " من " + AR(gs.length);
  }

  /* ── ٣) المراجعة بالتصويت ── */
  function stReview(v, build) {
    const st = stage();
    if (v.isGuesser) {
      if (build) st.innerHTML = waitScreen("🔍", "الفريقُ يراجع التلميحات", "يشطبون ما خالف القواعد قبل أن تراها…", true);
      paintDots(v, "done");
      return;
    }
    const me = meP(v);
    const gs = giversOn(v);
    const need = Math.floor(gs.length / 2) + 1;
    if (build) {
      st.innerHTML = secretCard(v, true) +
        '<div class="stTitle">✂️ راجعوا التلميحات</div>' +
        '<div class="stSub">الآلةُ حذفت المتطابقَ والكلمةَ نفسها. اشطبوا ما بقي من المخالف: ترجمةٌ، أو جمعٌ ومفرد، أو من عائلة الكلمة. يُحذف ما شطبه <b>' +
        AR(need) + " من " + AR(gs.length) + "</b>.</div>" +
        /* «جاهز» تحت ما يُصوَّت عليه مباشرةً، والمحذوفُ آليًّا بعده للعلم */
        '<div class="clues" id="rvAlive"></div>' +
        '<div class="row2b"><button class="btn btn-green" id="readyBtn">جاهز ✓</button></div>' +
        '<div class="stNote" id="rvProg"></div>' +
        '<div class="secTag" id="rvOutTag"></div><div class="clues" id="rvOut"></div>';
      $("readyBtn").onclick = () => socket.emit("ready");
    }
    const alive = (v.clues || []).filter(c => !c.out), out = (v.clues || []).filter(c => c.out);
    const A = $("rvAlive"), O = $("rvOut");
    A.innerHTML = ""; O.innerHTML = "";
    alive.forEach((c, i) => {
      const d = clueCard(c, i, { hints: true, pop: build });
      const b = document.createElement("button");
      b.className = "strike" + (c.mine ? " on" : "");
      b.textContent = (c.mine ? "↩️ تراجع" : "✂️ اشطب") + " · " + AR(c.votes) + "/" + AR(need);
      b.onclick = () => socket.emit("strike", { id: c.id });
      d.appendChild(b);
      A.appendChild(d);
    });
    out.forEach((c, i) => O.appendChild(clueCard(c, alive.length + i)));
    $("rvOutTag").textContent = out.length ? "حذفته الآلة (" + AR(out.length) + ")" : "";
    $("readyBtn").disabled = !!me.done;
    $("readyBtn").textContent = me.done ? "✓ جاهز — بانتظار البقيّة" : "جاهز ✓";
    $("rvProg").textContent = "جاهز " + AR(gs.filter(p => p.done).length) + " من " + AR(gs.length);
  }

  /* ── ٤) التخمين ── */
  let typeT = 0, typePending = null;
  function sendTyping(text) {
    const now = Date.now();
    if (now - typeT >= 90) { typeT = now; socket.emit("typing", { text }); return; }
    clearTimeout(typePending);
    typePending = setTimeout(() => { typeT = Date.now(); socket.emit("typing", { text }); }, 90);
  }
  function stGuess(v, build) {
    const st = stage();
    if (v.isGuesser) {
      if (!build) return;
      const list = v.clues || [];
      st.innerHTML = '<div class="stTitle">🎯 خمّن الكلمة</div>' +
        '<div class="stSub">نجا ' + AR(list.length) + " من " + AR(v.clueCount) + " تلميحات. الخطأُ يُضيّع بطاقتين، والتخطّي بطاقةً واحدة.</div>" +
        '<div class="clues" id="gClues"></div>' +
        '<div class="guessBox"><input id="guessIn" maxlength="24" autocomplete="off" placeholder="اكتب تخمينك…">' +
        '<button class="btn btn-green" id="guessBtn">خمّن 🎯</button><button class="btn btn-ghost" id="skipBtn">تخطٍّ ⏭️</button></div>';
      const box = $("gClues");
      list.forEach((c, i) => box.appendChild(clueCard(c, i, { pop: true })));
      const inp = $("guessIn");
      const go = () => {
        const t = inp.value.trim();
        if (!t) return toast("اكتب تخمينك أوّلًا");
        socket.emit("guess", { text: t });
        $("guessBtn").disabled = true; $("skipBtn").disabled = true;
      };
      inp.addEventListener("input", () => sendTyping(inp.value.slice(0, 24)));
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      $("guessBtn").onclick = go;
      $("skipBtn").onclick = () => {
        const b = $("skipBtn");
        if (!b.dataset.sure) {
          b.dataset.sure = "1"; b.textContent = "متأكد؟ ⏭️";
          setTimeout(() => { delete b.dataset.sure; b.textContent = "تخطٍّ ⏭️"; }, 3000);
          return;
        }
        socket.emit("skip");
        $("guessBtn").disabled = true; b.disabled = true;
      };
      inp.focus();
      return;
    }
    if (build) {
      const all = v.clues || [];
      const alive = all.filter(c => !c.out), out = all.filter(c => c.out);
      st.innerHTML = '<div class="stTitle">👀 دورُ ' + esc(guesserName(v)) + " في التخمين…</div>" +
        '<div class="typeBox" id="live"></div>' + secretCard(v, true) +
        '<div class="secTag">ما يراه (' + AR(alive.length) + ")</div>" +
        '<div class="clues" id="gAlive"></div>' +
        (out.length ? '<div class="secTag">المحذوفة (' + AR(out.length) + ')</div><div class="clues" id="gOut"></div>' : "");
      alive.forEach((c, i) => $("gAlive").appendChild(clueCard(c, i)));
      if (out.length) out.forEach((c, i) => $("gOut").appendChild(clueCard(c, alive.length + i)));
    }
    paintLive();
  }
  function paintLive() {
    const L = $("live");
    if (!L) return;
    L.innerHTML = liveText ? esc(liveText) + '<span class="caret"></span>' : '<span class="ph">✍️ لم يكتب شيئًا بعد</span><span class="caret"></span>';
  }

  /* ── ٥) الكشف ── */
  function stReveal(v, build) {
    if (!build) return;
    const st = stage();
    const g = guesserName(v);
    const R = {
      correct: ["correct", "✅ إصابة! +١", "وصلت الفكرة إلى " + g + " 🎉"],
      wrong: ["wrong", "❌ تخمينٌ خاطئ", "ضاعت هذه البطاقة والتي بعدها"],
      skip: ["skip", "⏭️ تخطٍّ", "ضاعت هذه البطاقة وحدها"],
      empty: ["empty", "🫥 لم ينجُ أيُّ تلميح", "كلُّها حُذفت — ضاعت البطاقة"]
    }[v.result] || ["empty", "الكشف", ""];
    /* خطأٌ في البطاقة الأخيرة: لا بطاقةَ تضيع بعدها — فتُخصم نقطة (إن وُجدت) */
    const ev = (v.events || []).find(e => e.t === "result");
    if (ev && v.result === "wrong" && !ev.burned) R[2] = ev.lost ? "لا بطاقةَ بعدها — فخُصمت نقطة" : "كانت البطاقةَ الأخيرة";
    st.innerHTML = '<div class="resBanner ' + R[0] + '">' + R[1] + (R[2] ? "<small>" + esc(R[2]) + "</small>" : "") + "</div>" +
      secretCard(v) +
      (v.guess ? '<div class="guessLine">تخمينُ ' + esc(g) + ": <b>" + esc(v.guess) + "</b></div>" : "") +
      '<div class="clues" id="rvAll"></div>' +
      '<div class="stNote">' + (v.deckLeft > 0 ? "الجولة التالية بعد لحظات… (باقي " + AR(v.deckLeft) + " في الرزمة)" : "انتهت البطاقات — النتيجة بعد لحظات!") + "</div>";
    const all = (v.clues || []).slice().sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0));
    all.forEach((c, i) => $("rvAll").appendChild(clueCard(c, i)));
  }

  /* ── ٦) النهاية ── */
  function stOver(v, build) {
    if (!build) return;
    const r = v.rating || { icon: "🏁", ar: "انتهت اللعبة", line: "" };
    stage().innerHTML = '<div class="wait"><div class="big">' + r.icon + '</div><div class="stTitle">' + esc(r.ar) + "</div>" +
      '<div class="stSub">' + AR(v.score) + " من " + AR(v.cardsTotal) + " — " + esc(r.line || "") + "</div></div>";
  }

  /* ══════════ القواعد ══════════ */
  function rulesHTML() {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    return r("🤝 الفكرة", "لعبةٌ تعاونيّة: كلُّكم فريقٌ واحدٌ ضدّ ١٣ بطاقة. في كلّ جولةٍ واحدٌ يخمّن والبقيّةُ يلمّحون، والدورُ يتناوب.") +
      r("🎴 ١) اختيار الكلمة", "المخمّنُ يختار رقمًا من ١ إلى ٥ دون أن يرى البطاقة، فتصير الكلمةُ بذلك الرقم هي السرّيّة. ومن لا يعرفها من الملمّحين يضغط «ما أعرف الكلمة» فيختار المخمّنُ رقمًا آخر.") +
      r("✏️ ٢) التلميح", "كلُّ ملمّحٍ يكتب كلمةً واحدةً فقط سرًّا (ومع ثلاثة لاعبين: كلمتين). ممنوع: أكثرُ من كلمة، والكلمةُ نفسها أو من عائلتها (تفاحة ← تفاحات)، وترجمتُها (Apple)، وأن تكتب الكلمةَ بطريقةٍ أخرى.") +
      r("✂️ ٣) الحذف", "التلميحاتُ المتطابقة تُحذف <b style='display:inline'>كلُّها</b> — «البحر» و«بحر» و«بحـــر» واحد (نتجاهل «ال» والهمزات والتاء المربوطة والتشكيل). ثمّ يراجع الملمّحون ما بقي ويشطبون المخالف، ويُحذف ما شطبه أكثرُ من نصفهم.") +
      r("🎯 ٤) التخمين", "يرى المخمّنُ ما نجا، فيكتب تخمينًا واحدًا أو يتخطّى — ويرى البقيّةُ ما يكتبه حرفًا حرفًا! والخطأُ الإملائيُّ الصغير في الكلمات الطويلة يُقبل.") +
      r("⭐ النقاط", "إصابة = نقطة. خطأ = تضيع البطاقةُ والتي بعدها (وإن كانت الأخيرة خُصمت نقطة). تخطٍّ = تضيع البطاقةُ وحدها.") +
      r("🏆 التصنيف", "١٣ أسطوري 🏆 · ١٠–١٢ مذهل 🌟 · ٧–٩ جيّد 👍 · أقلّ: حاولوا التفاهم بشكلٍ أفضل 🤝") +
      r("🤫 الدردشة", "الملمّحون لا يستطيعون كتابة الكلمة السرّيّة ولا تلميحاتهم في الدردشة قبل الكشف — الموقعُ يمنعها.");
  }
  $("rulesBtn").onclick = () => { $("rulesBody").innerHTML = rulesHTML(); openModal("rulesModal"); };

  /* ══════════ النهاية ══════════ */
  const RES_IC = { correct: "✅", wrong: "❌", skip: "⏭️", empty: "🫥" };
  function onEnd(res) {
    const r = res.rating || { id: "try", icon: "🤝", ar: "", line: "" };
    $("endRating").className = "rating " + (r.id || "");
    $("endRating").innerHTML = '<div class="ic">' + r.icon + '</div><div class="ar">' + esc(r.ar) + "</div>" +
      '<div class="sc">' + AR(res.score) + " من " + AR(res.cards) + "</div>" + (r.line ? '<div class="ln">' + esc(r.line) + "</div>" : "");
    const names = res.names || {};
    $("endHist").innerHTML = (res.history || []).map((h, i) =>
      '<div class="hrow"><span>' + (RES_IC[h.result] || "•") + '</span><span class="w">' + esc(h.secret || "—") + "</span>" +
      '<span class="hw">' + AR(i + 1) + ". " + esc(names[h.guesser] || "") + (h.guess && h.result !== "correct" ? " — التخمين: " + esc(h.guess) : "") + "</span></div>").join("") ||
      '<div class="sub">لم تُكشف جولة</div>';
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(res.score >= 10 ? "ok" : "round");
  }
  onClose.endModal = () => {
    if (!ended) return;
    ended = false;
    if (!LOBBY || !LOBBY.playing) toLobby();
  };
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  /* ══════════ الدردشة: شريطٌ تحت (كلودو) ══════════ */
  const PHRASES = ["السلام عليكم 👋", "يلا يا فريق 💪", "تلميح عبقري 🧠", "أحسنت! 👏",
                   "معليش 😅", "هههههه 😂", "ركّز يا بطل 🤔", "يا ساتر! 😱",
                   "مشكورين 🙏", "فريق أسطوري 🏆", "يلا بسرعة ⏳", "أنا جاهز ✋"];
  const EMOJI = ["😂", "😎", "😍", "🤯", "😭", "🥳", "😱", "🤔", "👍", "👏", "🔥", "💪", "🤝", "🙈", "🧠", "❤️"];
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
    const chip = $("team").querySelector('[data-id="' + id + '"]');
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
    else { d.innerHTML = "<b>" + esc(m.name) + ":</b> " + esc(m.text); d.querySelector("b").style.color = colorOf(m.id); }
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
  socket = io("/justone");
  const invite = new URLSearchParams(location.search).get("r");
  /* رابطُ دعوة: الرمزُ من الرابط فلا خانةَ له، والزرُّ بعرض البطاقة (كان الرقمُ
     يُقصّ في الجوال)، والرقمُ معزولٌ اتّجاهيًّا كي لا يلتصق بالنصّ العربيّ */
  const BIDI = s => "⁨" + s + "⁩";
  if (invite) {
    const code = invite.trim().slice(0, 6);
    $("pRoom").value = code;
    $("pRoom").style.display = "none";
    $("createBtn").style.display = "none";
    $("joinBtn").textContent = "🚪 ادخل الغرفة " + BIDI(code);
    document.querySelector(".divider").textContent = "— دعوة لغرفة " + BIDI(code) + " —";
  }
  /* دعوةٌ لغرفةٍ انتهت: تعود الخانةُ وزرُّ الإنشاء */
  function inviteFailed() {
    if (!invite) return;
    $("pRoom").style.display = "";
    $("createBtn").style.display = "";
    $("joinBtn").textContent = "انضمام 🚪";
    document.querySelector(".divider").textContent = "— أو انضم لغرفة موجودة —";
  }

  socket.on("hello", h => {
    DEFAULTS = h.defaults;
    OPTS = { clueSecs: h.clueSecs || OPTS.clueSecs, guessSecs: h.guessSecs || OPTS.guessSecs };
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
    socket.emit("joinRoom", { name: n, roomId: r }, res => {
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
    try { localStorage.setItem("joResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    if (first && !VIEW) showScreen("lobby");
  }
  /* مع كلّ «hello» — أي مع كلّ اتّصالٍ أو إعادة اتّصال */
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("joResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("joResume"); } catch (e) {} return; }
      const back = !!ROOM;
      enter(res);
      if (!back) toast("رجعت للغرفة 👋");
    });
  }

  socket.on("lobby", L => renderLobby(L));
  socket.on("state", v => onState(v));
  socket.on("started", () => {
    ended = false;
    $("endModal").classList.remove("on");
    stageKey = ""; liveText = "";
    addMsg("🔤 بدأت اللعبة — بالتوفيق يا فريق!", true);
  });
  socket.on("matchEnd", res => { ended = true; setTimeout(() => { if (ended) onEnd(res); }, 600); });
  socket.on("typing", d => {
    if (!VIEW || VIEW.phase !== "guess" || d.by !== VIEW.guesser) return;
    liveText = String(d.text || "");
    paintLive();
  });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", list => { $("msgs").innerHTML = ""; list.forEach(m => addMsg(m, false, true)); });
  socket.on("toast", t => toast(t));
  socket.on("kicked", () => {
    try { localStorage.removeItem("joResume"); } catch (e) {}
    alert("تم إخراجك من الغرفة"); location.href = "/justone/";
  });
  $("roomChip").onclick = () => {
    const link = location.origin + "/justone/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
