console.log("🔥 APP.JS LOADED ON RENDER");

const express = require('express');
const cors = require('cors');

const app = express();

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());

// =========================
// REQUEST LOGGER
// =========================
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

// =========================
// ROUTES
// =========================
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/materials', require('./routes/materialRoutes'));
app.use('/api/contractors', require('./routes/contractorRoutes'));
app.use('/api/loans', require('./routes/loanRoutes'));
app.use('/api/returns', require('./routes/returnRoutes'));
app.use('/api/repairs', require('./routes/repairRoutes'));

// =========================
// HEALTH CHECK
// =========================
app.get('/', (req, res) => {
  res.json({
    status: "OK",
    message: "🚀 BASIRAH 360 API IS RUNNING"
  });
});

module.exports = app;