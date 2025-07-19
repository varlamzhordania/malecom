-- Malecom Suits Portal Database Schema
-- PostgreSQL/MySQL Compatible Database Schema
-- File: database/schema.sql

-- Users table (for all user types: admin, property_owner, client)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    profile_image VARCHAR(500),
    role ENUM('admin', 'property_owner', 'client') NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(255),
    mfa_temp_secret VARCHAR(255),
    mfa_backup_codes JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Property owners additional info
CREATE TABLE property_owners (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    payout_method VARCHAR(50),
    payout_details JSON,
    tax_info JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suites/Properties
CREATE TABLE suites (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    property_type ENUM('suite', 'condo', 'hotel_room', 'studio', 'villa', 'apartment') NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    size_sqft INTEGER,
    capacity INTEGER NOT NULL,
    bedrooms INTEGER NOT NULL,
    bathrooms DECIMAL(2,1) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Amenities (pre-defined list)
CREATE TABLE amenities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    icon VARCHAR(100)
);

-- Suite amenities junction table
CREATE TABLE suite_amenities (
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    amenity_id INTEGER REFERENCES amenities(id) ON DELETE CASCADE,
    PRIMARY KEY (suite_id, amenity_id)
);

-- Suite images
CREATE TABLE suite_images (
    id SERIAL PRIMARY KEY,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    caption VARCHAR(200),
    is_primary BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pricing rules
CREATE TABLE pricing_rules (
    id SERIAL PRIMARY KEY,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    base_price DECIMAL(10,2) NOT NULL,
    weekend_price DECIMAL(10,2),
    cleaning_fee DECIMAL(10,2) DEFAULT 0,
    extra_guest_fee DECIMAL(10,2) DEFAULT 0,
    security_deposit DECIMAL(10,2) DEFAULT 0,
    minimum_stay INTEGER DEFAULT 1,
    maximum_stay INTEGER,
    currency VARCHAR(3) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seasonal pricing
CREATE TABLE seasonal_pricing (
    id SERIAL PRIMARY KEY,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    price_multiplier DECIMAL(3,2) DEFAULT 1.00,
    fixed_price DECIMAL(10,2),
    name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_seasonal_suite_dates (suite_id, start_date, end_date),
    CONSTRAINT chk_seasonal_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_seasonal_multiplier CHECK (price_multiplier > 0)
);

-- Suite availability/calendar
CREATE TABLE suite_availability (
    id SERIAL PRIMARY KEY,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    blocked_reason VARCHAR(100),
    UNIQUE(suite_id, date)
);

-- Bookings
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    booking_reference VARCHAR(50) UNIQUE NOT NULL,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES users(id),
    guest_email VARCHAR(255) NOT NULL,
    guest_name VARCHAR(200) NOT NULL,
    guest_phone VARCHAR(20),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    guests_count INTEGER NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    booking_status ENUM('pending', 'confirmed', 'canceled', 'completed') DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'refunded', 'failed', 'disputed') DEFAULT 'pending',
    booking_source VARCHAR(50) DEFAULT 'direct',
    external_booking_id VARCHAR(100),
    special_requests TEXT,
    price_breakdown JSON,
    canceled_at TIMESTAMP NULL,
    cancellation_reason VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Booking payments
CREATE TABLE booking_payments (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_gateway_id VARCHAR(200),
    transaction_status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    error_message VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reviews and ratings
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    reviewer_id INTEGER REFERENCES users(id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    title VARCHAR(200),
    comment TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages between guests and owners
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id),
    suite_id INTEGER REFERENCES suites(id),
    sender_id INTEGER REFERENCES users(id) NOT NULL,
    receiver_id INTEGER REFERENCES users(id) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- External platform integrations
CREATE TABLE external_platforms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    api_endpoint VARCHAR(500),
    api_key VARCHAR(500),
    webhook_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suite external platform connections
CREATE TABLE suite_platform_connections (
    id SERIAL PRIMARY KEY,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    platform_id INTEGER REFERENCES external_platforms(id) ON DELETE CASCADE,
    external_suite_id VARCHAR(200),
    ical_url VARCHAR(500),
    sync_status ENUM('active', 'inactive', 'error') DEFAULT 'active',
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Wishlists/Favorites
CREATE TABLE wishlists (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    suite_id INTEGER REFERENCES suites(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, suite_id)
);

-- Failed webhooks (for retry queue)
CREATE TABLE failed_webhooks (
    id SERIAL PRIMARY KEY,
    webhook_id VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    payload JSON NOT NULL,
    signature VARCHAR(255) NOT NULL,
    attempts INTEGER NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_failed_webhooks_created (created_at),
    INDEX idx_failed_webhooks_url (url)
);

-- Audit logs for compliance
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    method VARCHAR(10),
    path VARCHAR(500),
    body JSON,
    response_status INTEGER,
    response_time_ms INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_user_time (user_id, timestamp),
    INDEX idx_audit_ip_time (ip_address, timestamp)
);

-- API keys for external partners
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    partner_name VARCHAR(100) NOT NULL,
    permissions JSON,
    rate_limit INTEGER DEFAULT 1000,
    is_active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_api_keys_active (is_active)
);

-- System settings
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default amenities
INSERT INTO amenities (name, category, icon) VALUES 
-- Interior Features
('Living Room', 'interior', 'sofa'),
('Full Kitchen', 'interior', 'chef-hat'),
('Kitchenette', 'interior', 'coffee'),
('Dining Table', 'interior', 'utensils'),
('Workspace/Desk', 'interior', 'laptop'),
('Walk-in Closet', 'interior', 'shirt'),

-- Technology & Entertainment
('High-Speed WiFi', 'technology', 'wifi'),
('Smart TV', 'technology', 'tv'),
('Cable TV', 'technology', 'tv'),
('Streaming Services', 'technology', 'play'),
('Sound System', 'technology', 'volume-2'),

-- Climate & Comfort
('Air Conditioning', 'comfort', 'snowflake'),
('Heating', 'comfort', 'thermometer'),
('Ceiling Fan', 'comfort', 'fan'),
('Hair Dryer', 'comfort', 'wind'),
('Iron & Board', 'comfort', 'shirt'),

-- Laundry & Cleaning
('Washer & Dryer', 'laundry', 'shirt'),
('Daily Cleaning', 'laundry', 'sparkles'),
('Weekly Cleaning', 'laundry', 'calendar'),
('Fresh Linens', 'laundry', 'bed'),

-- Safety & Security
('Safe/Vault', 'security', 'shield'),
('Smoke Detector', 'security', 'shield-alert'),
('First Aid Kit', 'security', 'heart'),
('Private Entrance', 'security', 'key'),

-- Outdoor & Views
('Ocean View', 'views', 'waves'),
('Mountain View', 'views', 'mountain'),
('City View', 'views', 'building'),
('Garden View', 'views', 'trees'),
('Balcony/Terrace', 'outdoor', 'sun'),
('Private Patio', 'outdoor', 'sun'),
('BBQ/Grill', 'outdoor', 'flame'),

-- Shared Amenities
('Swimming Pool', 'shared', 'waves'),
('Hot Tub/Jacuzzi', 'shared', 'waves'),
('Fitness Center', 'shared', 'dumbbell'),
('Spa Services', 'shared', 'heart'),
('Restaurant On-site', 'shared', 'utensils'),
('Bar/Lounge', 'shared', 'wine'),
('Concierge Service', 'shared', 'user-check'),
('Elevator Access', 'shared', 'arrow-up'),

-- Parking & Transport
('Free Parking', 'transport', 'car'),
('Paid Parking', 'transport', 'car'),
('Valet Parking', 'transport', 'car'),
('Airport Shuttle', 'transport', 'plane'),

-- Pet & Family
('Pet Friendly', 'policies', 'heart'),
('Child Friendly', 'policies', 'baby'),
('High Chair Available', 'policies', 'baby'),
('Crib Available', 'policies', 'baby');

-- Insert default settings
INSERT INTO settings (key, value, description) VALUES
('site_name', 'Malecom Suits', 'Website name'),
('site_email', 'info@malecomsuits.com', 'Contact email'),
('commission_rate', '10', 'Platform commission percentage'),
('currency_default', 'USD', 'Default currency'),
('booking_advance_days', '365', 'Maximum days in advance for booking'),
('min_booking_hours', '24', 'Minimum hours before check-in for booking'),
('auto_approve_bookings', 'false', 'Auto approve all bookings'),
('require_verification', 'true', 'Require property owner verification');

-- Create indexes for better performance
CREATE INDEX idx_suites_location ON suites(city, country);
CREATE INDEX idx_suites_owner ON suites(owner_id);
CREATE INDEX idx_suites_location_active ON suites(city, country, is_active, verification_status);
CREATE INDEX idx_bookings_dates ON bookings(check_in_date, check_out_date);
CREATE INDEX idx_bookings_suite ON bookings(suite_id);
CREATE INDEX idx_bookings_guest_email ON bookings(guest_email);
CREATE INDEX idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX idx_bookings_dates_status ON bookings(check_in_date, check_out_date, booking_status);
CREATE INDEX idx_suite_availability_date ON suite_availability(suite_id, date, is_available);
CREATE INDEX idx_suite_images_primary ON suite_images(suite_id, is_primary);
CREATE INDEX idx_messages_booking ON messages(booking_id);
CREATE INDEX idx_reviews_suite ON reviews(suite_id);
CREATE INDEX idx_reviews_approved_rating ON reviews(suite_id, is_approved, rating);
CREATE INDEX idx_pricing_rules_suite ON pricing_rules(suite_id);
CREATE INDEX idx_suite_amenities_suite ON suite_amenities(suite_id);