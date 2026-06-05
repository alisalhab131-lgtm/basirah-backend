const express = require('express');
const router = express.Router();
const { getContractors, createContractor } = require('../controllers/contractorController');

router.get('/', getContractors);
router.post('/', createContractor);

module.exports = router;
