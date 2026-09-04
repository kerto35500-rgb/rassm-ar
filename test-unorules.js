// اختبار محرّك قواعد «اونو».
// العشوائيّة محقونةٌ ببذرةٍ ثابتة، فكل مباراةٍ هنا قابلةٌ للإعادة حرفًا بحرف.
const U = require("./unorules");
let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const rnd = U.rngFrom(42);

function game(settings = {}, n = 4) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: "p" + i, name: "لاعب" + i, bot: i > 0 });
  const st = U.createMatch({ players, settings, seed: 7 });
  U.startRound(st, 7);
  return st;
}
/* يضع كرتًا بعينه في يد لاعبٍ ليُختبَر أثره بلا انتظار الحظّ */
function give(st, seat, card) {
  const k = { ...card, id: 90000 + Math.floor(Math.random() * 9000) };
  st.players[seat].hand.push(k);
  return k;
}
function setTop(st, card) {
  st.discard.push({ ...card, id: 80000 });
  st.color = card.c === "w" ? st.color : card.c;
}

console.log("\n═══ محرّك قواعد اونو ═══\n");

console.log("① الرزمة والتوزيع");
{
  const c = U.makeDeck("classic", rnd), n = U.makeDeck("nomercy", rnd);
  ok(c.length === 108, `الكلاسيكيّة ١٠٨ كرت (${c.length})`, c.length);
  ok(c.filter(k => k.v === "0").length === 4, "أربعة أصفار في الكلاسيكيّة");
  ok(c.filter(k => k.v === "draw4").length === 4, "وأربعة +٤");
  ok(!c.some(k => ["skipall", "discard", "d6", "d10", "roulette"].includes(k.v)),
     "ولا كروتَ «بلا رحمة» فيها");
  ok(n.some(k => k.v === "skipall") && n.some(k => k.v === "roulette"), "و«بلا رحمة» فيها كروتها");
  ok(new Set(c.map(k => k.id)).size === c.length, "كل كرتٍ بمعرّفٍ فريد");

  const st = game();
  ok(st.players.every(p => p.hand.length === 7), "كلٌّ يبدأ بسبعة");
  ok(st.discard.length === 1, "وكرتٌ واحدٌ مكشوف");
  const f = st.discard[0];
  ok(f.c !== "w" && !U.DRAWV[f.v] && !["skip", "skipall", "rev", "discard"].includes(f.v),
     "الكرت الأوّل عاديّ لا أثرَ له", f);
  ok(st.color === f.c, "واللون منه");
}

console.log("\n② صلاحيّة اللعب");
{
  const st = game();
  st.discard = [{ c: "r", v: "5", id: 1 }]; st.color = "r"; st.pending = 0;
  ok(U.canPlay(st, { c: "r", v: "9" }), "نفس اللون يُقبَل");
  ok(U.canPlay(st, { c: "b", v: "5" }), "ونفس الرقم");
  ok(!U.canPlay(st, { c: "b", v: "9" }), "ولا هذا ولا ذاك يُرفَض");
  ok(U.canPlay(st, { c: "w", v: "wild" }), "والملوّن دائمًا");

  st.pending = 2; st.pendingType = "d2"; st.S.stacking = false;
  ok(!U.canPlay(st, { c: "r", v: "d2" }), "بلا تكديس: لا ردّ على عقوبة");
  st.S.stacking = true; st.S.mode = "classic";
  ok(U.canPlay(st, { c: "b", v: "d2" }), "بالتكديس (كلاسيك): +٢ يردّ +٢");
  ok(U.canPlay(st, { c: "w", v: "draw4" }), "و+٤ يردّ +٢");
  ok(!U.canPlay(st, { c: "r", v: "5" }), "ورقمٌ عاديّ لا يردّ");
  st.pendingType = "draw4";
  ok(!U.canPlay(st, { c: "b", v: "d2" }), "و+٢ لا يردّ +٤ في الكلاسيك");
}

console.log("\n③ الأثر: عكس وحظر وعقوبة");
{
  let st = game();
  st.turn = 0;
  const k = give(st, 0, { c: st.color, v: "rev" });
  const d0 = st.dir;
  U.playCard(st, 0, { cardId: k.id }, rnd);
  ok(st.dir === -d0, "«عكس» يقلب الاتجاه", st.dir);

  st = game(); st.turn = 0;
  const s = give(st, 0, { c: st.color, v: "skip" });
  U.playCard(st, 0, { cardId: s.id }, rnd);
  ok(st.turn === 2, "«حظر» يتخطّى لاعبًا", st.turn);

  st = game(); st.turn = 0;
  const sa = give(st, 0, { c: st.color, v: "skipall" });
  U.playCard(st, 0, { cardId: sa.id }, rnd);
  ok(st.turn === 0, "«حظر الجميع» يُعيد الدور لصاحبه", st.turn);

  st = game(); st.turn = 0;
  const d = give(st, 0, { c: st.color, v: "d2" });
  U.playCard(st, 0, { cardId: d.id }, rnd);
  ok(st.pending === 2, "«+٢» يُراكم اثنين", st.pending);
  const before = st.players[1].hand.length;
  U.drawTurn(st, 1, rnd);
  ok(st.players[1].hand.length === before + 2, "ومن لم يردّ سحبهما", st.players[1].hand.length - before);
  ok(st.pending === 0, "والمعلَّق صُفّر");
  ok(st.turn === 2, "والدور انتقل", st.turn);
}

console.log("\n④ الملوّن يلزمه لون");
{
  const st = game(); st.turn = 0;
  const w = give(st, 0, { c: "w", v: "wild" });
  let r = U.playCard(st, 0, { cardId: w.id }, rnd);
  ok(!r.ok && /لونًا/.test(r.error), "ملوّنٌ بلا لون يُرفَض", r);
  r = U.playCard(st, 0, { cardId: w.id, color: "زهري" }, rnd);
  ok(!r.ok, "ولونٌ غير موجود يُرفَض", r);
  r = U.playCard(st, 0, { cardId: w.id, color: "g" }, rnd);
  ok(r.ok && st.color === "g", "وبلونٍ صحيح يُلعَب", st.color);
}

console.log("\n⑤ ليس دورك، وليس في يدك");
{
  const st = game(); st.turn = 0;
  const k = give(st, 1, { c: st.color, v: "3" });
  let r = U.playCard(st, 1, { cardId: k.id }, rnd);
  ok(!r.ok && /دورك/.test(r.error), "لاعبٌ خارج دوره يُرفَض", r);
  r = U.playCard(st, 0, { cardId: 999999 }, rnd);
  ok(!r.ok && /يدك/.test(r.error), "وكرتٌ لا يملكه يُرفَض", r);
  r = U.drawTurn(st, 2, rnd);
  ok(!r.ok, "والسحب خارج الدور يُرفَض", r);
}

console.log("\n⑥ الوصول للصفر ينهي الجولة");
{
  const st = game({ mode: "classic", limit: 500 });
  st.turn = 0;
  st.players[0].hand = [{ c: st.color, v: "7", id: 7777 }];
  st.players[1].hand = [{ c: "r", v: "9", id: 1 }, { c: "w", v: "wild", id: 2 }];
  st.players[2].hand = [{ c: "b", v: "skip", id: 3 }];
  st.players[3].hand = [];
  U.playCard(st, 0, { cardId: 7777 }, rnd);
  ok(st.phase === "roundEnd", "انتهت الجولة", st.phase);
  ok(st.players[0].score === 9 + 50 + 20, "والفائز أخذ نقاط أيدي الباقين", st.players[0].score);
  ok(!st.over, "والمباراة مستمرّة (لم يبلغ الحدّ)");

  const st2 = game({ mode: "nomercy" });
  st2.turn = 0;
  st2.players[0].hand = [{ c: st2.color, v: "7", id: 7778 }];
  U.playCard(st2, 0, { cardId: 7778 }, rnd);
  ok(st2.over && st2.matchWinner === 0, "و«بلا رحمة» جولةٌ واحدةٌ حاسمة", st2.phase);
}

console.log("\n⑦ قاعدة الرحمة — في «بلا رحمة» وحدها");
{
  const st = game({ mode: "nomercy", mercy: true });
  st.turn = 0;
  st.players[1].hand = new Array(24).fill(0).map((_, i) => ({ c: "r", v: "5", id: 5000 + i }));
  U.drawMany(st, 1, 1, rnd);
  ok(st.players[1].out === true, "من بلغ ٢٥ كرتًا خرج", st.players[1].hand.length);

  /* الشكوى الحقيقيّة: بدت مفعَّلةً في الكلاسيكيّ */
  const c = game({ mode: "classic", mercy: true });
  c.players[1].hand = new Array(30).fill(0).map((_, i) => ({ c: "r", v: "5", id: 6000 + i }));
  U.drawMany(c, 1, 1, rnd);
  ok(c.players[1].out === false, "وفي الكلاسيكيّ لا يخرج أحدٌ مهما جمع", c.players[1].hand.length);

  const off = game({ mode: "nomercy", mercy: false });
  off.players[1].hand = new Array(40).fill(0).map((_, i) => ({ c: "r", v: "5", id: 7000 + i }));
  U.drawMany(off, 1, 1, rnd);
  ok(off.players[1].out === false, "وبإطفائها لا يخرج أحد", off.players[1].hand.length);
}

console.log("\n⑧ نداء «اونو» ومسك الناسي");
{
  const st = game();
  st.turn = 0;
  st.players[0].hand = [{ c: st.color, v: "4", id: 401 }, { c: "b", v: "8", id: 402 }];
  U.playCard(st, 0, { cardId: 401 }, rnd);
  ok(st.players[0].hand.length === 1 && st.players[0].forgot, "من بقيت له ورقةٌ يصير «قابلًا للمسك»");
  ok(U.view(st, "p1").players[0].catchable === true, "ويراه الجميع كذلك");
  const n = st.players[0].hand.length;
  U.catchUno(st, 1, 0, rnd);
  ok(st.players[0].hand.length === n + 2, "ومن مسكه أعطاه كرتين", st.players[0].hand.length);

  const st2 = game();
  st2.players[0].hand = [{ c: "r", v: "4", id: 411 }];
  st2.players[0].forgot = true;
  U.callUno(st2, 0);
  ok(st2.players[0].uno && !st2.players[0].forgot, "والنداء يحميه");
  const before = st2.players[1].hand.length;
  const r = U.catchUno(st2, 1, 0, rnd);
  ok(!r.caught && st2.players[1].hand.length === before + 2, "ومن أخطأ المسك أخذ الكرتين هو", st2.players[1].hand.length - before);
  ok(U.callUno(st2, 1).ok === false, "ولا يُنادى بأكثر من ورقة");
}

console.log("\n⑨ تحدّي +٤");
{
  const st = game({ mode: "classic", challenge: true });
  st.turn = 0; st.color = "r";
  st.discard = [{ c: "r", v: "5", id: 1 }];
  st.players[0].hand = [{ c: "w", v: "draw4", id: 900 }, { c: "r", v: "2", id: 901 }];
  U.playCard(st, 0, { cardId: 900, color: "b" }, rnd);
  ok(st.challengeInfo && st.challengeInfo.hadColor === true, "سُجّل أنه كان يملك اللون", st.challengeInfo);
  const n0 = st.players[0].hand.length;
  const r = U.challenge(st, 1, rnd);
  ok(r.ok && r.won, "فالتحدّي رابح", r);
  ok(st.players[0].hand.length === n0 + 4, "والغاشّ سحب أربعة", st.players[0].hand.length - n0);
  ok(st.pending === 0, "والمعلَّق صُفّر");

  const st2 = game({ mode: "classic", challenge: true });
  st2.turn = 0; st2.color = "r";
  st2.discard = [{ c: "r", v: "5", id: 1 }];
  st2.players[0].hand = [{ c: "w", v: "draw4", id: 910 }, { c: "b", v: "2", id: 911 }];
  U.playCard(st2, 0, { cardId: 910, color: "g" }, rnd);
  const n1 = st2.players[1].hand.length;
  const r2 = U.challenge(st2, 1, rnd);
  ok(r2.ok && !r2.won, "وتحدٍّ في محلّه خاسر", r2);
  ok(st2.players[1].hand.length === n1 + 6, "فيسحب المتحدّي ٦ (٤+٢)", st2.players[1].hand.length - n1);

  const st3 = game({ mode: "nomercy" });
  ok(U.challenge(st3, 1, rnd).ok === false, "ولا تحدّي في «بلا رحمة»");
}

console.log("\n⑩ السحب ثم السؤال");
{
  const st = game({ forceplay: false });
  st.turn = 0; st.color = "r";
  st.discard = [{ c: "r", v: "5", id: 1 }];
  st.deck = [{ c: "r", v: "9", id: 950 }];
  const r = U.drawTurn(st, 0, rnd);
  ok(r.ask === true && st.phase === "drawn", "كرتٌ مسحوبٌ صالح ⇒ يُسأل", st.phase);
  ok(st.turn === 0, "والدور لم ينتقل بعد");
  const before = st.players[0].hand.length;
  U.answerDrawn(st, 0, false, null, rnd);
  ok(st.phase === "turn" && st.turn === 1, "«أبقِه» ⇒ ينتقل الدور", st.turn);
  ok(st.players[0].hand.length === before, "والكرت بقي في يده");

  const st2 = game({ forceplay: true });
  st2.turn = 0; st2.color = "r";
  st2.discard = [{ c: "r", v: "5", id: 1 }];
  st2.deck = [{ c: "r", v: "9", id: 951 }];
  U.drawTurn(st2, 0, rnd);
  ok(st2.discard[st2.discard.length - 1].id === 951, "وباللعب الإجباريّ يُلعَب فورًا");
}

console.log("\n⑪ الخصوصيّة: لا يرى أحدٌ كروت أحد");
{
  const st = game();
  const v = U.view(st, "p1");
  ok(v.me.seat === 1 && v.me.hand.length === 7, "أرى يدي كاملة");
  ok(v.players.every(p => p.hand === undefined), "ولا أرى يد أحدٍ غيري", Object.keys(v.players[0]));
  ok(v.players[0].n === 7, "أرى عددها فقط", v.players[0].n);
  ok(v.deckN === st.deck.length && v.deck === undefined, "والرزمة عددٌ لا ترتيب");
  /* نستخرج المعرّفات من الرسالة استخراجًا دقيقًا: `includes('"id":22')`
     يتطابق داخل `"id":221` فيُبلّغ عن تسرّبٍ وهميّ. */
  const seen = new Set([...JSON.stringify(v).matchAll(/"id":(\d+)/g)].map(m => +m[1]));
  const mine = new Set(st.players[1].hand.map(k => k.id));
  const top = U.topCard(st);
  const leaked = [...seen].filter(id => !mine.has(id) && id !== (top && top.id));
  ok(leaked.length === 0, "ولا يتسرّب معرّفُ كرتٍ لغيري", leaked);
}

console.log("\n⑫ المغادرة");
{
  const st = game();
  const n = st.deck.length, h = st.players[2].hand.length;
  U.leave(st, 2, rnd);
  ok(st.players[2].left && st.players[2].hand.length === 0, "من غادر تُفرَّغ يده");
  ok(st.deck.length === n + h, "وترجع كروته للرزمة", st.deck.length - n);
  st.turn = 2;
  U.leave(st, 3, rnd);
  ok(st.players.filter(p => !p.left && !p.out).length === 2, "وبقي اثنان");
  U.leave(st, 1, rnd);
  ok(st.phase === "roundEnd" || st.over, "ومن بقي وحده فاز", st.phase);
}

console.log("\n⑬ البوت يلعب بلا تعطّل");
{
  const st = game({ mode: "nomercy" }, 4);
  let guard = 0;
  while (!st.over && st.phase !== "matchEnd" && guard++ < 4000) {
    if (st.phase === "roundEnd") { if (st.over) break; U.startRound(st, 7 + st.round); continue; }
    if (st.phase === "drawn") { U.answerDrawn(st, st.pendingFor, true, "r", rnd); continue; }
    const seat = st.turn;
    const a = U.botAction(st, seat);
    const r = a.type === "draw" ? U.drawTurn(st, seat, rnd)
                                : U.playCard(st, seat, a, rnd);
    if (!r.ok) { U.drawTurn(st, seat, rnd); }
  }
  ok(st.over, "مباراةٌ كاملة بين أربعة بوتات وصلت لنهايتها", { guard, phase: st.phase });
  ok(guard < 4000, "بلا حلقةٍ لا تنتهي", guard);
  ok(st.matchWinner != null, "وفيها فائز", st.matchWinner);
}

console.log("\n⑭ الكلاسيكيّ حتى الحدّ");
{
  const st = game({ mode: "classic", limit: 200 }, 3);
  let guard = 0, rounds = 0;
  while (!st.over && guard++ < 20000) {
    if (st.phase === "roundEnd") { rounds++; U.startRound(st, 100 + rounds); continue; }
    if (st.phase === "drawn") { U.answerDrawn(st, st.pendingFor, true, "r", rnd); continue; }
    const seat = st.turn;
    const a = U.botAction(st, seat);
    const r = a.type === "draw" ? U.drawTurn(st, seat, rnd) : U.playCard(st, seat, a, rnd);
    if (!r.ok) U.drawTurn(st, seat, rnd);
  }
  ok(st.over, "بلغت المباراة حدّ النقاط", { rounds, phase: st.phase });
  ok(st.players[st.matchWinner].score >= 200, "والفائز تجاوز الحدّ", st.players[st.matchWinner] && st.players[st.matchWinner].score);
  ok(rounds >= 1, "بعد أكثر من جولة", rounds);
}

console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
process.exit(F ? 1 : 0);
