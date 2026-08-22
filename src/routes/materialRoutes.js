/**
 * src/routes/materialRoutes.js  (UPDATED)
 *
 * New routes vs original:
 *   GET  /export            → download full registry as JSON for xlsx client-side export
 *   GET  /:id/loan-check    → check active loans before delete (FK safety)
 *   DELETE /:id?strategy=   → block | cascade | soft  (fixes FK constraint crash)
 *   POST /sync/push         → manually trigger DB → OneDrive push
 *   POST /sync/pull         → manually trigger OneDrive → DB pull
 */

const express = require('express');
const router  = express.Router();

const {
  getMaterials,
  exportMaterials,
  loanCheck,
  createMaterial,
  deleteMaterial,
  previewExcel,
  commitExcel,
} = require('../controllers/materialController');

const { pushToOneDrive, pullFromOneDrive } = require('../services/oneDriveSync');

// ── Static routes MUST come before /:id ───────────────────────────────────
router.get( '/export',         exportMaterials);   // GET  /api/materials/export
router.post('/preview-excel',  previewExcel);      // POST /api/materials/preview-excel
router.post('/commit-excel',   commitExcel);       // POST /api/materials/commit-excel

// ── Manual sync triggers (for the UI sync button) ─────────────────────────
router.post('/sync/push', async (req, res) => {
  try   { const r = await pushToOneDrive(); res.json({ success: true, ...r }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync/pull', async (req, res) => {
  try   { const r = await pullFromOneDrive(); res.json({ success: true, ...r }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Collection ─────────────────────────────────────────────────────────────
router.get( '/',  getMaterials);    // GET  /api/materials
router.post('/',  createMaterial);  // POST /api/materials

// ── Item-level (parameterised — MUST come after static routes) ─────────────
router.get(   '/:id/loan-check', loanCheck);      // GET    /api/materials/:id/loan-check
router.delete('/:id',            deleteMaterial); // DELETE /api/materials/:id?strategy=...

module.exports = router;
