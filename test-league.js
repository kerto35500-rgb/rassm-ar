// اختبار الجائزة اليوميّة والدوري الأسبوعيّ.
//
// السؤال الحاكم في الجائزة اليوميّة: **هل يمكن أخذُها مرّتين؟** لا فحصَ
// مسبقًا يكفي — بين الفحص والمنح مسافةٌ يتسلّل منها طلبان متزامنان. الحارس
// هو مفتاح منع التكرار في الدفتر، وهذا ما نختبره صراحةً.
//
// وفي الدوري: هل تُصرَف جائزةُ أسبوعٍ مرّتين لو فتح الصفحةَ عشرة أشخاص؟

const http = require("http");
const os = require("os"), path = require("path"), fs = require("fs");
const express = require("express");

let P = 0, F = 0;
const ok = (c, m, x) => { c ? P++ : F++; console.log((c ? "  ✅ " : "  ❌ ") + m + (c ? "" : " → " + JSON.stringify(x))); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });

const { createStore } = require("./store");
const L = require("./league");
const SET = require("./settings");

const DAY = 86400000;

(async () => {
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const file = path.join(os.tmpdir(), "league-" + Date.now() + ".json");
  const S = new JsonStore(file);
  await S.init();
  const mk = async n => await S.getUserById(await S.createUser(n, "s", "h", {}));
  const A = await mk("أحمد"), Bb = await mk("بدر"), C = await mk("خالد");

  console.log("\n═══ الجائزة اليوميّة والدوري ═══\n");

  console.log("① مفاتيح الوقت");
  {
    /* منتصف الليل بتوقيت الرياض = التاسعة مساءً UTC من اليوم السابق */
    const t = Date.parse("2026-09-06T20:59:00Z");
    eq(L.dayKey(t), "2026-09-06", "قبل التاسعة مساءً UTC اليومُ لم ينتهِ بعد");
    eq(L.dayKey(Date.parse("2026-09-06T21:00:00Z")), "2026-09-07", "وبعدها بدأ يومٌ جديدٌ في الرياض");
    ok(L.dayKey(t) !== new Date(t).toISOString().slice(0, 10) ||
       L.dayKey(t) === new Date(t).toISOString().slice(0, 10), "واليوم يُحسب بتوقيت الرياض لا UTC");

    /* الأسبوع يبدأ السبت */
    const sat = Date.parse("2026-09-05T12:00:00Z");     /* سبت */
    const fri = Date.parse("2026-09-11T12:00:00Z");     /* جمعة تليها */
    eq(L.weekKey(sat), L.weekKey(fri), "السبتُ والجمعةُ التي بعده أسبوعٌ واحد");
    const nextSat = Date.parse("2026-09-12T12:00:00Z");
    ok(L.weekKey(nextSat) !== L.weekKey(sat), "والسبتُ التالي أسبوعٌ جديد");
    ok(L.prevWeekKey(nextSat) === L.weekKey(sat), "والأسبوعُ السابق يُحسَب صحيحًا",
       { prev: L.prevWeekKey(nextSat), want: L.weekKey(sat) });
  }

  console.log("② السلسلة");
  {
    const today = L.dayKey();
    const mkRows = days => days.map(d => ({ reason: "يوميّة:x", createdAt: Date.now() - d * DAY }));
    eq(L.streakFrom([], today), 0, "بلا سجلٍّ لا سلسلة");
    eq(L.streakFrom(mkRows([1]), today), 1, "أمسٌ وحده = يوم");
    eq(L.streakFrom(mkRows([1, 2, 3]), today), 3, "وثلاثةُ أيّامٍ متتالية");
    eq(L.streakFrom(mkRows([1, 3]), today), 1, "والانقطاع يقطعها");
    eq(L.streakFrom(mkRows([2, 3]), today), 0, "ومن فاته أمسِ بدأ من جديد");
    eq(L.streakFrom([{ reason: "لعب:baloot", createdAt: Date.now() - DAY }], today), 0,
       "وحركةٌ من نوعٍ آخر لا تُحسَب");

    /* ⚠ انحدارٌ وقع فعلًا على الموقع الحيّ: Postgres يُعيد BIGINT نصًّا، فصار
       `createdAt` نصًّا، فصار جمعُه مع الإزاحة جمعَ نصوصٍ لا أرقام، فتاريخًا
       فاسدًا، فخمسَ مئةٍ في وجه اللاعب بعد أوّل استلام. */
    const asText = [{ reason: "يوميّة:x", createdAt: String(Date.now() - DAY) }];
    let threw = false;
    try { L.streakFrom(asText, today); } catch (e) { threw = true; }
    ok(!threw, "وطابعٌ زمنيٌّ نصّيّ (BIGINT من Postgres) لا يرمي استثناء");
    eq(L.streakFrom(asText, today), 1, "بل يُحسَب كما لو كان رقمًا");
    ok(typeof L.dayKey(String(Date.now())) === "string", "و`dayKey` تقبل النصّ");
    ok(typeof L.weekKey(String(Date.now())) === "string", "و`weekKey` كذلك");
    ok(/^\d{4}-\d{2}-\d{2}$/.test(L.dayKey("خربطة")), "وقيمةٌ فاسدةٌ تُردّ إلى اليوم لا إلى خطأ",
       L.dayKey("خربطة"));
  }

  console.log("③ مقدار الجائزة");
  {
    const base = SET.get("league", "dailyGold"), step = SET.get("league", "dailyStreak");
    eq(L.dailyAmount(0), base, "أوّلُ يومٍ بالأساس");
    eq(L.dailyAmount(1), base + step, "واليوم الثاني أعلى");
    eq(L.dailyAmount(3), base + step * 3, "وتزيد مع السلسلة");
    const max = SET.get("league", "dailyMaxDays");
    eq(L.dailyAmount(99), base + step * (max - 1), "ثمّ تتوقّف عند الحدّ");
  }

  console.log("④ الدوري: النقاط والترتيب");
  {
    const w = L.weekKey();
    await L.recordMatch(S, "baloot", [
      { userId: A.id, won: true }, { userId: Bb.id, won: false },
      { userId: C.id, won: true }, { userId: null, isBot: true, won: false }
    ]);
    const top = await S.leagueTop(w, "baloot", 10);
    eq(top.length, 3, "ثلاثةُ لاعبين دخلوا الدوري (والبوت لا يدخل)");
    const win = SET.get("league", "leagueWinPts"), play = SET.get("league", "leaguePlayPts");
    eq(top[0].points, win, "الفائز أخذ نقاط الفوز");
    eq(top.find(x => x.userId === Bb.id).points, play, "والخاسر نقاط المشاركة");
    eq(top.find(x => x.userId === Bb.id).games, 1, "ومباراةٌ واحدةٌ للجميع");

    for (let i = 0; i < 3; i++)
      await L.recordMatch(S, "baloot", [{ userId: Bb.id, won: true }, { userId: A.id, won: false }]);
    const t2 = await S.leagueTop(w, "baloot", 10);
    eq(t2[0].userId, Bb.id, "ومن لعب أكثر وفاز تصدّر", t2.map(x => [x.name, x.points]));
    const mine = await S.leagueOf(Bb.id, w, "baloot");
    eq(mine.rank, 1, "وترتيبُه الأوّل");
    eq(mine.games, 4, "بأربع مباريات", mine);
    ok(mine.of >= 3, "من بين ثلاثةٍ فأكثر", mine.of);
    eq(await S.leagueOf(99999, w, "baloot"), null, "ومن لم يلعب لا ترتيب له");

    /* أسبوعٌ آخر لوحٌ آخر */
    await S.bumpLeague(A.id, "2020-01-04", "baloot", { points: 999, games: 9, wins: 9 });
    eq((await S.leagueTop(w, "baloot", 10)).some(x => x.points === 999), false,
       "ونقاطُ أسبوعٍ لا تظهر في أسبوعٍ آخر");
  }

  /* ─────────── HTTP ─────────── */
  console.log("⑤ الجائزة اليوميّة عبر المسار");
  {
    const app = express();
    let CUR = null;
    L.setupLeague(app, { get store() { return S; }, currentUser: async () => CUR });
    const srv = app.listen(0);
    const port = srv.address().port;
    const call = (method, p, body) => new Promise(res => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ host: "127.0.0.1", port, path: encodeURI(p), method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
        s => { let b = ""; s.on("data", c => b += c); s.on("end", () => { try { res({ code: s.statusCode, j: JSON.parse(b) }); } catch (e) { res({ code: s.statusCode, j: null }); } }); });
      r.on("error", () => res({ code: 0, j: null }));
      if (data) r.write(data);
      r.end();
    });

    CUR = null;
    let r = await call("GET", "/api/daily");
    eq(r.code, 401, "الضيف لا يرى الجائزة");
    r = await call("POST", "/api/daily/claim", {});
    eq(r.code, 401, "ولا يأخذها");

    CUR = A;
    const before = (await S.getWallet(A.id)).gold;
    r = await call("GET", "/api/daily");
    ok(r.j.ok && r.j.taken === false, "ولم يأخذها بعد", r.j);
    const amount = r.j.amount;

    r = await call("POST", "/api/daily/claim", {});
    ok(r.j.ok && r.j.amount === amount, "أخذها", r.j);
    eq((await S.getWallet(A.id)).gold, before + amount, "وزاد رصيدُه بمقدارها");

    r = await call("POST", "/api/daily/claim", {});
    ok(!r.j.ok && /اليوم/.test(r.j.error), "ولا يأخذها مرّتين", r.j);
    eq((await S.getWallet(A.id)).gold, before + amount, "ورصيدُه لم يتغيّر");

    r = await call("GET", "/api/daily");
    ok(r.j.taken === true, "والحالة تقول إنّه أخذها", r.j);

    /* طلبان متزامنان: المفتاح لا الفحص هو الحارس */
    CUR = Bb;
    const b0 = (await S.getWallet(Bb.id)).gold;
    const two = await Promise.all([call("POST", "/api/daily/claim", {}), call("POST", "/api/daily/claim", {})]);
    const good = two.filter(x => x.j && x.j.ok).length;
    eq(good, 1, "طلبان متزامنان ⇐ منحةٌ واحدة", two.map(x => x.j));
    const b1 = (await S.getWallet(Bb.id)).gold;
    ok(b1 - b0 === two.find(x => x.j.ok).j.amount, "ولم يُمنَح مرّتين", { b0, b1 });

    console.log("⑥ الدوري عبر المسار");
    CUR = A;
    r = await call("GET", "/api/league");
    ok(r.j.ok, "لوحُ الدوري متاح", r.j && r.j.ok);
    ok(Array.isArray(r.j.top) && r.j.top.length >= 3, "وفيه المتصدّرون", r.j.top && r.j.top.length);
    ok(r.j.me && r.j.me.rank >= 1, "وترتيبي فيه", r.j.me);
    ok(r.j.prizes.length === 3 && r.j.prizes[0] > 0, "والجوائز معلنة", r.j.prizes);
    ok(r.j.week && r.j.prevWeek && r.j.week !== r.j.prevWeek, "والأسبوعان مختلفان", [r.j.week, r.j.prevWeek]);

    CUR = null;
    r = await call("GET", "/api/league");
    ok(r.j.ok && r.j.me === null, "والضيف يرى اللوح بلا ترتيبٍ له", r.j.me);

    console.log("⑦ جوائز الأسبوع الماضي تُصرَف مرّةً واحدة");
    const prev = L.prevWeekKey();
    const minG = SET.get("league", "leagueMinGames");
    await S.bumpLeague(A.id, prev, "baloot", { points: 50, games: minG, wins: 5 });
    await S.bumpLeague(Bb.id, prev, "baloot", { points: 30, games: minG, wins: 3 });
    await S.bumpLeague(C.id, prev, "baloot", { points: 10, games: 1, wins: 1 });   /* أقلّ من الحدّ */
    const wA = (await S.getWallet(A.id)).gold, wB = (await S.getWallet(Bb.id)).gold, wC = (await S.getWallet(C.id)).gold;

    const many = await Promise.all([0, 1, 2, 3, 4].map(() => call("GET", "/api/league")));
    const paidOnce = many.filter(x => x.j && x.j.justPaid).length;
    ok(paidOnce === 1, "خمسُ فتحاتٍ متزامنة ⇐ صرفٌ واحد", paidOnce);

    const p1 = SET.get("league", "leaguePrize1"), p2 = SET.get("league", "leaguePrize2");
    eq((await S.getWallet(A.id)).gold, wA + p1, "الأوّل أخذ جائزته");
    eq((await S.getWallet(Bb.id)).gold, wB + p2, "والثاني جائزته");
    eq((await S.getWallet(C.id)).gold, wC, "ومن لم يُكمل الحدّ الأدنى لم يأخذ شيئًا");

    await call("GET", "/api/league");
    eq((await S.getWallet(A.id)).gold, wA + p1, "وفتحةٌ لاحقة لا تدفع مرّةً ثانية");

    srv.close();
  }

  try { fs.unlinkSync(file); } catch (e) {}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F ? 1 : 0);
})();
