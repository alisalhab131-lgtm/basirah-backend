/**
 * fix-recursive.js
 * Adds GET /api/materials/sync/deep-find?name=INV.xlsx
 * Recursively searches every folder in your OneDrive to find the file
 * and returns its real item ID + full path.
 */
const fs = require('fs');
const path = require('path');

const SYNC_PATH   = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const ROUTES_PATH = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');

let sync = fs.readFileSync(SYNC_PATH, 'utf8');

if (!sync.includes('deepFind')) {
  sync = sync.replace(
    'module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo, findFile, listRoot };',
    `// ── List children of any folder by ID ───────────────────────────────────────
async function listChildren(folderId) {
  const t = await getToken();
  const r = await fetch(G + '/me/drive/items/' + folderId + '/children', { headers: { Authorization: 'Bearer ' + t } });
  const body = await r.json();
  if (!r.ok) throw new Error('List children failed ' + r.status + ': ' + JSON.stringify(body));
  return (body.value || []).map(f => ({ id: f.id, name: f.name, folder: !!f.folder, path: (f.parentReference ? f.parentReference.path : '') + '/' + f.name }));
}

// ── Recursively search all folders for a file by name (max depth 6) ───────
async function deepFind(filename, folderId = null, depth = 0, maxDepth = 6, foundPath = '') {
  if (depth > maxDepth) return [];
  const children = folderId ? await listChildren(folderId) : await listRoot();
  let matches = [];
  for (const item of children) {
    const itemPath = foundPath + '/' + item.name;
    if (!item.folder && item.name.toLowerCase() === filename.toLowerCase()) {
      matches.push({ id: item.id, name: item.name, path: itemPath });
    }
    if (item.folder) {
      const nested = await deepFind(filename, item.id, depth + 1, maxDepth, itemPath);
      matches = matches.concat(nested);
    }
  }
  return matches;
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo, findFile, listRoot, listChildren, deepFind };`
  );
  fs.writeFileSync(SYNC_PATH, sync);
  console.log('oneDriveSync.js: added listChildren + deepFind');
}

let routes = fs.readFileSync(ROUTES_PATH, 'utf8');

routes = routes.replace(
  /const \{ pushToOneDrive, pullFromOneDrive.*\} = require\('\.\.\/services\/oneDriveSync'\);/,
  "const { pushToOneDrive, pullFromOneDrive, listWorksheets, getFileInfo, findFile, listRoot, listChildren, deepFind } = require('../services/oneDriveSync');"
);

if (!routes.includes('sync/deep-find')) {
  routes = routes.replace(
    "router.get('/sync/find-file',",
    `router.get('/sync/deep-find', async (req, res) => {
  try {
    const name = req.query.name || 'INV.xlsx';
    const matches = await deepFind(name);
    res.json({ success: true, query: name, matches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/list-folder', async (req, res) => {
  try {
    const folderId = req.query.id;
    if (!folderId) return res.status(400).json({ error: 'Provide ?id=FOLDER_ID' });
    const items = await listChildren(folderId);
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/find-file',`
  );
  fs.writeFileSync(ROUTES_PATH, routes);
  console.log('materialRoutes.js: added /sync/deep-find and /sync/list-folder routes');
}

console.log('');
console.log('Done. Run:');
console.log('  git add -A && git commit -m "fix: add recursive deep-find for locating INV.xlsx" && git push origin main');
