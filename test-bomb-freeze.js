// اختبار تجمّد «القنبلة» عند خروج لاعب.
//
// العطب: `turnIdx` فهرسٌ في مصفوفة اللاعبين. مسارُ الانقطاع كان يحذف
// اللاعب بعد مهلة الرجوع **بلا إصلاح الفهرس**، فيصير مؤشّرًا إلى لاعبٍ
// آخر أو يتجاوز طول المصفوفة. وحينها تجد `explode` المقعد فارغًا فتخرج
// صامتةً بعد أن ألغت المؤقّتات — فلا انفجار ولا انتقال دور: تتجمّد الغرفة
// ولا يستطيع أحدٌ أن يكتب كلمة.
//
// الاختبار يُنشئ الحالة بعينها ثمّ يتحقّق أنّ اللعبة تواصل.

const WebSocket = require("ws");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PORT = 9110 + Math.floor(Math.random() * 40);
process.env.PORT = String(PORT);
/* مهلةُ الرجوع القصيرة تجعل الاختبار ثوانيَ لا نصفَ دقيقة */
process.env.BOMB_RECONNECT_MS = "300";
require("./server.js");

class Sock {
  constructor(name) {
    this.nick = name; this.st = null; this.ev = {}; this.id = null;
    this.acks = new Map(); this.ackId = 0; this.open = false;
    this.ws = new WebSocket("ws://127.0.0.1:" + PORT + "/socket.io/?EIO=4&transport=websocket");
    this.ws.on("message", raw => this._rx(String(raw)));
    this.ws.on("error", () => {});
  }
  _rx(m) {
    if (m === "2") return this.ws.send("3");
    if (m[0] === "0" && m[1] === "{") return this.ws.send("40/bomb,");
    if (m.startsWith("40/bomb,")) {
      try { this.id = JSON.parse(m.slice(8)).sid; } catch (e) {}
      this.open = true; return;
    }
    const pre = "43/bomb,";
    if (m.startsWith(pre)) {
      const i = m.indexOf("[");
      const fn = this.acks.get(+m.slice(pre.length, i));
      if (fn) { this.acks.delete(+m.slice(pre.length, i)); fn(JSON.parse(m.slice(i))[0]); }
      return;
    }
    if (!m.startsWith("42/bomb,")) return;
    let b; try { b = JSON.parse(m.slice(8)); } catch (e) { return; }
    const [name, data] = b;
    if (name === "state") this.st = data;
    (this.ev[name] = this.ev[name] || []).push(data === undefined ? true : data);
  }
  emit(n, d) { if (this.ws.readyState === 1) this.ws.send("42/bomb," + JSON.stringify(d === undefined ? [n] : [n, d])); }
  ask(n, d) {
    return new Promise(res => {
      const id = ++this.ackId; this.acks.set(id, res);
      this.ws.send("42/bomb," + id + JSON.stringify([n, d]));
      setTimeout(() => { if (this.acks.delete(id)) res(null); }, 3000);
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}
const ready = s => new Promise(r => { const t = setInterval(() => { if (s.open) { clearInterval(t); r(); } }, 20); });
async function until(fn, ms = 5000, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return false;
}
/* الخادم يبثّ `turnId` لا الفهرس — وهو المقصود على أيّ حال */
const turnOf = s => (s.st && s.st.players && s.st.players.find(p => p.id === s.st.turnId)) || null;

(async () => {
  await sleep(1400);
  console.log("\n═══ تجمّد القنبلة ═══\n");

  console.log("① خروجُ لاعبٍ ليس صاحبَ الدور لا يُزيح الدور");
  {
    const A = new Sock("أ"), B = new Sock("ب"), C = new Sock("ج"), D = new Sock("د");
    await Promise.all([A, B, C, D].map(ready));
    const r = await A.ask("createRoom", { name: "أ", settings: { startTime: 30, lives: 3 } });
    ok(r && r.ok, "أُنشئت غرفة", r);
    for (const s of [B, C, D]) await s.ask("joinRoom", { name: s.nick, roomId: r.roomId });
    await until(() => A.st && A.st.players.length === 4);
    A.emit("startGame");
    await until(() => A.st.state === "playing", 4000);
    eq(A.st.state, "playing", "بدأت اللعبة");

    const cur = turnOf(A);
    ok(!!cur, "وثمّة صاحبُ دور", cur && cur.name);
    /* نُخرج لاعبًا **ليس** صاحبَ الدور */
    const victim = [A, B, C, D].find(s => s.id !== cur.id && s !== A);
    victim.close();
    await until(() => A.st.players.length === 3, 5000);
    eq(A.st.players.length, 3, "خرج لاعبٌ وبقي ثلاثة");

    const now = turnOf(A);
    ok(!!now, "وما زال ثمّة صاحبُ دور — لا مقعدَ فارغ", now);
    eq(now && now.id, cur.id, "وهو **نفسه** — الفهرس لم ينزلق إلى غيره");
    ok(!!A.st.turnId && A.st.players.some(p => p.id === A.st.turnId),
       "وصاحبُ الدور موجودٌ في القائمة فعلًا", A.st.turnId);
    [A, B, C, D].forEach(s => s.close());
  }

  console.log("② خروجُ صاحب الدور ينقل القنبلة ولا يُجمّدها");
  {
    const A = new Sock("أ"), B = new Sock("ب"), C = new Sock("ج");
    await Promise.all([A, B, C].map(ready));
    const r = await A.ask("createRoom", { name: "أ", settings: { startTime: 30, lives: 3 } });
    for (const s of [B, C]) await s.ask("joinRoom", { name: s.nick, roomId: r.roomId });
    await until(() => A.st && A.st.players.length === 3);
    A.emit("startGame");
    await until(() => A.st.state === "playing", 4000);

    const cur = turnOf(A);
    const victim = [B, C].find(s => s.id === cur.id);
    if (victim) {
      const before = A.st.endsAt;
      victim.close();
      await until(() => A.st.players.length === 2, 5000);
      eq(A.st.players.length, 2, "خرج صاحبُ الدور");
      const now = turnOf(A);
      ok(!!now && now.id !== cur.id, "وانتقل الدور لغيره فورًا", now && now.name);
      ok(A.st.endsAt > Date.now(), "والقنبلة مسلّحةٌ من جديد — لا تجمّد",
         { endsAt: A.st.endsAt, now: Date.now() });
    } else {
      /* صاحبُ الدور هو المضيف: نُخرج غيره ونتحقّق أنّ اللعبة تواصل */
      B.close();
      await until(() => A.st.players.length === 2, 5000);
      ok(!!turnOf(A), "اللعبة تواصل بعد الخروج");
    }
    [A, B, C].forEach(s => s.close());
  }

  console.log("③ اللعبة تبقى قابلةً للّعب بعد الخروج");
  {
    const A = new Sock("أ"), B = new Sock("ب"), C = new Sock("ج");
    await Promise.all([A, B, C].map(ready));
    const r = await A.ask("createRoom", { name: "أ", settings: { startTime: 25, lives: 3 } });
    for (const s of [B, C]) await s.ask("joinRoom", { name: s.nick, roomId: r.roomId });
    await until(() => A.st && A.st.players.length === 3);
    A.emit("startGame");
    await until(() => A.st.state === "playing", 4000);

    /* إجابةٌ خاطئة من صاحب الدور — الحالة التي اشتكى منها صاحب الموقع */
    const cur = turnOf(A);
    const who = [A, B, C].find(s => s.id === cur.id);
    if (who) { who.emit("word", "زززز"); await sleep(300); }
    ok(A.st.state === "playing", "الإجابة الخاطئة لا تُنهي شيئًا");

    /* ثمّ يخرج لاعب */
    const other = [B, C].find(s => s.id !== cur.id) || C;
    other.close();
    await until(() => A.st.players.length === 2, 5000);

    /* المهمّ: صاحبُ الدور موجودٌ ويستطيع أن يكتب */
    const cur2 = turnOf(A);
    ok(!!cur2, "ثمّة صاحبُ دورٍ بعد الخروج", cur2);
    ok(A.st.endsAt > Date.now() - 2000, "والمؤقّت يعمل", A.st.endsAt - Date.now());
    const alive = A.st.players.filter(p => p.alive).length;
    ok(alive >= 1, "ولاعبون أحياء", alive);
    [A, B, C].forEach(s => s.close());
  }

  console.log("④ صمّامُ الأمان في الخادم");
  {
    const fs = require("fs");
    const SRV = fs.readFileSync(require("path").join(__dirname, "server.js"), "utf8");
    const BMB = fs.readFileSync(require("path").join(__dirname, "bomb.js"), "utf8");
    ok(/process\.on\("uncaughtException"/.test(SRV), "خطأٌ غيرُ مُلتقَط لا يُسقط الموقع");
    ok(/process\.on\("unhandledRejection"/.test(SRV), "ووعدٌ مرفوضٌ كذلك");
    ok(/function dropPlayer\(room, p\)/.test(BMB), "وإخراجُ اللاعب في مكانٍ واحد");
    ok(/const curId = \(room\.players\[room\.turnIdx\] \|\| \{\}\)\.id;/.test(BMB),
       "يتذكّر معرّف صاحب الدور قبل الحذف");
    ok(/if \(!p\) \{[\s\S]{0,200}newRound\(room, nextAliveIdx\(room, 0\)\);/.test(BMB),
       "و`explode` تتعافى بدل أن تخرج صامتةً");
  }

  console.log("⑤ لوحة الحروف: تُحرَّك وتُحفَظ وتبقى داخل الشاشة");
  {
    const fs = require("fs"), path = require("path");
    const html = fs.readFileSync(path.join(__dirname, "public", "bomb.html"), "utf8");

    /* ① الشريطُ نحيف: مَقبضٌ و«✕» — لا عنوانَ ولا أيقونةَ ولا كلمةَ «إغلاق» */
    ok(!/لوحة الحروف العربية</.test(html), "لا عنوانَ يشغل سطرًا فوق اللوحة");
    ok(!/textContent = "✕ إغلاق"/.test(html), "ولا كلمةَ «إغلاق» مع العلامة");
    ok(/textContent = "✕"/.test(html), "بل «✕» وحدها");
    const cls = (html.match(/#vkbClose \{[^}]*\}/) || [""])[0];
    const sq = (cls.match(/width:(\d+)px/) || [])[1];
    ok(sq && +sq <= 28, "بمربّعٍ صغير لا شريط", sq);
    ok(/aria-label/.test(html), "ومعناها في وصفٍ للقارئ الصوتيّ لا في نصٍّ يشغل مكانًا");
    ok(/id = "vkbGrip"/.test(html), "ومَقبضٌ صغيرٌ للسحب مكانَ الخطّ الممتدّ");

    /* ② الزرّان **فوق** اللوحة على فراغ الصفحة لا داخلها */
    const barCss = (html.match(/#vkbBar \{[^}]*\}/) || [""])[0];
    ok(/position:absolute/.test(barCss), "شريطُ الأدوات معلّقٌ لا في تدفّق اللوحة", barCss);
    ok(/top:-\d+px/.test(barCss), "فوق حافّتها العليا", barCss);
    ok(/background:none/.test(barCss), "وما وراءه شفّافٌ لا خلفيّةَ لوحة", barCss);
    const kbCss = (html.match(/#vkb \{[^}]*\}/) || [""])[0];
    ok(/overflow:visible/.test(kbCss), "واللوحةُ لا تقصّ ما خرج عنها", kbCss);
    ok(/const KB_TOP_GAP/.test(html), "ويُحجَز لهما هامشٌ أعلى الشاشة");
    ok(/Math\.max\(KB_TOP_GAP, y\)/.test(html),
       "فلا يخرجان منها إن لُصقت اللوحةُ بالأعلى");

    /* ② السحبُ يعمل ويُحفَظ */
    ok(/function makeKbDraggable/.test(html), "ثمّة دالّةُ سحب");
    ok(/makeKbDraggable\(grip\)/.test(html), "مربوطةٌ بالمَقبض وحده");
    const drag = (html.match(/function makeKbDraggable[\s\S]*?\n  }/) || [""])[0];
    ok(/pointerdown/.test(drag) && /pointermove/.test(drag) && /pointerup/.test(drag),
       "بأحداث المؤشّر — فتعمل باللمس والفأرة معًا");
    ok(/setPointerCapture/.test(drag), "وتلتقط المؤشّر فلا تنفلت اللوحةُ خارج الشريط");
    ok(/e\.target\.closest\("#vkbClose"\)/.test(drag), "وزرُّ الإغلاق ليس مَقبضًا");
    ok(/kbPlace\(r\.left, r\.top, false\)/.test(drag),
       "وتُثبَّت بالبكسل قبل أوّل حركة — وإلا قفزت من موضعها المُوسَّط");
    ok(/dblclick/.test(drag), "ونقرتان تُرجعانها مكانها");

    /* ③ الحفظ والاستعادة والقصّ */
    ok(/localStorage\.setItem\(KB_POS/.test(html), "الموضعُ يُحفَظ");
    ok(/function kbRestore/.test(html) && /kbRestore\(\)/.test(html), "ويُستعاد عند الفتح");
    const clamp = (html.match(/function kbClamp[\s\S]*?\n  }/) || [""])[0];
    ok(/innerWidth - v\.offsetWidth/.test(clamp) && /innerHeight - v\.offsetHeight/.test(clamp),
       "ويُقصّ إلى داخل النافذة", clamp);
    ok(/addEventListener\("resize"[\s\S]{0,200}kbPlace/.test(drag),
       "ويُعاد قصُّه عند تغيّر المقاس — فمن حرّكها على شاشةٍ عريضةٍ لا تختفي عنه على الجوّال");
    ok(/#vkb\.moved \{[^}]*transform:none/.test(html),
       "والتوسيطُ يُلغى حين تُحرَّك، وإلا انزاحت بنصف عرضها");
  }

  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error("💥", e); process.exit(1); });
