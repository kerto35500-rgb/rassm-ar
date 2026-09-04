// 🛒 المتجر — العرض والشراء والتجهيز.
//
// قاعدةٌ واحدة تحكم الملفّ كلّه: العميل لا يرسل سعرًا أبدًا. يرسل معرّف
// العنصر فقط، والخادم يقرأ سعره من الكتالوج ويخصمه. أيّ تصميمٍ آخر يعني
// أن أوّل من يفتح أدوات المطوّر يشتري كل شيء بريال.
//
// والتملّك والخصم والإيصال في معاملةٍ واحدة داخل المخزن (buyItem)، فلا
// يُترَك لاعبٌ خُصم منه بلا عنصر، ولا عنصرٌ بلا خصم.

const { rateLimit } = require("./security");
const { SECTIONS } = require("./shopseed");
const SET = require("./settings");

/* هديّةُ البداية: حسابٌ جديد رصيده صفر يرى متجرًا لا يستطيع لمسه، وهذا
   استقبالٌ بارد. نمنحه مرّةً واحدة عند أوّل زيارةٍ للمتجر، ومفتاحُ منع
   التكرار يضمن أنها مرّةٌ واحدة مهما تكرّر النداء.
   والمقدار مقصود: أرخص عنصرٍ في المتجر بأربعمئة، فبخمسمئة يخرج القادمُ
   الجديد بشيءٍ يملكه فعلًا لا برصيدٍ يتفرّج به. */
const WELCOME_GOLD = 500;

async function grantWelcome(store, userId) {
  const amount = SET.get("economy", "welcomeGold");
  if (!amount) return;                     /* صُفِّرت من اللوحة: لا هديّة */
  try {
    await store.move(userId, "gold", amount, {
      reason: "هديّة الترحيب", refType: "welcome", idem: "welcome:" + userId
    });
  } catch (e) { /* الهديّة لا تُعطّل المتجر */ }
}

/**
 * يُركّب مسارات المتجر.
 * deps: { store, currentUser }
 */
function setupShop(app, deps) {
  const json = require("express").json({ limit: "2kb" });
  const st = () => deps.store;
  const who = (req, res) => deps.currentUser(req, res);

  /** كتالوج المتجر مع حالة الملكيّة والتجهيز لهذا اللاعب. */
  app.get("/api/shop/catalog", async (req, res) => {
    try {
      const items = await st().listItems({ game: req.query.game || null });
      const u = await who(req, res);
      let owned = new Set(), loadout = {}, wallet = { gold: 0, gems: 0 };
      if (u) {
        await grantWelcome(st(), u.id);
        owned = new Set((await st().inventoryOf(u.id)).map(x => x.itemId));
        loadout = await st().getLoadout(u.id);
        wallet = await st().getWallet(u.id);
      }
      res.json({
        ok: true, guest: !u, sections: SECTIONS, wallet, loadout,
        items: items.map(i => ({
          id: i.id, game: i.game, kind: i.kind, key: i.key, name: i.name,
          descr: i.descr, currency: i.currency, price: i.price,
          rarity: i.rarity, preview: i.preview,
          /* المجّانيّ مملوكٌ للجميع بلا صفٍّ في المخزون: لا معنى لأن نكتب
             ثمانين سطرًا لكل حسابٍ جديدٍ كي نقول إنه يملك المجّانيّ. */
          owned: i.price === 0 || owned.has(i.id)
        }))
      });
    } catch (e) {
      console.error("shop catalog:", e.message);
      res.status(500).json({ ok: false, error: "تعذّر فتح المتجر" });
    }
  });

  /** ما يملكه اللاعب — تستدعيه الألعاب عند الإقلاع. */
  app.get("/api/shop/mine", async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.json({ ok: true, guest: true, owned: [], loadout: {} });
      const game = req.query.game || null;
      const inv = await st().inventoryOf(u.id);
      const ids = game ? inv.filter(x => x.itemId.startsWith(game + ":")) : inv;
      res.json({
        ok: true, guest: false,
        owned: ids.map(x => x.itemId),
        loadout: await st().getLoadout(u.id, game),
        wallet: await st().getWallet(u.id)
      });
    } catch (e) { res.json({ ok: true, guest: true, owned: [], loadout: {} }); }
  });

  /* حدُّ معدّلٍ على الشراء: ليس لأن الشراء ضارّ، بل لأن حلقةً في المتصفّح
     تُغرق القاعدة بمعاملاتٍ مقفلة. عشرون في الدقيقة أكثر من أيّ إنسان. */
  app.post("/api/shop/buy",
    rateLimit({ name: "buy", windowMs: 60000, max: 20, message: "تمهّل قليلًا." }),
    json, async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.status(401).json({ ok: false, error: "سجّل دخولك لتشتري" });
      if (u.bannedUntil && u.bannedUntil > Date.now())
        return res.status(403).json({ ok: false, error: "الحساب موقوف" });

      if (!SET.get("site", "shopOpen"))
        return res.status(503).json({ ok: false, error: "المتجر مغلقٌ مؤقّتًا" });

      const id = String(req.body?.id || "").slice(0, 120);
      const item = await st().getItem(id);
      if (!item || !item.active) return res.status(404).json({ ok: false, error: "عنصر غير متاح" });
      if (item.price === 0) return res.json({ ok: true, free: true, owned: true });

      const r = await st().buyItem(u.id, item);
      if (!r.ok) return res.status(r.owned ? 409 : 400).json(r);
      res.json({ ok: true, wallet: r.wallet, item: { id: item.id, name: item.name } });
    } catch (e) {
      console.error("shop buy:", e.message);
      res.status(500).json({ ok: false, error: "تعذّر إتمام الشراء" });
    }
  });

  /** تجهيز عنصرٍ مملوك — أو مجّانيّ. */
  app.post("/api/shop/equip", json, async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.status(401).json({ ok: false, error: "لست مسجّلًا" });
      const id = String(req.body?.id || "").slice(0, 120);
      const item = await st().getItem(id);
      if (!item) return res.status(404).json({ ok: false, error: "عنصر غير معروف" });
      if (item.price > 0 && !(await st().ownsItem(u.id, id)))
        return res.status(403).json({ ok: false, error: "لا تملك هذا العنصر" });
      await st().setLoadout(u.id, item.game, item.kind, item.key);
      res.json({ ok: true, game: item.game, kind: item.kind, key: item.key });
    } catch (e) {
      console.error("shop equip:", e.message);
      res.status(500).json({ ok: false, error: "تعذّر التجهيز" });
    }
  });

  /* جائزة «وحدة» المنفردة (ضدّ الحاسوب).
     كن صريحًا مع نفسك: النتيجة يبلّغ بها العميل، فهي قابلةٌ للتزوير. لذلك
     المبالغ صغيرة والسقف اليوميّ أصغر — أقصى ما يجنيه مزوّرٌ ماهر ثمانون
     ذهبًا في اليوم، أي أقلّ من إطارٍ واحدٍ كل تسعة أيام. ويوم تصير «وحدة»
     على الخادم تُلغى هذه ويأخذ مكانَها awardMatch كبقيّة الألعاب. */
  const SOLO = [20, 10, 6, 4];
  app.post("/api/uno/solo",
    rateLimit({ name: "solo", windowMs: 60000, max: 6 }), json, async (req, res) => {
    try {
      const u = await who(req, res);
      if (!u) return res.json({ ok: false, guest: true });
      const rank = Math.max(0, Math.min(3, parseInt(req.body?.rank, 10) || 0));
      const since = Date.now() - 24 * 3600 * 1000;
      const cap = SET.get("economy", "unoSoloCap");
      const had = await st().earnedSince(u.id, since, "لعب:uno:منفرد");
      const amount = Math.min(SOLO[rank], Math.max(0, cap - had));
      if (amount <= 0)
        return res.json({ ok: true, amount: 0, capped: true, wallet: await st().getWallet(u.id) });
      const r = await st().move(u.id, "gold", amount, { reason: "لعب:uno:منفرد" });
      res.json({ ok: true, amount, wallet: { gold: r.gold, gems: r.gems },
                 remaining: Math.max(0, cap - had - amount) });
    } catch (e) {
      console.error("uno solo:", e.message);
      res.status(500).json({ ok: false });
    }
  });

  return { grantWelcome: uid => grantWelcome(st(), uid) };
}

module.exports = { setupShop, WELCOME_GOLD };
