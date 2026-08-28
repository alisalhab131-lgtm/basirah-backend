/**
 * fix-resolve.js
 * Adds GET /api/materials/sync/find-file?name=INV.xlsx
 * which searches your OneDrive by filename and returns the REAL item ID
 * (bypasses needing to parse share links at all)
 */
const fs = require('fs');
const path = require('path');

const SYNC_PATH   = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const ROUTES_PATH = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');

let sync = fs.readFileSync(SYNC_PATH, 'utf8');

if (!sync.includes('findFile')) {
  sync = sync.replace(
    'module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo };',
    `// ── Find a file by name anywhere in OneDrive (returns real item ID) ────────
async function findFile(filename) {
  const t = await getToken();
  const r = await fetch(
    G + "/me/drive/root/search(q='" + encodeURIComponent(filename) + "')",
    { headers: { Authorization: 'Bearer ' + t } }
  );
  const body = await r.json();
  if (!r.ok) throw new Error('Search failed ' + r.status + ': ' + JSON.stringify(body));
  return (body.value || []).map(f => ({
    id: f.id, name: f.name, webUrl: f.webUrl,
    parentPath: f.parentReference ? f.parentReference.path : null,
  }));
}

// ── List root folder contents (fallback if search finds nothing) ───────────
async function listRoot() {
  const t = await getToken();
  const r = await fetch(G + '/me/drive/root/children', { headers: { Authorization: 'Bearer ' + t } });
  const body = await r.json();
  if (!r.ok) throw new Error('List root failed ' + r.status + ': ' + JSON.stringify(body));
  return (body.value || []).map(f => ({ id: f.id, name: f.name, folder: !!f.folder }));
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo, findFile, listRoot };`
  );
  fs.writeFileSync(SYNC_PATH, sync);
  console.log('oneDriveSync.js: added findFile + listRoot');
}

let routes = fs.readFileSync(ROUTES_PATH, 'utf8');

routes = routes.replace(
  /const \{ pushToOneDrive, pullFromOneDrive.*\} = require\('\.\.\/services\/oneDriveSync'\);/,
  "const { pushToOneDrive, pullFromOneDrive, listWorksheets, getFileInfo, findFile, listRoot } = require('../services/oneDriveSync');"
);

if (!routes.includes('sync/find-file')) {
  routes = routes.replace(
    "router.get('/sync/file-info',",
    `router.get('/sync/find-file', async (req, res) => {
  try {
    const name = req.query.name || 'INV.xlsx';
    const results = await findFile(name);
    res.json({ success: true, query: name, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/root', async (req, res) => {
  try { const items = await listRoot(); res.json({ success: true, items }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/file-info',`
  );
  fs.writeFileSync(ROUTES_PATH, routes);
  console.log('materialRoutes.js: added /sync/find-file and /sync/root routes');
}

console.log('');
console.log('Done. Run:');
console.log('  git add -A && git commit -m "fix: add find-file and list-root diagnostics" && git push origin main');
