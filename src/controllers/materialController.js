const pool = require('../database/db');
const multer = require('multer');
const xlsx = require('xlsx');

// ─── Multer: memory storage (no disk writes) ───────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
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

// ─── Normalisation helpers ─────────────────────────────────────────────────

/**
 * Collapse any column header variant into one of our canonical keys:
 *   name | category | quantity | barcode
 */
const HEADER_MAP = {
  // name
  name: 'name',
  'material name': 'name',
  'item name': 'name',
  material: 'name',
  item: 'name',
  description: 'name',
  اسم: 'name',
  المادة: 'name',

  // category
  category: 'category',
  type: 'category',
  'item type': 'category',
  group: 'category',
  classification: 'category',
  فئة: 'category',
  نوع: 'category',

  // quantity
  quantity: 'quantity',
  qty: 'quantity',
  amount: 'quantity',
  stock: 'quantity',
  count: 'quantity',
  الكمية: 'quantity',
  عدد: 'quantity',

  // barcode
  barcode: 'barcode',
  'bar code': 'barcode',
  sku: 'barcode',
  code: 'barcode',
  'item code': 'barcode',
  باركود: 'barcode',
};

function normaliseHeader(raw) {
  return HEADER_MAP[String(raw).toLowerCase().trim()] || null;
}

/** Title-case a string, capitalise first letter of every word */
function titleCase(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalise category: trim + title-case, fallback to 'General' */
function normaliseCategory(raw) {
  const s = String(raw || '').trim();
  return s ? titleCase(s) : 'General';
}

/** Parse a quantity cell — return integer ≥ 0 */
function normaliseQuantity(raw) {
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

/** Generate a barcode if the sheet didn't supply one */
function generateBarcode() {
  return 'BR-' + Math.floor(100000 + Math.random() * 900000);
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
      `INSERT INTO materials (name, category, quantity, barcode)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, category, quantity, barcode]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/materials/upload-excel
 * Accepts a multipart Excel file, parses every row, normalises fields,
 * bulk-inserts into the materials table, and returns a detailed report.
 */
const uploadExcel = [
  upload.single('file'), // middleware — expects field name "file"
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Send the Excel as form-data field "file".' });
    }

    try {
      // ── Parse workbook from buffer ─────────────────────────────────────
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows.length) {
        return res.status(422).json({ error: 'The spreadsheet appears to be empty.' });
      }

      // ── Map headers ────────────────────────────────────────────────────
      const sampleHeaders = Object.keys(rawRows[0]);
      const headerMapping = {};
      sampleHeaders.forEach((h) => {
        const canonical = normaliseHeader(h);
        if (canonical) headerMapping[h] = canonical;
      });

      if (!Object.values(headerMapping).includes('name')) {
        return res.status(422).json({
          error:
            'Could not find a "name" (or "material name", "item name", "description") column. ' +
            `Found columns: ${sampleHeaders.join(', ')}`,
        });
      }

      // ── Process rows ───────────────────────────────────────────────────
      const inserted = [];
      const skipped = [];
      const errors = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const rowNum = i + 2; // +2: 1-based + header row

        // Remap to canonical keys
        const mapped = {};
        Object.entries(row).forEach(([col, val]) => {
          const key = headerMapping[col];
          if (key) mapped[key] = val;
        });

        // Validate name
        const name = String(mapped.name || '').trim();
        if (!name) {
          skipped.push({ row: rowNum, reason: 'Empty name — skipped' });
          continue;
        }

        const category = normaliseCategory(mapped.category);
        const quantity = normaliseQuantity(mapped.quantity);
        const barcode = String(mapped.barcode || '').trim() || generateBarcode();

        try {
          const result = await pool.query(
            `INSERT INTO materials (name, category, quantity, barcode)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (barcode) DO UPDATE
               SET quantity = materials.quantity + EXCLUDED.quantity
             RETURNING *`,
            [name, category, quantity, barcode]
          );
          inserted.push(result.rows[0]);
        } catch (dbErr) {
          errors.push({ row: rowNum, name, reason: dbErr.message });
        }
      }

      res.status(201).json({
        message: `Import complete: ${inserted.length} inserted/updated, ${skipped.length} skipped, ${errors.length} errors.`,
        summary: {
          total_rows: rawRows.length,
          inserted: inserted.length,
          skipped: skipped.length,
          errors: errors.length,
        },
        inserted,
        skipped,
        errors,
      });
    } catch (parseErr) {
      res.status(422).json({ error: 'Failed to parse Excel file: ' + parseErr.message });
    }
  },
];

module.exports = { getMaterials, createMaterial, uploadExcel };
