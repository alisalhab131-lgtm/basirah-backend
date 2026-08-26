/**
 * fix-export.js
 * Run from backend folder: node fix-export.js
 * Fixes the type mismatch in exportMaterials and loanCheck queries
 */
const fs = require('fs');
const path = require('path');

const CONTROLLER = path.join(__dirname, 'src', 'controllers', 'materialController.js');
let c = fs.readFileSync(CONTROLLER, 'utf8');

// Fix exportMaterials - cast material_id to integer for the join
const oldExport = "const exportMaterials = async (req, res) => {\n  try {\n    const { rows } = await pool.query(\n      'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +\n      'COUNT(l.id) FILTER (WHERE l.status NOT IN (' + \"'Returned','Cancelled'\" + ')) AS active_loans, ' +\n      'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (' + \"'Returned','Cancelled'\" + ')),0) AS qty_on_loan ' +\n      'FROM materials m LEFT JOIN loans l ON l.material_id=m.id GROUP BY m.id ORDER BY m.name ASC'\n    );\n    res.json(rows);\n  } catch (e) { res.status(500).json({ error: e.message }); }\n};";

const newExport = "const exportMaterials = async (req, res) => {\n  try {\n    const { rows } = await pool.query(\n      'SELECT m.id, m.name, m.category, m.quantity AS in_stock, m.barcode, ' +\n      'COUNT(l.id) FILTER (WHERE l.status NOT IN (' + \"'Returned','Cancelled'\" + ')) AS active_loans, ' +\n      'COALESCE(SUM(l.quantity) FILTER (WHERE l.status NOT IN (' + \"'Returned','Cancelled'\" + ')),0) AS qty_on_loan ' +\n      'FROM materials m LEFT JOIN loans l ON l.material_id::integer=m.id GROUP BY m.id ORDER BY m.name ASC'\n    );\n    res.json(rows);\n  } catch (e) { res.status(500).json({ error: e.message }); }\n};";

// Fix loanCheck - same cast issue
const oldLoan = "  WHERE l.material_id=$1 AND l.status NOT IN (' + \"'Returned','Cancelled'\" + ')'";
const newLoan = "  WHERE l.material_id::integer=$1 AND l.status NOT IN (' + \"'Returned','Cancelled'\" + ')'";

// Fix deleteMaterial queries - same cast
const oldDel1 = "'SELECT id FROM loans WHERE material_id=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ') LIMIT 1'";
const newDel1 = "'SELECT id FROM loans WHERE material_id::integer=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ') LIMIT 1'";

const oldDel2 = "'DELETE FROM loans WHERE material_id=$1'";
const newDel2 = "'DELETE FROM loans WHERE material_id::integer=$1'";

const oldDel3 = "'UPDATE loans SET status=' + \"'Cancelled'\" + ' WHERE material_id=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ')'";
const newDel3 = "'UPDATE loans SET status=' + \"'Cancelled'\" + ' WHERE material_id::integer=$1 AND status NOT IN (' + \"'Returned','Cancelled'\" + ')'";

// Apply all fixes
if (c.includes(oldExport)) { c = c.replace(oldExport, newExport); console.log('fixed exportMaterials join'); }
else { console.log('exportMaterials join not found - applying regex fix'); c = c.replace(/l\.material_id=m\.id/g, 'l.material_id::integer=m.id'); }

c = c.replace(/l\.material_id=\$1/g, 'l.material_id::integer=$1');
c = c.replace(/material_id=\$1/g, 'material_id::integer=$1');

fs.writeFileSync(CONTROLLER, c);

// Verify
const result = fs.readFileSync(CONTROLLER, 'utf8');
console.log('material_id::integer present:', result.includes('material_id::integer'));
console.log('exportMaterials present:', result.includes('exportMaterials'));
console.log('Done. Now: git add -A && git commit -m "fix: cast material_id to integer" && git push origin main');
