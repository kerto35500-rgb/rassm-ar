/* 🤖 لودو — البوت.
 *
 * يقرّر من **عرضه هو** لا من الحالة الكاملة: في الظلام لا يرى إلا ما يراه
 * لاعبٌ بشريّ في مقعده، وفي المهامّ لا يعرف مهامَّ خصومه. بوتٌ يغشّ يُفسد
 * الوضعين اللذين بُنيا على المعلومة الناقصة.
 *
 * المستوى ٢: يقيّم كلَّ حركةٍ مشروعة بنقاط (أكلٌ، أمانٌ، تقدّمٌ، مهمّة،
 * ملك…) ويختار أعلاها. المستوى ١: الشيءُ نفسه مع ضجيجٍ كبير — يخطئ كما
 * يخطئ المبتدئ لا كما يخطئ النرد.
 */
"use strict";

const L = require("./ludorules");
const { TRACK, LAST_TRACK, HOME_FIRST, FINISH, BASE, STARS, absOf } = L.G;
const SAFE = L.SAFE;

const teamOf = s => s % 2;

function isFoe(view, a, b) {
  return a !== b && !(view.rules.teams && teamOf(a) === teamOf(b));
}

/** كلُّ قطعةٍ معروفةٍ للبوت على الطريق: {seat, idx, k, p, abs, sh} */
function onTrack(view) {
  const out = [];
  for (const s of view.seats) (view.pieces[s] || []).forEach((pc, idx) => {
    if (pc.hidden || !(pc.p >= 0 && pc.p <= LAST_TRACK)) return;
    out.push({ seat: s, idx, k: pc.k, p: pc.p, abs: absOf(s, pc.p), sh: !!pc.sh });
  });
  return out;
}

/** كم خصمًا يستطيع أن ينزل على هذا المربّع برميةٍ واحدة (١..٦). */
function threats(view, owner, abs, track) {
  if (SAFE.has(abs)) return 0;
  let n = 0;
  for (const o of track) {
    if (!isFoe(view, owner, o.seat)) continue;
    const d = (abs - o.abs + TRACK) % TRACK;
    if (d >= 1 && d <= 6 && o.p + d <= LAST_TRACK) n++;
  }
  return n;
}

function scoreMove(view, mv, track, diff, rnd) {
  const me = view.me;
  const mode = view.rules.mode;
  const pc = view.pieces[mv.owner][mv.idx];
  const king = pc.k === "king";
  const toAbs = mv.to <= LAST_TRACK ? absOf(mv.owner, mv.to) : null;
  const fromAbs = mv.from >= 0 && mv.from <= LAST_TRACK ? absOf(mv.owner, mv.from) : null;
  const mission = view.missions && view.missions[me] && !view.missions[me].hidden ? view.missions[me] : null;
  let s = 0;

  /* الوصول */
  if (mv.to === FINISH) {
    s += 70;
    if (mode === "rush" || mode === "night") s += 1000;
    if (mode === "king" && king) s += 1000;
    if (mission && mission.id === "home") s += 40;
    /* لا تُدخِل آخرَ حارسٍ على اللوحة والملكُ يحتاج من يفديه */
    if (mode === "king" && !king) {
      const onBoard = view.pieces[mv.owner].filter(x => x.k === "guard" && x.p >= 0 && x.p < FINISH).length;
      const kingOut = view.pieces[mv.owner].some(x => x.k === "king" && x.p >= 0 && x.p < FINISH);
      if (onBoard <= 1 && kingOut) s -= 25;
    }
  }
  if (mv.from <= LAST_TRACK && mv.to >= HOME_FIRST && mv.to < FINISH) {
    s += 32;
    if (mission && mission.id === "deep") s += 30;
  }

  /* الخروج من القاعدة */
  if (mv.from === BASE) {
    s += 28;
    const out = view.pieces[mv.owner].filter(x => x.p >= 0 && x.p < FINISH).length;
    if (!out) s += 15;
    if (mission && mission.id === "allOut") s += 30;
    if (king) s += 20;
  }

  /* الأكل */
  if (toAbs != null && !SAFE.has(toAbs)) {
    for (const o of track) {
      if (o.abs !== toAbs || !isFoe(view, mv.owner, o.seat) || o.sh) continue;
      s += 45 + o.p * 0.9;
      if (o.k === "king") s += 220;
      if (mission && mission.id === "eatColor" && mission.target === o.seat) s += 90;
      if (mission && mission.id === "eat") s += 35;
      if (mission && mission.id === "nearEat" && mv.to <= 6) s += 90;
    }
  }

  /* الأمان. قطعتان للّون نفسه في مربّعٍ غيرِ آمن زوجٌ لا يُنزَل عليه (قاعدةُ
     المرجع) — فمن ينضمّ إلى قطعةٍ له لا خطرَ عليه هناك، والزوجُ مكسبٌ صغير */
  const pairs = toAbs != null && !SAFE.has(toAbs) &&
    track.some(o => o.seat === mv.owner && o.idx !== mv.idx && o.abs === toAbs);
  if (pairs && mode !== "master") s += 10;
  const danger = toAbs != null && !pairs ? threats(view, mv.owner, toAbs, track) : 0;
  const shielded = !!pc.sh;
  if (toAbs != null) {
    if (SAFE.has(toAbs)) s += 14;
    if (!shielded) s -= danger * (king ? 95 : 24) * (1 + mv.to / 60);
  }
  if (fromAbs != null && !shielded) {
    const was = threats(view, mv.owner, fromAbs, track);
    if (was) s += was * (king ? 70 : 18) * (1 + mv.from / 60);
    if (SAFE.has(fromAbs)) s -= 7;
  }

  /* التقدّم */
  s += (mv.to - Math.max(0, mv.from)) * 0.6;
  if (mv.bounce) s -= 6;

  /* المعزّزات */
  if (toAbs != null && view.powerups) {
    const pu = view.powerups.find(x => x.cell === toAbs);
    if (pu) {
      s += 18 + (pu.type === "gold" ? 6 : pu.type === "swap" ? 4 : 0);
      if (mission && ((mission.id === "puSwap" && pu.type === "swap") ||
                      (mission.id === "puWind" && pu.type === "wind") ||
                      (mission.id === "puGold" && pu.type === "gold") || mission.id === "puAny")) s += 35;
    }
  }

  /* المهامّ التي تقاس بالمكان */
  if (mission && toAbs != null) {
    if (mission.id === "stars" && STARS.includes(toAbs)) s += 30;
    if (mission.id === "stack" && track.some(o => o.seat === mv.owner && o.abs === toAbs && o.idx !== mv.idx)) s += 60;
  }

  /* الاحترافيّ: الحاجز */
  if (mode === "master" && toAbs != null && !SAFE.has(toAbs)) {
    if (track.some(o => o.seat === mv.owner && o.idx !== mv.idx && o.abs === toAbs)) s += 16;
    if (fromAbs != null && track.some(o => o.seat === mv.owner && o.idx !== mv.idx && o.abs === fromAbs)) s -= 12;
  }

  /* الملك: الحرّاس يعبّدون الطريق، والملك يتقدّم ما دام آمنًا */
  if (mode === "king") {
    if (!king) {
      const sec = new Set(view.secured || []);
      let fresh = 0;
      for (const q of mv.path || []) {
        const key = q <= LAST_TRACK ? "t" + absOf(mv.owner, q) : "h" + mv.owner + "_" + (q - HOME_FIRST);
        if (!sec.has(key)) fresh++;
      }
      s += fresh * 1.6;
    } else s += 10 + (mv.to - Math.max(0, mv.from)) * 1.2;
  }

  /* المستوى ١: ضجيجٌ يجعله يُخطئ أحيانًا */
  s += (rnd() - 0.5) * (diff <= 1 ? 70 : 6);
  return s;
}

function chooseMove(view, diff, rnd) {
  const legal = view.legal || [];
  if (!legal.length) return null;
  if (diff <= 1 && rnd() < 0.22) return legal[Math.floor(rnd() * legal.length)].id;
  const track = onTrack(view);
  let best = legal[0], bs = -Infinity;
  for (const mv of legal) {
    const sc = scoreMove(view, mv, track, diff, rnd);
    if (sc > bs) { bs = sc; best = mv; }
  }
  return best.id;
}

/** التبديل: أكبرُ قفزةٍ للأمام، ثمّ أبعدُ خصمٍ يُعاد. */
function chooseSwap(view) {
  const pr = view.prompt;
  if (!pr || !pr.options || !pr.options.length) return 0;
  let best = pr.options[0], bs = -Infinity;
  for (const o of pr.options) {
    const him = view.pieces[o.seat] && view.pieces[o.seat][o.idx];
    const sc = o.d * 3 + (him && him.p > 0 ? him.p * 0.25 : 0) + (him && him.k === "king" ? 20 : 0);
    if (sc > bs) { bs = sc; best = o; }
  }
  return best.id;
}

/** التضحية: دائمًا — الملكُ أغلى من أيّ حارس. والحارسُ الأقلّ تقدّمًا يُفدى به. */
function chooseSacrifice(view) {
  const pr = view.prompt;
  if (!pr || !pr.options || !pr.options.length) return "none";
  let best = pr.options[0], bp = Infinity;
  for (const gi of pr.options) {
    const g = view.pieces[pr.seat][gi];
    const p = g && g.p != null ? g.p : 0;
    if (p < bp) { bp = p; best = gi; }
  }
  return best;
}

/** القرارُ التالي للبوت من عرضه: رميٌ أو تحريكٌ أو جواب. */
function decide(view, diff = 2, rnd = Math.random) {
  if (!view || view.phase === "over") return null;
  if (view.prompt && view.prompt.seat === view.me && view.prompt.options) {
    return { kind: "choose", choice: view.prompt.kind === "sacrifice" ? chooseSacrifice(view) : chooseSwap(view) };
  }
  if (view.turn !== view.me) return null;
  if (view.phase === "roll") return { kind: "roll" };
  if (view.phase === "move") {
    const id = chooseMove(view, diff, rnd);
    return id == null ? null : { kind: "move", id };
  }
  return null;
}

module.exports = { decide, chooseMove, chooseSwap, chooseSacrifice, threats, onTrack };
