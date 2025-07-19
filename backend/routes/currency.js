// backend/routes/currency.js - FIXED VERSION
const express = require('express');
const { query, body, validationResult } = require('express-validator');

const router = express.Router();

// Supported currencies
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'DOP'];

// Mock exchange rates
const MOCK_EXCHANGE_RATES = {
  USD: {
    EUR: 0.85,
    GBP: 0.73,
    CAD: 1.25,
    AUD: 1.35,
    DOP: 58.50
  },
  EUR: {
    USD: 1.18,
    GBP: 0.86,
    CAD: 1.47,
    AUD: 1.59,
    DOP: 68.83
  },
  GBP: {
    USD: 1.37,
    EUR: 1.16,
    CAD: 1.71,
    AUD: 1.85,
    DOP: 80.15
  },
  CAD: {
    USD: 0.80,
    EUR: 0.68,
    GBP: 0.58,
    AUD: 1.08,
    DOP: 46.80
  },
  AUD: {
    USD: 0.74,
    EUR: 0.63,
    GBP: 0.54,
    CAD: 0.93,
    DOP: 43.33
  },
  DOP: {
    USD: 0.017,
    EUR: 0.015,
    GBP: 0.012,
    CAD: 0.021,
    AUD: 0.023
  }
};

// Get supported currencies
router.get('/supported', (req, res) => {
  try {
    const currencies = SUPPORTED_CURRENCIES.map(code => ({
      code,
      name: getCurrencyName(code),
      symbol: getCurrencySymbol(code)
    }));

    res.json({
      success: true,
      data: {
        currencies,
        default: 'USD'
      }
    });
  } catch (error) {
    console.error('Get supported currencies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supported currencies'
    });
  }
});

// Get exchange rates
router.get('/rates', [
  query('base').optional().isIn(SUPPORTED_CURRENCIES),
  query('target').optional().isIn(SUPPORTED_CURRENCIES)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { base = 'USD', target } = req.query;

    if (target) {
      const rate = await getExchangeRate(base, target);
      return res.json({
        success: true,
        data: {
          base,
          target,
          rate,
          timestamp: new Date().toISOString()
        }
      });
    }

    const rates = {};
    for (const currency of SUPPORTED_CURRENCIES) {
      if (currency !== base) {
        rates[currency] = await getExchangeRate(base, currency);
      }
    }

    res.json({
      success: true,
      data: {
        base,
        rates,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get exchange rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rates'
    });
  }
});

// Convert amount between currencies
router.get('/convert', [
  query('amount').isFloat({ min: 0 }),
  query('from').isIn(SUPPORTED_CURRENCIES),
  query('to').isIn(SUPPORTED_CURRENCIES)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { amount, from, to } = req.query;
    const inputAmount = parseFloat(amount);

    if (from === to) {
      return res.json({
        success: true,
        data: {
          amount: inputAmount,
          from,
          to,
          converted_amount: inputAmount,
          rate: 1,
          timestamp: new Date().toISOString()
        }
      });
    }

    const rate = await getExchangeRate(from, to);
    const convertedAmount = Math.round(inputAmount * rate * 100) / 100;

    res.json({
      success: true,
      data: {
        amount: inputAmount,
        from,
        to,
        converted_amount: convertedAmount,
        rate,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Currency conversion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert currency'
    });
  }
});

// Helper functions
async function getExchangeRate(from, to) {
  try {
    if (from === to) return 1;

    if (MOCK_EXCHANGE_RATES[from] && MOCK_EXCHANGE_RATES[from][to]) {
      return MOCK_EXCHANGE_RATES[from][to];
    }

    if (from !== 'USD' && to !== 'USD') {
      const fromToUSD = MOCK_EXCHANGE_RATES[from] ? MOCK_EXCHANGE_RATES[from]['USD'] : 1;
      const USDToTarget = MOCK_EXCHANGE_RATES['USD'] ? MOCK_EXCHANGE_RATES['USD'][to] : 1;
      return fromToUSD * USDToTarget;
    }

    return 1;
  } catch (error) {
    console.error('Get exchange rate error:', error);
    return 1;
  }
}

function getCurrencyName(code) {
  const names = {
    USD: 'US Dollar',
    EUR: 'Euro',
    GBP: 'British Pound',
    CAD: 'Canadian Dollar',
    AUD: 'Australian Dollar',
    DOP: 'Dominican Peso'
  };
  return names[code] || code;
}

function getCurrencySymbol(code) {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'C$',
    AUD: 'A$',
    DOP: 'RD$'
  };
  return symbols[code] || code;
}

function scheduleRateUpdates() {
  console.log('Currency rate updates scheduled');
}

module.exports = {
  router,
  scheduleRateUpdates,
  getExchangeRate,
  getCurrencySymbol,
  getCurrencyName,
  SUPPORTED_CURRENCIES
};