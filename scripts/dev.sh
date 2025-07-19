#!/bin/bash
# Development script

echo "🔧 Starting Malecom Suits in Development Mode..."

# Load environment variables
source .env

# Start development services
docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d

echo "✅ Development environment started!"
echo "📝 Backend logs: docker-compose logs -f backend"
echo "🎨 Frontend logs: docker-compose logs -f frontend" 
echo "💾 Database logs: docker-compose logs -f database"