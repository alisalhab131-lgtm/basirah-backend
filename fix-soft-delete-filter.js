/**
 * fix-soft-delete-filter.js
 * Run from backend folder: node fix-soft-delete-filter.js
 *
 * 1. Adds src/database/migrate.js - idempotent column migration, safe to run every startup
 * 2. Wires it into server.js so it runs before the app starts
 * 3. Filters is_deleted materials/contractors OUT of getMaterials, exportMaterials, getContractors
 * 4. Filters them out of the OneDrive push query too, so archived items stop appearing in Excel
 */
const fs = require('fs');
const path = require('path');

const MIGRATE_PATH      = path.join(__dirname, 'src', 'database', 'migrate.js');
const SERVER_PATH       = path.join(__dirname, 'src', 'server.js');
const MAT_CONTROLLER    = path.join(__dirname, 'src', 'controllers', 'materialController.js');
const CON_CONTROLLER    = path.join(__dirname, 'src', 'controllers', 'contractorController.js');
const SYNC_PATH         = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');

// ============================================================
// 1. migrate.js — idempotent, safe to run on every boot
// ============================================================
const migrate =
  "const pool = require('./db');\n\n" +
  "async function runMigrations() {\n" +
  "  try {\n" +
  "    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');\n" +
  "    await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');\n" +
  "    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE');\n" +
  "    await pool.query('ALTER TABLE contractors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');\n" +
  "    console.log('[Migrate] is_deleted / deleted_at columns verified on materials + contractors');\n" +
  "  } catch (err) {\n" +
  "    console.error('[Migrate] error:', err.message);\n" +
  "  }\n" +
  "}\n\n" +
  "module.exports = { runMigrations };\n";

fs.writeFileSync(MIGRATE_PATH, migrate);
console.log('Created src/database/migrate.js');

// ============================================================
// 2. Wire into server.js
// ============================================================
let server = fs.readFileSync(SERVER_PATH, 'utf8');

if (!server.includes('runMigrations')) {
  server = server.replace(
    "require('./database/db');",
    "require('./database/db');\nconst { runMigrations } = require('./database/migrate');\nrunMigrations();"
  );
  fs.writeFileSync(SERVER_PATH, server);
  console.log('server.js: wired in runMigrations()');
} else {
  console.log('server.js: runMigrations already wired, skipping');
}

// ============================================================
// 3. Filter is_deleted out of getMaterials + exportMaterials
// ============================================================
let mc = fs.readFileSync(MAT_CONTROLLER, 'utf8');

mc = mc.replace(
  "await pool.query('SELECT * FROM materials ORDER BY id DESC')",
  "await pool.query(\"SELECT * FROM materials WHERE is_deleted IS NOT TRUE ORDER BY id DESC\")"
);

mc = mc.replace(
  "FROM materials m LEFT JOIN loans l ON l.material_id=m.id\n      GROUP BY m.id ORDER BY m.name ASC",
  "FROM materials m LEFT JOIN loans l ON l.material_id=m.id\n      WHERE m.is_deleted IS NOT TRUE\n      GROUP BY m.id ORDER BY m.name ASC"
);

fs.writeFileSync(MAT_CONTROLLER, mc);
console.log('materialController.js: filtered is_deleted from getMaterials + exportMaterials');

// ============================================================
// 4. Filter is_deleted out of getContractors
// ============================================================
let cc = fs.readFileSync(CON_CONTROLLER, 'utf8');

cc = cc.replace(
  "await pool.query('SELECT * FROM contractors ORDER BY id DESC')",
  "await pool.query(\"SELECT * FROM contractors WHERE is_deleted IS NOT TRUE ORDER BY id DESC\")"
);

fs.writeFileSync(CON_CONTROLLER, cc);
console.log('contractorController.js: filtered is_deleted from getContractors');

// ============================================================
// 5. Filter is_deleted from OneDrive push query
// ============================================================
let sync = fs.readFileSync(SYNC_PATH, 'utf8');

sync = sync.replace(
  "FROM materials m LEFT JOIN loans l ON l.material_id::integer = m.id GROUP BY m.id ORDER BY m.id ASC",
  "FROM materials m LEFT JOIN loans l ON l.material_id::integer = m.id WHERE m.is_deleted IS NOT TRUE GROUP BY m.id ORDER BY m.id ASC"
);

fs.writeFileSync(SYNC_PATH, sync);
console.log('oneDriveSync.js: filtered is_deleted from push query');

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const mcFinal = fs.readFileSync(MAT_CONTROLLER, 'utf8');
const ccFinal = fs.readFileSync(CON_CONTROLLER, 'utf8');
const syncFinal = fs.readFileSync(SYNC_PATH, 'utf8');
const serverFinal = fs.readFileSync(SERVER_PATH, 'utf8');

console.log('materialController filters is_deleted:', mcFinal.includes('is_deleted IS NOT TRUE'));
console.log('contractorController filters is_deleted:', ccFinal.includes('is_deleted IS NOT TRUE'));
console.log('oneDriveSync filters is_deleted:', syncFinal.includes('is_deleted IS NOT TRUE'));
console.log('server.js runs migrations:', serverFinal.includes('runMigrations'));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: soft-deleted items hidden from active lists + auto migration" && git push origin main');
