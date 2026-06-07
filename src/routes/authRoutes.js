const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  console.log("🔥 LOGIN ROUTE WORKING");
  res.json({ ok: true });
});

module.exports = router;