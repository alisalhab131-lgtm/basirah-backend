const pool = require('../database/db');
const multer = require('multer');
const xlsx = require('xlsx');

// ─── OneDrive Sync Helper ────────────────────────────────────────────────
function syncToOneDrive() {
  try {
    const { pushToOneDrive } = require('../services/oneDriveSync');
    // Fire and forget - doesn't block the HTTP response
    pushToOneDrive().catch(e => console.error('[OneDrive] push error:', e.message));
  } catch(e) { 
    console.error('[OneDrive] module error:', e.message); 
  }
}

// ─── File Upload Config ──────────────────────────────────────────────────
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

// ─── Excel Parsing & Normalisation Helpers ───────────────────────────────
const HEADER_MAP = {
  name:'name', 'material name':'name', 'item name':'name', material:'name', item:'name', description:'name',
  category:'category', type:'category', group:'category',
  quantity:'quantity', qty:'quantity', amount:'quantity', stock:'quantity',
  barcode:'barcode', 'bar code':'barcode', sku:'barcode', code:'barcode',
};

function normaliseHeader(raw) { return HEADER_MAP[String(raw).toLowerCase().trim()] || null; }
function titleCase(str) { return String(str).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function normaliseCategory(raw) { const s = String(raw||'').trim(); return s ? titleCase(s) : 'General'; }
function normaliseQuantity(raw) { const n = parseInt(String(raw).replace(/[^0-9]/g,''),10); return isNaN(n)||n<0?0:n; }
function generateBarcode() { return 'BR-'+Math.floor(100000+Math.random()*900000); }

function levenshtein(a, b) {
  const m=a.length, n=b.length;
  const dp=Array.from({length:m+1}, (_,i) => Array.from({length:n+1}, (_,j) => i===0?j:j===0?i:0));
  for(let i=1; i<=m; i++) {
    for(let j=1; j<=n; j++) {
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function normaliseName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}
function initialism(str) { return normaliseName(str).split(' ').map(w=>w[0]||'').join(''); }

function isConsonantAbbrev(abbrev, full) {
  const a=abbrev.toLowerCase().replace(/\s/g,''), f=full.toLowerCase().replace(/\s/g,'');
  if(a.length<2||a.length>=f.length) return false;
  let ai=0;
  for(let fi=0; fi<f.length && ai<a.length; fi++) if(f[fi]===a[ai]) ai++;
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
    .map(m => { const r=richSimilarity(name,m.name); return { material:m, score:r.score, hint:r.hint }; })
    .filter(r => r.score>=threshold).sort((a,b)=>b.score-a.score);
}

// ─── Controllers ─────────────────────────────────────────────────────────

const getMaterials = async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM materials WHERE is_deleted IS NOT TRUE ORDER BY id DESC")).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const exportMaterials = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +
      'COUNT(l.id) FILTER (WHERE l.status NOT IN (1,2)) AS active_loans, ' +
      'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (3,4)),0) AS qty_on_loan ' +
      'FROM materials m LEFT JOIN loans l ON l.material_id::integer=m.id GROUP BY m.id ORDER BY m.name ASC'
      .replace(/\$\{1\}/g,"'Returned'").replace(/\$\{2\}/g,"'Cancelled'")
      .replace(/\$\{3\}/g,"'Returned'").replace(/\$\{4\}/g,"'Cancelled'")
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const loanCheck = async (req, res) => {
  try {
    const { rows: loans } = await pool.query(
      'SELECT l.id, l.quantity, l.status, c.contact_person, c.company_name ' +
      'FROM loans l JOIN contractors c ON l.contractor_id=c.id ' +
      'WHERE l.material_id::integer=$1 AND l.status NOT IN (' + "'Returned','Cancelled'" + ')',
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
    
    syncToOneDrive(); // Instantly syncs the UI creation to Excel
    
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const updateMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, quantity, barcode } = req.body;
    const result = await pool.query(
      'UPDATE materials SET name=$1, category=$2, quantity=$3, barcode=$4 WHERE id=$5 RETURNING *',
      [name, category, quantity, barcode, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Material not found.' });
    syncToOneDrive();
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const deleteMaterial = async (req, res) => {
  const { id } = req.params;
  const strategy = (req.query.strategy || 'block').toLowerCase();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const { rows: active } = await client.query(
      'SELECT id FROM loans WHERE material_id::integer=$1 AND status NOT IN (' + "'Returned','Cancelled'" + ') LIMIT 1',
      [id]
    );
    
    if (active.length && strategy === 'block') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Has active loans. Use cascade or soft.' });
    }
    
    if (strategy === 'cascade') {
      await client.query('DELETE FROM loans WHERE material_id::integer=$1', [id]);
      await client.query('DELETE FROM materials WHERE id=$1', [id]);
    } else if (strategy === 'soft') {
      await client.query(
        'UPDATE loans SET status=' + "'Cancelled'" + ' WHERE material_id::integer=$1 AND status NOT IN (' + "'Returned','Cancelled'" + ')',
        [id]
      );
      try { await client.query('UPDATE materials SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1', [id]); }
      catch { await client.query('DELETE FROM materials WHERE id=$1', [id]); }
    } else {
      const { rowCount } = await client.query('DELETE FROM materials WHERE id=$1', [id]);
      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    }
    
    await client.query('COMMIT');
    
    syncToOneDrive(); // Keep Excel updated after deletion
    
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
        
        let action='create', matchedMaterial=null, matchScore=0, matchHint='', allCandidates=[];
        
        if(barcode){
          const eb=existingMaterials.find(m=>m.barcode===barcode);
          if(eb){matchedMaterial=eb; matchScore=1; matchHint='exact barcode'; action='update_barcode';}
        }
        
        if(!matchedMaterial){
          allCandidates=findAllMatches(excelName,existingMaterials,0.65);
          if(allCandidates.length){
            const top=allCandidates[0];
            matchedMaterial=top.material; matchScore=top.score; matchHint=top.hint;
            action=matchScore>=0.75?'update_name':'suggest';
          }
        }
        
        plan.push({
          row:i+2, excel_name:excelName, excel_category:category, excel_quantity:quantity, excel_barcode:barcode,
          action, match_score:Math.round(matchScore*100), match_hint:matchHint,
          matched_id:matchedMaterial?.id||null, matched_name:matchedMaterial?.name||null,
          matched_current_qty:matchedMaterial?Number(matchedMaterial.quantity):null,
          matched_new_qty:matchedMaterial?Number(matchedMaterial.quantity)+quantity:null,
          candidates:allCandidates.slice(0,6).map(c=>({id:c.material.id,name:c.material.name,score:Math.round(c.score*100),hint:c.hint,current_qty:Number(c.material.quantity)})),
          all_existing:existingMaterials.map(m=>({id:m.id,name:m.name,current_qty:Number(m.quantity)})),
        });
      }
      res.json({
        total:plan.length, 
        to_update:plan.filter(p=>['update_name','update_barcode'].includes(p.action)).length, 
        to_create:plan.filter(p=>p.action==='create').length, 
        suggestions:plan.filter(p=>p.action==='suggest').length, 
        plan
      });
    } catch(err){ res.status(422).json({error:'Failed to parse Excel: '+err.message}); }
  },
];

const commitExcel = async (req, res) => {
  const { plan } = req.body;
  if (!plan||!Array.isArray(plan)||!plan.length) return res.status(400).json({ error:'No plan provided.' });
  
  const results={updated:[],created:[],skipped:[],errors:[]};
  
  for(const item of plan){
    if(item.action==='skip'){ results.skipped.push({name:item.excel_name}); continue; }
    try{
      if(['update_barcode','update_name','manual_map'].includes(item.action)){
        const{rows}=await pool.query('UPDATE materials SET quantity=quantity+$1 WHERE id=$2 RETURNING *',[item.excel_quantity,item.matched_id]);
        results.updated.push(rows[0]);
      }else{
        const barcode=item.excel_barcode||generateBarcode();
        const{rows}=await pool.query('INSERT INTO materials (name,category,quantity,barcode) VALUES ($1,$2,$3,$4) RETURNING *',[item.excel_name,item.excel_category,item.excel_quantity,barcode]);
        results.created.push(rows[0]);
      }
    }catch(err){ results.errors.push({name:item.excel_name,reason:err.message}); }
  }
  
  syncToOneDrive(); // Keep Excel updated after bulk import
  
  res.status(200).json({
    message:'Done: '+results.updated.length+' updated, '+results.created.length+' created, '+results.skipped.length+' skipped, '+results.errors.length+' errors.',
    summary:{updated:results.updated.length, created:results.created.length, skipped:results.skipped.length, errors:results.errors.length},
    ...results,
  });
};

module.exports = { getMaterials, exportMaterials, loanCheck, createMaterial, updateMaterial, deleteMaterial, previewExcel, commitExcel };