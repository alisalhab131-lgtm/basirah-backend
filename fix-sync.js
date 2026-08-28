/**
 * fix-sync.js
 * 1. Fixes the double-quote bug in the range address (Graph API needs single quotes)
 * 2. Adds a /api/materials/sync/sheets diagnostic route to list real worksheet names
 */
const fs = require('fs');
const path = require('path');

const SYNC_PATH   = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const ROUTES_PATH = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');

// ── Fix oneDriveSync.js: replace JSON.stringify quote bug ──────────────────
let sync = fs.readFileSync(SYNC_PATH, 'utf8');

const before = sync;

// Replace the buggy address-building line (double quotes) with single-quote version
sync = sync.replace(
  /await gPatch\(sheetPath\(\)\+'\/range\(address='\+JSON\.stringify\('A1:'\+colLetter\(COLS\.length-1\)\+values\.length\)\+'\)', \{ values \}\);/,
  "const rangeAddr = 'A1:' + colLetter(COLS.length - 1) + values.length;\n  await gPatch(sheetPath() + \"/range(address='\" + rangeAddr + \"')\", { values });"
);

// Add a listWorksheets function for diagnostics
if (!sync.includes('listWorksheets')) {
  sync = sync.replace(
    'module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop };',
    `async function listWorksheets() {
  const data = await gGet('/me/drive/items/' + process.env.ONEDRIVE_FILE_ID + '/workbook/worksheets');
  return data.value.map(w => ({ name: w.name, id: w.id, position: w.position }));
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets };`
  );
}

fs.writeFileSync(SYNC_PATH, sync);
console.log('oneDriveSync.js changed:', before !== sync);

// ── Add diagnostic route ────────────────────────────────────────────────────
let routes = fs.readFileSync(ROUTES_PATH, 'utf8');

if (!routes.includes('sync/sheets')) {
  routes = routes.replace(
    "const { pushToOneDrive, pullFromOneDrive } = require('../services/oneDriveSync');",
    "const { pushToOneDrive, pullFromOneDrive, listWorksheets } = require('../services/oneDriveSync');"
  );

  routes = routes.replace(
    "router.get('/export', exportMaterials);",
    `router.get('/export', exportMaterials);

router.get('/sync/sheets', async (req, res) => {
  try { const sheets = await listWorksheets(); res.json({ success: true, sheets }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});`
  );

  fs.writeFileSync(ROUTES_PATH, routes);
  console.log('materialRoutes.js: added /sync/sheets diagnostic route');
} else {
  console.log('materialRoutes.js: /sync/sheets already present');
}

console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: single-quote range address + add sheets diagnostic" && git push origin main');
