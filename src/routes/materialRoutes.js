const express = require('express');
const router = express.Router();
const { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial } = require('../controllers/materialController');
const { pushToOneDrive, pullFromOneDrive } = require('../services/oneDriveSync');

router.get('/export', exportMaterials);
router.post('/sync/push', async (req, res) => { try { const r = await pushToOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.post('/sync/pull', async (req, res) => { try { const r = await pullFromOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.get('/', getMaterials);
router.post('/', createMaterial);
router.get('/:id/loan-check', loanCheck);
router.delete('/:id', deleteMaterial);

module.exports = router;