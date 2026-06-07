const express = require('express');
const router = express.Router();

const { getUsers, createUser, deleteUser } = require('../controllers/userController');

// PUBLIC (NO TOKEN)
router.post('/', createUser);

// PROTECTED (optional later)
router.get('/', getUsers);
router.delete('/:id', deleteUser);

module.exports = router;