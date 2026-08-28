const pool = require('../database/db');

function syncToOneDrive() {
  try {
    const { pullFromOneDrive, pushToOneDrive } = require('../services/oneDriveSync');
    pullFromOneDrive().catch(e => console.error('[OneDrive] pre-push pull error:', e.message))
      .finally(() => { pushToOneDrive().catch(e => console.error('[OneDrive] push error:', e.message)); });
  } catch(e) { console.error('[OneDrive] module error:', e.message); }
}

const getContractors = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM contractors WHERE is_deleted IS NOT TRUE ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const createContractor = async (req, res) => {
  try {
    const { contact_person, company_name, phone, email } = req.body;
    const result = await pool.query(
      'INSERT INTO contractors (contact_person, company_name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',
      [contact_person, company_name, phone, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const updateContractor = async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_person, company_name, phone, email } = req.body;
    const result = await pool.query(
      'UPDATE contractors SET contact_person=$1, company_name=$2, phone=$3, email=$4 WHERE id=$5 RETURNING *',
      [contact_person, company_name, phone, email, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contractor not found.' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const loanCheck = async (req, res) => {
  try {
    const { rows: loans } = await pool.query(
      'SELECT l.id, l.quantity, l.status, m.name AS material_name ' +
      'FROM loans l JOIN materials m ON l.material_id::integer = m.id ' +
      'WHERE l.contractor_id::integer = $1 ORDER BY l.id DESC',
      [req.params.id]
    );
    const activeLoans = loans.filter(l => !['Returned', 'Cancelled'].includes(l.status));
    res.json({ hasLoans: loans.length > 0, hasActiveLoans: activeLoans.length > 0, loans });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const deleteContractor = async (req, res) => {
  const { id } = req.params;
  const strategy = (req.query.strategy || 'block').toLowerCase();
  if (!['block','cascade','soft'].includes(strategy))
    return res.status(400).json({ error: 'strategy must be block, cascade, or soft' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: anyLoans } = await client.query(
      'SELECT id, status FROM loans WHERE contractor_id::integer=$1', [id]
    );
    const hasActive = anyLoans.some(l => !['Returned','Cancelled'].includes(l.status));

    if (anyLoans.length && strategy === 'block') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: hasActive
          ? 'Contractor has active loans. Use cascade or soft strategy.'
          : 'Contractor has historical loan records. Choose cascade (delete history too) or soft (archive, keep history).'
      });
    }

    if (strategy === 'cascade') {
      await client.query('DELETE FROM returns WHERE loan_id IN (SELECT id FROM loans WHERE contractor_id::integer=$1)', [id]);
      await client.query('DELETE FROM loans WHERE contractor_id::integer=$1', [id]);
      await client.query('DELETE FROM contractors WHERE id=$1', [id]);
    } else if (strategy === 'soft') {
      await client.query(
        'UPDATE loans SET status=' + "'Cancelled'" + ' WHERE contractor_id::integer=$1 AND status NOT IN (' + "'Returned','Cancelled'" + ')',
        [id]
      );
      try { await client.query('UPDATE contractors SET is_deleted=TRUE, deleted_at=NOW() WHERE id=$1', [id]); }
      catch { await client.query('DELETE FROM contractors WHERE id=$1', [id]); }
    } else {
      const { rowCount } = await client.query('DELETE FROM contractors WHERE id=$1', [id]);
      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    }
    await client.query('COMMIT');
    syncToOneDrive();
    res.json({ message: 'Deleted.', strategy });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This contractor is still referenced by loan records. Use cascade or soft strategy.' });
    }
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
};

module.exports = { getContractors, createContractor, updateContractor, deleteContractor, loanCheck };
