/**
 * src/server.js  (UPDATED — adds OneDrive sync loop on startup)
 * Only change vs original: import + call startSyncLoop()
 */

console.log("🚨 SERVER START");

require('dotenv').config();

const app = require('./app');

require('./database/db');

// ── NEW: start live OneDrive ↔ DB sync ────────────────────────────────────
const { startSyncLoop } = require('./services/oneDriveSync');
startSyncLoop();
// ─────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log("=================================");
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
  console.log("=================================");
});
