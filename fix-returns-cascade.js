/**
 * fix-returns-cascade.js
 * Run from backend folder: node fix-returns-cascade.js
 *
 * Root cause: returns table has FK returns.loan_id -> loans.id
 * Our cascade strategy deleted loans directly without first removing
 * any returns rows pointing at them, so Postgres blocked the loans
 * DELETE with a second FK violation (returns_loan_id_fkey), which
 * bubbled up through our safety net as a generic message.
 *
 * Fix: cascade now deletes in the correct order:
 *   returns (via loan_id subquery) -> loans -> materials/contractors
 */
const fs = require('fs');
const path = require('path');

const MAT_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'materialController.js');
const CON_CONTROLLER = path.join(__dirname, 'src', 'controllers', 'contractorController.js');

// ============================================================
// materialController.js - fix cascade to clean up returns first
// ============================================================
let mc = fs.readFileSync(MAT_CONTROLLER, 'utf8');

const oldMatCascade =
  "if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM loans WHERE material_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {";

const newMatCascade =
  "if (strategy === 'cascade') {\n" +
  "      // Delete returns FIRST (they reference loans via loan_id),\n" +
  "      // then loans (they reference this material), then the material itself.\n" +
  "      await client.query('DELETE FROM returns WHERE loan_id IN (SELECT id FROM loans WHERE material_id::integer=$1)', [id]);\n" +
  "      await client.query('DELETE FROM loans WHERE material_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM materials WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {";

if (mc.includes(oldMatCascade)) {
  mc = mc.replace(oldMatCascade, newMatCascade);
  console.log('materialController.js: cascade now cleans up returns before loans');
} else {
  console.log('materialController.js: WARNING exact cascade block not found - showing current content for manual check:');
  const idx = mc.indexOf("if (strategy === 'cascade')");
  console.log(mc.slice(idx, idx + 300));
}

fs.writeFileSync(MAT_CONTROLLER, mc);

// ============================================================
// contractorController.js - same fix
// ============================================================
let cc = fs.readFileSync(CON_CONTROLLER, 'utf8');

const oldConCascade =
  "if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM loans WHERE contractor_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM contractors WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {";

const newConCascade =
  "if (strategy === 'cascade') {\n" +
  "      await client.query('DELETE FROM returns WHERE loan_id IN (SELECT id FROM loans WHERE contractor_id::integer=$1)', [id]);\n" +
  "      await client.query('DELETE FROM loans WHERE contractor_id::integer=$1', [id]);\n" +
  "      await client.query('DELETE FROM contractors WHERE id=$1', [id]);\n" +
  "    } else if (strategy === 'soft') {";

if (cc.includes(oldConCascade)) {
  cc = cc.replace(oldConCascade, newConCascade);
  console.log('contractorController.js: cascade now cleans up returns before loans');
} else {
  console.log('contractorController.js: WARNING exact cascade block not found - showing current content for manual check:');
  const idx = cc.indexOf("if (strategy === 'cascade')");
  console.log(cc.slice(idx, idx + 300));
}

fs.writeFileSync(CON_CONTROLLER, cc);

// ============================================================
// Verify
// ============================================================
console.log('');
console.log('=== Verification ===');
const mcFinal = fs.readFileSync(MAT_CONTROLLER, 'utf8');
const ccFinal = fs.readFileSync(CON_CONTROLLER, 'utf8');

console.log('materialController: deletes returns before loans:', mcFinal.includes('DELETE FROM returns WHERE loan_id IN (SELECT id FROM loans WHERE material_id'));
console.log('contractorController: deletes returns before loans:', ccFinal.includes('DELETE FROM returns WHERE loan_id IN (SELECT id FROM loans WHERE contractor_id'));
console.log('');
console.log('Done. Now run:');
console.log('  git add -A && git commit -m "fix: cascade delete cleans up returns table before loans" && git push origin main');
