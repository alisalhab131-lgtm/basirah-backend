console.log("🚨 SERVER START");

require('dotenv').config();

const app = require('./app');

// handle DB AFTER app load (safe order)
require('./database/db');

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log("=================================");
  console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
  console.log("=================================");
});