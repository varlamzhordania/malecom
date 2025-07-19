// backend/services/pricing.js
const moment = require('moment');
const pool = require('../config/database');

class PricingService {
  constructor() {
    this.holidayDates = new Set(); // Cache for holiday dates
    this.loadHolidays();
  }

  async loadHolidays() {
    try {
      // Load holiday dates from database or config
      // For now, using static Dominican Republic holidays
      const holidays2025 = [
        '2025-01-01', // New Year
        '2025-01-06', // Epiphany
        '2025-01-21', // Altagracia
        '2025-02-27', // Independence Day
        '2025-04-18', // Good Friday
        '2025-05-01', // Labor Day
        '2025-06-19', // Corpus Christi
        '2025-08-16', // Restoration Day
        '2025-09-24', // Our Lady of Mercedes
        '2025-11-06', // Constitution Day
        '2025-12-25'  // Christmas
      ];

      holidays2025.forEach(date => this.holidayDates.add(date));
    } catch (error) {
      console.error('Error loading holidays:', error);
    }
  }

  async calculatePricing({ suite, checkInDate, checkOutDate, guestsCount }) {
    try {
      const checkIn = moment(checkInDate);
      const checkOut = moment(checkOutDate);
      const nights = checkOut.diff(checkIn, 'days');

      if (nights <= 0) {
        throw new Error('Invalid date range');
      }

      // Get base pricing rules
      const basePrice = parseFloat(suite.base_price);
      const weekendPrice = parseFloat(suite.weekend_price) || basePrice;
      const cleaningFee = parseFloat(suite.cleaning_fee) || 0;
      const extraGuestFee = parseFloat(suite.extra_guest_fee) || 0;
      const securityDeposit = parseFloat(suite.security_deposit) || 0;
      const currency = suite.currency || 'USD';

      // Calculate nightly rates
      let totalNightlyRate = 0;
      const nightlyBreakdown = [];

      for (let i = 0; i < nights; i++) {
        const currentDate = moment(checkIn).add(i, 'days');
        const dateStr = currentDate.format('YYYY-MM-DD');
        const dayOfWeek = currentDate.day(); // 0 = Sunday, 6 = Saturday

        let nightlyRate = basePrice;

        // Apply weekend pricing (Friday and Saturday nights)
        if (dayOfWeek === 5 || dayOfWeek === 6) {
          nightlyRate = weekendPrice;
        }

        // Apply holiday pricing (150% of base rate)
        if (this.holidayDates.has(dateStr)) {
          nightlyRate = basePrice * 1.5;
        }

        // Apply seasonal pricing
        const seasonalMultiplier = await this.getSeasonalMultiplier(suite.id, currentDate);
        nightlyRate *= seasonalMultiplier;

        // Apply dynamic pricing based on demand
        const demandMultiplier = await this.getDemandMultiplier(suite.id, currentDate);
        nightlyRate *= demandMultiplier;

        totalNightlyRate += nightlyRate;
        
        nightlyBreakdown.push({
          date: dateStr,
          rate: Math.round(nightlyRate * 100) / 100,
          type: this.getRateType(dayOfWeek, dateStr)
        });
      }

      // Calculate extra guest fees
      const includedGuests = 2; // Assume base price includes 2 guests
      const extraGuests = Math.max(0, guestsCount - includedGuests);
      const totalExtraGuestFees = extraGuests * extraGuestFee * nights;

      // Calculate subtotal
      const subtotal = totalNightlyRate + totalExtraGuestFees;

      // Apply discounts
      const discounts = await this.calculateDiscounts(suite, subtotal, nights, checkIn);
      const discountAmount = discounts.reduce((sum, discount) => sum + discount.amount, 0);

      // Calculate taxes
      const taxRate = await this.getTaxRate(suite.country, suite.city);
      const taxableAmount = subtotal - discountAmount + cleaningFee;
      const taxes = Math.round(taxableAmount * taxRate * 100) / 100;

      // Calculate platform fee (charged to guest)
      const platformFeeRate = parseFloat(process.env.GUEST_SERVICE_FEE_RATE || '0.03');
      const platformFee = Math.round((subtotal - discountAmount) * platformFeeRate * 100) / 100;

      // Calculate total
      const total = subtotal - discountAmount + cleaningFee + taxes + platformFee + securityDeposit;

      return {
        currency,
        nights,
        breakdown: {
          nightly_rate: Math.round(totalNightlyRate * 100) / 100,
          nightly_breakdown: nightlyBreakdown,
          extra_guest_fees: Math.round(totalExtraGuestFees * 100) / 100,
          extra_guests: extraGuests,
          cleaning_fee: cleaningFee,
          security_deposit: securityDeposit,
          discounts: discounts,
          discount_total: Math.round(discountAmount * 100) / 100,
          taxes: taxes,
          tax_rate: taxRate,
          platform_fee: platformFee,
          subtotal: Math.round(subtotal * 100) / 100
        },
        total: Math.round(total * 100) / 100,
        total_without_deposit: Math.round((total - securityDeposit) * 100) / 100
      };

    } catch (error) {
      console.error('Pricing calculation error:', error);
      throw error;
    }
  }

  async getSeasonalMultiplier(suiteId, date) {
    try {
      const [seasonalRules] = await pool.execute(`
        SELECT price_multiplier, fixed_price
        FROM seasonal_pricing
        WHERE suite_id = ? 
          AND start_date <= ? 
          AND end_date >= ?
          AND is_active = true
        ORDER BY price_multiplier DESC
        LIMIT 1
      `, [suiteId, date.format('YYYY-MM-DD'), date.format('YYYY-MM-DD')]);

      if (seasonalRules.length > 0) {
        return parseFloat(seasonalRules[0].price_multiplier) || 1.0;
      }

      return 1.0;
    } catch (error) {
      console.error('Error getting seasonal multiplier:', error);
      return 1.0;
    }
  }

  async getDemandMultiplier(suiteId, date) {
    try {
      // Simple demand-based pricing: check bookings in the area for the same dates
      const dateStr = date.format('YYYY-MM-DD');
      
      const [demandData] = await pool.execute(`
        SELECT 
          COUNT(*) as booked_suites,
          (SELECT COUNT(*) FROM suites s2 
           JOIN users u ON s2.owner_id = u.id
           WHERE s2.city = s.city AND s2.is_active = true) as total_suites
        FROM bookings b
        JOIN suites s ON b.suite_id = s.id
        WHERE s.city = (SELECT city FROM suites WHERE id = ?)
          AND b.booking_status = 'confirmed'
          AND ? BETWEEN b.check_in_date AND DATE_SUB(b.check_out_date, INTERVAL 1 DAY)
      `, [suiteId, dateStr]);

      if (demandData.length > 0 && demandData[0].total_suites > 0) {
        const occupancyRate = demandData[0].booked_suites / demandData[0].total_suites;
        
        // Apply demand multiplier based on occupancy
        if (occupancyRate > 0.9) return 1.3; // 30% increase for very high demand
        if (occupancyRate > 0.8) return 1.2; // 20% increase for high demand
        if (occupancyRate > 0.7) return 1.1; // 10% increase for moderate demand
        if (occupancyRate < 0.3) return 0.9; // 10% discount for low demand
      }

      return 1.0;
    } catch (error) {
      console.error('Error calculating demand multiplier:', error);
      return 1.0;
    }
  }

  getRateType(dayOfWeek, dateStr) {
    if (this.holidayDates.has(dateStr)) {
      return 'holiday';
    }
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      return 'weekend';
    }
    return 'weekday';
  }

  async calculateDiscounts(suite, subtotal, nights, checkInDate) {
    const discounts = [];

    try {
      // Weekly discount (7+ nights)
      if (nights >= 7) {
        const weeklyDiscountRate = 0.1; // 10% off
        discounts.push({
          type: 'weekly_stay',
          name: 'Weekly Stay Discount',
          rate: weeklyDiscountRate,
          amount: Math.round(subtotal * weeklyDiscountRate * 100) / 100
        });
      }

      // Monthly discount (28+ nights)
      if (nights >= 28) {
        const monthlyDiscountRate = 0.2; // 20% off (replaces weekly)
        discounts.pop(); // Remove weekly discount
        discounts.push({
          type: 'monthly_stay',
          name: 'Monthly Stay Discount',
          rate: monthlyDiscountRate,
          amount: Math.round(subtotal * monthlyDiscountRate * 100) / 100
        });
      }

      // Early bird discount (booked 30+ days in advance)
      const daysUntilCheckIn = moment(checkInDate).diff(moment(), 'days');
      if (daysUntilCheckIn >= 30) {
        const earlyBirdRate = 0.05; // 5% off
        discounts.push({
          type: 'early_bird',
          name: 'Early Bird Discount',
          rate: earlyBirdRate,
          amount: Math.round(subtotal * earlyBirdRate * 100) / 100
        });
      }

      // Last minute discount (booked within 3 days)
      if (daysUntilCheckIn <= 3 && daysUntilCheckIn >= 1) {
        const lastMinuteRate = 0.15; // 15% off
        discounts.push({
          type: 'last_minute',
          name: 'Last Minute Deal',
          rate: lastMinuteRate,
          amount: Math.round(subtotal * lastMinuteRate * 100) / 100
        });
      }

      // First-time user discount (would need user context)
      // New property discount (property created within last 30 days)
      const [propertyAge] = await pool.execute(
        'SELECT DATEDIFF(NOW(), created_at) as days_old FROM suites WHERE id = ?',
        [suite.id]
      );

      if (propertyAge.length > 0 && propertyAge[0].days_old <= 30) {
        const newPropertyRate = 0.1; // 10% off
        discounts.push({
          type: 'new_property',
          name: 'New Property Discount',
          rate: newPropertyRate,
          amount: Math.round(subtotal * newPropertyRate * 100) / 100
        });
      }

    } catch (error) {
      console.error('Error calculating discounts:', error);
    }

    return discounts;
  }

  async getTaxRate(country, city) {
    try {
      // Tax rates by location
      const taxRates = {
        'Dominican Republic': {
          default: 0.18, // 18% ITBIS
          'Santo Domingo': 0.18,
          'Punta Cana': 0.16, // Tourist area reduced rate
          'Puerto Plata': 0.16
        },
        'United States': {
          default: 0.08,
          'New York': 0.12,
          'Florida': 0.06,
          'California': 0.10
        },
        'Canada': {
          default: 0.13, // HST
          'Toronto': 0.13,
          'Vancouver': 0.12
        }
      };

      const countryRates = taxRates[country];
      if (!countryRates) return 0.1; // Default 10%

      return countryRates[city] || countryRates.default || 0.1;

    } catch (error) {
      console.error('Error getting tax rate:', error);
      return 0.1;
    }
  }

  // Calculate owner payout after platform fees
  async calculateOwnerPayout(bookingAmount, currency = 'USD') {
    try {
      const platformCommissionRate = parseFloat(process.env.COMMISSION_RATE || '10') / 100;
      
      // Payment processing fees
      const processingFees = {
        'USD': { fixed: 0.30, percentage: 0.029 },
        'EUR': { fixed: 0.25, percentage: 0.029 },
        'GBP': { fixed: 0.20, percentage: 0.029 },
        'CAD': { fixed: 0.30, percentage: 0.029 },
        'AUD': { fixed: 0.30, percentage: 0.029 },
        'DOP': { fixed: 15.0, percentage: 0.035 }
      };

      const fees = processingFees[currency] || processingFees['USD'];
      
      const platformCommission = bookingAmount * platformCommissionRate;
      const processingFee = (bookingAmount * fees.percentage) + fees.fixed;
      const ownerPayout = bookingAmount - platformCommission - processingFee;

      return {
        booking_amount: Math.round(bookingAmount * 100) / 100,
        platform_commission: Math.round(platformCommission * 100) / 100,
        processing_fee: Math.round(processingFee * 100) / 100,
        owner_payout: Math.round(ownerPayout * 100) / 100,
        commission_rate: platformCommissionRate,
        currency
      };

    } catch (error) {
      console.error('Error calculating owner payout:', error);
      throw error;
    }
  }

  // Get pricing estimate for date range (used for calendar pricing display)
  async getPricingEstimate(suiteId, startDate, endDate) {
    try {
      const [suite] = await pool.execute(`
        SELECT s.*, pr.base_price, pr.weekend_price, pr.currency
        FROM suites s
        JOIN pricing_rules pr ON s.id = pr.suite_id
        WHERE s.id = ?
      `, [suiteId]);

      if (suite.length === 0) {
        throw new Error('Suite not found');
      }

      const pricing = await this.calculatePricing({
        suite: suite[0],
        checkInDate: startDate,
        checkOutDate: endDate,
        guestsCount: 2 // Default estimate for 2 guests
      });

      return {
        suite_id: suiteId,
        start_date: startDate,
        end_date: endDate,
        nights: pricing.nights,
        average_nightly_rate: Math.round((pricing.breakdown.nightly_rate / pricing.nights) * 100) / 100,
        total_before_fees: pricing.breakdown.subtotal,
        total_with_fees: pricing.total,
        currency: pricing.currency
      };

    } catch (error) {
      console.error('Error getting pricing estimate:', error);
      throw error;
    }
  }

  // Validate pricing for booking creation
  async validatePricing(suiteId, checkInDate, checkOutDate, guestsCount, expectedTotal) {
    try {
      const [suite] = await pool.execute(`
        SELECT s.*, pr.*
        FROM suites s
        JOIN pricing_rules pr ON s.id = pr.suite_id
        WHERE s.id = ?
      `, [suiteId]);

      if (suite.length === 0) {
        throw new Error('Suite not found');
      }

      const calculatedPricing = await this.calculatePricing({
        suite: suite[0],
        checkInDate,
        checkOutDate,
        guestsCount
      });

      const priceDifference = Math.abs(calculatedPricing.total - expectedTotal);
      const tolerance = 1.00; // Allow $1 difference for rounding

      if (priceDifference > tolerance) {
        return {
          valid: false,
          message: 'Price has changed since calculation',
          calculated_total: calculatedPricing.total,
          expected_total: expectedTotal,
          difference: priceDifference
        };
      }

      return {
        valid: true,
        pricing: calculatedPricing
      };

    } catch (error) {
      console.error('Error validating pricing:', error);
      throw error;
    }
  }

  // Get calendar pricing for a month
  async getCalendarPricing(suiteId, year, month) {
    try {
      const startDate = moment(`${year}-${month}-01`);
      const endDate = moment(startDate).endOf('month');
      const dates = [];

      // Generate all dates in the month
      for (let date = moment(startDate); date.isSameOrBefore(endDate); date.add(1, 'day')) {
        const pricing = await this.getPricingEstimate(
          suiteId, 
          date.format('YYYY-MM-DD'), 
          date.clone().add(1, 'day').format('YYYY-MM-DD')
        );

        dates.push({
          date: date.format('YYYY-MM-DD'),
          price: pricing.average_nightly_rate,
          available: true // This would be checked against bookings and availability
        });
      }

      return {
        suite_id: suiteId,
        year,
        month,
        dates
      };

    } catch (error) {
      console.error('Error getting calendar pricing:', error);
      throw error;
    }
  }
}

// Create singleton instance
const pricingService = new PricingService();

module.exports = {
  pricingService,
  calculatePricing: (data) => pricingService.calculatePricing(data),
  calculateOwnerPayout: (amount, currency) => pricingService.calculateOwnerPayout(amount, currency),
  getPricingEstimate: (suiteId, startDate, endDate) => pricingService.getPricingEstimate(suiteId, startDate, endDate),
  validatePricing: (suiteId, checkIn, checkOut, guests, expectedTotal) => 
    pricingService.validatePricing(suiteId, checkIn, checkOut, guests, expectedTotal),
  getCalendarPricing: (suiteId, year, month) => pricingService.getCalendarPricing(suiteId, year, month)
};