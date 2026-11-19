/* 🔐 «فكّ الشفرة» — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. وما يصله محجوبٌ على
 * الخادم أصلًا — كلماتُ الخصم وشفرتُه وورقةُ تخمينه لا تصل، لا أنّها تصل
 * وتُخفى.
 *
 * اللعبةُ ثقيلةٌ على الذاكرة، فالواجهةُ «مساعدٌ شخصيّ»: تبويبتان —
 *   🛡️ فريقي: رموزُنا، وكلماتُنا الأربع، وجولتُنا (التلميح أو الفكّ أو الكشف)،
 *      وجدولُ تلميحاتنا السابقة تحت أرقامها.
 *   🕵️ اختراق الخصم: رموزُه، وجولتُه (الاعتراض أو الكشف)، وأعمدتُه الأربعة
 *      بعلامات استفهام — وتحت كلٍّ تلميحاتُه السابقة مفرزةً بشفراتها، وخانةٌ
 *      لتخمينك كلمتَه (تُحفظ في جهازك وحده).
 *
 * والأجزاءُ التي يُكتب فيها (التلميحات، وملاحظاتُ الأعمدة) تُبنى مرّةً لكلّ
 * مرحلة ثمّ تُحدَّث حولها — كي لا تُمحى الخانةُ تحت أصابع صاحبها.
 */
(function () {
  "use strict";
  const N = window.JNORM;
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const AR = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
  const TEAM = ["الأزرق", "الوردي"], TCLS = ["tb", "tp"], TICON = ["🔵", "🌸"];

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let LOBBY = null, VIEW = null, SKEW = 0, DEFAULTS = null, settings = null;
  let OPTS = { clueSecs: [60, 90, 120, 180, 0], guessSecs: [60, 90, 120, 180, 0], sandSecs: 45 };
  let ended = false, lastTick = -1, TAB = "mine", CH = "team";
  let mineKey = "", enemyKey = "", gridSig = ["", ""], gridRounds = [0, 0];

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
  const digit = (n, sm) => n ? '<span class="dcDig n' + n + (sm ? " sm" : "") + '">' + AR(n) + "</span>" : '<span class="dcDig blank' + (sm ? " sm" : "") + '">؟</span>';
  const codeHTML = (c, sm) => '<div class="dcCode">' + [0, 1, 2].map(i => digit(c && c[i], sm)).join('<span class="sep">-</span>') + "</div>";
  /* بمسافاتٍ حول الشَّرطة: أرقامٌ عربيّةٌ ملتصقةٌ تُعرض يسارًا إلى يمين كرقمٍ واحد
     (٣-١-٤ تظهر ٤-١-٣ مقلوبة)، ومنفصلةً تُقرأ من اليمين كبقيّة الصفحة */
  const codeText = c => (c || []).map(x => x ? AR(x) : "؟").join(" - ");
  const tokHTML = tk => '<span class="dcToks">' +
    [0, 1].map(i => '<span class="dcTok int' + (tk.intercept > i ? " on" : "") + '" title="اعتراض">' + (tk.intercept > i ? "✓" : "") + "</span>").join("") +
    [0, 1].map(i => '<span class="dcTok mis' + (tk.miscommunication > i ? " on" : "") + '" title="سوء فهم">' + (tk.miscommunication > i ? "✕" : "") + "</span>").join("") + "</span>";

  /* أصواتٌ مركّبة: لا ملفّات تُحمَّل */
  let AC = null, SND = true;
  try { SND = localStorage.getItem("dcSnd") !== "0"; } catch (e) {}
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
      else if (kind === "round") { tone(520, 0, .12, "sine", .07); tone(780, .1, .16, "sine", .07); }
      else if (kind === "pop") tone(980, 0, .06, "sine", .05);
      else if (kind === "lock") { tone(400, 0, .07, "square", .04); tone(600, .07, .1, "square", .04); }
      else if (kind === "tick") tone(1180, 0, .045, "square", .03);
      else tone(440, 0, .1, "sine", .06);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => {
    SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇";
    try { localStorage.setItem("dcSnd", SND ? "1" : "0"); } catch (e) {}
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
    VIEW = null; mineKey = ""; enemyKey = "";
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
    const box = $("dcTeams");
    box.innerHTML = "";
    for (let t = 0; t < 2; t++) {
      const ps = L.players.filter(p => p.team === t);
      const n = ps.filter(p => !p.gone).length;
      const col = document.createElement("div");
      col.className = "dcTeamCol " + TCLS[t];
      col.innerHTML = '<div class="hd">' + TICON[t] + " الفريق " + TEAM[t] + " <small>(" + AR(n) + "/" + AR(L.teamMax || 4) + ")</small></div>";
      for (const p of ps) {
        const d = document.createElement("div");
        d.className = "dcLp " + TCLS[t] + (p.id === ME ? " me" : "") + (p.gone ? " gone" : "");
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
      if (!ps.length) col.insertAdjacentHTML("beforeend", '<div class="dcEmpty">لا أحد بعد</div>');
      if (meP && meP.team !== t && n < (L.teamMax || 4)) {
        const j = document.createElement("button");
        j.className = "dcJoinTeam"; j.type = "button";
        j.textContent = "↩️ انتقل إلى " + TEAM[t];
        j.onclick = () => socket.emit("team", { team: t });
        col.appendChild(j);
      }
      box.appendChild(col);
    }
    const here = L.players.filter(p => !p.gone);
    const a = here.filter(p => p.team === 0).length, b = here.filter(p => p.team === 1).length;
    $("plCount").textContent = "(" + AR(here.length) + "/" + AR(L.max) + ")";
    const ready = a >= 2 && b >= 2;
    $("needMore").textContent = ready ? "" : here.length < L.min
      ? "تحتاجون " + AR(L.min) + " لاعبين على الأقلّ (اثنين في كلّ فريق) — انسخوا رابط الدعوة من الأعلى 🔗"
      : "لكلّ فريقٍ لاعبان على الأقلّ — انتقلوا أو وزّعوا عشوائيًّا";
    $("startBtn").disabled = !ready;
    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    $("lobbySummary").innerHTML = summary(settings) + (lr
      ? "<br>🏁 آخر لعبة: " + (lr.winner == null ? "تعادل 🤝" : "فاز " + TICON[lr.winner] + " الفريق " + TEAM[lr.winner]) : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }
  const secsTxt = s => s ? AR(s) + "ث" : "بلا وقت";
  function summary(S) {
    return "⏱️ التلميح " + secsTxt(S.clueSecs) + " · التخمين " + secsTxt(S.guessSecs) + " · ⏳ ساعةُ الرمل " + AR(OPTS.sandSecs || 45) + "ث";
  }
  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    const segOf = (id, list) => '<div class="seg" id="' + id + '">' + list.map(v => '<button data-v="' + v + '">' + secsTxt(v) + "</button>").join("") + "</div>";
    box.innerHTML =
      '<div class="setRow"><label>✏️ وقت كتابة التلميحات</label>' + segOf("sClue", OPTS.clueSecs) +
        '<div class="hint">وساعةُ الرمل دائمًا: إذا أرسل أحدُ المُشفِّرَين بقي للآخر ' + AR(OPTS.sandSecs || 45) + ' ثانيةً على الأكثر.</div></div>' +
      '<div class="setRow"><label>🔍 وقت الفكّ والاعتراض</label>' + segOf("sGuess", OPTS.guessSecs) +
        '<div class="hint">ينتهي الوقتُ فتُقفل الإجابةُ بما فيها (الناقصةُ خطأ).</div></div>';
    const seg = (id, key) => $(id).querySelectorAll("button").forEach(b => b.onclick = () => push({ [key]: +b.dataset.v }));
    seg("sClue", "clueSecs");
    seg("sGuess", "guessSecs");
  }
  function push(d) { Object.assign(settings, d); syncSettings(); socket.emit("updateSettings", d); }
  function syncSettings() {
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    on("sClue", settings.clueSecs); on("sGuess", settings.guessSecs);
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
    if (e.t === "round") {
      snd("round");
      /* جولةٌ جديدة: تبويبةُ فريقي (فيها التلميحُ أو انتظاره) */
      setTab("mine");
      addMsg("🔐 الجولة " + AR(e.round) + " — المُشفِّران: " + e.enc.map((id, t) => TICON[t] + " " + nameOf(id)).join(" و"), true);
    } else if (e.t === "sent") snd("pop");
    else if (e.t === "guess") { snd("round"); }
    else if (e.t === "locked" && e.team === v.myTeam) snd("lock");
    else if (e.t === "reveal") {
      const r = e.res[v.myTeam];
      snd(r && r.decOK && !(e.res[1 - v.myTeam] || {}).intOK ? "ok" : "bad");
    } else if (e.t === "encryptor") {
      toast("🔁 " + nameOf(e.id) + " صار مُشفِّرَ " + TEAM[e.team] + " (" + nameOf(e.was) + " غاب)");
    } else if (e.t === "timeout") {
      if (e.phase === "clues" && e.team === v.myTeam) toast("⏱️ انتهى وقتُ التلميح — مضت الجولةُ بلا تلميحاتكم");
      else if (e.phase === "guess") toast("⏱️ انتهى الوقت — قُفلت الإجابات بما فيها");
    }
  }

  const meP = v => v.players.find(p => p.id === v.me) || {};
  const amEnc = v => !!meP(v).enc;
  const mineSheet = (v, kind) => v.cur && v.cur[v.myTeam] && v.cur[v.myTeam][kind];
  const canEdit = (v, kind) => v.phase === "guess" && !!v.cur && (v.cur[v.myTeam].editors[kind] || []).includes(v.me) &&
    (kind === "dec" || v.intercepting);

  function render(v) {
    const my = v.myTeam, op = 1 - my;
    $("phaseInfo").textContent = (v.phase !== "over" ? "الجولة " + AR(v.round) + "/" + AR(v.maxRounds) + " · " : "") + phaseLine(v);
    /* لونُ فريقي على الصفحة (التبويبتان، والدردشة) */
    document.body.classList.toggle("dc-blue", my === 0);
    document.body.classList.toggle("dc-pink", my === 1);
    $("tabMine").className = "dcTab " + TCLS[my] + (TAB === "mine" ? " on" : "");
    $("tabEnemy").className = "dcTab " + TCLS[op] + (TAB === "enemy" ? " on" : "");
    $("chatCard").className = "card " + TCLS[my] + ($("chatCard").classList.contains("on") ? " on" : "");
    renderHud(v);
    renderBanner(v);
    renderMine(v);
    renderEnemy(v);
    paintBadges(v);
    tickTimer();
  }

  function phaseLine(v) {
    if (v.paused) return "⏸️ بانتظار عودة اللاعبين…";
    switch (v.phase) {
      case "clues": return amEnc(v) && !v.cur[v.myTeam].sent ? "✏️ اكتب تلميحاتك" : "⏳ المُشفِّران يكتبان";
      case "guess": return v.intercepting ? "🔍 فكّوا واعترضوا" : "🔍 فكّوا شفرةَ زميلكم";
      case "reveal": return "🔓 الكشف";
      case "over": return "🏁 انتهت اللعبة";
      default: return "…";
    }
  }

  function renderHud(v) {
    for (let t = 0; t < 2; t++) {
      const el = $(t === 0 ? "scoreA" : "scoreB");
      el.className = "dcScore " + TCLS[t] + (t === v.myTeam ? " mine" : "");
      el.innerHTML = TICON[t] + '<span class="nm">' + TEAM[t] + (t === v.myTeam ? " (أنت)" : "") + "</span>" + tokHTML(v.teams[t].tokens);
    }
    $("dcRound").textContent = "الجولة " + AR(v.round) + "/" + AR(v.maxRounds);
  }

  /* ── اللافتة: ما المطلوب الآن، ومن في الفريقين ── */
  function renderBanner(v) {
    const b = $("dcBanner");
    const my = v.myTeam, op = 1 - my, C = v.cur || [];
    let tt = "", ss = "";
    if (v.paused) { tt = "⏸️ توقّفت الساعة"; ss = "فريقٌ لم يبقَ منه أحدٌ حاضر — بانتظار عودة لاعبيه"; }
    else if (v.phase === "clues") {
      const sent = [0, 1].map(t => C[t].sent ? "✅ أرسل" : "✏️ يكتب…");
      if (amEnc(v) && !C[my].sent) { tt = "✏️ أنت مُشفِّرُ فريقك هذه الجولة"; ss = "اكتب ٣ تلميحات في تبويبة «فريقي» — يفهمها فريقُك ولا يفهمها الخصم"; }
      else { tt = "⏳ المُشفِّران يكتبان التلميحات"; }
      ss = (ss ? ss + "<br>" : "") + TICON[0] + " " + esc(nameOf(C[0].encryptor)) + ": " + sent[0] + " · " + TICON[1] + " " + esc(nameOf(C[1].encryptor)) + ": " + sent[1] +
        (v.sand ? "<br>⏳ <b>ساعةُ الرمل!</b>" : "");
    } else if (v.phase === "guess") {
      const st = (t, k) => C[t][k] ? (C[t][k].locked ? "🔒" : "⏳") : "";
      tt = v.intercepting ? "🔍 فكّوا شفرةَ زميلكم — واعترضوا شفرةَ الخصم" : "🔍 فكّوا شفرةَ زميلكم";
      ss = "فريقُك: الفكّ " + st(my, "dec") + (v.intercepting ? " · الاعتراض " + st(my, "int") : "") +
           " — الخصم: الفكّ " + st(op, "dec") + (v.intercepting ? " · الاعتراض " + st(op, "int") : "");
      if (!v.intercepting) ss += "<br>الجولةُ الأولى بلا اعتراض: لا تلميحاتٍ سابقة للخصم بعد";
    } else if (v.phase === "reveal" || v.phase === "over") {
      const R = v.result && v.result.teams;
      if (R) {
        const line = t => TICON[t] + " " + TEAM[t] + ": " + (R[t].decOK ? "فكّ شفرته ✅" : "سوءُ فهم ❌") +
          (v.intercepting || R[t].int ? (R[t].intOK ? " · اعترض ✅" : "") : "");
        tt = v.phase === "over" ? "🏁 انتهت اللعبة" : "🔓 كُشفت الشفرتان";
        ss = line(0) + "<br>" + line(1);
      }
    }
    const key = v.phase + "|" + v.round;
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.innerHTML = '<div class="tt"></div><div class="ss"></div><div id="dcStrip"></div>' +
        (v.phase === "reveal" ? '<button class="btn btn-violet" id="dcNext" type="button">التالي ▶</button>' : "");
      const nx = $("dcNext");
      if (nx) nx.onclick = () => { nx.disabled = true; socket.emit("next"); };
    }
    b.querySelector(".tt").innerHTML = tt;
    b.querySelector(".ss").innerHTML = ss;
    const nx = $("dcNext");
    if (nx) {
      const me = meP(v);
      const on = v.players.filter(p => p.on);
      nx.disabled = !!me.ready;
      nx.textContent = me.ready ? "✓ بانتظار البقيّة (" + AR(on.filter(p => p.ready).length) + "/" + AR(on.length) + ")" : "التالي ▶";
    }
    renderStrip(v);
  }
  function renderStrip(v) {
    const box = $("dcStrip");
    if (!box) return;
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
      const done = (v.phase === "clues" && p.enc && v.cur[p.team].sent) || (v.phase === "reveal" && p.ready);
      d.className = "dcMate " + TCLS[p.team] + (p.id === v.me ? " me" : "") + (p.on ? "" : " off") + (done ? " done" : "");
      d.querySelector(".role").textContent = p.enc ? "🔐" : "";
      d.title = p.enc ? "المُشفِّر" : "";
    }
  }

  /* شاراتُ التبويبتين: أين ينتظرك فعل */
  function paintBadges(v) {
    const my = v.myTeam;
    let mine = false, enemy = false;
    if (v.phase === "clues" && amEnc(v) && !v.cur[my].sent) mine = true;
    if (v.phase === "guess") {
      const need = k => canEdit(v, k) && mineSheet(v, k) && !mineSheet(v, k).locked && !mineSheet(v, k).ok.includes(v.me);
      mine = need("dec");
      enemy = need("int");
    }
    $("tabMine").querySelector(".dot").classList.toggle("on", mine && TAB !== "mine");
    $("tabEnemy").querySelector(".dot").classList.toggle("on", enemy && TAB !== "enemy");
    $("tabMine").querySelector(".dot").textContent = "!";
    $("tabEnemy").querySelector(".dot").textContent = "!";
  }
  function setTab(t) {
    TAB = t;
    $("paneMine").classList.toggle("on", t === "mine");
    $("paneEnemy").classList.toggle("on", t === "enemy");
    if (VIEW) { $("tabMine").classList.toggle("on", t === "mine"); $("tabEnemy").classList.toggle("on", t === "enemy"); paintBadges(VIEW); }
  }
  $("tabMine").onclick = () => setTab("mine");
  $("tabEnemy").onclick = () => setTab("enemy");
  setTab("mine");

  /* ══════════ 🛡️ فريقي ══════════ */
  function renderMine(v) {
    const my = v.myTeam, T = v.teams[my], C = v.cur[my];
    $("mineToks").innerHTML = "🏅 رموزُ فريقك " + tokHTML(T.tokens) + '<span class="dcTokLbl">✓ اعتراض · ✕ سوءُ فهم</span>';
    const ws = $("mineWords");
    const wsig = (T.words || []).join("|");
    if (ws.dataset.sig !== wsig) {
      ws.dataset.sig = wsig;
      ws.innerHTML = (T.words || []).map((w, i) => '<div class="dcWord n' + (i + 1) + '"><span class="num">' + AR(i + 1) + '</span><div class="w">' + esc(w) + "</div></div>").join("");
    }
    renderGrid("mineGrid", T.log, T.words, false, my);
    const box = $("mineRound");
    const role = amEnc(v) ? "enc" : "an";
    /* بلا «متوقّف» في المفتاح: توقّفُ الساعة لا يمحو ما كتبه المُشفِّر */
    const key = [v.round, v.phase, role, C.sent ? 1 : 0].join("|");
    const build = key !== mineKey;
    mineKey = key;
    if (v.phase === "clues") {
      if (role === "enc" && !C.sent) { if (build) buildClueInput(v, box); }
      else if (build) {
        box.innerHTML = role === "enc"
          ? '<div class="tt">✅ أرسلتَ تلميحاتك</div>' + codeHTML(C.code) + sentRows(C.clues, C.code) +
            '<div class="ss">بانتظار مُشفِّر الخصم — ثمّ تُعرض التلميحاتُ للفريقين معًا</div>'
          : '<div class="dcWait">✍️</div><div class="tt">' + esc(nameOf(C.encryptor)) + " يكتب تلميحاتِ فريقكم…</div>" +
            '<div class="ss">ستظهر هنا فتفكّون شفرتَه من كلماتكم الأربع — ولا تصلكم الشفرةُ نفسُها</div>';
      }
    } else if (v.phase === "guess") {
      box.innerHTML = '<div class="tt">' + (role === "enc" ? "🤐 فريقُك يفكّ شفرتَك — راقب بصمت" : "🔍 فكّوا شفرةَ " + esc(nameOf(C.encryptor))) + "</div>" +
        (role === "enc" ? codeHTML(C.code, true) : '<div class="ss">لكلّ تلميحٍ رقمُ الكلمة التي يشير إليها — اتّفقوا في دردشة الفريق ثمّ وافقوا جميعًا</div>') +
        sheetHTML(v, "dec", C.clues, C.dec, role !== "enc", role === "enc" ? C.code : null);
      wireSheet(box, "dec");
    } else if (v.phase === "reveal" || v.phase === "over") {
      if (build || v.phase === "over") box.innerHTML = revealMine(v);
    }
  }

  function sentRows(clues, code) {
    return '<div class="dcSheet">' + (clues || []).map((c, i) =>
      '<div class="dcRow"><div class="dcClue">' + esc(c) + '</div>' + digit(code && code[i], true) + "</div>").join("") + "</div>";
  }

  /* كتابةُ التلميحات الثلاثة: كلُّ خانةٍ بلون رقمها وأمامها كلمتُه */
  function buildClueInput(v, box) {
    const C = v.cur[v.myTeam], words = v.teams[v.myTeam].words || [];
    box.innerHTML = '<div class="tt">🔐 شفرتُك هذه الجولة</div>' + codeHTML(C.code) +
      '<div class="ss">اكتب لكلّ رقمٍ تلميحًا بكلمةٍ واحدة يدلّ على كلمته — بالترتيب</div>' +
      '<div class="dcClueRows">' + C.code.map((n, i) =>
        '<div class="dcClueRow n' + n + '">' + digit(n, true) + '<span class="for">← ' + esc(words[n - 1] || "") + "</span>" +
        '<input class="dcClueIn" maxlength="24" autocomplete="off" data-i="' + i + '" placeholder="تلميح ' + AR(i + 1) + '"></div>').join("") +
      '</div><div class="dcWarn" id="clueWarn"></div>' +
      '<button class="btn btn-violet" id="clueSend" type="button" style="width:auto; padding:12px 30px">🔐 أرسل الشفرة</button>';
    const ins = [...box.querySelectorAll("input.dcClueIn")];
    const check = () => {
      const vals = ins.map(i => i.value.trim());
      let bad = null;
      const used = new Set();
      for (const e of v.teams[v.myTeam].log) for (const c of e.clues) used.add(N.norm(c));
      ins.forEach((inp, i) => {
        const t = vals[i];
        let why = null;
        if (t) {
          if (N.isMulti(t) || /\s/.test(t)) why = "كلُّ تلميحٍ كلمةٌ واحدة — بلا مسافات";
          else if (!N.norm(t)) why = "اكتب حروفًا لا رموزًا";
          else if (words.some(w => N.related(t, w))) why = "«" + t + "» إحدى كلماتكم أو من عائلتها";
          else if (vals.some((x, j) => j !== i && x && N.norm(x) === N.norm(t))) why = "التلميحاتُ الثلاثة مختلفة";
          else if (used.has(N.norm(t))) why = "«" + t + "» استُعملت في جولةٍ سابقة";
        }
        inp.classList.toggle("bad", !!why);
        if (why && !bad) bad = why;
      });
      $("clueWarn").textContent = bad || "";
      $("clueSend").disabled = !!bad || vals.some(x => !x);
      return !bad && vals.every(Boolean);
    };
    ins.forEach((inp, i) => {
      inp.addEventListener("input", check);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (ins[i + 1]) ins[i + 1].focus(); else $("clueSend").click(); } });
    });
    $("clueSend").onclick = () => {
      if (!check()) return;
      $("clueSend").disabled = true;
      socket.emit("clues", { list: ins.map(i => i.value.trim()) });
      setTimeout(() => { const b = $("clueSend"); if (b) b.disabled = false; }, 1500);
    };
    check();
    setTimeout(() => { try { ins[0].focus(); } catch (e) {} }, 60);
  }

  /** ورقةُ التخمين: كلُّ تلميحٍ وأمامه الأرقام الأربعة؛ ثمّ الموافقات */
  function sheetHTML(v, kind, clues, S, editable, trueCode) {
    const my = v.myTeam;
    if (!S) return "";
    const draft = S.draft || S.final || [null, null, null];
    const ro = !editable || S.locked;
    let h = '<div class="dcSheet" data-kind="' + kind + '">';
    (clues || []).forEach((c, i) => {
      const val = draft[i];
      h += '<div class="dcRow"><div class="dcClue' + (c === "—" ? " auto" : "") + '">' + esc(c) + "</div>" +
        '<div class="dcPick' + (ro ? " ro" : "") + '">' +
        [1, 2, 3, 4].map(n => '<button type="button" class="n' + n + (val === n ? " on" : "") + '" data-i="' + i + '" data-n="' + n + '"' + (ro ? " disabled" : "") + ">" + AR(n) + "</button>").join("") +
        "</div>" + (trueCode ? '<span class="mark">' + (val == null ? "" : val === trueCode[i] ? "✅" : "❌") + "</span>" : "") + "</div>";
    });
    h += "</div>";
    const eds = (v.cur[my].editors[kind] || []).filter(id => { const p = playerOf(id); return p && p.on; });
    const okSet = new Set(S.ok || []);
    if (S.locked) h += '<div class="dcLocked">🔒 قُفلت إجابتُكم: ' + codeText(S.final) + (S.auto ? " (انتهى الوقت)" : "") + "</div>";
    else {
      const full = draft.every(x => x) && new Set(draft).size === 3;
      h += '<div class="dcAgree"><span class="who">' + eds.map(id => avatar(id, nameOf(id), okSet.has(id) ? "ok" : "")).join("") + "</span>";
      if (editable) {
        const mineOk = okSet.has(v.me);
        h += '<button class="btn ' + (mineOk ? "btn-ghost" : "btn-green") + '" type="button" data-agree="' + (mineOk ? 0 : 1) + '"' +
             (!full && !mineOk ? " disabled" : "") + ">" + (mineOk ? "↩️ تراجع عن الموافقة" : "👍 موافق") + "</button>";
      }
      h += '<span class="dcTokLbl">' + AR(okSet.size) + "/" + AR(eds.length) + " وافقوا" + (full ? "" : " · أكملوا الأرقام الثلاثة") + "</span></div>";
    }
    return h;
  }
  function wireSheet(box, kind) {
    box.querySelectorAll('.dcSheet[data-kind="' + kind + '"] .dcPick button').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      const on = b.classList.contains("on");
      socket.emit("slot", { kind, slot: +b.dataset.i, value: on ? null : +b.dataset.n });
    });
    const ag = box.querySelector("[data-agree]");
    if (ag) ag.onclick = () => { ag.disabled = true; socket.emit("confirm", { kind, on: ag.dataset.agree === "1" }); };
  }

  /* الكشف في تبويبة فريقي: شفرتُنا، وفكُّنا، واعتراضُ الخصم لها */
  function revealMine(v) {
    const my = v.myTeam, op = 1 - my;
    const R = v.result && v.result.teams;
    if (!R) return "";
    const me = R[my], them = R[op];
    return '<div class="tt">🔓 شفرتُنا كانت</div>' + codeHTML(me.code) + sentRows(me.clues, me.code) +
      '<div class="dcRes">' +
        '<div class="dcResLine ' + (me.decOK ? "good" : "bad") + '"><span>🔍 فكُّنا: ' + codeText(me.dec) + "</span><b>" + (me.decOK ? "✅ أصبنا" : "❌ سوءُ فهم") + "</b></div>" +
        (them.int ? '<div class="dcResLine ' + (them.intOK ? "bad" : "good") + '"><span>🕵️ اعتراضُ ' + TEAM[op] + ": " + codeText(them.int) + "</span><b>" + (them.intOK ? "😱 اعترضوها!" : "🛡️ لم يعترضوها") + "</b></div>" : "") +
      "</div>";
  }

  /* ══════════ 🕵️ اختراق الخصم ══════════ */
  function renderEnemy(v) {
    const my = v.myTeam, op = 1 - my, T = v.teams[op], C = v.cur[op];
    $("enemyToks").innerHTML = TICON[op] + " رموزُ " + TEAM[op] + " " + tokHTML(T.tokens) + '<span class="dcTokLbl">كلماتُهم مخفيّة — تلميحاتُهم تفضحها</span>';
    renderGrid("enemyGrid", T.log, T.words, true, op);
    const box = $("enemyRound");
    const key = [v.round, v.phase].join("|");
    const build = key !== enemyKey;
    enemyKey = key;
    if (v.phase === "clues") {
      if (build) box.innerHTML = '<div class="dcWait">🕵️</div><div class="tt">' + esc(nameOf(C.encryptor)) + " يكتب تلميحاتِ " + TEAM[op] + "…</div>" +
        '<div class="ss">' + (v.round >= 2 ? "ستظهر هنا فتعترضون شفرتَه من تلميحاتهم السابقة في الأعمدة تحت" : "الجولةُ الأولى: لاحظوا تلميحاتهم فقط — الاعتراضُ من الجولة الثانية") + "</div>";
    } else if (v.phase === "guess") {
      const mineInt = v.cur[my].int;
      if (!v.intercepting) {
        box.innerHTML = '<div class="tt">👀 تلميحاتُ ' + TEAM[op] + '</div><div class="ss">لا اعتراضَ في الجولة الأولى — احفظوها: ستُفرز تحت أرقامها بعد الكشف</div>' +
          '<div class="dcSheet">' + (C.clues || []).map(c => '<div class="dcRow"><div class="dcClue' + (c === "—" ? " auto" : "") + '">' + esc(c) + "</div></div>").join("") + "</div>";
      } else {
        box.innerHTML = '<div class="tt">🕵️ اعترضوا شفرةَ ' + TEAM[op] + "</div>" +
          '<div class="ss">خمّنوا رقمَ كلّ تلميح من أعمدتهم تحت — الإصابةُ الكاملة = اعتراض ✅</div>' +
          sheetHTML(v, "int", C.clues, mineInt, canEdit(v, "int"), null);
        wireSheet(box, "int");
      }
    } else if (v.phase === "reveal" || v.phase === "over") {
      if (build || v.phase === "over") box.innerHTML = revealEnemy(v);
    }
  }
  function revealEnemy(v) {
    const my = v.myTeam, op = 1 - my;
    const R = v.result && v.result.teams;
    if (!R) return "";
    const me = R[my], them = R[op];
    return '<div class="tt">🔓 شفرةُ ' + TEAM[op] + " كانت</div>" + codeHTML(them.code) + sentRows(them.clues, them.code) +
      '<div class="dcRes">' +
        (me.int ? '<div class="dcResLine ' + (me.intOK ? "good" : "bad") + '"><span>🕵️ اعتراضُنا: ' + codeText(me.int) + "</span><b>" + (me.intOK ? "✅ اعترضناها!" : "❌ لم نصب") + "</b></div>" : "") +
        '<div class="dcResLine ' + (them.decOK ? "" : "good") + '"><span>🔍 فكُّهم: ' + codeText(them.dec) + "</span><b>" + (them.decOK ? "فكّوها" : "😅 أساؤوا الفهم") + "</b></div>" +
      "</div>";
  }

  /* ══════════ الجدولان: التلميحاتُ تحت أرقامها ══════════ */
  /* ملاحظاتُ أعمدة الخصم: في هذا الجهاز وحده، لهذه المباراة */
  let NOTES = ["", "", "", ""];
  function loadNotes() {
    try {
      const s = JSON.parse(localStorage.getItem("dcNotes") || "null");
      if (s && s.room === ROOM && Date.now() - (s.at || 0) < 6 * 3600 * 1000) NOTES = (s.notes || []).concat(["", "", "", ""]).slice(0, 4);
    } catch (e) {}
  }
  function saveNotes() { try { localStorage.setItem("dcNotes", JSON.stringify({ room: ROOM, at: Date.now(), notes: NOTES })); } catch (e) {} }

  function renderGrid(id, log, words, enemy, team) {
    const g = $(id);
    if (!g.dataset.built) {
      g.dataset.built = "1";
      g.innerHTML = [1, 2, 3, 4].map(n =>
        '<div class="dcCol n' + n + '"><div class="hd"><span class="num">' + AR(n) + '</span><span class="wd"></span></div>' +
        (enemy ? '<input class="dcNote" maxlength="20" data-n="' + n + '" placeholder="كلمتُهم؟">' : "") +
        '<div class="lst"></div></div>').join("");
      if (enemy) g.querySelectorAll("input.dcNote").forEach(inp => {
        inp.value = NOTES[+inp.dataset.n - 1] || "";
        inp.addEventListener("input", () => { NOTES[+inp.dataset.n - 1] = inp.value; saveNotes(); });
      });
    }
    g.querySelectorAll(".dcCol").forEach((col, i) => {
      col.querySelector(".wd").textContent = enemy ? (words ? words[i] : "؟") : (words ? words[i] : "");
    });
    const sig = team + ":" + JSON.stringify(log || []);
    const k = id === "mineGrid" ? 0 : 1;
    if (gridSig[k] === sig) return;
    /* ما أُضيف منذ آخر رسم يومض (لا في أوّل رسمٍ بعد العودة) */
    const prevRounds = gridSig[k] ? gridRounds[k] : Infinity;
    gridSig[k] = sig; gridRounds[k] = (log || []).length;
    const cols = [[], [], [], []];
    for (const e of log || []) e.code.forEach((n, i) => cols[n - 1].push({ c: e.clues[i], r: e.round, fresh: e.round > prevRounds }));
    g.querySelectorAll(".dcCol").forEach((col, i) => {
      const lst = col.querySelector(".lst");
      lst.innerHTML = cols[i].length ? cols[i].map(x =>
        '<div class="dcChip' + (x.c === "—" ? " auto" : "") + (x.fresh ? " new" : "") + '">' + esc(x.c) + "<small>ج" + AR(x.r) + "</small></div>").join("")
        : '<div class="dcNone">' + (enemy ? "لا تلميحاتٍ بعد" : "—") + "</div>";
    });
  }
  function resetGrids() {
    for (const id of ["mineGrid", "enemyGrid"]) { $(id).dataset.built = ""; $(id).innerHTML = ""; }
    gridSig = ["", ""]; gridRounds = [0, 0];
    $("mineWords").dataset.sig = "";
  }

  /* ── المؤقّت ── */
  function tickTimer() {
    const v = VIEW;
    const bar = $("tbar"), sec = $("tsec");
    bar.classList.toggle("sand", !!(v && v.sand));
    if (!v || v.phase === "over" || v.paused || !v.deadline) {
      bar.firstElementChild.style.width = v && v.paused ? "100%" : v && v.phase !== "over" ? "100%" : "0%";
      bar.classList.toggle("paused", !!(v && v.paused));
      bar.classList.toggle("none", !!(v && !v.paused && v.phase !== "over" && !v.deadline));
      bar.classList.remove("hurry");
      sec.textContent = v && v.paused ? "⏸️" : v && v.phase !== "over" && !v.deadline ? "∞" : "—";
      return;
    }
    bar.classList.remove("paused", "none");
    const left = Math.max(0, v.deadline - (Date.now() + SKEW));
    const pct = Math.max(0, Math.min(100, left / (v.total || 1) * 100));
    bar.firstElementChild.style.width = pct.toFixed(1) + "%";
    const s = Math.ceil(left / 1000);
    sec.textContent = AR(s);
    const hurry = left <= 10000 && v.phase !== "reveal";
    bar.classList.toggle("hurry", hurry && !v.sand);
    const mine = (v.phase === "clues" && amEnc(v) && !v.cur[v.myTeam].sent) ||
      (v.phase === "guess" && ["dec", "int"].some(k => canEdit(v, k) && mineSheet(v, k) && !mineSheet(v, k).locked));
    if (hurry && s !== lastTick && s > 0 && s <= 5 && mine) { lastTick = s; snd("tick"); }
  }
  setInterval(tickTimer, 200);

  /* ══════════ القواعد ══════════ */
  function rulesHTML() {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    return r("🎯 الفكرة", "فريقان (أزرق ووردي)، لكلٍّ ٤ كلماتٍ سرّيّة مرقّمة من ١ إلى ٤ لا يراها الخصم أبدًا. لمّحوا لفريقكم بما يفهمه… ولا يفهمه الخصم.") +
      r("🔐 ١) الشفرة", "في كلّ جولةٍ يتناوب واحدٌ من كلّ فريق على دور «المُشفِّر»، فتصله وحده شفرةٌ من ثلاثة أرقامٍ مختلفة (٣-١-٤ مثلًا).") +
      r("✏️ ٢) التلميح", "يكتب ثلاثةَ تلميحات بالترتيب — كلمةً واحدةً لكلّ رقمٍ تدلّ على الكلمة بذلك الرقم. ممنوع: الكلمةُ نفسها أو من عائلتها، وتلميحٌ استُعمل من قبل. وإذا أرسل أحدُ المُشفِّرَين قلبت ساعةُ الرمل: ٤٥ ثانيةً للآخر.") +
      r("📢 ٣) البثّ", "حين يرسل المُشفِّران تُعرض التلميحاتُ الستّة على الفريقين معًا — بلا أرقامها.") +
      r("🔍 ٤) الفكّ والاعتراض", "كلُّ فريقٍ يخمّن شفرةَ زميله من كلماته الأربع (والمُشفِّرُ صامتٌ لا يشارك)، ومن الجولة الثانية يحاول أيضًا اعتراضَ شفرة الخصم من تلميحاته السابقة. الإجابةُ ورقةٌ مشتركة: كلُّ من يحقّ له يغيّر الأرقام، وتُقفل حين يوافق الحاضرون جميعًا.") +
      r("🏅 ٥) الكشف والرموز", "اعترضتم شفرةَ الخصم بالضبط ⇒ اعتراض ✓. أخطأتم في شفرة زميلكم ⇒ سوءُ فهم ✕.") +
      r("🏆 الفوز", "اعتراضان ⇒ يفوز الفريقُ فورًا. سوءا فهم ⇒ يخسر فورًا. وبعد الجولة الثامنة: الأكثرُ اعتراضًا، ثمّ الأقلُّ سوءَ فهم، وإلا فتعادل.") +
      r("🗂️ المساعد", "لا ورقةَ ولا قلم: تبويبة «اختراق الخصم» تفرز تلميحاته تحت أرقامها بعد كلّ كشف، وفيها خانةٌ فوق كلّ عمودٍ تكتب فيها تخمينك لكلمتهم (تبقى في جهازك).") +
      r("💬 الدردشة", "دردشةُ «فريقي» سرّيّةٌ لا يراها الخصم، و«الكلّ» للجميع (ولا تُكتب فيها كلماتُ فريقك). والمُشفِّرُ صامتٌ من بداية الجولة حتى يقفل فريقُه فكَّ شفرته.");
  }
  $("rulesBtn").onclick = () => { $("rulesBody").innerHTML = rulesHTML(); openModal("rulesModal"); };

  /* ══════════ النهاية ══════════ */
  const REASON = {
    intercept: "اخترق شفرةَ الخصم مرّتين 🕵️", miscommunication: "الخصمُ أساء فهمَ نفسه مرّتين 😅",
    rounds: "انتهت الجولاتُ الثماني", both: "انتهت بالتزامن — والحكمُ لعدد الرموز", forfeit: "انسحب الفريقُ الآخر"
  };
  function onEnd(res) {
    const myT = VIEW ? VIEW.myTeam : teamOfId(ME);
    const w = res.winner;
    const win = $("endWin");
    win.className = "dcWin" + (w != null ? " " + TCLS[w] : "");
    win.innerHTML = '<div class="ic">' + (w == null ? "🤝" : w === myT ? "🏆" : "🔓") + '</div><div class="ar">' +
      (w == null ? "تعادل!" : (w === myT ? "فاز فريقُك — " : "فاز ") + TICON[w] + " الفريق " + TEAM[w]) + "</div>" +
      '<div class="ln">' + esc(REASON[res.reason] || "") + " · " + res.teams.map((T, t) => TICON[t] + " ✓" + AR(T.tokens.intercept) + " ✕" + AR(T.tokens.miscommunication)).join(" · ") + "</div>";
    $("endWords").innerHTML = res.teams.map((T, t) => '<div class="dcEndTeam ' + TCLS[t] + '"><div class="hd">' + TICON[t] + " " + TEAM[t] + "</div>" +
      '<div class="wl">' + T.words.map((x, i) => '<span class="n' + (i + 1) + '"><i>' + AR(i + 1) + "</i>" + esc(x) + "</span>").join("") + "</div></div>").join("");
    const names = res.names || {};
    $("endHist").innerHTML = (res.history || []).map(h => '<div class="hrow"><b>الجولة ' + AR(h.round) + "</b>" +
      h.teams.map((x, t) => '<div class="ln2 ' + TCLS[t] + '"><span class="tag">' + TICON[t] + " " + esc(names[x.encryptor] || "") + "</span>" +
        esc(x.clues.join(" · ")) + " ⇐ " + codeText(x.code) + " " + (x.decOK ? "✅" : "❌") + (x.intOK ? " · اعترض ✓" : "") + "</div>").join("") + "</div>").join("") ||
      '<div class="sub">لم تُكشف جولة</div>';
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(w === myT ? "ok" : "round");
  }
  onClose.endModal = () => {
    if (!ended) return;
    ended = false;
    if (!LOBBY || !LOBBY.playing) toLobby();
  };
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  /* ══════════ الدردشة: «فريقي» السرّيّة و«الكلّ» ══════════ */
  const PHRASES = ["السلام عليكم 👋", "يلا يا فريق 💪", "تلميح عبقري 🧠", "أحسنت! 👏",
                   "معليش 😅", "هههههه 😂", "ركّزوا يا جماعة 🤔", "اعترضناهم! 🕵️",
                   "مشكورين 🙏", "موافق ✅", "يلا بسرعة ⏳", "أنا جاهز ✋"];
  const EMOJI = ["😂", "😎", "😍", "🤯", "😭", "🥳", "😱", "🤔", "👍", "👏", "🔥", "💪", "🤝", "🙈", "🧠", "🔐"];
  const sendChat = t => socket.emit("chat", { text: t, team: !!VIEW && CH === "team" });
  (function buildQuick() {
    const qp = $("quickPop");
    const phr = document.createElement("div"); phr.className = "phr";
    const emo = document.createElement("div"); emo.className = "emo";
    const send = t => { sendChat(t); qp.classList.remove("on"); };
    for (const t of PHRASES) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", () => send(t)); phr.appendChild(b); }
    for (const t of EMOJI) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", () => send(t)); emo.appendChild(b); }
    qp.appendChild(phr); qp.appendChild(emo);
  })();
  function setChan(c) {
    CH = c;
    $("dcChans").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.ch === c));
    $("chatInput").placeholder = c === "team" ? "رسالةٌ سرّيّة لفريقك…" : "رسالةٌ للجميع…";
  }
  $("dcChans").querySelectorAll("button").forEach(b => b.onclick = () => setChan(b.dataset.ch));
  setChan("team");
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
    $("dcChans").classList.toggle("on", !!VIEW);
    if (on) { unread = 0; paintUnread(); $("msgs").scrollTop = $("msgs").scrollHeight; }
  };
  $("chatClose").onclick = () => $("chatCard").classList.remove("on");
  document.addEventListener("pointerdown", e => {
    if (!e.target || !e.target.closest) return;
    if (!e.target.closest("#quickPop") && !e.target.closest("#quickBtn")) $("quickPop").classList.remove("on");
  });
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u;
  function bubble(id, text) {
    const chip = document.querySelector('#dcStrip [data-id="' + id + '"]');
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
    else {
      const t = teamOfId(m.id);
      d.innerHTML = (m.team != null ? '<span class="ch ' + TCLS[m.team] + '">👥 فريق</span>' : "") + "<b>" + esc(m.name) + ":</b> " + esc(m.text);
      d.querySelector("b").style.color = t === 1 ? "var(--pkd)" : "var(--bld)";
    }
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
    sendChat(t);
    $("chatInput").value = "";
  };

  /* ══════════ الاتّصال والدخول ══════════ */
  socket = io("/decrypto");
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
    OPTS = { clueSecs: h.clueSecs || OPTS.clueSecs, guessSecs: h.guessSecs || OPTS.guessSecs, sandSecs: h.sandSecs || 45 };
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
    /* رمزُ هذا الجهاز لتلك الغرفة: من خرج من لعبةٍ جارية يعود إلى مقعده */
    let token = null;
    try { const s = JSON.parse(localStorage.getItem("dcResume") || "null"); if (s && s.room === r) token = s.token; } catch (e) {}
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
    try { localStorage.setItem("dcResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    loadNotes();
    if (first && !VIEW) showScreen("lobby");
  }
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("dcResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("dcResume"); } catch (e) {} return; }
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
    mineKey = ""; enemyKey = "";
    resetGrids();
    NOTES = ["", "", "", ""]; saveNotes();
    $("msgs").innerHTML = "";
    setChan("team");
    addMsg("🔐 بدأت اللعبة — دردشةُ «فريقي» سرّيّةٌ لا يراها الخصم", true);
  });
  socket.on("matchEnd", res => { ended = true; setTimeout(() => { if (ended) onEnd(res); }, 900); });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", log => {
    $("msgs").innerHTML = "";
    const list = [...(log.all || []), ...(log.team || [])].sort((a, b) => a.at - b.at);
    list.forEach(m => addMsg(m, false, true));
  });
  socket.on("toast", t => toast(t));
  socket.on("replaced", () => openModal("replacedModal"));
  socket.on("kicked", () => {
    try { localStorage.removeItem("dcResume"); } catch (e) {}
    alert("تم إخراجك من الغرفة"); location.href = "/decrypto/";
  });
  $("roomChip").onclick = () => {
    const link = location.origin + "/decrypto/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
