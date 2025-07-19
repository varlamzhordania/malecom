const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.init().catch(err => console.error('Email service init failed:', err.message));
  }

  async init() {
    try {
      if (process.env.NODE_ENV === 'production' && process.env.SMTP_HOST) {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
      } else {
        // Development mode - use ethereal email
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        });
      }

      console.log('✅ Email service initialized');
    } catch (error) {
      console.log('⚠️  Email service not configured:', error.message);
      this.transporter = null;
    }
  }

  async sendEmail(options) {
    try {
      if (!this.transporter) {
        console.log('📧 Email would be sent (no transporter):', options.subject);
        return { success: true, messageId: 'mock_' + Date.now() };
      }

      const mailOptions = {
        from: `${process.env.FROM_NAME || 'Malecom Suits'} <${process.env.FROM_EMAIL || 'noreply@malecomsuits.com'}>`,
        to: options.to,
        subject: options.subject,
        text: options.text || options.data?.message || 'Email from Malecom Suits',
        html: options.html || `<p>${options.data?.message || options.text || 'Email from Malecom Suits'}</p>`
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('📧 Email sent:', options.subject);
      
      return {
        success: true,
        messageId: result.messageId,
        previewUrl: nodemailer.getTestMessageUrl(result)
      };
    } catch (error) {
      console.error('Email sending failed:', error);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    try {
      if (!this.transporter) {
        return { success: false, error: 'No transporter configured' };
      }
      await this.transporter.verify();
      return { success: true, message: 'Email service is working' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

const emailService = new EmailService();

module.exports = {
  emailService,
  sendEmail: (data) => emailService.sendEmail(data)
};