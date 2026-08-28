const express = require('express');
const router = express.Router();
const { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial, previewExcel, commitExcel } = require('../controllers/materialController');
const { pushToOneDrive, pullFromOneDrive, listWorksheets, getFileInfo } = require('../services/oneDriveSync');

router.get('/export', exportMaterials);

router.get('/sync/file-info', async (req, res) => {
  try { const info = await getFileInfo(); res.json({ success: true, info }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/sheets', async (req, res) => {
  try { const sheets = await listWorksheets(); res.json({ success: true, sheets }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/preview-excel', previewExcel);
router.post('/commit-excel', commitExcel);
router.post('/sync/push', async (req, res) => { try { const r = await pushToOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.post('/sync/pull', async (req, res) => { try { const r = await pullFromOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.get('/', getMaterials);
router.post('/', createMaterial);
router.get('/:id/loan-check', loanCheck);
router.delete('/:id', deleteMaterial);

module.exports = router;
