const pool = require('../database/db');
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
async function gGet(path) {
  const t = await getToken();
  const r = await fetch(G + path, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status + ': ' + await r.text());
  return r.json();
}
async function gPatch(path, body) {
  const t = await getToken();
  const r = await fetch(G + path, { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('PATCH ' + path + ' ' + r.status + ': ' + await r.text());
  return r.json();
}

const COLS = ['ID','Name','Category','In Stock','Barcode','Active Loans','Qty On Loan','Last Updated'];
function colLetter(n) { let s=''; for(n++;n>0;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+((n-1)%26))+s; return s; }
function sheetPath() { return '/me/drive/items/'+process.env.ONEDRIVE_FILE_ID+'/workbook/worksheets/'+encodeURIComponent(process.env.ONEDRIVE_SHEET||'Sheet1'); }

async function pushToOneDrive() {
  const { rows } = await pool.query(
    'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +
    'COUNT(l.id) FILTER (WHERE l.status NOT IN (' + "'Returned','Cancelled'" + ')) AS active_loans, ' +
    'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (' + "'Returned','Cancelled'" + ')),0) AS qty_on_loan ' +
    'FROM materials m LEFT JOIN loans l ON l.material_id=m.id GROUP BY m.id ORDER BY m.id ASC'
  );
  const now = new Date().toISOString().replace('T',' ').slice(0,16);
  const values = [COLS, ...rows.map(r=>[r.id,r.name,r.category||'',Number(r.in_stock),r.barcode||'',Number(r.active_loans),Number(r.qty_on_loan),now])];
  const rangeAddr = 'A1:' + colLetter(COLS.length - 1) + values.length;
  await gPatch(sheetPath() + "/range(address='" + rangeAddr + "')", { values });
  console.log('[OneDrive] Pushed '+rows.length+' rows');
  return { pushed: rows.length };
}

async function pullFromOneDrive() {
  const data = await gGet(sheetPath()+'/usedRange');
  const all = data.values;
  if (!all||all.length<2) return { pulled:0, upserted:0, created:0, skipped:0 };
  const h = all[0].map(x=>String(x).trim().toLowerCase());
  const nc=h.indexOf('name'), ic=h.indexOf('id'), cc=h.indexOf('category'), qc=h.indexOf('in stock'), bc=h.indexOf('barcode');
  if (nc===-1) throw new Error('No Name column. Headers: '+h.join(', '));
  const dataRows = all.slice(1).filter(r=>String(r[nc]||'').trim());
  const client = await pool.connect();
  let upserted=0, created=0, skipped=0;
  try {
    await client.query('BEGIN');
    for (const row of dataRows) {
      const eid=row[ic]?Number(row[ic]):null, name=String(row[nc]||'').trim();
      const category=String(row[cc]||'').trim()||'General', rawQty=parseInt(row[qc],10);
      const quantity=isNaN(rawQty)||rawQty<0?0:rawQty, barcode=String(row[bc]||'').trim();
      if (!name) { skipped++; continue; }
      if (eid) {
        const { rowCount } = await client.query('UPDATE materials SET name=$1,category=$2,quantity=$3,barcode=$4 WHERE id=$5',[name,category,quantity,barcode||null,eid]);
        if (rowCount) { upserted++; continue; }
      }
      const { rows: ex } = await client.query('SELECT id FROM materials WHERE LOWER(name)=LOWER($1) LIMIT 1',[name]);
      if (ex.length) { await client.query('UPDATE materials SET category=$1,quantity=$2 WHERE id=$3',[category,quantity,ex[0].id]); upserted++; }
      else { const b=barcode||'BR-'+Math.floor(100000+Math.random()*900000); await client.query('INSERT INTO materials (name,category,quantity,barcode) VALUES ($1,$2,$3,$4)',[name,category,quantity,b]); created++; }
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  console.log('[OneDrive] Pull: '+upserted+' updated, '+created+' created, '+skipped+' skipped');
  return { pulled:upserted+created, upserted, created, skipped };
}

function startSyncLoop() {
  if (!process.env.ONEDRIVE_REFRESH_TOKEN) { 
    console.log('[OneDrive] Disabled - no refresh token'); 
    return; 
  }
  
  // Use parseFloat so intervals like '0.5' (30 seconds) work correctly. Default to 30 seconds.
  const intervalMinutes = parseFloat(process.env.ONEDRIVE_SYNC_INTERVAL || '0.5');
  const ms = intervalMinutes * 60000; 
  
  const run = async(d) => { 
    try { 
      if(d==='pull') await pullFromOneDrive(); 
      if(d==='push') await pushToOneDrive(); 
    } catch(e) { 
      console.error('[OneDrive] '+d+':', e.message); 
    } 
  };
  
  setTimeout(()=>run('pull'), 5000); 
  setTimeout(()=>run('push'), 12000); 
  
  setInterval(()=>run('pull'), ms);
  console.log('[OneDrive] Sync loop started. Pulling every '+(ms/1000)+' seconds.');
}

async function listWorksheets() {
  const data = await gGet('/me/drive/items/' + process.env.ONEDRIVE_FILE_ID + '/workbook/worksheets');
  return data.value.map(w => ({ name: w.name, id: w.id, position: w.position }));
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop, listWorksheets };