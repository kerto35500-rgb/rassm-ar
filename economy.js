// 🪙 الاقتصاد — من أين يأتي الذهب، وبأيّ ضوابط.
//
// القاعدة الأولى: الخادم وحده يمنح. اللاعب لا يرسل رقمًا أبدًا، ولا يُصدَّق
// على رصيده. كل منحةٍ تمرّ من هنا، وتُسجَّل في الدفتر بسببها.
//
// ولماذا كل هذه الضوابط؟ لأن أسهل طريقةٍ لكسر لعبةٍ فيها عملة أن يفتح
// أحدهم غرفةً بحسابين من جهازه ويلعب مع نفسه ألف مرّة. فنشترط:
//   • لاعبَين مسجَّلَين على الأقلّ، بحسابين مختلفين وعنوانَين مختلفين.
//   • مباراةٌ حقيقية: بلغت نهايتها ولم تُلغَ.
//   • سقفٌ يوميّ لكل لعبة، فحتى اللعب الشريف لا يفيض.
//   • مفتاحُ منعِ تكرار لكل مباراة، فلا تُمنَح الجائزة مرّتين.

const DAY = 24 * 3600 * 1000;

/* جوائز نهاية المباراة لكل لعبة: للفائز، ولمن شارك.
   الأرقام متواضعة عمدًا — المتجر يُسعَّر عليها لاحقًا، ورفعُها أسهل من خفضها. */
const REWARDS = {
  quiz:  { win: 60, play: 20, name: "قمّة الهرم" },
  bomb:  { win: 50, play: 18, name: "القنبلة" },
  salfa: { win: 45, play: 16, name: "برّا السالفة" },
  draw:  { win: 40, play: 15, name: "ارسمها!" },
  uno:   { win: 40, play: 15, name: "اونو" },
  /* بالوت صكّةٌ طويلة (أيدٍ متتالية حتى ١٥٢)، فجائزتها أعلى — الوقت المبذول
     فيها أضعافُ جولةِ اونو، ولو تساوت الجوائز لهجرها الناس إلى الأسرع. */
  baloot: { win: 70, play: 25, name: "بالوت" }
};

/* سقفٌ يوميّ لكل لعبة على حدة، وسقفٌ كلّيّ فوقها */
const DAILY_CAP = { quiz: 400, bomb: 350, salfa: 350, draw: 300, uno: 300, baloot: 420 };
const DAILY_TOTAL = 900;

/* الأرقام أعلاه هي الافتراضيّ. أمّا المطبَّق فعلًا فيأتي من الإعدادات الحيّة
   إن ضُبطت من اللوحة — نقرأه عند كل منحة لا عند التحميل، وإلا بقي الموقع
   على أرقام النشرة السابقة حتى يُعاد تشغيله. */
let S = null;
try { S = require("./settings"); } catch (e) { /* الاختبارات قد تعزل الوحدة */ }
const cfg = (key, fallback) => {
  const v = S && S.get("economy", key);
  return v === undefined || v === null ? fallback : v;
};
const rewardOf = game => ({
  win:  cfg(game + "Win",  REWARDS[game].win),
  play: cfg(game + "Play", REWARDS[game].play)
});
const capOf   = game => cfg(game + "Cap", DAILY_CAP[game] || 300);
const totalCap = () => cfg("dailyTotal", DAILY_TOTAL);

/** هل هذه المباراة تستحقّ جائزة؟ يُرجع سببَ الرفض أو null إن كانت صالحة. */
function matchProblem(players) {
  const real = players.filter(p => p && p.userId && !p.isBot && !p.spectator);
  if (real.length < 2) return "تحتاج لاعبَين مسجَّلَين على الأقل";
  const ids = new Set(real.map(p => String(p.userId)));
  if (ids.size < 2) return "لاعبان بحسابٍ واحد";
  /* عناوينُ مختلفة: لا تمنع اللعب من بيتٍ واحد (وهو شائعٌ ومشروع)، لكنها
     تمنع فتح حسابين على الجهاز نفسه لحصد الذهب. نكتفي بعنوانَين مختلفَين
     بين اثنين على الأقلّ كي لا نظلم إخوةً على شبكةٍ واحدة. */
  const ips = new Set(real.map(p => p.ip || "?").filter(x => x !== "?"));
  if (ips.size < 2 && real.length === 2) return "اللاعبان من العنوان نفسه";
  return null;
}

/**
 * يمنح جوائز نهاية مباراة.
 * store: يحتاج move و earnedSince.
 * players: [{ userId, id, ip, isBot, spectator }]
 * winnerId: معرّف اللاعب الفائز داخل الغرفة (p.id لا userId)
 * winnerIds: بديلُه حين يفوز فريقٌ لا فردٌ — كبالوت. أحدهما يكفي.
 * matchId: معرّفٌ فريد للمباراة — منه يُشتقّ مفتاح منع التكرار
 */
async function awardMatch(store, { game, players, winnerId, winnerIds, matchId }) {
  /* الفوز الجماعيّ ليس حالةً خاصّة، بل هو الأصل ومنه الفوز الفرديّ مجموعةٌ
     من واحد. فنوحّدهما هنا مرّةً ولا نُكرّر الشرط في كلّ سطرٍ بعدها. */
  const winSet = new Set(
    (winnerIds && winnerIds.length ? winnerIds : (winnerId != null ? [winnerId] : []))
      .map(String)
  );
  const R = REWARDS[game];
  if (!R || !store || !store.move) return { granted: [], reason: "لعبة غير معروفة" };

  const problem = matchProblem(players);
  if (problem) return { granted: [], reason: problem };

  const since = Date.now() - DAY;
  const granted = [];
  const rw = rewardOf(game), cap = capOf(game), total = totalCap();
  for (const p of players) {
    if (!p.userId || p.isBot || p.spectator) continue;
    const isWin = winSet.has(String(p.id));
    let amount = isWin ? rw.win : rw.play;

    try {
      /* السقفان: لعبةً لعبةً ثم الكلّيّ. نمنح الباقي لا صفرًا،
         فمن بقي له عشرون يأخذ عشرين ولا يخرج بخفَّي حنين. */
      const perGame = await store.earnedSince(p.userId, since, "لعب:" + game);
      amount = Math.min(amount, Math.max(0, cap - perGame));
      if (amount > 0) {
        const all = await store.earnedSince(p.userId, since, "لعب:");
        amount = Math.min(amount, Math.max(0, total - all));
      }
      if (amount <= 0) { granted.push({ userId: p.userId, amount: 0, capped: true }); continue; }

      const res = await store.move(p.userId, "gold", amount, {
        reason: "لعب:" + game + (isWin ? ":فوز" : ":مشاركة"),
        refType: "match", refId: String(matchId || ""),
        idem: matchId ? `${game}:${matchId}:${p.userId}` : null
      });
      granted.push({ userId: p.userId, amount: res.ok ? amount : 0,
                     duplicate: !!res.duplicate, balance: res.balance });
    } catch (e) {
      /* المال لا يُعطّل اللعب: نُسجّل ونكمل */
      console.error("economy award:", e.message);
    }
  }
  return { granted };
}

/** ما بقي للاعب اليوم من سقف الكسب — يُعرَض في البروفايل. */
async function remainingToday(store, userId) {
  const since = Date.now() - DAY;
  const all = await store.earnedSince(userId, since, "لعب:");
  const perGame = {};
  for (const g of Object.keys(REWARDS))
    perGame[g] = Math.max(0, capOf(g) - await store.earnedSince(userId, since, "لعب:" + g));
  return { total: Math.max(0, totalCap() - all), perGame, earnedToday: all };
}

module.exports = { REWARDS, DAILY_CAP, DAILY_TOTAL, awardMatch, matchProblem, remainingToday, DAY };
