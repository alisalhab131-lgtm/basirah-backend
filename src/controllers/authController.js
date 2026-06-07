const pool = require('../database/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

console.log("🔥 AUTH CONTROLLER LOADED");

// ======================
// GET USERS
// ======================
const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, role, created_at FROM users ORDER BY id DESC'
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET USERS ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};

// ======================
// REGISTER USER
// ======================
const createUser = async (req, res) => {
  try {
    console.log("🔥 REGISTER ENTERED");
    console.log("BODY:", req.body);

    const { full_name, email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password required"
      });
    }

    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        message: "User already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, role`,
      [
        full_name || null,
        email,
        hashedPassword,
        role || 'user'
      ]
    );

    console.log("✅ USER CREATED");

    return res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("🔥 REGISTER ERROR:", error);
    return res.status(500).json({
      message: "REGISTER FAILED",
      error: error.message
    });
  }
};

// ======================
// DELETE USER
// ======================
const deleteUser = async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error("DELETE ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};

// ======================
// LOGIN USER
// ======================
const login = async (req, res) => {
  try {
    console.log("🔥 LOGIN ENTERED");

    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password required"
      });
    }

    email = email.trim();

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'secretkey',
      { expiresIn: '1d' }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      message: "LOGIN FAILED",
      error: error.message
    });
  }
};

// ======================
// EXPORTS
// ======================
module.exports = {
  getUsers,
  createUser,
  deleteUser,
  login
};