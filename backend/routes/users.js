// backend/routes/users.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadToCloudinary } = require('../services/cloudinary');

const router = express.Router();

// Configure multer for profile image uploads
const upload = multer({
  dest: 'uploads/temp',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, JPG, PNG, WebP) are allowed'));
    }
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [users] = await pool.execute(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, 
        u.profile_image, u.role, u.is_verified, u.mfa_enabled, u.created_at,
        po.bio, po.verification_status as owner_verification,
        po.payout_method, po.payout_details
      FROM users u
      LEFT JOIN property_owners po ON u.id = po.user_id
      WHERE u.id = ?
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Get user statistics based on role
    let stats = {};
    
    if (user.role === 'property_owner') {
      const [ownerStats] = await pool.execute(`
        SELECT 
          (SELECT COUNT(*) FROM suites WHERE owner_id = ?) as total_properties,
          (SELECT COUNT(*) FROM suites WHERE owner_id = ? AND is_active = true) as active_properties,
          (SELECT COUNT(*) FROM bookings b JOIN suites s ON b.suite_id = s.id WHERE s.owner_id = ?) as total_bookings,
          (SELECT SUM(total_amount) FROM bookings b JOIN suites s ON b.suite_id = s.id WHERE s.owner_id = ? AND payment_status = 'paid') as total_earnings,
          (SELECT AVG(rating) FROM reviews r JOIN suites s ON r.suite_id = s.id WHERE s.owner_id = ?) as average_rating
      `, [userId, userId, userId, userId, userId]);
      
      stats = ownerStats[0];
    } else if (user.role === 'client') {
      const [clientStats] = await pool.execute(`
        SELECT 
          (SELECT COUNT(*) FROM bookings WHERE guest_id = ?) as total_bookings,
          (SELECT COUNT(*) FROM bookings WHERE guest_id = ? AND booking_status = 'completed') as completed_bookings,
          (SELECT SUM(total_amount) FROM bookings WHERE guest_id = ? AND payment_status = 'paid') as total_spent,
          (SELECT COUNT(*) FROM reviews WHERE reviewer_id = ?) as reviews_written
      `, [userId, userId, userId, userId]);
      
      stats = clientStats[0];
    }

    // Remove sensitive data
    delete user.payout_details;

    res.json({
      success: true,
      data: {
        user,
        stats
      }
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('firstName').optional().trim().isLength({ min: 2, max: 100 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().isMobilePhone(),
  body('bio').optional().trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const userId = req.user.userId;
    const { firstName, lastName, phone, bio } = req.body;

    // Update user table
    const userUpdates = {};
    if (firstName !== undefined) userUpdates.first_name = firstName;
    if (lastName !== undefined) userUpdates.last_name = lastName;
    if (phone !== undefined) userUpdates.phone = phone;

    if (Object.keys(userUpdates).length > 0) {
      const setClause = Object.keys(userUpdates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(userUpdates);
      values.push(userId);

      await pool.execute(
        `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }

    // Update property owner bio if provided and user is property owner
    if (bio !== undefined && req.user.role === 'property_owner') {
      await pool.execute(
        'UPDATE property_owners SET bio = ? WHERE user_id = ?',
        [bio, userId]
      );
    }

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Upload profile image
router.post('/profile/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const userId = req.user.userId;

    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(req.file.path, 'profile-images');

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image'
      });
    }

    // Update user profile image
    await pool.execute(
      'UPDATE users SET profile_image = ? WHERE id = ?',
      [uploadResult.url, userId]
    );

    res.json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        imageUrl: uploadResult.url
      }
    });

  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image'
    });
  }
});

// Change password
router.put('/profile/password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
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

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

// Get user's bookings
router.get('/bookings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10, status } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereCondition = 'WHERE b.guest_id = ?';
    let queryParams = [userId];

    if (status) {
      whereCondition += ' AND b.booking_status = ?';
      queryParams.push(status);
    }

    const [bookings] = await pool.execute(`
      SELECT 
        b.*,
        s.name as suite_name,
        s.city as suite_city,
        s.country as suite_country,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as suite_image,
        u.first_name as owner_first_name,
        u.last_name as owner_last_name
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      JOIN users u ON s.owner_id = u.id
      ${whereCondition}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM bookings b
      ${whereCondition}
    `, queryParams);

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          current_page: pageNum,
          per_page: limitNum,
          total_items: total,
          total_pages: Math.ceil(total / limitNum),
          has_next: pageNum < Math.ceil(total / limitNum),
          has_prev: pageNum > 1
        }
      }
    });

  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
});

// Get user's favorites (wishlist)
router.get('/favorites', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Note: You'll need to create a favorites table
    // For now, return empty array
    res.json({
      success: true,
      data: {
        favorites: [],
        message: 'Favorites feature coming soon'
      }
    });

  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch favorites'
    });
  }
});

// Add to favorites
router.post('/favorites/:suiteId', authenticateToken, [
  param('suiteId').isInt()
], async (req, res) => {
  try {
    // Placeholder for favorites functionality
    res.json({
      success: true,
      message: 'Favorites feature coming soon'
    });

  } catch (error) {
    console.error('Add to favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add to favorites'
    });
  }
});

// Remove from favorites
router.delete('/favorites/:suiteId', authenticateToken, [
  param('suiteId').isInt()
], async (req, res) => {
  try {
    // Placeholder for favorites functionality
    res.json({
      success: true,
      message: 'Favorites feature coming soon'
    });

  } catch (error) {
    console.error('Remove from favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove from favorites'
    });
  }
});

// Get user notifications
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Placeholder for notifications
    res.json({
      success: true,
      data: {
        notifications: [],
        unread_count: 0,
        message: 'Notifications feature coming soon'
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Delete user account
router.delete('/profile', authenticateToken, [
  body('password').notEmpty(),
  body('confirmation').equals('DELETE_MY_ACCOUNT')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const userId = req.user.userId;
    const { password } = req.body;

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
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Check for active bookings
    const [activeBookings] = await pool.execute(`
      SELECT COUNT(*) as count FROM bookings 
      WHERE guest_id = ? AND booking_status IN ('confirmed', 'pending')
      AND check_out_date > CURDATE()
    `, [userId]);

    if (activeBookings[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with active bookings'
      });
    }

    // For property owners, check active properties
    if (req.user.role === 'property_owner') {
      const [activeProperties] = await pool.execute(`
        SELECT COUNT(*) as count FROM suites WHERE owner_id = ? AND is_active = true
      `, [userId]);

      if (activeProperties[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: 'Please deactivate all properties before deleting account'
        });
      }
    }

    // Soft delete user account
    await pool.execute(
      'UPDATE users SET is_active = false, email = CONCAT(email, "_deleted_", UNIX_TIMESTAMP()) WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

module.exports = router;