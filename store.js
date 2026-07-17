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
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        name TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        wins INT NOT NULL DEFAULT 0,
        games INT NOT NULL DEFAULT 0,
        total_score INT NOT NULL DEFAULT 0,
        created BIGINT
      )`);
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
}

async function createStore() {
  if (process.env.DATABASE_URL) {
    const s = new PgStore(process.env.DATABASE_URL);
    await s.init();
    console.log("💾 قاعدة البيانات: PostgreSQL (دائمة)");
    return s;
  }
  console.log("💾 قاعدة البيانات: ملف db.json (محلي)");
  return new JsonStore(path.join(__dirname, "db.json"));
}

module.exports = { createStore };
