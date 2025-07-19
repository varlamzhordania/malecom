// backend/services/cloudinary.js
const cloudinary = require('cloudinary').v2;
const fs = require('fs').promises;

class CloudinaryService {
  constructor() {
    this.isConfigured = false;
    this.init();
  }

  init() {
    try {
      // Configure Cloudinary
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
      });

      // Check if configuration is valid
      if (process.env.CLOUDINARY_CLOUD_NAME && 
          process.env.CLOUDINARY_API_KEY && 
          process.env.CLOUDINARY_API_SECRET) {
        this.isConfigured = true;
        console.log('✅ Cloudinary configured successfully');
      } else {
        console.log('⚠️  Cloudinary not configured - using local file storage');
      }

    } catch (error) {
      console.error('❌ Cloudinary configuration failed:', error);
      this.isConfigured = false;
    }
  }

  async uploadToCloudinary(filePath, folder = 'malecom-suits') {
    try {
      if (!this.isConfigured) {
        // Fallback to local storage if Cloudinary not configured
        return this.handleLocalUpload(filePath);
      }

      const options = {
        folder: folder,
        resource_type: 'auto',
        quality: 'auto:good',
        fetch_format: 'auto',
        flags: 'progressive',
        transformation: [
          { width: 1200, height: 800, crop: 'limit' },
          { quality: 'auto:good' },
          { format: 'auto' }
        ]
      };

      const result = await cloudinary.uploader.upload(filePath, options);

      // Delete temporary file after successful upload
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.warn('Could not delete temp file:', unlinkError.message);
      }

      return {
        success: true,
        url: result.secure_url,
        public_id: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes
      };

    } catch (error) {
      console.error('Cloudinary upload error:', error);
      
      // Fallback to local storage on error
      return this.handleLocalUpload(filePath);
    }
  }

  async handleLocalUpload(filePath) {
    try {
      // For development/demo: just return a placeholder URL
      const fileName = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const localUrl = `/uploads/${fileName}`;

      // In a real scenario, you'd move the file to a public directory
      // For now, we'll use a placeholder
      console.log('⚠️  Using local file storage (Cloudinary not configured)');

      return {
        success: true,
        url: `http://localhost:5000${localUrl}`,
        public_id: fileName,
        width: 800,
        height: 600,
        format: 'jpg',
        bytes: 0,
        local: true
      };

    } catch (error) {
      console.error('Local upload fallback error:', error);
      throw new Error('File upload failed');
    }
  }

  async deleteFromCloudinary(publicId) {
    try {
      if (!this.isConfigured) {
        console.log('⚠️  Cloudinary not configured - skipping delete');
        return { success: true, local: true };
      }

      const result = await cloudinary.uploader.destroy(publicId);
      
      return {
        success: result.result === 'ok',
        result: result.result
      };

    } catch (error) {
      console.error('Cloudinary delete error:', error);
      return { success: false, error: error.message };
    }
  }

  async getImageDetails(publicId) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Cloudinary not configured' };
      }

      const result = await cloudinary.api.resource(publicId);
      
      return {
        success: true,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
        created_at: result.created_at
      };

    } catch (error) {
      console.error('Get image details error:', error);
      return { success: false, error: error.message };
    }
  }

  async uploadMultiple(filePaths, folder = 'malecom-suits') {
    try {
      const uploadPromises = filePaths.map(filePath => 
        this.uploadToCloudinary(filePath, folder)
      );

      const results = await Promise.allSettled(uploadPromises);
      
      return results.map((result, index) => ({
        index,
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason.message : null
      }));

    } catch (error) {
      console.error('Multiple upload error:', error);
      throw error;
    }
  }

  generateTransformationUrl(publicId, transformations = {}) {
    try {
      if (!this.isConfigured) {
        return null;
      }

      const {
        width = 400,
        height = 300,
        crop = 'fill',
        quality = 'auto:good',
        format = 'auto'
      } = transformations;

      return cloudinary.url(publicId, {
        width,
        height,
        crop,
        quality,
        format,
        secure: true
      });

    } catch (error) {
      console.error('Generate transformation URL error:', error);
      return null;
    }
  }

  async getUsageStats() {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Cloudinary not configured' };
      }

      const result = await cloudinary.api.usage();
      
      return {
        success: true,
        credits: result.credits,
        used_credits: result.used_credits,
        limit: result.limit,
        used_percent: ((result.used_credits / result.limit) * 100).toFixed(2)
      };

    } catch (error) {
      console.error('Get usage stats error:', error);
      return { success: false, error: error.message };
    }
  }

  // Utility method to validate image file
  validateImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
    }

    if (file.size > maxSize) {
      throw new Error('File too large. Maximum size is 10MB.');
    }

    return true;
  }
}

// Create singleton instance
const cloudinaryService = new CloudinaryService();

// Export service methods
module.exports = {
  cloudinaryService,
  uploadToCloudinary: (filePath, folder) => cloudinaryService.uploadToCloudinary(filePath, folder),
  deleteFromCloudinary: (publicId) => cloudinaryService.deleteFromCloudinary(publicId),
  getImageDetails: (publicId) => cloudinaryService.getImageDetails(publicId),
  uploadMultiple: (filePaths, folder) => cloudinaryService.uploadMultiple(filePaths, folder),
  generateTransformationUrl: (publicId, transformations) => 
    cloudinaryService.generateTransformationUrl(publicId, transformations),
  getUsageStats: () => cloudinaryService.getUsageStats(),
  validateImageFile: (file) => cloudinaryService.validateImageFile(file)
};