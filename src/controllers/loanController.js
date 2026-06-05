const pool = require('../database/db');

const getLoans = async (req, res) => {
  try {
    const queryText = `
      SELECT l.*, m.name as material_name, c.contact_person, c.company_name
      FROM loans l
      JOIN materials m ON l.material_id = m.id
      JOIN contractors c ON l.contractor_id = c.id
      ORDER BY l.id DESC
    `;
    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createLoan = async (req, res) => {
  const client = await pool.connect();
  try {
    const { material_id, contractor_id, quantity, expected_return_date, site_name } = req.body;
    const loan_date = new Date().toISOString().split('T')[0];

    await client.query('BEGIN');

    const materialCheck = await client.query(
      'SELECT quantity, name FROM materials WHERE id = $1',
      [material_id]
    );

    if (materialCheck.rows.length === 0) {
      throw new Error('Material not found');
    }

    const currentStock = materialCheck.rows[0].quantity;
    if (currentStock < quantity) {
      throw new Error(`Insufficient stock for "${materialCheck.rows[0].name}". Available: ${currentStock}`);
    }

    // UPDATED SQL INSERT TO INCLUDE site_name
    const loanResult = await client.query(
      `INSERT INTO loans (material_id, contractor_id, quantity, loan_date, expected_return_date, site_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Borrowed')
       RETURNING *`,
      [material_id, contractor_id, quantity, loan_date, expected_return_date, site_name]
    );

    await client.query(
      'UPDATE materials SET quantity = quantity - $1 WHERE id = $2',
      [quantity, material_id]
    );

    await client.query('COMMIT');
    res.status(201).json(loanResult.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { getLoans, createLoan };