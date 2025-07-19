const moment = require('moment');

async function calculatePricing({ suite, checkInDate, checkOutDate, guestsCount }) {
  try {
    const checkIn = moment(checkInDate);
    const checkOut = moment(checkOutDate);
    const nights = checkOut.diff(checkIn, 'days');

    if (nights <= 0) {
      throw new Error('Invalid date range');
    }

    const basePrice = parseFloat(suite.base_price) || 100;
    const cleaningFee = parseFloat(suite.cleaning_fee) || 25;
    const currency = suite.currency || 'USD';

    const nightly_rate = basePrice * nights;
    const subtotal = nightly_rate + cleaningFee;
    const taxes = Math.round(subtotal * 0.1 * 100) / 100;
    const total = subtotal + taxes;

    return {
      currency,
      nights,
      breakdown: {
        nightly_rate,
        cleaning_fee: cleaningFee,
        taxes,
        subtotal
      },
      total: Math.round(total * 100) / 100
    };
  } catch (error) {
    console.error('Pricing calculation error:', error);
    throw error;
  }
}

module.exports = {
  calculatePricing
};