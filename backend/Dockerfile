# backend/Dockerfile

# Use official Node.js runtime as base image
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    mysql-client \
    tzdata

# Set timezone
ENV TZ=America/New_York

# Copy package files
COPY package*.json ./

# Development stage
FROM base AS development

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads temp

# Set proper permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Start development server
CMD ["npm", "run", "dev"]

# Production dependencies stage
FROM base AS prod-deps

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM base AS production

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads temp

# Remove development files
RUN rm -rf tests/ *.test.js .env.example

# Set proper permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Start production server
CMD ["npm", "start"]