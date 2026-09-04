// 📊 ترحيل إحصاءات الألعاب القديمة إلى جدول game_stats.
//
// القديم: كائنٌ واحدٌ في kv لكل لعبة، مفتاحه اسم اللاعب:
//   quizStats  = { "أحمد": {games, wins, points} }
//   bombStats  = { "أحمد": {games, wins, words} }
//   salfaStats = { "أحمد": {games, wins, points} }
// الجديد: صفٌّ لكل (معرّف لاعب، لعبة).
//
// يُنفَّذ مرّةً واحدة عند الإقلاع ويُسجَّل في kv:statsMigrated. من ضاع حسابه
// (اسمٌ لم يعد موجودًا) يُتخطّى بهدوء ويُذكَر في السجلّ.

const SOURCES = [
  { kv: "quizStats",  game: "quiz",  score: "points" },
  { kv: "bombStats",  game: "bomb",  score: null, extra: ["words"] },
  { kv: "salfaStats", game: "salfa", score: "points" }
];

async function migrateGameStats(store, log = console.log) {
  const done = await store.getKV("statsMigrated");
  if (done && done.at) return { skipped: true };

  let moved = 0, missing = 0;
  for (const src of SOURCES) {
    let map = null;
    try { map = await store.getKV(src.kv); } catch (e) { continue; }
    if (!map || typeof map !== "object") continue;

    for (const [name, s] of Object.entries(map)) {
      if (!s || typeof s !== "object") continue;
      let u = null;
      try { u = await store.getUser(name); } catch (e) {}
      if (!u || !u.id) { missing++; continue; }

      const extra = {};
      (src.extra || []).forEach(k => { if (s[k]) extra[k] = Number(s[k]) || 0; });
      try {
        await store.bumpGameStats(u.id, src.game, {
          games: Number(s.games) || 0,
          wins: Number(s.wins) || 0,
          score: src.score ? (Number(s[src.score]) || 0) : 0,
          extra: Object.keys(extra).length ? extra : null
        });
        moved++;
      } catch (e) { log("   ⚠️ تعذّر ترحيل " + name + " في " + src.game + ": " + e.message); }
    }
  }

  await store.saveKV("statsMigrated", { at: Date.now(), moved, missing });
  if (moved || missing)
    log(`📊 رُحّلت إحصاءات ${moved} لاعبًا` + (missing ? ` (${missing} بلا حساب — تُخطّيت)` : ""));
  return { moved, missing };
}

module.exports = { migrateGameStats, SOURCES };
