/**
 * add-partial-returns.js
 * Run from backend folder: node add-partial-returns.js
 *
 * Adds partial-return support:
 *   1. returns.quantity column (tracks how much was returned in each event)
 *   2. createReturn now accepts an optional returned_quantity in the body -
 *      validates it against what's actually still outstanding on the loan
 *   3. Loan status becomes 'Partially Returned' if some (not all) quantity
 *      is returned, or 'Returned' once fully closed out
 */
const fs = require('fs');
const path = require('path');

const MIGRATE_PATH = path.join(__dirname, 'src', 'database', 'migrate.js');
const RETURN_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'returnController.js');

// ============================================================
// 1. Add returns.quantity column + backfill legacy rows
// ============================================================
let migrate = fs.readFileSync(MIGRATE_PATH, 'utf8');

if (!migrate.includes('returns.*quantity') && !migrate.includes("ADD COLUMN IF NOT EXISTS quantity")) {
  migrate = migrate.replace(
    "console.log('[Migrate] is_deleted / deleted_at columns verified on materials + contractors');",
    "console.log('[Migrate] is_deleted / deleted_at columns verified on materials + contractors');\n" +
    "    await pool.query('ALTER TABLE returns ADD COLUMN IF NOT EXISTS quantity INTEGER');\n" +
    "    await pool.query(\n" +
    "      'UPDATE returns r SET quantity = l.quantity FROM loans l ' +\n" +
    "      'WHERE r.loan_id = l.id AND r.quantity IS NULL'\n" +
    "    );\n" +
    "    console.log('[Migrate] returns.quantity column verified + backfilled');"
  );
  fs.writeFileSync(MIGRATE_PATH, migrate);
  console.log('migrate.js: added returns.quantity migration + backfill');
} else {
  console.log('migrate.js: returns.quantity migration already present, skipping');
}

// ============================================================
// 2. Rewrite returnController.js with partial-return logic
// ============================================================
const newController =
  "const pool = require('../database/db');\n\n" +
  "const getReturns = async (req, res) => {\n" +
  "  try {\n" +
  "    const result = await pool.query(\n" +
  "      'SELECT r.*, m.name as material_name, c.contact_person, l.site_name, l.quantity as loan_quantity ' +\n" +
  "      'FROM returns r ' +\n" +
  "      'JOIN loans l ON r.loan_id = l.id ' +\n" +
  "      'JOIN materials m ON l.material_id = m.id ' +\n" +
  "      'JOIN contractors c ON l.contractor_id = c.id ' +\n" +
  "      'ORDER BY r.id DESC'\n" +
  "    );\n" +
  "    res.json(result.rows);\n" +
  "  } catch (error) {\n" +
  "    res.status(500).json({ error: error.message });\n" +
  "  }\n" +
  "};\n\n" +
  "// GET /api/returns/loan/:loan_id/status - tells the frontend how much is\n" +
  "// still outstanding on a loan, so it can show/limit the quantity input\n" +
  "const getLoanReturnStatus = async (req, res) => {\n" +
  "  try {\n" +
  "    const { loan_id } = req.params;\n" +
  "    const loanResult = await pool.query('SELECT quantity, status FROM loans WHERE id=$1', [loan_id]);\n" +
  "    if (!loanResult.rows.length) return res.status(404).json({ error: 'Loan not found' });\n" +
  "    const loan = loanResult.rows[0];\n" +
  "    const returnedResult = await pool.query(\n" +
  "      'SELECT COALESCE(SUM(quantity),0) as total FROM returns WHERE loan_id=$1', [loan_id]\n" +
  "    );\n" +
  "    const alreadyReturned = parseInt(returnedResult.rows[0].total, 10) || 0;\n" +
  "    const remaining = Math.max(0, Number(loan.quantity) - alreadyReturned);\n" +
  "    res.json({ loan_quantity: Number(loan.quantity), already_returned: alreadyReturned, remaining, status: loan.status });\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};\n\n" +
  "const createReturn = async (req, res) => {\n" +
  "  const client = await pool.connect();\n" +
  "  try {\n" +
  "    const { loan_id, returned_condition, damaged, repair_cost, notes, returned_quantity } = req.body;\n" +
  "    const return_date = new Date().toISOString().split('T')[0];\n\n" +
  "    await client.query('BEGIN');\n\n" +
  "    const loanCheck = await client.query('SELECT material_id, quantity, status FROM loans WHERE id = $1', [loan_id]);\n" +
  "    if (loanCheck.rows.length === 0) throw new Error('Loan record not found');\n\n" +
  "    const loan = loanCheck.rows[0];\n" +
  "    if (loan.status === 'Returned') throw new Error('This loan has already been fully returned.');\n\n" +
  "    // How much has already come back on this loan across prior partial returns?\n" +
  "    const alreadyReturnedResult = await client.query(\n" +
  "      'SELECT COALESCE(SUM(quantity), 0) as total FROM returns WHERE loan_id = $1',\n" +
  "      [loan_id]\n" +
  "    );\n" +
  "    const alreadyReturned = parseInt(alreadyReturnedResult.rows[0].total, 10) || 0;\n" +
  "    const remaining = Number(loan.quantity) - alreadyReturned;\n\n" +
  "    if (remaining <= 0) throw new Error('This loan has already been fully returned.');\n\n" +
  "    // If the caller didn't specify a quantity, default to returning everything\n" +
  "    // still outstanding (keeps old behaviour working for existing callers).\n" +
  "    let qtyToReturn = (returned_quantity !== undefined && returned_quantity !== null && returned_quantity !== '')\n" +
  "      ? parseInt(returned_quantity, 10)\n" +
  "      : remaining;\n\n" +
  "    if (isNaN(qtyToReturn) || qtyToReturn <= 0) {\n" +
  "      throw new Error('Returned quantity must be greater than 0.');\n" +
  "    }\n" +
  "    if (qtyToReturn > remaining) {\n" +
  "      throw new Error('Cannot return ' + qtyToReturn + ' units - only ' + remaining + ' remaining on this loan.');\n" +
  "    }\n\n" +
  "    const returnResult = await client.query(\n" +
  "      'INSERT INTO returns (loan_id, return_date, returned_condition, damaged, repair_cost, notes, quantity) ' +\n" +
  "      'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',\n" +
  "      [loan_id, return_date, returned_condition, damaged || false, repair_cost || 0, notes || '', qtyToReturn]\n" +
  "    );\n\n" +
  "    const newRemaining = remaining - qtyToReturn;\n" +
  "    const newStatus = newRemaining <= 0 ? 'Returned' : 'Partially Returned';\n\n" +
  "    await client.query('UPDATE loans SET status = $1 WHERE id = $2', [newStatus, loan_id]);\n" +
  "    await client.query('UPDATE materials SET quantity = quantity + $1 WHERE id = $2', [qtyToReturn, loan.material_id]);\n\n" +
  "    await client.query('COMMIT');\n" +
  "    res.status(201).json({\n" +
  "      ...returnResult.rows[0],\n" +
  "      returned_quantity: qtyToReturn,\n" +
  "      remaining_quantity: newRemaining,\n" +
  "      loan_status: newStatus,\n" +
  "    });\n\n" +
  "  } catch (error) {\n" +
  "    await client.query('ROLLBACK');\n" +
  "    res.status(400).json({ error: error.message });\n" +
  "  } finally {\n" +
  "    client.release();\n" +
  "  }\n" +
  "};\n\n" +
  "module.exports = { getReturns, createReturn, getLoanReturnStatus };\n";

fs.writeFileSync(RETURN_CONTROLLER, newController);
console.log('returnController.js: rewritten with partial-return support');

// ============================================================
// 3. Add route for loan return status
// ============================================================
const RETURN_ROUTES = path.join(__dirname, 'src', 'routes', 'returnRoutes.js');
const newRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const { getReturns, createReturn, getLoanReturnStatus } = require('../controllers/returnController');\n\n" +
  "router.get('/', getReturns);\n" +
  "router.post('/', createReturn);\n" +
  "router.get('/loan/:loan_id/status', getLoanReturnStatus);\n\n" +
  "module.exports = router;\n";

fs.writeFileSync(RETURN_ROUTES, newRoutes);
console.log('returnRoutes.js: added GET /loan/:loan_id/status route');

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const migFinal = fs.readFileSync(MIGRATE_PATH, 'utf8');
const ctrlFinal = fs.readFileSync(RETURN_CONTROLLER, 'utf8');
const routesFinal = fs.readFileSync(RETURN_ROUTES, 'utf8');

console.log('migrate.js adds returns.quantity:', migFinal.includes('ADD COLUMN IF NOT EXISTS quantity'));
console.log('returnController accepts returned_quantity:', ctrlFinal.includes('returned_quantity'));
console.log('returnController has Partially Returned status:', ctrlFinal.includes('Partially Returned'));
console.log('returnRoutes has loan status endpoint:', routesFinal.includes('loan/:loan_id/status'));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "feat: partial return quantity support" && git push origin main');
