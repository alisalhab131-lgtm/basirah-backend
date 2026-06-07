console.log("🔥 AUTH ROUTES LOADED");

const express = require('express');
const router = express.Router();

const {
  createUser,
  login,
  getUsers,
  deleteUser
} = require('../controllers/authController');

// AUTH ROUTES
router.post('/register', createUser);
router.post('/login', login);

// USER ROUTES
router.get('/users', getUsers);
router.delete('/users/:id', deleteUser);

module.exports = router;