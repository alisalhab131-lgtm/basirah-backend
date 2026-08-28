/**
 * add-edit-delete.js
 * Run from backend folder: node add-edit-delete.js
 *
 * Adds:
 *   1. PUT /api/materials/:id           -> update material
 *   2. PUT /api/contractors/:id         -> update contractor
 *   3. DELETE /api/contractors/:id      -> strategy-based delete (block/cascade/soft)
 *   4. GET /api/contractors/:id/loan-check -> check active loans before delete
 */
const fs = require('fs');
const path = require('path');

const MAT_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'materialController.js');
const MAT_ROUTES     = path.join(__dirname, 'src', 'routes', 'materialRoutes.js');
const CON_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'contractorController.js');
const CON_ROUTES     = path.join(__dirname, 'src', 'routes', 'contractorRoutes.js');

// ============================================================
// 1. Add updateMaterial to materialController.js
// ============================================================
let mc = fs.readFileSync(MAT_CONTROLLER, 'utf8');

if (!mc.includes('const updateMaterial')) {
  const updateFn =
    'const updateMaterial = async (req, res) => {\n' +
    '  try {\n' +
    '    const { id } = req.params;\n' +
    '    const { name, category, quantity, barcode } = req.body;\n' +
    '    const result = await pool.query(\n' +
    "      'UPDATE materials SET name=$1, category=$2, quantity=$3, barcode=$4 WHERE id=$5 RETURNING *',\n" +
    '      [name, category, quantity, barcode, id]\n' +
    '    );\n' +
    '    if (!result.rows.length) return res.status(404).json({ error: \'Material not found.\' });\n' +
    '    syncToOneDrive();\n' +
    '    res.json(result.rows[0]);\n' +
    '  } catch (e) { res.status(500).json({ error: e.message }); }\n' +
    '};\n\n';

  // Insert right before deleteMaterial
  mc = mc.replace('const deleteMaterial = async', updateFn + 'const deleteMaterial = async');

  // Add to exports
  mc = mc.replace(
    'module.exports = { getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial, previewExcel, commitExcel };',
    'module.exports = { getMaterials, exportMaterials, loanCheck, createMaterial, updateMaterial, deleteMaterial, previewExcel, commitExcel };'
  );

  fs.writeFileSync(MAT_CONTROLLER, mc);
  console.log('materialController.js: added updateMaterial');
} else {
  console.log('materialController.js: updateMaterial already present, skipping');
}

// ============================================================
// 2. Add PUT /:id to materialRoutes.js
// ============================================================
let mr = fs.readFileSync(MAT_ROUTES, 'utf8');

mr = mr.replace(
  /const \{ getMaterials, exportMaterials, loanCheck, createMaterial, deleteMaterial, previewExcel, commitExcel \} = require\('\.\.\/controllers\/materialController'\);/,
  "const { getMaterials, exportMaterials, loanCheck, createMaterial, updateMaterial, deleteMaterial, previewExcel, commitExcel } = require('../controllers/materialController');"
);

if (!mr.includes("router.put('/:id', updateMaterial)")) {
  mr = mr.replace(
    "router.delete('/:id', deleteMaterial);",
    "router.put('/:id', updateMaterial);\nrouter.delete('/:id', deleteMaterial);"
  );
  fs.writeFileSync(MAT_ROUTES, mr);
  console.log('materialRoutes.js: added PUT /:id');
} else {
  console.log('materialRoutes.js: PUT /:id already present, skipping');
}

// ============================================================
// 3. Full rewrite of contractorController.js
// ============================================================
const contractorController =
  "const pool = require('../database/db');\n\n" +
  "function syncToOneDrive() {\n" +
  "  try {\n" +
  "    const { pullFromOneDrive, pushToOneDrive } = require('../services/oneDriveSync');\n" +
  "    pullFromOneDrive().catch(e => console.error('[OneDrive] pre-push pull error:', e.message))\n" +
  "      .finally(() => { pushToOneDrive().catch(e => console.error('[OneDrive] push error:', e.message)); });\n" +
  "  } catch(e) { console.error('[OneDrive] module error:', e.message); }\n" +
  "}\n\n" +
  "const getContractors = async (req, res) => {\n" +
  "  try {\n" +
  "    const result = await pool.query('SELECT * FROM contractors ORDER BY id DESC');\n" +
  "    res.json(result.rows);\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};\n\n" +
  "const createContractor = async (req, res) => {\n" +
  "  try {\n" +
  "    const { contact_person, company_name, phone, email } = req.body;\n" +
  "    const result = await pool.query(\n" +
  "      'INSERT INTO contractors (contact_person, company_name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',\n" +
  "      [contact_person, company_name, phone, email]\n" +
  "    );\n" +
  "    res.status(201).json(result.rows[0]);\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};\n\n" +
  "const updateContractor = async (req, res) => {\n" +
  "  try {\n" +
  "    const { id } = req.params;\n" +
  "    const { contact_person, company_name, phone, email } = req.body;\n" +
  "    const result = await pool.query(\n" +
  "      'UPDATE contractors SET contact_person=$1, company_name=$2, phone=$3, email=$4 WHERE id=$5 RETURNING *',\n" +
  "      [contact_person, company_name, phone, email, id]\n" +
  "    );\n" +
  "    if (!result.rows.length) return res.status(404).json({ error: 'Contractor not found.' });\n" +
  "    res.json(result.rows[0]);\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};\n\n" +
  "const loanCheck = async (req, res) => {\n" +
  "  try {\n" +
  "    const { rows: loans } = await pool.query(\n" +
  "      'SELECT l.id, l.quantity, l.status, m.name AS material_name ' +\n" +
  "      'FROM loans l JOIN materials m ON l.material_id::integer = m.id ' +\n" +
  "      'WHERE l.contractor_id::integer = $1 AND l.status NOT IN (' + \"'Returned','Cancelled'\" + ')',\n" +
  "      [req.params.id]\n" +
  "    );\n" +
  "    res.json({ hasLoans: loans.length > 0, loans });\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};\n\n" +
  "const deleteContractor = async (req, res) => {\n" +
  "  const { id } = req.params;\n" +
  "  const strategy = (req.query.strategy || 'block').toLowerCase();\n" +
  "  if (!['block','cascade','soft'].includes(strategy))\n" +
  "    return res.status(400).json({ error: 'strategy must be block, cascade, or soft' });\n\n" +
  "  const client = await pool.connect();\n" +
  "  try {\n" +
  "    await client.query('BEGIN');\n" +
  "    const { rows: active } = await client.query(\n" +
  "      'SELECT id FROM loans WHERE contractor_id::integer=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ') LIMIT 1',\n" +
  "      [id]\n" +
  "    );\n" +
  "    if (active.length && strategy === 'block') {\n" +
  "      await client.query('ROLLBACK');\n" +
  "      return res.status(409).json({ error: 'Contractor has active loans. Use cascade or soft strategy.' });\n" +
  "    }\n" +
  "    if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM loans WHERE contractor_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM contractors WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {\n" +
  "      await client.query(\n" +
  "        'UPDATE loans SET status=' + \"'Cancelled'\" + ' WHERE contractor_id::integer=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ')',\n" +
  "        [id]\n" +
  "      );\n" +
  "      try { await client.query('UPDATE contractors SET is_deleted=TRUE, deleted_at=NOW() WHERE id=$1', [id]); }\n" +
  "      catch { await client.query('DELETE FROM contractors WHERE id=$1', [id]); }\n" +
  "    } else {\n" +
  "      const { rowCount } = await client.query('DELETE FROM contractors WHERE id=$1', [id]);\n" +
  "      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }\n" +
  "    }\n" +
  "    await client.query('COMMIT');\n" +
  "    syncToOneDrive();\n" +
  "    res.json({ message: 'Deleted.', strategy });\n" +
  "  } catch (error) {\n" +
  "    await client.query('ROLLBACK');\n" +
  "    res.status(500).json({ error: error.message });\n" +
  "  } finally { client.release(); }\n" +
  "};\n\n" +
  "module.exports = { getContractors, createContractor, updateContractor, deleteContractor, loanCheck };\n";

fs.writeFileSync(CON_CONTROLLER, contractorController);
console.log('contractorController.js: rewritten with update/delete/loanCheck');

// ============================================================
// 4. Full rewrite of contractorRoutes.js
// ============================================================
const contractorRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const { getContractors, createContractor, updateContractor, deleteContractor, loanCheck } = require('../controllers/contractorController');\n\n" +
  "router.get('/', getContractors);\n" +
  "router.post('/', createContractor);\n" +
  "router.put('/:id', updateContractor);\n" +
  "router.get('/:id/loan-check', loanCheck);\n" +
  "router.delete('/:id', deleteContractor);\n\n" +
  "module.exports = router;\n";

fs.writeFileSync(CON_ROUTES, contractorRoutes);
console.log('contractorRoutes.js: rewritten with PUT, DELETE, loan-check routes');

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const mcFinal = fs.readFileSync(MAT_CONTROLLER, 'utf8');
const mrFinal = fs.readFileSync(MAT_ROUTES, 'utf8');
const ccFinal = fs.readFileSync(CON_CONTROLLER, 'utf8');
const crFinal = fs.readFileSync(CON_ROUTES, 'utf8');

console.log('materialController has updateMaterial:', mcFinal.includes('updateMaterial'));
console.log('materialRoutes has PUT /:id:', mrFinal.includes("router.put('/:id'"));
console.log('contractorController has updateContractor:', ccFinal.includes('updateContractor'));
console.log('contractorController has deleteContractor:', ccFinal.includes('deleteContractor'));
console.log('contractorController has loanCheck:', ccFinal.includes('loanCheck'));
console.log('contractorRoutes has all 5 routes:', crFinal.includes('router.put') && crFinal.includes('router.delete') && crFinal.includes('loan-check'));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "feat: add edit/delete for materials and contractors" && git push origin main');
