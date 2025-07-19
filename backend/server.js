// backend/server.js - Complete Integration
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const { v4: uuid } = require('uuid');

// Database and services
const { initializeDatabase, closeDatabase } = require('./config/database');

// Middleware
const { authenticateToken } = require('./middleware/auth');

// Routes
const authRoutes = require('./routes/auth');
const suiteRoutes = require('./routes/suites');
const bookingRoutes = require('./routes/bookings');
const adminRoutes = require('./routes/admin');
const { router: reviewRoutes, messagesRouter } = require('./routes/reviews');

// Services
const { emailService } = require('./services/email');
const { paymentService } = require('./services/payment');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO for real-time messaging
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Configure Winston Logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'malecom-suits-api' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Request ID middleware
const requestIdMiddleware = (req, res, next) => {
  req.requestId = uuid();
  req.logger = logger.child({ requestId: req.requestId });
  res.setHeader('X-Request-ID', req.requestId);
  
  req.logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  next();
};

// Rate limiting configuration
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later',
      error_code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`;
    },
    handler: (req, res) => {
      req.logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userId: req.user?.userId,
        path: req.path
      });
      
      res.status(429).json({
        success: false,
        message,
        error_code: 'RATE_LIMIT_EXCEEDED',
        retry_after: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// Different rate limiters
const publicLimiter = createRateLimiter(15 * 60 * 1000, 100, 'Too many requests from this IP');
const authLimiter = createRateLimiter(15 * 60 * 1000, 500, 'Too many requests from this user');
const ownerLimiter = createRateLimiter(15 * 60 * 1000, 1000, 'Too many requests from this property owner');
const adminLimiter = createRateLimiter(15 * 60 * 1000, 2000, 'Too many requests from this admin');

// Dynamic rate limiting
const dynamicRateLimit = (req, res, next) => {
  if (!req.user) {
    return publicLimiter(req, res, next);
  }
  
  switch (req.user.role) {
    case 'admin':
      return adminLimiter(req, res, next);
    case 'property_owner':
      return ownerLimiter(req, res, next);
    default:
      return authLimiter(req, res, next);
  }
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production'
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

// Basic middleware
app.use(requestIdMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Apply rate limiting
app.use('/api/', dynamicRateLimit);

// Health check endpoint (no rate limiting)
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: require('./package.json').version,
      environment: process.env.NODE_ENV,
      dependencies: {}
    };
    
    // Check database
    const { checkConnection } = require('./config/database');
    const dbConnected = await checkConnection();
    health.dependencies.database = {
      status: dbConnected ? 'connected' : 'disconnected'
    };
    
    // Check email service
    try {
      const emailStatus = await emailService.testConnection();
      health.dependencies.email = emailStatus;
    } catch (emailError) {
      health.dependencies.email = { success: false, error: emailError.message };
    }
    
    // Check payment service
    health.dependencies.payment = {
      stripe: !!process.env.STRIPE_SECRET_KEY,
      paypal: !!process.env.PAYPAL_CLIENT_ID
    };
    
    const isHealthy = health.dependencies.database.status === 'connected';
    res.status(isHealthy ? 200 : 503).json(health);
    
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API documentation endpoint
app.get('/api/v1', (req, res) => {
  res.json({
    name: 'Malecom Suits API',
    version: require('./package.json').version,
    description: 'Vacation suite booking platform API',
    documentation: `${req.protocol}://${req.get('host')}/api/v1/docs`,
    endpoints: {
      auth: '/api/v1/auth',
      suites: '/api/v1/suites',
      bookings: '/api/v1/bookings',
      reviews: '/api/v1/reviews',
      messages: '/api/v1/messages',
      admin: '/api/v1/admin',
      health: '/health'
    },
    timestamp: new Date().toISOString()
  });
});

// Socket.IO for real-time messaging
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { pool } = require('./config/database');
    const [users] = await pool.execute(
      'SELECT id, email, role FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    if (users.length === 0) {
      return next(new Error('User not found'));
    }

    socket.user = users[0];
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  logger.info('Socket.IO client connected', { 
    socketId: socket.id, 
    userId: socket.user.id 
  });

  // Join user to their own room
  socket.join(`user_${socket.user.id}`);

  // Handle joining conversation rooms
  socket.on('join_conversation', (otherUserId) => {
    const roomId = [socket.user.id, otherUserId].sort().join('_');
    socket.join(roomId);
    logger.debug('User joined conversation room', { 
      userId: socket.user.id, 
      roomId 
    });
  });

  // Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const { receiverId, message, bookingId } = data;
      const senderId = socket.user.id;
      
      // Validate message
      if (!receiverId || !message || message.trim().length === 0) {
        socket.emit('message_error', { error: 'Invalid message data' });
        return;
      }

      // Create room ID
      const roomId = [senderId, receiverId].sort().join('_');
      
      // Save message to database
      const { pool } = require('./config/database');
      const [result] = await pool.execute(`
        INSERT INTO messages (sender_id, receiver_id, message, booking_id)
        VALUES (?, ?, ?, ?)
      `, [senderId, receiverId, message.trim(), bookingId || null]);

      const messageData = {
        id: result.insertId,
        senderId,
        receiverId,
        message: message.trim(),
        bookingId: bookingId || null,
        timestamp: new Date().toISOString(),
        isRead: false
      };

      // Emit to room
      io.to(roomId).emit('receive_message', messageData);
      
      // Send notification to receiver
      io.to(`user_${receiverId}`).emit('new_message_notification', {
        senderId,
        senderName: `${socket.user.email}`,
        preview: message.substring(0, 100)
      });
      
    } catch (error) {
      logger.error('Socket message error', { 
        error: error.message, 
        userId: socket.user.id 
      });
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info('Socket.IO client disconnected', { 
      socketId: socket.id, 
      userId: socket.user.id,
      reason 
    });
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes.router || authRoutes);
app.use('/api/v1/suites', suiteRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/admin', adminRoutes);

// Webhook endpoints (no rate limiting)
app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const event = paymentService.verifyWebhookSignature(
      req.body, 
      signature, 
      process.env.STRIPE_WEBHOOK_SECRET
    );

    await paymentService.handleWebhookEvent(event);
    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('Stripe webhook error', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    error_code: 'NOT_FOUND'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  req.logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' ? 
    'Internal server error' : err.message;

  res.status(err.status || 500).json({
    success: false,
    message,
    error_code: 'INTERNAL_ERROR',
    request_id: req.requestId
  });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await closeDatabase();
      logger.info('Database connections closed');
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Start the server
const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized successfully');

    // Start HTTP server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      logger.info(`🚀 Malecom Suits API server running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        port: PORT,
        cors_origin: process.env.FRONTEND_URL || 'http://localhost:3000'
      });
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Start the application
if (require.main === module) {
  startServer();
}

module.exports = { app, server, io };