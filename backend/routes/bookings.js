// backend/routes/bookings.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { processPayment, refundPayment } = require('../services/payment');
const { calculatePricing } = require('../services/pricing');

const router = express.Router();

// Get bookings with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      suiteId,
      startDate,
      endDate,
      role = 'guest'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = [];
    let queryParams = [];

    // Role-based filtering
    if (role === 'guest' || req.user.role === 'client') {
      whereConditions.push('(b.guest_id = ? OR b.guest_email = ?)');
      queryParams.push(req.user.userId, req.user.email);
    } else if (role === 'owner' || req.user.role === 'property_owner') {
      whereConditions.push('s.owner_id = ?');
      queryParams.push(req.user.userId);
    } else if (req.user.role === 'admin') {
      // Admin can see all bookings
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Additional filters
    if (status) {
      whereConditions.push('b.booking_status = ?');
      queryParams.push(status);
    }

    if (suiteId) {
      whereConditions.push('b.suite_id = ?');
      queryParams.push(suiteId);
    }

    if (startDate) {
      whereConditions.push('b.check_in_date >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('b.check_out_date <= ?');
      queryParams.push(endDate);
    }

    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    // Main query
    const query = `
      SELECT 
        b.*,
        s.name as suite_name,
        s.address as suite_address,
        s.city as suite_city,
        s.country as suite_country,
        s.property_type,
        u_owner.first_name as owner_first_name,
        u_owner.last_name as owner_last_name,
        u_owner.email as owner_email,
        u_owner.phone as owner_phone,
        u_guest.first_name as guest_first_name,
        u_guest.last_name as guest_last_name,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as suite_image,
        (SELECT COUNT(*) FROM booking_payments bp WHERE bp.booking_id = b.id AND bp.transaction_status = 'completed') as payment_count
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      JOIN users u_owner ON s.owner_id = u_owner.id
      LEFT JOIN users u_guest ON b.guest_id = u_guest.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `;

    queryParams.push(limitNum, offset);
    const [bookings] = await pool.execute(query, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      ${whereClause}
    `;
    const [countResult] = await pool.execute(countQuery, queryParams.slice(0, -2));
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
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
});

// Get single booking
router.get('/:id', authenticateToken, [
  param('id').isInt()
], async (req, res) => {
  try {
    const bookingId = req.params.id;

    const [bookings] = await pool.execute(`
      SELECT 
        b.*,
        s.name as suite_name,
        s.address as suite_address,
        s.city as suite_city,
        s.country as suite_country,
        s.property_type,
        s.capacity,
        s.bedrooms,
        s.bathrooms,
        u_owner.first_name as owner_first_name,
        u_owner.last_name as owner_last_name,
        u_owner.email as owner_email,
        u_owner.phone as owner_phone,
        u_owner.profile_image as owner_profile_image,
        u_guest.first_name as guest_first_name,
        u_guest.last_name as guest_last_name,
        u_guest.email as guest_email_verified,
        u_guest.phone as guest_phone_verified,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as suite_image
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      JOIN users u_owner ON s.owner_id = u_owner.id
      LEFT JOIN users u_guest ON b.guest_id = u_guest.id
      WHERE b.id = ?
    `, [bookingId]);

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Check access permissions
    const hasAccess = 
      booking.guest_id === req.user.userId ||
      booking.guest_email === req.user.email ||
      booking.owner_email === req.user.email ||
      req.user.role === 'admin';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get payment history
    const [payments] = await pool.execute(`
      SELECT * FROM booking_payments
      WHERE booking_id = ?
      ORDER BY created_at DESC
    `, [bookingId]);

    // Get messages for this booking
    const [messages] = await pool.execute(`
      SELECT 
        m.*,
        u.first_name as sender_first_name,
        u.last_name as sender_last_name,
        u.profile_image as sender_profile_image
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.booking_id = ?
      ORDER BY m.created_at ASC
    `, [bookingId]);

    booking.payments = payments;
    booking.messages = messages;

    res.json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking details'
    });
  }
});

// Create new booking
router.post('/', [
  body('suiteId').isInt(),
  body('checkInDate').isISO8601().toDate(),
  body('checkOutDate').isISO8601().toDate(),
  body('guestsCount').isInt({ min: 1, max: 20 }),
  body('guestName').trim().isLength({ min: 2, max: 200 }),
  body('guestEmail').isEmail().normalizeEmail(),
  body('guestPhone').optional().isMobilePhone(),
  body('specialRequests').optional().trim().isLength({ max: 500 }),
  body('paymentMethod').isIn(['stripe', 'paypal', 'bank_transfer'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const {
      suiteId,
      checkInDate,
      checkOutDate,
      guestsCount,
      guestName,
      guestEmail,
      guestPhone,
      specialRequests,
      paymentMethod,
      paymentToken
    } = req.body;

    // Validate dates
    const checkIn = moment(checkInDate);
    const checkOut = moment(checkOutDate);
    const today = moment().startOf('day');

    if (checkIn.isBefore(today)) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }

    if (checkOut.isSameOrBefore(checkIn)) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }

    const nights = checkOut.diff(checkIn, 'days');
    if (nights > 365) {
      return res.status(400).json({
        success: false,
        message: 'Maximum stay is 365 days'
      });
    }

    // Get suite details and check availability
    const [suites] = await pool.execute(`
      SELECT 
        s.*,
        pr.base_price,
        pr.weekend_price,
        pr.cleaning_fee,
        pr.extra_guest_fee,
        pr.security_deposit,
        pr.currency,
        pr.minimum_stay,
        pr.maximum_stay,
        u.email as owner_email,
        u.first_name as owner_first_name
      FROM suites s
      JOIN pricing_rules pr ON s.id = pr.suite_id
      JOIN users u ON s.owner_id = u.id
      WHERE s.id = ? AND s.is_active = true AND s.verification_status = 'verified'
    `, [suiteId]);

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found or not available'
      });
    }

    const suite = suites[0];

    // Check capacity
    if (guestsCount > suite.capacity) {
      return res.status(400).json({
        success: false,
        message: `Suite capacity is ${suite.capacity} guests`
      });
    }

    // Check minimum/maximum stay
    if (suite.minimum_stay && nights < suite.minimum_stay) {
      return res.status(400).json({
        success: false,
        message: `Minimum stay is ${suite.minimum_stay} nights`
      });
    }

    if (suite.maximum_stay && nights > suite.maximum_stay) {
      return res.status(400).json({
        success: false,
        message: `Maximum stay is ${suite.maximum_stay} nights`
      });
    }

    // Check for conflicts with existing bookings
    const [conflicts] = await pool.execute(`
      SELECT COUNT(*) as conflicts
      FROM bookings
      WHERE suite_id = ? 
        AND booking_status IN ('confirmed', 'pending')
        AND (
          (check_in_date <= ? AND check_out_date > ?) OR
          (check_in_date < ? AND check_out_date >= ?) OR
          (check_in_date >= ? AND check_out_date <= ?)
        )
    `, [
      suiteId,
      checkInDate, checkInDate,
      checkOutDate, checkOutDate,
      checkInDate, checkOutDate
    ]);

    if (conflicts[0].conflicts > 0) {
      return res.status(400).json({
        success: false,
        message: 'Suite is not available for the selected dates'
      });
    }

    // Check suite availability calendar
    const [unavailableDates] = await pool.execute(`
      SELECT COUNT(*) as blocked
      FROM suite_availability
      WHERE suite_id = ? 
        AND date >= ? 
        AND date < ?
        AND is_available = false
    `, [suiteId, checkInDate, checkOutDate]);

    if (unavailableDates[0].blocked > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some dates in your selection are blocked'
      });
    }

    // Calculate pricing
    const pricing = await calculatePricing({
      suite,
      checkInDate,
      checkOutDate,
      guestsCount
    });

    // Generate booking reference
    const bookingReference = `MC${Date.now().toString().slice(-8)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // Start transaction
    await pool.execute('START TRANSACTION');

    try {
      // Create booking
      const [bookingResult] = await pool.execute(`
        INSERT INTO bookings (
          booking_reference, suite_id, guest_id, guest_email, guest_name, guest_phone,
          check_in_date, check_out_date, guests_count, total_amount,
          booking_status, payment_status, special_requests, price_breakdown
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?)
      `, [
        bookingReference,
        suiteId,
        req.user?.userId || null,
        guestEmail,
        guestName,
        guestPhone || null,
        checkInDate,
        checkOutDate,
        guestsCount,
        pricing.total,
        specialRequests || null,
        JSON.stringify(pricing.breakdown)
      ]);

      const bookingId = bookingResult.insertId;

      // Process payment
      let paymentResult;
      try {
        paymentResult = await processPayment({
          amount: pricing.total,
          currency: suite.currency,
          paymentMethod,
          paymentToken,
          bookingReference,
          customerEmail: guestEmail,
          description: `Booking for ${suite.name}`
        });

        // Record payment
        await pool.execute(`
          INSERT INTO booking_payments (
            booking_id, amount, payment_method, payment_gateway_id, transaction_status
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          bookingId,
          pricing.total,
          paymentMethod,
          paymentResult.transactionId,
          paymentResult.status
        ]);

        // Update booking status based on payment
        const bookingStatus = paymentResult.status === 'completed' ? 'confirmed' : 'pending';
        const paymentStatus = paymentResult.status;

        await pool.execute(`
          UPDATE bookings 
          SET booking_status = ?, payment_status = ?
          WHERE id = ?
        `, [bookingStatus, paymentStatus, bookingId]);

      } catch (paymentError) {
        console.error('Payment processing error:', paymentError);
        
        // Record failed payment
        await pool.execute(`
          INSERT INTO booking_payments (
            booking_id, amount, payment_method, transaction_status, error_message
          ) VALUES (?, ?, ?, 'failed', ?)
        `, [
          bookingId,
          pricing.total,
          paymentMethod,
          paymentError.message
        ]);

        await pool.execute('ROLLBACK');
        
        return res.status(400).json({
          success: false,
          message: 'Payment processing failed',
          error: paymentError.message
        });
      }

      await pool.execute('COMMIT');

      // Send confirmation emails
      try {
        // Email to guest
        await sendEmail({
          to: guestEmail,
          subject: 'Booking Confirmation - Malecom Suits',
          template: 'booking-confirmation',
          data: {
            guestName,
            bookingReference,
            suiteName: suite.name,
            checkInDate: checkIn.format('MMMM Do, YYYY'),
            checkOutDate: checkOut.format('MMMM Do, YYYY'),
            nights,
            totalAmount: pricing.total,
            currency: suite.currency
          }
        });

        // Email to owner
        await sendEmail({
          to: suite.owner_email,
          subject: 'New Booking Received - Malecom Suits',
          template: 'new-booking-owner',
          data: {
            ownerName: suite.owner_first_name,
            bookingReference,
            suiteName: suite.name,
            guestName,
            checkInDate: checkIn.format('MMMM Do, YYYY'),
            checkOutDate: checkOut.format('MMMM Do, YYYY'),
            guestsCount,
            totalAmount: pricing.total,
            currency: suite.currency
          }
        });

      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Don't fail the booking if email fails
      }

      res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: {
          bookingId,
          bookingReference,
          status: paymentResult.status === 'completed' ? 'confirmed' : 'pending',
          totalAmount: pricing.total,
          currency: suite.currency
        }
      });

    } catch (error) {
      await pool.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking'
    });
  }
});

// Cancel booking
router.put('/:id/cancel', authenticateToken, [
  param('id').isInt(),
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { reason } = req.body;

    // Get booking details
    const [bookings] = await pool.execute(`
      SELECT 
        b.*,
        s.owner_id,
        u.email as owner_email,
        u.first_name as owner_first_name
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      JOIN users u ON s.owner_id = u.id
      WHERE b.id = ?
    `, [bookingId]);

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Check permissions
    const canCancel = 
      booking.guest_id === req.user.userId ||
      booking.guest_email === req.user.email ||
      booking.owner_id === req.user.userId ||
      req.user.role === 'admin';

    if (!canCancel) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if booking can be cancelled
    if (booking.booking_status === 'canceled') {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled'
      });
    }

    if (booking.booking_status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed booking'
      });
    }

    // Check cancellation policy (24 hours before check-in)
    const checkInDate = moment(booking.check_in_date);
    const now = moment();
    const hoursUntilCheckIn = checkInDate.diff(now, 'hours');

    if (hoursUntilCheckIn < 24 && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel booking less than 24 hours before check-in'
      });
    }

    // Start transaction
    await pool.execute('START TRANSACTION');

    try {
      // Update booking status
      await pool.execute(`
        UPDATE bookings 
        SET booking_status = 'canceled', 
            canceled_at = CURRENT_TIMESTAMP,
            cancellation_reason = ?
        WHERE id = ?
      `, [reason || null, bookingId]);

      // Process refund if payment was completed
      if (booking.payment_status === 'paid') {
        try {
          const refundResult = await refundPayment({
            bookingId,
            amount: booking.total_amount,
            reason: 'Booking cancellation'
          });

          // Record refund
          await pool.execute(`
            INSERT INTO booking_payments (
              booking_id, amount, payment_method, transaction_status, error_message
            ) VALUES (?, ?, 'refund', ?, ?)
          `, [
            bookingId,
            -booking.total_amount,
            refundResult.status,
            refundResult.transactionId || null
          ]);

          // Update payment status
          await pool.execute(`
            UPDATE bookings SET payment_status = 'refunded' WHERE id = ?
          `, [bookingId]);

        } catch (refundError) {
          console.error('Refund processing error:', refundError);
          // Continue with cancellation even if refund fails
        }
      }

      await pool.execute('COMMIT');

      // Send cancellation emails
      try {
        await sendEmail({
          to: booking.guest_email,
          subject: 'Booking Cancellation - Malecom Suits',
          template: 'booking-cancellation',
          data: {
            guestName: booking.guest_name,
            bookingReference: booking.booking_reference,
            reason: reason || 'No reason provided'
          }
        });

        await sendEmail({
          to: booking.owner_email,
          subject: 'Booking Cancelled - Malecom Suits',
          template: 'booking-cancellation-owner',
          data: {
            ownerName: booking.owner_first_name,
            bookingReference: booking.booking_reference,
            guestName: booking.guest_name,
            reason: reason || 'No reason provided'
          }
        });

      } catch (emailError) {
        console.error('Cancellation email error:', emailError);
      }

      res.json({
        success: true,
        message: 'Booking cancelled successfully'
      });

    } catch (error) {
      await pool.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
});

// Update booking status (Owner/Admin only)
router.put('/:id/status', authenticateToken, [
  param('id').isInt(),
  body('status').isIn(['pending', 'confirmed', 'canceled', 'completed']),
  body('note').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const bookingId = req.params.id;
    const { status, note } = req.body;

    // Get booking details
    const [bookings] = await pool.execute(`
      SELECT b.*, s.owner_id
      FROM bookings b
      JOIN suites s ON b.suite_id = s.id
      WHERE b.id = ?
    `, [bookingId]);

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Check permissions
    const canUpdate = 
      booking.owner_id === req.user.userId ||
      req.user.role === 'admin';

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update booking status
    await pool.execute(`
      UPDATE bookings 
      SET booking_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, bookingId]);

    // Add note if provided
    if (note) {
      await pool.execute(`
        INSERT INTO messages (
          booking_id, sender_id, receiver_id, message
        ) VALUES (?, ?, ?, ?)
      `, [
        bookingId,
        req.user.userId,
        booking.guest_id || null,
        note
      ]);
    }

    res.json({
      success: true,
      message: 'Booking status updated successfully'
    });

  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status'
    });
  }
});

// Get booking availability for suite
router.get('/suite/:suiteId/availability', [
  param('suiteId').isInt(),
  query('startDate').isISO8601().toDate(),
  query('endDate').isISO8601().toDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { suiteId } = req.params;
    const { startDate, endDate } = req.query;

    // Get blocked dates from bookings
    const [bookedDates] = await pool.execute(`
      SELECT check_in_date, check_out_date
      FROM bookings
      WHERE suite_id = ? 
        AND booking_status IN ('confirmed', 'pending')
        AND check_in_date <= ?
        AND check_out_date >= ?
    `, [suiteId, endDate, startDate]);

    // Get blocked dates from availability calendar
    const [blockedDates] = await pool.execute(`
      SELECT date, blocked_reason
      FROM suite_availability
      WHERE suite_id = ?
        AND date >= ?
        AND date <= ?
        AND is_available = false
    `, [suiteId, startDate, endDate]);

    res.json({
      success: true,
      data: {
        bookedDates,
        blockedDates
      }
    });

  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch availability'
    });
  }
});

module.exports = router;