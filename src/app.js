const express = require('express');
const cors = require('cors');

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
    // Allow requests with no origin (like direct browser URLs, Postman, or curl)
    if (!origin) return callback(null, true);
    
    if (
      origin === 'https://basirah-360.vercel.app' || 
      origin.includes('localhost') || 
      origin.includes('127.0.0.1') || 
      origin.endsWith('.vercel.app') // Dynamically allows all automatic Vercel build URLs
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

// System Routes
app.use('/api/materials', materialRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/repairs', repairRoutes); 

// ONLY export the app. DO NOT listen here.
module.exports = app;