const express = require('express');
const router = express.Router();

const {
  getMaterials,
  createMaterial,
  uploadExcel,
} = require('../controllers/materialController');

router.get('/', getMaterials);
router.post('/', createMaterial);

// uploadExcel is an array [multerMiddleware, asyncHandler]
// Express accepts an array of middlewares in router.post()
router.post('/upload-excel', uploadExcel);

module.exports = router;
