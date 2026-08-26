/**
 * writefiles.js
 * Run from your backend folder: node writefiles.js
 * Writes materialController.js and verifies exports
 */
const fs = require('path');
const path = require('path');

const CONTROLLER_PATH = path.join(__dirname, 'src', 'controllers', 'materialController.js');
const ROUTES_PATH     = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');
const SYNC_PATH       = path.join(__dirname, 'src', 'services', 'oneDriveSync.js');
const SERVER_PATH     = path.join(__dirname, 'src', 'server.js');

const fsm = require('fs');

// ── materialController.js ─────────────────────────────────────────────────
const controller = `const pool = require('../database/db');
const multer = require('multer');
const xlsx = require('xlsx');

function syncToOneDrive() {
  try {
    const { pushToOneDrive } = require('../services/oneDriveSync');
    pushToOneDrive().catch(e => console.error('[OneDrive] push error:', e.message));
  } catch(e) { console.error('[OneDrive] module error:', e.message); }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls');
    if (!ok) return cb(new Error('Only Excel files accepted'), false);
    cb(null, true);
  },
});

const HEADER_MAP = {
  name:'name','material name':'name','item name':'name',material:'name',item:'name',description:'name',
  category:'category',type:'category',group:'category',
  quantity:'quantity',qty:'quantity',amount:'quantity',stock:'quantity',
  barcode:'barcode','bar code':'barcode',sku:'barcode',code:'barcode',
};
function normaliseHeader(raw) { return HEADER_MAP[String(raw).toLowerCase().trim()] || null; }
function titleCase(str) { return String(str).trim().toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase()); }
function normaliseCategory(raw) { const s = String(raw||'').trim(); return s ? titleCase(s) : 'General'; }
function normaliseQuantity(raw) { const n = parseInt(String(raw).replace(/[^0-9]/g,''),10); return isNaN(n)||n<0?0:n; }
function generateBarcode() { return 'BR-'+Math.floor(100000+Math.random()*900000); }

function levenshtein(a, b) {
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function normaliseName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\\s+/g,' ').trim();
}
function initialism(str) { return normaliseName(str).split(' ').map(w=>w[0]||'').join(''); }
function isConsonantAbbrev(abbrev, full) {
  const a=abbrev.toLowerCase().replace(/\\s/g,''), f=full.toLowerCase().replace(/\\s/g,'');
  if(a.length<2||a.length>=f.length) return false;
  let ai=0;
  for(let fi=0;fi<f.length&&ai<a.length;fi++) if(f[fi]===a[ai]) ai++;
  return ai===a.length;
}
function tokenOverlap(a, b) {
  const ta=normaliseName(a).split(' ').filter(Boolean), tb=new Set(normaliseName(b).split(' ').filter(Boolean));
  if(!ta.length) return 0;
  const hits=ta.filter(t=>tb.has(t)||[...tb].some(bt=>levenshtein(t,bt)<=1));
  return hits.length/ta.length;
}
function richSimilarity(input, candidate) {
  const ni=normaliseName(input), nc=normaliseName(candidate);
  if(!ni||!nc) return { score:0, hint:'' };
  if(ni===nc) return { score:1, hint:'exact' };
  if(nc.includes(ni)||ni.includes(nc)) return { score:0.92, hint:'substring' };
  if(initialism(nc)===ni||initialism(ni)===nc) return { score:0.88, hint:'initialism' };
  if(isConsonantAbbrev(ni,nc)) return { score:0.85, hint:'abbreviation' };
  if(isConsonantAbbrev(nc,ni)) return { score:0.82, hint:'abbreviation' };
  const overlap=tokenOverlap(ni,nc);
  if(overlap>=0.6) return { score:0.7+overlap*0.15, hint:'partial words' };
  const maxLen=Math.max(ni.length,nc.length);
  return { score:1-levenshtein(ni,nc)/maxLen, hint:'spelling' };
}
function findAllMatches(name, existing, threshold=0.65) {
  return existing
    .map(m=>{ const r=richSimilarity(name,m.name); return { material:m, score:r.score, hint:r.hint }; })
    .filter(r=>r.score>=threshold).sort((a,b)=>b.score-a.score);
}

const getMaterials = async (req, res) => {
  try {
    res.json((await pool.query('SELECT * FROM materials ORDER BY id DESC')).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const exportMaterials = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +
      'COUNT(l.id) FILTER (WHERE l.status NOT IN (${1},${2})) AS active_loans, ' +
      'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (${3},${4})),0) AS qty_on_loan ' +
      'FROM materials m LEFT JOIN loans l ON l.material_id=m.id GROUP BY m.id ORDER BY m.name ASC'
      .replace(/\\$\\{1\\}/g,"'Returned'").replace(/\\$\\{2\\}/g,"'Cancelled'")
      .replace(/\\$\\{3\\}/g,"'Returned'").replace(/\\$\\{4\\}/g,"'Cancelled'")
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const loanCheck = async (req, res) => {
  try {
    const { rows: loans } = await pool.query(
      'SELECT l.id, l.quantity, l.status, c.contact_person, c.company_name ' +
      'FROM loans l JOIN contractors c ON l.contractor_id=c.id ' +
      'WHERE l.material_id=$1 AND l.status NOT IN (' + "'Returned','Cancelled'" + ')',
      [req.params.id]
    );
    res.json({ hasLoans: loans.length > 0, loans });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const createMaterial = async (req, res) => {
  try {
    const { name, category, quantity, barcode } = req.body;
    const result = await pool.query(
      'INSERT INTO materials (name,category,quantity,barcode) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, category, quantity, barcode]
    );
    syncToOneDrive();
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const deleteMaterial = async (req, res) => {
  const { id } = req.params;
  const strategy = (req.query.strategy || 'block').toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: active } = await client.query(
      'SELECT id FROM loans WHERE material_id=$1 AND status NOT IN (' + "'Returned','Cancelled'" + ') LIMIT 1',
      [id]
    );
    if (active.length && strategy === 'block') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Has active loans. Use cascade or soft.' });
    }
    if (strategy === 'cascade') {
      await client.query('DELETE FROM loans WHERE material_id=$1', [id]);
      await client.query('DELETE FROM materials WHERE id=$1', [id]);
    } else if (strategy === 'soft') {
      await client.query(
        'UPDATE loans SET status=' + "'Cancelled'" + ' WHERE material_id=$1 AND status NOT IN (' + "'Returned','Cancelled'" + ')',
        [id]
      );
      try { await client.query('UPDATE materials SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1', [id]); }
      catch { await client.query('DELETE FROM materials WHERE id=$1', [id]); }
    } else {
      const { rowCount } = await client.query('DELETE FROM materials WHERE id=$1', [id]);
      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    }
    await client.query('COMMIT');
    syncToOneDrive();
    res.json({ message: 'Deleted.', strategy });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
};

const previewExcel = [
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    try {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
      if (!rawRows.length) return res.status(422).json({ error: 'Spreadsheet is empty.' });
      const sampleHeaders = Object.keys(rawRows[0]);
      const headerMapping = {};
      sampleHeaders.forEach(h => { const k=normaliseHeader(h); if(k) headerMapping[h]=k; });
      if (!Object.values(headerMapping).includes('name'))
        return res.status(422).json({ error: 'No name column found. Detected: ' + sampleHeaders.join(', ') });
      const { rows: existingMaterials } = await pool.query('SELECT id,name,category,quantity,barcode FROM materials');
      const plan = [];
      for (let i=0; i<rawRows.length; i++) {
        const row=rawRows[i], mapped={};
        Object.entries(row).forEach(([col,val])=>{ const k=headerMapping[col]; if(k) mapped[k]=val; });
        const excelName=String(mapped.name||'').trim();
        if(!excelName) continue;
        const category=normaliseCategory(mapped.category), quantity=normaliseQuantity(mapped.quantity);
        const barcode=String(mapped.barcode||'').trim();
        let action='create',matchedMaterial=null,matchScore=0,matchHint='',allCandidates=[];
        if(barcode){const eb=existingMaterials.find(m=>m.barcode===barcode);if(eb){matchedMaterial=eb;matchScore=1;matchHint='exact barcode';action='update_barcode';}}
        if(!matchedMaterial){
          allCandidates=findAllMatches(excelName,existingMaterials,0.65);
          if(allCandidates.length){const top=allCandidates[0];matchedMaterial=top.material;matchScore=top.score;matchHint=top.hint;action=matchScore>=0.75?'update_name':'suggest';}
        }
        plan.push({
          row:i+2,excel_name:excelName,excel_category:category,excel_quantity:quantity,excel_barcode:barcode,
          action,match_score:Math.round(matchScore*100),match_hint:matchHint,
          matched_id:matchedMaterial?.id||null,matched_name:matchedMaterial?.name||null,
          matched_current_qty:matchedMaterial?Number(matchedMaterial.quantity):null,
          matched_new_qty:matchedMaterial?Number(matchedMaterial.quantity)+quantity:null,
          candidates:allCandidates.slice(0,6).map(c=>({id:c.material.id,name:c.material.name,score:Math.round(c.score*100),hint:c.hint,current_qty:Number(c.material.quantity)})),
          all_existing:existingMaterials.map(m=>({id:m.id,name:m.name,current_qty:Number(m.quantity)})),
        });
      }
      res.json({total:plan.length,to_update:plan.filter(p=>['update_name','update_barcode'].includes(p.action)).length,to_create:plan.filter(p=>p.action==='create').length,suggestions:plan.filter(p=>p.action==='suggest').length,plan});
    } catch(err){res.status(422).json({error:'Failed to parse Excel: '+err.message});}
  },
];

const commitExcel = async (req, res) => {
  const { plan } = req.body;
  if (!plan||!Array.isArray(plan)||!plan.length) return res.status(400).json({ error:'No plan provided.' });
  const results={updated:[],created:[],skipped:[],errors:[]};
  for(const item of plan){
    if(item.action==='skip'){results.skipped.push({name:item.excel_name});continue;}
    try{
      if(['update_barcode','update_name','manual_map'].includes(item.action)){
        const{rows}=await pool.query('UPDATE materials SET quantity=quantity+$1 WHERE id=$2 RETURNING *',[item.excel_quantity,item.matched_id]);
        results.updated.push(rows[0]);
      }else{
        const barcode=item.excel_barcode||generateBarcode();
        const{rows}=await pool.query('INSERT INTO materials (name,category,quantity,barcode) VALUES ($1,$2,$3,$4) RETURNING *',[item.excel_name,item.excel_category,item.excel_quantity,barcode]);
        results.created.push(rows[0]);
      }
    }catch(err){results.errors.push({name:item.excel_name,reason:err.message});}
  }
  syncToOneDrive();
  res.status(200).json({
    message:'Done: '+results.updated.length+' updated, '+results.created.length+' created, '+results.skipped.length+' skipped, '+results.errors.length+' errors.',
    summary:{updated:results.updated.length,created:results.created.length,skipped:results.skipped.length,errors:results.errors.length},
    ...results,
  });
};

module.exports = { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial, previewExcel, commitExcel };
`;

// ── materialRoutes.js ─────────────────────────────────────────────────────
const routes = `const express = require('express');
const router = express.Router();
const { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial, previewExcel, commitExcel } = require('../controllers/materialController');
const { pushToOneDrive, pullFromOneDrive } = require('../services/oneDriveSync');

router.get('/export', exportMaterials);
router.post('/preview-excel', previewExcel);
router.post('/commit-excel', commitExcel);
router.post('/sync/push', async (req, res) => { try { const r = await pushToOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.post('/sync/pull', async (req, res) => { try { const r = await pullFromOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.get('/', getMaterials);
router.post('/', createMaterial);
router.get('/:id/loan-check', loanCheck);
router.delete('/:id', deleteMaterial);

module.exports = router;
`;

// ── oneDriveSync.js ───────────────────────────────────────────────────────
const sync = `const pool = require('../database/db');
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
  await gPatch(sheetPath()+'/range(address='+JSON.stringify('A1:'+colLetter(COLS.length-1)+values.length)+')', { values });
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
  if (!process.env.ONEDRIVE_REFRESH_TOKEN) { console.log('[OneDrive] Disabled - no refresh token'); return; }
  const ms = parseInt(process.env.ONEDRIVE_SYNC_INTERVAL||'5',10)*60000;
  const run = async(d) => { try { if(d==='pull') await pullFromOneDrive(); if(d==='push') await pushToOneDrive(); } catch(e) { console.error('[OneDrive] '+d+':',e.message); } };
  setTimeout(()=>run('pull'),5000); setTimeout(()=>run('push'),12000); setInterval(()=>run('pull'),ms);
  console.log('[OneDrive] Sync every '+(ms/60000)+' min');
}

module.exports = { pushToOneDrive, pullFromOneDrive, startSyncLoop };
`;

// ── server.js ─────────────────────────────────────────────────────────────
const server = `console.log("SERVER START");
require('dotenv').config();
const app = require('./app');
require('./database/db');
const { startSyncLoop } = require('./services/oneDriveSync');
startSyncLoop();
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => { console.log("SERVER RUNNING ON PORT " + PORT); });
`;

// ── Write all files ───────────────────────────────────────────────────────
const write = require('fs');
const mkdirp = p => { try { write.mkdirSync(p, { recursive: true }); } catch(e) {} };

mkdirp(require('path').join(__dirname, 'src', 'services'));
mkdirp(require('path').join(__dirname, 'src', 'controllers'));
mkdirp(require('path').join(__dirname, 'src', 'routes'));

write.writeFileSync(CONTROLLER_PATH, controller);
write.writeFileSync(ROUTES_PATH,     routes);
write.writeFileSync(SYNC_PATH,       sync);
write.writeFileSync(SERVER_PATH,     server);

// ── Verify ────────────────────────────────────────────────────────────────
const c = write.readFileSync(CONTROLLER_PATH, 'utf8');
const r = write.readFileSync(ROUTES_PATH, 'utf8');

console.log('controller - exportMaterials:', c.includes('exportMaterials'));
console.log('controller - loanCheck:',       c.includes('loanCheck'));
console.log('controller - deleteMaterial:',  c.includes('deleteMaterial'));
console.log('routes     - /export:',         r.includes('/export'));
console.log('routes     - sync/push:',       r.includes('sync/push'));
console.log('routes     - loan-check:',      r.includes('loan-check'));
console.log('');
console.log('All files written. Now run:');
console.log('  git add -A && git commit -m "fix: all files rewritten" && git push origin main');
