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
  async getUser(name) {
    const u = this.db.users[name];
    return u ? { name, salt: u.salt, hash: u.hash, wins: u.wins, games: u.games, totalScore: u.totalScore } : null;
  }
  async createUser(name, salt, hash) {
    this.db.users[name] = { salt, hash, wins: 0, games: 0, totalScore: 0, created: Date.now() };
    this._save();
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
  async getUser(name) {
    const r = await this.pool.query(
      'SELECT name, salt, hash, wins, games, total_score AS "totalScore" FROM users WHERE name = $1', [name]);
    return r.rows[0] || null;
  }
  async createUser(name, salt, hash) {
    await this.pool.query(
      "INSERT INTO users (name, salt, hash, created) VALUES ($1, $2, $3, $4)", [name, salt, hash, Date.now()]);
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
