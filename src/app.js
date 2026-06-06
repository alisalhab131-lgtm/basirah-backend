const express = require('express');
const cors = require('cors');

const materialRoutes = require('./routes/materialRoutes');
const contractorRoutes = require('./routes/contractorRoutes');
const loanRoutes = require('./routes/loanRoutes');
const returnRoutes = require('./routes/returnRoutes');
const repairRoutes = require('./routes/repairRoutes'); // <-- ADD THIS

const app = express();

app.use(cors({
  origin: [
    'https://basirah-360.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Inventory System API is running'
  });
});

app.use('/api/materials', materialRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/repairs', repairRoutes); // <-- ADD THIS

module.exports = app;