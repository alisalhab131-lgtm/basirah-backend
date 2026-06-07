const jwt = require('jsonwebtoken');

// VERIFY TOKEN (LOGIN PROTECTION)
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Format: Bearer TOKEN
    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secretkey'
    );

    req.user = decoded;

    next();

  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// ROLE CHECK (ADMIN / USER CONTROL)
const requireRole = (roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      next();

    } catch (error) {
      return res.status(500).json({ message: 'Server error' });
    }
  };
};

module.exports = {
  verifyToken,
  requireRole
};