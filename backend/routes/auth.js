// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { sendEmail } = require('../services/email');
const { authenticateToken } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { error: 'Too many login attempts, please try again later.' }
});

// Register validation
const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('firstName').trim().isLength({ min: 2, max: 100 }),
  body('lastName').trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().isMobilePhone(),
  body('role').isIn(['client', 'property_owner'])
];

// Login validation
const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

// Register new user
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { email, password, firstName, lastName, phone, role } = req.body;

    // Check if user already exists
    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, role) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, passwordHash, firstName, lastName, phone || null, role]
    );

    const userId = result.insertId;

    // Create property owner profile if needed
    if (role === 'property_owner') {
      await pool.execute(
        'INSERT INTO property_owners (user_id) VALUES (?)',
        [userId]
      );
    }

    // Generate verification token
    const verificationToken = jwt.sign(
      { userId, email }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Verify Your Malecom Suits Account',
      template: 'verification',
      data: {
        firstName,
        verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`
      }
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      userId
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
});

// Login user
router.post('/login', authLimiter, loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { email, password, mfaCode } = req.body;

    // Get user with password
    const [users] = await pool.execute(
      `SELECT u.*, po.verification_status as owner_verification 
       FROM users u 
       LEFT JOIN property_owners po ON u.id = po.user_id 
       WHERE u.email = ? AND u.is_active = true`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if email is verified
    if (!user.is_verified) {
      return res.status(401).json({
        success: false,
        message: 'Please verify your email before logging in'
      });
    }

    // Handle MFA if enabled
    if (user.mfa_enabled) {
      if (!mfaCode) {
        return res.status(200).json({
          success: false,
          requiresMFA: true,
          message: 'MFA code required'
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: mfaCode,
        window: 1
      });

      if (!verified) {
        return res.status(401).json({
          success: false,
          message: 'Invalid MFA code'
        });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update last login
    await pool.execute(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // Remove sensitive data
    delete user.password_hash;
    delete user.mfa_secret;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        profileImage: user.profile_image,
        isVerified: user.is_verified,
        mfaEnabled: user.mfa_enabled,
        ownerVerification: user.owner_verification || null
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Update user verification status
    const [result] = await pool.execute(
      'UPDATE users SET is_verified = true WHERE id = ? AND email = ?',
      [decoded.userId, decoded.email]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid or expired verification token'
    });
  }
});

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const { email } = req.body;

    const [users] = await pool.execute(
      'SELECT id, first_name FROM users WHERE email = ? AND is_active = true',
      [email]
    );

    // Always return success for security
    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.'
      });
    }

    const user = users[0];
    
    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, email }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1h' }
    );

    // Send reset email
    await sendEmail({
      to: email,
      subject: 'Reset Your Malecom Suits Password',
      template: 'password-reset',
      data: {
        firstName: user.first_name,
        resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
      }
    });

    res.json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reset email. Please try again.'
    });
  }
});

// Reset password
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { token, password } = req.body;

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Hash new password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Update password
    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ? AND email = ?',
      [passwordHash, decoded.userId, decoded.email]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid or expired reset token'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT u.*, po.bio, po.verification_status as owner_verification
       FROM users u 
       LEFT JOIN property_owners po ON u.id = po.user_id 
       WHERE u.id = ?`,
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];
    delete user.password_hash;
    delete user.mfa_secret;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        profileImage: user.profile_image,
        isVerified: user.is_verified,
        mfaEnabled: user.mfa_enabled,
        bio: user.bio || null,
        ownerVerification: user.owner_verification || null
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// Enable MFA
router.post('/mfa/enable', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Malecom Suits (${req.user.email})`,
      issuer: 'Malecom Suits'
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store temp secret
    await pool.execute(
      'UPDATE users SET mfa_temp_secret = ? WHERE id = ?',
      [secret.base32, userId]
    );

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl
    });

  } catch (error) {
    console.error('MFA enable error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enable MFA'
    });
  }
});

// Verify and confirm MFA
router.post('/mfa/verify', authenticateToken, [
  body('token').notEmpty()
], async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;

    // Get temp secret
    const [users] = await pool.execute(
      'SELECT mfa_temp_secret FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0 || !users[0].mfa_temp_secret) {
      return res.status(400).json({
        success: false,
        message: 'MFA setup not initiated'
      });
    }

    const secret = users[0].mfa_temp_secret;

    // Verify token
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid MFA token'
      });
    }

    // Generate backup codes
    const backupCodes = Array.from({ length: 10 }, () => 
      Math.random().toString(36).substr(2, 8).toUpperCase()
    );

    // Enable MFA
    await pool.execute(
      `UPDATE users SET 
       mfa_enabled = true, 
       mfa_secret = ?, 
       mfa_temp_secret = NULL, 
       mfa_backup_codes = ?
       WHERE id = ?`,
      [secret, JSON.stringify(backupCodes), userId]
    );

    res.json({
      success: true,
      message: 'MFA enabled successfully',
      backupCodes
    });

  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify MFA'
    });
  }
});

// Disable MFA
router.post('/mfa/disable', authenticateToken, [
  body('password').notEmpty()
], async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.userId;

    // Verify password
    const [users] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isValidPassword = await bcrypt.compare(password, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Disable MFA
    await pool.execute(
      `UPDATE users SET 
       mfa_enabled = false, 
       mfa_secret = NULL, 
       mfa_temp_secret = NULL, 
       mfa_backup_codes = NULL 
       WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'MFA disabled successfully'
    });

  } catch (error) {
    console.error('MFA disable error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable MFA'
    });
  }
});

// Logout (if using token blacklist)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a production app, you might want to blacklist the token
    // For now, we'll just return success
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

module.exports = router;