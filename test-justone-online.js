// اختبار خادم «كلمة واحدة فقط»: الغرف والإعدادات، والحجبُ لكلّ لاعب (المخمّنُ
// لا تصله الكلمةُ ولا التلميحات قبل وقتها — نفحص كلَّ ما وصل مقبسَه حرفًا حرفًا)،
// والمهلُ (تبدأ مع المرحلة ولا تتجدّد)، والبثُّ الحيّ للتخمين، وحمايةُ الدردشة،
// والانقطاعُ والعودة والتوقّف، ومباراةٌ كاملةٌ حتى التصنيف والإحصاءات.
//
// socket.io محاكًى في الذاكرة (كاختبار لودو): حتميٌّ وسريع.

const { setupJustOneOnline, sanitize, leaks } = require("./justonesrv");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(4); }
  return false;
}

class FS {
  constructor(nsp, id) { this.nsp = nsp; this.id = id; this.rooms = new Set([id]); this.h = {}; this.rx = []; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  emit(e, d) { this.rx.push({ e, d: d === undefined ? d : JSON.parse(JSON.stringify(d)) }); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  /* بثٌّ للغرفة إلا المرسل (كـ socket.to في socket.io) */
  to(r) { return { emit: (e, d) => this.nsp.sockets.forEach(s => { if (s !== this && s.rooms.has(r)) s.emit(e, d); }) }; }
  last(e) { for (let i = this.rx.length - 1; i >= 0; i--) if (this.rx[i].e === e) return this.rx[i].d; return null; }
  all(e) { return this.rx.filter(x => x.e === e).map(x => x.d); }
  ask(e, d) { return new Promise(res => this.fire(e, d, res)); }
  get handshake() { return { headers: {}, address: "1.2.3.4" }; }
}
class FN {
  constructor() { this.cf = []; this.sockets = new Map(); this.n = 0; }
  on(e, f) { if (e === "connection") this.cf.push(f); }
  connect(userId) { const s = new FS(this, "s" + (++this.n)); if (userId) s.userId = userId; this.sockets.set(s.id, s); this.cf.forEach(f => f(s)); return s; }
  drop(s) { this.sockets.delete(s.id); s.fire("disconnect"); }
  to(r) { return { emit: (e, d) => this.sockets.forEach(s => { if (s.rooms.has(r)) s.emit(e, d); }) }; }
}

const stats = [];
const store = { async bumpGameStats(u, g, x) { stats.push({ u, g, ...x }); } };
/* خادمان: بطيءٌ (زمنٌ حقيقيّ — نخطو فيه خطوةً خطوة) وسريعٌ (للمهل والمباريات الكاملة) */
const slowN = new FN(), fastN = new FN();
const slow = setupJustOneOnline({ of: () => slowN }, { store, graceMs: 150, secsScale: 1 });
const fast = setupJustOneOnline({ of: () => fastN }, { store, graceMs: 120, secsScale: 0.004 });

const CARD = ["تفاحة", "قمر", "سيارة", "مدرسة", "قلم"];
const st = s => s.last("state");
const toast = s => s.last("toast");
/* من أيّ مقبسٍ هو المخمّن الآن */
const who = (socks, room) => socks.find(s => room.match && room.match.isGuesser(room.players.find(p => p.sockId === s.id).id));

(async () => {
  console.log("\n═══ خادم كلمة واحدة فقط ═══\n");

  console.log("① الدخول والغرفة والإعدادات");
  const A = slowN.connect(77);
  const hi = A.last("hello");
  ok(hi && hi.defaults.clueSecs === 60 && hi.min === 3 && hi.max === 7, "الترحيب يحمل الإعدادات وحدود العدد", hi);
  let r = await A.ask("createRoom", { name: "سعود" });
  ok(r.ok && /^\d{5}$/.test(r.roomId) && r.token, "أُنشئت غرفةٌ برمزٍ من خمسة أرقام", r);
  const code = r.roomId, tokA = r.token;
  const room = slow.rooms.get(code);
  ok(A.last("lobby").host === r.you, "المنشئ هو المضيف");
  const B = slowN.connect();
  r = await B.ask("joinRoom", { name: "فهد", roomId: code });
  ok(r.ok, "انضمّ ثانٍ", r);
  const tokB = r.token;  // eslint-disable-line no-unused-vars
  r = await slowN.connect(77).ask("joinRoom", { name: "نسخة", roomId: code });
  ok(!r.ok && /حسابك/.test(r.error), "الحسابُ نفسُه لا يدخل الغرفةَ مرّتين", r);
  r = await slowN.connect().ask("joinRoom", { name: "x", roomId: "99999" });
  ok(!r.ok, "رمزٌ غير موجود يُردّ");
  A.fire("startGame");
  ok(!room.match && /ثلاثة/.test(toast(A) || ""), "لا تبدأ بأقلّ من ثلاثة", toast(A));
  B.fire("updateSettings", { clueSecs: 90 });
  eq(A.last("lobby").settings.clueSecs, 60, "غيرُ المضيف لا يغيّر الإعدادات");
  A.fire("updateSettings", { clueSecs: 90, guessSecs: 7 });
  const lob = A.last("lobby");
  ok(lob.settings.clueSecs === 90 && lob.settings.guessSecs === 60, "المضيفُ يغيّر وقتَ التلميح، وقيمةٌ خارج القائمة تُتجاهَل", lob.settings);
  eq(sanitize({ clueSecs: "120", guessSecs: 45 }, { clueSecs: 60, guessSecs: 60 }), { clueSecs: 120, guessSecs: 45 }, "sanitize يقبل النصوص الرقميّة الصالحة");
  const C = slowN.connect();
  r = await C.ask("joinRoom", { name: "نورة", roomId: code });
  ok(r.ok, "انضمّت ثالثة");
  const tokC = r.token;
  /* سبعةٌ ثمّ الثامن يُردّ */
  const extra = [];
  for (let i = 0; i < 4; i++) { const s = slowN.connect(); extra.push(s); await s.ask("joinRoom", { name: "ض" + i, roomId: code }); }
  r = await slowN.connect().ask("joinRoom", { name: "ثامن", roomId: code });
  ok(!r.ok && /ممتلئة/.test(r.error), "الثامن يُردّ: سبعةٌ على الأكثر", r);
  /* المضيفُ يطرد واحدًا، ويخرج الباقون من تلقاء أنفسهم */
  const kickId = A.last("lobby").players.find(p => p.name === "ض0").id;
  A.fire("kick", { id: kickId });
  ok(extra[0].last("kicked") !== null && !A.last("lobby").players.some(p => p.name === "ض0"), "المضيفُ يطرد لاعبًا من الانتظار");
  for (const s of extra.slice(1)) s.fire("leaveRoom");
  eq(A.last("lobby").players.map(p => p.name), ["سعود", "فهد", "نورة"], "الخارجون عمدًا يُزالون فورًا");

  console.log("② بداية المباراة: لكلّ دورٍ شاشتُه");
  A.fire("updateSettings", { clueSecs: 60 });
  B.fire("startGame");
  ok(!room.match, "غيرُ المضيف لا يبدأ");
  A.fire("startGame");
  ok(!!room.match && A.last("lobby").playing, "بدأت المباراة");
  const m = room.match;
  const socks = [A, B, C];
  let G = who(socks, room);
  let givers = socks.filter(s => s !== G);
  ok(!!G && givers.length === 2, "مخمّنٌ واحدٌ وملمّحان");
  let vg = st(G), v1 = st(givers[0]);
  ok(vg.phase === "pick" && vg.isGuesser && vg.card === null && vg.secret === null, "المخمّنُ لا يرى البطاقة", vg.card);
  ok(Array.isArray(v1.card) && v1.card.length === 5 && !v1.isGuesser, "الملمّحُ يرى الكلمات الخمس");
  ok(vg.cluesPer === 2, "ثلاثةُ لاعبين ⇒ تلميحان لكلّ ملمّح");
  ok(vg.deadline > vg.serverNow && vg.deadline - vg.serverNow <= 20000, "مهلةُ الاختيار عشرون ثانية", vg.deadline - vg.serverNow);
  ok(vg.events.some(e => e.t === "round" && e.round === 1), "حدثُ بداية الجولة الأولى");
  /* نثبّت البطاقة لنعرف الكلمة (اختبارُ صندوقٍ أبيض) */
  m.card = CARD.slice();
  const rx0 = G.rx.length;          /* من هنا نفحص كلَّ ما يصل المخمّن */

  console.log("③ اختيار الرقم و«ما أعرفها»");
  givers[0].fire("pick", { n: 1 });
  ok(m.phase === "pick" && !!toast(givers[0]), "الملمّحُ لا يختار الرقم");
  G.fire("pick", { n: 1 });
  v1 = st(givers[0]); vg = st(G);
  ok(v1.phase === "clues" && v1.secret === "تفاحة", "الملمّحُ يرى الكلمةَ المختارة", v1.secret);
  ok(vg.phase === "clues" && vg.secret === null && vg.card === null, "والمخمّنُ لا يراها");
  ok(v1.deadline - v1.serverNow > 59000, "مهلةُ التلميح من الإعدادات (٦٠ ث)", v1.deadline - v1.serverNow);
  givers[1].fire("unknown");
  vg = st(G);
  ok(vg.phase === "pick" && vg.disabled.includes(1), "«ما أعرفها» تعيد الاختيار وتُعطّل الرقم", vg.disabled);
  ok(vg.events.some(e => e.t === "unknown"), "ويصل المخمّنَ حدثُها");
  G.fire("pick", { n: 1 });
  ok(m.phase === "pick" && /غير متاح/.test(toast(G) || ""), "الرقمُ المعطّل لا يُختار", toast(G));
  /* نعيد البطاقة كما نريد: الرقم ٢ يصير «تفاحة» */
  m.card[1] = "تفاحة";
  G.fire("pick", { n: 2 });
  ok(m.phase === "clues" && m.secret === "تفاحة", "اختار رقمًا آخر");

  console.log("④ المهلةُ لا تتجدّد بأفعال اللاعبين");
  const dl = st(givers[0]).deadline;
  givers[0].fire("clues", { list: ["www.x.com", "شجرة"] });
  ok(/الروابط/.test(toast(givers[0]) || "") && !m.submitted.size, "التلميحُ يمرّ بمرشّح الدردشة (لا روابط)", toast(givers[0]));
  givers[0].fire("clues", { list: ["التفاحه", "أحمر"] });
  ok(m.submitted.size === 1 && m.phase === "clues", "سُلّم أوّلُ ملمّح");
  eq(st(givers[1]).deadline, dl, "والمهلةُ كما هي (بدأت مع المرحلة)");
  ok(st(givers[1]).players.find(p => p.role === "giver" && p.done), "ويرى البقيّةُ أنّه سلّم");
  ok(st(givers[1]).clues.length === 0, "ولا يرون تلميحَه");
  ok(st(givers[0]).clues.length === 2, "وصاحبُه يرى تلميحَيه");

  console.log("⑤ الحذف الآليّ ثمّ المراجعة بالتصويت");
  givers[1].fire("clues", { list: ["احمر", "شجرة"] });
  v1 = st(givers[0]); vg = st(G);
  ok(v1.phase === "review", "سلّم الجميع ⇒ المراجعة", v1.phase);
  const out = Object.fromEntries(v1.clues.map(c => [c.text, c.out]));
  eq(out, { "التفاحه": "target", "أحمر": "dup", "احمر": "dup", "شجرة": null }, "الكلمةُ نفسها تُحذف، والمتطابقان يُحذفان معًا");
  ok(vg.phase === "review" && vg.clues === null, "المخمّنُ لا يرى شيئًا في المراجعة");
  const tree = v1.clues.find(c => c.text === "شجرة");
  G.fire("strike", { id: tree.id });
  ok(/للملمّحين/.test(toast(G) || ""), "المخمّنُ لا يصوّت");
  givers[0].fire("strike", { id: tree.id });
  ok(st(givers[1]).clues.find(c => c.id === tree.id).votes === 1, "الشطبُ يظهر للملمّحين بعدده");
  givers[0].fire("strike", { id: tree.id });
  ok(st(givers[1]).clues.find(c => c.id === tree.id).votes === 0, "والضغطُ ثانيةً يتراجع");
  givers[0].fire("strike", { id: tree.id });         /* صوتٌ واحدٌ من اثنين: لا يكفي */
  givers[0].fire("ready"); givers[1].fire("ready");
  vg = st(G);
  ok(vg.phase === "guess", "جاهزان ⇒ التخمين", vg.phase);
  eq(vg.clues.map(c => c.text), ["شجرة"], "المخمّنُ يرى ما نجا وحده (صوتٌ من اثنين لا يحذف)");
  ok(vg.clues.every(c => Object.keys(c).sort().join() === "by,id,text"), "بلا أسباب حذفٍ ولا أصوات", vg.clues);
  ok(vg.deadline - vg.serverNow > 59000, "مهلةُ التخمين من الإعدادات", vg.deadline - vg.serverNow);

  console.log("⑥ البثُّ الحيّ وحمايةُ الدردشة");
  G.fire("typing", { text: "تفا" });
  ok(givers[0].last("typing") && givers[0].last("typing").text === "تفا", "ما يكتبه المخمّنُ يصل البقيّة حيًّا");
  ok(G.last("typing") === null, "ولا يرتدّ إليه");
  givers[0].fire("typing", { text: "غش" });
  ok(givers[1].last("typing").text === "تفا", "الملمّحُ لا يبثّ «كتابة»");
  await sleep(720);
  givers[0].fire("chat", { text: "الجواب تفاحه يا شباب" });
  ok(/السرّيّة/.test(toast(givers[0]) || "") && !G.last("chat"), "الملمّحُ لا يكتب الكلمة في الدردشة", toast(givers[0]));
  await sleep(720);
  givers[1].fire("chat", { text: "كتبت أحمر" });
  ok(/التلميحات/.test(toast(givers[1]) || "") && !G.last("chat"), "ولا تلميحًا (حتى المحذوف)", toast(givers[1]));
  await sleep(720);
  G.fire("chat", { text: "تفاحة؟" });
  ok(G.last("chat") && G.last("chat").text === "تفاحة؟", "المخمّنُ لا يُردّ (وإلا صارت الدردشةُ عرّافًا)");
  await sleep(720);
  givers[0].fire("chat", { text: "يلا ركّز 😄" });
  ok(G.last("chat").text === "يلا ركّز 😄", "والكلامُ العاديّ يمرّ");
  eq(leaks("شجرة!", m), "clue", "leaks: تلميحٌ مع علامة ترقيم");
  eq(leaks("التفاحات حلوة", m), "secret", "leaks: الكلمةُ بجمعها");
  eq(leaks("مساء الخير", m), null, "leaks: كلامٌ بريء");

  console.log("⑦ الحجب: كلُّ ما وصل المخمّنَ قبل الكشف");
  const leaked = JSON.stringify(G.rx.slice(rx0).filter(x => x.e !== "chat"));
  const bad = ["تفاحة", "تفاحه", "التفاحه", "أحمر", "احمر", "قمر", "سيارة", "مدرسة", "قلم"].filter(w => leaked.includes(w));
  eq(bad, [], "لا كلمةَ ولا بطاقةَ ولا تلميحًا محذوفًا في أيّ رسالةٍ وصلته");

  console.log("⑧ الإصابة والكشف والتناوب");
  const firstG = G;
  G.fire("guess", { text: "التفاحه" });
  vg = st(G);
  ok(vg.phase === "reveal" && vg.result === "correct" && vg.score === 1, "إصابة ⇒ نقطة", vg.result);
  ok(vg.secret === "تفاحة" && vg.clues.length === 4, "الكشفُ يُري المخمّنَ الكلمةَ وكلَّ التلميحات");
  ok(vg.events.some(e => e.t === "result" && e.result === "correct"), "حدثُ النتيجة");
  ok(vg.deadline - vg.serverNow <= 8000, "الكشفُ ثماني ثوانٍ", vg.deadline - vg.serverNow);
  givers[0].fire("unknown");
  ok(m.phase === "reveal" && !!toast(givers[0]), "لا «ما أعرفها» في الكشف");
  slow._expire(code);                           /* لا ننتظر ثماني ثوانٍ */
  G = who(socks, room);
  ok(m.round === 2 && G !== firstG, "الجولةُ الثانية بمخمّنٍ جديد", m.round);

  console.log("⑨ الخطأ يُحرق بطاقة، والتخطّي لا");
  givers = socks.filter(s => s !== G);
  const deck0 = m.deckLeft;
  m.card = CARD.slice();
  G.fire("pick", { n: 3 });                       /* سيارة */
  givers[0].fire("clues", { list: ["طريق", "عجلة"] });
  givers[1].fire("clues", { list: ["محرك", "بنزين"] });
  givers[0].fire("ready"); givers[1].fire("ready");
  ok(m.phase === "guess", "مرّت المراجعة");
  G.fire("guess", { text: "دراجة" });
  vg = st(G);
  const res = vg.events.find(e => e.t === "result");
  ok(vg.result === "wrong" && res.burned && m.deckLeft === deck0 - 1, "خطأ ⇒ تضيع البطاقةُ التالية أيضًا", { deck0, now: m.deckLeft, res });
  slow._expire(code);
  G = who(socks, room); givers = socks.filter(s => s !== G);
  const deck1 = m.deckLeft;
  m.card = CARD.slice();
  G.fire("pick", { n: 4 });
  givers[0].fire("clues", { list: ["فصل", "طلاب"] });
  givers[1].fire("clues", { list: ["معلم", "حصة"] });
  givers[0].fire("ready"); givers[1].fire("ready");
  G.fire("skip");
  vg = st(G);
  ok(vg.result === "skip" && m.deckLeft === deck1 && vg.score === 1, "تخطٍّ ⇒ البطاقةُ وحدها", { deck1, now: m.deckLeft });

  console.log("⑩ الانقطاعُ والعودة");
  slow._expire(code);
  G = who(socks, room); givers = socks.filter(s => s !== G);
  ok(m.round === 4 && st(G).phase === "pick", "الجولةُ الرابعة", m.round);
  m.card = CARD.slice();
  G.fire("pick", { n: 5 });
  givers[0].fire("clues", { list: ["كتابة", "حبر"] });
  const dl2 = st(G).deadline;
  const gone = givers[1];
  const tokGone = gone === A ? tokA : gone === B ? tokB : tokC;
  slowN.drop(gone);
  ok(m.phase === "review", "انقطع الملمّحُ الأخير ⇒ لا تنتظره المرحلة", m.phase);
  ok(A.last("lobby") && (gone === A ? B : A).last("lobby").players.find(p => p.gone), "ويظهر في الانتظار غائبًا");
  const back = slowN.connect();
  r = await back.ask("rejoin", { roomId: code, token: tokGone });
  ok(r.ok && r.resumed, "عاد بالرمز في المهلة", r);
  ok(st(back) && st(back).phase === "review" && Array.isArray(st(back).clues), "وأخذ حالتَه فورًا");
  ok(m.player(r.you).on === true, "وصار حاضرًا في المباراة");
  ok(st(back).deadline !== dl2 && st(back).deadline > 0, "مهلةُ المرحلة الجديدة (المراجعة) قائمة");
  const dl3 = st(back).deadline;
  slowN.drop(back);
  const back2 = slowN.connect();
  await back2.ask("rejoin", { roomId: code, token: tokGone });
  eq(st(back2).deadline, dl3, "الانقطاعُ والعودة لا يمدّان المهلة");
  r = await slowN.connect().ask("rejoin", { roomId: code, token: tokGone });
  ok(!r.ok && /مكانٍ آخر/.test(r.error), "ولا تُفتح الجلسةُ في مكانين", r);

  console.log("⑪ بقي حاضرٌ واحد ⇒ تتوقّف الساعة");
  const stay = socks.find(s => s !== gone && slowN.sockets.has(s.id));
  const other = socks.find(s => s !== gone && s !== stay);
  slowN.drop(back2); slowN.drop(other);
  ok(st(stay).paused === true && st(stay).deadline === 0, "توقّفت (لا تحترق البطاقات)", { p: st(stay).paused, d: st(stay).deadline });
  ok(!room.timer, "ولا مؤقّت");
  const back3 = slowN.connect();
  r = await back3.ask("rejoin", { roomId: code, token: tokGone });
  ok(r.ok && st(stay).paused === false && st(stay).deadline > 0, "عاد واحد ⇒ تستأنف بمهلةٍ جديدة", st(stay));
  await sleep(200);                            /* تنقضي مهلةُ الغائب الآخر (١٥٠ م ث) */
  ok(!!room.match && room.players.some(p => p.gone), "انقضت مهلةُ الغائب: يبقى في المباراة غائبًا ويُكمل الاثنان", room.players.map(p => p.gone));
  slowN.drop(back3);
  await sleep(200);
  ok(!room.match, "ثمّ لم يبقَ إلا واحد ⇒ انتهت المباراة");
  const me = stay.last("matchEnd");
  ok(me && me.rating && me.score === 1 && me.history.length === 3, "ووصل ملخّصُها والتصنيف (٣ جولاتٍ مكشوفة)", me && { s: me.score, h: me.history.length });
  ok(stay.last("lobby").playing === false && stay.last("lobby").players.length === 1, "وعاد الحاضرُ إلى الانتظار وحده");
  ok(stats.length === (stay === A ? 1 : 0), "الإحصاءُ للمسجَّلين الذين بقوا حتى النهاية", stats);

  console.log("⑫ المهل: مباراةٌ بلا أحدٍ يلعب تنتهي وحدها");
  const X = [fastN.connect(), fastN.connect(), fastN.connect()];
  r = await X[0].ask("createRoom", { name: "أ" });
  for (const [i, s] of X.slice(1).entries()) await s.ask("joinRoom", { name: "ب" + i, roomId: r.roomId });
  const froom = fast.rooms.get(r.roomId);
  X[0].fire("startGame");
  const fm = froom.match;
  ok(await until(() => fm.phase === "clues", 2000), "انقضت مهلةُ الاختيار ⇒ رقمٌ عشوائيّ");
  ok(await until(() => fm.round >= 2, 4000), "ومهلةُ التلميح ⇒ جولةٌ بلا تلميحات ثمّ التالية");
  ok(fm.history[0].result === "empty" && fm.score === 0, "جولةٌ فارغةٌ لا تُكسب ولا تُحرق", fm.history[0]);
  ok(await until(() => !froom.match, 20000), "وحتى آخر بطاقة", fm.round);
  ok(fm.phase === "over" && fm.round === 13, "ثلاثَ عشرة جولة", fm.round);

  console.log("⑬ مباراةٌ كاملةٌ يلعبها الطيّار الآليّ");
  const Y = [fastN.connect(501), fastN.connect(502), fastN.connect(), fastN.connect()];
  r = await Y[0].ask("createRoom", { name: "طيّار" });
  for (const [i, s] of Y.slice(1).entries()) await s.ask("joinRoom", { name: "ط" + i, roomId: r.roomId });
  const yroom = fast.rooms.get(r.roomId);
  Y[0].fire("startGame");
  const ym = yroom.match;
  ok(st(Y[0]).cluesPer === 1, "أربعةُ لاعبين ⇒ تلميحٌ واحد");
  let wrongOnce = false, tick = 0;
  const pilot = setInterval(() => {
    if (!yroom.match) return;
    tick++;
    for (const s of Y) {
      const v = st(s);
      if (!v || v.phase === "over") continue;
      if (v.isGuesser && v.phase === "pick") s.fire("pick", { n: [1, 2, 3, 4, 5].find(n => !v.disabled.includes(n)) });
      else if (!v.isGuesser && v.phase === "clues" && !v.players.find(p => p.id === v.me).done)
        s.fire("clues", { list: ["تلميح" + s.id + "ر" + v.round] });
      else if (!v.isGuesser && v.phase === "review" && !v.players.find(p => p.id === v.me).done) s.fire("ready");
      else if (v.isGuesser && v.phase === "guess") {
        if (v.round === 3 && !wrongOnce) { wrongOnce = true; s.fire("guess", { text: "خطأمقصود" }); }
        else s.fire("guess", { text: ym.secret });        /* يعرف الجواب (صندوقٌ أبيض) */
      }
    }
  }, 3);
  ok(await until(() => !yroom.match, 25000), "انتهت المباراة", ym.round);
  clearInterval(pilot);
  ok(ym.score === 11 && ym.history.length === 12, "١١ إصابة + خطأٌ أحرق بطاقة = ١٢ جولة", { s: ym.score, h: ym.history.length });
  const yend = Y[2].last("matchEnd");
  ok(yend && yend.rating.id === "amazing" && yend.score === 11, "التصنيف «مذهل»", yend && yend.rating);
  ok(yend.history.every(h => h.secret && Array.isArray(h.clues)), "والملخّصُ يحمل كلّ جولةٍ بكلمتها وتلميحاتها");
  await sleep(30);
  const ys = stats.filter(x => x.u === 501 || x.u === 502);
  ok(ys.length === 2 && ys.every(x => x.g === "justone" && x.games === 1 && x.wins === 1 && x.score === 11 && x.best === 11), "إحصاءُ «justone» للمسجَّلَين: فوزٌ تعاونيّ", ys);
  ok(Y[0].last("lobby").playing === false && Y[0].last("lobby").players.length === 4 && Y[0].last("lobby").lastResult.score === 11, "وعادوا إلى الانتظار بنتيجةٍ أخيرة");
  const words = new Set(ym.history.map(h => h.secret));
  ok(words.size === ym.history.length, "لم تتكرّر كلمةٌ في المباراة", [...words]);
  /* التناوب: كلُّ لاعبٍ خمّن ثلاث مرّاتٍ تقريبًا */
  const turns = {}; for (const h of ym.history) turns[h.guesser] = (turns[h.guesser] || 0) + 1;
  ok(Object.keys(turns).length === 4 && Math.max(...Object.values(turns)) - Math.min(...Object.values(turns)) <= 1, "الدورُ يتناوب بالعدل", turns);
  Y[0].fire("startGame");
  ok(!!yroom.match, "ويبدأ المضيفُ مباراةً جديدة");
  yroom.match && (yroom.match.finish(), 0);

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
