const pool = require('../database/db');

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

module.exports = { getMaterials, createMaterial };
