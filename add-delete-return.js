/**
 * add-delete-return.js
 * Run from backend folder: node add-delete-return.js
 *
 * Adds DELETE /api/returns/:id
 *   - Reverses the stock quantity that return had restored to materials
 *   - Deletes the return record
 *   - Recomputes the loan's status based on what returns (if any) remain:
 *       no returns left      -> 'Borrowed'
 *       some but not all qty -> 'Partially Returned'
 *       all qty returned     -> 'Returned'
 */
const fs = require('fs');
const path = require('path');

const CONTROLLER_PATH = path.join(__dirname, 'src', 'controllers', 'returnController.js');
const ROUTES_PATH     = path.join(__dirname, 'src', 'routes', 'returnRoutes.js');

let controller = fs.readFileSync(CONTROLLER_PATH, 'utf8');

if (!controller.includes('const deleteReturn')) {
  const deleteFn =
    "\nconst deleteReturn = async (req, res) => {\n" +
    "  const { id } = req.params;\n" +
    "  const client = await pool.connect();\n" +
    "  try {\n" +
    "    await client.query('BEGIN');\n\n" +
    "    const { rows } = await client.query('SELECT * FROM returns WHERE id=$1', [id]);\n" +
    "    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Return record not found.' }); }\n" +
    "    const ret = rows[0];\n\n" +
    "    const { rows: loanRows } = await client.query('SELECT material_id, quantity FROM loans WHERE id=$1', [ret.loan_id]);\n" +
    "    if (!loanRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Associated loan not found.' }); }\n" +
    "    const loan = loanRows[0];\n" +
    "    const qtyToReverse = Number(ret.quantity || loan.quantity || 0);\n\n" +
    "    // Undo the stock restoration this return caused\n" +
    "    await client.query('UPDATE materials SET quantity = quantity - $1 WHERE id=$2', [qtyToReverse, loan.material_id]);\n\n" +
    "    // Remove the return record itself\n" +
    "    await client.query('DELETE FROM returns WHERE id=$1', [id]);\n\n" +
    "    // Recompute loan status from whatever returns (if any) still remain\n" +
    "    const { rows: sumRows } = await client.query('SELECT COALESCE(SUM(quantity),0) as total FROM returns WHERE loan_id=$1', [ret.loan_id]);\n" +
    "    const totalReturned = parseInt(sumRows[0].total, 10) || 0;\n" +
    "    const newStatus = totalReturned <= 0 ? 'Borrowed' : (totalReturned < Number(loan.quantity) ? 'Partially Returned' : 'Returned');\n" +
    "    await client.query('UPDATE loans SET status=$1 WHERE id=$2', [newStatus, ret.loan_id]);\n\n" +
    "    await client.query('COMMIT');\n" +
    "    res.json({ message: 'Return deleted and reversed.', reversed_quantity: qtyToReverse, loan_status: newStatus });\n" +
    "  } catch (error) {\n" +
    "    await client.query('ROLLBACK');\n" +
    "    res.status(500).json({ error: error.message });\n" +
    "  } finally { client.release(); }\n" +
    "};\n";

  controller = controller.replace(
    'module.exports = { getReturns, createReturn, getLoanReturnStatus };',
    deleteFn + '\nmodule.exports = { getReturns, createReturn, getLoanReturnStatus, deleteReturn };'
  );
  fs.writeFileSync(CONTROLLER_PATH, controller);
  console.log('returnController.js: added deleteReturn with stock/status reversal');
} else {
  console.log('returnController.js: deleteReturn already present, skipping');
}

let routes = fs.readFileSync(ROUTES_PATH, 'utf8');
if (!routes.includes("router.delete")) {
  routes = routes.replace(
    "const { getReturns, createReturn, getLoanReturnStatus } = require('../controllers/returnController');",
    "const { getReturns, createReturn, getLoanReturnStatus, deleteReturn } = require('../controllers/returnController');"
  );
  routes = routes.replace(
    "router.get('/loan/:loan_id/status', getLoanReturnStatus);",
    "router.get('/loan/:loan_id/status', getLoanReturnStatus);\nrouter.delete('/:id', deleteReturn);"
  );
  fs.writeFileSync(ROUTES_PATH, routes);
  console.log('returnRoutes.js: added DELETE /:id route');
} else {
  console.log('returnRoutes.js: DELETE route already present, skipping');
}

console.log('');
console.log('=== Verification ===');
const cFinal = fs.readFileSync(CONTROLLER_PATH, 'utf8');
const rFinal = fs.readFileSync(ROUTES_PATH, 'utf8');
console.log('returnController has deleteReturn:', cFinal.includes('const deleteReturn'));
console.log('returnRoutes has DELETE /:id:', rFinal.includes("router.delete('/:id'"));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "feat: delete return record with stock/status reversal" && git push origin main');
