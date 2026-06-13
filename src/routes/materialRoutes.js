const express = require('express');
const router = express.Router();
const { getMaterials, createMaterial, deleteMaterial, previewExcel, commitExcel } = require('../controllers/materialController');

router.get('/', getMaterials);
router.post('/', createMaterial);
router.delete('/:id', deleteMaterial);           // ← remove from stock
router.post('/preview-excel', previewExcel);     // Step 1: smart-map, no DB write
router.post('/commit-excel', commitExcel);        // Step 2: execute confirmed plan

module.exports = router;
