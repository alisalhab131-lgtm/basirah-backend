const express = require('express');
const router = express.Router();
const { getReturns, createReturn } = require('../controllers/returnController');

router.get('/', getReturns);
router.post('/', createReturn);

module.exports = router;