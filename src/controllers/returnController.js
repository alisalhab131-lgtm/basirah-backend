const pool = require('../database/db');

const getReturns = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, m.name as material_name, c.contact_person, l.site_name, l.quantity as loan_quantity
      FROM returns r
      JOIN loans l ON r.loan_id = l.id
      JOIN materials m ON l.material_id = m.id
      JOIN contractors c ON l.contractor_id = c.id
      ORDER BY r.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createReturn = async (req, res) => {
  const client = await pool.connect();
  try {
    const { loan_id, returned_condition, damaged, repair_cost, notes } = req.body;
    const return_date = new Date().toISOString().split('T')[0];

    await client.query('BEGIN');

    const loanCheck = await client.query('SELECT material_id, quantity, status FROM loans WHERE id = $1', [loan_id]);
    if (loanCheck.rows.length === 0) throw new Error('Loan record not found');

    const loan = loanCheck.rows[0];
    if (loan.status === 'Returned') throw new Error('This loan has already been returned.');

    const returnResult = await client.query(
      `INSERT INTO returns (loan_id, return_date, returned_condition, damaged, repair_cost, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [loan_id, return_date, returned_condition, damaged || false, repair_cost || 0, notes || '']
    );

    await client.query("UPDATE loans SET status = 'Returned' WHERE id = $1", [loan_id]);
    await client.query('UPDATE materials SET quantity = quantity + $1 WHERE id = $2', [loan.quantity, loan.material_id]);

    await client.query('COMMIT');
    res.status(201).json({ ...returnResult.rows[0], returned_quantity: loan.quantity });

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { getReturns, createReturn };