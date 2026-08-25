const pool = require('../database/db');

function syncToOneDrive() {
  try { const { pushToOneDrive } = require('../services/oneDriveSync'); pushToOneDrive().catch(e => console.error('[OneDrive]', e.message)); } catch(e) { console.error('[OneDrive] module:', e.message); }
}

const getMaterials = async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM materials ORDER BY id DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
};

const exportMaterials = async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT m.id AS "ID", m.name AS "Name", m.category AS "Category", m.quantity AS "In Stock", m.barcode AS "Barcode", COUNT(l.id) FILTER (WHERE l.status NOT IN ('Returned','Cancelled')) AS "Active Loans", COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN ('Returned','Cancelled')),0) AS "Qty On Loan" FROM materials m LEFT JOIN loans l ON l.material_id=m.id GROUP BY m.id ORDER BY m.name ASC);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const loanCheck = async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT l.id, l.quantity, l.status, c.contact_person, c.company_name FROM loans l JOIN contractors c ON l.contractor_id=c.id WHERE l.material_id=+""+\ AND l.status NOT IN ('Returned','Cancelled'), [req.params.id]);
    res.json({ hasLoans: rows.length > 0, loans: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const createMaterial = async (req, res) => {
  try {
    const { name, category, quantity, barcode } = req.body;
    const result = await pool.query('INSERT INTO materials (name,category,quantity,barcode) VALUES (+""+\,+""+\,+""+\,+""+\) RETURNING *', [name, category, quantity, barcode]);
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
    const { rows: active } = await client.query(SELECT id FROM loans WHERE material_id=+""+\ AND status NOT IN ('Returned','Cancelled') LIMIT 1, [id]);
    if (active.length && strategy === 'block') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Has active loans. Use cascade or soft.' }); }
    if (strategy === 'cascade') { await client.query('DELETE FROM loans WHERE material_id=+""+\', [id]); await client.query('DELETE FROM materials WHERE id=+""+\', [id]); }
    else { await client.query('DELETE FROM materials WHERE id=+""+\', [id]); }
    await client.query('COMMIT');
    syncToOneDrive();
    res.json({ message: 'Deleted.', strategy });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
};

module.exports = { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial };

// updated
// updated