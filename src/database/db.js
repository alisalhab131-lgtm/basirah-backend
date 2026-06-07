const { Pool } = require('pg');
require('dotenv').config();

let pool;

// If Railway provides a unified connection string, use it (Production Cloud)
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  // Otherwise, use your local discrete credentials (Your Laptop)
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'inventory_system',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: false // This stops the SSL error on your local laptop!
  });
}

// Test connection instantly on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('✅ Database connected successfully!');
  }
});

module.exports = pool;