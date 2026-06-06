const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  },
  // Extra safety guardrails for production:
  max: 10, // Max connections allowed at once
  idleTimeoutMillis: 30000, // Close lazy connections automatically after 30 seconds
  connectionTimeoutMillis: 2000 // Error out quickly instead of hanging if Neon is asleep
});

// Test query to log connection on boot without locking a slot open
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL Connection Operational'))
  .catch(err => console.error('❌ Database Connection Error:', err.message));

module.exports = pool;