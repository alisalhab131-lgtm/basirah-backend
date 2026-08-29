const pool = require('./db');

async function runMigrations() {
  try {
    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    console.log('[Migrate] is_deleted / deleted_at columns verified on materials + contractors');
    await pool.query('ALTER TABLE returns ADD COLUMN IF NOT EXISTS quantity INTEGER');
    await pool.query(
      'UPDATE returns r SET quantity = l.quantity FROM loans l ' +
      'WHERE r.loan_id = l.id AND r.quantity IS NULL'
    );
    console.log('[Migrate] returns.quantity column verified + backfilled');
  } catch (err) {
    console.error('[Migrate] error:', err.message);
  }
}

module.exports = { runMigrations };
