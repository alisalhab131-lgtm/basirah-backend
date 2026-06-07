const pool = require('../database/db');
const bcrypt = require('bcryptjs');

// GET ALL USERS
const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, role, created_at FROM users ORDER BY id DESC'
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// CREATE USER
const createUser = async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
      (full_name, email, password, role)
      VALUES ($1,$2,$3,$4)
      RETURNING id, full_name, email, role`,
      [full_name, email, hashedPassword, role]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE USER
const deleteUser = async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUsers,
  createUser,
  deleteUser
};