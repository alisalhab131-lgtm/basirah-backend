console.log("🚨 SERVER FILE LOADED ON RENDER");

require('dotenv').config();

const app = require('./app');

// IMPORTANT: ensure DB loads AFTER env
require('./database/db');

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log("=========================================");
  console.log(`🚀 BASIRAH 360 CORE API ONLINE ON PORT ${PORT}`);
  console.log("=========================================");
});