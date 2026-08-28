/**
 * fix-fk-final.js
 * Run from backend folder: node fix-fk-final.js
 *
 * Root cause: deleteMaterial/deleteContractor only checked for ACTIVE loans
 * before attempting a raw hard delete. A material/contractor with only
 * HISTORICAL loans (status = 'Returned' or 'Cancelled') still has rows in
 * the loans table referencing it, so the plain DELETE crashed with a raw
 * Postgres foreign key violation.
 *
 * Fixes:
 *   1. loanCheck (materials + contractors) now returns ALL linked loans,
 *      not just active ones, so the frontend modal appears whenever ANY
 *      loan history exists.
 *   2. deleteMaterial / deleteContractor now check for ANY loan (any status)
 *      before the 'block' strategy's raw delete, not just active ones.
 *   3. Every raw DELETE is wrapped to catch Postgres FK violation (code 23503)
 *      and return a clean 409 instead of crashing with a raw 500 error,
 *      as a safety net for any case we haven't anticipated.
 */
const fs = require('fs');
const path = require('path');

const MAT_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'materialController.js');
const CON_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'contractorController.js');

// ============================================================
// 1. Fix materialController.js
// ============================================================
let mc = fs.readFileSync(MAT_CONTROLLER, 'utf8');

// ── Fix loanCheck: return ALL loans, not just active ────────────────────
const oldMatLoanCheck =
  "const loanCheck = async (req, res) => {\n" +
  "  try {\n" +
  "    const { rows: loans } = await pool.query(`\n" +
  "      SELECT l.id, l.quantity, l.status, c.contact_person, c.company_name\n" +
  "      FROM   loans l\n" +
  "      JOIN   contractors c ON l.contractor_id = c.id\n" +
  "      WHERE  l.material_id = $1\n" +
  "        AND  l.status NOT IN ('Returned','Cancelled')\n" +
  "    `, [req.params.id]);\n" +
  "    res.json({ hasLoans: loans.length > 0, loans });\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};";

const newMatLoanCheck =
  "const loanCheck = async (req, res) => {\n" +
  "  try {\n" +
  "    const { rows: loans } = await pool.query(\n" +
  "      'SELECT l.id, l.quantity, l.status, c.contact_person, c.company_name ' +\n" +
  "      'FROM loans l JOIN contractors c ON l.contractor_id::integer = c.id ' +\n" +
  "      'WHERE l.material_id::integer = $1 ORDER BY l.id DESC',\n" +
  "      [req.params.id]\n" +
  "    );\n" +
  "    const activeLoans = loans.filter(l => !['Returned', 'Cancelled'].includes(l.status));\n" +
  "    res.json({ hasLoans: loans.length > 0, hasActiveLoans: activeLoans.length > 0, loans });\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};";

if (mc.includes(oldMatLoanCheck)) {
  mc = mc.replace(oldMatLoanCheck, newMatLoanCheck);
  console.log('materialController.js: loanCheck updated to return ALL loans');
} else {
  console.log('materialController.js: exact loanCheck text not matched, trying loose replace...');
  mc = mc.replace(
    /const loanCheck = async \(req, res\) => \{[\s\S]*?\n\};/,
    newMatLoanCheck
  );
  console.log('materialController.js: loanCheck replaced via regex fallback');
}

// ── Fix deleteMaterial: check ANY loans, add FK-violation safety net ────
const oldDeleteMaterial =
  "const deleteMaterial = async (req, res) => {\n" +
  "  const { id } = req.params;\n" +
  "  const strategy = (req.query.strategy || 'block').toLowerCase();\n" +
  "  const client = await pool.connect();\n" +
  "  try {\n" +
  "    await client.query('BEGIN');\n" +
  "    const { rows: active } = await client.query(\n" +
  "      \"SELECT id FROM loans WHERE material_id::integer=$1 AND status NOT IN ('Returned','Cancelled') LIMIT 1\", [id]\n" +
  "    );\n" +
  "    if (active.length && strategy === 'block') {\n" +
  "      await client.query('ROLLBACK');\n" +
  "      return res.status(409).json({ error: 'Material has active loans. Choose cascade or soft strategy.' });\n" +
  "    }\n" +
  "    if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM loans WHERE material_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {\n" +
  "      await client.query(\"UPDATE loans SET status='Cancelled' WHERE material_id::integer=$1 AND status NOT IN ('Returned','Cancelled')\", [id]);\n" +
  "      try { await client.query('UPDATE materials SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1', [id]); }\n" +
  "      catch { await client.query('DELETE FROM materials WHERE id=$1', [id]); }\n" +
  "    } else {\n" +
  "      const { rowCount } = await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }\n" +
  "    }\n" +
  "    await client.query('COMMIT');\n" +
  "    syncToOneDrive();\n" +
  "    res.json({ message: 'Deleted.', strategy });\n" +
  "  } catch (error) {\n" +
  "    await client.query('ROLLBACK');\n" +
  "    res.status(500).json({ error: error.message });\n" +
  "  } finally { client.release(); }\n" +
  "};";

const newDeleteMaterial =
  "const deleteMaterial = async (req, res) => {\n" +
  "  const { id } = req.params;\n" +
  "  const strategy = (req.query.strategy || 'block').toLowerCase();\n" +
  "  const client = await pool.connect();\n" +
  "  try {\n" +
  "    await client.query('BEGIN');\n" +
  "    // Check for ANY loan history (not just active) - historical rows still\n" +
  "    // block a raw DELETE due to the foreign key, even if status is Returned.\n" +
  "    const { rows: anyLoans } = await client.query(\n" +
  "      'SELECT id, status FROM loans WHERE material_id::integer=$1', [id]\n" +
  "    );\n" +
  "    const hasActive = anyLoans.some(l => !['Returned','Cancelled'].includes(l.status));\n\n" +
  "    if (anyLoans.length && strategy === 'block') {\n" +
  "      await client.query('ROLLBACK');\n" +
  "      return res.status(409).json({\n" +
  "        error: hasActive\n" +
  "          ? 'Material has active loans. Choose cascade or soft strategy.'\n" +
  "          : 'Material has historical loan records. Choose cascade (delete history too) or soft (archive, keep history).'\n" +
  "      });\n" +
  "    }\n\n" +
  "    if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM loans WHERE material_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {\n" +
  "      await client.query(\"UPDATE loans SET status='Cancelled' WHERE material_id::integer=$1 AND status NOT IN ('Returned','Cancelled')\", [id]);\n" +
  "      try { await client.query('UPDATE materials SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1', [id]); }\n" +
  "      catch { await client.query('DELETE FROM materials WHERE id=$1', [id]); }\n" +
  "    } else {\n" +
  "      // No loans at all - safe to hard delete\n" +
  "      const { rowCount } = await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "      if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }\n" +
  "    }\n" +
  "    await client.query('COMMIT');\n" +
  "    syncToOneDrive();\n" +
  "    res.json({ message: 'Deleted.', strategy });\n" +
  "  } catch (error) {\n" +
  "    await client.query('ROLLBACK');\n" +
  "    // Safety net: if Postgres still reports a FK violation for any\n" +
  "    // reason we didn't anticipate, respond cleanly instead of a raw 500.\n" +
  "    if (error.code === '23503') {\n" +
  "      return res.status(409).json({ error: 'This material is still referenced by loan records. Use cascade or soft strategy.' });\n" +
  "    }\n" +
  "    res.status(500).json({ error: error.message });\n" +
  "  } finally { client.release(); }\n" +
  "};";

if (mc.includes(oldDeleteMaterial)) {
  mc = mc.replace(oldDeleteMaterial, newDeleteMaterial);
  console.log('materialController.js: deleteMaterial hardened against historical loans + FK safety net');
} else {
  console.log('materialController.js: exact deleteMaterial text not matched, trying loose replace...');
  mc = mc.replace(
    /const deleteMaterial = async \(req, res\) => \{[\s\S]*?\n\};/,
    newDeleteMaterial
  );
  console.log('materialController.js: deleteMaterial replaced via regex fallback');
}

fs.writeFileSync(MAT_CONTROLLER, mc);

// ============================================================
// 2. Fix contractorController.js (identical pattern)
// ============================================================
let cc = fs.readFileSync(CON_CONTROLLER, 'utf8');

const oldConLoanCheck =
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
  "};";

const newConLoanCheck =
  "const loanCheck = async (req, res) => {\n" +
  "  try {\n" +
  "    const { rows: loans } = await pool.query(\n" +
  "      'SELECT l.id, l.quantity, l.status, m.name AS material_name ' +\n" +
  "      'FROM loans l JOIN materials m ON l.material_id::integer = m.id ' +\n" +
  "      'WHERE l.contractor_id::integer = $1 ORDER BY l.id DESC',\n" +
  "      [req.params.id]\n" +
  "    );\n" +
  "    const activeLoans = loans.filter(l => !['Returned', 'Cancelled'].includes(l.status));\n" +
  "    res.json({ hasLoans: loans.length > 0, hasActiveLoans: activeLoans.length > 0, loans });\n" +
  "  } catch (error) { res.status(500).json({ error: error.message }); }\n" +
  "};";

if (cc.includes(oldConLoanCheck)) {
  cc = cc.replace(oldConLoanCheck, newConLoanCheck);
  console.log('contractorController.js: loanCheck updated to return ALL loans');
} else {
  cc = cc.replace(
    /const loanCheck = async \(req, res\) => \{[\s\S]*?\n\};/,
    newConLoanCheck
  );
  console.log('contractorController.js: loanCheck replaced via regex fallback');
}

const oldDeleteContractor =
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
  "};";

const newDeleteContractor =
  "const deleteContractor = async (req, res) => {\n" +
  "  const { id } = req.params;\n" +
  "  const strategy = (req.query.strategy || 'block').toLowerCase();\n" +
  "  if (!['block','cascade','soft'].includes(strategy))\n" +
  "    return res.status(400).json({ error: 'strategy must be block, cascade, or soft' });\n\n" +
  "  const client = await pool.connect();\n" +
  "  try {\n" +
  "    await client.query('BEGIN');\n" +
  "    const { rows: anyLoans } = await client.query(\n" +
  "      'SELECT id, status FROM loans WHERE contractor_id::integer=$1', [id]\n" +
  "    );\n" +
  "    const hasActive = anyLoans.some(l => !['Returned','Cancelled'].includes(l.status));\n\n" +
  "    if (anyLoans.length && strategy === 'block') {\n" +
  "      await client.query('ROLLBACK');\n" +
  "      return res.status(409).json({\n" +
  "        error: hasActive\n" +
  "          ? 'Contractor has active loans. Use cascade or soft strategy.'\n" +
  "          : 'Contractor has historical loan records. Choose cascade (delete history too) or soft (archive, keep history).'\n" +
  "      });\n" +
  "    }\n\n" +
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
  "    if (error.code === '23503') {\n" +
  "      return res.status(409).json({ error: 'This contractor is still referenced by loan records. Use cascade or soft strategy.' });\n" +
  "    }\n" +
  "    res.status(500).json({ error: error.message });\n" +
  "  } finally { client.release(); }\n" +
  "};";

if (cc.includes(oldDeleteContractor)) {
  cc = cc.replace(oldDeleteContractor, newDeleteContractor);
  console.log('contractorController.js: deleteContractor hardened against historical loans + FK safety net');
} else {
  cc = cc.replace(
    /const deleteContractor = async \(req, res\) => \{[\s\S]*?\n\};/,
    newDeleteContractor
  );
  console.log('contractorController.js: deleteContractor replaced via regex fallback');
}

fs.writeFileSync(CON_CONTROLLER, cc);

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const mcFinal = fs.readFileSync(MAT_CONTROLLER, 'utf8');
const ccFinal = fs.readFileSync(CON_CONTROLLER, 'utf8');

console.log('materialController: checks ANY loans before block:', mcFinal.includes('anyLoans'));
console.log('materialController: has FK safety net (23503):', mcFinal.includes("'23503'"));
console.log('contractorController: checks ANY loans before block:', ccFinal.includes('anyLoans'));
console.log('contractorController: has FK safety net (23503):', ccFinal.includes("'23503'"));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: check ALL loan history before delete, add FK violation safety net" && git push origin main');
