console.log("🔥 APP.JS LOADED");

const express = require('express');
const cors = require('cors');

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// ROUTES
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

// mount routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// test route
app.get('/', (req, res) => {
  res.send('API is running...');
});

module.exports = app;