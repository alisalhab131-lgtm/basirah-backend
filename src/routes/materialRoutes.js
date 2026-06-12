const express = require('express');
const router = express.Router();
const { getMaterials, createMaterial, previewExcel, commitExcel } = require('../controllers/materialController');

router.get('/', getMaterials);
router.post('/', createMaterial);
router.post('/preview-excel', previewExcel);   // Step 1: parse + automap, no DB write
router.post('/commit-excel', commitExcel);       // Step 2: execute confirmed plan

module.exports = router;
