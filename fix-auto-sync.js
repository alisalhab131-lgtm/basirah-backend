/**
 * fix-auto-sync.js
 * Run from backend folder: node fix-auto-sync.js
 *
 * 1. Adds push to the recurring interval too (was pull-only before)
 * 2. Adds GET /api/materials/sync/heartbeat - a single endpoint that does
 *    pull + push together. This is meant to be hit by an EXTERNAL cron
 *    service (cron-job.org, free) every 1-5 min, which:
 *      a) Keeps the Render service awake (any incoming request resets
 *         the free-tier inactivity timer)
 *      b) Guarantees sync actually runs on schedule regardless of
 *         whether Render's own internal timers survived a sleep cycle
 */
const fs = require('fs');
const path = require('path');

const SYNC_PATH   = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const ROUTES_PATH = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');

// ============================================================
// 1. Fix startSyncLoop to also push on the interval
// ============================================================
let sync = fs.readFileSync(SYNC_PATH, 'utf8');

const oldLoop =
  "function startSyncLoop() {\n" +
  "  if (!process.env.ONEDRIVE_REFRESH_TOKEN) { console.log('[OneDrive] Disabled - no refresh token'); return; }\n" +
  "  const ms = parseInt(process.env.ONEDRIVE_SYNC_INTERVAL || '5', 10) * 60000;\n" +
  "  const run = async (d) => { try { if (d === 'pull') await pullFromOneDrive(); if (d === 'push') await pushToOneDrive(); } catch (e) { console.error('[OneDrive] ' + d + ':', e.message); } };\n" +
  "  setTimeout(() => run('pull'), 5000); setTimeout(() => run('push'), 12000); setInterval(() => run('pull'), ms);\n" +
  "  console.log('[OneDrive] Sync every ' + (ms / 60000) + ' min');\n" +
  "}";

const newLoop =
  "function startSyncLoop() {\n" +
  "  if (!process.env.ONEDRIVE_REFRESH_TOKEN) { console.log('[OneDrive] Disabled - no refresh token'); return; }\n" +
  "  const ms = parseInt(process.env.ONEDRIVE_SYNC_INTERVAL || '5', 10) * 60000;\n" +
  "  const run = async (d) => { try { if (d === 'pull') await pullFromOneDrive(); if (d === 'push') await pushToOneDrive(); } catch (e) { console.error('[OneDrive] ' + d + ':', e.message); } };\n" +
  "  setTimeout(() => run('pull'), 5000);\n" +
  "  setTimeout(() => run('push'), 12000);\n" +
  "  // Both directions now run on the recurring interval, not just pull\n" +
  "  setInterval(async () => { await run('pull'); await run('push'); }, ms);\n" +
  "  console.log('[OneDrive] Sync every ' + (ms / 60000) + ' min (both directions)');\n" +
  "}";

if (sync.includes(oldLoop)) {
  sync = sync.replace(oldLoop, newLoop);
  console.log('oneDriveSync.js: startSyncLoop now runs push on interval too');
} else {
  console.log('oneDriveSync.js: exact startSyncLoop text not matched, trying loose replace...');
  sync = sync.replace(
    /function startSyncLoop\(\) \{[\s\S]*?\n\}/,
    newLoop
  );
  console.log('oneDriveSync.js: startSyncLoop replaced via regex fallback');
}

// Add a combined heartbeat function
if (!sync.includes('async function heartbeat')) {
  sync = sync.replace(
    'module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo, findFile, listRoot, listChildren, deepFind };',
    'async function heartbeat() {\n' +
    '  const pullResult = await pullFromOneDrive().catch(e => ({ error: e.message }));\n' +
    '  const pushResult = await pushToOneDrive().catch(e => ({ error: e.message }));\n' +
    '  return { pull: pullResult, push: pushResult, timestamp: new Date().toISOString() };\n' +
    '}\n\n' +
    'module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo, findFile, listRoot, listChildren, deepFind, heartbeat };'
  );
  console.log('oneDriveSync.js: added heartbeat() function');
}

fs.writeFileSync(SYNC_PATH, sync);

// ============================================================
// 2. Add GET /api/materials/sync/heartbeat route
// ============================================================
let routes = fs.readFileSync(ROUTES_PATH, 'utf8');

routes = routes.replace(
  /const \{ pushToOneDrive, pullFromOneDrive.*\} = require\('\.\.\/services\/oneDriveSync'\);/,
  "const { pushToOneDrive, pullFromOneDrive, heartbeat } = require('../services/oneDriveSync');"
);

if (!routes.includes('sync/heartbeat')) {
  routes = routes.replace(
    "router.post('/sync/push',",
    "router.get('/sync/heartbeat', async (req, res) => {\n" +
    "  try { const result = await heartbeat(); res.json({ success: true, ...result }); }\n" +
    "  catch (err) { res.status(500).json({ error: err.message }); }\n" +
    "});\n\n" +
    "router.post('/sync/push',"
  );
  fs.writeFileSync(ROUTES_PATH, routes);
  console.log('materialRoutes.js: added GET /sync/heartbeat route');
} else {
  console.log('materialRoutes.js: /sync/heartbeat already present');
}

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const syncFinal = fs.readFileSync(SYNC_PATH, 'utf8');
const routesFinal = fs.readFileSync(ROUTES_PATH, 'utf8');
console.log('startSyncLoop runs push on interval:', syncFinal.includes("await run('push')"));
console.log('heartbeat function exists:', syncFinal.includes('async function heartbeat'));
console.log('heartbeat route exists:', routesFinal.includes('sync/heartbeat'));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: push+pull both on interval, add heartbeat endpoint for external cron" && git push origin main');
