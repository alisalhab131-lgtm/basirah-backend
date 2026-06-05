const express = require('express');
const router = express.Router();
const { getLoans, createLoan } = require('../controllers/loanController');

router.get('/', getLoans);
router.post('/', createLoan);

module.exports = router;