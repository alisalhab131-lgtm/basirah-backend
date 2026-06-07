const express = require('express');
const router = express.Router();

const {
  getUsers,
  createUser,
  deleteUser
} = require('../controllers/userController');

const {
  verifyToken,
  requireRole
} = require('../middleware/authMiddleware');

router.get(
  '/',
  verifyToken,
  requireRole(['admin']),
  getUsers
);

router.post(
  '/',
  verifyToken,
  requireRole(['admin']),
  createUser
);

router.delete(
  '/:id',
  verifyToken,
  requireRole(['admin']),
  deleteUser
);

module.exports = router;