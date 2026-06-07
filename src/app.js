console.log("🔥 APP.JS LOADED ON RENDER");

const express = require('express');
const cors = require('cors');

const app = express(); // ✅ MUST BE FIRST

app.use(cors());
app.use(express.json());

// ROUTES
const authRoutes = require('./routes/authRoutes');
console.log("🔥 AUTH ROUTE IMPORTED");

app.use('/api/auth', authRoutes);
console.log("🔥 AUTH ROUTE MOUNTED");

app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/materials', require('./routes/materialRoutes'));
app.use('/api/contractors', require('./routes/contractorRoutes'));
app.use('/api/loans', require('./routes/loanRoutes'));
app.use('/api/returns', require('./routes/returnRoutes'));
app.use('/api/repairs', require('./routes/repairRoutes'));

module.exports = app;