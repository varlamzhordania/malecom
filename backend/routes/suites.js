// backend/routes/suites.js
const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadToCloudinary, deleteFromCloudinary } = require('../services/cloudinary');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/temp',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, JPG, PNG, WebP) are allowed'));
    }
  }
});

// Get all suites with filters and pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      city,
      country,
      minPrice,
      maxPrice,
      capacity,
      bedrooms,
      propertyType,
      amenities,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search
    } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    let whereConditions = ['s.is_active = true', 's.verification_status = "verified"'];
    let queryParams = [];

    if (city) {
      whereConditions.push('s.city LIKE ?');
      queryParams.push(`%${city}%`);
    }

    if (country) {
      whereConditions.push('s.country = ?');
      queryParams.push(country);
    }

    if (capacity) {
      whereConditions.push('s.capacity >= ?');
      queryParams.push(parseInt(capacity));
    }

    if (bedrooms) {
      whereConditions.push('s.bedrooms >= ?');
      queryParams.push(parseInt(bedrooms));
    }

    if (propertyType) {
      whereConditions.push('s.property_type = ?');
      queryParams.push(propertyType);
    }

    if (search) {
      whereConditions.push('(s.name LIKE ? OR s.description LIKE ? OR s.city LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Handle price filtering
    if (minPrice || maxPrice) {
      let priceCondition = '';
      if (minPrice && maxPrice) {
        priceCondition = 'pr.base_price BETWEEN ? AND ?';
        queryParams.push(parseFloat(minPrice), parseFloat(maxPrice));
      } else if (minPrice) {
        priceCondition = 'pr.base_price >= ?';
        queryParams.push(parseFloat(minPrice));
      } else if (maxPrice) {
        priceCondition = 'pr.base_price <= ?';
        queryParams.push(parseFloat(maxPrice));
      }
      whereConditions.push(priceCondition);
    }

    // Handle amenities filtering
    if (amenities) {
      const amenityList = Array.isArray(amenities) ? amenities : amenities.split(',');
      if (amenityList.length > 0) {
        const amenityPlaceholders = amenityList.map(() => '?').join(',');
        whereConditions.push(`s.id IN (
          SELECT sa.suite_id 
          FROM suite_amenities sa 
          JOIN amenities a ON sa.amenity_id = a.id 
          WHERE a.name IN (${amenityPlaceholders})
          GROUP BY sa.suite_id 
          HAVING COUNT(DISTINCT sa.amenity_id) = ?
        )`);
        queryParams.push(...amenityList, amenityList.length);
      }
    }

    // Build ORDER BY clause
    const allowedSortFields = ['created_at', 'base_price', 'name', 'capacity'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    const orderClause = sortField === 'base_price' ? 
      `pr.${sortField} ${sortDirection}` : 
      `s.${sortField} ${sortDirection}`;

    // Main query
    const query = `
      SELECT 
        s.*,
        u.first_name as owner_first_name,
        u.last_name as owner_last_name,
        u.profile_image as owner_profile_image,
        pr.base_price,
        pr.weekend_price,
        pr.cleaning_fee,
        pr.currency,
        pr.minimum_stay,
        pr.maximum_stay,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as primary_image,
        (SELECT COUNT(*) FROM suite_images si WHERE si.suite_id = s.id) as image_count,
        (SELECT AVG(rating) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as average_rating,
        (SELECT COUNT(*) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as review_count
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      LEFT JOIN pricing_rules pr ON s.id = pr.suite_id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `;

    queryParams.push(limitNum, offset);

    const [suites] = await pool.execute(query, queryParams);

    // Count total results
    const countQuery = `
      SELECT COUNT(DISTINCT s.id) as total
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      LEFT JOIN pricing_rules pr ON s.id = pr.suite_id
      WHERE ${whereConditions.join(' AND ')}
    `;

    const [countResult] = await pool.execute(countQuery, queryParams.slice(0, -2));
    const total = countResult[0].total;

    // Get amenities for each suite
    if (suites.length > 0) {
      const suiteIds = suites.map(suite => suite.id);
      const placeholders = suiteIds.map(() => '?').join(',');
      
      const [amenitiesResult] = await pool.execute(`
        SELECT sa.suite_id, a.name, a.category, a.icon
        FROM suite_amenities sa
        JOIN amenities a ON sa.amenity_id = a.id
        WHERE sa.suite_id IN (${placeholders})
      `, suiteIds);

      // Group amenities by suite
      const suiteAmenities = amenitiesResult.reduce((acc, amenity) => {
        if (!acc[amenity.suite_id]) acc[amenity.suite_id] = [];
        acc[amenity.suite_id].push({
          name: amenity.name,
          category: amenity.category,
          icon: amenity.icon
        });
        return acc;
      }, {});

      // Add amenities to suites
      suites.forEach(suite => {
        suite.amenities = suiteAmenities[suite.id] || [];
        suite.average_rating = suite.average_rating ? parseFloat(suite.average_rating).toFixed(1) : null;
      });
    }

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
    console.error('Get suites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suites'
    });
  }
});

// Get single suite by ID
router.get('/:id', [
  param('id').isInt().withMessage('Suite ID must be a number')
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

    // Get suite details
    const [suites] = await pool.execute(`
      SELECT 
        s.*,
        u.first_name as owner_first_name,
        u.last_name as owner_last_name,
        u.profile_image as owner_profile_image,
        u.email as owner_email,
        po.bio as owner_bio,
        po.verification_status as owner_verification,
        pr.base_price,
        pr.weekend_price,
        pr.cleaning_fee,
        pr.extra_guest_fee,
        pr.security_deposit,
        pr.currency,
        pr.minimum_stay,
        pr.maximum_stay,
        (SELECT AVG(rating) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as average_rating,
        (SELECT COUNT(*) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as review_count
      FROM suites s
      JOIN users u ON s.owner_id = u.id
      LEFT JOIN property_owners po ON u.id = po.user_id
      LEFT JOIN pricing_rules pr ON s.id = pr.suite_id
      WHERE s.id = ? AND s.is_active = true
    `, [suiteId]);

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found'
      });
    }

    const suite = suites[0];

    // Get suite images
    const [images] = await pool.execute(`
      SELECT id, image_url, caption, is_primary, sort_order
      FROM suite_images
      WHERE suite_id = ?
      ORDER BY is_primary DESC, sort_order ASC
    `, [suiteId]);

    // Get suite amenities
    const [amenities] = await pool.execute(`
      SELECT a.name, a.category, a.icon
      FROM suite_amenities sa
      JOIN amenities a ON sa.amenity_id = a.id
      WHERE sa.suite_id = ?
    `, [suiteId]);

    // Get recent reviews
    const [reviews] = await pool.execute(`
      SELECT 
        r.*,
        u.first_name as reviewer_first_name,
        u.last_name as reviewer_last_name,
        u.profile_image as reviewer_profile_image
      FROM reviews r
      LEFT JOIN users u ON r.reviewer_id = u.id
      WHERE r.suite_id = ? AND r.is_approved = true
      ORDER BY r.created_at DESC
      LIMIT 10
    `, [suiteId]);

    // Get availability for next 3 months
    const [availability] = await pool.execute(`
      SELECT date, is_available, blocked_reason
      FROM suite_availability
      WHERE suite_id = ? AND date >= CURDATE() AND date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
      ORDER BY date ASC
    `, [suiteId]);

    // Format response
    suite.images = images;
    suite.amenities = amenities;
    suite.reviews = reviews;
    suite.availability = availability;
    suite.average_rating = suite.average_rating ? parseFloat(suite.average_rating).toFixed(1) : null;

    res.json({
      success: true,
      data: suite
    });

  } catch (error) {
    console.error('Get suite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suite details'
    });
  }
});

// Create new suite (Property owners only)
router.post('/', authenticateToken, requireRole(['property_owner']), upload.array('images', 20), [
  body('name').trim().isLength({ min: 3, max: 200 }),
  body('propertyType').isIn(['suite', 'condo', 'hotel_room', 'studio', 'villa', 'apartment']),
  body('address').trim().isLength({ min: 10, max: 500 }),
  body('city').trim().isLength({ min: 2, max: 100 }),
  body('country').trim().isLength({ min: 2, max: 100 }),
  body('capacity').isInt({ min: 1, max: 20 }),
  body('bedrooms').isInt({ min: 0, max: 10 }),
  body('bathrooms').isFloat({ min: 0, max: 10 }),
  body('description').trim().isLength({ min: 50, max: 2000 }),
  body('basePrice').isFloat({ min: 1 }),
  body('currency').isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'DOP']),
  body('minimumStay').optional().isInt({ min: 1, max: 365 }),
  body('maximumStay').optional().isInt({ min: 1, max: 365 })
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
      name, propertyType, address, city, country, latitude, longitude,
      sizeSqft, capacity, bedrooms, bathrooms, description,
      basePrice, weekendPrice, cleaningFee, extraGuestFee, securityDeposit,
      currency, minimumStay, maximumStay, amenities
    } = req.body;

    const ownerId = req.user.userId;

    // Start transaction
    await pool.execute('START TRANSACTION');

    try {
      // Insert suite
      const [suiteResult] = await pool.execute(`
        INSERT INTO suites (
          owner_id, name, property_type, address, city, country, 
          latitude, longitude, size_sqft, capacity, bedrooms, bathrooms, 
          description, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `, [
        ownerId, name, propertyType, address, city, country,
        latitude || null, longitude || null, sizeSqft || null,
        capacity, bedrooms, bathrooms, description
      ]);

      const suiteId = suiteResult.insertId;

      // Insert pricing rules
      await pool.execute(`
        INSERT INTO pricing_rules (
          suite_id, base_price, weekend_price, cleaning_fee, 
          extra_guest_fee, security_deposit, currency, minimum_stay, maximum_stay
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        suiteId, basePrice, weekendPrice || null, cleaningFee || 0,
        extraGuestFee || 0, securityDeposit || 0, currency,
        minimumStay || 1, maximumStay || null
      ]);

      // Insert amenities
      if (amenities && amenities.length > 0) {
        const amenityValues = amenities.map(amenityId => [suiteId, amenityId]);
        await pool.query(
          'INSERT INTO suite_amenities (suite_id, amenity_id) VALUES ?',
          [amenityValues]
        );
      }

      // Upload and insert images
      if (req.files && req.files.length > 0) {
        const imagePromises = req.files.map(async (file, index) => {
          try {
            const result = await uploadToCloudinary(file.path, 'suites');
            
            // Delete temp file
            await fs.unlink(file.path);
            
            return [
              suiteId,
              result.secure_url,
              file.originalname,
              index === 0, // First image is primary
              index
            ];
          } catch (uploadError) {
            console.error('Image upload error:', uploadError);
            return null;
          }
        });

        const imageResults = await Promise.all(imagePromises);
        const validImages = imageResults.filter(img => img !== null);

        if (validImages.length > 0) {
          await pool.query(
            'INSERT INTO suite_images (suite_id, image_url, caption, is_primary, sort_order) VALUES ?',
            [validImages]
          );
        }
      }

      await pool.execute('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Suite created successfully and is pending verification',
        data: { suiteId }
      });

    } catch (error) {
      await pool.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Create suite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create suite'
    });
  }
});

// Update suite (Owner only)
router.put('/:id', authenticateToken, [
  param('id').isInt(),
  body('name').optional().trim().isLength({ min: 3, max: 200 }),
  body('description').optional().trim().isLength({ min: 50, max: 2000 }),
  body('basePrice').optional().isFloat({ min: 1 })
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
    const userId = req.user.userId;

    // Check ownership
    const [suites] = await pool.execute(
      'SELECT owner_id FROM suites WHERE id = ?',
      [suiteId]
    );

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found'
      });
    }

    if (suites[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updates = {};
    const allowedFields = [
      'name', 'description', 'capacity', 'bedrooms', 'bathrooms',
      'address', 'city', 'country', 'latitude', 'longitude', 'size_sqft'
    ];

    // Build update object
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Update suite
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(suiteId);

    await pool.execute(
      `UPDATE suites SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    // Update pricing if provided
    const pricingUpdates = {};
    const pricingFields = [
      'basePrice', 'weekendPrice', 'cleaningFee', 'extraGuestFee',
      'securityDeposit', 'minimumStay', 'maximumStay'
    ];

    pricingFields.forEach(field => {
      if (req.body[field] !== undefined) {
        const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        pricingUpdates[dbField] = req.body[field];
      }
    });

    if (Object.keys(pricingUpdates).length > 0) {
      const pricingSetClause = Object.keys(pricingUpdates).map(key => `${key} = ?`).join(', ');
      const pricingValues = Object.values(pricingUpdates);
      pricingValues.push(suiteId);

      await pool.execute(
        `UPDATE pricing_rules SET ${pricingSetClause} WHERE suite_id = ?`,
        pricingValues
      );
    }

    res.json({
      success: true,
      message: 'Suite updated successfully'
    });

  } catch (error) {
    console.error('Update suite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update suite'
    });
  }
});

// Delete suite (Owner only)
router.delete('/:id', authenticateToken, [
  param('id').isInt()
], async (req, res) => {
  try {
    const suiteId = req.params.id;
    const userId = req.user.userId;

    // Check ownership
    const [suites] = await pool.execute(
      'SELECT owner_id FROM suites WHERE id = ?',
      [suiteId]
    );

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found'
      });
    }

    if (suites[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check for active bookings
    const [activeBookings] = await pool.execute(
      `SELECT COUNT(*) as count FROM bookings 
       WHERE suite_id = ? AND booking_status IN ('confirmed', 'pending') 
       AND check_out_date > CURDATE()`,
      [suiteId]
    );

    if (activeBookings[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete suite with active or upcoming bookings'
      });
    }

    // Soft delete (deactivate)
    await pool.execute(
      'UPDATE suites SET is_active = false WHERE id = ?',
      [suiteId]
    );

    res.json({
      success: true,
      message: 'Suite deleted successfully'
    });

  } catch (error) {
    console.error('Delete suite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete suite'
    });
  }
});

// Get owner's suites
router.get('/owner/my-suites', authenticateToken, requireRole(['property_owner']), async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [suites] = await pool.execute(`
      SELECT 
        s.*,
        pr.base_price,
        pr.currency,
        (SELECT image_url FROM suite_images si WHERE si.suite_id = s.id AND si.is_primary = true LIMIT 1) as primary_image,
        (SELECT COUNT(*) FROM bookings b WHERE b.suite_id = s.id AND b.booking_status = 'confirmed') as total_bookings,
        (SELECT AVG(rating) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as average_rating,
        (SELECT COUNT(*) FROM reviews r WHERE r.suite_id = s.id AND r.is_approved = true) as review_count
      FROM suites s
      LEFT JOIN pricing_rules pr ON s.id = pr.suite_id
      WHERE s.owner_id = ?
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `, [ownerId, limitNum, offset]);

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM suites WHERE owner_id = ?',
      [ownerId]
    );

    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        suites: suites.map(suite => ({
          ...suite,
          average_rating: suite.average_rating ? parseFloat(suite.average_rating).toFixed(1) : null
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
    console.error('Get owner suites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your suites'
    });
  }
});

// Update suite availability
router.put('/:id/availability', authenticateToken, [
  param('id').isInt(),
  body('dates').isArray().notEmpty(),
  body('dates.*.date').isISO8601().toDate(),
  body('dates.*.isAvailable').isBoolean(),
  body('dates.*.blockedReason').optional().trim().isLength({ max: 100 })
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
    const { dates } = req.body;
    const userId = req.user.userId;

    // Check ownership
    const [suites] = await pool.execute(
      'SELECT owner_id FROM suites WHERE id = ?',
      [suiteId]
    );

    if (suites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suite not found'
      });
    }

    if (suites[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update availability
    for (const dateInfo of dates) {
      await pool.execute(`
        INSERT INTO suite_availability (suite_id, date, is_available, blocked_reason)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        is_available = VALUES(is_available),
        blocked_reason = VALUES(blocked_reason)
      `, [
        suiteId, 
        dateInfo.date.toISOString().split('T')[0], 
        dateInfo.isAvailable, 
        dateInfo.blockedReason || null
      ]);
    }

    res.json({
      success: true,
      message: 'Availability updated successfully'
    });

  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability'
    });
  }
});

// Get available amenities
router.get('/amenities', async (req, res) => {
  try {
    const [amenities] = await pool.execute(`
      SELECT * FROM amenities ORDER BY category, name
    `);

    // Group by category
    const grouped = amenities.reduce((acc, amenity) => {
      if (!acc[amenity.category]) {
        acc[amenity.category] = [];
      }
      acc[amenity.category].push({
        id: amenity.id,
        name: amenity.name,
        icon: amenity.icon
      });
      return acc;
    }, {});

    res.json({
      success: true,
      data: grouped
    });

  } catch (error) {
    console.error('Get amenities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch amenities'
    });
  }
});

module.exports = router;