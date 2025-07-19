// backend/services/payment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/database');

class PaymentService {
  constructor() {
    this.stripe = stripe;
    this.supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'DOP'];
  }

  // Create payment intent for booking
  async createPaymentIntent({ amount, currency, bookingReference, customerEmail, description }) {
    try {
      // Convert amount to cents for Stripe
      const amountInCents = Math.round(amount * 100);

      // Create or get customer
      let customer;
      try {
        const customers = await this.stripe.customers.list({
          email: customerEmail,
          limit: 1
        });
        
        if (customers.data.length > 0) {
          customer = customers.data[0];
        } else {
          customer = await this.stripe.customers.create({
            email: customerEmail,
            metadata: {
              source: 'malecom_suits'
            }
          });
        }
      } catch (error) {
        console.error('Customer creation/retrieval error:', error);
        // Continue without customer if creation fails
      }

      // Create payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency.toLowerCase(),
        customer: customer?.id,
        description: description || `Payment for booking ${bookingReference}`,
        metadata: {
          booking_reference: bookingReference,
          platform: 'malecom_suits'
        },
        automatic_payment_methods: {
          enabled: true
        },
        capture_method: 'automatic',
        setup_future_usage: 'off_session' // For future payments
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: amountInCents,
        currency: currency.toUpperCase()
      };

    } catch (error) {
      console.error('Payment intent creation error:', error);
      throw new Error(`Payment setup failed: ${error.message}`);
    }
  }

  // Process payment
  async processPayment({ amount, currency, paymentMethod, paymentToken, bookingReference, customerEmail, description }) {
    try {
      let result;

      switch (paymentMethod) {
        case 'stripe':
          result = await this.processStripePayment({
            amount,
            currency,
            paymentToken,
            bookingReference,
            customerEmail,
            description
          });
          break;
        case 'paypal':
          result = await this.processPayPalPayment({
            amount,
            currency,
            paymentToken,
            bookingReference,
            customerEmail,
            description
          });
          break;
        case 'bank_transfer':
          result = await this.processBankTransfer({
            amount,
            currency,
            bookingReference,
            customerEmail
          });
          break;
        default:
          throw new Error('Unsupported payment method');
      }

      return result;

    } catch (error) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  // Process Stripe payment
  async processStripePayment({ amount, currency, paymentToken, bookingReference, customerEmail, description }) {
    try {
      const amountInCents = Math.round(amount * 100);

      // If paymentToken is a payment method ID
      if (paymentToken.startsWith('pm_')) {
        const paymentIntent = await this.stripe.paymentIntents.create({
          amount: amountInCents,
          currency: currency.toLowerCase(),
          payment_method: paymentToken,
          description: description || `Payment for booking ${bookingReference}`,
          metadata: {
            booking_reference: bookingReference,
            platform: 'malecom_suits'
          },
          confirm: true,
          return_url: `${process.env.FRONTEND_URL}/booking/success`
        });

        return {
          success: true,
          status: paymentIntent.status === 'succeeded' ? 'completed' : 'pending',
          transactionId: paymentIntent.id,
          amount: amount,
          currency: currency.toUpperCase(),
          paymentMethod: 'stripe'
        };
      }

      // If paymentToken is a payment intent client secret
      if (paymentToken.startsWith('pi_')) {
        const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentToken);
        
        return {
          success: true,
          status: paymentIntent.status === 'succeeded' ? 'completed' : 'pending',
          transactionId: paymentIntent.id,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          paymentMethod: 'stripe'
        };
      }

      throw new Error('Invalid payment token format');

    } catch (error) {
      console.error('Stripe payment error:', error);
      throw new Error(`Stripe payment failed: ${error.message}`);
    }
  }

  // Process PayPal payment (placeholder - implement with PayPal SDK)
  async processPayPalPayment({ amount, currency, paymentToken, bookingReference, customerEmail, description }) {
    try {
      // This is a placeholder implementation
      // In production, integrate with PayPal REST API or SDK
      
      console.log('Processing PayPal payment:', {
        amount,
        currency,
        paymentToken,
        bookingReference
      });

      // Simulate PayPal processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        status: 'completed',
        transactionId: `paypal_${Date.now()}`,
        amount: amount,
        currency: currency.toUpperCase(),
        paymentMethod: 'paypal'
      };

    } catch (error) {
      console.error('PayPal payment error:', error);
      throw new Error(`PayPal payment failed: ${error.message}`);
    }
  }

  // Process bank transfer (manual verification required)
  async processBankTransfer({ amount, currency, bookingReference, customerEmail }) {
    try {
      // Bank transfer requires manual verification
      // Generate reference number and banking details
      
      const transferReference = `BT${Date.now().toString().slice(-8)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      return {
        success: true,
        status: 'pending', // Requires manual verification
        transactionId: transferReference,
        amount: amount,
        currency: currency.toUpperCase(),
        paymentMethod: 'bank_transfer',
        instructions: {
          accountNumber: process.env.BANK_ACCOUNT_NUMBER,
          routingNumber: process.env.BANK_ROUTING_NUMBER,
          accountName: process.env.BANK_ACCOUNT_NAME,
          bankName: process.env.BANK_NAME,
          reference: transferReference,
          notes: `Please include reference ${transferReference} in your transfer description`
        }
      };

    } catch (error) {
      console.error('Bank transfer processing error:', error);
      throw new Error(`Bank transfer setup failed: ${error.message}`);
    }
  }

  // Refund payment
  async refundPayment({ bookingId, amount, reason }) {
    try {
      // Get original payment details
      const [payments] = await pool.execute(`
        SELECT * FROM booking_payments 
        WHERE booking_id = ? AND transaction_status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      `, [bookingId]);

      if (payments.length === 0) {
        throw new Error('No completed payment found for this booking');
      }

      const payment = payments[0];
      let refundResult;

      switch (payment.payment_method) {
        case 'stripe':
          refundResult = await this.processStripeRefund({
            paymentIntentId: payment.payment_gateway_id,
            amount: amount || payment.amount,
            reason
          });
          break;
        case 'paypal':
          refundResult = await this.processPayPalRefund({
            transactionId: payment.payment_gateway_id,
            amount: amount || payment.amount,
            reason
          });
          break;
        case 'bank_transfer':
          refundResult = await this.processBankTransferRefund({
            amount: amount || payment.amount,
            bookingId,
            reason
          });
          break;
        default:
          throw new Error('Refund not supported for this payment method');
      }

      return refundResult;

    } catch (error) {
      console.error('Refund processing error:', error);
      throw error;
    }
  }

  // Process Stripe refund
  async processStripeRefund({ paymentIntentId, amount, reason }) {
    try {
      const amountInCents = amount ? Math.round(amount * 100) : undefined;

      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amountInCents, // If undefined, refunds full amount
        reason: reason === 'requested_by_customer' ? 'requested_by_customer' : 'duplicate',
        metadata: {
          reason: reason || 'Booking cancellation',
          platform: 'malecom_suits'
        }
      });

      return {
        success: true,
        status: refund.status === 'succeeded' ? 'completed' : 'pending',
        refundId: refund.id,
        amount: refund.amount / 100,
        currency: refund.currency.toUpperCase()
      };

    } catch (error) {
      console.error('Stripe refund error:', error);
      throw new Error(`Stripe refund failed: ${error.message}`);
    }
  }

  // Process PayPal refund (placeholder)
  async processPayPalRefund({ transactionId, amount, reason }) {
    try {
      // Placeholder for PayPal refund implementation
      console.log('Processing PayPal refund:', { transactionId, amount, reason });

      // Simulate PayPal refund processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        status: 'completed',
        refundId: `paypal_refund_${Date.now()}`,
        amount: amount,
        currency: 'USD'
      };

    } catch (error) {
      console.error('PayPal refund error:', error);
      throw new Error(`PayPal refund failed: ${error.message}`);
    }
  }

  // Process bank transfer refund (manual process)
  async processBankTransferRefund({ amount, bookingId, reason }) {
    try {
      // Bank transfer refunds require manual processing
      // Create a refund request in the system
      
      const refundReference = `BTR${Date.now().toString().slice(-8)}`;

      return {
        success: true,
        status: 'pending', // Requires manual processing
        refundId: refundReference,
        amount: amount,
        currency: 'USD',
        instructions: 'Refund will be processed manually within 3-5 business days'
      };

    } catch (error) {
      console.error('Bank transfer refund error:', error);
      throw new Error(`Bank transfer refund setup failed: ${error.message}`);
    }
  }

  // Calculate platform fees
  calculatePlatformFee(amount, currency = 'USD') {
    // Platform commission rate (configurable)
    const commissionRate = parseFloat(process.env.COMMISSION_RATE || '10') / 100;
    
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
    const platformFee = amount * commissionRate;
    const processingFee = (amount * fees.percentage) + fees.fixed;
    const netAmount = amount - platformFee - processingFee;

    return {
      grossAmount: amount,
      platformFee: Math.round(platformFee * 100) / 100,
      processingFee: Math.round(processingFee * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
      currency
    };
  }

  // Create payout to property owner
  async createPayout({ ownerId, amount, currency, bookingReference }) {
    try {
      // Get owner's payout details
      const [owners] = await pool.execute(`
        SELECT po.payout_method, po.payout_details, u.email
        FROM property_owners po
        JOIN users u ON po.user_id = u.id
        WHERE po.user_id = ?
      `, [ownerId]);

      if (owners.length === 0) {
        throw new Error('Property owner not found');
      }

      const owner = owners[0];
      const payoutDetails = JSON.parse(owner.payout_details || '{}');

      let payoutResult;

      switch (owner.payout_method) {
        case 'stripe':
          payoutResult = await this.createStripePayout({
            accountId: payoutDetails.accountId,
            amount,
            currency,
            bookingReference
          });
          break;
        case 'paypal':
          payoutResult = await this.createPayPalPayout({
            email: payoutDetails.email || owner.email,
            amount,
            currency,
            bookingReference
          });
          break;
        case 'bank_transfer':
          payoutResult = await this.createBankPayout({
            accountDetails: payoutDetails,
            amount,
            currency,
            bookingReference
          });
          break;
        default:
          throw new Error('Invalid payout method');
      }

      return payoutResult;

    } catch (error) {
      console.error('Payout creation error:', error);
      throw error;
    }
  }

  // Create Stripe payout
  async createStripePayout({ accountId, amount, currency, bookingReference }) {
    try {
      const amountInCents = Math.round(amount * 100);

      const payout = await this.stripe.transfers.create({
        amount: amountInCents,
        currency: currency.toLowerCase(),
        destination: accountId,
        description: `Payout for booking ${bookingReference}`,
        metadata: {
          booking_reference: bookingReference,
          platform: 'malecom_suits'
        }
      });

      return {
        success: true,
        payoutId: payout.id,
        status: 'completed',
        amount: amount,
        currency: currency.toUpperCase()
      };

    } catch (error) {
      console.error('Stripe payout error:', error);
      throw new Error(`Stripe payout failed: ${error.message}`);
    }
  }

  // Create PayPal payout (placeholder)
  async createPayPalPayout({ email, amount, currency, bookingReference }) {
    try {
      // Placeholder for PayPal payout implementation
      console.log('Creating PayPal payout:', { email, amount, currency, bookingReference });

      return {
        success: true,
        payoutId: `paypal_payout_${Date.now()}`,
        status: 'pending',
        amount: amount,
        currency: currency.toUpperCase()
      };

    } catch (error) {
      console.error('PayPal payout error:', error);
      throw new Error(`PayPal payout failed: ${error.message}`);
    }
  }

  // Create bank payout (manual process)
  async createBankPayout({ accountDetails, amount, currency, bookingReference }) {
    try {
      // Bank payouts require manual processing
      const payoutReference = `BP${Date.now().toString().slice(-8)}`;

      return {
        success: true,
        payoutId: payoutReference,
        status: 'pending',
        amount: amount,
        currency: currency.toUpperCase(),
        instructions: 'Payout will be processed manually within 2-3 business days'
      };

    } catch (error) {
      console.error('Bank payout error:', error);
      throw new Error(`Bank payout setup failed: ${error.message}`);
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature, secret) {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      throw new Error('Invalid webhook signature');
    }
  }

  // Handle webhook events
  async handleWebhookEvent(event) {
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(event.data.object);
          break;
        case 'charge.dispute.created':
          await this.handleDispute(event.data.object);
          break;
        case 'payout.paid':
          await this.handlePayoutCompleted(event.data.object);
          break;
        case 'payout.failed':
          await this.handlePayoutFailed(event.data.object);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return { success: true };

    } catch (error) {
      console.error('Webhook event handling error:', error);
      throw error;
    }
  }

  // Handle successful payment
  async handlePaymentSuccess(paymentIntent) {
    try {
      const bookingReference = paymentIntent.metadata.booking_reference;
      
      // Update booking status
      await pool.execute(`
        UPDATE bookings 
        SET booking_status = 'confirmed', payment_status = 'paid'
        WHERE booking_reference = ?
      `, [bookingReference]);

      // Update payment record
      await pool.execute(`
        UPDATE booking_payments 
        SET transaction_status = 'completed'
        WHERE payment_gateway_id = ?
      `, [paymentIntent.id]);

      console.log(`Payment succeeded for booking ${bookingReference}`);

    } catch (error) {
      console.error('Error handling payment success:', error);
    }
  }

  // Handle payment failure
  async handlePaymentFailure(paymentIntent) {
    try {
      const bookingReference = paymentIntent.metadata.booking_reference;
      
      // Update booking status
      await pool.execute(`
        UPDATE bookings 
        SET payment_status = 'failed'
        WHERE booking_reference = ?
      `, [bookingReference]);

      // Update payment record
      await pool.execute(`
        UPDATE booking_payments 
        SET transaction_status = 'failed', error_message = ?
        WHERE payment_gateway_id = ?
      `, [paymentIntent.last_payment_error?.message || 'Payment failed', paymentIntent.id]);

      console.log(`Payment failed for booking ${bookingReference}`);

    } catch (error) {
      console.error('Error handling payment failure:', error);
    }
  }

  // Handle dispute/chargeback
  async handleDispute(charge) {
    try {
      // Log the dispute
      console.log('Dispute created for charge:', charge.id);
      
      // Update payment status
      await pool.execute(`
        UPDATE booking_payments 
        SET transaction_status = 'disputed'
        WHERE payment_gateway_id = ?
      `, [charge.payment_intent]);

      // Notify admin
      // Implementation depends on your notification system

    } catch (error) {
      console.error('Error handling dispute:', error);
    }
  }

  // Handle completed payout
  async handlePayoutCompleted(payout) {
    try {
      console.log('Payout completed:', payout.id);
      
      // Update payout status in database
      // Implementation depends on your payout tracking system

    } catch (error) {
      console.error('Error handling payout completion:', error);
    }
  }

  // Handle failed payout
  async handlePayoutFailed(payout) {
    try {
      console.log('Payout failed:', payout.id);
      
      // Update payout status and notify owner
      // Implementation depends on your payout tracking system

    } catch (error) {
      console.error('Error handling payout failure:', error);
    }
  }

  // Get payment statistics
  async getPaymentStats(startDate, endDate) {
    try {
      const [stats] = await pool.execute(`
        SELECT 
          COUNT(*) as total_payments,
          SUM(CASE WHEN transaction_status = 'completed' THEN amount ELSE 0 END) as total_revenue,
          SUM(CASE WHEN transaction_status = 'completed' THEN 1 ELSE 0 END) as successful_payments,
          SUM(CASE WHEN transaction_status = 'failed' THEN 1 ELSE 0 END) as failed_payments,
          SUM(CASE WHEN transaction_status = 'refunded' THEN amount ELSE 0 END) as total_refunds,
          AVG(CASE WHEN transaction_status = 'completed' THEN amount ELSE NULL END) as average_payment
        FROM booking_payments
        WHERE created_at BETWEEN ? AND ?
      `, [startDate, endDate]);

      return stats[0] || {};

    } catch (error) {
      console.error('Error getting payment stats:', error);
      throw error;
    }
  }
}

// Create singleton instance
const paymentService = new PaymentService();

module.exports = {
  paymentService,
  createPaymentIntent: (data) => paymentService.createPaymentIntent(data),
  processPayment: (data) => paymentService.processPayment(data),
  refundPayment: (data) => paymentService.refundPayment(data),
  calculatePlatformFee: (amount, currency) => paymentService.calculatePlatformFee(amount, currency),
  createPayout: (data) => paymentService.createPayout(data),
  verifyWebhookSignature: (payload, signature, secret) => paymentService.verifyWebhookSignature(payload, signature, secret),
  handleWebhookEvent: (event) => paymentService.handleWebhookEvent(event),
  getPaymentStats: (startDate, endDate) => paymentService.getPaymentStats(startDate, endDate)
};