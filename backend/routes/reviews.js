// backend/routes/reviews.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get reviews for a suite
router.get('/suite/:suiteId', optionalAuth, [
  param('suiteId').isInt(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('sortBy').optional().isIn(['created_at', 'rating'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const suiteId = req.params.suiteId;
    const {
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get reviews with reviewer information
    const [reviews] = await pool.execute(`
      SELECT 
        r.id, r.rating, r.title, r.comment, r.created_at,
        u.first_name as reviewer_first_name,
        u.last_name as reviewer_last_name,
        u.profile_image as reviewer_profile_image,
        b.check_in_date, b.check_out_date
      FROM reviews r
      LEFT JOIN users u ON r.reviewer_id = u.id
      LEFT JOIN bookings b ON r.booking_id = b.id
      WHERE r.suite_id = ? AND r.is_approved = true
      ORDER BY r.${sortBy} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [suiteId, limitNum, offset]);

    // Get total count and rating summary
    const [summary] = await pool.execute(`
      SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
      FROM reviews 
      WHERE suite_id = ? AND is_approved = true
    `, [suiteId]);

    const stats = summary[0];
    const total = stats.total_reviews;

    res.json({
      success: true,
      data: {
        reviews,
        summary: {
          total_reviews: total,
          average_rating: stats.average_rating ? parseFloat(stats.average_rating).toFixed(1) : null,
          rating_breakdown: {
            5: stats.five_star || 0,
            4: stats.four_star || 0,
            3: stats.three_star || 0,
            2: stats.two_star || 0,
            1: stats.one_star || 0
          }
        },
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
    console.error('Get suite reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// Create a review (requires completed booking)
router.post('/', authenticateToken, [
  body('bookingId').isInt(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('title').optional().trim().isLength({ max: 200 }),
  body('comment').trim().isLength({ min: 10, max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { bookingId, rating, title, comment } = req.body;
    const userId = req.user.userId;

    // Verify booking exists and belongs to user
    const [bookings] = await pool.execute(`
      SELECT b.*, s.name as suite_name, s.owner_id
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      WHERE b.id = ? AND (b.guest_id = ? OR b.guest_email = ?)
    `, [bookingId, userId, req.user.email]);

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or access denied'
      });
    }

    const booking = bookings[0];

    // Check if booking is completed
    if (booking.booking_status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only review completed bookings'
      });
    }

    // Check if review already exists
    const [existingReviews] = await pool.execute(
      'SELECT id FROM reviews WHERE booking_id = ?',
      [bookingId]
    );

    if (existingReviews.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Review already exists for this booking'
      });
    }

    // Create review
    const [result] = await pool.execute(`
      INSERT INTO reviews (booking_id, suite_id, reviewer_id, rating, title, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [bookingId, booking.suite_id, userId, rating, title || null, comment]);

    // Get owner email for notification
    const [owners] = await pool.execute(
      'SELECT email, first_name FROM users WHERE id = ?',
      [booking.owner_id]
    );

    // Send notification to property owner
    if (owners.length > 0) {
      try {
        const { sendEmail } = require('../services/email');
        await sendEmail({
          to: owners[0].email,
          subject: 'New Review Received - Malecom Suits',
          template: 'new-review-notification',
          data: {
            ownerName: owners[0].first_name,
            suiteName: booking.suite_name,
            rating,
            reviewerName: `${req.user.firstName || 'Guest'}`,
            comment: comment.substring(0, 200) + (comment.length > 200 ? '...' : '')
          }
        });
      } catch (emailError) {
        console.error('Review notification email error:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: { reviewId: result.insertId }
    });

  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit review'
    });
  }
});

// Get user's reviews
router.get('/my-reviews', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [reviews] = await pool.execute(`
      SELECT 
        r.*, 
        s.name as suite_name, s.city, s.country,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as suite_image
      FROM reviews r
      JOIN suites s ON r.suite_id = s.id
      WHERE r.reviewer_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM reviews WHERE reviewer_id = ?',
      [userId]
    );

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
    console.error('Get user reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your reviews'
    });
  }
});

// Update review (only before approval)
router.put('/:id', authenticateToken, [
  param('id').isInt(),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('title').optional().trim().isLength({ max: 200 }),
  body('comment').optional().trim().isLength({ min: 10, max: 2000 })
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
    const userId = req.user.userId;

    // Check ownership and approval status
    const [reviews] = await pool.execute(
      'SELECT reviewer_id, is_approved FROM reviews WHERE id = ?',
      [reviewId]
    );

    if (reviews.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const review = reviews[0];

    if (review.reviewer_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (review.is_approved !== null) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit review after moderation'
      });
    }

    // Update review
    const updates = {};
    if (req.body.rating !== undefined) updates.rating = req.body.rating;
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.comment !== undefined) updates.comment = req.body.comment;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(reviewId);

    await pool.execute(
      `UPDATE reviews SET ${setClause} WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: 'Review updated successfully'
    });

  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review'
    });
  }
});

// Delete review (only before approval)
router.delete('/:id', authenticateToken, [
  param('id').isInt()
], async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user.userId;

    // Check ownership and approval status
    const [reviews] = await pool.execute(
      'SELECT reviewer_id, is_approved FROM reviews WHERE id = ?',
      [reviewId]
    );

    if (reviews.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const review = reviews[0];

    if (review.reviewer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (review.is_approved !== null && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete review after moderation'
      });
    }

    // Delete review
    await pool.execute('DELETE FROM reviews WHERE id = ?', [reviewId]);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete review'
    });
  }
});

module.exports = router;

// backend/routes/messages.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const messagesRouter = express.Router();

// Get conversations for authenticated user
messagesRouter.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all conversations where user is involved
    const [conversations] = await pool.execute(`
      SELECT DISTINCT
        CASE 
          WHEN m.sender_id = ? THEN m.receiver_id 
          ELSE m.sender_id 
        END as other_user_id,
        CASE 
          WHEN m.sender_id = ? THEN receiver.first_name 
          ELSE sender.first_name 
        END as other_user_first_name,
        CASE 
          WHEN m.sender_id = ? THEN receiver.last_name 
          ELSE sender.last_name 
        END as other_user_last_name,
        CASE 
          WHEN m.sender_id = ? THEN receiver.profile_image 
          ELSE sender.profile_image 
        END as other_user_profile_image,
        m.booking_id,
        s.name as suite_name,
        (SELECT message FROM messages m2 
         WHERE (m2.sender_id = ? AND m2.receiver_id = other_user_id) 
            OR (m2.receiver_id = ? AND m2.sender_id = other_user_id)
         ORDER BY m2.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages m2 
         WHERE (m2.sender_id = ? AND m2.receiver_id = other_user_id) 
            OR (m2.receiver_id = ? AND m2.sender_id = other_user_id)
         ORDER BY m2.created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages m2 
         WHERE m2.sender_id = other_user_id 
           AND m2.receiver_id = ? 
           AND m2.is_read = false) as unread_count
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      LEFT JOIN bookings b ON m.booking_id = b.id
      LEFT JOIN suites s ON b.suite_id = s.id
      WHERE m.sender_id = ? OR m.receiver_id = ?
      ORDER BY last_message_time DESC
    `, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId]);

    res.json({
      success: true,
      data: conversations
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations'
    });
  }
});

// Get messages between two users
messagesRouter.get('/conversation/:otherUserId', authenticateToken, [
  param('otherUserId').isInt(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
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
    const otherUserId = req.params.otherUserId;
    const { page = 1, limit = 50 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Get messages between the two users
    const [messages] = await pool.execute(`
      SELECT 
        m.*,
        sender.first_name as sender_first_name,
        sender.last_name as sender_last_name,
        sender.profile_image as sender_profile_image,
        b.booking_reference,
        s.name as suite_name
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      LEFT JOIN bookings b ON m.booking_id = b.id
      LEFT JOIN suites s ON b.suite_id = s.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) 
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, otherUserId, otherUserId, userId, limitNum, offset]);

    // Mark messages as read
    await pool.execute(`
      UPDATE messages 
      SET is_read = true 
      WHERE sender_id = ? AND receiver_id = ? AND is_read = false
    `, [otherUserId, userId]);

    // Get total count
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total 
      FROM messages 
      WHERE (sender_id = ? AND receiver_id = ?) 
         OR (sender_id = ? AND receiver_id = ?)
    `, [userId, otherUserId, otherUserId, userId]);

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Show oldest first
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
    console.error('Get conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
});

// Send a message
messagesRouter.post('/', authenticateToken, [
  body('receiverId').isInt(),
  body('message').trim().isLength({ min: 1, max: 2000 }),
  body('bookingId').optional().isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { receiverId, message, bookingId } = req.body;
    const senderId = req.user.userId;

    // Verify receiver exists
    const [receivers] = await pool.execute(
      'SELECT id, first_name FROM users WHERE id = ? AND is_active = true',
      [receiverId]
    );

    if (receivers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // If bookingId provided, verify user has access to the booking
    if (bookingId) {
      const [bookings] = await pool.execute(`
        SELECT b.id, s.owner_id
        FROM bookings b
        JOIN suites s ON b.suite_id = s.id
        WHERE b.id = ? AND (b.guest_id = ? OR s.owner_id = ?)
      `, [bookingId, senderId, senderId]);

      if (bookings.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this booking'
        });
      }
    }

    // Create message
    const [result] = await pool.execute(`
      INSERT INTO messages (sender_id, receiver_id, message, booking_id)
      VALUES (?, ?, ?, ?)
    `, [senderId, receiverId, message, bookingId || null]);

    // Get the created message with sender info
    const [newMessage] = await pool.execute(`
      SELECT 
        m.*,
        u.first_name as sender_first_name,
        u.last_name as sender_last_name,
        u.profile_image as sender_profile_image
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `, [result.insertId]);

    // Send email notification to receiver
    try {
      const { sendEmail } = require('../services/email');
      await sendEmail({
        to: receivers[0].email,
        subject: 'New Message - Malecom Suits',
        template: 'new-message-notification',
        data: {
          receiverName: receivers[0].first_name,
          senderName: `${req.user.firstName || 'User'}`,
          message: message.substring(0, 200) + (message.length > 200 ? '...' : ''),
          messageUrl: `${process.env.FRONTEND_URL}/messages`
        }
      });
    } catch (emailError) {
      console.error('Message notification email error:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage[0]
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// Mark message as read
messagesRouter.put('/:id/read', authenticateToken, [
  param('id').isInt()
], async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.userId;

    // Update message as read (only if user is the receiver)
    const [result] = await pool.execute(
      'UPDATE messages SET is_read = true WHERE id = ? AND receiver_id = ?',
      [messageId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('Mark message read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark message as read'
    });
  }
});

// Get unread message count
messagesRouter.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [result] = await pool.execute(
      'SELECT COUNT(*) as unread_count FROM messages WHERE receiver_id = ? AND is_read = false',
      [userId]
    );

    res.json({
      success: true,
      data: {
        unread_count: result[0].unread_count
      }
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
});

module.exports = { router, messagesRouter };