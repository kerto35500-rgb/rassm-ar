// 🃏 محرّك قواعد «اونو» — منطقٌ خالصٌ بلا شبكةٍ ولا رسم.
//
// لماذا ملفٌّ مستقلّ؟ لأن قواعد اللعبة كانت في المتصفّح متشابكةً مع الحركة
// والصوت: `await flyCard` بين سطرَي قاعدة. ذلك يعمل للّعب ضدّ الحاسوب، لكنه
// لا يصلح أونلاين — فمن يملك الكرت يملك القاعدة، ومن يفتح أدوات المطوّر
// يرى كروت خصومه. هنا القواعد وحدها: تأخذ حالةً وفعلًا، فتُرجع حالةً وأحداثًا.
//
// والحالة قابلةٌ للنسخ والمقارنة، فيُختبَر المحرّك بلا خادمٍ ولا متصفّح.
//
// المصطلحات: `state` كل شيء، و`view(state, playerId)` ما يحقّ لهذا اللاعب
// أن يراه — كروت غيره أعدادٌ لا أوراق. لا تُرسَل الحالة الكاملة أبدًا.

"use strict";

const COLORS = ["r", "g", "b", "y"];
const CNAME = { r: "الأحمر", g: "الأخضر", b: "الأزرق", y: "الأصفر" };
const DRAWV = { d2: 2, d4: 4, d6: 6, d10: 10, draw4: 4, revd4: 4 };
const NAMES = { d2: "+٢", d4: "+٤", d6: "+٦", d10: "+١٠", draw4: "+٤",
                revd4: "عكس +٤", rev: "عكس", skip: "حظر", skipall: "حظر الجميع",
                discard: "ارمِ الكل", wild: "تغيير اللون", roulette: "روليت" };

/* الافتراضيّات نفسها التي في اللعبة المحلّيّة، كي لا يختلف الوضعان */
const DEFAULTS = {
  mode: "nomercy", limit: 500, timer: 30,
  stacking: true, seven0: false, mercy: true, jumpin: false,
  forceplay: false, challenge: true, bots: true, botDiff: "normal"
};

/* ── عشوائيّةٌ قابلة للحقن ──
   الخادم يستعمل Math.random، والاختبار يحقن مولّدًا ثابتًا فتصير كل مباراةٍ
   قابلةً للإعادة حرفًا بحرف. لا اختبار جدّيّ للعبةِ ورقٍ بلا هذا. */
function rngFrom(seed) {
  if (typeof seed === "function") return seed;
  let s = (seed >>> 0) || 123456789;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(mode, rnd) {
  const d = [];
  let id = 1;
  const add = (c, v, n) => { for (let i = 0; i < n; i++) d.push({ c, v, id: id++ }); };
  if (mode === "classic") {
    for (const c of COLORS) {
      add(c, "0", 1);
      for (let i = 1; i <= 9; i++) add(c, String(i), 2);
      add(c, "d2", 2); add(c, "skip", 2); add(c, "rev", 2);
    }
    add("w", "wild", 4); add("w", "draw4", 4);
  } else {
    for (const c of COLORS) {
      for (let i = 0; i <= 9; i++) add(c, String(i), 2);
      for (const v of ["d2", "d4", "rev", "skip", "skipall", "discard"]) add(c, v, 3);
    }
    for (const v of ["d6", "d10", "revd4", "roulette"]) add("w", v, 4);
  }
  return shuffle(d, rnd);
}

const isWild = k => k.c === "w";
const isNum  = k => /^\d$/.test(k.v);
const drawV  = k => DRAWV[k.v] || 0;
const cardPts = k => (k.c === "w" ? 50 : (isNum(k) ? +k.v : 20));
const cardName = k => (k.c === "w" ? (NAMES[k.v] || k.v) : `${NAMES[k.v] || k.v} ${CNAME[k.c]}`);

/* ── إنشاء مباراة ── */
function createMatch({ players, settings = {}, seed = null }) {
  const S = { ...DEFAULTS, ...settings };
  if (S.mode !== "classic" && S.mode !== "nomercy") S.mode = "nomercy";
  return {
    S,
    rndSeed: seed,
    players: players.map((p, i) => ({
      id: p.id, seat: i, name: p.name, av: p.av || "Adult_1", frame: p.frame || "Classic",
      bot: !!p.bot, userId: p.userId || null, ip: p.ip || null,
      hand: [], score: 0, uno: false, forgot: false, out: false, outPts: 0, left: false
    })),
    round: 0, over: false, matchWinner: null,
    /* تُملأ عند بدء الجولة */
    deck: [], discard: [], color: null, dir: 1, turn: 0,
    pending: 0, pendingType: null, challengeInfo: null,
    phase: "lobby", pendingFor: null, drawn: null,
    events: []
  };
}

function emit(st, type, data) { st.events.push({ t: type, ...data }); }

/* ── بدء جولة ── */
function startRound(st, seed = null) {
  const rnd = rngFrom(seed != null ? seed : (st.rndSeed != null ? st.rndSeed + st.round : Math.random));
  st.round++;
  st.deck = makeDeck(st.S.mode, rnd);
  st.discard = [];
  st.dir = 1; st.pending = 0; st.pendingType = null; st.challengeInfo = null;
  st.drawn = null; st.over = false;
  st.players.forEach(p => { p.hand = []; p.uno = false; p.forgot = false; p.out = false; p.outPts = 0; });

  const n = st.S.mode === "classic" ? 7 : 7;
  for (let r = 0; r < n; r++) for (const p of st.players) p.hand.push(st.deck.pop());

  /* أوّل كرتٍ مكشوف عاديٌّ لا أثرَ له، كي لا تبدأ الجولة بعقوبةٍ أو حظر.
     والمرفوض يعود إلى قاع الرزمة لا إلى الكومة — وإلا بدأت الجولة وفوق
     الكومة كرتٌ لم يلعبه أحد، وحُسبت أوراقٌ مرميّةً وهي لم تُرمَ. */
  let first = null;
  const rejected = [];
  while (st.deck.length) {
    const k = st.deck.pop();
    if (isWild(k) || drawV(k) > 0 || ["skip", "skipall", "rev", "discard"].includes(k.v)) { rejected.push(k); continue; }
    first = k; break;
  }
  st.deck.unshift(...shuffle(rejected, rnd));
  st.discard.push(first);
  st.color = first.c;

  /* المضيف يبدأ الجولة الأولى، ثم يتناوب البدء بين اللاعبين */
  st.turn = (st.round - 1) % st.players.length;
  st.phase = "turn"; st.pendingFor = null;
  emit(st, "round", { round: st.round, first });
  return st;
}

/* ── مساعدات الدور ── */
const aliveCount = st => st.players.filter(p => !p.out && !p.left).length;
const alive = (st, i) => !st.players[i].out && !st.players[i].left;
function nextSeat(st, i, dir = st.dir) {
  const N = st.players.length;
  for (let s = 0; s < N; s++) { i = (i + dir + N) % N; if (alive(st, i)) return i; }
  return i;
}
const topCard = st => st.discard[st.discard.length - 1];
const seatOf = (st, id) => st.players.findIndex(p => p.id === id);

/** هل يمكن لعب هذا الكرت الآن؟ نفس قواعد النسخة المحلّيّة حرفًا. */
function canPlay(st, k) {
  const top = topCard(st);
  if (st.pending > 0) {
    if (!st.S.stacking) return false;
    if (st.S.mode === "classic") {
      if (st.pendingType === "d2") return k.v === "d2" || k.v === "draw4";
      return k.v === "draw4";
    }
    return drawV(k) > 0;
  }
  if (k.c === "w") return true;
  return k.c === st.color || k.v === top.v;
}
const playableOf = (st, p) => p.hand.filter(k => canPlay(st, k));

function isJumpIn(st, k) {
  const t = topCard(st);
  return st.S.jumpin && !st.pending && t && k.c !== "w" && t.c === k.c && t.v === k.v;
}

/* ── السحب ── */
function reshuffle(st, rnd) {
  if (st.discard.length <= 1) return false;
  const top = st.discard.pop();
  st.deck = shuffle(st.discard, rnd);
  st.discard = [top];
  emit(st, "reshuffle", {});
  return true;
}
function drawOne(st, seat, rnd) {
  const p = st.players[seat];
  if (!st.deck.length && !reshuffle(st, rnd)) return null;
  const k = st.deck.pop();
  if (!k) return null;
  p.hand.push(k);
  p.uno = false;
  return k;
}
function drawMany(st, seat, n, rnd) {
  const got = [];
  for (let i = 0; i < n; i++) { const k = drawOne(st, seat, rnd); if (!k) break; got.push(k); }
  emit(st, "draw", { seat, n: got.length });
  /* قاعدة الرحمة: في «بلا رحمة» وحدها. كانت تُعرَض في الكلاسيكيّ كأنها
     مفعَّلةٌ ولا تُطفأ، وهي لم تكن تعمل هناك أصلًا. */
  if (st.S.mode === "nomercy" && st.S.mercy && st.players[seat].hand.length >= 25 && !st.players[seat].out)
    eliminate(st, seat, rnd);
  return got;
}
function eliminate(st, seat, rnd) {
  const p = st.players[seat];
  p.out = true;
  p.outPts = p.hand.reduce((a, k) => a + cardPts(k), 0);
  st.deck.push(...shuffle(p.hand, rnd));
  p.hand = [];
  emit(st, "eliminate", { seat, pts: p.outPts });
  const left = st.players.filter(x => !x.out && !x.left);
  if (left.length === 1) endRound(st, left[0].seat);
}

/* ── نهاية الجولة والمباراة ── */
function endRound(st, winnerSeat) {
  const w = st.players[winnerSeat];
  let gained = 0;
  for (const p of st.players) {
    if (p.seat === winnerSeat) continue;
    gained += p.out ? p.outPts : p.hand.reduce((a, k) => a + cardPts(k), 0);
  }
  w.score += gained;
  st.phase = "roundEnd";
  emit(st, "roundEnd", { winner: winnerSeat, gained, scores: st.players.map(p => p.score) });

  /* «بلا رحمة» جولةٌ واحدة حاسمة، والكلاسيكيّ يتراكم حتى الحدّ */
  const done = st.S.mode === "nomercy" || w.score >= st.S.limit;
  if (done) { st.over = true; st.matchWinner = winnerSeat; st.phase = "matchEnd";
              emit(st, "matchEnd", { winner: winnerSeat }); }
  return st;
}

/* ── لعب كرت ──
 * act: { cardId, color, swap }  — اللون وهدف التبديل يأتيان مع الفعل لا
 * بعده، فلا نحتاج حالةً معلّقةً بين نصف قاعدةٍ ونصف.
 */
function playCard(st, seat, act, rnd) {
  const p = st.players[seat];
  const idx = p.hand.findIndex(x => x.id === act.cardId);
  if (idx < 0) return { ok: false, error: "ليس في يدك" };
  const k = p.hand[idx];

  const jumping = seat !== st.turn && isJumpIn(st, k);
  if (seat !== st.turn && !jumping) return { ok: false, error: "ليس دورك" };
  if (!jumping && !canPlay(st, k)) return { ok: false, error: "كرت غير صالح" };
  if (isWild(k) && !COLORS.includes(act.color)) return { ok: false, error: "اختر لونًا" };

  if (jumping) { st.turn = seat; emit(st, "jumpin", { seat }); }

  p.hand.splice(idx, 1);
  const prevColor = st.color;
  st.discard.push(k);
  st.color = isWild(k) ? act.color : k.c;
  if (isWild(k)) k.chosen = act.color;
  emit(st, "play", { seat, card: k, color: st.color, name: cardName(k) });

  /* «ارمِ الكل»: كل كروت اللون نفسه تسقط معه */
  if (k.v === "discard") {
    const same = p.hand.filter(x => x.c === k.c);
    for (const x of same) { p.hand.splice(p.hand.indexOf(x), 1); st.discard.push(x); }
    if (same.length) emit(st, "discardAll", { seat, n: same.length, color: k.c });
  }

  if (p.hand.length === 1) { p.uno = false; p.forgot = true; emit(st, "oneLeft", { seat }); }
  if (p.hand.length === 0) { endRound(st, seat); return { ok: true }; }

  let advance = 1;
  switch (k.v) {
    case "rev":
      st.dir *= -1;
      if (aliveCount(st) === 2) advance = 2;
      emit(st, "reverse", {});
      break;
    case "skip":
      advance = 2;
      emit(st, "skip", { seat: nextSeat(st, seat) });
      break;
    case "skipall":
      advance = 0;   /* الجميع محظور: يلعب صاحبه دورًا آخر */
      emit(st, "skipall", { seat });
      break;
    case "d2": case "d4": case "d6": case "d10": case "draw4": {
      const stacked = st.pending > 0;
      st.pending += drawV(k);
      st.pendingType = k.v;
      st.challengeInfo = k.v === "draw4"
        ? { by: seat, prevColor, hadColor: p.hand.some(x => x.c === prevColor), stacked }
        : null;
      emit(st, "pending", { n: st.pending });
      break;
    }
    case "revd4":
      st.dir *= -1;
      st.pending += 4; st.pendingType = "revd4"; st.challengeInfo = null;
      emit(st, "reverse", {});
      emit(st, "pending", { n: st.pending });
      break;
    case "roulette": {
      const t = nextSeat(st, seat);
      let n = 0;
      while (!st.players[t].out) {
        const got = drawOne(st, t, rnd);
        n++;
        if (!got || got.c === st.color || n > 30) break;
      }
      emit(st, "roulette", { seat: t, n });
      advance = 2;
      break;
    }
    case "7":
      if (st.S.seven0) {
        const others = st.players.map((x, i) => i).filter(i => i !== seat && alive(st, i));
        if (others.length) {
          const t = others.includes(act.swap) ? act.swap
                  : others.slice().sort((a, b) => st.players[a].hand.length - st.players[b].hand.length)[0];
          const a = st.players[seat], b = st.players[t];
          [a.hand, b.hand] = [b.hand, a.hand];
          a.uno = b.uno = false;
          emit(st, "swap", { a: seat, b: t });
        }
      }
      break;
    case "0":
      if (st.S.seven0) {
        const idxs = st.players.map((x, i) => i).filter(i => alive(st, i));
        const hands = idxs.map(i => st.players[i].hand);
        idxs.forEach((pi, j) => {
          const src = (j - st.dir + idxs.length) % idxs.length;
          st.players[pi].hand = hands[src];
          st.players[pi].uno = false;
        });
        emit(st, "rotate", { dir: st.dir });
      }
      break;
  }

  if (st.over || st.phase === "roundEnd") return { ok: true };
  st.turn = seat;
  for (let i = 0; i < advance; i++) st.turn = nextSeat(st, st.turn);
  st.phase = "turn";
  return { ok: true };
}

/* ── السحب في الدور ── */
function drawTurn(st, seat, rnd) {
  if (seat !== st.turn) return { ok: false, error: "ليس دورك" };
  const p = st.players[seat];

  /* عقوبةٌ متراكمة: يأخذها كاملةً وينتقل الدور */
  if (st.pending > 0) {
    const n = st.pending;
    st.pending = 0; st.pendingType = null; st.challengeInfo = null;
    drawMany(st, seat, n, rnd);
    if (st.over || st.phase === "roundEnd") return { ok: true, took: n };
    st.turn = nextSeat(st, seat);
    return { ok: true, took: n };
  }

  const k = drawOne(st, seat, rnd);
  if (!k) { st.turn = nextSeat(st, seat); return { ok: true, took: 0 }; }
  emit(st, "draw", { seat, n: 1 });

  if (canPlay(st, k)) {
    if (st.S.forceplay) return playCardOrPass(st, seat, k, rnd);
    /* نسأله: يلعبه أم يُبقيه؟ الحالة تنتظر جوابه لا أكثر */
    st.phase = "drawn"; st.pendingFor = seat; st.drawn = k.id;
    return { ok: true, ask: true, card: k };
  }
  st.turn = nextSeat(st, seat);
  return { ok: true, took: 1 };
}

function playCardOrPass(st, seat, k, rnd, color) {
  if (isWild(k) && !color) color = COLORS[Math.floor(rngFrom(rnd)() * 4)];
  return playCard(st, seat, { cardId: k.id, color }, rnd);
}

/** جواب «تلعب الكرت المسحوب؟» */
function answerDrawn(st, seat, yes, color, rnd) {
  if (st.phase !== "drawn" || st.pendingFor !== seat) return { ok: false, error: "لا سؤال" };
  const p = st.players[seat];
  const k = p.hand.find(x => x.id === st.drawn);
  st.phase = "turn"; st.pendingFor = null;
  const id = st.drawn; st.drawn = null;
  if (!yes || !k) { st.turn = nextSeat(st, seat); return { ok: true }; }
  return playCard(st, seat, { cardId: id, color }, rnd);
}

/* ── نداء «اونو» ومسك من نسي ── */
function callUno(st, seat) {
  const p = st.players[seat];
  if (p.hand.length !== 1) return { ok: false, error: "ليست ورقةً واحدة" };
  p.uno = true; p.forgot = false;
  emit(st, "uno", { seat });
  return { ok: true };
}
/** يمسك لاعبًا نسي النداء. الجزاء كرتان — ومن أخطأ المسك يأخذهما هو. */
function catchUno(st, bySeat, targetSeat, rnd) {
  const t = st.players[targetSeat];
  if (!t || bySeat === targetSeat) return { ok: false, error: "اختيار غير صالح" };
  if (t.hand.length === 1 && t.forgot && !t.uno) {
    t.forgot = false;
    drawMany(st, targetSeat, 2, rnd);
    emit(st, "caught", { by: bySeat, seat: targetSeat });
    return { ok: true, caught: true };
  }
  drawMany(st, bySeat, 2, rnd);
  emit(st, "missCatch", { by: bySeat });
  return { ok: true, caught: false };
}

/* ── تحدّي +4 (الكلاسيكيّ) ── */
function challenge(st, seat, rnd) {
  const ch = st.challengeInfo;
  if (!st.S.challenge || st.S.mode !== "classic" || !ch) return { ok: false, error: "لا تحدّي" };
  if (seat !== st.turn) return { ok: false, error: "ليس دورك" };
  const n = st.pending;
  st.pending = 0; st.pendingType = null; st.challengeInfo = null;
  if (ch.hadColor) {
    /* كان يملك اللون: يسحب هو أربعة، والدور يبقى للمتحدّي */
    drawMany(st, ch.by, 4, rnd);
    emit(st, "challengeWon", { by: seat, loser: ch.by });
    return { ok: true, won: true };
  }
  /* تحدٍّ خاسر: المتحدّي يسحب المعلَّق وزيادةَ اثنين */
  drawMany(st, seat, n + 2, rnd);
  emit(st, "challengeLost", { by: seat });
  if (!st.over && st.phase !== "roundEnd") st.turn = nextSeat(st, seat);
  return { ok: true, won: false };
}

/* ── مغادرة لاعب ── */
function leave(st, seat, rnd) {
  const p = st.players[seat];
  if (!p || p.left) return st;
  p.left = true;
  st.deck.push(...shuffle(p.hand, rnd || Math.random));
  p.hand = [];
  emit(st, "left", { seat, name: p.name });
  const left = st.players.filter(x => !x.out && !x.left);
  if (left.length === 1 && st.phase !== "matchEnd") endRound(st, left[0].seat);
  else if (st.turn === seat && st.phase === "turn") st.turn = nextSeat(st, seat);
  return st;
}

/* ── ما يراه لاعبٌ بعينه ──
   كروت الآخرين أعدادٌ لا أوراق، والرزمة عددٌ لا ترتيب. من قرأ هذه الرسالة
   في أدوات المطوّر لم يعرف كرتًا واحدًا لا يملكه. */
function view(st, playerId) {
  const me = st.players.find(p => p.id === playerId);
  return {
    mode: st.S.mode, S: publicSettings(st.S),
    round: st.round, dir: st.dir, color: st.color, turn: st.turn,
    pending: st.pending, pendingType: st.pendingType,
    phase: st.phase, pendingFor: st.pendingFor, over: st.over, matchWinner: st.matchWinner,
    deckN: st.deck.length,
    top: topCard(st) || null,
    canChallenge: !!(st.S.challenge && st.S.mode === "classic" && st.challengeInfo &&
                     me && st.turn === me.seat && st.pending > 0),
    me: me ? { seat: me.seat, hand: me.hand, uno: me.uno, out: me.out, score: me.score } : null,
    players: st.players.map(p => ({
      id: p.id, seat: p.seat, name: p.name, av: p.av, frame: p.frame, bot: p.bot,
      n: p.hand.length, score: p.score, uno: p.uno, out: p.out, left: p.left,
      /* «نسي النداء» معلومةٌ عامّة عمدًا: من دونها لا يستطيع أحدٌ مسكه */
      catchable: p.hand.length === 1 && p.forgot && !p.uno
    }))
  };
}
const publicSettings = S => ({
  mode: S.mode, limit: S.limit, timer: S.timer, stacking: S.stacking,
  seven0: S.seven0, mercy: S.mercy, jumpin: S.jumpin,
  forceplay: S.forceplay, challenge: S.challenge
});

/* ── بوت بسيط: يلعب أفضل ما يملك ──
   ليس ذكيًّا وليس عشوائيًّا: يُفضّل التخلّص من الكروت الثقيلة، ويضرب من
   اقتربت يده من الصفر. يكفي ليملأ مقعدًا فارغًا بلا أن يُفسد المتعة. */
function botAction(st, seat) {
  const p = st.players[seat];
  const opts = playableOf(st, p);
  const nx = st.players[nextSeat(st, seat)];
  const nextLow = nx && nx.n !== undefined ? nx.n <= 2 : (nx && nx.hand.length <= 2);

  if (!opts.length) return { type: "draw" };
  const score = k => {
    let s = 0;
    if (drawV(k)) s += drawV(k) * 6 + (nextLow ? 60 : 0);
    if (k.v === "skip" || k.v === "skipall") s += nextLow ? 45 : 18;
    if (k.v === "rev") s += 10;
    if (k.v === "discard") s += 30;
    if (isNum(k)) s += +k.v;
    if (isWild(k)) s -= p.hand.length > 3 ? 15 : 0;
    return s;
  };
  const best = opts.slice().sort((a, b) => score(b) - score(a))[0];
  const act = { type: "play", cardId: best.id };
  if (isWild(best)) {
    const cnt = {};
    p.hand.forEach(x => { if (x.c !== "w") cnt[x.c] = (cnt[x.c] || 0) + 1; });
    act.color = COLORS.slice().sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0))[0];
  }
  if (best.v === "7" && st.S.seven0) {
    const others = st.players.map((x, i) => i).filter(i => i !== seat && alive(st, i));
    act.swap = others.sort((a, b) => st.players[a].hand.length - st.players[b].hand.length)[0];
  }
  return act;
}

module.exports = {
  COLORS, CNAME, NAMES, DRAWV, DEFAULTS,
  createMatch, startRound, playCard, drawTurn, answerDrawn,
  callUno, catchUno, challenge, leave, view, botAction,
  canPlay, playableOf, isJumpIn, cardPts, cardName, makeDeck, shuffle, rngFrom,
  nextSeat, seatOf, topCard, aliveCount, endRound, eliminate, drawMany, publicSettings
};
