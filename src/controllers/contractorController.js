const pool = require('../database/db');

const getContractors = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contractors ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createContractor = async (req, res) => {
  try {
    // Destructure using the exact database column names
    const { contact_person, company_name, phone, email } = req.body;
    
    const result = await pool.query(
      `INSERT INTO contractors (contact_person, company_name, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [contact_person, company_name, phone, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getContractors, createContractor };