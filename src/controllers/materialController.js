const express = require('express');



const router = express.Router();



const {

  getMaterials,

  createMaterial

} = require('../controllers/materialController');



router.get('/', getMaterials);



router.post('/', createMaterial);



module.exports = router; 

