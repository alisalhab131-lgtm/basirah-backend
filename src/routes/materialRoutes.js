const express = require('express');
const router = express.Router();
const { getMaterials, exportMaterials, loanCheck, createMaterial, updateMaterial, deleteMaterial, previewExcel, commitExcel } = require('../controllers/materialController');
const { pushToOneDrive, pullFromOneDrive, heartbeat } = require('../services/oneDriveSync');

router.get('/export', exportMaterials);

router.get('/sync/deep-find', async (req, res) => {
  try {
    const name = req.query.name || 'INV.xlsx';
    const matches = await deepFind(name);
    res.json({ success: true, query: name, matches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/list-folder', async (req, res) => {
  try {
    const folderId = req.query.id;
    if (!folderId) return res.status(400).json({ error: 'Provide ?id=FOLDER_ID' });
    const items = await listChildren(folderId);
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/find-file', async (req, res) => {
  try {
    const name = req.query.name || 'INV.xlsx';
    const results = await findFile(name);
    res.json({ success: true, query: name, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sync/root', async (req, res) => {
  try { const items = await listRoot(); res.json({ success: true, items }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

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
router.get('/sync/heartbeat', async (req, res) => {
  try { const result = await heartbeat(); res.json({ success: true, ...result }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync/push', async (req, res) => { try { const r = await pushToOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.post('/sync/pull', async (req, res) => { try { const r = await pullFromOneDrive(); res.json({ success: true, ...r }); } catch (err) { res.status(500).json({ error: err.message }); } });
router.get('/', getMaterials);
router.post('/', createMaterial);
router.get('/:id/loan-check', loanCheck);
router.put('/:id', updateMaterial);
router.delete('/:id', deleteMaterial);

module.exports = router;
