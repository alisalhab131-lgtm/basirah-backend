console.log("🔥 APP LOADED");

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// ROUTES
// ==========================================
const authRoutes = require('./routes/authRoutes');
const materialRoutes = require('./routes/materialRoutes');
const contractorRoutes = require('./routes/contractorRoutes');
const loanRoutes = require('./routes/loanRoutes');
const returnRoutes = require('./routes/returnRoutes');
const repairRoutes = require('./routes/repairRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/repairs', repairRoutes);

app.get('/test', (req, res) => {
  res.json({ message: 'backend works' });
});

module.exports = app;
