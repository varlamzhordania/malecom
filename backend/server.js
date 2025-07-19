// backend/server.js
// Main Express server for Malecom Suits booking platform

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const winston = require('winston');
const uuid = require('uuid');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

// Create Express app and HTTP server
const app = express();
const server = createServer(app);

// Configure Socket.IO for real-time messaging
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Configure Winston logger for structured logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, 'logs/error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, 'logs/combined.log') 
    }),
    // Console logging for development
    ...(process.env.NODE_ENV !== 'production' ? [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ] : [])
  ]
});

// Database connection pool configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'malecom_suits',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  acquireTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
  timeout: parseInt(process.env.DB_TIMEOUT) || 60000,
  reconnect: true,
  charset: 'utf8mb4'
};

// Create MySQL connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection on startup
const testDatabaseConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.execute('SELECT 1 as test');
    connection.release();
    logger.info('Database connected successfully', {
      host: dbConfig.host,
      database: dbConfig.database
    });
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      host: dbConfig.host,
      database: dbConfig.database
    });
    process.exit(1);
  }
};

// Monitor database connection pool
const monitorDatabasePool = () => {
  setInterval(() => {
    if (pool.pool) {
      const poolStatus = {
        allConnections: pool.pool._allConnections?.length || 0,
        acquiringConnections: pool.pool._acquiringConnections?.length || 0,
        freeConnections: pool.pool._freeConnections?.length || 0
      };
      
      // Log pool status at debug level
      logger.debug('Database pool status', poolStatus);
      
      // Warn if pool is running low on connections
      if (poolStatus.freeConnections < 2) {
        logger.warn('Database pool running low on connections', poolStatus);
      }
    }
  }, 60000); // Check every minute
};

// Request ID middleware for request tracking
const requestIdMiddleware = (req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuid.v4();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Powered-By', 'Malecom Suits API');
  next();
};

// Enhanced rate limiting with different tiers
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      error_code: 'RATE_LIMIT_EXCEEDED',
      retry_after: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID for authenticated requests, IP for anonymous
      return req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
    },
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userId: req.user?.id,
        path: req.path,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId
      });
      
      res.status(429).json({
        success: false,
        message,
        error_code: 'RATE_LIMIT_EXCEEDED',
        retry_after: Math.ceil(windowMs / 1000),
        limit: max,
        remaining: 0,
        reset_at: new Date(Date.now() + windowMs).toISOString(),
        request_id: req.requestId
      });
    }
  });
};

// Different rate limiters for different user types
const publicLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests from this IP. Please try again later.'
);

const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  500, // 500 requests
  'Too many requests from this user. Please try again later.'
);

const ownerLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  1000, // 1000 requests
  'Too many requests from this property owner. Please try again later.'
);

const adminLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  2000, // 2000 requests
  'Too many requests from this admin user. Please try again later.'
);

// Dynamic rate limiting based on user role
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

// Security middleware setup
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production'
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Request-ID',
    'X-Requested-With'
  ]
}));

// Request ID and basic middleware
app.use(requestIdMiddleware);

// Trust proxy if behind reverse proxy (nginx, etc.)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// CRITICAL: Raw body parser for Stripe webhooks BEFORE express.json()
app.use('/api/v1/bookings/payments/webhook', express.raw({ 
  type: 'application/json',
  limit: '1mb'
}));

// Regular JSON and URL-encoded parsers
app.use(express.json({ 
  limit: process.env.MAX_REQUEST_SIZE || '10mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    if (req.originalUrl.includes('/webhook')) {
      req.rawBody = buf;
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_REQUEST_SIZE || '10mb' 
}));

// Apply rate limiting
app.use(dynamicRateLimit);

// Request logging middleware (development only)
if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Request completed', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId,
        userId: req.user?.id
      });
    });
    
    next();
  });
}

// Make database pool and logger available to all routes
app.use((req, res, next) => {
  req.db = pool;
  req.logger = logger;
  next();
});

// Socket.IO configuration for real-time features
io.on('connection', (socket) => {
  logger.info('Socket.IO client connected', { 
    socketId: socket.id,
    userAgent: socket.handshake.headers['user-agent']
  });
  
  // Join room for booking-specific communication
  socket.on('join_booking_room', (bookingId) => {
    socket.join(`booking_${bookingId}`);
    logger.debug('Client joined booking room', { 
      socketId: socket.id, 
      bookingId 
    });
  });
  
  // Handle real-time messaging
  socket.on('send_message', async (data) => {
    try {
      const { roomId, message, senderId, receiverId } = data;
      
      // Validate message data
      if (!roomId || !message || !senderId) {
        socket.emit('message_error', { 
          error: 'Missing required message data' 
        });
        return;
      }
      
      // TODO: Save message to database
      // const messageService = require('./services/messageService');
      // const savedMessage = await messageService.saveMessage(data);
      
      // Emit message to room
      io.to(roomId).emit('receive_message', {
        id: uuid.v4(),
        message,
        senderId,
        receiverId,
        timestamp: new Date().toISOString()
      });
      
      logger.debug('Message sent to room', { 
        roomId, 
        senderId, 
        messageLength: message.length 
      });
      
    } catch (error) {
      logger.error('Socket message error', { 
        error: error.message, 
        data,
        socketId: socket.id 
      });
      socket.emit('message_error', { 
        error: 'Failed to send message' 
      });
    }
  });
  
  socket.on('disconnect', (reason) => {
    logger.info('Socket.IO client disconnected', { 
      socketId: socket.id, 
      reason 
    });
  });
});

// Import and setup routes
const authRoutes = require('./routes/auth');
const suiteRoutes = require('./routes/suites');
const bookingRoutes = require('./routes/bookings');
const userRoutes = require('./routes/users');
const currencyRoutes = require('./routes/currency');

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/suites', suiteRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/currency', currencyRoutes);

// Additional routes (when created)
// app.use('/api/v1/admin', adminRoutes);
// app.use('/api/v1/owners', ownerRoutes);
// app.use('/api/v1/external', externalRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.2.0',
      environment: process.env.NODE_ENV,
      dependencies: {}
    };
    
    // Check database connection
    const dbStart = Date.now();
    await pool.execute('SELECT 1 as health_check');
    const dbLatency = Date.now() - dbStart;
    
    health.dependencies.database = {
      status: 'connected',
      latency_ms: dbLatency,
      pool_status: {
        all_connections: pool.pool._allConnections?.length || 0,
        free_connections: pool.pool._freeConnections?.length || 0,
        acquiring_connections: pool.pool._acquiringConnections?.length || 0
      }
    };
    
    // Check Redis if configured
    if (process.env.REDIS_URL) {
      try {
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL);
        const redisStart = Date.now();
        await redis.ping();
        const redisLatency = Date.now() - redisStart;
        
        health.dependencies.redis = {
          status: 'connected',
          latency_ms: redisLatency
        };
        
        await redis.quit();
      } catch (redisError) {
        health.dependencies.redis = {
          status: 'disconnected',
          error: redisError.message
        };
      }
    }
    
    res.json(health);
    
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message,
      dependencies: {
        database: {
          status: 'disconnected',
          error: error.message
        }
      }
    });
  }
});

// API documentation endpoint
app.get('/api/v1', (req, res) => {
  res.json({
    name: 'Malecom Suits API',
    version: '1.2.0',
    description: 'Vacation suite booking platform API',
    documentation: '/api/v1/docs',
    endpoints: {
      auth: '/api/v1/auth',
      suites: '/api/v1/suites',
      bookings: '/api/v1/bookings',
      users: '/api/v1/users',
      currency: '/api/v1/currency',
      health: '/health'
    },
    timestamp: new Date().toISOString()
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  // Catch all handler for React Router
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  const errorResponse = {
    success: false,
    message: 'Internal server error',
    error_code: 'INTERNAL_ERROR',
    error_id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    request_id: req.requestId
  };
  
  // Include error details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error_details = {
      message: err.message,
      stack: err.stack
    };
  }
  
  res.status(err.status || 500).json(errorResponse);
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    error_code: 'ENDPOINT_NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: [
      '/api/v1/auth',
      '/api/v1/suites',
      '/api/v1/bookings',
      '/api/v1/users',
      '/api/v1/currency'
    ],
    timestamp: new Date().toISOString(),
    request_id: req.requestId
  });
});

// Generic 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    error_code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Server startup
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Test database connection
    await testDatabaseConnection();
    
    // Start monitoring
    monitorDatabasePool();
    
    // Start server
    server.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.2.0',
        timestamp: new Date().toISOString()
      });
      
      // Log configuration info
      logger.info('Configuration loaded', {
        database: {
          host: dbConfig.host,
          database: dbConfig.database,
          connectionLimit: dbConfig.connectionLimit
        },
        features: {
          redis: !!process.env.REDIS_URL,
          socketio: true,
          rateLimit: true,
          cors: true
        }
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await pool.end();
      logger.info('Database pool closed');
    } catch (error) {
      logger.error('Error closing database pool', { error: error.message });
    }
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

// Start the server
startServer();

// Export for testing
module.exports = { app, server, pool, logger, io };