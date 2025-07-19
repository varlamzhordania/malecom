// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// Authenticate JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const [users] = await pool.execute(
      'SELECT id, email, role, is_active, is_verified FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    if (!user.is_verified) {
      return res.status(401).json({
        success: false,
        message: 'Email not verified'
      });
    }

    // Add user info to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role
    };

    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token has expired'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const [users] = await pool.execute(
      'SELECT id, email, role, is_active, is_verified FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length > 0 && users[0].is_active && users[0].is_verified) {
      req.user = {
        userId: users[0].id,
        email: users[0].email,
        role: users[0].role
      };
    } else {
      req.user = null;
    }

    next();

  } catch (error) {
    // If token is invalid, just set user to null and continue
    req.user = null;
    next();
  }
};

// Require specific roles
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Admin only middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

// Property owner only middleware
const requirePropertyOwner = (req, res, next) => {
  if (!req.user || (req.user.role !== 'property_owner' && req.user.role !== 'admin')) {
    return res.status(403).json({
      success: false,
      message: 'Property owner access required'
    });
  }
  next();
};

// Check if user owns the resource
const requireOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      const userId = req.user.userId;

      let query;
      let params = [resourceId];

      switch (resourceType) {
        case 'suite':
          query = 'SELECT owner_id FROM suites WHERE id = ?';
          break;
        case 'booking':
          query = `SELECT guest_id, guest_email, s.owner_id 
                   FROM bookings b 
                   JOIN suites s ON b.suite_id = s.id 
                   WHERE b.id = ?`;
          break;
        case 'property_owner_profile':
          query = 'SELECT user_id FROM property_owners WHERE id = ?';
          break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid resource type'
          });
      }

      const [results] = await pool.execute(query, params);

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      const resource = results[0];
      let hasAccess = false;

      // Admin has access to everything
      if (req.user.role === 'admin') {
        hasAccess = true;
      } else {
        switch (resourceType) {
          case 'suite':
            hasAccess = resource.owner_id === userId;
            break;
          case 'booking':
            hasAccess = resource.guest_id === userId || 
                       resource.guest_email === req.user.email ||
                       resource.owner_id === userId;
            break;
          case 'property_owner_profile':
            hasAccess = resource.user_id === userId;
            break;
        }
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this resource'
        });
      }

      next();

    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify ownership'
      });
    }
  };
};

// Check if property owner is verified
const requireVerifiedOwner = async (req, res, next) => {
  try {
    if (req.user.role !== 'property_owner') {
      return next();
    }

    const [owners] = await pool.execute(
      'SELECT verification_status FROM property_owners WHERE user_id = ?',
      [req.user.userId]
    );

    if (owners.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Property owner profile not found'
      });
    }

    if (owners[0].verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Property owner verification required'
      });
    }

    next();

  } catch (error) {
    console.error('Verification check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify owner status'
    });
  }
};

// Rate limiting middleware
const createRateLimiter = (windowMs, max, message) => {
  const rateLimit = require('express-rate-limit');
  
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Custom key generator for user-specific limits
    keyGenerator: (req) => {
      return req.user?.userId || req.ip;
    }
  });
};

// API key authentication for external integrations
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Check if API key exists and is active
    const [keys] = await pool.execute(
      'SELECT user_id, permissions FROM api_keys WHERE key_hash = ? AND is_active = true',
      [apiKey] // In production, hash the API key
    );

    if (keys.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }

    const keyData = keys[0];
    
    // Get user info
    const [users] = await pool.execute(
      'SELECT id, email, role FROM users WHERE id = ? AND is_active = true',
      [keyData.user_id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'API key user not found'
      });
    }

    req.user = {
      userId: users[0].id,
      email: users[0].email,
      role: users[0].role,
      apiPermissions: JSON.parse(keyData.permissions || '[]')
    };

    req.isApiRequest = true;

    next();

  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({
      success: false,
      message: 'API authentication failed'
    });
  }
};

// Check API permissions
const requireApiPermission = (permission) => {
  return (req, res, next) => {
    if (!req.isApiRequest) {
      return next(); // Skip for regular user requests
    }

    if (!req.user.apiPermissions || !req.user.apiPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `API permission '${permission}' required`
      });
    }

    next();
  };
};

// Audit logging middleware
const auditLog = (action) => {
  return async (req, res, next) => {
    // Store original end function
    const originalEnd = res.end;

    // Override end function to capture response
    res.end = function(chunk, encoding) {
      // Log the action
      try {
        pool.execute(
          `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, request_data, response_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user?.userId || null,
            action,
            req.route?.path?.split('/')[1] || 'unknown',
            req.params.id || null,
            req.ip,
            req.get('User-Agent'),
            JSON.stringify(req.body),
            res.statusCode
          ]
        ).catch(err => console.error('Audit log error:', err));
      } catch (error) {
        console.error('Audit logging failed:', error);
      }

      // Call original end function
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
};

// Session validation for sensitive operations
const requireRecentAuth = (maxAgeMinutes = 30) => {
  return async (req, res, next) => {
    try {
      // Check if user has recent authentication
      const authTimestamp = req.headers['x-auth-timestamp'];
      
      if (!authTimestamp) {
        return res.status(401).json({
          success: false,
          message: 'Recent authentication required'
        });
      }

      const authTime = new Date(parseInt(authTimestamp));
      const now = new Date();
      const diffMinutes = (now - authTime) / (1000 * 60);

      if (diffMinutes > maxAgeMinutes) {
        return res.status(401).json({
          success: false,
          message: 'Authentication too old, please re-authenticate'
        });
      }

      next();

    } catch (error) {
      console.error('Recent auth check error:', error);
      res.status(500).json({
        success: false,
        message: 'Authentication validation failed'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requirePropertyOwner,
  requireOwnership,
  requireVerifiedOwner,
  createRateLimiter,
  authenticateApiKey,
  requireApiPermission,
  auditLog,
  requireRecentAuth
};