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
