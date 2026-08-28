/**
 * fix-session.js
 * Adds:
 *   1. GET /api/materials/sync/file-info  -> confirms the ONEDRIVE_FILE_ID resolves to a real file
 *   2. Workbook session support (createSession) -> required for personal OneDrive Excel API calls
 *   3. Updates listWorksheets, pushToOneDrive, pullFromOneDrive to use the session
 */
const fs = require('fs');
const path = require('path');

const SYNC_PATH   = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const ROUTES_PATH = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');

const newSync = `const pool = require('../database/db');
let _token = null, _expiry = 0;

async function getToken() {
  if (_token && Date.now() < _expiry - 60000) return _token;
  const p = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    refresh_token: process.env.ONEDRIVE_REFRESH_TOKEN,
    scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access',
  });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', body: p });
  const j = await r.json();
  if (j.error) throw new Error(j.error_description || j.error);
  _token = j.access_token;
  _expiry = Date.now() + (j.expires_in || 3600) * 1000;
  return _token;
}

const G = 'https://graph.microsoft.com/v1.0';

function itemBase() { return '/me/drive/items/' + process.env.ONEDRIVE_FILE_ID; }

// ── Basic item check (no workbook API - just confirms the file exists) ────
async function getFileInfo() {
  const t = await getToken();
  const r = await fetch(G + itemBase(), { headers: { Authorization: 'Bearer ' + t } });
  const body = await r.json();
  if (!r.ok) throw new Error('File info failed ' + r.status + ': ' + JSON.stringify(body));
  return { name: body.name, id: body.id, webUrl: body.webUrl, size: body.size, lastModified: body.lastModifiedDateTime };
}

// ── Workbook session (required for reliable Excel API on personal OneDrive) ─
let _sessionId = null;
let _sessionExpiry = 0;

async function getSession() {
  if (_sessionId && Date.now() < _sessionExpiry - 60000) return _sessionId;
  const t = await getToken();
  const r = await fetch(G + itemBase() + '/workbook/createSession', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ persistChanges: true }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('createSession failed ' + r.status + ': ' + JSON.stringify(body));
  _sessionId = body.id;
  _sessionExpiry = Date.now() + 6 * 60000; // sessions last ~7 min, refresh at 6
  return _sessionId;
}

async function gGet(path) {
  const t = await getToken();
  const s = await getSession();
  const r = await fetch(G + path, { headers: { Authorization: 'Bearer ' + t, 'workbook-session-id': s } });
  const body = await r.text();
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status + ': ' + body);
  return JSON.parse(body);
}

async function gPatch(path, payload) {
  const t = await getToken();
  const s = await getSession();
  const r = await fetch(G + path, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + t, 'workbook-session-id': s, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  if (!r.ok) throw new Error('PATCH ' + path + ' ' + r.status + ': ' + body);
  return JSON.parse(body);
}

async function listWorksheets() {
  const data = await gGet(itemBase() + '/workbook/worksheets');
  return data.value.map(w => ({ name: w.name, id: w.id, position: w.position }));
}

const COLS = ['ID','Name','Category','In Stock','Barcode','Active Loans','Qty On Loan','Last Updated'];
function colLetter(n) { let s=''; for(n++;n>0;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+((n-1)%26))+s; return s; }
function sheetPath() { return itemBase() + '/workbook/worksheets/' + encodeURIComponent(process.env.ONEDRIVE_SHEET||'Sheet1'); }

async function pushToOneDrive() {
  const { rows } = await pool.query(
    'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +
    'COUNT(l.id) FILTER (WHERE l.status NOT IN (' + "'Returned','Cancelled'" + ')) AS active_loans, ' +
    'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (' + "'Returned','Cancelled'" + ')),0) AS qty_on_loan ' +
    'FROM materials m LEFT JOIN loans l ON l.material_id::integer = m.id GROUP BY m.id ORDER BY m.id ASC'
  );
  const now = new Date().toISOString().replace('T',' ').slice(0,16);
  const values = [COLS, ...rows.map(r=>[r.id,r.name,r.category||'',Number(r.in_stock),r.barcode||'',Number(r.active_loans),Number(r.qty_on_loan),now])];
  const rangeAddr = 'A1:' + colLetter(COLS.length - 1) + values.length;
  await gPatch(sheetPath() + "/range(address='" + rangeAddr + "')", { values });
  console.log('[OneDrive] Pushed ' + rows.length + ' rows');
  return { pushed: rows.length };
}

async function pullFromOneDrive() {
  const data = await gGet(sheetPath() + '/usedRange');
  const all = data.values;
  if (!all || all.length < 2) return { pulled: 0, upserted: 0, created: 0, skipped: 0 };
  const h = all[0].map(x => String(x).trim().toLowerCase());
  const nc = h.indexOf('name'), ic = h.indexOf('id'), cc = h.indexOf('category'), qc = h.indexOf('in stock'), bc = h.indexOf('barcode');
  if (nc === -1) throw new Error('No Name column. Headers: ' + h.join(', '));
  const dataRows = all.slice(1).filter(r => String(r[nc] || '').trim());
  const client = await pool.connect();
  let upserted = 0, created = 0, skipped = 0;
  try {
    await client.query('BEGIN');
    for (const row of dataRows) {
      const eid = row[ic] ? Number(row[ic]) : null;
      const name = String(row[nc] || '').trim();
      const category = String(row[cc] || '').trim() || 'General';
      const rawQty = parseInt(row[qc], 10);
      const quantity = isNaN(rawQty) || rawQty < 0 ? 0 : rawQty;
      const barcode = String(row[bc] || '').trim();
      if (!name) { skipped++; continue; }
      if (eid) {
        const { rowCount } = await client.query('UPDATE materials SET name=$1,category=$2,quantity=$3,barcode=$4 WHERE id=$5', [name, category, quantity, barcode || null, eid]);
        if (rowCount) { upserted++; continue; }
      }
      const { rows: ex } = await client.query('SELECT id FROM materials WHERE LOWER(name)=LOWER($1) LIMIT 1', [name]);
      if (ex.length) { await client.query('UPDATE materials SET category=$1,quantity=$2 WHERE id=$3', [category, quantity, ex[0].id]); upserted++; }
      else { const b = barcode || 'BR-' + Math.floor(100000 + Math.random() * 900000); await client.query('INSERT INTO materials (name,category,quantity,barcode) VALUES ($1,$2,$3,$4)', [name, category, quantity, b]); created++; }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  console.log('[OneDrive] Pull: ' + upserted + ' updated, ' + created + ' created, ' + skipped + ' skipped');
  return { pulled: upserted + created, upserted, created, skipped };
}

function startSyncLoop() {
  if (!process.env.ONEDRIVE_REFRESH_TOKEN) { console.log('[OneDrive] Disabled - no refresh token'); return; }
  const ms = parseInt(process.env.ONEDRIVE_SYNC_INTERVAL || '5', 10) * 60000;
  const run = async (d) => { try { if (d === 'pull') await pullFromOneDrive(); if (d === 'push') await pushToOneDrive(); } catch (e) { console.error('[OneDrive] ' + d + ':', e.message); } };
  setTimeout(() => run('pull'), 5000); setTimeout(() => run('push'), 12000); setInterval(() => run('pull'), ms);
  console.log('[OneDrive] Sync every ' + (ms / 60000) + ' min');
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets, getFileInfo };
`;

fs.writeFileSync(SYNC_PATH, newSync);
console.log('oneDriveSync.js rewritten with session support');

// ── Add /sync/file-info route ────────────────────────────────────────────
let routes = fs.readFileSync(ROUTES_PATH, 'utf8');

routes = routes.replace(
  /const \{ pushToOneDrive, pullFromOneDrive.*\} = require\('\.\.\/services\/oneDriveSync'\);/,
  "const { pushToOneDrive, pullFromOneDrive, listWorksheets, getFileInfo } = require('../services/oneDriveSync');"
);

if (!routes.includes('sync/file-info')) {
  routes = routes.replace(
    "router.get('/sync/sheets',",
    `router.get('/sync/file-info', async (req, res) => {
  try { const info = await getFileInfo(); res.json({ success: true, info }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/sheets',`
  );
}

fs.writeFileSync(ROUTES_PATH, routes);
console.log('materialRoutes.js: added /sync/file-info route');
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: add workbook session support + file-info diagnostic" && git push origin main');
