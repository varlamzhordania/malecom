// backend/routes/auth.js
// Authentication routes with Multi-Factor Authentication (MFA) support

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required',
      error_code: 'TOKEN_MISSING'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get current user data from database
    const [users] = await req.db.execute(
      'SELECT * FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token',
        error_code: 'TOKEN_INVALID'
      });
    }

    req.user = users[0];
    next();
  } catch (error) {
    req.logger.error('Token verification failed', {
      error: error.message,
      token: token.substring(0, 20) + '...',
      ip: req.ip
    });
    
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token',
      error_code: 'TOKEN_INVALID'
    });
  }
};

// User Registration
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
  body('first_name').trim().isLength({ min: 1, max: 100 }),
  body('last_name').trim().isLength({ min: 1, max: 100 }),
  body('role').isIn(['client', 'property_owner']),
  body('phone').optional().isMobilePhone()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { email, password, first_name, last_name, phone, role } = req.body;

    // Check if user already exists
    const [existingUsers] = await req.db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
        error_code: 'USER_EXISTS'
      });
    }

    // Hash password with high cost factor
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const connection = await req.db.getConnection();
    await connection.beginTransaction();

    try {
      // Create user
      const [userResult] = await connection.execute(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone, role) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [email, password_hash, first_name, last_name, phone || null, role]
      );

      const userId = userResult.insertId;

      // If property owner, create property owner record
      if (role === 'property_owner') {
        await connection.execute(
          'INSERT INTO property_owners (user_id) VALUES (?)',
          [userId]
        );
      }

      await connection.commit();

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId, 
          email, 
          role,
          iat: Math.floor(Date.now() / 1000)
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || '30d' }
      );

      req.logger.info('User registered successfully', {
        userId,
        email,
        role,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          token,
          user: {
            id: userId,
            email,
            first_name,
            last_name,
            role,
            mfa_enabled: false
          }
        }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    req.logger.error('Registration error', {
      error: error.message,
      email: req.body.email,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error_code: 'REGISTRATION_ERROR'
    });
  }
});

// User Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists().isLength({ min: 1 }),
  body('mfa_token').optional().isLength({ min: 6, max: 6 }).isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { email, password, mfa_token } = req.body;

    // Find user with full details
    const [users] = await req.db.execute(
      `SELECT u.*, po.verification_status as owner_verification_status 
       FROM users u 
       LEFT JOIN property_owners po ON u.id = po.user_id 
       WHERE u.email = ? AND u.is_active = true`,
      [email]
    );

    if (users.length === 0) {
      // Log failed login attempt
      req.logger.warn('Login attempt with invalid email', {
        email,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        error_code: 'INVALID_CREDENTIALS'
      });
    }

    const user = users[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      req.logger.warn('Login attempt with invalid password', {
        userId: user.id,
        email,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        error_code: 'INVALID_CREDENTIALS'
      });
    }

    // Check MFA if enabled
    if (user.mfa_enabled) {
      if (!mfa_token) {
        return res.status(200).json({
          success: false,
          message: 'MFA token required',
          error_code: 'MFA_REQUIRED',
          mfa_required: true
        });
      }

      // Verify MFA token
      const verified = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: mfa_token,
        window: 1 // Allow 1 step tolerance
      });

      if (!verified) {
        req.logger.warn('Login attempt with invalid MFA token', {
          userId: user.id,
          email,
          ip: req.ip
        });
        
        return res.status(401).json({
          success: false,
          message: 'Invalid MFA token',
          error_code: 'INVALID_MFA_TOKEN'
        });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '30d' }
    );

    req.logger.info('User login successful', {
      userId: user.id,
      email,
      role: user.role,
      mfaUsed: !!mfa_token,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          profile_image: user.profile_image,
          mfa_enabled: user.mfa_enabled || false,
          is_verified: user.is_verified,
          owner_verification_status: user.owner_verification_status || null
        }
      }
    });

  } catch (error) {
    req.logger.error('Login error', {
      error: error.message,
      email: req.body.email,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error_code: 'LOGIN_ERROR'
    });
  }
});

// Enable Multi-Factor Authentication
router.post('/mfa/enable', authenticateToken, async (req, res) => {
  try {
    // Check if MFA is already enabled
    if (req.user.mfa_enabled) {
      return res.status(400).json({
        success: false,
        message: 'MFA is already enabled',
        error_code: 'MFA_ALREADY_ENABLED'
      });
    }

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `Malecom Suits (${req.user.email})`,
      issuer: 'Malecom Suits',
      length: 32
    });

    // Generate and hash backup codes
    const backupCodes = Array.from({length: 8}, () => 
      Math.random().toString(36).substr(2, 8).toUpperCase()
    );
    
    const hashedBackupCodes = await Promise.all(
      backupCodes.map(code => bcrypt.hash(code, 12))
    );

    // Store temporary secret and hashed backup codes
    await req.db.execute(
      `UPDATE users SET 
         mfa_temp_secret = ?, 
         mfa_backup_codes = ?
       WHERE id = ?`,
      [secret.base32, JSON.stringify(hashedBackupCodes), req.user.id]
    );

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    req.logger.info('MFA setup initiated', {
      userId: req.user.id,
      email: req.user.email
    });

    res.json({
      success: true,
      message: 'MFA setup initiated. Please scan the QR code and verify.',
      data: {
        qr_code: qrCode,
        manual_entry_key: secret.base32,
        backup_codes: backupCodes // Show once during setup
      }
    });

  } catch (error) {
    req.logger.error('MFA enable error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to enable MFA',
      error_code: 'MFA_ENABLE_ERROR'
    });
  }
});

// Verify MFA Setup
router.post('/mfa/verify', authenticateToken, [
  body('token').isLength({ min: 6, max: 6 }).isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { token } = req.body;

    // Get temporary secret
    const [users] = await req.db.execute(
      'SELECT mfa_temp_secret FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!users[0]?.mfa_temp_secret) {
      return res.status(400).json({
        success: false,
        message: 'MFA setup not initiated',
        error_code: 'MFA_NOT_INITIATED'
      });
    }

    // Verify TOTP token
    const verified = speakeasy.totp.verify({
      secret: users[0].mfa_temp_secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (verified) {
      // Move temp secret to permanent and enable MFA
      await req.db.execute(
        `UPDATE users SET 
           mfa_secret = mfa_temp_secret, 
           mfa_temp_secret = NULL, 
           mfa_enabled = true 
         WHERE id = ?`,
        [req.user.id]
      );

      req.logger.info('MFA enabled successfully', {
        userId: req.user.id,
        email: req.user.email
      });

      res.json({
        success: true,
        message: 'MFA enabled successfully'
      });
    } else {
      req.logger.warn('Invalid MFA verification token', {
        userId: req.user.id,
        email: req.user.email
      });
      
      res.status(400).json({
        success: false,
        message: 'Invalid MFA token',
        error_code: 'INVALID_MFA_TOKEN'
      });
    }

  } catch (error) {
    req.logger.error('MFA verify error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify MFA',
      error_code: 'MFA_VERIFY_ERROR'
    });
  }
});

// Verify MFA Backup Code
router.post('/mfa/verify-backup', authenticateToken, [
  body('backup_code').trim().isLength({ min: 8, max: 8 }).isAlphanumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { backup_code } = req.body;

    // Get user's backup codes
    const [users] = await req.db.execute(
      'SELECT mfa_backup_codes FROM users WHERE id = ? AND mfa_enabled = true',
      [req.user.id]
    );

    if (!users[0]?.mfa_backup_codes) {
      return res.status(400).json({
        success: false,
        message: 'No backup codes available',
        error_code: 'NO_BACKUP_CODES'
      });
    }

    const hashedBackupCodes = JSON.parse(users[0].mfa_backup_codes);
    let codeUsed = false;
    let codeIndex = -1;

    // Check each hashed backup code
    for (let i = 0; i < hashedBackupCodes.length; i++) {
      if (hashedBackupCodes[i] && await bcrypt.compare(backup_code.toUpperCase(), hashedBackupCodes[i])) {
        hashedBackupCodes[i] = null; // Mark as used
        codeUsed = true;
        codeIndex = i;
        break;
      }
    }

    if (codeUsed) {
      const remainingCodes = hashedBackupCodes.filter(code => code !== null).length;
      
      // Update backup codes in database
      await req.db.execute(
        'UPDATE users SET mfa_backup_codes = ? WHERE id = ?',
        [JSON.stringify(hashedBackupCodes), req.user.id]
      );

      req.logger.info('MFA backup code used successfully', {
        userId: req.user.id,
        codeIndex,
        remainingCodes
      });

      res.json({
        success: true,
        message: 'Backup code verified successfully',
        data: {
          remaining_codes: remainingCodes,
          warning: remainingCodes === 0 ? 'All backup codes used. Please generate new ones.' : null
        }
      });
    } else {
      req.logger.warn('Invalid backup code attempt', {
        userId: req.user.id,
        email: req.user.email
      });
      
      res.status(400).json({
        success: false,
        message: 'Invalid or already used backup code',
        error_code: 'INVALID_BACKUP_CODE'
      });
    }

  } catch (error) {
    req.logger.error('Backup code verify error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify backup code',
      error_code: 'BACKUP_VERIFY_ERROR'
    });
  }
});

// Regenerate Backup Codes
router.post('/mfa/regenerate-backup-codes', authenticateToken, [
  body('password').isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { password } = req.body;

    // Verify password and MFA status
    const [users] = await req.db.execute(
      'SELECT password_hash, mfa_enabled FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!users[0] || !users[0].mfa_enabled) {
      return res.status(400).json({
        success: false,
        message: 'MFA is not enabled',
        error_code: 'MFA_NOT_ENABLED'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
        error_code: 'INVALID_PASSWORD'
      });
    }

    // Generate new backup codes
    const backupCodes = Array.from({length: 8}, () => 
      Math.random().toString(36).substr(2, 8).toUpperCase()
    );
    
    const hashedBackupCodes = await Promise.all(
      backupCodes.map(code => bcrypt.hash(code, 12))
    );

    // Update backup codes
    await req.db.execute(
      'UPDATE users SET mfa_backup_codes = ? WHERE id = ?',
      [JSON.stringify(hashedBackupCodes), req.user.id]
    );

    req.logger.info('MFA backup codes regenerated', {
      userId: req.user.id,
      email: req.user.email
    });

    res.json({
      success: true,
      message: 'Backup codes regenerated successfully',
      data: {
        backup_codes: backupCodes // Show new codes once
      }
    });

  } catch (error) {
    req.logger.error('Regenerate backup codes error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate backup codes',
      error_code: 'BACKUP_REGENERATE_ERROR'
    });
  }
});

// Disable MFA
router.post('/mfa/disable', authenticateToken, [
  body('password').isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error_code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }

    const { password } = req.body;

    // Verify password before disabling MFA
    const [users] = await req.db.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    const isValidPassword = await bcrypt.compare(password, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
        error_code: 'INVALID_PASSWORD'
      });
    }

    // Disable MFA and clear secrets
    await req.db.execute(
      `UPDATE users SET 
         mfa_enabled = false, 
         mfa_secret = NULL, 
         mfa_backup_codes = NULL,
         mfa_temp_secret = NULL
       WHERE id = ?`,
      [req.user.id]
    );

    req.logger.info('MFA disabled', {
      userId: req.user.id,
      email: req.user.email
    });

    res.json({
      success: true,
      message: 'MFA disabled successfully'
    });

  } catch (error) {
    req.logger.error('MFA disable error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to disable MFA',
      error_code: 'MFA_DISABLE_ERROR'
    });
  }
});

// Get Current User Profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    // Get fresh user data with additional info
    const [users] = await req.db.execute(
      `SELECT u.*, po.verification_status as owner_verification_status,
              po.bio as owner_bio
       FROM users u 
       LEFT JOIN property_owners po ON u.id = po.user_id 
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error_code: 'USER_NOT_FOUND'
      });
    }

    const user = users[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        profile_image: user.profile_image,
        role: user.role,
        is_verified: user.is_verified,
        mfa_enabled: user.mfa_enabled || false,
        owner_verification_status: user.owner_verification_status || null,
        owner_bio: user.owner_bio || null,
        created_at: user.created_at
      }
    });

  } catch (error) {
    req.logger.error('Get profile error', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error_code: 'PROFILE_ERROR'
    });
  }
});

// Logout (optional - mostly handled client-side)
router.post('/logout', authenticateToken, (req, res) => {
  req.logger.info('User logout', {
    userId: req.user.id,
    email: req.user.email
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Export authentication middleware for use in other routes
module.exports = { router, authenticateToken };