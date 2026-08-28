const express = require('express');
const router = express.Router();
const { getContractors, createContractor, updateContractor, deleteContractor, loanCheck } = require('../controllers/contractorController');

router.get('/', getContractors);
router.post('/', createContractor);
router.put('/:id', updateContractor);
router.get('/:id/loan-check', loanCheck);
router.delete('/:id', deleteContractor);

module.exports = router;
