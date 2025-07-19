-- database/seed.sql
-- Initial seed data for Malecom Suits

-- Insert default admin user
INSERT INTO users (email, password_hash, first_name, last_name, role, is_verified, is_active) VALUES
('admin@malecomsuits.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Admin', 'User', 'admin', true, true);

-- Insert sample property owners
INSERT INTO users (email, password_hash, first_name, last_name, phone, role, is_verified, is_active) VALUES
('maria@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Maria', 'Rodriguez', '+1-809-555-0101', 'property_owner', true, true),
('carlos@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Carlos', 'Martinez', '+1-809-555-0102', 'property_owner', true, true),
('ana@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Ana', 'Fernandez', '+1-809-555-0103', 'property_owner', true, true);

-- Insert sample clients
INSERT INTO users (email, password_hash, first_name, last_name, phone, role, is_verified, is_active) VALUES
('john@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'John', 'Smith', '+1-555-0201', 'client', true, true),
('sarah@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Sarah', 'Johnson', '+1-555-0202', 'client', true, true),
('michael@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeC5WJqOPhOB8K0G6', 'Michael', 'Brown', '+1-555-0203', 'client', true, true);

-- Insert property owner profiles
INSERT INTO property_owners (user_id, bio, verification_status, payout_method, payout_details) VALUES
(2, 'Experienced hospitality professional with over 10 years in vacation rentals in Punta Cana. I love helping guests have amazing experiences in the Dominican Republic.', 'verified', 'stripe', '{"accountId": "acct_1234567890"}'),
(3, 'Local property manager specializing in modern apartments in Santo Domingo. Passionate about showcasing the vibrant culture of our capital city.', 'verified', 'paypal', '{"email": "carlos@example.com"}'),
(4, 'Villa specialist in Bávaro with luxury beachfront properties. Committed to providing 5-star experiences for discerning travelers.', 'verified', 'bank_transfer', '{"bankName": "Banco Popular", "accountNumber": "1234567890", "routingNumber": "021000021"}');

-- Insert sample suites
INSERT INTO suites (owner_id, name, property_type, address, city, country, latitude, longitude, size_sqft, capacity, bedrooms, bathrooms, description, verification_status, is_active) VALUES
(2, 'Luxury Ocean View Suite', 'suite', 'Playa Dorada Complex, Costa Dorada', 'Puerto Plata', 'Dominican Republic', 19.8007, -70.6920, 1200, 4, 2, 2, 'Stunning oceanfront suite with panoramic views of the Atlantic. Features modern amenities, private balcony, and direct beach access. Perfect for couples or small families seeking luxury and tranquility.', 'verified', true),
(3, 'Modern City Center Apartment', 'apartment', 'Av. Winston Churchill 1425, Piantini', 'Santo Domingo', 'Dominican Republic', 18.4655, -69.9517, 850, 2, 1, 1, 'Sleek modern apartment in the heart of Santo Domingo\'s upscale Piantini district. Walking distance to shopping, restaurants, and cultural attractions. Ideal for business travelers and couples.', 'verified', true),
(4, 'Beachfront Villa Paradise', 'villa', 'Playa Bávaro, Resort Area', 'Bávaro', 'Dominican Republic', 18.5204, -68.4146, 3500, 8, 4, 3, 'Exclusive beachfront villa with private pool, chef service, and concierge. Features four spacious bedrooms, gourmet kitchen, and multiple entertainment areas. The ultimate luxury experience.', 'verified', true),
(2, 'Cozy Beach Studio', 'studio', 'Calle Principal, Zona Colonial', 'Punta Cana', 'Dominican Republic', 18.5601, -68.3725, 450, 2, 0, 1, 'Charming studio apartment just steps from the beach. Recently renovated with modern amenities while maintaining Caribbean charm. Perfect for couples on a romantic getaway.', 'verified', true),
(3, 'Family Condo with Pool', 'condo', 'Residencial Los Cacicazgos', 'Santo Domingo', 'Dominican Republic', 18.4734, -69.9384, 1100, 6, 3, 2, 'Spacious family-friendly condo with access to resort-style amenities including pool, gym, and playground. Located in safe, upscale neighborhood with easy access to city attractions.', 'verified', true);

-- Insert pricing rules for each suite
INSERT INTO pricing_rules (suite_id, base_price, weekend_price, cleaning_fee, extra_guest_fee, security_deposit, currency, minimum_stay, maximum_stay) VALUES
(1, 250.00, 300.00, 75.00, 25.00, 200.00, 'USD', 2, 30),
(2, 120.00, 140.00, 50.00, 15.00, 100.00, 'USD', 1, 14),
(3, 450.00, 550.00, 150.00, 50.00, 500.00, 'USD', 3, 60),
(4, 80.00, 95.00, 35.00, 10.00, 75.00, 'USD', 1, 7),
(5, 180.00, 210.00, 60.00, 20.00, 150.00, 'USD', 2, 21);

-- Insert sample amenities for each suite
INSERT INTO suite_amenities (suite_id, amenity_id) VALUES
-- Luxury Ocean View Suite amenities
(1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8), (1, 15), (1, 16), (1, 24), (1, 25), (1, 26),

-- Modern City Center Apartment amenities  
(2, 1), (2, 2), (2, 3), (2, 4), (2, 9), (2, 10), (2, 11), (2, 17), (2, 27), (2, 28),

-- Beachfront Villa Paradise amenities
(3, 1), (3, 2), (3, 3), (3, 4), (3, 5), (3, 6), (3, 7), (3, 8), (3, 12), (3, 13), (3, 14), (3, 15), (3, 16), (3, 18), (3, 19), (3, 20), (3, 21), (3, 24), (3, 25), (3, 26), (3, 29), (3, 30),

-- Cozy Beach Studio amenities
(4, 1), (4, 2), (4, 3), (4, 4), (4, 15), (4, 24),

-- Family Condo with Pool amenities
(5, 1), (5, 2), (5, 3), (5, 4), (5, 5), (5, 9), (5, 10), (5, 11), (5, 17), (5, 22), (5, 23), (5, 31), (5, 32);

-- Insert sample suite images (placeholder URLs)
INSERT INTO suite_images (suite_id, image_url, caption, is_primary, sort_order) VALUES
(1, 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800', 'Ocean view from master bedroom', true, 0),
(1, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800', 'Spacious living area with ocean views', false, 1),
(1, 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800', 'Modern kitchen with breakfast bar', false, 2),
(1, 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800', 'Private balcony overlooking the ocean', false, 3),

(2, 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800', 'Modern city apartment living room', true, 0),
(2, 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800', 'Sleek bedroom with city views', false, 1),
(2, 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800', 'Contemporary kitchen and dining', false, 2),

(3, 'https://images.unsplash.com/photo-1602343168117-bb8ffe3e2e9f?w=800', 'Beachfront villa exterior', true, 0),
(3, 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800', 'Private pool and entertainment area', false, 1),
(3, 'https://images.unsplash.com/photo-1571055107559-3e67626fa8be?w=800', 'Master suite with ocean views', false, 2),
(3, 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=800', 'Gourmet kitchen with island', false, 3),

(4, 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800', 'Cozy studio with beach access', true, 0),
(4, 'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800', 'Compact but comfortable living space', false, 1),

(5, 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800', 'Family condo living room', true, 0),
(5, 'https://images.unsplash.com/photo-1560185007-5f0bb1866cab?w=800', 'Children\'s bedroom with bunk beds', false, 1),
(5, 'https://images.unsplash.com/photo-1582037928769-181f2644ecb7?w=800', 'Shared pool area', false, 2);

-- Insert sample seasonal pricing
INSERT INTO seasonal_pricing (suite_id, start_date, end_date, price_multiplier, name, is_active) VALUES
(1, '2025-12-15', '2026-01-15', 1.5, 'Holiday Season', true),
(1, '2025-06-15', '2025-08-31', 1.3, 'Summer Peak', true),
(2, '2025-12-20', '2026-01-10', 1.4, 'New Year Period', true),
(3, '2025-12-01', '2026-01-31', 2.0, 'Holiday Premium', true),
(3, '2025-07-01', '2025-08-31', 1.6, 'Summer Luxury', true),
(4, '2025-02-14', '2025-02-16', 1.8, 'Valentine\'s Weekend', true),
(5, '2025-07-15', '2025-08-15', 1.2, 'Family Summer', true);

-- Insert sample bookings
INSERT INTO bookings (booking_reference, suite_id, guest_id, guest_email, guest_name, guest_phone, check_in_date, check_out_date, guests_count, total_amount, booking_status, payment_status, special_requests, price_breakdown) VALUES
('MC2025001', 1, 5, 'john@example.com', 'John Smith', '+1-555-0201', '2025-08-15', '2025-08-22', 2, 1875.00, 'confirmed', 'paid', 'Anniversary celebration - late checkout if possible', '{"nightly_rate": 1750.00, "cleaning_fee": 75.00, "taxes": 50.00}'),
('MC2025002', 2, 6, 'sarah@example.com', 'Sarah Johnson', '+1-555-0202', '2025-09-01', '2025-09-05', 1, 520.00, 'confirmed', 'paid', 'Business trip - need early check-in', '{"nightly_rate": 480.00, "cleaning_fee": 50.00, "taxes": 40.00}'),
('MC2025003', 3, 7, 'michael@example.com', 'Michael Brown', '+1-555-0203', '2025-10-10', '2025-10-17', 6, 3465.00, 'pending', 'pending', 'Family vacation with children ages 8, 12, and 15', '{"nightly_rate": 3150.00, "cleaning_fee": 150.00, "extra_guest_fees": 100.00, "taxes": 165.00}');

-- Insert sample booking payments
INSERT INTO booking_payments (booking_id, amount, payment_method, payment_gateway_id, transaction_status) VALUES
(1, 1875.00, 'stripe', 'pi_1234567890abcdef', 'completed'),
(2, 520.00, 'paypal', 'PAY-1234567890abcdef', 'completed'),
(3, 346.50, 'stripe', 'pi_0987654321fedcba', 'pending');

-- Insert sample reviews
INSERT INTO reviews (booking_id, suite_id, reviewer_id, rating, title, comment, is_approved) VALUES
(1, 1, 5, 5, 'Amazing Ocean Views!', 'The suite exceeded our expectations! The ocean views were breathtaking, and Maria was an incredible host. The property was spotless and exactly as described. We will definitely be back for our next anniversary!', true),
(2, 2, 6, 4, 'Great Location for Business', 'Perfect location in Santo Domingo for my business meetings. The apartment was modern and comfortable, with excellent WiFi. Carlos was very responsive to all my questions. Only minor issue was some street noise at night.', true);

-- Insert sample messages
INSERT INTO messages (booking_id, sender_id, receiver_id, message, is_read) VALUES
(1, 5, 2, 'Hi Maria! We are so excited about our upcoming stay. Could you please let us know the best way to get from the airport to your property?', true),
(1, 2, 5, 'Hello John! Welcome to the Dominican Republic! I recommend taking a taxi or booking a private transfer. The journey takes about 45 minutes. I can arrange a transfer for you if needed. Looking forward to hosting you!', true),
(1, 5, 2, 'That would be wonderful! Please arrange the transfer. We arrive on flight AA1234 at 3:30 PM on August 15th.', true),
(2, 6, 3, 'Carlos, thank you for the smooth check-in process. The apartment is perfect for my needs!', true),
(2, 3, 6, 'You are very welcome, Sarah! Please do not hesitate to reach out if you need anything during your stay. Enjoy Santo Domingo!', false);

-- Insert sample suite availability (blocking some dates)
INSERT INTO suite_availability (suite_id, date, is_available, blocked_reason) VALUES
(1, '2025-08-01', false, 'Maintenance'),
(1, '2025-08-02', false, 'Maintenance'),
(1, '2025-12-24', false, 'Owner personal use'),
(1, '2025-12-25', false, 'Owner personal use'),
(2, '2025-09-15', false, 'Deep cleaning'),
(3, '2025-11-01', false, 'Property inspection'),
(3, '2025-11-02', false, 'Property inspection'),
(4, '2025-08-20', false, 'Maintenance'),
(5, '2025-10-01', false, 'Renovation');

-- Update settings with proper values
UPDATE settings SET value = 'Malecom Suits' WHERE key = 'site_name';
UPDATE settings SET value = 'info@malecomsuits.com' WHERE key = 'site_email';
UPDATE settings SET value = '10' WHERE key = 'commission_rate';
UPDATE settings SET value = 'USD' WHERE key = 'currency_default';
UPDATE settings SET value = '365' WHERE key = 'booking_advance_days';
UPDATE settings SET value = '24' WHERE key = 'min_booking_hours';
UPDATE settings SET value = 'false' WHERE key = 'auto_approve_bookings';
UPDATE settings SET value = 'true' WHERE key = 'require_verification';

-- Insert additional settings for Docker environment
INSERT INTO settings (key, value, description) VALUES
('maintenance_mode', 'false', 'Enable maintenance mode'),
('max_file_size', '10485760', 'Maximum file upload size in bytes'),
('supported_currencies', 'USD,EUR,GBP,CAD,AUD,DOP', 'Comma-separated list of supported currencies'),
('default_check_in_time', '15:00', 'Default check-in time'),
('default_check_out_time', '11:00', 'Default check-out time'),
('guest_service_fee_rate', '0.03', 'Guest service fee percentage'),
('owner_early_payout', 'false', 'Allow owners to request early payouts'),
('review_auto_approve', 'false', 'Automatically approve reviews'),
('email_notifications', 'true', 'Enable email notifications'),
('sms_notifications', 'false', 'Enable SMS notifications');

-- Create indexes for better performance (if not already created)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);
CREATE INDEX IF NOT EXISTS idx_suites_city_country ON suites(city, country);
CREATE INDEX IF NOT EXISTS idx_suites_owner_active ON suites(owner_id, is_active);
CREATE INDEX IF NOT EXISTS idx_suites_verification ON suites(verification_status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_suite_status ON bookings(suite_id, booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id, guest_email);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX IF NOT EXISTS idx_reviews_suite_approved ON reviews(suite_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_suite_availability_date ON suite_availability(suite_id, date);
CREATE INDEX IF NOT EXISTS idx_seasonal_pricing_dates ON seasonal_pricing(suite_id, start_date, end_date);

-- Insert some test data for development
-- Note: Password for all test users is "password123" (hashed)
-- Admin credentials: admin@malecomsuits.com / password123