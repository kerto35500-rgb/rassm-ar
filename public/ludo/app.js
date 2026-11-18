/* 🎲 لودو — الواجهة.
 *
 * المتصفّح لا يقرّر شيئًا: يرسم ما يصله ويرسل النوايا. الحالةُ التي تصل
 * محجوبةٌ أصلًا على الخادم (الظلام والمهامّ)، فلا شيءَ هنا يُخفى بالـCSS
 * وهو موجودٌ في الذاكرة.
 *
 * الرسم: لوحةُ SVG ثابتةٌ تُبنى مرّةً واحدة (١٥×١٥ وحدة)، وفوقها طبقةُ قطعٍ
 * من عناصر HTML تتحرّك بانتقالات CSS. واللوحةُ تُدار حتى تكون قاعدتُك
 * أسفلَ اليسار دائمًا — ما يُدار يُعكَس عنه ما يُقرأ (الرموز والشارات).
 */
(function () {
  "use strict";
  const G = window.LGEOM;
  const $ = id => document.getElementById(id);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };
  const SVGNS = "http://www.w3.org/2000/svg";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const AR_NUM = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);

  const COLORS = ["#F28B82", "#77D3A0", "#FFD45E", "#82C6F2"];
  const DEEP = ["#D9534A", "#2E9E5B", "#DDA20C", "#2F8FD3"];
  const LIGHT = ["#FFE3E0", "#DFF6E9", "#FFF4D0", "#DFF0FC"];
  const PU_BG = { gold: "#FFE58F", jump: "#CFF2BE", bubble: "#CFE9FF", wind: "#E6DCFF", swap: "#FFD6E8" };
  const MODE_DESC = {
    classic: "أوصِل قطعك الأربع إلى المركز",
    rush: "قطعةٌ تبدأ على الطريق، وواحدةٌ تكفي للفوز",
    master: "قطعتان لك = حاجز، والمركز بالرقم المطابق",
    missions: "مهمّةٌ سرّيّةٌ لكلّ لاعب — من ينجزها أوّلًا يفوز",
    night: "لا ترى إلا ما حول قطعك، وقطعةٌ تكفي للفوز",
    king: "ثلاثةُ حرّاسٍ يعبّدون الطريق لملكك"
  };
  const MODE_ICON = { classic: "🎲", rush: "⚡", master: "🧱", missions: "🕵️", night: "🌙", king: "👑" };

  let socket = null, ME = null, TOKEN = null, ROOM = null;
  let NAMES = { modes: {}, powers: {}, icons: {} }, DEFAULTS = null, settings = null;
  let LOBBY = null, VIEW = null, PLAYERS = [], SKEW = 0;
  let mySeat = null, showPath = false;
  /* انتهت المباراة ولم يُغلق اللاعبُ نافذةَ النتيجة بعد: اللوحةُ تبقى خلفها
     كما انتهت، واللوبي ينتظر حتى تُغلَق */
  let ended = false;

  /* ══════════ أدوات ══════════ */
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.add("on");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2400);
  }
  const onClose = {};
  function openModal(id) { $(id).classList.add("on"); }
  function closeModal(id) {
    const m = $(id);
    if (!m.classList.contains("on")) return;
    m.classList.remove("on");
    if (onClose[id]) onClose[id]();
  }
  /* نافذةُ التضحية لا تُغلَق بالنقر خارجها: السؤالُ ينتظر جوابًا، ولو
     أُغلقت بلا جوابٍ ما عاد اللاعبُ يجد أين يجيب */
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => {
    if (e.target.hasAttribute("data-close") || (e.target === m && !m.hasAttribute("data-sticky"))) closeModal(m.id);
  }));

  /* أصواتٌ مركّبة: لا ملفّات تُحمَّل */
  let AC = null, SND = true;
  try { SND = localStorage.getItem("ludoSnd") !== "0"; } catch (e) {}
  function snd(kind) {
    if (!SND) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
      o.connect(g); g.connect(AC.destination);
      const P = { roll: [300, .18, "triangle", .08], step: [520, .05, "sine", .05], cap: [140, .32, "sawtooth", .12],
                  pow: [880, .3, "sine", .09], fin: [660, .5, "square", .07], turn: [740, .12, "sine", .08],
                  tick: [1180, .045, "square", .035] }[kind] || [440, .1, "sine", .06];
      o.type = P[2]; o.frequency.setValueAtTime(P[0], t);
      if (kind === "roll") o.frequency.linearRampToValueAtTime(180, t + P[1]);
      if (kind === "cap") o.frequency.exponentialRampToValueAtTime(60, t + P[1]);
      if (kind === "fin" || kind === "pow") { o.frequency.setValueAtTime(P[0] * 1.25, t + .12); o.frequency.setValueAtTime(P[0] * 1.5, t + .24); }
      g.gain.setValueAtTime(P[3], t); g.gain.exponentialRampToValueAtTime(.001, t + P[1]);
      o.start(t); o.stop(t + P[1] + .02);
    } catch (e) {}
  }
  $("sndBtn").textContent = SND ? "🔊" : "🔇";
  $("sndBtn").onclick = () => {
    SND = !SND; $("sndBtn").textContent = SND ? "🔊" : "🔇";
    try { localStorage.setItem("ludoSnd", SND ? "1" : "0"); } catch (e) {}
  };

  /* ══════════ اللوحة ══════════ */
  const svg = $("boardSvg");
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(n);
    return n;
  };
  let layerPU, layerFog, layerPath, layerHint, layerFx;

  function buildBoard() {
    svg.innerHTML = "";
    const defs = el("defs", {});
    const sh = el("filter", { id: "lsh", x: "-10%", y: "-10%", width: "120%", height: "120%" }, defs);
    el("feDropShadow", { dx: 0, dy: 0.08, stdDeviation: 0.06, "flood-color": "#7a5a3a", "flood-opacity": .25 }, sh);

    el("rect", { x: 0, y: 0, width: 15, height: 15, rx: .7, fill: "#FFFBF4", stroke: "#E8D5BF", "stroke-width": .12 });

    /* القواعد الأربع */
    G.YARD.forEach(([r, c], s) => {
      el("rect", { x: c + .14, y: r + .14, width: 5.72, height: 5.72, rx: .75, fill: COLORS[s], stroke: "#fff", "stroke-width": .14, filter: "url(#lsh)" });
      el("rect", { x: c + .95, y: r + .95, width: 4.1, height: 4.1, rx: .65, fill: "#fff" });
      G.BASE_RC[s].forEach(([br, bc]) => el("circle", { cx: bc + .5, cy: br + .5, r: .48, fill: LIGHT[s], stroke: COLORS[s], "stroke-width": .07 }));
    });

    /* الطريق. النجمةُ والسهمُ مضلّعاتٌ لا محارف: «★» و«▶» قد يرسمهما ويندوز
       بخطّ الإيموجي الملوّن فيتجاهل اللون ويختلف شكلُهما بين الأجهزة */
    const STAR = (cx, cy, R, r) => {
      const p = [];
      for (let k = 0; k < 10; k++) {
        const a = (-90 + k * 36) * Math.PI / 180, q = k % 2 ? r : R;
        p.push((cx + Math.cos(a) * q).toFixed(3) + "," + (cy + Math.sin(a) * q).toFixed(3));
      }
      return p.join(" ");
    };
    G.TRACK_RC.forEach(([r, c], i) => {
      const start = G.START.indexOf(i), star = G.STARS.includes(i);
      el("rect", { x: c + .05, y: r + .05, width: .9, height: .9, rx: .14,
        fill: start >= 0 ? COLORS[start] : "#fff", stroke: "#EADFD1", "stroke-width": .05 });
      /* النجمةُ تبقى قائمةً مهما دارت اللوحة (class=upright) */
      if (star) el("polygon", { points: STAR(c + .5, r + .5, .36, .15), fill: "#F4C95D", stroke: "#E0A92E",
                                "stroke-width": .035, "stroke-linejoin": "round", class: "upright", "data-c": `${c + .5} ${r + .5}` });
      /* وسهمُ الانطلاق اتّجاهٌ على اللوحة فيدور معها: المقعد ٠ يمينًا، ١ نزولًا،
         ٢ يسارًا، ٣ صعودًا — هكذا يبدأ الطريق من كلّ قاعدة */
      if (start >= 0) el("polygon", { points: `${c + .3},${r + .26} ${c + .76},${r + .5} ${c + .3},${r + .74}`,
                                      fill: "#fff", "stroke-linejoin": "round",
                                      transform: `rotate(${[0, 90, 180, 270][start]} ${c + .5} ${r + .5})` });
    });
    /* مسارات النهاية */
    G.HOME_RC.forEach((cells, s) => cells.forEach(([r, c]) =>
      el("rect", { x: c + .05, y: r + .05, width: .9, height: .9, rx: .14, fill: COLORS[s], opacity: .82, stroke: "#fff", "stroke-width": .05 })));
    /* المركز: أربعةُ مثلّثات */
    const tri = [["6,6", "6,9"], ["6,6", "9,6"], ["9,6", "9,9"], ["6,9", "9,9"]];
    tri.forEach(([a, b], s) => el("polygon", { points: `${a} ${b} 7.5,7.5`, fill: COLORS[s], stroke: "#fff", "stroke-width": .08 }));
    el("circle", { cx: 7.5, cy: 7.5, r: .55, fill: "#fff", opacity: .85 });

    layerPU = el("g", { id: "lPU" });
    layerPath = el("g", { id: "lPath" });
    layerFog = el("g", { id: "lFog" });
    layerHint = el("g", { id: "lHint" });
    layerFx = el("g", { id: "lFx" });
  }
  buildBoard();

  /* الدوران: قاعدتي أسفلَ اليسار (موضع المقعد ٣). اللوحةُ تدور مع عقارب
     الساعة ربعًا لكلّ مقعدٍ يفصلني عنه، وما يُقرأ (الرموز) يُدار عكسها. */
  let ROT = 0;
  function setRotation(seat) {
    ROT = seat == null ? 0 : ((3 - seat) * 90 + 360) % 360;
    $("ludoBoard").style.setProperty("--rot", ROT + "deg");
    svg.querySelectorAll(".upright").forEach(n => n.setAttribute("transform", `rotate(${-ROT} ${n.getAttribute("data-c")})`));
    if (VIEW) drawPU(VIEW);
  }

  const cellKeyOf = (seat, p, idx) => {
    if (p < 0) return "b" + seat + "_" + idx;
    if (p <= G.LAST_TRACK) return "t" + G.absOf(seat, p);
    if (p < G.FINISH) return "h" + seat + "_" + p;
    return "c" + seat;
  };
  /* القطع المنتهية تجلس في مثلّث لونها داخل المركز */
  const FIN_RC = [[7, 6.25], [6.25, 7], [7, 7.75], [7.75, 7]];
  function rcFor(seat, p, idx) {
    if (p === G.FINISH) return FIN_RC[seat];
    return G.rcOf(seat, p, idx);
  }

  /* ══════════ القطع ══════════ */
  const toks = {};               /* "s-i" → عنصر */
  function tokEl(seat, idx) {
    const k = seat + "-" + idx;
    if (toks[k]) return toks[k];
    const d = document.createElement("div");
    d.className = "tok s" + seat;
    d.style.setProperty("--sc", COLORS[seat]); d.style.setProperty("--sd", DEEP[seat]);
    d.innerHTML = '<span class="badge counter"></span>';
    d.addEventListener("click", () => onTokClick(seat, idx));
    $("toks").appendChild(d);
    toks[k] = d;
    return d;
  }
  function place(d, rc, off) {
    d.style.left = (((rc[1] + .5 + (off ? off[0] : 0)) / 15) * 100) + "%";
    d.style.top = (((rc[0] + .5 + (off ? off[1] : 0)) / 15) * 100) + "%";
  }
  const OFFS = { 1: [[0, 0]], 2: [[-.2, 0], [.2, 0]], 3: [[-.2, -.15], [.2, -.15], [0, .18]],
                 4: [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]] };

  function renderTokens(v) {
    const seen = new Set();
    const groups = {};
    if (v) for (const s of v.seats) (v.pieces[s] || []).forEach((pc, i) => {
      const d = tokEl(s, i);
      seen.add(s + "-" + i);
      d.classList.toggle("king", pc.k === "king");
      d.classList.toggle("sh", !!pc.sh);
      const hidden = pc.hidden || pc.p === -2;
      d.style.display = hidden ? "none" : "";
      d.classList.remove("can", "target");
      const b = d.querySelector(".badge");
      b.textContent = pc.k === "king" ? "👑" : pc.k === "guard" ? "🛡️" : "";
      let cd = d.querySelector(".cd");
      if (pc.cd) { if (!cd) { cd = document.createElement("span"); cd.className = "cd counter"; d.appendChild(cd); } cd.textContent = "🔒" + AR_NUM(pc.cd); }
      else if (cd) cd.remove();
      if (pc.k === "king" && pc.p === -1 && v.rules.mode === "king" && !(v.unlocked || {})[s]) b.textContent = "🔒";
      if (hidden) return;
      const key = cellKeyOf(s, pc.p, i);
      (groups[key] = groups[key] || []).push({ d, s, i, pc });
    });
    for (const k in toks) if (!seen.has(k)) toks[k].style.display = "none";
    for (const key in groups) {
      const g = groups[key];
      const offs = OFFS[Math.min(4, g.length)] || OFFS[4];
      g.forEach((o, j) => {
        const rc = rcFor(o.s, o.pc.p, o.i);
        place(o.d, rc, g.length > 1 ? offs[j % offs.length] : null);
        o.d.classList.toggle("small", g.length > 1 || o.pc.p === G.FINISH);
        o.d.style.zIndex = 3 + j;
      });
    }
    markActionable(v);
  }

  /* ما يمكن النقر عليه الآن: قطعُ الحركة المشروعة، أو أهدافُ التبديل */
  function markActionable(v) {
    if (!v) return;
    if (v.phase === "move" && v.turn === mySeat) {
      for (const m of v.legal) {
        tokEl(m.owner, m.idx).classList.add("can");
        /* من القاعدة: كلُّ قطعِ القاعدة قابلةٌ للنقر (الحركة واحدة) */
        if (m.from === -1) v.pieces[m.owner].forEach((pc, i) => {
          if (pc.p === -1 && pc.k === v.pieces[m.owner][m.idx].k && !(pc.cd > 0)) tokEl(m.owner, i).classList.add("can");
        });
      }
    }
    if (v.prompt && v.prompt.seat === mySeat && v.prompt.kind === "swap" && v.prompt.options)
      for (const o of v.prompt.options) tokEl(o.seat, o.idx).classList.add("target");
  }

  function onTokClick(seat, idx) {
    const v = VIEW;
    if (!v) return;
    if (v.prompt && v.prompt.seat === mySeat && v.prompt.kind === "swap" && v.prompt.options) {
      const o = v.prompt.options.find(x => x.seat === seat && x.idx === idx);
      if (o) { socket.emit("choose", { choice: o.id }); return; }
    }
    if (v.phase === "move" && v.turn === mySeat) {
      const opts = optionsFor(v, seat, idx);
      if (opts.length) {
        /* الملك بنقرتين: الأولى تختاره فيظهر مسارُه المؤمَّن ووجهتُه، والثانية
           تحرّكه. مسارُه لا يُرسم إلا حين يُختار — كي لا تزدحم اللوحة —
           ولا يتحرّك الملكُ بلمسةٍ عابرة */
        const key = opts[0].owner + "-" + opts[0].idx;
        if (v.pieces[opts[0].owner][opts[0].idx].k === "king" && selKing !== key) {
          selKing = key; showPath = true;
          drawPath(v); markSel(); hintTo(opts);
          if (opts.length > 1) showPicker(seat, idx, opts);
          else toast("👑 هذا مسارُ ملكك — اضغط عليه مرّةً أخرى ليتحرّك");
          return;
        }
        /* قطعةٌ تمشي بأكثر من رقمٍ في البركة: فقاعةٌ فوقها تختار منها الرقم
           (chooseStep في المرجع)؛ وبرقمٍ واحدٍ تمشي فورًا */
        if (opts.length > 1) { showPicker(seat, idx, opts); hintTo(opts); return; }
        playMove(opts[0]);
        return;
      }
    }
    /* الملكُ خارج دوره: النقرُ عليه يُظهر مساره ويُخفيه */
    if (v.rules.mode === "king" && v.pieces[seat] && v.pieces[seat][idx].k === "king" &&
        (v.controlled || []).includes(seat)) { showPath = !showPath; drawPath(v); }
  }
  /** حركاتُ قطعةٍ بعينها (برقمٍ أو أكثر من البركة). وقطعُ القاعدة متكافئة:
      النقرُ على أيّها يخرج بالحركة المعروضة لنوعها */
  function optionsFor(v, seat, idx) {
    let opts = v.legal.filter(x => x.owner === seat && x.idx === idx);
    const pc = v.pieces[seat] && v.pieces[seat][idx];
    if (!opts.length && pc && pc.p === -1)
      opts = v.legal.filter(x => x.owner === seat && x.from === -1 && v.pieces[seat][x.idx].k === pc.k);
    return opts;
  }
  /* حركةٌ أُرسلت ولم يصل ردُّها بعد: القطعُ تكفّ عن التوهّج فورًا، ولمسةٌ
     ثانية (نقرٌ مزدوجٌ على الجوال) لا تُرسل حركةً أخرى — كانت تعود برسالة
     «ليس دورك في التحريك». يُفكّ القفلُ مع الحالة التالية أو رسالة خطأ. */
  let moveSentAt = 0, moveSentSrv = 0;
  function playMove(m) {
    if (moveSentAt && Date.now() - moveSentAt < 2500) return;
    moveSentAt = Date.now(); moveSentSrv = Date.now() + SKEW;   /* بساعة الخادم */
    for (const k in toks) toks[k].classList.remove("can");
    selKing = null; showPath = false; hidePicker();
    socket.emit("move", { id: m.id }); clearHint(); drawPath(VIEW); markSel();
  }
  let selKing = null;
  function markSel() {
    for (const k in toks) toks[k].classList.toggle("sel", k === selKing);
  }

  /* فقاعةُ اختيار الرقم: فوق القطعة على الشاشة (خارج اللوحة الدوّارة كي لا
     تدور أرقامُها معها) */
  function showPicker(seat, idx, opts) {
    const pk = $("picker");
    pk.innerHTML = "";
    for (const m of opts.slice().sort((a, b) => b.d - a.d)) {
      const b = document.createElement("button");
      b.className = "die"; b.type = "button";
      b.setAttribute("aria-label", "حرّك " + m.d);
      drawDie(b, m.d);
      b.addEventListener("click", e => { e.stopPropagation(); playMove(m); });
      pk.appendChild(b);
    }
    const t = tokEl(seat, idx).getBoundingClientRect(), box = $("boardBox").getBoundingClientRect();
    pk.style.left = (t.left + t.width / 2 - box.left) + "px";
    pk.style.top = (t.top - box.top) + "px";
    pk.classList.add("on");
  }
  function hidePicker() { const pk = $("picker"); pk.classList.remove("on"); pk.innerHTML = ""; }
  /* النقرُ خارج الفقاعة وخارج القطع يُغلقها */
  document.addEventListener("pointerdown", e => {
    if (!$("picker").classList.contains("on")) return;
    if (e.target.closest && (e.target.closest("#picker") || e.target.closest(".tok"))) return;
    hidePicker();
  });

  /* تلميح الوجهة: مربّعٌ منقّطٌ لكلّ رقمٍ تمشي به القطعة */
  function hintTo(list) {
    clearHint();
    for (const m of [].concat(list)) {
      const rc = rcFor(m.owner, m.to, m.idx);
      el("rect", { x: rc[1] + .08, y: rc[0] + .08, width: .84, height: .84, rx: .18, fill: "none", stroke: "#fff", "stroke-width": .12, "stroke-dasharray": ".18 .1" }, layerHint);
    }
  }
  $("toks").addEventListener("mouseover", e => {
    const t = e.target.closest(".tok.can");
    if (!t || !VIEW) return;
    const k = Object.keys(toks).find(x => toks[x] === t);
    if (!k) return;
    const [s, i] = k.split("-").map(Number);
    const opts = optionsFor(VIEW, s, i);
    if (opts.length) hintTo(opts); else clearHint();
  });
  $("toks").addEventListener("mouseout", () => { if (!selKing && !$("picker").classList.contains("on")) clearHint(); });
  function clearHint() { if (layerHint) layerHint.innerHTML = ""; }

  /* المعزّزات */
  function drawPU(v) {
    layerPU.innerHTML = "";
    if (!v || !v.rules.powerups) return;
    for (const pu of v.powerups) {
      const [r, c] = G.TRACK_RC[pu.cell];
      el("rect", { x: c + .08, y: r + .08, width: .84, height: .84, rx: .18, fill: PU_BG[pu.type], stroke: "#fff", "stroke-width": .08 }, layerPU);
      const t = el("text", { x: c + .5, y: r + .73, "font-size": .6, "text-anchor": "middle" }, layerPU);
      t.textContent = NAMES.icons[pu.type] || "✨";
      t.setAttribute("transform", `rotate(${-ROT} ${c + .5} ${r + .5})`);
    }
  }

  /* الظلام */
  function drawFog(v) {
    layerFog.innerHTML = "";
    if (!v || !v.visible) { $("ludoBoard").classList.remove("night"); return; }
    const vis = new Set(v.visible);
    const fog = (r, c) => el("rect", { x: c, y: r, width: 1, height: 1, fill: "#141b33", opacity: .78 }, layerFog);
    G.TRACK_RC.forEach(([r, c], i) => { if (!vis.has(i)) fog(r, c); });
    G.HOME_RC.forEach((cells, s) => { if (!(v.controlled || []).includes(s) && s !== mySeat && !(v.rules.teams && s % 2 === mySeat % 2)) cells.forEach(([r, c]) => fog(r, c)); });
  }

  /* مسار الملك المؤمَّن — يظهر بالنقر على الملك وحده (أقلُّ فوضى) */
  function drawPath(v) {
    layerPath.innerHTML = "";
    if (!v || v.rules.mode !== "king" || !showPath || !v.secured) return;
    for (const k of v.secured) {
      let rc = null;
      if (k[0] === "t") rc = G.TRACK_RC[+k.slice(1)];
      else if (k[0] === "h") { const [s, q] = k.slice(1).split("_").map(Number); rc = q < 5 ? G.HOME_RC[s][q] : FIN_RC[s]; }
      if (!rc) continue;
      el("rect", { x: rc[1] + .1, y: rc[0] + .1, width: .8, height: .8, rx: .2, fill: "#FFE58F", opacity: .75, stroke: "#E2A90E", "stroke-width": .06 }, layerPath);
    }
  }

  /* ومضةٌ على مربّع */
  function flash(cell, color) {
    if (cell == null) return;
    const [r, c] = G.TRACK_RC[cell];
    const n = el("circle", { cx: c + .5, cy: r + .5, r: .2, fill: "none", stroke: color || "#fff", "stroke-width": .15, opacity: 1 }, layerFx);
    let t = 0;
    const tick = () => { t += 1; n.setAttribute("r", .2 + t * .07); n.setAttribute("opacity", Math.max(0, 1 - t / 14)); if (t < 14) requestAnimationFrame(tick); else n.remove(); };
    requestAnimationFrame(tick);
    /* المتصفّح يوقف requestAnimationFrame في التبويب المخفيّ — فلو وقعت ومضةٌ
       والتبويبُ في الخلفيّة بقيت حلقتُها البيضاء عالقةً على المربّع. فمؤقّتٌ
       احتياطيّ يزيلها في كلّ حال */
    setTimeout(() => n.remove(), 700);
  }

  /* ══════════ النرد: لكلّ لاعبٍ نردُه في زاويته ══════════ */
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function drawDie(b, v, gold) {
    [...b.querySelectorAll("i")].forEach(x => x.remove());
    for (let k = 0; k < 9; k++) {
      const i = document.createElement("i");
      if (v && PIPS[v] && PIPS[v].includes(k)) i.className = "on";
      b.appendChild(i);
    }
    b.classList.toggle("gold", !!gold);
  }
  drawDie($("diceBtn"), 6);
  $("diceBtn").onclick = () => {
    if (!VIEW || VIEW.turn !== mySeat || VIEW.phase !== "roll" || VIEW.prompt) return;
    const b = $("diceBtn");
    b.disabled = true;
    b.classList.remove("ready");
    b.classList.add("rolling");
    if (panels[mySeat]) panels[mySeat].classList.remove("ready");
    snd("roll");
    socket.emit("roll");
  };
  /* آخرُ رقمٍ رماه كلُّ مقعد: يبقى على نرده حتى رميته التالية */
  const lastRoll = {};
  const dieOf = s => s === mySeat ? $("diceBtn") : (panels[s] && panels[s].querySelector(".die"));
  async function animRoll(seat, v, golden) {
    lastRoll[seat] = v;
    const b = dieOf(seat);
    if (!b) return;
    b.classList.remove("rolling"); void b.offsetWidth; b.classList.add("rolling");
    for (let k = 0; k < 5; k++) { drawDie(b, 1 + Math.floor(Math.random() * 6)); await sleep(70); }
    drawDie(b, v, golden);
    b.classList.remove("rolling");
  }

  /* ══════════ المؤقّت: قطاعٌ يتناقص فوق صورة صاحب الدور ══════════
     كمؤقّت المرجع (Ludo.CdAni): يبدأ دائرةً كاملة وينقص مع عقارب الساعة،
     ويحمرّ في الثواني الخمس الأخيرة مع تكتكةٍ لصاحبه (last_sec). */
  let pieT = null;
  function startPie(st) {
    clearInterval(pieT);
    for (const s in panels) panels[s].classList.remove("timing", "hurry");
    const seat = st.phase === "over" ? null : (st.prompt ? st.prompt.seat : st.turn);
    if (seat == null || !st.deadline || !panels[seat]) return;
    const pp = panels[seat];
    const total = Math.max(1, st.deadline - (Date.now() + SKEW));
    let lastSec = -1;
    const tick = () => {
      const left = st.deadline - (Date.now() + SKEW);
      const used = Math.max(0, Math.min(1, 1 - left / total));
      pp.style.setProperty("--e", (used * 360).toFixed(1) + "deg");
      pp.classList.add("timing");
      pp.classList.toggle("hurry", left <= 5000);
      if (seat === mySeat && left > 0 && left <= 5000) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSec) { lastSec = sec; snd("tick"); }
      }
      if (left <= 0) { clearInterval(pieT); pp.classList.remove("timing", "hurry"); }
    };
    tick(); pieT = setInterval(tick, 100);
  }

  /* ══════════ الحالة والحركة ══════════ */
  const queue = [];
  let busy = false;
  function onState(st) { queue.push(st); if (!busy) drain(); }

  async function drain() {
    busy = true;
    while (queue.length) {
      const st = queue.shift();
      /* إن تراكمت الحالات (تبويبٌ كان في الخلفيّة) نقفز إلى آخرها بلا حركة؛
         وإن تأخّرنا قليلًا نُسرع الحركة بدل أن نتأخّر أكثر */
      const fast = queue.length > 2;
      if (!fast) await animate(st, queue.length ? .55 : 1);
      render(st);
    }
    busy = false;
    if (idleWaiters.length) idleWaiters.splice(0).forEach(f => f());
  }
  const idleWaiters = [];
  const whenIdle = () => new Promise(res => (busy || queue.length) ? idleWaiters.push(res) : res());

  async function animate(st, speed) {
    const players = st.players || PLAYERS;
    const nm = s => (players[s] && players[s].name) || G.COLOR_AR[s];
    const wait = ms => sleep(ms * speed);
    if (mySeat !== st.me) { mySeat = st.me; setRotation(mySeat); }
    for (const e of st.events || []) {
      if (e.t === "roll") {
        snd("roll");
        /* البركةُ تظهر عند صاحبها مع كلّ رمية (٦ ثمّ ٦ ثمّ ٤…) */
        if (e.pool && panels[e.seat]) paintPool(panels[e.seat], e.pool);
        await animRoll(e.seat, e.v, e.golden);
        await wait(140);
      }
      else if (e.t === "move" && e.path) {
        const d = tokEl(e.owner, e.idx);
        if (e.partial && d.style.display === "none") d.style.display = "";
        for (const q of e.path) {
          if (q == null) continue;
          place(d, rcFor(e.owner, q, e.idx));
          d.classList.add("hop"); snd("step");
          await wait(115);
          d.classList.remove("hop");
        }
        if (e.partial && e.to == null) d.style.display = "none";
      }
      /* قفزةُ الكنغر (ودفعةُ الريح لصاحبها): وثبةٌ واحدةٌ إلى المربّع، لا مشيٌ
         مربّعًا مربّعًا — القطعةُ تكبر في الهواء ثمّ تهبط حيث انتهت */
      else if (e.t === "jump" && e.path) {
        const d = tokEl(e.owner, e.idx);
        if (e.partial && d.style.display === "none") d.style.display = "";
        const seen = e.path.filter(q => q != null);
        if (seen.length) {
          d.classList.add("leap"); snd("pow");
          place(d, rcFor(e.owner, seen[seen.length - 1], e.idx));
          await wait(470);
          d.classList.remove("leap");
        }
        if (e.partial && e.to == null) d.style.display = "none";
      }
      else if (e.t === "capture") { snd("cap"); flash(e.cell, "#ff6b6b"); toast(`💥 ${nm(e.by)} أكل قطعةً لـ${nm(e.seat)}`); await wait(260); }
      /* المعزّزات: بلا إشعاراتٍ مكتوبة (لا لصاحبها ولا لغيره) — يكفي ما يُرى على
         اللوحة: وميضُ المربّع، والقفزة، وارتدادُ القطع، والنردُ الذهبيّ */
      else if (e.t === "power") { snd("pow"); flash(e.cell, "#ffd34d"); await wait(220); }
      else if (e.t === "wind") { if (e.pushes && e.pushes.length) snd("cap"); await wait(200); }
      else if (e.t === "swap") { snd("pow"); await wait(200); }
      else if (e.t === "sacrifice") { snd("cap"); toast(`🛡️ ${nm(e.seat)} ضحّى بحارسٍ لينجو ملكه`); await wait(250); }
      else if (e.t === "kingDown") { snd("cap"); toast(`👑 سقط ملك ${nm(e.seat)}!`); await wait(300); }
      else if (e.t === "out" && e.seat === mySeat) toast("سقط ملكك — خرجت من المباراة");
      else if (e.t === "unlock" && e.seat === mySeat) toast("🔓 فُكّ قفلُ ملكك — يخرج بستّة على مسار حرّاسه");
      else if (e.t === "finish") { snd("fin"); await wait(150); }
      else if (e.t === "again" && e.seat === mySeat)
        toast(e.why === "six" ? "ستّة! ارمِ مرّةً أخرى 🎲" : e.why === "home" ? "🏁 دخلت قطعتك — رميةٌ إضافيّة!" : "💥 أكلت — رميةٌ إضافيّة!");
      else if (e.t === "pass" && e.seat === mySeat) toast(e.why === "three6" ? "٣ ستّات متتالية — ضاع الدورُ كلُّه" : "لا حركةَ ممكنة");
      else if (e.t === "timeout" && e.seat === mySeat) toast("⏱️ انتهى وقتك — اللعب التلقائيّ يلعب عنك");
      else if (e.t === "turn" && e.seat === mySeat) { snd("turn"); }
      else if (e.t === "spawn") flash(e.cell, "#fff");
    }
  }

  function render(st) {
    VIEW = st;
    PLAYERS = st.players || PLAYERS;
    /* حالةٌ وُلدت بعد إرسال الحركة ⇒ يُفكّ قفلُ النقر (حالةٌ أقدم كانت في الطابور لا تفكّه) */
    if (moveSentAt && (!st.serverNow || st.serverNow >= moveSentSrv)) moveSentAt = 0;
    if (st.serverNow) SKEW = st.serverNow - Date.now();
    if (mySeat !== st.me) { mySeat = st.me; setRotation(mySeat); }
    if (!ended) showScreen("play");
    /* اختيارُ الملك يخصّ لحظةَ التحريك وحدها: أيُّ حالةٍ جديدةٍ تُلغيه */
    if (selKing) { selKing = null; showPath = false; clearHint(); }
    renderTokens(st);
    markSel();
    drawPU(st); drawFog(st); drawPath(st);
    $("ludoBoard").classList.toggle("night", !!st.visible);

    /* اللاعبون في زواياهم: صورٌ ونردٌ وبركةٌ ومؤقّت */
    if (st.dice && st.turn != null && lastRoll[st.turn] == null) lastRoll[st.turn] = st.dice;
    renderPanels(st);
    startPie(st);
    hidePicker();
    const myTurn = st.turn === mySeat;
    const tn = (PLAYERS[st.turn] && PLAYERS[st.turn].name) || G.COLOR_AR[st.turn];
    const status = st.phase === "over" ? "انتهت المباراة"
      : myTurn ? (st.phase === "roll" ? "دورك — ارمِ النرد" : st.phase === "move" ? "اختر قطعة" : "…")
      : "دور " + tn;
    $("phaseInfo").textContent = (MODE_ICON[st.rules.mode] || "") + " " + (NAMES.modes[st.rules.mode] || "") +
      (st.rules.teams ? " · فرق" : "") + " · " + status;
    /* اللعب التلقائيّ: شارةٌ تُعيدك بلمسةٍ في أيّ مكان */
    const meP = PLAYERS[mySeat];
    $("autoBar").classList.toggle("on", !!(meP && meP.auto) && st.phase !== "over");

    /* الأسئلة */
    const pr = st.prompt;
    const bar = $("promptBar");
    if (pr && pr.seat === mySeat && pr.kind === "swap") { bar.style.display = "block"; bar.textContent = "🔄 اختر خصمًا تبدّل مكانك معه (القطع المتوهّجة بالأحمر)"; }
    else if (pr && pr.seat !== mySeat) { bar.style.display = "block"; bar.textContent = "⏳ ينتظر " + ((PLAYERS[pr.seat] && PLAYERS[pr.seat].name) || "") + (pr.kind === "sacrifice" ? " قرارَ التضحية…" : " اختيارَ التبديل…"); }
    else bar.style.display = "none";
    if (pr && pr.seat === mySeat && pr.kind === "sacrifice") showSacrifice(st);
    else closeModal("sacModal");

    renderMissions(st);
  }

  function showSacrifice(v) {
    const box = $("sacChoices");
    box.innerHTML = "";
    for (const gi of v.prompt.options) {
      const pc = v.pieces[mySeat][gi];
      const b = document.createElement("button");
      b.textContent = "🛡️ ضحِّ بالحارس " + AR_NUM(gi + 1) + (pc && pc.p >= 0 ? " (قطع " + AR_NUM(pc.p) + " خطوة)" : "");
      b.onclick = () => { socket.emit("choose", { choice: gi }); closeModal("sacModal"); };
      box.appendChild(b);
    }
    const no = document.createElement("button");
    no.className = "no"; no.textContent = "لا — اتركه يسقط";
    no.onclick = () => { socket.emit("choose", { choice: "none" }); closeModal("sacModal"); };
    box.appendChild(no);
    openModal("sacModal");
  }

  /* ══════════ اللاعبون في زواياهم (كلعبة المرجع) ══════════
     كلُّ لاعبٍ عند قاعدته: أنت أسفلَ اليسار، ثمّ مع عقارب الساعة. صورتُه
     وعليها مؤقّته، ونردُه بجانبه، وبركتُه تحته حين يكون الدورُ دوره. */
  const CORNER = ["cBL", "cTL", "cTR", "cBR"];
  const cornerOf = s => CORNER[((s - mySeat) % 4 + 4) % 4];
  const panels = {};
  function panelEl(s) {
    if (panels[s]) return panels[s];
    const d = document.createElement("div");
    d.className = "pp s" + s;
    d.setAttribute("data-seat", String(s));
    d.style.setProperty("--sc", COLORS[s]); d.style.setProperty("--sd", DEEP[s]); d.style.setProperty("--sl", LIGHT[s]);
    d.innerHTML =
      '<div class="avw"><div class="av"><span class="pie"></span><span class="ini"></span></div><span class="autoTag">AUTO</span></div>' +
      '<div class="pinfo"><b class="nm"></b><small class="meta"></small>' +
      '<div class="dieRow"><span class="hand">👇</span><span class="pool"></span></div></div>' +
      '<span class="tmb">🤝 زميلك</span><div class="bub"></div>';
    const row = d.querySelector(".dieRow"), pool = d.querySelector(".pool");
    if (s === mySeat) {
      const b = $("diceBtn");
      b.style.display = "";
      row.insertBefore(b, pool);
    } else {
      const die = document.createElement("div");
      die.className = "die";
      drawDie(die, lastRoll[s] || 6);
      row.insertBefore(die, pool);
    }
    panels[s] = d;
    return d;
  }
  function paintPool(pp, vals) {
    pp.querySelector(".pool").innerHTML = (vals || []).map(x => '<i class="' + (x === 6 ? "six" : "") + '">' + AR_NUM(x) + "</i>").join("");
  }
  /* مباراةٌ جديدة: اللوحاتُ تُبنى من جديد (قد تتغيّر المقاعد ومقعدك) */
  function resetPanels() {
    const b = $("diceBtn");
    b.style.display = "none";
    $("play").appendChild(b);
    for (const s in panels) { panels[s].remove(); delete panels[s]; }
    for (const k in lastRoll) delete lastRoll[k];
  }
  function renderPanels(v) {
    for (const s in panels) if (!v.seats.includes(+s)) { panels[s].remove(); delete panels[s]; }
    const myRoll = v.turn === mySeat && v.phase === "roll" && !v.prompt;
    for (const s of v.seats) {
      const d = panelEl(s), c = $(cornerOf(s));
      if (d.parentNode !== c) c.appendChild(d);
      const p = PLAYERS[s] || { name: G.COLOR_AR[s] };
      const fin = (v.pieces[s] || []).filter(x => x.p === G.FINISH).length;
      d.querySelector(".ini").textContent = p.bot ? "🤖" : (String(p.name || "؟").trim().charAt(0) || "؟");
      d.querySelector(".nm").textContent = p.name + (p.gone && !p.bot ? " 💤" : "");
      /* في الفرق: من زميلُك ومن خصمُك — مكتوبًا على لوحته، لا رمزًا يُفهم بالتخمين.
         (كان «ف١/ف٢» وحده، فظنّ اللاعبُ جارَه زميلَه: الزميلُ مقابلُك على اللوحة) */
      const mate = v.rules.teams && s !== mySeat && mySeat != null && s % 2 === mySeat % 2;
      d.querySelector(".meta").textContent = "🏁 " + AR_NUM(fin) + "/٤" +
        (v.rules.teams ? (s === mySeat ? " · فريقك" : mate ? " · زميلك" : " · ⚔️ خصم") : "");
      const acting = v.phase !== "over" && (v.prompt ? v.prompt.seat === s : v.turn === s);
      d.classList.toggle("turn", acting);
      d.classList.toggle("me", s === mySeat);
      d.classList.toggle("mate", !!mate);
      d.classList.toggle("auto", !!p.auto);
      d.classList.toggle("off", !!(v.out || {})[s]);
      d.classList.toggle("ready", s === mySeat && myRoll);
      /* البركةُ عند صاحب الدور وحده */
      paintPool(d, v.turn === s && v.phase !== "over" ? v.pool : []);
      if (s !== mySeat) { const die = d.querySelector(".die"); if (die && !die.classList.contains("rolling")) drawDie(die, lastRoll[s] || 6); }
    }
    const b = $("diceBtn");
    b.disabled = !myRoll;
    b.classList.remove("rolling");
    b.classList.toggle("ready", myRoll);
    /* نردُك يذهَّب حين تكون رميتُك القادمة ستّةً مضمونة (النرد الذهبيّ) */
    drawDie(b, lastRoll[mySeat] || 6, !!v.golden);
  }

  /* المهامّ: شريطٌ فوق اللوحة */
  function renderMissions(v) {
    const mc = $("missionCard");
    if (v.rules.mode !== "missions") { mc.style.display = "none"; return; }
    mc.style.display = "flex";
    mc.innerHTML = '<div class="h" style="font-size:13px">🕵️ المهامّ السرّيّة</div>';
    for (const s of v.seats) {
      const ms = v.missions && v.missions[s];
      if (!ms) continue;
      const nm = (PLAYERS[s] && PLAYERS[s].name) || G.COLOR_AR[s];
      const d = document.createElement("div");
      d.className = "mis" + (ms.hidden ? " hid" : "");
      d.style.setProperty("--sl", LIGHT[s]); d.style.setProperty("--sd", DEEP[s]);
      if (ms.hidden) d.textContent = "🤫 " + nm + ": مهمّةٌ سرّيّة";
      else d.innerHTML = '<div class="t">' + (s === mySeat ? "🎯 مهمّتك: " : "🤝 " + esc(nm) + ": ") + esc(ms.text) +
        '</div><div class="bar"><i style="width:' + Math.round(100 * (ms.prog || 0) / (ms.goal || 1)) + '%"></i></div>' +
        '<div style="font-size:11.5px;font-weight:800;margin-top:3px;opacity:.8">' + AR_NUM(ms.prog || 0) + " / " + AR_NUM(ms.goal) + "</div>";
      mc.appendChild(d);
    }
  }

  /* ══════════ الشاشات ══════════ */
  function showScreen(which) {
    $("joinScreen").style.display = which === "join" ? "flex" : "none";
    $("game").style.display = which === "join" ? "none" : "flex";
    $("lobby").style.display = which === "lobby" ? "flex" : "none";
    $("play").style.display = which === "play" ? "flex" : "none";
  }

  /* ══════════ اللوبي ══════════ */
  function toLobby() {
    showScreen("lobby");
    VIEW = null; mySeat = null; showPath = false; setRotation(null);
    clearInterval(pieT);
    $("autoBar").classList.remove("on");
    $("phaseInfo").textContent = "في الانتظار…";
  }

  function renderLobby(L) {
    LOBBY = L;
    settings = { ...L.settings };
    const host = L.host === ME;
    if (!L.playing && !ended) toLobby();
    $("roomCode").textContent = L.code;
    const grid = $("seatGrid");
    grid.innerHTML = "";
    const order = [0, 1, 2, 3];
    const seatCard = i => {
      const p = L.slots[i];
      const act = L.active.includes(i);
      const d = document.createElement("div");
      d.className = "seat s" + i + (p && p.id === ME ? " me" : "") + (act ? "" : " off") + (!p && act ? " empty" : "");
      /* سطرٌ قصيرٌ تحت الاسم: اللونُ ثمّ الحال — كان «الأزرق · يجلس فيه بوت»
         يتكسّر في الجوال على ثلاثة أسطر ويدفع البطاقة خارج الشاشة */
      const status = p ? (p.id === ME ? "أنت" : p.gone ? "غائب" : "") : "";
      d.innerHTML = '<div class="dot"></div><div class="who">' +
        (p ? "<b>" + esc(p.name) + (p.bot ? " 🤖" : "") + "</b><small>" + G.COLOR_AR[i] + (status ? " · " + status : "") + "</small>"
           : '<b class="ghost">' + (!act ? "خارج اللعب" : settings.bots ? "🤖 بوت" : "مقعدٌ فارغ") + "</b><small>" + G.COLOR_AR[i] + "</small>") +
        "</div>" + (p && p.host ? '<span class="crown">👑</span>' : "");
      if (!p && act) {
        const sit = document.createElement("button");
        sit.className = "sitBtn"; sit.textContent = "اجلس هنا";
        sit.onclick = e => { e.stopPropagation(); socket.emit("sit", { slot: i }); };
        d.appendChild(sit);
        /* والبطاقةُ كلُّها تُلمَس — أسهل في الجوال من الزرّ الصغير */
        d.onclick = () => socket.emit("sit", { slot: i });
      }
      if (p && host && p.id !== ME) {
        const k = document.createElement("button");
        k.className = "kick"; k.textContent = "✕"; k.title = "إخراج";
        k.onclick = () => { if (confirm("إخراج " + p.name + "؟")) socket.emit("kick", { id: p.id }); };
        d.appendChild(k);
      }
      return d;
    };
    if (settings.teams) {
      /* الزميلان متقابلان على اللوحة (الأحمر والأصفر، الأخضر والأزرق) — لا
         متجاوران. فنقولها صراحةً، ونعلّم فريقك، وندلّ على طريقة الانضمام إلى
         فريق صاحبك: لاعبان جلسا في مقعدين متجاورين خصمان لا زميلان. */
      const mine = L.slots.findIndex(p => p && p.id === ME);
      const myTeam = mine >= 0 ? mine % 2 : -1;
      const tag = (t, txt) => '<div class="teamTag' + (t === myTeam ? " mine" : "") + '">' + txt + (t === myTeam ? " — فريقك 🤝" : "") + "</div>";
      grid.insertAdjacentHTML("beforeend", tag(0, "الفريق الأوّل: 🔴 الأحمر + 🟡 الأصفر"));
      grid.appendChild(seatCard(0)); grid.appendChild(seatCard(2));
      grid.insertAdjacentHTML("beforeend", tag(1, "الفريق الثاني: 🟢 الأخضر + 🔵 الأزرق"));
      grid.appendChild(seatCard(1)); grid.appendChild(seatCard(3));
      if (L.slots.some((p, i) => !p && L.active.includes(i)))
        grid.insertAdjacentHTML("beforeend", '<div class="teamHint">تريد صاحبك في فريقك؟ يلمس المقعدَ الفارغ في صفّ فريقك فينتقل إليه.</div>');
    } else order.forEach(i => grid.appendChild(seatCard(i)));
    $("plCount").textContent = "(" + AR_NUM(L.slots.filter(Boolean).length) + "/" + AR_NUM(L.active.length) + ")";

    $("hostArea").style.display = host ? "flex" : "none";
    $("waitHost").style.display = host ? "none" : "block";
    const lr = L.lastResult;
    $("lobbySummary").innerHTML = summary(settings) + (lr && lr.seats && lr.seats.length
      ? "<br>🏆 آخر مباراة: <b>" + esc(lr.names.join(" و")) + "</b>" : "");
    if (host && !$("setBox").dataset.built) buildSettings();
    if (host) syncSettings();
  }

  function summary(S) {
    return (MODE_ICON[S.mode] || "") + " <b>" + esc(NAMES.modes[S.mode] || S.mode) + "</b> — " + esc(MODE_DESC[S.mode] || "") +
      "<br>" + (S.teams ? "فرق ٢ ضدّ ٢" + (S.sharedSafe ? " · تأمينٌ مشترك" : "") : S.players === 2 ? "لاعبان" : AR_NUM(S.players) + " لاعبين") +
      (S.powerups ? " · " + AR_NUM(S.powerCount) + " معزّزات " + typesOf(S).map(k => NAMES.icons[k] || "").join("") : " · بلا معزّزات") +
      " · " + AR_NUM(S.turnSecs) + "ث للدور";
  }

  function buildSettings() {
    const box = $("setBox");
    box.dataset.built = "1";
    box.innerHTML = `
      <div class="modeBox"><div class="modeTag">🎮 الوضع (واحدٌ للغرفة)</div><div id="modeGrid"></div></div>
      <div class="setRow"><label>طريقة اللعب</label>
        <div class="seg" id="sTeams"><button data-v="0">كلٌّ لنفسه</button><button data-v="1">فرق ٢ ضدّ ٢</button></div>
        <div class="hint">في الفرق: الأحمر والأصفر ضدّ الأخضر والأزرق، ومن أنهى قطعه يرمي لزميله.</div></div>
      <div class="setRow" id="rowShared"><label>التأمين المشترك</label>
        <div class="seg" id="sShared"><button data-v="0">إيقاف</button><button data-v="1">تشغيل</button></div>
        <div class="hint">تشغيل: يقف الزميلان في مربّعٍ واحدٍ فيصير آمنًا لا يُؤكلان فيه. إيقاف: لا يقفان معًا إلا على النجوم والانطلاق. وفي الحالتين لا يأكل زميلٌ زميلَه — وزميلُك مقابلُك على اللوحة لا جارُك.</div></div>
      <div class="setRow" id="rowPlayers"><label>عدد اللاعبين</label>
        <div class="seg" id="sPlayers"><button data-v="2">٢</button><button data-v="3">٣</button><button data-v="4">٤</button></div></div>
      <div class="setRow"><label>المعزّزات السحريّة</label>
        <div class="seg" id="sPU"><button data-v="0">إيقاف</button><button data-v="1">تشغيل ✨</button></div>
        <select id="sPUc"><option value="3">٣ على اللوحة</option><option value="4">٤ على اللوحة</option><option value="5">٥ على اللوحة</option><option value="6">٦ على اللوحة</option></select>
        <div class="puPick" id="sPUt"></div>
        <div class="hint" id="sPUhint">اضغط على معزّزٍ لتمنعه أو تسمح به — تُلتقَط المعزّزاتُ بالوقوف التامّ عليها.</div></div>
      <div class="setRow"><label>مهلة الدور</label>
        <select id="sSecs"><option value="10">١٠ث</option><option value="15">١٥ث</option><option value="20">٢٠ث</option><option value="30">٣٠ث</option></select></div>
      <div class="setRow"><label>البوتات في المقاعد الفارغة</label>
        <div class="seg" id="sBots"><button data-v="1">تشغيل</button><button data-v="0">إيقاف</button></div>
        <div class="seg" id="sDiff"><button data-v="1">سهل</button><button data-v="2">عاديّ</button></div></div>`;
    const mg = $("modeGrid");
    for (const m of ["classic", "rush", "master", "missions", "night", "king"]) {
      const b = document.createElement("button");
      b.className = "mode"; b.dataset.m = m;
      b.innerHTML = "<b>" + MODE_ICON[m] + " " + esc(NAMES.modes[m] || m) + "</b><span>" + esc(MODE_DESC[m]) + "</span>";
      b.onclick = () => push({ mode: m });
      mg.appendChild(b);
    }
    const seg = (id, key, cast) => $(id).querySelectorAll("button").forEach(b => b.onclick = () => push({ [key]: cast(b.dataset.v) }));
    seg("sTeams", "teams", v => v === "1");
    seg("sShared", "sharedSafe", v => v === "1");
    seg("sPlayers", "players", Number);
    seg("sPU", "powerups", v => v === "1");
    seg("sBots", "bots", v => v === "1");
    seg("sDiff", "botDiff", Number);
    $("sPUc").onchange = () => push({ powerCount: +$("sPUc").value });
    $("sSecs").onchange = () => push({ turnSecs: +$("sSecs").value });
    /* أنواعُ المعزّزات: زرٌّ لكلّ نوع، يُمنَع بلمسة ويُسمَح بأخرى (ويبقى واحدٌ على الأقلّ) */
    const pt = $("sPUt");
    for (const k of POWER_KEYS) {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.p = k;
      b.innerHTML = '<span class="pi">' + (NAMES.icons[k] || "") + "</span>" + esc(NAMES.powers[k] || k);
      b.onclick = () => {
        const cur = typesOf(settings);
        const next = cur.includes(k) ? cur.filter(x => x !== k) : POWER_KEYS.filter(x => x === k || cur.includes(x));
        if (!next.length) return toast("اترك معزّزًا واحدًا على الأقلّ — أو أوقف المعزّزات كلَّها");
        push({ powerTypes: next });
      };
      pt.appendChild(b);
    }
  }
  /* أنواعُ المعزّزات المسموحة (الإعداداتُ القديمة بلا قائمة ⇒ كلُّها) */
  const POWER_KEYS = ["gold", "jump", "bubble", "wind", "swap"];
  const typesOf = S => (S && Array.isArray(S.powerTypes) && S.powerTypes.length ? POWER_KEYS.filter(k => S.powerTypes.includes(k)) : POWER_KEYS.slice());
  /* نُرسل **التغيير وحده** لا الإعداداتِ كلَّها: لو أرسلنا نسختنا كاملةً
     ونقر المضيفُ خيارين أسرعَ من ردّ الخادم، لحملت النقرةُ الثانيةُ قيمةَ
     الأولى القديمة فألغتها (أطفأ البوتات ثمّ اختار العدد ⇒ عادت البوتات).
     والخادمُ يدمج الجزءَ في إعداداته (sanitize) — ونعكس التغيير هنا فورًا */
  function push(d) {
    Object.assign(settings, d);
    syncSettings();
    socket.emit("updateSettings", d);
  }
  function syncSettings() {
    const S = settings;
    const on = (id, v) => { const e = $(id); if (e) e.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
    document.querySelectorAll("#modeGrid .mode").forEach(b => b.classList.toggle("on", b.dataset.m === S.mode));
    on("sTeams", S.teams ? 1 : 0); on("sShared", S.sharedSafe ? 1 : 0); on("sPlayers", S.players);
    on("sPU", S.powerups ? 1 : 0); on("sBots", S.bots ? 1 : 0); on("sDiff", S.botDiff);
    $("rowShared").style.display = S.teams ? "" : "none";
    $("rowPlayers").style.display = S.teams ? "none" : "";
    $("sPUc").style.display = S.powerups ? "" : "none";
    $("sPUt").style.display = S.powerups ? "" : "none";
    $("sPUhint").style.display = S.powerups ? "" : "none";
    const allowed = typesOf(S);
    $("sPUt").querySelectorAll("button").forEach(b => {
      const on = allowed.includes(b.dataset.p);
      b.classList.toggle("on", on);
      b.title = on ? "مسموح — اضغط لتمنعه" : "ممنوع — اضغط لتسمح به";
    });
    $("sPUc").value = String(S.powerCount); $("sSecs").value = String(S.turnSecs);
    $("sDiff").style.display = S.bots ? "" : "none";
  }
  $("setOpen").onclick = () => $("setBox").classList.toggle("open");
  $("startBtn").onclick = () => socket.emit("startGame");

  /* ══════════ القواعد ══════════ */
  function rulesHTML(mode) {
    const r = (t, b) => '<div class="rule"><b>' + t + "</b>" + b + "</div>";
    /* ما منعه مضيفُ الغرفة يُعرض باهتًا بعلامة «ممنوع» */
    const allowed = typesOf((VIEW && VIEW.rules) || settings);
    const pu = (k, t) => '<div class="rule pu' + (allowed.includes(k) ? "" : " off") + '"><span class="ic" style="background:' + PU_BG[k] + '">' +
      (NAMES.icons[k] || "") + "</span><div><b>" + esc(NAMES.powers[k] || k) + (allowed.includes(k) ? "" : " — 🚫 ممنوعٌ في هذه الغرفة") + "</b>" + t + "</div></div>";
    const M = {
      classic: r("🎲 الكلاسيكيّ", "أوصِل قطعك الأربع إلى المركز أوّلًا."),
      rush: r("⚡ السريع", "تبدأ قطعةٌ لكلّ لاعبٍ على مربّع انطلاقه، وأوّلُ قطعةٍ تصل المركز تفوز."),
      master: r("🧱 الاحترافيّ", "قطعتان لك في مربّعٍ واحدٍ تصنعان <b style='display:inline'>حاجزًا</b> لا يتخطّاه أحدٌ ولا يأكله — حتى زميلك. ولا حاجزَ على المربّعات الآمنة. ودخولُ المركز بالرقم المطابق تمامًا، وإلا ارتدّت القطعة إلى الخلف."),
      missions: r("🕵️ المهامّ السرّيّة", "لكلّ لاعبٍ مهمّةٌ لا يراها غيره (وفي الفرق يراها زميله). أوّلُ من ينجز مهمّته يفوز فورًا — ومن أوصل قطعه الأربع قبل ذلك يفوز كذلك."),
      night: r("🌙 الظلام", "لا ترى من الطريق إلا ٤ مربّعاتٍ حول كلّ قطعةٍ لك؛ وما وراءها مخفيٌّ تمامًا. إذا أكلت قطعةً انكشفت لك اللوحةُ حتى نهاية دورك. في الفرق رؤيتُكما مشتركة. وأوّلُ قطعةٍ تصل المركز تفوز."),
      king: r("👑 الملك", "لك ثلاثةُ حرّاسٍ 🛡️ وملكٌ 👑. الملكُ مقفلٌ حتى يخرج حارسٌ ويخطو خطوة. لا يمشي الملك إلا على مربّعاتٍ مشاها حرّاسُك (اضغط على ملكك لترى مساره). إذا هوجم الملك تستطيع التضحية بحارسٍ على اللوحة فيبقى الملك ويعود الحارس محظورًا ٣ أدوار. تفوز بإيصال ملكك إلى المركز أو بإسقاط ملوك الجميع. في الفرق: يمشي ملكك على ما عبّده حرّاسُ زميلك أيضًا، ويفوز الفريق بملكٍ واحد ويخسر بسقوط الملكين.")
    };
    return r("القواعد الأساسيّة", "تخرج القطعةُ من القاعدة بالرقم ٦ · مربّعاتُ الانطلاق والنجوم ★ آمنة · لا تجاوزَ للمركز (إلا الارتداد في الاحترافيّ).") +
      r("🧱 الزوج المحميّ", "قطعتان من لونٍ واحدٍ في مربّعٍ واحدٍ (غيرِ آمن) لا ينزل عليهما الخصم ولا يأكلهما — لكنّه يتخطّاهما. ولا تدفعهما الرياح ولا يُبدَّل معهما.") +
      r("🎲 النرد", "إذا طلعت ستّة ترمي مرّةً أخرى <b style='display:inline'>قبل</b> أن تحرّك، وتتجمّع الأرقام تحت نردك (٦ ثمّ ٤ مثلًا)، ثمّ تُنفقها رقمًا رقمًا: أيُّ قطعةٍ تمشي بأيّ رقم — وإن مشت قطعةٌ بأكثر من رقم اختر الرقمَ من الفقاعة فوقها. " +
        "ثلاثُ ستّاتٍ متتالية تُلغي الدورَ كلَّه. أكلُ قطعةٍ أو إدخالُها المركز يمنح رميةً جديدة، وما بقي من أرقامك يبقى لك. " +
        "والنردُ نردُ لعبة يلا لودو: الستّةُ تأتي أكثرَ قليلًا (نحو ٢٣٪)، وإن كانت قطعُك كلُّها في القاعدة ساعدك بستّةٍ أكثر.") +
      r("⏱️ الوقت", "لكلّ خطوةٍ مهلة تظهر دائرةً تنقص فوق صورتك. إن انتهت لعب عنك اللعبُ التلقائيّ (AUTO) حتى تلمس الشاشة.") +
      (M[mode] || "") +
      r("👥 الفرق ٢ ضدّ ٢", "الأحمر والأصفر ضدّ الأخضر والأزرق — زميلُك <b style='display:inline'>مقابلُك</b> على اللوحة لا جارُك، ومكتوبٌ «زميلك» على لوحته. لا يأكل الزميلُ زميله أبدًا. من أنهى قطعه يرمي النرد ويحرّك قطع زميله. " +
        "«التأمين المشترك» مفعّلًا: يقف الزميلان في مربّعٍ واحدٍ فيصير آمنًا لا يُؤكلان فيه؛ ومطفأً: لا يقفان معًا إلا على النجوم ومربّعات الانطلاق.") +
      '<div class="modeTag" style="margin-top:4px">✨ المعزّزات (حين تُفعَّل)</div>' +
      pu("gold", "رميتُك القادمة ستّةٌ مضمونة.") +
      pu("jump", "تقفز القطعةُ وثبةً واحدةً ١ إلى ٣ مربّعاتٍ عشوائيًّا (وتقف قبل زوج الخصم).") +
      pu("bubble", "لا تُؤكل القطعةُ دورةً كاملة.") +
      pu("wind", "خصومُ المربّعات الثلاثة خلفك يرتدّون إلى المربّع الرابع: إن كانوا من لونين مختلفين أكل الأقربُ إليك الأبعد، وإن كانوا من لونٍ واحدٍ وقفوا معًا زوجًا محميًّا. والزوجُ القائم لا تدفعه الريح. ولا أحد خلفك ⇒ تتقدّم خطوة.") +
      pu("swap", "تبدّل مكانك مع خصمٍ في نطاق ٥ مربّعاتٍ أمامك أو خلفك (إلا قطعةً في زوجٍ محميّ).");
  }
  $("rulesBtn").onclick = () => {
    $("rulesBody").innerHTML = rulesHTML((VIEW && VIEW.rules.mode) || (settings && settings.mode) || "classic");
    openModal("rulesModal");
  };

  /* ══════════ النهاية ══════════ */
  const REASON = { allHome: "أوصل القطعَ الأربع إلى المركز", first: "أوّلُ قطعةٍ في المركز", mission: "أنجز مهمّته السرّيّة",
                   kingHome: "أوصل ملكه إلى المركز", lastKing: "آخرُ ملكٍ قائم", limit: "انتهت المباراة بلا فائز", noKings: "سقطت الملوك كلُّها" };
  function onEnd(res) {
    const names = (res.names || []).join(" و");
    const iWon = res.seats && res.seats.includes(mySeat);
    $("endBanner").innerHTML = (res.seats && res.seats.length ? (iWon ? "🏆 فزت" + (res.teams ? " مع فريقك" : "") + "!" : "🏆 الفائز: " + esc(names)) : "انتهت المباراة") +
      "<small>" + esc(REASON[res.reason] || "") + "</small>";
    $("endBanner").style.background = iWon ? "linear-gradient(180deg,#38b06a,#22854b)" : "linear-gradient(180deg,#5b7fd6,#3a57a8)";
    const mis = res.missions || {};
    $("endMissions").innerHTML = Object.keys(mis).length
      ? '<div class="modeTag">🕵️ المهامّ كُشفت</div>' + Object.entries(mis).map(([s, m]) =>
          '<div class="rule"><b>' + esc(m.name || G.COLOR_AR[s]) + "</b>" + esc(m.text) + " — " + AR_NUM(m.prog || 0) + "/" + AR_NUM(m.goal) + "</div>").join("")
      : "";
    $("endAgain").style.display = LOBBY && LOBBY.host === ME ? "" : "none";
    openModal("endModal");
    snd(iWon ? "fin" : "turn");
  }
  /* إغلاقُ النتيجة (بأيّ طريقة) يعيد إلى اللوبي — إلا إن بدأت جولةٌ جديدة */
  onClose.endModal = () => {
    if (!ended) return;
    ended = false;
    if (!LOBBY || !LOBBY.playing) toLobby();
  };
  /* عبر اللوبي لا مباشرةً: إن رُفض البدء (مقاعدُ ناقصة) بقي المضيفُ في
     اللوبي يرى السبب، لا على لوحةٍ منتهيةٍ بلا مخرج */
  $("endAgain").onclick = () => { closeModal("endModal"); socket.emit("startGame"); };

  /* ══════════ الدردشة: شريطٌ تحت (كالمرجع) ══════════
     😊 عباراتٌ جاهزة وإيموجي بلمسة، 💬 دردشةٌ مكتوبة بعدّاد ما لم يُقرأ،
     وكلُّ رسالةٍ تظهر فقاعةً بجانب صورة صاحبها في زاويته. العباراتُ عباراتُنا. */
  const PHRASES = ["السلام عليكم 👋", "بالتوفيق للجميع 🤝", "لعبة حلوة 👏", "يلا بسرعة شوي ⏳",
                   "حركة ذكية 🔥", "جايك جايك 😈", "تكفى لا تاكلني 🥺", "معليش يا صاحبي 😅",
                   "مشكور 🙏", "يا ساتر! 😱", "هههههه 😂", "اليوم يومي 😎"];
  const EMOJI = ["😂", "😎", "😍", "😡", "😭", "🥳", "😱", "🤔", "👍", "👏", "🔥", "💪", "🤝", "😈", "🙈", "❤️"];
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
    u.textContent = unread > 9 ? "+٩" : AR_NUM(unread);
    u.classList.toggle("on", unread > 0);
  }
  $("quickBtn").onclick = e => {
    e.stopPropagation();
    $("chatCard").classList.remove("on");
    $("quickPop").classList.toggle("on");
  };
  $("chatBtn").onclick = e => {
    e.stopPropagation();
    $("quickPop").classList.remove("on");
    const on = $("chatCard").classList.toggle("on");
    if (on) { unread = 0; paintUnread(); $("msgs").scrollTop = $("msgs").scrollHeight; }
  };
  $("chatClose").onclick = () => $("chatCard").classList.remove("on");
  document.addEventListener("pointerdown", e => {
    if (!e.target.closest) return;
    if (!e.target.closest("#quickPop") && !e.target.closest("#quickBtn")) $("quickPop").classList.remove("on");
  });
  /* إيموجي وحده ⇒ فقاعةٌ بخطٍّ كبير (كوجوه المرجع المتحرّكة) */
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u;
  function bubble(seat, text) {
    const pp = panels[seat];
    if (!pp) return;
    const b = pp.querySelector(".bub");
    b.textContent = text;
    b.classList.toggle("big", EMOJI_ONLY.test(text) && text.length <= 8);
    b.classList.add("on");
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove("on"), 4000);
  }
  /* quiet: سجلٌّ قديمٌ يُعرض عند الدخول — بلا فقاعاتٍ ولا عدّاد */
  function addMsg(m, sys, quiet) {
    const d = document.createElement("div");
    d.className = "msg" + (sys ? " system" : "");
    if (sys) d.textContent = m;
    else { d.innerHTML = "<b>" + esc(m.name) + ":</b> " + esc(m.text); if (m.seat >= 0) d.querySelector("b").style.color = DEEP[m.seat]; }
    $("msgs").appendChild(d);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    if (sys || quiet) return;
    if (m.seat >= 0) bubble(m.seat, m.text);
    if (VIEW && m.seat !== mySeat && !$("chatCard").classList.contains("on")) { unread++; paintUnread(); }
  }
  $("chatForm").onsubmit = e => {
    e.preventDefault();
    const t = $("chatInput").value.trim();
    if (!t) return;
    socket.emit("chat", { text: t });
    $("chatInput").value = "";
  };

  /* ══════════ اللعب التلقائيّ: لمسةٌ في أيّ مكانٍ تُعيدك (كالمرجع) ══════════ */
  let manualAt = 0;
  document.addEventListener("pointerdown", () => {
    if (!$("autoBar").classList.contains("on")) return;
    const now = Date.now();
    if (now - manualAt < 1500) return;
    manualAt = now;
    socket.emit("manual");
    $("autoBar").classList.remove("on");
    toast("👋 رجعت تلعب بنفسك");
  }, true);

  /* ══════════ الاتّصال والدخول ══════════ */
  socket = io("/ludo");
  const invite = new URLSearchParams(location.search).get("r");
  /* رابطُ دعوة: الرمزُ معروفٌ من الرابط، فلا خانةَ له — والزرُّ بعرض البطاقة.
     كانت الخانةُ تأخذ نصفَ الصفّ فيُقصّ رقمُ الغرفة في زرّ «ادخل الغرفة» على
     الجوال. والرقمُ معزولٌ اتّجاهيًّا (⁨…⁩) كي لا يلتصق بالنصّ العربيّ حوله. */
  const BIDI = s => "⁨" + s + "⁩";
  if (invite) {
    const code = invite.trim().slice(0, 6);
    $("pRoom").value = code;
    $("pRoom").style.display = "none";
    $("createBtn").style.display = "none";
    $("joinBtn").textContent = "🚪 ادخل الغرفة " + BIDI(code);
    document.querySelector(".divider").textContent = "— دعوة لغرفة " + BIDI(code) + " —";
  }
  /* دعوةٌ لغرفةٍ انتهت: نُعيد الخانةَ وزرَّ الإنشاء — وإلا علق الزائرُ بلا مخرج */
  function inviteFailed() {
    if (!invite) return;
    $("pRoom").style.display = "";
    $("createBtn").style.display = "";
    $("joinBtn").textContent = "انضمام 🚪";
    document.querySelector(".divider").textContent = "— أو انضم لغرفة موجودة —";
  }

  socket.on("hello", h => {
    DEFAULTS = h.defaults;
    NAMES = { modes: h.modeNames || {}, powers: h.powerNames || {}, icons: h.powerIcons || {} };
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
    /* العودةُ بعد انقطاعٍ قصير لا تمرّ باللوبي: الحالةُ التالية تعيد اللوحة */
    const first = ROOM !== res.roomId;
    ME = res.you; TOKEN = res.token; ROOM = res.roomId;
    try { localStorage.setItem("ludoResume", JSON.stringify({ room: ROOM, token: TOKEN, at: Date.now() })); } catch (e) {}
    history.replaceState(null, "", "?r=" + ROOM);
    $("roomCode").textContent = ROOM;
    if (first) showScreen("lobby");
  }
  /* يُستدعى مع كلّ «hello» — أي مع كلّ اتّصالٍ أو إعادة اتّصال — فلا
     حاجةَ لمستمعِ reconnect ثانٍ يُرسل الطلبَ مرّتين */
  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem("ludoResume") || "null"); } catch (e) {}
    if (!s || !s.room || !s.token || Date.now() - (s.at || 0) > 6 * 3600 * 1000) return;
    /* رابطُ دعوةٍ لغرفةٍ أخرى يغلب جلسةً قديمة: من فتح دعوةً يريدها هي */
    if (!ROOM && invite && invite.trim() !== s.room) return;
    socket.emit("rejoin", { roomId: s.room, token: s.token }, res => {
      if (!res.ok) { try { localStorage.removeItem("ludoResume"); } catch (e) {} return; }
      const back = !!ROOM;
      enter(res);
      if (!back) toast("رجعت للغرفة 👋");
    });
  }

  socket.on("lobby", L => renderLobby(L));
  socket.on("state", st => onState(st));
  socket.on("started", () => {
    /* جولةٌ جديدة: نافذةُ الجولة السابقة تُطوى بلا عودةٍ إلى اللوبي، والقطعُ
       القديمة تُزال كي لا تنزلق من مواقعها السابقة إلى القواعد */
    ended = false;
    $("endModal").classList.remove("on");
    for (const k in toks) { toks[k].remove(); delete toks[k]; }
    resetPanels(); hidePicker();
    mySeat = null; showPath = false;
    addMsg("🎲 بدأت المباراة — بالتوفيق!", true);
  });
  socket.on("matchEnd", async res => {
    ended = true;
    /* الحركةُ الفائزة تُكمل رسمها أوّلًا، ثمّ تظهر النتيجة */
    await whenIdle();
    await sleep(350);
    if (ended) onEnd(res);
  });
  socket.on("chat", m => addMsg(m));
  socket.on("chatLog", list => { $("msgs").innerHTML = ""; list.forEach(m => addMsg(m, false, true)); });
  socket.on("toast", t => { moveSentAt = 0; toast(t); });
  socket.on("kicked", () => {
    try { localStorage.removeItem("ludoResume"); } catch (e) {}
    alert("تم إخراجك من الغرفة"); location.href = "/ludo/";
  });
  $("roomChip").onclick = () => {
    const link = location.origin + "/ludo/?r=" + ROOM;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => toast("انتُسخ رابط الدعوة 📋")).catch(() => prompt("انسخ الرابط:", link));
  };

  showScreen("join");
})();
