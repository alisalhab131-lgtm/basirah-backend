console.log("🔥 APP LOADED");

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/test', (req, res) => {
  res.json({ message: 'backend works' });
});

module.exports = app;