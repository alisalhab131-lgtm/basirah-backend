const pool = require('../database/db');

// Get all repair records with material details
const getRepairs = async (req, res) => {
  try {
    const queryText = `
      SELECT r.*, m.name as material_name, m.barcode
      FROM repairs r
      JOIN materials m ON r.material_id = m.id
      ORDER BY r.id DESC
    `;
    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Log a new repair and reduce available stock
const createRepair = async (req, res) => {
  const client = await pool.connect();
  try {
    const { material_id, repair_cost, description } = req.body;
    const repair_date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    await client.query('BEGIN');

    // 1. Check if the item exists and is in stock
    const materialCheck = await client.query(
      'SELECT quantity, name FROM materials WHERE id = $1',
      [material_id]
    );

    if (materialCheck.rows.length === 0) {
      throw new Error('Material not found');
    }

    const currentStock = materialCheck.rows[0].quantity;
    if (currentStock < 1) {
      throw new Error(`Cannot send "${materialCheck.rows[0].name}" to repair. Out of stock.`);
    }

    // 2. Log the repair record
    const repairResult = await client.query(
      `INSERT INTO repairs (material_id, repair_date, repair_cost, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [material_id, repair_date, repair_cost || 0, description]
    );

    // 3. Deduct 1 item from available stock because it's in the repair shop
    await client.query(
      'UPDATE materials SET quantity = quantity - 1 WHERE id = $1',
      [material_id]
    );

    await client.query('COMMIT');
    res.status(201).json(repairResult.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { getRepairs, createRepair };
