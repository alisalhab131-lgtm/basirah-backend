const bcrypt = require('bcryptjs');

(async () => {
  console.log(await bcrypt.hash('123456', 10));
})();