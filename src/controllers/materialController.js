const pool = require('../database/db');

const getMaterials = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM materials ORDER BY id DESC'
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createMaterial = async (req, res) => {
  try {
    const {
      barcode,
      name,
      category,
      quantity,
      unit,
      condition,
      purchase_price
    } = req.body;

    const result = await pool.query(
      `INSERT INTO materials
      (barcode,name,category,quantity,unit,condition,purchase_price)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        barcode,
        name,
        category,
        quantity,
        unit,
        condition,
        purchase_price
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getMaterials,
  createMaterial
};