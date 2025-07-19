#!/bin/bash
# Production deployment script

echo "🚀 Deploying Malecom Suits to Production..."

# Ensure we're using production environment
export NODE_ENV=production

# Build production images
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start production services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo "✅ Production deployment completed!"
echo "🌐 Application available at: http://localhost"
echo "📊 Health check: curl http://localhost/health"