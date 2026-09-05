// 🏆 الجائزة اليوميّة والدوري الأسبوعيّ.
//
// أربعة قراراتٍ تشرح هذا الملفّ:
//
//  ١) **لا جدولَ للجائزة اليوميّة.** الدفترُ نفسه هو السجلّ: حركةٌ بمفتاح
//     منعِ تكرارٍ `يوميّة:<لاعب>:<تاريخ>`. من طلبها مرّتين في اليوم ردّت
//     القاعدةُ الثانية — لا نحتاج جدولًا ولا قفلًا ولا فحصًا مسبقًا.
//
//  ٢) **اليومُ بتوقيت الرياض لا بتوقيت الخادم.** خادمُنا يعمل بـUTC، ولو
//     حسبنا اليوم به لتغيّر «اليوم» عند الثالثة فجرًا عند اللاعب — فيفقد
//     سلسلتَه وهو نائم.
//
//  ٣) **جوائز الدوري تُصرَف كسولًا.** لا مُجدوِلَ يعمل في منتصف الليل —
//     خادمُ الاستضافة ينام حين لا أحد. فأوّلُ من يفتح صفحة الدوري في
//     الأسبوع الجديد يُشغّل تسويةَ الأسبوع الماضي، ومفتاحُ منع التكرار
//     يضمن أنّ من فتحها بعده لا يدفع مرّةً ثانية.
//
//  ٤) **حدٌّ أدنى من المباريات.** بلا هذا يتصدّر من لعب مباراةً واحدةً
//     محظوظةً على من لعب عشرين.

"use strict";

const SET = require("./settings");
const cfg = (k, d) => {
  const v = SET.get("league", k);
  return v === undefined || v === null ? d : v;
};

const RIYADH_OFFSET = 3 * 60 * 60 * 1000;   /* UTC+3 بلا توقيتٍ صيفيّ */
const DAY = 24 * 60 * 60 * 1000;

/** «٢٠٢٦-٠٩-٠٦» بتوقيت الرياض.
    الطابع الزمنيّ قد يصل نصًّا من قاعدةٍ تُعيد BIGINT نصًّا — فنُرغمه رقمًا
    هنا أيضًا، لأنّ تاريخًا فاسدًا في هذا السطر يُسقط الصفحة كلَّها. */
function dayKey(ts = Date.now()) {
  const n = Number(ts);
  const d = new Date((Number.isFinite(n) ? n : Date.now()) + RIYADH_OFFSET);
  return isNaN(d.getTime()) ? new Date(Date.now() + RIYADH_OFFSET).toISOString().slice(0, 10)
                            : d.toISOString().slice(0, 10);
}
/** مفتاح الأسبوع «٢٠٢٦-W36» — الأسبوع يبدأ السبت كما هو العُرف هنا. */
function weekKey(ts = Date.now()) {
  const n = Number(ts);
  const d = new Date((Number.isFinite(n) ? n : Date.now()) + RIYADH_OFFSET);
  const day = d.getUTCDay();                 /* ٠ الأحد … ٦ السبت */
  const backToSat = (day + 1) % 7;           /* كم يومًا مضى منذ السبت */
  const sat = new Date(d.getTime() - backToSat * DAY);
  return sat.toISOString().slice(0, 10);     /* تاريخُ سبتِ ذلك الأسبوع */
}
const prevWeekKey = (ts = Date.now()) => weekKey(ts - 7 * DAY);

/**
 * يحسب طولَ السلسلة من الدفتر: كم يومًا متتاليًا قبل اليوم أخذ فيها جائزته.
 * لا نُخزّن الرقم في مكانٍ آخر — الدفتر هو الحقيقة، وتخزينُه مرّتين يعني
 * أن يختلفا يومًا ما.
 */
function streakFrom(rows, today = dayKey()) {
  const days = new Set(
    rows.filter(r => String(r.reason || "").startsWith("يوميّة:"))
        .map(r => dayKey(r.createdAt)));
  let n = 0;
  let t = new Date(today + "T00:00:00Z").getTime();
  for (let i = 0; i < 60; i++) {
    t -= DAY;
    if (!days.has(new Date(t).toISOString().slice(0, 10))) break;
    n++;
  }
  return n;
}

/** مقدار جائزة اليوم بحسب السلسلة. */
function dailyAmount(streak) {
  const base = cfg("dailyGold", 120);
  const step = cfg("dailyStreak", 30);
  const maxD = cfg("dailyMaxDays", 7);
  const days = Math.min(streak, maxD - 1);
  return base + step * Math.max(0, days);
}

function setupLeague(app, deps) {
  const express = require("express");
  const json = express.json({ limit: "2kb" });
  const st = () => deps.store;
  const who = (req, res) => deps.currentUser(req, res);
  const GAME = "baloot";

  const need = async (req, res) => {
    const u = await who(req, res);
    if (!u) { res.status(401).json({ ok: false, error: "سجّل دخولك أوّلًا" }); return null; }
    return u;
  };

  /* ── الجائزة اليوميّة ── */
  app.get("/api/daily", async (req, res) => {
    const u = await need(req, res); if (!u) return;
    try {
      const rows = await st().ledgerOf(u.id, 80);
      const today = dayKey();
      const taken = rows.some(r => String(r.reason || "").startsWith("يوميّة:") &&
                                   dayKey(r.createdAt) === today);
      const streak = streakFrom(rows, today);
      res.json({ ok: true, open: !!cfg("dailyOpen", true), taken,
                 streak: taken ? streak + 1 : streak,
                 amount: dailyAmount(streak), max: cfg("dailyMaxDays", 7) });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر الفحص" }); }
  });

  app.post("/api/daily/claim", json, async (req, res) => {
    const u = await need(req, res); if (!u) return;
    if (!cfg("dailyOpen", true)) return res.status(400).json({ ok: false, error: "الجائزة اليوميّة موقوفة" });
    try {
      const rows = await st().ledgerOf(u.id, 80);
      const today = dayKey();
      const streak = streakFrom(rows, today);
      const amount = dailyAmount(streak);
      if (!amount) return res.status(400).json({ ok: false, error: "لا جائزة اليوم" });
      /* المفتاح هو الحارس: لا فحصَ ثمّ منحٌ — بينهما مسافةٌ يتسلّل منها طلبان */
      const r = await st().move(u.id, "gold", amount, {
        reason: "يوميّة:" + today, refType: "daily", idem: "daily:" + u.id + ":" + today
      });
      if (r.duplicate) return res.status(400).json({ ok: false, error: "أخذتَها اليوم — عُد غدًا" });
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error || "تعذّر المنح" });
      res.json({ ok: true, amount, streak: streak + 1, wallet: { gold: r.gold, gems: r.gems } });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر المنح" }); }
  });

  /* ── الدوري ── */
  const prizeOf = i => [cfg("leaguePrize1", 5000), cfg("leaguePrize2", 2500), cfg("leaguePrize3", 1000)][i] || 0;

  /** يُسوّي أسبوعًا منتهيًا. تكرارُ ندائه بلا ضرر — المفتاح يمنع الدفع مرّتين. */
  async function settleWeek(week) {
    if (!cfg("leagueOpen", true)) return { paid: [] };
    const minG = cfg("leagueMinGames", 3);
    const top = (await st().leagueTop(week, GAME, 12)).filter(r => r.games >= minG).slice(0, 3);
    const paid = [];
    for (let i = 0; i < top.length; i++) {
      const amount = prizeOf(i);
      if (!amount) continue;
      try {
        const r = await st().move(top[i].userId, "gold", amount, {
          reason: "دوري:" + week + ":مركز" + (i + 1), refType: "league",
          idem: "league:" + week + ":" + top[i].userId
        });
        if (r.ok) paid.push({ userId: top[i].userId, name: top[i].name, rank: i + 1, amount });
      } catch (e) { /* جائزةٌ فشلت لا تُوقف البقيّة */ }
    }
    return { paid };
  }

  app.get("/api/league", async (req, res) => {
    try {
      const week = weekKey(), prev = prevWeekKey();
      /* التسوية كسولة: أوّلُ زائرٍ في الأسبوع الجديد يُشغّلها */
      let settled = null;
      if (cfg("leagueOpen", true)) { try { settled = await settleWeek(prev); } catch (e) {} }
      const [top, lastTop] = await Promise.all([
        st().leagueTop(week, GAME, 20), st().leagueTop(prev, GAME, 3)
      ]);
      const u = await who(req, res);
      const me = u ? await st().leagueOf(u.id, week, GAME) : null;
      res.json({
        ok: true, open: !!cfg("leagueOpen", true), week, prevWeek: prev,
        top, lastTop, me, minGames: cfg("leagueMinGames", 3),
        prizes: [prizeOf(0), prizeOf(1), prizeOf(2)],
        points: { win: cfg("leagueWinPts", 3), play: cfg("leaguePlayPts", 1) },
        justPaid: settled && settled.paid.length ? settled.paid : null
      });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر جلب الدوري" }); }
  });

  console.log("🏆 الجائزة اليوميّة والدوري جاهزان على /api/daily و/api/league");
}

/** تُنادى من نهاية كل مباراة. تصمت عند أي خطأ — الدوري لا يُفسد مباراة. */
async function recordMatch(store, game, players) {
  if (!cfg("leagueOpen", true) || !store || !store.bumpLeague) return;
  const week = weekKey();
  const win = cfg("leagueWinPts", 3), play = cfg("leaguePlayPts", 1);
  for (const p of players || []) {
    if (!p || !p.userId || p.isBot) continue;
    try {
      await store.bumpLeague(p.userId, week, game, {
        points: p.won ? win : play, games: 1, wins: p.won ? 1 : 0
      });
    } catch (e) { /* الدوري لا يُفسد نهاية مباراة */ }
  }
}

module.exports = { setupLeague, recordMatch, dayKey, weekKey, prevWeekKey, streakFrom, dailyAmount };
