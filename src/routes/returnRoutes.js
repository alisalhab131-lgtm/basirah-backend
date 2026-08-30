const express = require('express');
const router = express.Router();
const { getReturns, createReturn, getLoanReturnStatus, deleteReturn } = require('../controllers/returnController');

router.get('/', getReturns);
router.post('/', createReturn);
router.get('/loan/:loan_id/status', getLoanReturnStatus);
router.delete('/:id', deleteReturn);

module.exports = router;
