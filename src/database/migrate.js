const pool = require('./db');

async function runMigrations() {
  try {
    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    console.log('[Migrate] is_deleted / deleted_at columns verified on materials + contractors');
  } catch (err) {
    console.error('[Migrate] error:', err.message);
  }
}

module.exports = { runMigrations };
