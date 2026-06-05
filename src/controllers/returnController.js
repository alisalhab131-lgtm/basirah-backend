const pool = require('../database/db');

// Get all returns with detailed joins
const getReturns = async (req, res) => {
  try {
    const queryText = `
      SELECT r.*, m.name as material_name, c.contact_person
      FROM returns r
      JOIN loans l ON r.loan_id = l.id
      JOIN materials m ON l.material_id = m.id
      JOIN contractors c ON l.contractor_id = c.id
      ORDER BY r.id DESC
    `;
    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Process a material return and restore inventory stock
const createReturn = async (req, res) => {
  const client = await pool.connect();
  try {
    const { loan_id, returned_condition, damaged, repair_cost, notes } = req.body;
    const return_date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    await client.query('BEGIN');

    // 1. Fetch details of the original loan
    const loanCheck = await client.query(
      'SELECT material_id, quantity, status FROM loans WHERE id = $1',
      [loan_id]
    );

    if (loanCheck.rows.length === 0) {
      throw new Error('Loan record not found');
    }

    const loan = loanCheck.rows[0];
    if (loan.status === 'Returned') {
      throw new Error('This loan has already been returned.');
    }

    // 2. Insert the return record
    const returnResult = await client.query(
      `INSERT INTO returns (loan_id, return_date, returned_condition, damaged, repair_cost, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [loan_id, return_date, returned_condition, damaged || false, repair_cost || 0, notes]
    );

    // 3. Set loan status to 'Returned'
    await client.query(
      "UPDATE loans SET status = 'Returned' WHERE id = $1",
      [loan_id]
    );

    // 4. Add the quantity back to the materials table inventory
    await client.query(
      'UPDATE materials SET quantity = quantity + $1 WHERE id = $2',
      [loan.quantity, loan.material_id]
    );

    await client.query('COMMIT');
    res.status(201).json(returnResult.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { getReturns, createReturn };