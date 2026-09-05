// 👥 الأصدقاء — طلبٌ يُقبَل أو يُرفَض، وحظرٌ يُنهي الحديث.
//
// ثلاثة قراراتٍ تشرح شكل هذا الملفّ:
//
//  ١) لا صداقةَ بلا موافقة. الطلبُ يخرج من طرفٍ ولا يصير صداقةً حتى يقبل
//     الآخر — ولا يُشعَر المطلوبُ بشيءٍ سوى صفٍّ في قائمته. ومن أرسل إلى
//     من أرسل إليه صار قبولًا، فلا ينتظر كلٌّ منهما الآخر.
//
//  ٢) الحظر أقوى من كلّ شيء. من حظرتَه لا يطلبك ولا تراه في نتائج بحثه،
//     ولا يُقال له إنّه محظور — فإخبارُه دعوةٌ لحسابٍ جديد.
//
//  ٣) البحث بالاسم لا بالمعرّف. المعرّفات أرقامٌ متسلسلة، ومن يجرّبها
//     واحدًا واحدًا يُعدّد الحسابات كلَّها. فالبحث يحتاج حرفين على الأقلّ
//     ويُرجع عددًا محدودًا، ولا يكشف بريدًا ولا حالةَ حظرٍ ولا آخر دخول.

const { rateLimit } = require("./security");

const MAX_FRIENDS = 200;
const MIN_QUERY = 2;
const MAX_RESULTS = 20;

function setupFriends(app, deps) {
  const express = require("express");
  const json = express.json({ limit: "4kb" });
  const st = () => deps.store;
  const who = (req, res) => deps.currentUser(req, res);

  /* من يطلب صداقةً لا يفعلها مئةَ مرّةٍ في الدقيقة، ومن يبحث لا يمسح
     قاعدةَ الأسماء. الحدُّ هنا ليس تعطيلًا بل منعُ الاستكشاف بالجملة. */
  const rlWrite = rateLimit({ name: "friends", windowMs: 60000, max: 30,
                              message: "طلباتٌ كثيرة، انتظر قليلًا." });
  const rlSearch = rateLimit({ name: "friendsearch", windowMs: 60000, max: 40,
                               message: "بحثٌ كثير، انتظر قليلًا." });

  const need = async (req, res) => {
    const u = await who(req, res);
    if (!u) { res.status(401).json({ ok: false, error: "سجّل دخولك أوّلًا" }); return null; }
    return u;
  };
  const targetId = req => {
    const n = Number(req.body && req.body.id);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  /* ── القوائم ── */
  app.get("/api/friends", async (req, res) => {
    const u = await need(req, res); if (!u) return;
    try {
      const [friends, incoming, sent, blocked] = await Promise.all([
        st().friendsOf(u.id), st().friendRequestsOf(u.id),
        st().friendSentOf(u.id), st().friendBlockedOf(u.id)
      ]);
      res.json({ ok: true, friends, incoming, sent, blocked, max: MAX_FRIENDS });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر جلب القائمة" }); }
  });

  /* ── البحث ── */
  app.get("/api/friends/search", rlSearch, async (req, res) => {
    const u = await need(req, res); if (!u) return;
    const q = String(req.query.q || "").trim().slice(0, 30);
    if (q.length < MIN_QUERY) return res.json({ ok: true, list: [] });
    try {
      const rows = await st().searchUsers(q, 60);
      const out = [];
      for (const r of rows) {
        if (r.id === u.id) continue;
        const state = await st().friendState(u.id, r.id);
        /* من حظرني لا أراه أصلًا، ومن حظرتُه أراه لأرفع الحظر */
        if (state === "blocked-by") continue;
        out.push({ id: r.id, name: r.displayName || r.name, state });
        if (out.length >= MAX_RESULTS) break;
      }
      res.json({ ok: true, list: out });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر البحث" }); }
  });

  /* ── الأفعال ── */
  const act = (path, fn) => app.post("/api/friends/" + path, rlWrite, json, async (req, res) => {
    const u = await need(req, res); if (!u) return;
    const id = targetId(req);
    if (!id) return res.status(400).json({ ok: false, error: "لاعبٌ غير محدَّد" });
    if (id === u.id) return res.status(400).json({ ok: false, error: "لا تُصادق نفسك" });
    try {
      const other = await st().getUserById(id);
      if (!other) return res.status(404).json({ ok: false, error: "لا لاعبَ بهذا المعرّف" });
      const r = await fn(u.id, id);
      if (!r || !r.ok) return res.status(400).json({ ok: false, error: (r && r.error) || "تعذّر الفعل" });
      res.json({ ok: true, state: r.state });
    } catch (e) { res.status(500).json({ ok: false, error: "تعذّر الفعل" }); }
  });

  act("request", (me, id) => st().friendRequest(me, id, MAX_FRIENDS));
  act("accept",  (me, id) => st().friendAccept(me, id));
  act("reject",  (me, id) => st().friendReject(me, id));
  act("remove",  (me, id) => st().friendRemove(me, id));
  act("block",   (me, id) => st().friendBlock(me, id));
  act("unblock", (me, id) => st().friendUnblock(me, id));

  console.log("👥 الأصدقاء جاهزون على /api/friends");
}

module.exports = { setupFriends, MAX_FRIENDS, MIN_QUERY, MAX_RESULTS };
