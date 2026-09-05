// 🎛️ لوحة الإدارة الموحّدة — <ADMIN_PATH>/p
//
// لوحة المراقبة القديمة تعرض ولا تتصرّف. هذه تتصرّف: تحظر، وتُهدي، وتمنح
// عنصرًا، وتُسعّر، وتُغيّر أرقام الاقتصاد. ولذلك تُحكَم بثلاث قواعد:
//
//  ١) لا فعل بلا سطرٍ في سجلّ التدقيق. من فعل، وبمن، ومتى، ومن أيّ عنوان.
//     السجلّ يُكتب حتى حين يفشل الفعل، فمحاولةُ منح مليونٍ مرفوضةً تُرى.
//  ٢) المدى في الكود لا في الطلب. الهديّة محدودة، والسعر محدود، والإعداد
//     له حدٌّ في settings.js — فلا يكسر خطأٌ مطبعيّ اقتصاد الموقع.
//  ٣) لا يُقرأ ولا يُكتب شيءٌ إلا بجلسة أدمن صالحة، تُفحَص في كل مسار.

const { ADMIN_PATH, adminEnabled, verifySession, parseCookies } = require("./admin");
const SET = require("./settings");
const { allItems } = require("./shopseed");
const { KINDS } = require("./support");

/* حدود الأفعال الإداريّة نفسها. الهديّة الكبيرة ليست ممنوعةً لأنها ضارّة،
   بل لأن صفرًا زائدًا سهوًا أسهل من أن نعتمد على الانتباه. */
const GIFT_MAX = 100000;
const PRICE_MAX = 1000000;
const BAN_MAX_DAYS = 3650;

function setupPanel(app, deps) {
  /* بلا ADMIN_USER/ADMIN_PASS لا جلسةَ أدمن أصلًا، فلا معنى لتركيب مساراتٍ
     لا يمرّ منها أحد — ونُقلّل سطح الهجوم بدل أن نتركها تردّ ٤٠٣ للأبد. */
  if (!adminEnabled) return null;
  const json = require("express").json({ limit: "8kb" });
  const st = () => deps.store;

  const ipOf = req =>
    ((req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "?")
      .toString().replace(/^::ffff:/, "").trim();

  /** حارسٌ واحد لكل المسارات — لا استثناء ولا «هذا المسار بسيط». */
  function guard(req, res) {
    if (verifySession(parseCookies(req).adm)) return true;
    res.status(403).json({ ok: false, error: "غير مصرّح" });
    return false;
  }

  /* التدقيق: نكتب ولا ننتظر ولا نُسقط الطلب إن فشل الكتابة — لكن نصرخ في
     السجلّ، فسجلُّ تدقيقٍ صامتٌ عن أعطاله أسوأ من لا سجلّ. */
  const note = (req, action, target, detail) =>
    st().audit({ actor: "admin", action, target: target == null ? null : String(target),
                 detail: detail || {}, ip: ipOf(req) })
        .catch(e => console.error("audit:", e.message));

  // ═══════════════ اللاعبون ═══════════════

  app.get(ADMIN_PATH + "/p/users", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const rows = await st().searchUsers(req.query.q || "", 40);
      res.json({ ok: true, users: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /** كل ما نعرفه عن لاعبٍ في نداءٍ واحد — لأن اللوحة تُفتح للنظر لا للنقر. */
  app.get(ADMIN_PATH + "/p/user/:id", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const id = Number(req.params.id);
      const u = await st().getUserById(id);
      if (!u) return res.status(404).json({ ok: false, error: "لا يوجد" });
      const inv = await st().inventoryOf(id).catch(() => []);
      const items = new Map(allItems().map(i => [i.id, i.name]));
      res.json({
        ok: true,
        user: { id, name: u.name, email: u.email || null, role: u.role || "user",
                bannedUntil: u.bannedUntil || null, banReason: u.banReason || null,
                created: u.created || null, lastSeenAt: u.lastSeenAt || null },
        wallet: await st().getWallet(id).catch(() => ({ gold: 0, gems: 0 })),
        stats: await st().getGameStats(id).catch(() => []),
        ledger: await st().ledgerOf(id, 25).catch(() => []),
        sessions: await st().listSessions(id).catch(() => []),
        inventory: inv.map(x => ({ id: x.itemId, name: items.get(x.itemId) || x.itemId,
                                   source: x.source, at: x.acquiredAt })),
        audit: await st().auditLog({ target: String(id), limit: 25 }).catch(() => [])
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post(ADMIN_PATH + "/p/ban", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = Number(req.body?.id);
    const days = Number(req.body?.days);
    const reason = String(req.body?.reason || "").slice(0, 200);
    try {
      const u = await st().getUserById(id);
      if (!u) return res.status(404).json({ ok: false, error: "لا يوجد" });
      /* أيّامٌ صفرٌ أو أقلّ = رفعُ الحظر. فعلٌ واحدٌ للاتجاهين أوضح من زرَّين. */
      if (!(days > 0)) {
        await st().updateUser(id, { bannedUntil: null, banReason: null });
        note(req, "unban", id, { name: u.name });
        return res.json({ ok: true, banned: false });
      }
      if (days > BAN_MAX_DAYS) return res.status(400).json({ ok: false, error: "مدّة طويلة جدًّا" });
      const until = Date.now() + days * 24 * 3600 * 1000;
      await st().updateUser(id, { bannedUntil: until, banReason: reason || null });
      /* الحظر بلا إخراجٍ من الأجهزة حظرٌ على الورق: جلسته تبقى مفتوحة. */
      await st().revokeUserSessions(id).catch(() => {});
      note(req, "ban", id, { name: u.name, days, reason, until });
      res.json({ ok: true, banned: true, until });
    } catch (e) {
      note(req, "ban-failed", id, { error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post(ADMIN_PATH + "/p/logout-all", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = Number(req.body?.id);
    try {
      const n = await st().revokeUserSessions(id);
      note(req, "logout-all", id, { sessions: n });
      res.json({ ok: true, revoked: n });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /** هديّة: ذهبٌ أو جواهر، موجبةٌ أو سالبة (تصحيحُ خطأ). */
  app.post(ADMIN_PATH + "/p/gift", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = Number(req.body?.id);
    const currency = req.body?.currency === "gems" ? "gems" : "gold";
    const amount = Math.round(Number(req.body?.amount));
    const why = String(req.body?.why || "").slice(0, 100);
    if (!Number.isFinite(amount) || amount === 0)
      return res.status(400).json({ ok: false, error: "أدخل مقدارًا" });
    if (Math.abs(amount) > GIFT_MAX)
      return res.status(400).json({ ok: false, error: `الحدّ ${GIFT_MAX}` });
    try {
      const u = await st().getUserById(id);
      if (!u) return res.status(404).json({ ok: false, error: "لا يوجد" });
      const r = await st().move(id, currency, amount, {
        reason: (amount > 0 ? "هديّة إدارة" : "خصم إدارة") + (why ? ": " + why : ""),
        refType: "admin"
      });
      note(req, amount > 0 ? "gift" : "deduct", id, { name: u.name, currency, amount, why, ok: r.ok });
      if (!r.ok) return res.status(400).json(r);
      res.json({ ok: true, wallet: await st().getWallet(id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /** منح عنصرٍ بلا دفع — تعويضٌ أو جائزة مسابقة. */
  app.post(ADMIN_PATH + "/p/grant", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = Number(req.body?.id);
    const itemId = String(req.body?.item || "").slice(0, 120);
    try {
      const u = await st().getUserById(id);
      if (!u) return res.status(404).json({ ok: false, error: "لا يوجد" });
      const item = await st().getItem(itemId);
      if (!item) return res.status(404).json({ ok: false, error: "عنصر غير معروف" });
      const r = await st().grantItem(id, itemId, "admin");
      note(req, "grant", id, { name: u.name, item: itemId, already: !!r.owned });
      res.json(r.ok ? { ok: true } : { ok: false, error: "يملكه بالفعل" });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════ المتجر ═══════════════

  app.get(ADMIN_PATH + "/p/items", async (req, res) => {
    if (!guard(req, res)) return;
    try { res.json({ ok: true, items: await st().listItems({ all: true }) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post(ADMIN_PATH + "/p/item", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = String(req.body?.id || "").slice(0, 120);
    try {
      const item = await st().getItem(id);
      if (!item) return res.status(404).json({ ok: false, error: "عنصر غير معروف" });

      if (req.body?.active !== undefined) {
        await st().setItemActive(id, !!req.body.active);
        note(req, "item-active", id, { active: !!req.body.active });
      }
      if (req.body?.price !== undefined) {
        const p = Math.round(Number(req.body.price));
        if (!Number.isFinite(p) || p < 0 || p > PRICE_MAX)
          return res.status(400).json({ ok: false, error: `السعر بين ٠ و${PRICE_MAX}` });
        /* البذر عند الإقلاع يُعيد سعر الكتالوج، فالتسعير من اللوحة يُحفَظ
           كتجاوزٍ في الإعدادات ويُعاد تطبيقه بعد كل بذر. */
        await st().setSetting("prices", id, p, "admin");
        await st().upsertItems([{ ...item, key: item.key, price: p }]);
        note(req, "item-price", id, { from: item.price, to: p });
      }
      res.json({ ok: true, item: await st().getItem(id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════ الإعدادات ═══════════════

  /* صحّة الرهان: كم ذهبٍ محجوزٌ الآن، وكم صفًّا سُوّي. الرقم «المحجوز» يجب
     أن يوافق ما في الطاولات الجارية — فإن بقي بعد أن خلا الموقع فثمّ خلل. */
  app.get(ADMIN_PATH + "/p/escrow", async (req, res) => {
    if (!guard(req, res)) return;
    try { res.json({ ok: true, escrow: await st().escrowStats() }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  app.get(ADMIN_PATH + "/p/settings", (req, res) => {
    if (!guard(req, res)) return;
    res.json({ ok: true, settings: SET.describe() });
  });

  app.post(ADMIN_PATH + "/p/settings", json, async (req, res) => {
    if (!guard(req, res)) return;
    const scope = String(req.body?.scope || "");
    const key = String(req.body?.key || "");
    try {
      const before = SET.get(scope, key);
      const r = await SET.set(st(), scope, key, req.body?.value, "admin");
      note(req, r.ok ? "setting" : "setting-rejected", scope + "." + key,
           { from: before, to: r.ok ? r.value : req.body?.value, error: r.error || null });
      if (!r.ok) return res.status(400).json(r);
      res.json({ ok: true, value: r.value });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════ الدعم والبلاغات ═══════════════

  app.get(ADMIN_PATH + "/p/tickets", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const status = req.query.status && req.query.status !== "all" ? req.query.status : null;
      res.json({ ok: true, kinds: KINDS,
                 tickets: await st().listTickets({ status, limit: 80 }),
                 open: await st().countTickets("open") });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get(ADMIN_PATH + "/p/ticket/:id", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const t = await st().getTicket(req.params.id);
      if (!t) return res.status(404).json({ ok: false, error: "لا توجد" });
      res.json({ ok: true, ticket: t, kinds: KINDS });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post(ADMIN_PATH + "/p/ticket/:id/reply", json, async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const t = await st().getTicket(req.params.id);
      if (!t) return res.status(404).json({ ok: false, error: "لا توجد" });
      const body = String(req.body?.body || "").trim().slice(0, 4000);
      if (!body) return res.status(400).json({ ok: false, error: "اكتب ردًّا" });
      await st().addTicketMessage(t.id, { fromAdmin: true, body, images: [] });
      if (req.body?.close) await st().setTicketStatus(t.id, "closed");
      note(req, "ticket-reply", "t" + t.id, { close: !!req.body?.close, len: body.length });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post(ADMIN_PATH + "/p/ticket/:id/status", json, async (req, res) => {
    if (!guard(req, res)) return;
    const s = ["open", "answered", "closed"].includes(req.body?.status) ? req.body.status : null;
    if (!s) return res.status(400).json({ ok: false, error: "حالة غير معروفة" });
    try {
      const okk = await st().setTicketStatus(req.params.id, s);
      note(req, "ticket-status", "t" + req.params.id, { status: s });
      res.json({ ok: okk });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /** بلاغات الإشراف داخل الغرف — كانت تُجمَع ولا يقرؤها أحد. */
  app.get(ADMIN_PATH + "/p/reports", (req, res) => {
    if (!guard(req, res)) return;
    try {
      const mod = require("./moderation");
      res.json({ ok: true, reports: mod.listReports() });
    } catch (e) { res.json({ ok: true, reports: [] }); }
  });

  app.post(ADMIN_PATH + "/p/report-del", json, (req, res) => {
    if (!guard(req, res)) return;
    try {
      const mod = require("./moderation");
      const id = String(req.body?.id || "");
      if (id === "*") { mod.clearReports(); note(req, "reports-clear", null, {}); }
      else { mod.removeReport(id); note(req, "report-del", id, {}); }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /** حذفٌ نهائيّ لحساب. لا رجعة فيه، فنشترط كتابة الاسم كاملًا — والفعل
   *  يُسجَّل بملخّصه (ماذا كان يملك) لأنّ الحساب نفسه لن يبقى ليُسأل. */
  app.post(ADMIN_PATH + "/p/delete-user", json, async (req, res) => {
    if (!guard(req, res)) return;
    const id = Number(req.body?.id);
    const typed = String(req.body?.confirm || "").trim();
    try {
      const u = await st().getUserById(id);
      if (!u) return res.status(404).json({ ok: false, error: "لا يوجد" });
      if (typed !== u.name) {
        note(req, "delete-blocked", id, { name: u.name, typed });
        return res.status(400).json({ ok: false, error: "اكتب اسم الحساب بالضبط للتأكيد" });
      }
      const summary = await st().deleteUser(id);
      note(req, "delete-user", id, summary || { name: u.name });
      res.json({ ok: true, summary });
    } catch (e) {
      note(req, "delete-failed", id, { error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════ سجلّ التدقيق ═══════════════

  app.get(ADMIN_PATH + "/p/audit", async (req, res) => {
    if (!guard(req, res)) return;
    try { res.json({ ok: true, log: await st().auditLog({ limit: 150 }) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════ الصفحة ═══════════════

  app.get(ADMIN_PATH + "/p", (req, res) => {
    if (!verifySession(parseCookies(req).adm))
      return res.redirect(ADMIN_PATH);
    res.type("text/html; charset=utf-8").send(page());
  });

  console.log("🎛️  لوحة الإدارة الموحّدة على " + ADMIN_PATH + "/p");
  return { note };
}

/** يُعيد تطبيق أسعار اللوحة بعد بذر الكتالوج (البذر يُرجع سعر الملفّ). */
async function applyPriceOverrides(store, log = console.log) {
  try {
    const over = await store.getSettings("prices");
    const keys = Object.keys(over || {});
    if (!keys.length) return 0;
    const rows = [];
    for (const id of keys) {
      const it = await store.getItem(id);
      if (it && it.price !== over[id]) rows.push({ ...it, key: it.key, price: over[id] });
    }
    if (rows.length) { await store.upsertItems(rows); log(`🏷️  أُعيد تطبيق ${rows.length} سعرًا من اللوحة`); }
    return rows.length;
  } catch (e) { console.error("price overrides:", e.message); return 0; }
}

function page() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>الإدارة</title><style>
*{box-sizing:border-box;font-family:system-ui,Tahoma,sans-serif;margin:0}
body{background:#0f1826;color:#e3e8ee;padding:14px;min-height:100vh;font-size:14px}
a{color:#7dd3fc}
h1{font-size:20px;margin-bottom:12px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.tab{background:#1a2740;border:1px solid #2d4160;color:#e3e8ee;padding:8px 16px;border-radius:9px;cursor:pointer;font:inherit;font-weight:700}
.tab.on{background:#3b82f6;border-color:#3b82f6}
.pane{display:none} .pane.on{display:block}
.card{background:#1a2740;border:1px solid #2d4160;border-radius:11px;padding:13px;margin-bottom:11px}
.card h2{font-size:15px;margin-bottom:9px;color:#93c5fd}
input,select,textarea{background:#0f1826;border:1px solid #2d4160;color:#e3e8ee;border-radius:7px;padding:8px 10px;font:inherit}
input[type=number]{width:110px}
button{background:#3b82f6;border:0;color:#fff;border-radius:7px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer}
button.g{background:#1f6f45} button.r{background:#a33} button.s{background:#334665}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:right;padding:6px 8px;border-bottom:1px solid #223350}
th{color:#93c5fd;font-size:12px}
tr:hover td{background:#16223a}
.muted{color:#8fa3bd;font-size:12.5px}
.pill{display:inline-block;background:#0f1826;border:1px solid #2d4160;border-radius:999px;padding:1px 9px;font-size:11.5px}
.pill.bad{background:#3a1a1a;border-color:#7f1d1d;color:#fca5a5}
.pill.ok{background:#12301f;border-color:#166534;color:#86efac}
.msg{font-size:13px;margin-top:8px;min-height:17px}
.msg.ok{color:#86efac} .msg.err{color:#fca5a5}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:9px}
.set{background:#0f1826;border:1px solid #2d4160;border-radius:9px;padding:9px}
.set b{display:block;font-size:13px;margin-bottom:3px}
.set .h{font-size:11.5px;color:#8fa3bd;line-height:1.6;margin-bottom:6px}
code{background:#0f1826;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>🎛️ الإدارة <a href="ADMIN_URL" style="font-size:13px;font-weight:400">← المراقبة</a></h1>
<div class="tabs">
  <button class="tab on" data-p="users">👥 اللاعبون</button>
  <button class="tab" data-p="sup">💬 الدعم <span id="supBadge"></span></button>
  <button class="tab" data-p="shop">🛍️ المتجر</button>
  <button class="tab" data-p="set">⚙️ الإعدادات</button>
  <button class="tab" data-p="audit">📜 السجلّ</button>
</div>

<div class="pane on" id="p-users">
  <div class="card">
    <div class="row"><input id="q" placeholder="ابحث باسم اللاعب…" style="flex:1;min-width:180px">
      <button onclick="findUsers()">بحث</button></div>
    <div id="ulist"></div>
  </div>
  <div id="udetail"></div>
</div>

<div class="pane" id="p-shop">
  <div class="card">
    <div class="row"><input id="iq" placeholder="ترشيح بالاسم أو المعرّف…" style="flex:1;min-width:180px" oninput="drawItems()">
      <span class="muted" id="icount"></span></div>
    <div id="ilist" style="max-height:70vh;overflow:auto"></div>
  </div>
</div>

<div class="pane" id="p-sup">
  <div class="card">
    <div class="row">
      <select id="tstat"><option value="open">المفتوحة</option><option value="answered">المُجابة</option>
        <option value="closed">المغلقة</option><option value="all">الكلّ</option></select>
      <button class="s" onclick="loadTickets()">تحديث</button>
      <span class="muted" id="tcount"></span></div>
    <div id="tlist"></div>
  </div>
  <div id="tview"></div>
  <div class="card"><h2>🚩 بلاغات داخل الغرف</h2>
    <div class="muted">من زرّ الإبلاغ في اللعبة. لا تُخبر اللاعب بشيء — للمراجعة فقط.</div>
    <div class="row"><button class="s" onclick="loadReports()">تحديث</button>
      <button class="r" onclick="delReport('*')">امسح الكلّ</button></div>
    <div id="rlist"></div></div>
</div>

<div class="pane" id="p-set"><div id="sets"></div></div>
<div class="pane" id="p-audit"><div class="card"><h2>آخر ١٥٠ فعلًا</h2><div id="alog"></div></div></div>

<script>
const $=s=>document.querySelector(s), B="ADMIN_URL/p";
const esc=s=>{const d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML};
const num=n=>Number(n||0).toLocaleString("ar-EG");
const when=t=>t?new Date(+t).toLocaleString("ar-EG",{dateStyle:"short",timeStyle:"short"}):"—";
const j=(u,o)=>fetch(B+u,Object.assign({credentials:"same-origin"},o||{})).then(r=>r.json());
const post=(u,b)=>j(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});

document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("on",p.id==="p-"+t.dataset.p));
  if(t.dataset.p==="shop"&&!ITEMS.length) loadItems();
  if(t.dataset.p==="set") loadSets();
  if(t.dataset.p==="audit") loadAudit();
  if(t.dataset.p==="sup"){ loadTickets(); loadReports(); }
});

/* ── اللاعبون ── */
async function findUsers(){
  const r=await j("/users?q="+encodeURIComponent($("#q").value||""));
  if(!r.ok) return $("#ulist").innerHTML='<div class="msg err">'+esc(r.error)+'</div>';
  $("#ulist").innerHTML=r.users.length?'<table><tr><th>الاسم</th><th>المعرّف</th><th>الحالة</th><th></th></tr>'+
    r.users.map(u=>'<tr><td>'+esc(u.name)+'</td><td class="muted">'+u.id+'</td><td>'+
      (u.bannedUntil&&u.bannedUntil>Date.now()?'<span class="pill bad">محظور</span>':'<span class="pill ok">نشِط</span>')+
      '</td><td><button class="s" onclick="openUser('+u.id+')">فتح</button></td></tr>').join('')+'</table>'
    :'<div class="muted">لا نتائج.</div>';
}
$("#q").addEventListener("keydown",e=>{if(e.key==="Enter")findUsers()});

let CUR=null;
async function openUser(id){
  const r=await j("/user/"+id);
  if(!r.ok) return alert(r.error);
  CUR=r;
  const u=r.user, banned=u.bannedUntil&&u.bannedUntil>Date.now();
  $("#udetail").innerHTML=
   '<div class="card"><h2>'+esc(u.name)+' <span class="muted">#'+u.id+'</span></h2>'+
     '<div class="muted">'+esc(u.email||'بلا بريد')+' · انضمّ '+when(u.created)+
     (banned?' · <span class="pill bad">محظور حتى '+when(u.bannedUntil)+(u.banReason?' — '+esc(u.banReason):'')+'</span>':'')+'</div>'+
     '<div class="row" style="margin-top:9px">'+
       '<span class="pill">🪙 '+num(r.wallet.gold)+'</span><span class="pill">💎 '+num(r.wallet.gems)+'</span>'+
       '<span class="pill">'+r.sessions.length+' جهاز</span><span class="pill">'+r.inventory.length+' عنصر</span></div>'+
   '</div>'+
   '<div class="card"><h2>هديّة أو خصم</h2>'+
     '<div class="row"><input type="number" id="gAmt" placeholder="المقدار" value="100">'+
       '<select id="gCur"><option value="gold">🪙 ذهب</option><option value="gems">💎 جواهر</option></select>'+
       '<input id="gWhy" placeholder="السبب (يُسجَّل)" style="flex:1;min-width:140px">'+
       '<button class="g" onclick="doGift(1)">منح</button><button class="r" onclick="doGift(-1)">خصم</button></div>'+
     '<div class="muted">السالب لتصحيح خطأ. كلاهما يُسجَّل في دفتر اللاعب وسجلّ التدقيق.</div>'+
     '<div class="msg" id="gMsg"></div></div>'+
   '<div class="card"><h2>الحظر والأجهزة</h2>'+
     '<div class="row"><input type="number" id="bDays" placeholder="أيام" value="'+(banned?0:3)+'">'+
       '<input id="bWhy" placeholder="السبب" style="flex:1;min-width:140px">'+
       '<button class="r" onclick="doBan()">'+(banned?'حدِّث/ارفع':'احظر')+'</button>'+
       '<button class="s" onclick="doLogout()">إخراج من كل الأجهزة</button></div>'+
     '<div class="muted">صفرٌ أو أقلّ يرفع الحظر. والحظر يُخرجه من أجهزته تلقائيًّا.</div>'+
     '<div class="msg" id="bMsg"></div></div>'+
   '<div class="card"><h2>منح عنصر</h2>'+
     '<div class="row"><input id="grItem" placeholder="مثل uno:frames:Wizard" style="flex:1;min-width:200px">'+
       '<button class="g" onclick="doGrant()">امنح</button></div>'+
     '<div class="msg" id="grMsg"></div></div>'+
   '<div class="card"><h2>الدفتر</h2>'+ledgerTable(r.ledger)+'</div>'+
   '<div class="card" style="border-color:#7f1d1d"><h2 style="color:#fca5a5">حذف نهائيّ</h2>'+
     '<div class="muted">يمحو الحساب ومحفظته ومخزونه وإحصاءاته ودفتره. لا رجعة. '+
       'تذاكره تبقى بلا صاحب لأنها قد تحمل بلاغًا عن غيره، وسطرُ الحذف يبقى في السجلّ.</div>'+
     '<div class="row"><input id="dName" placeholder="اكتب «'+esc(u.name)+'» للتأكيد" style="flex:1;min-width:160px">'+
       '<button class="r" onclick="doDelete()">احذف</button></div>'+
     '<div class="msg" id="dMsg"></div></div>'+
   (r.stats.length?'<div class="card"><h2>الإحصاءات</h2><table><tr><th>اللعبة</th><th>مباريات</th><th>فوز</th><th>نقاط</th></tr>'+
     r.stats.map(s=>'<tr><td>'+esc(s.game)+'</td><td>'+num(s.games)+'</td><td>'+num(s.wins)+'</td><td>'+num(s.score)+'</td></tr>').join('')+'</table></div>':'')+
   (r.audit.length?'<div class="card"><h2>ما فُعل به</h2>'+auditTable(r.audit)+'</div>':'');
  $("#udetail").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function ledgerTable(l){
  if(!l.length) return '<div class="muted">لا حركات.</div>';
  return '<table><tr><th>السبب</th><th>المقدار</th><th>الرصيد بعدها</th><th>متى</th></tr>'+
    l.map(x=>'<tr><td>'+esc(x.reason)+'</td><td style="color:'+(x.delta>0?'#86efac':'#fca5a5')+'">'+
      (x.delta>0?'+':'')+num(x.delta)+'</td><td>'+num(x.balanceAfter)+'</td><td class="muted">'+when(x.createdAt)+'</td></tr>').join('')+'</table>';
}
function auditTable(l){
  return '<table><tr><th>الفعل</th><th>الهدف</th><th>التفصيل</th><th>متى</th></tr>'+
    l.map(x=>'<tr><td>'+esc(x.action)+'</td><td class="muted">'+esc(x.target)+'</td>'+
      '<td class="muted"><code>'+esc(JSON.stringify(x.detail)).slice(0,120)+'</code></td>'+
      '<td class="muted">'+when(x.createdAt)+'</td></tr>').join('')+'</table>';
}
async function doGift(sign){
  const a=Math.abs(+$("#gAmt").value||0)*sign;
  const r=await post("/gift",{id:CUR.user.id,amount:a,currency:$("#gCur").value,why:$("#gWhy").value});
  say("#gMsg",r,()=>openUser(CUR.user.id));
}
async function doBan(){
  const r=await post("/ban",{id:CUR.user.id,days:+$("#bDays").value||0,reason:$("#bWhy").value});
  say("#bMsg",r,()=>openUser(CUR.user.id));
}
async function doLogout(){
  const r=await post("/logout-all",{id:CUR.user.id});
  say("#bMsg",r,()=>openUser(CUR.user.id));
}
async function doGrant(){
  const r=await post("/grant",{id:CUR.user.id,item:$("#grItem").value.trim()});
  say("#grMsg",r,()=>openUser(CUR.user.id));
}
async function doDelete(){
  const name=$("#dName").value.trim();
  if(name!==CUR.user.name) return say("#dMsg",{ok:false,error:"اكتب الاسم بالضبط"});
  if(!confirm("حذف «"+CUR.user.name+"» نهائيًّا؟ لا رجعة.")) return;
  const r=await post("/delete-user",{id:CUR.user.id,confirm:name});
  if(!r.ok) return say("#dMsg",r);
  $("#udetail").innerHTML='<div class="card"><h2>حُذف</h2><div class="muted">'+
    esc(CUR.user.name)+' — كان معه '+num(r.summary?r.summary.gold:0)+' ذهبًا و'+
    num(r.summary?r.summary.items:0)+' عنصرًا. السطر محفوظٌ في السجلّ.</div></div>';
  CUR=null; findUsers();
}
function say(sel,r,then){
  const e=$(sel); e.className="msg "+(r.ok?"ok":"err"); e.textContent=r.ok?"تمّ ✔":(r.error||"تعذّر");
  if(r.ok&&then) setTimeout(then,600);
}

/* ── المتجر ── */
let ITEMS=[];
async function loadItems(){
  const r=await j("/items"); if(!r.ok) return;
  ITEMS=r.items; drawItems();
}
function drawItems(){
  const q=($("#iq").value||"").trim();
  const rows=ITEMS.filter(i=>!q||i.name.includes(q)||i.id.includes(q));
  $("#icount").textContent=num(rows.length)+" من "+num(ITEMS.length);
  $("#ilist").innerHTML='<table><tr><th>العنصر</th><th>المعرّف</th><th>السعر</th><th>ظاهر</th></tr>'+
    rows.slice(0,400).map(i=>'<tr><td>'+esc(i.name)+'</td><td class="muted"><code>'+esc(i.id)+'</code></td>'+
      '<td><input type="number" value="'+i.price+'" style="width:92px" '+
        'onchange="setPrice(\\''+i.id+'\\',this.value,this)"></td>'+
      '<td><button class="'+(i.active?'g':'s')+'" onclick="toggleItem(\\''+i.id+'\\')">'+
        (i.active?'ظاهر':'مخفيّ')+'</button></td></tr>').join('')+'</table>';
}
async function setPrice(id,v,el){
  el.disabled=true;
  const r=await post("/item",{id,price:+v});
  el.disabled=false;
  if(!r.ok){ alert(r.error); return; }
  const it=ITEMS.find(x=>x.id===id); if(it) it.price=r.item.price;
  el.style.borderColor="#166534"; setTimeout(()=>el.style.borderColor="",900);
}
async function toggleItem(id){
  const it=ITEMS.find(x=>x.id===id); if(!it) return;
  const r=await post("/item",{id,active:!it.active});
  if(!r.ok) return alert(r.error);
  it.active=r.item.active; drawItems();
}

/* ── الإعدادات ── */
const SCOPE_NAME={economy:"💰 الاقتصاد",site:"🌐 الموقع",bet:"🎲 الرهان",
                  social:"💬 التواصل",league:"🏆 الجائزة والدوري"};
async function loadSets(){
  const r=await j("/settings"); if(!r.ok) return;
  /* لوحةُ صحّةٍ صغيرة فوق الإعدادات: المحجوز الآن. صفرٌ والموقع خالٍ = سليم،
     ورقمٌ باقٍ بلا طاولاتٍ جارية = ذهبٌ عالقٌ يحتاج نظرًا. */
  let esc0="";
  try{ const e=await j("/escrow");
    if(e.ok) esc0='<div class="card"><h2>🎲 صحّة الرهان</h2><div class="grid2">'+
      '<div class="set"><b>محجوزٌ الآن</b><div class="row"><span class="'+(e.escrow.held?"warn":"muted")+'">'+
        e.escrow.held+' صفًّا · '+e.escrow.heldGold+' ذهبًا</span></div></div>'+
      '<div class="set"><b>سُوّي سابقًا</b><div class="row"><span class="muted">'+
        e.escrow.paid+' مدفوعًا · '+e.escrow.refunded+' مردودًا</span></div></div></div>'+
      '<div class="h" style="padding:0 12px 10px">المحجوز يجب أن يوافق الطاولات الجارية؛ '+
      'وبقاؤه والموقع خالٍ يعني ذهبًا عالقًا.</div></div>';
  }catch(x){}
  $("#sets").innerHTML=esc0+Object.entries(r.settings).map(([scope,list])=>
    '<div class="card"><h2>'+(SCOPE_NAME[scope]||scope)+'</h2><div class="grid2">'+
    list.map(s=>'<div class="set"><b>'+esc(s.name)+'</b>'+
      (s.hint?'<div class="h">'+esc(s.hint)+'</div>':'')+
      (s.type==="bool"
        ? '<div class="row"><button class="'+(s.value?"g":"s")+'" onclick="setVal(\\''+scope+'\\',\\''+s.key+'\\','+(!s.value)+')">'+(s.value?"مفعَّل":"معطَّل")+'</button></div>'
        : s.type==="text"
        ? '<div class="row"><input value="'+esc(s.value)+'" style="flex:1" onchange="setVal(\\''+scope+'\\',\\''+s.key+'\\',this.value)"></div>'
        : '<div class="row"><input type="number" value="'+s.value+'" onchange="setVal(\\''+scope+'\\',\\''+s.key+'\\',+this.value)">'+
          '<span class="muted">'+s.min+'–'+s.max+' · الافتراضيّ '+s.def+'</span></div>')+
      '</div>').join('')+'</div></div>').join('');
}
async function setVal(scope,key,value){
  const r=await post("/settings",{scope,key,value});
  if(!r.ok) alert(r.error);
  loadSets();
}

/* ── الدعم ── */
let KINDS={};
const TST={open:["مفتوحة",""],answered:["أجبنا",""],closed:["مغلقة",""]};
async function loadTickets(){
  const r=await j("/tickets?status="+$("#tstat").value);
  if(!r.ok) return;
  KINDS=r.kinds||{};
  $("#supBadge").textContent=r.open?"("+num(r.open)+")":"";
  $("#tcount").textContent=num(r.tickets.length)+" تذكرة";
  $("#tlist").innerHTML=r.tickets.length?'<table><tr><th>الموضوع</th><th>النوع</th><th>من</th><th>الحالة</th><th>آخر تحديث</th><th></th></tr>'+
    r.tickets.map(t=>'<tr><td>'+esc(t.subject)+'</td><td class="muted">'+esc(KINDS[t.kind]||t.kind)+'</td>'+
      '<td>'+esc(t.name||"ضيف")+(t.userId?' <span class="muted">#'+t.userId+'</span>':'')+'</td>'+
      '<td><span class="pill">'+((TST[t.status]||["?"])[0])+'</span></td>'+
      '<td class="muted">'+when(t.updatedAt)+'</td>'+
      '<td><button class="s" onclick="openTicket('+t.id+')">فتح</button></td></tr>').join('')+'</table>'
    :'<div class="muted">لا تذاكر.</div>';
}
async function openTicket(id){
  const r=await j("/ticket/"+id);
  if(!r.ok) return alert(r.error);
  const t=r.ticket;
  $("#tview").innerHTML='<div class="card"><h2>'+esc(t.subject)+' <span class="muted">#'+t.id+'</span></h2>'+
    '<div class="muted">'+esc(KINDS[t.kind]||t.kind)+' · '+esc(t.name||"ضيف")+
      (t.userId?' · <a href="#" onclick="gotoUser('+t.userId+');return false">ملفّه</a>':' · بلا حساب')+
      ' · '+esc(t.ip||"")+' · '+when(t.createdAt)+'</div>'+
    '<div style="margin-top:10px">'+t.messages.map(m=>
      '<div class="set" style="margin-bottom:7px;border-color:'+(m.fromAdmin?"#1f6f45":"#2d4160")+'">'+
      '<b>'+(m.fromAdmin?"نحن":"هو")+' <span class="muted" style="font-weight:400">'+when(m.createdAt)+'</span></b>'+
      (m.body?'<div style="white-space:pre-wrap;line-height:1.8">'+esc(m.body)+'</div>':'')+
      ((m.images||[]).length?'<div class="row">'+m.images.map(k=>
        '<a href="/api/support/img/'+encodeURIComponent(k)+'" target="_blank" rel="noopener">'+
        '<img src="/api/support/img/'+encodeURIComponent(k)+'" style="width:84px;height:84px;object-fit:cover;'+
        'border-radius:8px;border:1px solid #2d4160"></a>').join('')+'</div>':'')+
      '</div>').join('')+'</div>'+
    '<textarea id="treply" rows="4" style="width:100%;margin-top:8px" placeholder="ردّك…"></textarea>'+
    '<div class="row"><button class="g" onclick="replyTicket('+t.id+',false)">أرسل</button>'+
      '<button onclick="replyTicket('+t.id+',true)">أرسل وأغلق</button>'+
      '<button class="s" onclick="setTicket('+t.id+',\\'closed\\')">أغلق بلا ردّ</button>'+
      '<button class="s" onclick="setTicket('+t.id+',\\'open\\')">أعِد فتحها</button></div>'+
    '<div class="msg" id="tmsg"></div></div>';
  $("#tview").scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function replyTicket(id,close){
  const b=$("#treply").value.trim();
  if(!b) return say("#tmsg",{ok:false,error:"اكتب ردًّا"});
  const r=await post("/ticket/"+id+"/reply",{body:b,close:!!close});
  say("#tmsg",r,()=>{loadTickets();openTicket(id)});
}
async function setTicket(id,status){
  const r=await post("/ticket/"+id+"/status",{status});
  say("#tmsg",r,()=>{loadTickets();openTicket(id)});
}
function gotoUser(id){
  document.querySelector('.tab[data-p=users]').click();
  openUser(id);
}
async function loadReports(){
  const r=await j("/reports");
  const l=(r&&r.reports)||[];
  $("#rlist").innerHTML=l.length?'<table><tr><th>على</th><th>من</th><th>الأسباب</th><th>اللعبة</th><th>متى</th><th></th></tr>'+
    l.map(x=>'<tr><td>'+esc(x.onName)+(x.onUser?' <span class="muted">('+esc(x.onUser)+')</span>':'')+'</td>'+
      '<td class="muted">'+esc(x.byName)+'</td><td>'+esc((x.reasons||[]).join(" · "))+'</td>'+
      '<td class="muted">'+esc(x.game)+'/'+esc(x.room)+'</td><td class="muted">'+when(x.at)+'</td>'+
      '<td><button class="s" onclick="delReport(\\''+esc(x.id)+'\\')">×</button></td></tr>').join('')+'</table>'
    :'<div class="muted">لا بلاغات.</div>';
}
async function delReport(id){
  if(id==="*"&&!confirm("مسح كل البلاغات؟")) return;
  await post("/report-del",{id}); loadReports();
}

/* ── السجلّ ── */
async function loadAudit(){
  const r=await j("/audit");
  $("#alog").innerHTML=r.ok&&r.log.length?auditTable(r.log):'<div class="muted">فارغ.</div>';
}

findUsers();
</script></body></html>`.replace(/ADMIN_URL/g, ADMIN_PATH);
}

module.exports = { setupPanel, applyPriceOverrides, GIFT_MAX, PRICE_MAX, BAN_MAX_DAYS };
