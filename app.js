console.log("🔥 APP LOADED");

const express = require('express');
const cors = require('cors');

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= TEST ROUTE =================
app.get('/test', (req, res) => {
  res.json({ message: "backend works" });
});

// ================= ROUTES =================
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const materialRoutes = require('./routes/materialRoutes');
const contractorRoutes = require('./routes/contractorRoutes');
const loanRoutes = require('./routes/loanRoutes');
const returnRoutes = require('./routes/returnRoutes');

// ================= MOUNT ROUTES =================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/returns', returnRoutes);

// ================= ROOT =================
app.get('/', (req, res) => {
  res.send('API is running...');
});

module.exports = app;