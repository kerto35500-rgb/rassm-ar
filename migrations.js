// 🗄️ هجرات قاعدة البيانات — تغييرُ بنيةٍ مرقَّمٌ ومُسجَّل، لا CREATE TABLE مبعثر.
//
// لماذا؟ لأن الجداول كانت تُنشأ في أماكن متفرّقة بـIF NOT EXISTS، فلا أحد يعرف
// أيّ تغييرٍ طُبِّق ولا كيف نُضيف عمودًا لاحقًا بأمان. من الآن: كل تغييرٍ خطوةٌ
// برقمٍ واسم، تُنفَّذ مرّةً واحدة وتُسجَّل في schema_migrations.
//
// القواعد:
//  • لا تُعدِّل خطوةً نُفِّذت — أضف خطوةً جديدة بعدها.
//  • كل خطوةٍ إمّا تنجح كاملةً أو تُلغى (معاملة واحدة).
//  • JsonStore (التطوير المحلّي) يُسجّل الأرقام فقط؛ فبنيته حرّة أصلًا.

const STEPS = [
  {
    id: 1,
    name: "الأساس: المستخدمون ومخزن المفاتيح والملفات الثنائية",
    async pg(q) {
      await q(`CREATE TABLE IF NOT EXISTS users (
                 name TEXT PRIMARY KEY,
                 salt TEXT NOT NULL,
                 hash TEXT NOT NULL,
                 wins INT NOT NULL DEFAULT 0,
                 games INT NOT NULL DEFAULT 0,
                 total_score INT NOT NULL DEFAULT 0,
                 created BIGINT)`);
      await q(`CREATE TABLE IF NOT EXISTS kv (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL)`);
      await q(`CREATE TABLE IF NOT EXISTS blobs (
                 key TEXT PRIMARY KEY,
                 mime TEXT NOT NULL,
                 data BYTEA NOT NULL,
                 created BIGINT)`);
    }
  },
  {
    id: 2,
    name: "حسابات: معرّف رقميّ وبريد اختياريّ وآخر ظهور ودور",
    async pg(q) {
      // معرّفٌ رقميّ ثابت: الاسم يبقى فريدًا لكنه يصير قابلًا للتغيير لاحقًا،
      // وكل الجداول القادمة (محفظة، مخزون، تذاكر) تشير إلى id لا إلى الاسم.
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at BIGINT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until BIGINT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_id_uq ON users (id)`);
      // البريد اختياريّ: الفهرس الفريد يتجاهل الفارغ (حسابٌ بلا بريدٍ مسموح)
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq
                 ON users (lower(email)) WHERE email IS NOT NULL`);
    }
  },
  {
    id: 3,
    name: "جلسات مُدارة: إبطالٌ فرديّ وخروجٌ من كل الأجهزة",
    async pg(q) {
      await q(`CREATE TABLE IF NOT EXISTS sessions (
                 id BIGSERIAL PRIMARY KEY,
                 user_id BIGINT NOT NULL,
                 token_hash TEXT NOT NULL UNIQUE,
                 ua TEXT,
                 ip TEXT,
                 created_at BIGINT NOT NULL,
                 expires_at BIGINT NOT NULL,
                 revoked_at BIGINT)`);
      await q(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`);
      await q(`CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions (expires_at)`);
    }
  },
  {
    id: 4,
    name: "كلمة السرّ بصيغةٍ قابلة للترقية (عمود pass_hash)",
    async pg(q) {
      // الأعمدة القديمة (salt/hash) تبقى للتحقّق من الحسابات السابقة حتى
      // يدخل صاحبها مرّةً فتُرقّى تجزئتُه تلقائيًّا وتُكتب هنا.
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pass_hash TEXT`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pass_changed_at BIGINT`);
    }
  },
  {
    id: 5,
    name: "إحصاءات كل لعبة تحت معرّف الحساب (game_stats)",
    async pg(q) {
      /* كانت كل لعبة تحفظ إحصاءاتها في كائنٍ واحدٍ داخل kv مفتاحُه اسم اللاعب:
         تضيع لو تغيّر الاسم، ولا تُستعلَم، وتُكتَب كاملةً مع كل مباراة.
         الآن: صفٌّ لكل (لاعب، لعبة)، والحقول العامّة مشتركة، والخاصّ في extra. */
      await q(`CREATE TABLE IF NOT EXISTS game_stats (
                 user_id BIGINT NOT NULL,
                 game TEXT NOT NULL,
                 games INT NOT NULL DEFAULT 0,
                 wins INT NOT NULL DEFAULT 0,
                 score BIGINT NOT NULL DEFAULT 0,
                 best INT NOT NULL DEFAULT 0,
                 extra JSONB NOT NULL DEFAULT '{}'::jsonb,
                 updated_at BIGINT,
                 PRIMARY KEY (user_id, game))`);
      await q(`CREATE INDEX IF NOT EXISTS game_stats_game_idx ON game_stats (game, wins DESC)`);
    }
  },
  {
    id: 6,
    name: "المحفظة ودفتر الحركات (ذهب وجواهر)",
    async pg(q) {
      /* المحفظة رصيدٌ لحظيّ، والدفتر تاريخٌ لا يُعدَّل: كل حركةٍ سطرٌ فيه
         مقدارُها وسببُها والرصيدُ بعدها. لو شكّ أحدٌ في رصيده رجعنا للسطور. */
      await q(`CREATE TABLE IF NOT EXISTS wallets (
                 user_id BIGINT PRIMARY KEY,
                 gold BIGINT NOT NULL DEFAULT 0,
                 gems BIGINT NOT NULL DEFAULT 0,
                 updated_at BIGINT,
                 CONSTRAINT wallets_no_negative CHECK (gold >= 0 AND gems >= 0))`);
      await q(`CREATE TABLE IF NOT EXISTS ledger (
                 id BIGSERIAL PRIMARY KEY,
                 user_id BIGINT NOT NULL,
                 currency TEXT NOT NULL,
                 delta BIGINT NOT NULL,
                 balance_after BIGINT NOT NULL,
                 reason TEXT NOT NULL,
                 ref_type TEXT,
                 ref_id TEXT,
                 admin_id BIGINT,
                 created_at BIGINT NOT NULL)`);
      await q(`CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (user_id, created_at DESC)`);
      /* مفتاحٌ اختياريّ لمنع تكرار المنح نفسه (نهاية مباراةٍ تُعالَج مرّتين) */
      await q(`ALTER TABLE ledger ADD COLUMN IF NOT EXISTS idem TEXT`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ledger_idem_uq ON ledger (idem) WHERE idem IS NOT NULL`);
    }
  }
];

async function migratePg(pool, log = console.log) {
  const q = (sql, args) => pool.query(sql, args);
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
             id INT PRIMARY KEY,
             name TEXT NOT NULL,
             applied_at BIGINT NOT NULL)`);
  const done = new Set((await q("SELECT id FROM schema_migrations")).rows.map(r => r.id));
  let n = 0;
  for (const s of STEPS) {
    if (done.has(s.id)) continue;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await s.pg((sql, args) => c.query(sql, args));
      await c.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1,$2,$3)",
                    [s.id, s.name, Date.now()]);
      await c.query("COMMIT");
      n++; log(`   ↳ هجرة ${s.id}: ${s.name}`);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw new Error(`فشلت الهجرة ${s.id} (${s.name}): ${e.message}`);
    } finally { c.release(); }
  }
  log(n ? `🗄️  طُبّقت ${n} هجرة (المجموع ${STEPS.length})` : `🗄️  البنية محدَّثة (${STEPS.length} هجرة)`);
  return n;
}

/* JsonStore: بنيته حرّة (كائنات في ملف)، فلا DDL — نكتفي بتسجيل الأرقام
   كي يبقى المفهوم واحدًا ونعرف من أين نُكمل لو انتقلنا إلى Postgres. */
async function migrateJson(store, log = console.log) {
  const cur = (await store.getKV("schemaVersion")) || { ids: [] };
  const ids = new Set(cur.ids || []);
  const add = STEPS.filter(s => !ids.has(s.id)).map(s => s.id);
  if (add.length) {
    add.forEach(i => ids.add(i));
    await store.saveKV("schemaVersion", { ids: [...ids].sort((a, b) => a - b), at: Date.now() });
  }
  log(`🗄️  التخزين المحلّي: ${STEPS.length} هجرة مسجَّلة`);
  return add.length;
}

module.exports = { STEPS, migratePg, migrateJson, LATEST: STEPS[STEPS.length - 1].id };
