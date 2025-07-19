// backend/routes/admin.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticateToken, requireAdmin, auditLog } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { getPaymentStats } = require('../services/payment');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

// Dashboard Statistics
router.get('/dashboard', auditLog('view_admin_dashboard'), async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Get key statistics
    const [stats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'client') as total_clients,
        (SELECT COUNT(*) FROM users WHERE role = 'property_owner') as total_owners,
        (SELECT COUNT(*) FROM suites WHERE is_active = true) as total_suites,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= ?) as recent_bookings,
        (SELECT COUNT(*) FROM bookings WHERE booking_status = 'confirmed') as confirmed_bookings,
        (SELECT COUNT(*) FROM bookings WHERE booking_status = 'pending') as pending_bookings,
        (SELECT SUM(total_amount) FROM bookings WHERE payment_status = 'paid' AND created_at >= ?) as recent_revenue,
        (SELECT AVG(rating) FROM reviews WHERE is_approved = true) as average_rating
    `, [startDate, startDate]);

    // Get recent activity
    const [recentBookings] = await pool.execute(`
      SELECT 
        b.id, b.booking_reference, b.total_amount, b.booking_status, b.created_at,
        s.name as suite_name, s.city,
        u.first_name as guest_name
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      LEFT JOIN users u ON b.guest_id = u.id
      ORDER BY b.created_at DESC
      LIMIT 10
    `);

    // Get suite verification queue
    const [pendingVerifications] = await pool.execute(`
      SELECT 
        s.id, s.name, s.city, s.created_at,
        u.first_name, u.last_name, u.email
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      WHERE s.verification_status = 'pending'
      ORDER BY s.created_at ASC
      LIMIT 10
    `);

    // Get payment statistics
    const paymentStats = await getPaymentStats(startDate, new Date());

    // Get top performing suites
    const [topSuites] = await pool.execute(`
      SELECT 
        s.id, s.name, s.city,
        COUNT(b.id) as booking_count,
        AVG(r.rating) as average_rating,
        SUM(b.total_amount) as total_revenue
      FROM suites s
      LEFT JOIN bookings b ON s.id = b.suite_id AND b.payment_status = 'paid'
      LEFT JOIN reviews r ON s.id = r.suite_id AND r.is_approved = true
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY booking_count DESC, total_revenue DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        overview: stats[0],
        recentBookings,
        pendingVerifications,
        paymentStats,
        topSuites,
        period: parseInt(period)
      }
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data'
    });
  }
});

// User Management
router.get('/users', auditLog('view_users'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = [];
    let queryParams = [];

    if (role) {
      whereConditions.push('u.role = ?');
      queryParams.push(role);
    }

    if (status === 'active') {
      whereConditions.push('u.is_active = true');
    } else if (status === 'inactive') {
      whereConditions.push('u.is_active = false');
    }

    if (search) {
      whereConditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    const allowedSortFields = ['created_at', 'first_name', 'email', 'role'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [users] = await pool.execute(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.role, u.is_active, 
        u.is_verified, u.created_at, u.profile_image,
        po.verification_status as owner_verification,
        (SELECT COUNT(*) FROM suites WHERE owner_id = u.id) as suite_count,
        (SELECT COUNT(*) FROM bookings WHERE guest_id = u.id) as booking_count
      FROM users u
      LEFT JOIN property_owners po ON u.id = po.user_id
      ${whereClause}
      ORDER BY u.${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...queryParams, limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM users u ${whereClause}
    `, queryParams);

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        users: users.map(user => ({
          ...user,
          password_hash: undefined // Never expose password hash
        })),
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
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// Get single user details
router.get('/users/:id', auditLog('view_user_details'), [
  param('id').isInt()
], async (req, res) => {
  try {
    const userId = req.params.id;

    const [users] = await pool.execute(`
      SELECT 
        u.*, 
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
    delete user.password_hash; // Never expose password hash

    // Get user's suites if property owner
    if (user.role === 'property_owner') {
      const [suites] = await pool.execute(`
        SELECT id, name, city, is_active, verification_status, created_at
        FROM suites WHERE owner_id = ?
        ORDER BY created_at DESC
      `, [userId]);
      user.suites = suites;
    }

    // Get user's bookings
    const [bookings] = await pool.execute(`
      SELECT 
        b.id, b.booking_reference, b.booking_status, b.payment_status,
        b.total_amount, b.check_in_date, b.check_out_date, b.created_at,
        s.name as suite_name, s.city
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      WHERE b.guest_id = ? OR s.owner_id = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    `, [userId, userId]);
    user.recent_bookings = bookings;

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details'
    });
  }
});

// Update user status
router.put('/users/:id/status', auditLog('update_user_status'), [
  param('id').isInt(),
  body('isActive').isBoolean(),
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const userId = req.params.id;
    const { isActive, reason } = req.body;

    // Get user details first
    const [users] = await pool.execute(
      'SELECT email, first_name, is_active FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Update user status
    await pool.execute(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [isActive, userId]
    );

    // Send notification email
    try {
      const action = isActive ? 'activated' : 'deactivated';
      await sendEmail({
        to: user.email,
        subject: `Account ${action} - Malecom Suits`,
        template: 'account-status-change',
        data: {
          firstName: user.first_name,
          action,
          reason: reason || 'No reason provided',
          isActive
        }
      });
    } catch (emailError) {
      console.error('Status change email error:', emailError);
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

// Suite Verification Management
router.get('/suites/pending', auditLog('view_pending_suites'), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [suites] = await pool.execute(`
      SELECT 
        s.*, 
        u.first_name as owner_first_name,
        u.last_name as owner_last_name,
        u.email as owner_email,
        pr.base_price, pr.currency,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as primary_image,
        (SELECT COUNT(*) FROM suite_images si WHERE si.suite_id = s.id) as image_count
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      LEFT JOIN pricing_rules pr ON s.id = pr.suite_id
      WHERE s.verification_status = 'pending'
      ORDER BY s.created_at ASC
      LIMIT ? OFFSET ?
    `, [limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM suites WHERE verification_status = "pending"'
    );

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        suites,
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
    console.error('Get pending suites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending suites'
    });
  }
});

// Verify/Reject Suite
router.put('/suites/:id/verify', auditLog('verify_suite'), [
  param('id').isInt(),
  body('status').isIn(['verified', 'rejected']),
  body('notes').optional().trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const suiteId = req.params.id;
    const { status, notes } = req.body;

    // Get suite and owner details
    const [suites] = await pool.execute(`
      SELECT 
        s.name, s.verification_status,
        u.email as owner_email, u.first_name as owner_first_name
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      WHERE s.id = ?
    `, [suiteId]);

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found'
      });
    }

    const suite = suites[0];

    // Update verification status
    await pool.execute(
      'UPDATE suites SET verification_status = ? WHERE id = ?',
      [status, suiteId]
    );

    // Send notification email to owner
    try {
      await sendEmail({
        to: suite.owner_email,
        subject: `Suite ${status === 'verified' ? 'Approved' : 'Rejected'} - Malecom Suits`,
        template: 'suite-verification',
        data: {
          ownerName: suite.owner_first_name,
          suiteName: suite.name,
          status,
          notes: notes || '',
          isApproved: status === 'verified'
        }
      });
    } catch (emailError) {
      console.error('Verification email error:', emailError);
    }

    res.json({
      success: true,
      message: `Suite ${status} successfully`
    });

  } catch (error) {
    console.error('Suite verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update suite verification'
    });
  }
});

// Review Management
router.get('/reviews', auditLog('view_reviews'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'pending',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereCondition = '';
    if (status === 'pending') {
      whereCondition = 'WHERE r.is_approved IS NULL';
    } else if (status === 'approved') {
      whereCondition = 'WHERE r.is_approved = true';
    } else if (status === 'rejected') {
      whereCondition = 'WHERE r.is_approved = false';
    }

    const allowedSortFields = ['created_at', 'rating'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [reviews] = await pool.execute(`
      SELECT 
        r.*, 
        s.name as suite_name, s.city,
        u_reviewer.first_name as reviewer_first_name,
        u_reviewer.last_name as reviewer_last_name,
        u_owner.first_name as owner_first_name,
        u_owner.last_name as owner_last_name
      FROM reviews r
      JOIN suites s ON r.suite_id = s.id
      LEFT JOIN users u_reviewer ON r.reviewer_id = u_reviewer.id
      JOIN users u_owner ON s.owner_id = u_owner.id
      ${whereCondition}
      ORDER BY r.${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM reviews r ${whereCondition}
    `);

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        reviews,
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
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// Approve/Reject Review
router.put('/reviews/:id/moderate', auditLog('moderate_review'), [
  param('id').isInt(),
  body('isApproved').isBoolean(),
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const reviewId = req.params.id;
    const { isApproved, reason } = req.body;

    // Update review status
    await pool.execute(
      'UPDATE reviews SET is_approved = ? WHERE id = ?',
      [isApproved, reviewId]
    );

    res.json({
      success: true,
      message: `Review ${isApproved ? 'approved' : 'rejected'} successfully`
    });

  } catch (error) {
    console.error('Review moderation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to moderate review'
    });
  }
});

// Platform Settings
router.get('/settings', auditLog('view_settings'), async (req, res) => {
  try {
    const [settings] = await pool.execute(
      'SELECT * FROM settings ORDER BY key'
    );

    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = {
        value: setting.value,
        description: setting.description
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: settingsObj
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
});

// Update Platform Settings
router.put('/settings', auditLog('update_settings'), [
  body('settings').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { settings } = req.body;

    // Update each setting
    for (const [key, value] of Object.entries(settings)) {
      await pool.execute(
        'UPDATE settings SET value = ? WHERE key = ?',
        [value, key]
      );
    }

    res.json({
      success: true,
      message: 'Settings updated successfully'
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

// System Analytics
router.get('/analytics', auditLog('view_analytics'), async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Revenue analytics
    const [revenueData] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as bookings,
        SUM(total_amount) as revenue
      FROM bookings 
      WHERE payment_status = 'paid' 
        AND created_at BETWEEN ? AND ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [startDate, endDate]);

    // User growth
    const [userGrowth] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_users,
        SUM(CASE WHEN role = 'property_owner' THEN 1 ELSE 0 END) as new_owners
      FROM users 
      WHERE created_at BETWEEN ? AND ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [startDate, endDate]);

    // Top performing cities
    const [topCities] = await pool.execute(`
      SELECT 
        s.city,
        COUNT(b.id) as booking_count,
        AVG(b.total_amount) as avg_booking_value,
        SUM(b.total_amount) as total_revenue
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      WHERE b.payment_status = 'paid'
        AND b.created_at BETWEEN ? AND ?
      GROUP BY s.city
      ORDER BY booking_count DESC
      LIMIT 10
    `, [startDate, endDate]);

    res.json({
      success: true,
      data: {
        revenueData,
        userGrowth,
        topCities,
        period: parseInt(period)
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics data'
    });
  }
});

module.exports = router;