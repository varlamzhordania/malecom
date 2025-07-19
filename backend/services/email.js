// backend/services/email.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

class EmailService {
  constructor() {
    this.transporter = null;
    this.templates = new Map();
    this.init();
  }

  async init() {
    try {
      // Configure transporter based on environment
      if (process.env.NODE_ENV === 'production') {
        // Production: Use external SMTP service (SendGrid, Mailgun, etc.)
        this.transporter = nodemailer.createTransporter({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          rateLimit: 14 // 14 emails per second max
        });
      } else {
        // Development: Use Ethereal Email for testing
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransporter({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        });
      }

      // Verify connection
      await this.transporter.verify();
      console.log('Email service initialized successfully');

      // Load email templates
      await this.loadTemplates();

    } catch (error) {
      console.error('Email service initialization failed:', error);
      throw error;
    }
  }

  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates/email');
      
      // Define all email templates
      const templateFiles = [
        'verification.html',
        'password-reset.html',
        'booking-confirmation.html',
        'booking-cancellation.html',
        'new-booking-owner.html',
        'booking-cancellation-owner.html',
        'payment-receipt.html',
        'review-request.html',
        'welcome.html',
        'owner-verification.html'
      ];

      for (const templateFile of templateFiles) {
        try {
          const templatePath = path.join(templatesDir, templateFile);
          const templateContent = await fs.readFile(templatePath, 'utf-8');
          const templateName = path.basename(templateFile, '.html');
          this.templates.set(templateName, templateContent);
        } catch (error) {
          console.warn(`Template ${templateFile} not found, using default`);
          this.templates.set(path.basename(templateFile, '.html'), this.getDefaultTemplate());
        }
      }

      console.log(`Loaded ${this.templates.size} email templates`);

    } catch (error) {
      console.error('Failed to load email templates:', error);
    }
  }

  getDefaultTemplate() {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{subject}}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Malecom Suits</h1>
    </div>
    <div class="content">
        {{content}}
    </div>
    <div class="footer">
        <p>© 2025 Malecom Suits. All rights reserved.</p>
        <p>If you have any questions, contact us at info@malecomsuits.com</p>
    </div>
</body>
</html>`;
  }

  processTemplate(template, data) {
    let processed = template;
    
    // Replace all {{variable}} placeholders
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processed = processed.replace(regex, value || '');
    }

    // Remove any remaining placeholders
    processed = processed.replace(/{{.*?}}/g, '');

    return processed;
  }

  async sendEmail({ to, subject, template, data = {}, attachments = [] }) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      let htmlContent;
      let textContent;

      if (template) {
        // Use template
        const templateContent = this.templates.get(template) || this.getDefaultTemplate();
        htmlContent = this.processTemplate(templateContent, { ...data, subject });
        
        // Generate text version from HTML
        textContent = this.htmlToText(htmlContent);
      } else {
        // Use provided content
        htmlContent = data.html || '';
        textContent = data.text || '';
      }

      const mailOptions = {
        from: {
          name: process.env.FROM_NAME || 'Malecom Suits',
          address: process.env.FROM_EMAIL || 'noreply@malecomsuits.com'
        },
        to,
        subject,
        text: textContent,
        html: htmlContent,
        attachments
      };

      const result = await this.transporter.sendMail(mailOptions);

      // Log preview URL in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(result));
      }

      return {
        success: true,
        messageId: result.messageId,
        previewUrl: process.env.NODE_ENV !== 'production' ? nodemailer.getTestMessageUrl(result) : null
      };

    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }

  htmlToText(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Predefined email methods
  async sendVerificationEmail(to, firstName, verificationLink) {
    return this.sendEmail({
      to,
      subject: 'Verify Your Malecom Suits Account',
      template: 'verification',
      data: {
        firstName,
        verificationLink
      }
    });
  }

  async sendPasswordResetEmail(to, firstName, resetLink) {
    return this.sendEmail({
      to,
      subject: 'Reset Your Malecom Suits Password',
      template: 'password-reset',
      data: {
        firstName,
        resetLink
      }
    });
  }

  async sendBookingConfirmation(to, bookingData) {
    return this.sendEmail({
      to,
      subject: `Booking Confirmation - ${bookingData.bookingReference}`,
      template: 'booking-confirmation',
      data: bookingData
    });
  }

  async sendBookingCancellation(to, bookingData) {
    return this.sendEmail({
      to,
      subject: `Booking Cancelled - ${bookingData.bookingReference}`,
      template: 'booking-cancellation',
      data: bookingData
    });
  }

  async sendNewBookingToOwner(to, bookingData) {
    return this.sendEmail({
      to,
      subject: `New Booking Received - ${bookingData.suiteName}`,
      template: 'new-booking-owner',
      data: bookingData
    });
  }

  async sendPaymentReceipt(to, paymentData) {
    return this.sendEmail({
      to,
      subject: `Payment Receipt - ${paymentData.bookingReference}`,
      template: 'payment-receipt',
      data: paymentData
    });
  }

  async sendReviewRequest(to, bookingData) {
    return this.sendEmail({
      to,
      subject: `How was your stay? Leave a review`,
      template: 'review-request',
      data: bookingData
    });
  }

  async sendWelcomeEmail(to, userData) {
    return this.sendEmail({
      to,
      subject: 'Welcome to Malecom Suits!',
      template: 'welcome',
      data: userData
    });
  }

  async sendOwnerVerificationEmail(to, ownerData) {
    return this.sendEmail({
      to,
      subject: 'Property Owner Verification Status',
      template: 'owner-verification',
      data: ownerData
    });
  }

  // Bulk email sending
  async sendBulkEmails(emails) {
    const results = [];
    
    for (const emailData of emails) {
      try {
        const result = await this.sendEmail(emailData);
        results.push({ ...emailData, success: true, result });
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        results.push({ ...emailData, success: false, error: error.message });
      }
    }

    return results;
  }

  // Newsletter subscription
  async sendNewsletterConfirmation(to, subscriptionData) {
    return this.sendEmail({
      to,
      subject: 'Newsletter Subscription Confirmed',
      template: 'newsletter-confirmation',
      data: subscriptionData
    });
  }

  // Test email connectivity
  async testConnection() {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Email service is working' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get email statistics (if supported by provider)
  async getEmailStats() {
    // This would integrate with your email provider's API
    // For now, return basic stats
    return {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complaints: 0
    };
  }
}

// Create singleton instance
const emailService = new EmailService();

// Export convenience functions
module.exports = {
  emailService,
  sendEmail: (data) => emailService.sendEmail(data),
  sendVerificationEmail: (to, firstName, link) => emailService.sendVerificationEmail(to, firstName, link),
  sendPasswordResetEmail: (to, firstName, link) => emailService.sendPasswordResetEmail(to, firstName, link),
  sendBookingConfirmation: (to, data) => emailService.sendBookingConfirmation(to, data),
  sendBookingCancellation: (to, data) => emailService.sendBookingCancellation(to, data),
  sendNewBookingToOwner: (to, data) => emailService.sendNewBookingToOwner(to, data),
  sendPaymentReceipt: (to, data) => emailService.sendPaymentReceipt(to, data),
  sendReviewRequest: (to, data) => emailService.sendReviewRequest(to, data),
  sendWelcomeEmail: (to, data) => emailService.sendWelcomeEmail(to, data),
  sendOwnerVerificationEmail: (to, data) => emailService.sendOwnerVerificationEmail(to, data),
  testEmailConnection: () => emailService.testConnection(),
  getEmailStats: () => emailService.getEmailStats()
};