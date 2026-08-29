const express = require('express');
const router = express.Router();
const { getReturns, createReturn, getLoanReturnStatus } = require('../controllers/returnController');

router.get('/', getReturns);
router.post('/', createReturn);
router.get('/loan/:loan_id/status', getLoanReturnStatus);

module.exports = router;
