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
  name: 'name', 'material name': 'name', 'item name': 'name',
  material: 'name', item: 'name', description: 'name',
  'اسم': 'name', 'المادة': 'name', 'الاسم': 'name',
  category: 'category', type: 'category', 'item type': 'category',
  group: 'category', classification: 'category',
  'فئة': 'category', 'نوع': 'category', 'التصنيف': 'category',
  quantity: 'quantity', qty: 'quantity', amount: 'quantity',
  stock: 'quantity', count: 'quantity', 'no.': 'quantity', 'no': 'quantity',
  'الكمية': 'quantity', 'عدد': 'quantity', 'الكميه': 'quantity',
  barcode: 'barcode', 'bar code': 'barcode', sku: 'barcode',
  code: 'barcode', 'item code': 'barcode', 'باركود': 'barcode',
};

function normaliseHeader(raw) {
  return HEADER_MAP[String(raw).toLowerCase().trim()] || null;
}

function titleCase(str) {
  return String(str).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normaliseCategory(raw) {
  const s = String(raw || '').trim();
  return s ? titleCase(s) : 'General';
}

function normaliseQuantity(raw) {
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function generateBarcode() {
  return 'BR-' + Math.floor(100000 + Math.random() * 900000);
}

// ─── Fuzzy name matching ───────────────────────────────────────────────────
// Levenshtein distance between two strings
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Normalise a material name for comparison: lowercase, strip punctuation/spaces
function normaliseName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '').trim();
}

// Score 0–1: 1 = perfect match
function similarityScore(a, b) {
  const na = normaliseName(a), nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Contains match (one is substring of the other)
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Levenshtein ratio
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

// Find best matching existing material for a given name
// Returns { material, score } or null if no match above threshold
function findBestMatch(name, existingMaterials, threshold = 0.75) {
  let best = null, bestScore = 0;
  for (const m of existingMaterials) {
    const score = similarityScore(name, m.name);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= threshold ? { material: best, score: bestScore } : null;
}

// ─── Controllers ──────────────────────────────────────────────────────────
const getMaterials = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createMaterial = async (req, res) => {
  try {
    const { name, category, quantity, barcode } = req.body;
    const result = await pool.query(
      `INSERT INTO materials (name, category, quantity, barcode) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, category, quantity, barcode]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/materials/preview-excel
 * Parse the Excel and return a mapping plan — what would match, what is new.
 * No DB writes. Used to show the user a confirmation table before committing.
 */
const previewExcel = [
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    try {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows.length) return res.status(422).json({ error: 'Spreadsheet is empty.' });

      // Map headers
      const sampleHeaders = Object.keys(rawRows[0]);
      const headerMapping = {};
      sampleHeaders.forEach(h => { const k = normaliseHeader(h); if (k) headerMapping[h] = k; });

      if (!Object.values(headerMapping).includes('name')) {
        return res.status(422).json({
          error: `No name column found. Detected columns: ${sampleHeaders.join(', ')}`
        });
      }

      // Fetch all existing materials for matching
      const { rows: existingMaterials } = await pool.query('SELECT id, name, category, quantity, barcode FROM materials');

      // Build mapping plan
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

        // Try barcode match first (exact), then name fuzzy match
        let action = 'create';
        let matchedMaterial = null;
        let matchScore = 0;

        if (barcode) {
          const exactBarcode = existingMaterials.find(m => m.barcode === barcode);
          if (exactBarcode) {
            matchedMaterial = exactBarcode;
            matchScore = 1;
            action = 'update_barcode';
          }
        }

        if (!matchedMaterial) {
          const fuzzy = findBestMatch(excelName, existingMaterials);
          if (fuzzy) {
            matchedMaterial = fuzzy.material;
            matchScore = fuzzy.score;
            action = 'update_name';
          }
        }

        plan.push({
          row: i + 2,
          excel_name: excelName,
          excel_category: category,
          excel_quantity: quantity,
          excel_barcode: barcode,
          action,                          // 'create' | 'update_barcode' | 'update_name'
          match_score: Math.round(matchScore * 100),
          matched_id: matchedMaterial?.id || null,
          matched_name: matchedMaterial?.name || null,
          matched_current_qty: matchedMaterial ? Number(matchedMaterial.quantity) : null,
          matched_new_qty: matchedMaterial ? Number(matchedMaterial.quantity) + quantity : null,
        });
      }

      res.json({
        total: plan.length,
        to_update: plan.filter(p => p.action !== 'create').length,
        to_create: plan.filter(p => p.action === 'create').length,
        plan,
      });
    } catch (err) {
      res.status(422).json({ error: 'Failed to parse Excel: ' + err.message });
    }
  },
];

/**
 * POST /api/materials/commit-excel
 * Execute a mapping plan that was confirmed by the user.
 * Body: { plan: [...] }  — the plan array from previewExcel, possibly with user edits to `action`.
 */
const commitExcel = async (req, res) => {
  const { plan } = req.body;
  if (!plan || !Array.isArray(plan) || !plan.length) {
    return res.status(400).json({ error: 'No plan provided.' });
  }

  const results = { updated: [], created: [], skipped: [], errors: [] };

  for (const item of plan) {
    if (item.action === 'skip') {
      results.skipped.push({ name: item.excel_name });
      continue;
    }
    try {
      if (item.action === 'update_barcode' || item.action === 'update_name') {
        // Add quantity to existing material
        const { rows } = await pool.query(
          `UPDATE materials SET quantity = quantity + $1 WHERE id = $2 RETURNING *`,
          [item.excel_quantity, item.matched_id]
        );
        results.updated.push(rows[0]);
      } else {
        // Create new material
        const barcode = item.excel_barcode || generateBarcode();
        const { rows } = await pool.query(
          `INSERT INTO materials (name, category, quantity, barcode) VALUES ($1, $2, $3, $4) RETURNING *`,
          [item.excel_name, item.excel_category, item.excel_quantity, barcode]
        );
        results.created.push(rows[0]);
      }
    } catch (err) {
      results.errors.push({ name: item.excel_name, reason: err.message });
    }
  }

  res.status(200).json({
    message: `Done: ${results.updated.length} updated, ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors.`,
    summary: {
      updated: results.updated.length,
      created: results.created.length,
      skipped: results.skipped.length,
      errors: results.errors.length,
    },
    ...results,
  });
};

module.exports = { getMaterials, createMaterial, previewExcel, commitExcel };
