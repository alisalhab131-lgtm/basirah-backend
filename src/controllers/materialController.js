const pool = require('../database/db');
const multer = require('multer');
const xlsx = require('xlsx');

// ─── Multer ────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls');
    if (!ok) return cb(new Error('Only Excel files (.xlsx / .xls) are accepted'), false);
    cb(null, true);
  },
});

// ─── Header normalisation ──────────────────────────────────────────────────
const HEADER_MAP = {
  name:'name','material name':'name','item name':'name',material:'name',item:'name',description:'name',
  'اسم':'name','المادة':'name','الاسم':'name',
  category:'category',type:'category','item type':'category',group:'category',classification:'category',
  'فئة':'category','نوع':'category','التصنيف':'category',
  quantity:'quantity',qty:'quantity',amount:'quantity',stock:'quantity',count:'quantity','no.':'quantity','no':'quantity',
  'الكمية':'quantity','عدد':'quantity','الكميه':'quantity',
  barcode:'barcode','bar code':'barcode',sku:'barcode',code:'barcode','item code':'barcode','باركود':'barcode',
};
function normaliseHeader(raw) { return HEADER_MAP[String(raw).toLowerCase().trim()] || null; }
function titleCase(str) { return String(str).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function normaliseCategory(raw) { const s = String(raw||'').trim(); return s ? titleCase(s) : 'General'; }
function normaliseQuantity(raw) { const n = parseInt(String(raw).replace(/[^0-9]/g,''),10); return isNaN(n)||n<0?0:n; }
function generateBarcode() { return 'BR-'+Math.floor(100000+Math.random()*900000); }

// ─── Intelligent matching ──────────────────────────────────────────────────

// Levenshtein distance
function levenshtein(a, b) {
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function normaliseName(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]/g,' ')
    .replace(/\s+/g,' ').trim();
}

// Build initialism from a string: "steel pipe" → "sp"
function initialism(str) {
  return normaliseName(str).split(' ').map(w=>w[0]||'').join('');
}

// Check if abbreviation is a consonant-skeleton match of the full word
// e.g. "cmt" matches "cement" (c..m..t all appear in order in "cement")
function isConsonantAbbrev(abbrev, full) {
  const a = abbrev.toLowerCase().replace(/\s/g,'');
  const f = full.toLowerCase().replace(/\s/g,'');
  if (a.length < 2 || a.length >= f.length) return false;
  let ai = 0;
  for (let fi = 0; fi < f.length && ai < a.length; fi++) {
    if (f[fi] === a[ai]) ai++;
  }
  return ai === a.length; // all abbrev chars found in order inside full
}

// Token-set ratio: how many words in A appear in B
function tokenOverlap(a, b) {
  const ta = normaliseName(a).split(' ').filter(Boolean);
  const tb = new Set(normaliseName(b).split(' ').filter(Boolean));
  if (!ta.length) return 0;
  const hits = ta.filter(t => tb.has(t) || [...tb].some(bt => levenshtein(t,bt) <= 1));
  return hits.length / ta.length;
}

/**
 * Rich similarity: returns score 0–1 plus a hint string explaining why it matched.
 */
function richSimilarity(input, candidate) {
  const ni = normaliseName(input), nc = normaliseName(candidate);
  if (!ni || !nc) return { score: 0, hint: '' };

  // 1. Exact
  if (ni === nc) return { score: 1, hint: 'exact' };

  // 2. One contains the other
  if (nc.includes(ni) || ni.includes(nc)) return { score: 0.92, hint: 'substring' };

  // 3. Initialism match: input could be abbreviation of candidate
  //    e.g. input="sp", candidate="steel pipe" → initialism("steel pipe")="sp"
  if (initialism(nc) === ni || initialism(ni) === nc) return { score: 0.88, hint: 'initialism' };

  // 4. Consonant-skeleton abbreviation: "cmt" → "cement"
  if (isConsonantAbbrev(ni, nc)) return { score: 0.85, hint: 'abbreviation' };
  if (isConsonantAbbrev(nc, ni)) return { score: 0.82, hint: 'abbreviation' };

  // 5. Token overlap (word-level partial match)
  const overlap = tokenOverlap(ni, nc);
  if (overlap >= 0.6) return { score: 0.7 + overlap * 0.15, hint: 'partial words' };

  // 6. Levenshtein ratio
  const maxLen = Math.max(ni.length, nc.length);
  const dist = levenshtein(ni, nc);
  const ratio = 1 - dist / maxLen;
  return { score: ratio, hint: 'spelling' };
}

/**
 * Find ALL candidates above threshold, sorted by score descending.
 * Returns array of { material, score, hint }
 */
function findAllMatches(name, existingMaterials, threshold = 0.65) {
  return existingMaterials
    .map(m => { const r = richSimilarity(name, m.name); return { material: m, score: r.score, hint: r.hint }; })
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────
const getMaterials = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const createMaterial = async (req, res) => {
  try {
    const { name, category, quantity, barcode } = req.body;
    const result = await pool.query(
      `INSERT INTO materials (name, category, quantity, barcode) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, category, quantity, barcode]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const deleteMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    // Check it's not referenced in active loans / repairs
    const { rows: activeLoans } = await pool.query(
      `SELECT id FROM loans WHERE material_id = $1 AND status NOT IN ('Returned','Cancelled') LIMIT 1`, [id]
    );
    if (activeLoans.length) {
      return res.status(409).json({ error: 'Cannot delete: material has active loans. Return or close them first.' });
    }
    const { rowCount } = await pool.query('DELETE FROM materials WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Material not found.' });
    res.json({ message: 'Material deleted successfully.' });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// ─── Excel preview ─────────────────────────────────────────────────────────
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
      sampleHeaders.forEach(h => { const k = normaliseHeader(h); if (k) headerMapping[h] = k; });

      if (!Object.values(headerMapping).includes('name')) {
        return res.status(422).json({ error: `No name column found. Detected: ${sampleHeaders.join(', ')}` });
      }

      const { rows: existingMaterials } = await pool.query('SELECT id, name, category, quantity, barcode FROM materials');

      const plan = [];
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const mapped = {};
        Object.entries(row).forEach(([col, val]) => { const k = headerMapping[col]; if (k) mapped[k] = val; });

        const excelName = String(mapped.name || '').trim();
        if (!excelName) continue;

        const category = normaliseCategory(mapped.category);
        const quantity = normaliseQuantity(mapped.quantity);
        const barcode = String(mapped.barcode || '').trim();

        let action = 'create';
        let matchedMaterial = null;
        let matchScore = 0;
        let matchHint = '';
        let allCandidates = [];

        // 1. Exact barcode
        if (barcode) {
          const exactBarcode = existingMaterials.find(m => m.barcode === barcode);
          if (exactBarcode) {
            matchedMaterial = exactBarcode; matchScore = 1; matchHint = 'exact barcode'; action = 'update_barcode';
          }
        }

        // 2. Intelligent name matching
        if (!matchedMaterial) {
          allCandidates = findAllMatches(excelName, existingMaterials, 0.65);
          if (allCandidates.length) {
            const top = allCandidates[0];
            matchedMaterial = top.material;
            matchScore = top.score;
            matchHint = top.hint;
            action = matchScore >= 0.75 ? 'update_name' : 'suggest'; // 'suggest' = show but don't auto-confirm
          }
        }

        plan.push({
          row: i + 2,
          excel_name: excelName,
          excel_category: category,
          excel_quantity: quantity,
          excel_barcode: barcode,
          action,
          match_score: Math.round(matchScore * 100),
          match_hint: matchHint,
          matched_id: matchedMaterial?.id || null,
          matched_name: matchedMaterial?.name || null,
          matched_current_qty: matchedMaterial ? Number(matchedMaterial.quantity) : null,
          matched_new_qty: matchedMaterial ? Number(matchedMaterial.quantity) + quantity : null,
          // All candidates for manual mapping dropdown
          candidates: allCandidates.slice(0, 6).map(c => ({
            id: c.material.id,
            name: c.material.name,
            score: Math.round(c.score * 100),
            hint: c.hint,
            current_qty: Number(c.material.quantity),
          })),
          all_existing: existingMaterials.map(m => ({ id: m.id, name: m.name, current_qty: Number(m.quantity) })),
        });
      }

      res.json({
        total: plan.length,
        to_update: plan.filter(p => ['update_name','update_barcode'].includes(p.action)).length,
        to_create: plan.filter(p => p.action === 'create').length,
        suggestions: plan.filter(p => p.action === 'suggest').length,
        plan,
      });
    } catch (err) { res.status(422).json({ error: 'Failed to parse Excel: ' + err.message }); }
  },
];

// ─── Excel commit ──────────────────────────────────────────────────────────
const commitExcel = async (req, res) => {
  const { plan } = req.body;
  if (!plan || !Array.isArray(plan) || !plan.length)
    return res.status(400).json({ error: 'No plan provided.' });

  const results = { updated: [], created: [], skipped: [], errors: [] };

  for (const item of plan) {
    if (item.action === 'skip') { results.skipped.push({ name: item.excel_name }); continue; }
    try {
      if (['update_barcode','update_name','manual_map'].includes(item.action)) {
        const { rows } = await pool.query(
          `UPDATE materials SET quantity = quantity + $1 WHERE id = $2 RETURNING *`,
          [item.excel_quantity, item.matched_id]
        );
        results.updated.push(rows[0]);
      } else {
        const barcode = item.excel_barcode || generateBarcode();
        const { rows } = await pool.query(
          `INSERT INTO materials (name, category, quantity, barcode) VALUES ($1,$2,$3,$4) RETURNING *`,
          [item.excel_name, item.excel_category, item.excel_quantity, barcode]
        );
        results.created.push(rows[0]);
      }
    } catch (err) { results.errors.push({ name: item.excel_name, reason: err.message }); }
  }

  res.status(200).json({
    message: `Done: ${results.updated.length} updated, ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors.`,
    summary: { updated: results.updated.length, created: results.created.length, skipped: results.skipped.length, errors: results.errors.length },
    ...results,
  });
};

module.exports = { getMaterials, createMaterial, deleteMaterial, previewExcel, commitExcel };
