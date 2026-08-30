const pool = require('../database/db');

const getReturns = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT r.*, m.name as material_name, c.contact_person, l.site_name, l.quantity as loan_quantity ' +
      'FROM returns r ' +
      'JOIN loans l ON r.loan_id = l.id ' +
      'JOIN materials m ON l.material_id = m.id ' +
      'JOIN contractors c ON l.contractor_id = c.id ' +
      'ORDER BY r.id DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/returns/loan/:loan_id/status - tells the frontend how much is
// still outstanding on a loan, so it can show/limit the quantity input
const getLoanReturnStatus = async (req, res) => {
  try {
    const { loan_id } = req.params;
    const loanResult = await pool.query('SELECT quantity, status FROM loans WHERE id=$1', [loan_id]);
    if (!loanResult.rows.length) return res.status(404).json({ error: 'Loan not found' });
    const loan = loanResult.rows[0];
    const returnedResult = await pool.query(
      'SELECT COALESCE(SUM(quantity),0) as total FROM returns WHERE loan_id=$1', [loan_id]
    );
    const alreadyReturned = parseInt(returnedResult.rows[0].total, 10) || 0;
    const remaining = Math.max(0, Number(loan.quantity) - alreadyReturned);
    res.json({ loan_quantity: Number(loan.quantity), already_returned: alreadyReturned, remaining, status: loan.status });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

const createReturn = async (req, res) => {
  const client = await pool.connect();
  try {
    const { loan_id, returned_condition, damaged, repair_cost, notes, returned_quantity } = req.body;
    const return_date = new Date().toISOString().split('T')[0];

    await client.query('BEGIN');

    const loanCheck = await client.query('SELECT material_id, quantity, status FROM loans WHERE id = $1', [loan_id]);
    if (loanCheck.rows.length === 0) throw new Error('Loan record not found');

    const loan = loanCheck.rows[0];
    if (loan.status === 'Returned') throw new Error('This loan has already been fully returned.');

    // How much has already come back on this loan across prior partial returns?
    const alreadyReturnedResult = await client.query(
      'SELECT COALESCE(SUM(quantity), 0) as total FROM returns WHERE loan_id = $1',
      [loan_id]
    );
    const alreadyReturned = parseInt(alreadyReturnedResult.rows[0].total, 10) || 0;
    const remaining = Number(loan.quantity) - alreadyReturned;

    if (remaining <= 0) throw new Error('This loan has already been fully returned.');

    // If the caller didn't specify a quantity, default to returning everything
    // still outstanding (keeps old behaviour working for existing callers).
    let qtyToReturn = (returned_quantity !== undefined && returned_quantity !== null && returned_quantity !== '')
      ? parseInt(returned_quantity, 10)
      : remaining;

    if (isNaN(qtyToReturn) || qtyToReturn <= 0) {
      throw new Error('Returned quantity must be greater than 0.');
    }
    if (qtyToReturn > remaining) {
      throw new Error('Cannot return ' + qtyToReturn + ' units - only ' + remaining + ' remaining on this loan.');
    }

    const returnResult = await client.query(
      'INSERT INTO returns (loan_id, return_date, returned_condition, damaged, repair_cost, notes, quantity) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [loan_id, return_date, returned_condition, damaged || false, repair_cost || 0, notes || '', qtyToReturn]
    );

    const newRemaining = remaining - qtyToReturn;
    const newStatus = newRemaining <= 0 ? 'Returned' : 'Partially Returned';

    await client.query('UPDATE loans SET status = $1 WHERE id = $2', [newStatus, loan_id]);
    await client.query('UPDATE materials SET quantity = quantity + $1 WHERE id = $2', [qtyToReturn, loan.material_id]);

    await client.query('COMMIT');
    res.status(201).json({
      ...returnResult.rows[0],
      returned_quantity: qtyToReturn,
      remaining_quantity: newRemaining,
      loan_status: newStatus,
    });

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};


const deleteReturn = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM returns WHERE id=$1', [id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Return record not found.' }); }
    const ret = rows[0];

    const { rows: loanRows } = await client.query('SELECT material_id, quantity FROM loans WHERE id=$1', [ret.loan_id]);
    if (!loanRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Associated loan not found.' }); }
    const loan = loanRows[0];
    const qtyToReverse = Number(ret.quantity || loan.quantity || 0);

    // Undo the stock restoration this return caused
    await client.query('UPDATE materials SET quantity = quantity - $1 WHERE id=$2', [qtyToReverse, loan.material_id]);

    // Remove the return record itself
    await client.query('DELETE FROM returns WHERE id=$1', [id]);

    // Recompute loan status from whatever returns (if any) still remain
    const { rows: sumRows } = await client.query('SELECT COALESCE(SUM(quantity),0) as total FROM returns WHERE loan_id=$1', [ret.loan_id]);
    const totalReturned = parseInt(sumRows[0].total, 10) || 0;
    const newStatus = totalReturned <= 0 ? 'Borrowed' : (totalReturned < Number(loan.quantity) ? 'Partially Returned' : 'Returned');
    await client.query('UPDATE loans SET status=$1 WHERE id=$2', [newStatus, ret.loan_id]);

    await client.query('COMMIT');
    res.json({ message: 'Return deleted and reversed.', reversed_quantity: qtyToReverse, loan_status: newStatus });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
};

module.exports = { getReturns, createReturn, getLoanReturnStatus, deleteReturn };
