require('dotenv').config();
require('./database/db');
const app = require('./app');

// Railway automatically injects the correct port into process.env.PORT
const PORT = process.env.PORT || 5000;

// '0.0.0.0' forces the container to accept external web requests from Vercel
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🚀 BASIRAH 360 CORE API ONLINE ON PORT ${PORT}`);
  console.log(`=========================================`);
});