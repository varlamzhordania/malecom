# Malecom Suits - Backend API

A comprehensive vacation rental platform backend built with Node.js, Express, and MySQL.

## 🏗️ Architecture Overview

```
├── backend/
│   ├── config/
│   │   └── database.js          # Database configuration & utilities
│   ├── middleware/
│   │   └── auth.js              # Authentication & authorization
│   ├── routes/
│   │   ├── auth.js              # User authentication endpoints
│   │   ├── suites.js            # Property management endpoints
│   │   ├── bookings.js          # Booking management endpoints
│   │   ├── admin.js             # Admin panel endpoints
│   │   └── reviews.js           # Reviews & messaging endpoints
│   ├── services/
│   │   ├── email.js             # Email service (Nodemailer)
│   │   ├── payment.js           # Payment processing (Stripe/PayPal)
│   │   └── pricing.js           # Dynamic pricing calculations
│   ├── database/
│   │   └── schema.sql           # Complete database schema
│   ├── package.json             # Dependencies and scripts
│   ├── server.js                # Main application entry point
│   └── .env.example             # Environment variables template
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- MySQL 8.0+
- npm or yarn

### Installation

1. **Clone and setup**
```bash
cd backend
npm install
```

2. **Environment Configuration**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Database Setup**
```bash
# Create database
mysql -u root -p
CREATE DATABASE malecom_suits;

# Import schema
mysql -u root -p malecom_suits < database/schema.sql
```

4. **Start Development Server**
```bash
npm run dev
```

The API will be available at `http://localhost:5000`

## 📊 Database Schema

### Core Tables

- **users** - User accounts (clients, property owners, admins)
- **property_owners** - Extended profile for property owners
- **suites** - Property listings
- **pricing_rules** - Base pricing configuration
- **seasonal_pricing** - Dynamic seasonal rates
- **suite_availability** - Calendar blocking
- **bookings** - Reservation records
- **booking_payments** - Payment transactions
- **reviews** - Guest reviews and ratings
- **messages** - In-app messaging system
- **amenities** - Available amenities catalog

## 🔐 Authentication & Authorization

### JWT-based Authentication
- Secure token-based authentication
- Role-based access control (admin, property_owner, client)
- Multi-factor authentication (MFA) support
- Password reset functionality

### API Security
- Rate limiting per user role
- CORS protection
- Helmet security headers
- Request validation & sanitization

## 🏠 Core Features

### Property Management
- **CRUD Operations**: Create, read, update, delete properties
- **Image Upload**: Cloudinary integration for photos
- **Amenities Management**: Categorized amenity system
- **Verification Process**: Admin approval workflow
- **Availability Calendar**: Date-based blocking system

### Booking System
- **Real-time Availability**: Conflict detection
- **Dynamic Pricing**: Seasonal, demand-based, and discount calculations
- **Payment Processing**: Stripe and PayPal integration
- **Booking Lifecycle**: Pending → Confirmed → Completed → Reviewed
- **Cancellation Handling**: Automated refund processing

### Pricing Engine
```javascript
// Pricing factors include:
- Base nightly rates
- Weekend premiums
- Seasonal multipliers
- Demand-based adjustments
- Holiday pricing
- Multi-night discounts (weekly/monthly)
- Early bird discounts
- Last-minute deals
- Platform fees and taxes
```

### Communication System
- **Real-time Messaging**: Socket.IO integration
- **Email Notifications**: Automated booking confirmations
- **Review System**: Guest feedback and ratings
- **Admin Moderation**: Content approval workflow

## 📧 Email Service

Integrated email system with templates:
- Account verification
- Password reset
- Booking confirmations
- Cancellation notices
- Review requests
- Payment receipts

## 💳 Payment Processing

### Supported Payment Methods
- **Stripe**: Credit/debit cards, digital wallets
- **PayPal**: PayPal accounts and cards
- **Bank Transfer**: Manual verification process

### Financial Features
- Automatic fee calculation
- Owner payout management
- Refund processing
- Transaction logging
- Multi-currency support (USD, EUR, GBP, CAD, AUD, DOP)

## 🔧 Admin Panel Features

### Dashboard Analytics
- Revenue and booking statistics
- User growth metrics
- Top performing properties
- Payment analytics

### Content Management
- User account management
- Property verification queue
- Review moderation
- System settings configuration

### Monitoring Tools
- Real-time health checks
- Error logging and tracking
- Performance metrics
- Database statistics

## 🌐 API Endpoints

### Authentication (`/api/v1/auth`)
```
POST   /register          # User registration
POST   /login             # User login
POST   /verify-email      # Email verification
POST   /forgot-password   # Password reset request
POST   /reset-password    # Password reset confirmation
GET    /profile           # Get current user
POST   /mfa/enable        # Enable 2FA
POST   /logout            # User logout
```

### Suites (`/api/v1/suites`)
```
GET    /                  # List suites with filters
GET    /:id               # Get suite details
POST   /                  # Create new suite (owners)
PUT    /:id               # Update suite (owners)
DELETE /:id               # Delete suite (owners)
GET    /owner/my-suites   # Owner's properties
PUT    /:id/availability  # Update availability calendar
GET    /amenities         # Get available amenities
```

### Bookings (`/api/v1/bookings`)
```
GET    /                  # List bookings with filters
GET    /:id               # Get booking details
POST   /                  # Create new booking
PUT    /:id/cancel        # Cancel booking
PUT    /:id/status        # Update booking status (owners/admin)
GET    /suite/:suiteId/availability # Check availability
```

### Reviews (`/api/v1/reviews`)
```
GET    /suite/:suiteId    # Get suite reviews
POST   /                  # Create review (completed bookings)
GET    /my-reviews        # Get user's reviews
PUT    /:id               # Update review (before approval)
DELETE /:id               # Delete review
```

### Messages (`/api/v1/messages`)
```
GET    /conversations     # Get user conversations
GET    /conversation/:userId # Get messages with specific user
POST   /                  # Send message
PUT    /:id/read          # Mark message as read
GET    /unread-count      # Get unread message count
```

### Admin (`/api/v1/admin`)
```
GET    /dashboard         # Admin dashboard stats
GET    /users             # User management
GET    /users/:id         # User details
PUT    /users/:id/status  # Update user status
GET    /suites/pending    # Pending verifications
PUT    /suites/:id/verify # Verify/reject suite
GET    /reviews           # Review moderation
PUT    /reviews/:id/moderate # Approve/reject review
GET    /settings          # Platform settings
PUT    /settings          # Update settings
GET    /analytics         # System analytics
```

## 🛠️ Development Setup

### Environment Variables
```bash
# Server
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=malecom_suits

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Email (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Stripe
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### NPM Scripts
```bash
npm start          # Production server
npm run dev        # Development with nodemon
npm test           # Run test suite
npm run lint       # ESLint code checking
npm run migrate    # Run database migrations
npm run seed       # Seed initial data
```

### Testing
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- routes/auth.test.js
```

## 🔒 Security Features

### Data Protection
- Password hashing with bcrypt (12 rounds)
- JWT token-based authentication
- SQL injection prevention
- XSS protection via helmet
- CORS configuration
- Request rate limiting

### Input Validation
- express-validator for all inputs
- File upload restrictions
- Email format validation
- Phone number validation
- Strong password requirements

### Monitoring & Logging
- Winston logging with rotation
- Request tracking with unique IDs
- Error stack traces in development
- Health check endpoints
- Database connection monitoring

## 📈 Performance Optimizations

### Database
- Proper indexing on frequently queried columns
- Connection pooling
- Query optimization
- Pagination for large datasets

### Caching
- Redis integration (optional)
- Static file serving in production
- Database query result caching

### Rate Limiting
- Different limits per user role
- IP-based limiting for public endpoints
- Sliding window algorithm

## 🚀 Production Deployment

### Environment Setup
```bash
# Set production environment
NODE_ENV=production

# Configure production database
DB_HOST=your-prod-db-host
DB_SSL=true

# Use production email service
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key

# Production payment keys
STRIPE_SECRET_KEY=sk_live_your_live_key
```

### Process Management
```bash
# Using PM2
pm2 start server.js --name "malecom-api"
pm2 startup
pm2 save

# Or using Docker
docker build -t malecom-api .
docker run -p 5000:5000 malecom-api
```

### Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name api.malecomsuits.com;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🧪 API Testing

### Using curl
```bash
# Register new user
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe",
    "role": "client"
  }'

# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'

# Get suites
curl -X GET "http://localhost:5000/api/v1/suites?city=Punta Cana&capacity=4"
```

### Using Postman
Import the provided Postman collection for comprehensive API testing.

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Failed**
```bash
# Check MySQL service
sudo systemctl status mysql

# Verify credentials
mysql -u root -p

# Check database exists
SHOW DATABASES;
```

2. **Email Not Sending**
```bash
# Check SMTP credentials
# Enable 2FA and use app password for Gmail
# Verify firewall allows SMTP ports
```

3. **Payment Webhook Failures**
```bash
# Verify webhook URL is accessible
# Check Stripe dashboard for delivery attempts
# Ensure webhook secret matches
```

4. **Socket.IO Connection Issues**
```bash
# Check CORS configuration
# Verify JWT token in socket auth
# Check firewall for WebSocket ports
```

### Debug Mode
```bash
# Enable detailed logging
DEBUG=malecom:* npm run dev

# Check specific component
DEBUG=malecom:database npm run dev
```

## 🧑‍💻 Development Guidelines

### Code Style
- Use ESLint configuration
- Follow async/await patterns
- Include error handling in all routes
- Add input validation for all endpoints
- Write unit tests for new features

### Git Workflow
```bash
# Feature branch
git checkout -b feature/new-feature
git commit -m "feat: add new feature"
git push origin feature/new-feature

# Create pull request for review
```

### Database Changes
```bash
# Create migration file
npm run create-migration add_new_table

# Run migrations
npm run migrate

# Rollback if needed
npm run migrate:rollback
```

## 📚 Additional Resources

- [API Documentation](http://localhost:5000/api/v1) - Interactive API docs
- [Database Schema](./database/schema.sql) - Complete database structure
- [Environment Variables](./.env.example) - Configuration template
- [Testing Guide](./tests/README.md) - Testing best practices

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new features
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

---

## ✅ Next Steps

Your backend is now complete! Here's what you can do next:

1. **Start Development**: Run `npm run dev` to start the server
2. **Test API Endpoints**: Use the provided curl examples or Postman
3. **Build Frontend**: Create React frontend to consume these APIs
4. **Deploy**: Set up production environment with proper security
5. **Monitor**: Implement logging and monitoring solutions

For questions or support, please check the troubleshooting section or create an issue.