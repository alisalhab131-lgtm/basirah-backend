/**
 * src/services/oneDriveSync.js
 *
 * Live two-way sync with your OneDrive INV.xlsx file.
 * Uses Microsoft Graph API — no file download needed, reads/writes cells directly.
 *
 * HOW IT WORKS:
 *  - pushToOneDrive()  → reads DB → writes every material row into the Excel sheet live
 *  - pullFromOneDrive()→ reads the Excel sheet → upserts rows into DB
 *  - startSyncLoop()   → polls every POLL_MINUTES, auto-called on server start
 *
 * SETUP (one-time, 5 minutes):
 *  1. Go to https://portal.azure.com → App registrations → New registration
 *     Name: "Basirah Sync" | Accounts: "Personal Microsoft accounts only"
 *  2. After creation → Certificates & secrets → New client secret → copy the Value
 *  3. API Permissions → Add → Microsoft Graph → Delegated →
 *       Files.ReadWrite  (to read/write the OneDrive file)
 *     → Grant admin consent
 *  4. Overview → copy Application (client) ID and Directory (tenant) ID
 *  5. Add these to your Render environment variables:
 *       AZURE_CLIENT_ID=...
 *       AZURE_CLIENT_SECRET=...
 *       AZURE_TENANT_ID=consumers   ← use "consumers" for personal OneDrive
 *       ONEDRIVE_FILE_ID=2722ba2f39e89f2f  ← from your share link URL
 *       ONEDRIVE_SHEET=Sheet1              ← tab name inside INV.xlsx
 *       SYNC_POLL_MINUTES=5                ← how often to auto-pull
 */

const pool = require('../database/db');

// ── Auth token cache ──────────────────────────────────────────────────────────
let _cachedToken = null;
let _tokenExpiry  = 0;

async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OneDrive auth failed: ${txt}`);
  }

  const json = await res.json();
  _cachedToken = json.access_token;
  _tokenExpiry  = Date.now() + json.expires_in * 1000;
  return _cachedToken;
}

// ── Graph API helpers ─────────────────────────────────────────────────────────
const FILE_ID    = () => process.env.ONEDRIVE_FILE_ID;
const SHEET_NAME = () => encodeURIComponent(process.env.ONEDRIVE_SHEET || 'Sheet1');
const GRAPH      = 'https://graph.microsoft.com/v1.0';

async function graphGet(path) {
  const token = await getToken();
  const res   = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function graphPatch(path, body) {
  const token = await getToken();
  const res   = await fetch(`${GRAPH}${path}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Graph PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Column layout in INV.xlsx ─────────────────────────────────────────────────
// Must match your actual Excel sheet header row exactly.
// If your sheet has different headers, update this list.
const EXCEL_COLS = ['ID', 'Name', 'Category', 'In Stock', 'Barcode', 'Active Loans', 'Qty On Loan', 'Last Updated'];
const COL_COUNT  = EXCEL_COLS.length;

// Convert column index (0-based) to Excel letter: 0→A, 1→B, 25→Z, 26→AA
function colLetter(n) {
  let s = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const LAST_COL = colLetter(COL_COUNT - 1); // e.g. "H"

// ── PUSH: DB → Excel (write all materials to the sheet) ──────────────────────
async function pushToOneDrive() {
  // 1. Fetch latest data from DB (materials + active loan counts)
  const { rows } = await pool.query(`
    SELECT
      m.id,
      m.name,
      m.category,
      m.quantity                                                         AS in_stock,
      m.barcode,
      COUNT(l.id) FILTER (WHERE l.status NOT IN ('Returned','Cancelled')) AS active_loans,
      COALESCE(
        SUM(l.quantity) FILTER (WHERE l.status NOT IN ('Returned','Cancelled')), 0
      )                                                                   AS qty_on_loan
    FROM materials m
    LEFT JOIN loans l ON l.material_id = m.id
    GROUP BY m.id
    ORDER BY m.id ASC
  `);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  // 2. Build the 2D values array (header row + one row per material)
  const values = [
    EXCEL_COLS,
    ...rows.map(r => [
      r.id,
      r.name,
      r.category || '',
      Number(r.in_stock),
      r.barcode || '',
      Number(r.active_loans),
      Number(r.qty_on_loan),
      now,
    ]),
  ];

  // 3. Write to the sheet — clear old data first, then write
  const totalRows    = values.length;
  const rangeAddress = `A1:${LAST_COL}${totalRows}`;

  await graphPatch(
    `/me/drive/items/${FILE_ID()}/workbook/worksheets/${SHEET_NAME()}/range(address='${rangeAddress}')`,
    { values }
  );

  console.log(`[OneDrive] ✅ Pushed ${rows.length} materials to INV.xlsx`);
  return { pushed: rows.length };
}

// ── PULL: Excel → DB (read the sheet, upsert into DB) ────────────────────────
async function pullFromOneDrive() {
  // 1. Read the used range from Excel
  const data = await graphGet(
    `/me/drive/items/${FILE_ID()}/workbook/worksheets/${SHEET_NAME()}/usedRange`
  );

  const allRows = data.values;
  if (!allRows || allRows.length < 2) {
    console.log('[OneDrive] Sheet is empty or has only a header — nothing to pull.');
    return { pulled: 0 };
  }

  // 2. Map header → column index
  const header   = allRows[0].map(h => String(h).trim().toLowerCase());
  const col      = (name) => header.indexOf(name);
  const iCol     = col('id');
  const nameCol  = col('name');
  const catCol   = col('category');
  const qtyCol   = col('in stock');
  const barCol   = col('barcode');

  if (nameCol === -1) {
    throw new Error(`[OneDrive] No "Name" column found in sheet. Headers: ${header.join(', ')}`);
  }

  const dataRows = allRows.slice(1).filter(r => String(r[nameCol] || '').trim());

  // 3. Upsert each row
  const client = await pool.connect();
  let upserted = 0, created = 0, skipped = 0;

  try {
    await client.query('BEGIN');

    for (const row of dataRows) {
      const excelId   = row[iCol]   ? Number(row[iCol])               : null;
      const name      = String(row[nameCol] || '').trim();
      const category  = String(row[catCol]  || '').trim() || 'General';
      const quantity  = parseInt(row[qtyCol], 10);
      const barcode   = String(row[barCol]  || '').trim();

      if (!name) { skipped++; continue; }
      const safeQty = isNaN(quantity) || quantity < 0 ? 0 : quantity;

      if (excelId) {
        // Row has an ID → update that exact material (if it still exists in DB)
        const { rowCount } = await client.query(
          `UPDATE materials
           SET name=$1, category=$2, quantity=$3, barcode=$4
           WHERE id=$5`,
          [name, category, safeQty, barcode || null, excelId]
        );
        if (rowCount) { upserted++; continue; }
      }

      // No ID or ID not found → check by name, else create
      const { rows: existing } = await client.query(
        `SELECT id FROM materials WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]
      );

      if (existing.length) {
        await client.query(
          `UPDATE materials SET category=$1, quantity=$2 WHERE id=$3`,
          [category, safeQty, existing[0].id]
        );
        upserted++;
      } else {
        const newBarcode = barcode || `BR-${Math.floor(100000 + Math.random() * 900000)}`;
        await client.query(
          `INSERT INTO materials (name, category, quantity, barcode) VALUES ($1,$2,$3,$4)`,
          [name, category, safeQty, newBarcode]
        );
        created++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`[OneDrive] ✅ Pull complete — ${upserted} updated, ${created} created, ${skipped} skipped`);
  return { pulled: upserted + created, upserted, created, skipped };
}

// ── Auto sync loop ────────────────────────────────────────────────────────────
// Called once from server.js. Pulls on start, then every SYNC_POLL_MINUTES minutes.
function startSyncLoop() {
  const minutes = parseInt(process.env.SYNC_POLL_MINUTES || '5', 10);
  const ms      = minutes * 60_000;

  const run = async (direction) => {
    if (!process.env.AZURE_CLIENT_ID) {
      // Silently skip if not configured (dev without env vars)
      return;
    }
    try {
      if (direction === 'pull') await pullFromOneDrive();
      if (direction === 'push') await pushToOneDrive();
    } catch (err) {
      console.error(`[OneDrive] Sync error (${direction}):`, err.message);
    }
  };

  // On startup: pull first (Excel is source of truth), then push to confirm
  setTimeout(() => run('pull'), 3000);
  setTimeout(() => run('push'), 8000);

  // Then poll
  setInterval(() => run('pull'), ms);
  console.log(`[OneDrive] Sync loop started — polling every ${minutes} minutes`);
}

module.exports = {
  pushToOneDrive,
  pullFromOneDrive,
  startSyncLoop,
};
