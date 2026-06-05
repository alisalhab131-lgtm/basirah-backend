const express = require('express');
const router = express.Router();
const { getRepairs, createRepair } = require('../controllers/repairController');

router.get('/', getRepairs);
router.post('/', createRepair);

module.exports = router;