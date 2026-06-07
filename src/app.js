const express = require('express');
const cors = require('cors');
const db = require('./database/db'); 

const materialRoutes = require('./routes/materialRoutes');
const contractorRoutes = require('./routes/contractorRoutes');
const loanRoutes = require('./routes/loanRoutes');
const returnRoutes = require('./routes/returnRoutes');
const repairRoutes = require('./routes/repairRoutes'); 

const app = express();

// =========================================================
// DYNAMIC CORS ROUTING ENGINE
// =========================================================
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (
      origin === 'https://basirah-360.vercel.app' || 
      origin.includes('localhost') || 
      origin.includes('127.0.0.1') || 
      origin.endsWith('.vercel.app') 
    ) {
      return callback(null, true);
    } else {
      return callback(new Error('Blocked by Basirah Security Protocol (CORS)'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Base Server Check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Inventory System API is running'
  });
});

// Live Database Test Route
app.get('/db-test', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW(), version();');
    res.json({
      success: true,
      message: "Neon Database is fully integrated and responsive!",
      timestamp: result.rows[0].now,
      dbVersion: result.rows[0].version
    });
  } catch (err) {
    console.error("Database test route failed:", err);
    res.status(500).json({
      success: false,
      error: "Could not communicate with database",
      details: err.message
    });
  }
});

// System Routes
app.use('/api/materials', materialRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/repairs', repairRoutes); 

module.exports = app;