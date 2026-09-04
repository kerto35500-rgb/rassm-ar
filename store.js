// طبقة التخزين: PostgreSQL إذا وُجد DATABASE_URL، وإلا ملف db.json محلي
const path = require("path");
const fs = require("fs");

class JsonStore {
  constructor(file) {
    this.file = file;
    this.db = { users: {} };
    try { if (fs.existsSync(file)) this.db = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("db load:", e.message); }
    this.scheduled = false;
  }
  _save() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      try { fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2)); } catch (e) { console.error("db save:", e.message); }
    }, 500);
  }
  /* الهويّة: المعرّف الرقميّ هو المرجع، والاسم مجرّد عنوانٍ فريد. الصفوف
     القديمة بلا معرّف، فنمنحها واحدًا عند أوّل قراءة. */
  _nextId() {
    const ids = Object.values(this.db.users).map(u => u.id || 0);
    return Math.max(0, ...ids) + 1;
  }
  _pub(name, u) {
    if (!u) return null;
    if (!u.id) { u.id = this._nextId(); this._save(); }
    return {
      id: u.id, name, salt: u.salt, hash: u.hash, passHash: u.passHash || null,
      email: u.email || null, emailVerifiedAt: u.emailVerifiedAt || null,
      role: u.role || "user", bannedUntil: u.bannedUntil || null, banReason: u.banReason || null,
      wins: u.wins, games: u.games, totalScore: u.totalScore, created: u.created || 0
    };
  }
  async getUser(name) { return this._pub(name, this.db.users[name]); }
  async getUserById(id) {
    const e = Object.entries(this.db.users).find(([, u]) => u.id === Number(id));
    return e ? this._pub(e[0], e[1]) : null;
  }
  async getUserByEmail(email) {
    const low = String(email || "").toLowerCase();
    const e = Object.entries(this.db.users).find(([, u]) => (u.email || "").toLowerCase() === low);
    return e ? this._pub(e[0], e[1]) : null;
  }
  async createUser(name, salt, hash, extra = {}) {
    const id = this._nextId();
    this.db.users[name] = {
      id, salt, hash, passHash: extra.passHash || null, email: extra.email || null,
      role: "user", wins: 0, games: 0, totalScore: 0, created: Date.now()
    };
    this._save();
    return id;
  }
  /* تحديثٌ انتقائيّ: نسمح بحقولٍ معلومةٍ فقط كي لا يتسرّب حقلٌ غير متوقَّع */
  async updateUser(id, fields) {
    const e = Object.entries(this.db.users).find(([, u]) => u.id === Number(id));
    if (!e) return false;
    const u = e[1];
    const ok = ["passHash", "email", "emailVerifiedAt", "lastSeenAt", "role",
                "bannedUntil", "banReason", "passChangedAt", "salt", "hash"];
    ok.forEach(k => { if (k in fields) u[k] = fields[k]; });
    this._save();
    return true;
  }

  /* ── الجلسات ── */
  async createSession(s) {
    this.db.sessions = this.db.sessions || [];
    this.db.sessions.push({ ...s, revokedAt: null });
    this._save();
  }
  async findSession(tokenHash) {
    return (this.db.sessions || []).find(x => x.tokenHash === tokenHash) || null;
  }
  async revokeSession(tokenHash) {
    const s = (this.db.sessions || []).find(x => x.tokenHash === tokenHash);
    if (s) { s.revokedAt = Date.now(); this._save(); }
  }
  async revokeUserSessions(userId) {
    (this.db.sessions || []).forEach(x => { if (x.userId === Number(userId) && !x.revokedAt) x.revokedAt = Date.now(); });
    this._save();
  }
  async listSessions(userId) {
    const now = Date.now();
    return (this.db.sessions || [])
      .filter(x => x.userId === Number(userId) && !x.revokedAt && x.expiresAt > now)
      .map(x => ({ ua: x.ua, ip: x.ip, createdAt: x.createdAt, expiresAt: x.expiresAt }));
  }
  async purgeSessions() {
    const now = Date.now();
    const before = (this.db.sessions || []).length;
    this.db.sessions = (this.db.sessions || []).filter(x => x.expiresAt > now && !x.revokedAt);
    if (before !== this.db.sessions.length) this._save();
    return before - this.db.sessions.length;
  }

  /* ── إحصاءات الألعاب ──
     صفٌّ لكل (لاعب، لعبة). الحقول العامّة مشتركة بين الألعاب، وما يخصّ لعبةً
     بعينها (كلمات القنبلة مثلًا) يذهب في extra. */
  async bumpGameStats(userId, game, { games = 0, wins = 0, score = 0, best = null, extra = null } = {}) {
    if (!userId || !game) return;
    this.db.gameStats = this.db.gameStats || {};
    const k = userId + "|" + game;
    const e = this.db.gameStats[k] || { userId: Number(userId), game, games: 0, wins: 0, score: 0, best: 0, extra: {} };
    e.games += games; e.wins += wins; e.score += score;
    if (best != null && best > e.best) e.best = best;
    if (extra) for (const x in extra) e.extra[x] = (e.extra[x] || 0) + extra[x];
    e.updatedAt = Date.now();
    this.db.gameStats[k] = e;
    this._save();
  }
  async getGameStats(userId) {
    return Object.values(this.db.gameStats || {})
      .filter(e => e.userId === Number(userId))
      .map(e => ({ game: e.game, games: e.games, wins: e.wins, score: e.score, best: e.best, extra: e.extra || {} }));
  }
  /* ── المحفظة والدفتر ──
     كل حركةٍ تُسجَّل في الدفتر مع الرصيد بعدها. الرصيد لا ينزل تحت الصفر:
     محاولة خصمٍ أكبر من الرصيد تُرفَض ولا تُسجَّل. */
  _wallet(userId) {
    this.db.wallets = this.db.wallets || {};
    return this.db.wallets[userId] || (this.db.wallets[userId] = { gold: 0, gems: 0, updatedAt: 0 });
  }
  async getWallet(userId) {
    const w = this._wallet(Number(userId));
    return { gold: w.gold, gems: w.gems };
  }
  async move(userId, currency, delta, meta = {}) {
    const uid = Number(userId);
    if (!uid || !["gold", "gems"].includes(currency) || !Number.isFinite(delta) || delta === 0)
      return { ok: false, error: "حركة غير صالحة" };
    this.db.ledger = this.db.ledger || [];
    if (meta.idem && this.db.ledger.some(x => x.idem === meta.idem))
      return { ok: false, duplicate: true, ...(await this.getWallet(uid)) };
    const w = this._wallet(uid);
    const next = w[currency] + delta;
    if (next < 0) return { ok: false, error: "الرصيد لا يكفي", balance: w[currency] };
    w[currency] = next; w.updatedAt = Date.now();
    this.db.ledger.push({
      id: this.db.ledger.length + 1, userId: uid, currency, delta, balanceAfter: next,
      reason: String(meta.reason || "—"), refType: meta.refType || null, refId: meta.refId || null,
      adminId: meta.adminId || null, idem: meta.idem || null, createdAt: Date.now()
    });
    this._save();
    return { ok: true, balance: next, ...(await this.getWallet(uid)) };
  }
  async ledgerOf(userId, n = 30) {
    return (this.db.ledger || [])
      .filter(x => x.userId === Number(userId))
      .sort((a, b) => (b.createdAt - a.createdAt) || (b.id - a.id))   /* الرقم يفصل عند تساوي اللحظة */
      .slice(0, n);
  }
  /* مجموع ما مُنح لهذا اللاعب اليوم بسببٍ بعينه — لسقف الكسب اليوميّ */
  async earnedSince(userId, since, reasonPrefix = "") {
    return (this.db.ledger || [])
      .filter(x => x.userId === Number(userId) && x.createdAt >= since && x.delta > 0 &&
                   (!reasonPrefix || String(x.reason).startsWith(reasonPrefix)))
      .reduce((a, x) => a + x.delta, 0);
  }

  /* ── المتجر: كتالوج ومخزون وتجهيز ── */
  async upsertItems(rows) {
    this.db.items = this.db.items || {};
    for (const r of rows || []) {
      const old = this.db.items[r.id];
      /* السعر والاسم يُحدَّثان من البذرة، لكن `active` قرارُ إدارةٍ فلا نلغيه */
      this.db.items[r.id] = { ...r, active: old ? old.active : (r.active !== false) };
    }
    this._save();
    return (rows || []).length;
  }
  async listItems({ game = null, kind = null, all = false } = {}) {
    return Object.values(this.db.items || {})
      .filter(i => (!game || i.game === game) && (!kind || i.kind === kind) && (all || i.active !== false))
      .sort((a, b) => a.game.localeCompare(b.game) || a.kind.localeCompare(b.kind) ||
                      (a.sort || 0) - (b.sort || 0) || a.price - b.price);
  }
  async getItem(id) { return (this.db.items || {})[id] || null; }
  async setItemActive(id, on) {
    const it = (this.db.items || {})[id];
    if (!it) return false;
    it.active = !!on; this._save(); return true;
  }
  async inventoryOf(userId) {
    return (this.db.inventory || []).filter(x => x.userId === Number(userId));
  }
  async ownsItem(userId, itemId) {
    return (this.db.inventory || []).some(x => x.userId === Number(userId) && x.itemId === itemId);
  }
  async grantItem(userId, itemId, source = "grant") {
    const uid = Number(userId);
    this.db.inventory = this.db.inventory || [];
    if (await this.ownsItem(uid, itemId)) return { ok: false, owned: true };
    this.db.inventory.push({ userId: uid, itemId, source, acquiredAt: Date.now() });
    this._save();
    return { ok: true };
  }
  /* الشراء: تملّكٌ وخصمٌ وإيصالٌ معًا. في الملفّ لا معاملات، لكن العقدة
     أحاديّة الخيط فلا يتخلّل هذه الأسطرَ شيء. */
  async buyItem(userId, item) {
    const uid = Number(userId);
    if (!uid || !item) return { ok: false, error: "عنصر غير معروف" };
    if (await this.ownsItem(uid, item.id)) return { ok: false, error: "تملكه بالفعل", owned: true };
    if (item.price > 0) {
      const res = await this.move(uid, item.currency, -item.price, {
        reason: "شراء:" + item.id, refType: "item", refId: item.id
      });
      if (!res.ok) return { ok: false, error: res.error || "تعذّر الخصم" };
    }
    this.db.inventory = this.db.inventory || [];
    this.db.purchases = this.db.purchases || [];
    this.db.inventory.push({ userId: uid, itemId: item.id, source: "buy", acquiredAt: Date.now() });
    this.db.purchases.push({ id: this.db.purchases.length + 1, userId: uid, itemId: item.id,
                             currency: item.currency, price: item.price, createdAt: Date.now() });
    this._save();
    return { ok: true, wallet: await this.getWallet(uid) };
  }
  async getLoadout(userId, game = null) {
    const out = {};
    (this.db.loadout || [])
      .filter(x => x.userId === Number(userId) && (!game || x.game === game))
      .forEach(x => { (out[x.game] = out[x.game] || {})[x.kind] = x.itemKey; });
    return game ? (out[game] || {}) : out;
  }
  async setLoadout(userId, game, kind, itemKey) {
    const uid = Number(userId);
    this.db.loadout = this.db.loadout || [];
    const row = this.db.loadout.find(x => x.userId === uid && x.game === game && x.kind === kind);
    if (row) { row.itemKey = itemKey; row.updatedAt = Date.now(); }
    else this.db.loadout.push({ userId: uid, game, kind, itemKey, updatedAt: Date.now() });
    this._save();
  }

  async topByGame(game, n = 10) {
    const users = Object.entries(this.db.users);
    return Object.values(this.db.gameStats || {})
      .filter(e => e.game === game)
      .sort((a, b) => b.wins - a.wins || b.score - a.score)
      .slice(0, n)
      .map(e => {
        const u = users.find(([, x]) => x.id === e.userId);
        return { name: u ? u[0] : "?", wins: e.wins, games: e.games, score: e.score };
      });
  }
  async addStats(name, { games = 0, score = 0, wins = 0 }) {
    const u = this.db.users[name];
    if (!u) return;
    u.games += games; u.totalScore += score; u.wins += wins;
    this._save();
  }
  async top(n) {
    return Object.entries(this.db.users)
      .map(([name, u]) => ({ name, wins: u.wins, games: u.games, totalScore: u.totalScore }))
      .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
      .slice(0, n);
  }
  async getWords() { return this.db.words || null; }
  async saveWords(obj) { this.db.words = obj; this._save(); }
  async getMetrics() { return this.db.metrics || null; }
  async saveMetrics(obj) { this.db.metrics = obj; this._save(); }
  async getKV(key) { return (this.db.kv && this.db.kv[key]) || null; }
  async saveKV(key, value) { this.db.kv = this.db.kv || {}; this.db.kv[key] = value; this._save(); }
  async countUsers() { return Object.keys(this.db.users).length; }

  // ── ملفات ثنائية (صوت الأسئلة): مجلد blobs بجانب db.json ──
  _blobDir() {
    const d = path.join(path.dirname(this.file), "blobs");
    try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    return d;
  }
  _blobPath(key) { return path.join(this._blobDir(), String(key).replace(/[^\w.-]/g, "_")); }
  async initBlobs() { this._blobDir(); }
  async init() {
    const { migrateJson } = require("./migrations");
    await migrateJson(this);
  }
  async getBlob(key) {
    try {
      const p = this._blobPath(key);
      if (!fs.existsSync(p)) return null;
      return { mime: "audio/mpeg", data: fs.readFileSync(p) };
    } catch (e) { return null; }
  }
  async putBlob(key, mime, buf) {
    try { fs.writeFileSync(this._blobPath(key), buf); } catch (e) { console.error("blob save:", e.message); }
  }
  async hasBlobs(keys) {
    return (keys || []).filter(k => { try { return fs.existsSync(this._blobPath(k)); } catch (e) { return false; } });
  }
  async delBlobs(keys) {
    let n = 0;
    for (const k of keys || []) { try { fs.unlinkSync(this._blobPath(k)); n++; } catch (e) {} }
    return n;
  }
  async blobStats(prefix = "") {
    try {
      const d = this._blobDir();
      let n = 0, bytes = 0;
      for (const f of fs.readdirSync(d)) {
        if (prefix && !f.startsWith(prefix)) continue;
        n++; bytes += fs.statSync(path.join(d, f)).size;
      }
      return { n, bytes };
    } catch (e) { return { n: 0, bytes: 0 }; }
  }
}

class PgStore {
  constructor(url) {
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 5
    });
  }
  /* البنية كلّها تأتي من migrations.js: خطواتٌ مرقَّمة تُنفَّذ مرّةً وتُسجَّل،
     بدل CREATE TABLE مبعثرٍ لا يُعرَف ما طُبّق منه.

     لماذا لا نُسقط الخادم عند فشل هجرة؟ لأن الخطوات الحالية إضافيّةٌ بحتة
     (أعمدة وجداول لا يستعملها كودٌ بعد)، فإسقاط الموقع كلّه بسببها خسارةٌ
     بلا مقابل. نُبلّغ بصوتٍ عالٍ ونُكمل بالبنية القديمة. وحين يعتمد الكود
     على خطوةٍ فعلًا، نجعل فشلها مانعًا للإقلاع. */
  async init() {
    const { migratePg } = require("./migrations");
    try {
      await migratePg(this.pool);
    } catch (e) {
      console.error("\n⚠️  " + e.message);
      console.error("⚠️  الموقع يعمل بالبنية القديمة — عالج الهجرة قبل الاعتماد عليها.\n");
    }
    this._blobsReady = true;   // جدول blobs ضمن الهجرة الأولى
  }
  async getWords() {
    const r = await this.pool.query("SELECT value FROM kv WHERE key = 'words'");
    return r.rows[0] ? JSON.parse(r.rows[0].value) : null;
  }
  async saveWords(obj) {
    await this.pool.query(
      "INSERT INTO kv (key, value) VALUES ('words', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(obj)]);
  }
  async getMetrics() {
    const r = await this.pool.query("SELECT value FROM kv WHERE key = 'metrics'");
    return r.rows[0] ? JSON.parse(r.rows[0].value) : null;
  }
  async saveMetrics(obj) {
    await this.pool.query(
      "INSERT INTO kv (key, value) VALUES ('metrics', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(obj)]);
  }
  async getKV(key) {
    const r = await this.pool.query("SELECT value FROM kv WHERE key = $1", [key]);
    return r.rows[0] ? JSON.parse(r.rows[0].value) : null;
  }
  async saveKV(key, value) {
    await this.pool.query(
      "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [key, JSON.stringify(value)]);
  }
  async countUsers() {
    const r = await this.pool.query("SELECT COUNT(*)::int AS n FROM users");
    return r.rows[0].n;
  }
  /* الحقول نفسها في الواجهتين — أسماءٌ بلغة الكود لا بلغة الجدول */
  get _userCols() {
    return `id, name, salt, hash, pass_hash AS "passHash", email,
            email_verified_at AS "emailVerifiedAt", role,
            banned_until AS "bannedUntil", ban_reason AS "banReason",
            wins, games, total_score AS "totalScore", created`;
  }
  async getUser(name) {
    const r = await this.pool.query(`SELECT ${this._userCols} FROM users WHERE name = $1`, [name]);
    return r.rows[0] || null;
  }
  async getUserById(id) {
    const r = await this.pool.query(`SELECT ${this._userCols} FROM users WHERE id = $1`, [Number(id)]);
    return r.rows[0] || null;
  }
  async getUserByEmail(email) {
    const r = await this.pool.query(
      `SELECT ${this._userCols} FROM users WHERE lower(email) = lower($1)`, [String(email)]);
    return r.rows[0] || null;
  }
  async createUser(name, salt, hash, extra = {}) {
    const r = await this.pool.query(
      "INSERT INTO users (name, salt, hash, pass_hash, email, created) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [name, salt, hash, extra.passHash || null, extra.email || null, Date.now()]);
    return r.rows[0].id;
  }
  async updateUser(id, fields) {
    const map = {
      passHash: "pass_hash", email: "email", emailVerifiedAt: "email_verified_at",
      lastSeenAt: "last_seen_at", role: "role", bannedUntil: "banned_until",
      banReason: "ban_reason", passChangedAt: "pass_changed_at", salt: "salt", hash: "hash"
    };
    const sets = [], args = [Number(id)];
    for (const k in fields) {
      if (!map[k]) continue;
      args.push(fields[k]);
      sets.push(`${map[k]} = $${args.length}`);
    }
    if (!sets.length) return false;
    const r = await this.pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, args);
    return r.rowCount > 0;
  }

  /* ── الجلسات ── */
  async createSession(s) {
    await this.pool.query(
      `INSERT INTO sessions (user_id, token_hash, ua, ip, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [Number(s.userId), s.tokenHash, s.ua, s.ip, s.createdAt, s.expiresAt]);
  }
  async findSession(tokenHash) {
    const r = await this.pool.query(
      `SELECT user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"
       FROM sessions WHERE token_hash = $1`, [tokenHash]);
    return r.rows[0] || null;
  }
  async revokeSession(tokenHash) {
    await this.pool.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash, Date.now()]);
  }
  async revokeUserSessions(userId) {
    await this.pool.query("UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
      [Number(userId), Date.now()]);
  }
  async listSessions(userId) {
    const r = await this.pool.query(
      `SELECT ua, ip, created_at AS "createdAt", expires_at AS "expiresAt"
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
       ORDER BY created_at DESC LIMIT 20`, [Number(userId), Date.now()]);
    return r.rows;
  }
  async purgeSessions() {
    const r = await this.pool.query(
      "DELETE FROM sessions WHERE expires_at < $1 OR revoked_at IS NOT NULL", [Date.now()]);
    return r.rowCount || 0;
  }

  /* ── إحصاءات الألعاب ── */
  async bumpGameStats(userId, game, { games = 0, wins = 0, score = 0, best = null, extra = null } = {}) {
    if (!userId || !game) return;
    /* صفٌّ واحدٌ ذرّيّ: الإدراج أو الزيادة في أمرٍ واحد، فلا سباق بين مباراتين */
    await this.pool.query(
      `INSERT INTO game_stats (user_id, game, games, wins, score, best, extra, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (user_id, game) DO UPDATE SET
         games = game_stats.games + EXCLUDED.games,
         wins  = game_stats.wins  + EXCLUDED.wins,
         score = game_stats.score + EXCLUDED.score,
         best  = GREATEST(game_stats.best, EXCLUDED.best),
         extra = game_stats.extra || EXCLUDED.extra,
         updated_at = EXCLUDED.updated_at`,
      [Number(userId), game, games, wins, score, best || 0, JSON.stringify(extra || {}), Date.now()]);
  }
  async getGameStats(userId) {
    const r = await this.pool.query(
      `SELECT game, games, wins, score, best, extra FROM game_stats WHERE user_id = $1`, [Number(userId)]);
    return r.rows.map(x => ({ ...x, score: Number(x.score) }));
  }
  /* ── المحفظة والدفتر ── */
  async getWallet(userId) {
    const r = await this.pool.query("SELECT gold, gems FROM wallets WHERE user_id = $1", [Number(userId)]);
    const w = r.rows[0] || { gold: 0, gems: 0 };
    return { gold: Number(w.gold), gems: Number(w.gems) };
  }
  /* معاملةٌ واحدة تقفل صفّ المحفظة: لا سباق بين مباراتين ولا شراءين */
  async move(userId, currency, delta, meta = {}) {
    const uid = Number(userId);
    if (!uid || !["gold", "gems"].includes(currency) || !Number.isFinite(delta) || delta === 0)
      return { ok: false, error: "حركة غير صالحة" };
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      if (meta.idem) {
        const dup = await c.query("SELECT 1 FROM ledger WHERE idem = $1", [meta.idem]);
        if (dup.rowCount) {
          await c.query("COMMIT");
          return { ok: false, duplicate: true, ...(await this.getWallet(uid)) };
        }
      }
      await c.query(
        `INSERT INTO wallets (user_id, gold, gems, updated_at) VALUES ($1,0,0,$2)
         ON CONFLICT (user_id) DO NOTHING`, [uid, Date.now()]);
      const cur = await c.query(`SELECT ${currency} AS v FROM wallets WHERE user_id = $1 FOR UPDATE`, [uid]);
      const before = Number(cur.rows[0].v);
      const next = before + delta;
      if (next < 0) { await c.query("ROLLBACK"); return { ok: false, error: "الرصيد لا يكفي", balance: before }; }
      await c.query(`UPDATE wallets SET ${currency} = $2, updated_at = $3 WHERE user_id = $1`,
                    [uid, next, Date.now()]);
      await c.query(
        `INSERT INTO ledger (user_id, currency, delta, balance_after, reason, ref_type, ref_id, admin_id, idem, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uid, currency, delta, next, String(meta.reason || "—"), meta.refType || null,
         meta.refId || null, meta.adminId || null, meta.idem || null, Date.now()]);
      await c.query("COMMIT");
      return { ok: true, balance: next, ...(await this.getWallet(uid)) };
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      /* تصادمُ مفتاح المنع المزدوج يعني أن الحركة سُجّلت في نداءٍ متوازٍ */
      if (/ledger_idem_uq/.test(e.message)) return { ok: false, duplicate: true, ...(await this.getWallet(uid)) };
      throw e;
    } finally { c.release(); }
  }
  async ledgerOf(userId, n = 30) {
    const r = await this.pool.query(
      `SELECT currency, delta, balance_after AS "balanceAfter", reason,
              ref_type AS "refType", ref_id AS "refId", created_at AS "createdAt"
       FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [Number(userId), n]);
    return r.rows.map(x => ({ ...x, delta: Number(x.delta), balanceAfter: Number(x.balanceAfter) }));
  }
  async earnedSince(userId, since, reasonPrefix = "") {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(delta),0) AS s FROM ledger
       WHERE user_id = $1 AND created_at >= $2 AND delta > 0 AND reason LIKE $3`,
      [Number(userId), since, (reasonPrefix || "") + "%"]);
    return Number(r.rows[0].s);
  }

  /* ── المتجر: كتالوج ومخزون وتجهيز ── */
  async upsertItems(rows) {
    if (!rows || !rows.length) return 0;
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      for (const r of rows) {
        /* لا نلمس `active`: إخفاءُ عنصرٍ قرارُ إدارةٍ لا تُلغيه إعادةُ البذر */
        await c.query(
          `INSERT INTO items (id, game, kind, item_key, name, descr, currency, price, rarity, preview, sort, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET
             name = $5, descr = $6, currency = $7, price = $8, rarity = $9, preview = $10, sort = $11`,
          [r.id, r.game, r.kind, r.key, r.name, r.descr || null, r.currency || "gold",
           r.price || 0, r.rarity || null, r.preview || null, r.sort || 0, Date.now()]);
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
    finally { c.release(); }
  }
  async listItems({ game = null, kind = null, all = false } = {}) {
    const w = [], a = [];
    if (game) { a.push(game); w.push(`game = $${a.length}`); }
    if (kind) { a.push(kind); w.push(`kind = $${a.length}`); }
    if (!all) w.push("active");
    const r = await this.pool.query(
      `SELECT id, game, kind, item_key AS key, name, descr, currency, price, rarity, preview, sort, active
       FROM items ${w.length ? "WHERE " + w.join(" AND ") : ""}
       ORDER BY game, kind, sort, price`, a);
    return r.rows.map(x => ({ ...x, price: Number(x.price) }));
  }
  async getItem(id) {
    const r = await this.pool.query(
      `SELECT id, game, kind, item_key AS key, name, descr, currency, price, rarity, preview, sort, active
       FROM items WHERE id = $1`, [id]);
    return r.rows[0] ? { ...r.rows[0], price: Number(r.rows[0].price) } : null;
  }
  async setItemActive(id, on) {
    const r = await this.pool.query("UPDATE items SET active = $2 WHERE id = $1", [id, !!on]);
    return !!r.rowCount;
  }
  async inventoryOf(userId) {
    const r = await this.pool.query(
      `SELECT item_id AS "itemId", source, acquired_at AS "acquiredAt"
       FROM inventory WHERE user_id = $1`, [Number(userId)]);
    return r.rows;
  }
  async ownsItem(userId, itemId) {
    const r = await this.pool.query(
      "SELECT 1 FROM inventory WHERE user_id = $1 AND item_id = $2", [Number(userId), itemId]);
    return !!r.rowCount;
  }
  async grantItem(userId, itemId, source = "grant") {
    const r = await this.pool.query(
      `INSERT INTO inventory (user_id, item_id, source, acquired_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, item_id) DO NOTHING`, [Number(userId), itemId, source, Date.now()]);
    return r.rowCount ? { ok: true } : { ok: false, owned: true };
  }
  /* الشراء كلّه معاملةٌ واحدة: التملّك أوّلًا (فالمفتاح المركّب يردّ الضغطة
     الثانية)، ثم الخصم بقفل صفّ المحفظة، ثم الدفتر والإيصال. لو فشل شيء
     رجع كلّ شيء — فلا عنصرٌ بلا دفعٍ ولا دفعٌ بلا عنصر. */
  async buyItem(userId, item) {
    const uid = Number(userId);
    if (!uid || !item) return { ok: false, error: "عنصر غير معروف" };
    const cur = item.currency === "gems" ? "gems" : "gold";
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const ins = await c.query(
        `INSERT INTO inventory (user_id, item_id, source, acquired_at) VALUES ($1,$2,'buy',$3)
         ON CONFLICT (user_id, item_id) DO NOTHING`, [uid, item.id, Date.now()]);
      if (!ins.rowCount) { await c.query("ROLLBACK"); return { ok: false, error: "تملكه بالفعل", owned: true }; }

      if (item.price > 0) {
        await c.query(`INSERT INTO wallets (user_id, gold, gems, updated_at) VALUES ($1,0,0,$2)
                       ON CONFLICT (user_id) DO NOTHING`, [uid, Date.now()]);
        const w = await c.query(`SELECT ${cur} AS v FROM wallets WHERE user_id = $1 FOR UPDATE`, [uid]);
        const before = Number(w.rows[0].v);
        const next = before - item.price;
        if (next < 0) { await c.query("ROLLBACK"); return { ok: false, error: "الرصيد لا يكفي", balance: before }; }
        await c.query(`UPDATE wallets SET ${cur} = $2, updated_at = $3 WHERE user_id = $1`, [uid, next, Date.now()]);
        await c.query(
          `INSERT INTO ledger (user_id, currency, delta, balance_after, reason, ref_type, ref_id, created_at)
           VALUES ($1,$2,$3,$4,$5,'item',$6,$7)`,
          [uid, cur, -item.price, next, "شراء:" + item.id, item.id, Date.now()]);
      }
      await c.query(
        `INSERT INTO purchases (user_id, item_id, currency, price, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [uid, item.id, cur, item.price || 0, Date.now()]);
      await c.query("COMMIT");
      return { ok: true, wallet: await this.getWallet(uid) };
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  async getLoadout(userId, game = null) {
    const a = [Number(userId)];
    if (game) a.push(game);
    const r = await this.pool.query(
      `SELECT game, kind, item_key AS "itemKey" FROM loadout
       WHERE user_id = $1 ${game ? "AND game = $2" : ""}`, a);
    const out = {};
    r.rows.forEach(x => { (out[x.game] = out[x.game] || {})[x.kind] = x.itemKey; });
    return game ? (out[game] || {}) : out;
  }
  async setLoadout(userId, game, kind, itemKey) {
    await this.pool.query(
      `INSERT INTO loadout (user_id, game, kind, item_key, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, game, kind) DO UPDATE SET item_key = $4, updated_at = $5`,
      [Number(userId), game, kind, itemKey, Date.now()]);
  }

  async topByGame(game, n = 10) {
    const r = await this.pool.query(
      `SELECT u.name, g.wins, g.games, g.score FROM game_stats g
       JOIN users u ON u.id = g.user_id
       WHERE g.game = $1 ORDER BY g.wins DESC, g.score DESC LIMIT $2`, [game, n]);
    return r.rows.map(x => ({ ...x, score: Number(x.score) }));
  }
  async addStats(name, { games = 0, score = 0, wins = 0 }) {
    await this.pool.query(
      "UPDATE users SET games = games + $2, total_score = total_score + $3, wins = wins + $4 WHERE name = $1",
      [name, games, score, wins]);
  }
  async top(n) {
    const r = await this.pool.query(
      'SELECT name, wins, games, total_score AS "totalScore" FROM users ORDER BY wins DESC, total_score DESC LIMIT $1', [n]);
    return r.rows;
  }

  // ── ملفات ثنائية (صوت الأسئلة): جدول blobs ──
  async initBlobs() {
    if (this._blobsReady) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blobs (
        key TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        data BYTEA NOT NULL,
        created BIGINT
      )`);
    this._blobsReady = true;
  }
  async getBlob(key) {
    await this.initBlobs();
    const r = await this.pool.query("SELECT mime, data FROM blobs WHERE key = $1", [key]);
    return r.rows[0] ? { mime: r.rows[0].mime, data: r.rows[0].data } : null;
  }
  async putBlob(key, mime, buf) {
    await this.initBlobs();
    await this.pool.query(
      "INSERT INTO blobs (key, mime, data, created) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET mime = $2, data = $3, created = $4",
      [key, mime, buf, Date.now()]);
  }
  async hasBlobs(keys) {
    await this.initBlobs();
    if (!keys || !keys.length) return [];
    const r = await this.pool.query("SELECT key FROM blobs WHERE key = ANY($1::text[])", [keys]);
    return r.rows.map(x => x.key);
  }
  async delBlobs(keys) {
    await this.initBlobs();
    if (!keys || !keys.length) return 0;
    const r = await this.pool.query("DELETE FROM blobs WHERE key = ANY($1::text[])", [keys]);
    return r.rowCount || 0;
  }
  async blobStats(prefix = "") {
    await this.initBlobs();
    const r = await this.pool.query(
      "SELECT COUNT(*)::int AS n, COALESCE(SUM(LENGTH(data)), 0)::bigint AS b FROM blobs WHERE key LIKE $1",
      [prefix + "%"]);
    return { n: r.rows[0].n, bytes: Number(r.rows[0].b) };
  }
}

async function createStore() {
  if (process.env.DATABASE_URL) {
    const s = new PgStore(process.env.DATABASE_URL);
    await s.init();
    console.log("💾 قاعدة البيانات: PostgreSQL (دائمة)");
    return s;
  }
  console.log("💾 قاعدة البيانات: ملف db.json (محلي)");
  const j = new JsonStore(path.join(__dirname, "db.json"));
  await j.init();
  return j;
}

module.exports = { createStore };
