#!/bin/bash
# setup.sh - Initial setup script for Malecom Suits

set -e  # Exit on any error

echo "🚀 Setting up Malecom Suits Docker Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker Desktop first."
        echo "Download from: https://www.docker.com/products/docker-desktop"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed."
        exit 1
    fi

    print_success "Docker and Docker Compose are installed"
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p uploads
    mkdir -p nginx/ssl
    mkdir -p database/backups
    
    print_success "Directories created"
}

# Copy environment file
setup_environment() {
    if [ ! -f .env ]; then
        print_status "Creating environment file..."
        cp .env.docker .env
        print_warning "Please edit .env file with your actual configuration values"
        print_warning "Especially update these critical settings:"
        echo "  - JWT_SECRET (use a long random string)"
        echo "  - Email settings (SMTP_*)"
        echo "  - Payment keys (STRIPE_*, PAYPAL_*)"
        echo "  - Cloudinary settings"
        echo "  - Database passwords"
    else
        print_success "Environment file already exists"
    fi
}

# Generate secure secrets
generate_secrets() {
    print_status "Generating secure secrets..."
    
    # Generate JWT secret if not set
    if grep -q "your-super-secret-jwt-key-change-in-production-please" .env; then
        JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
        sed -i.bak "s/your-super-secret-jwt-key-change-in-production-please/$JWT_SECRET/" .env
        print_success "Generated secure JWT secret"
    fi
    
    # Generate database password if using default
    if grep -q "malecom_password123" .env; then
        DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-16)
        sed -i.bak "s/malecom_password123/$DB_PASSWORD/g" .env
        print_success "Generated secure database password"
    fi
    
    # Generate Redis password if using default
    if grep -q "redispassword123" .env; then
        REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-16)
        sed -i.bak "s/redispassword123/$REDIS_PASSWORD/g" .env
        print_success "Generated secure Redis password"
    fi
}

# Build and start services
start_services() {
    print_status "Building and starting services..."
    
    # Build images
    docker-compose build
    
    # Start services
    docker-compose up -d
    
    print_success "Services started successfully"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for database
    print_status "Waiting for database..."
    until docker-compose exec -T database mysqladmin ping -h localhost --silent; do
        sleep 2
    done
    print_success "Database is ready"
    
    # Wait for backend
    print_status "Waiting for backend API..."
    until curl -f http://localhost:5000/health > /dev/null 2>&1; do
        sleep 2
    done
    print_success "Backend API is ready"
}

# Display final information
show_info() {
    print_success "🎉 Setup completed successfully!"
    echo ""
    echo "🔗 Access your application:"
    echo "   Frontend:  http://localhost:3000"
    echo "   Backend:   http://localhost:5000"
    echo "   API Docs:  http://localhost:5000/api/v1"
    echo "   Database:  http://localhost:8080 (Adminer)"
    echo ""
    echo "📧 Default admin login:"
    echo "   Email:     admin@malecomsuits.com"
    echo "   Password:  password123"
    echo ""
    echo "🛠️  Useful commands:"
    echo "   View logs:    docker-compose logs -f"
    echo "   Stop:         docker-compose down"
    echo "   Restart:      docker-compose restart"
    echo "   Rebuild:      docker-compose up -d --build"
    echo ""
    print_warning "Remember to:"
    echo "   1. Update your .env file with real API keys"
    echo "   2. Change the default admin password"
    echo "   3. Configure email settings for notifications"
}

# Main execution
main() {
    echo "=================================================="
    echo "    Malecom Suits - Docker Setup Script"
    echo "=================================================="
    echo ""

    check_docker
    create_directories
    setup_environment
    
    if command -v openssl &> /dev/null; then
        generate_secrets
    else
        print_warning "OpenSSL not found. Please manually update secrets in .env file"
    fi
    
    start_services
    wait_for_services
    show_info
}

# Run main function
main "$@"

# scripts/dev.sh
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

# scripts/prod.sh
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

# scripts/backup.sh
#!/bin/bash
# Database backup script

BACKUP_DIR="database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="malecom_backup_$TIMESTAMP.sql"

echo "📦 Creating database backup..."

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Create database backup
docker-compose exec database mysqldump -u root -p${DB_ROOT_PASSWORD:-rootpassword123} malecom_suits > "$BACKUP_DIR/$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Backup created successfully: $BACKUP_DIR/$BACKUP_FILE"
    
    # Compress backup
    gzip "$BACKUP_DIR/$BACKUP_FILE"
    echo "🗜️  Backup compressed: $BACKUP_DIR/$BACKUP_FILE.gz"
    
    # Keep only last 7 backups
    find $BACKUP_DIR -name "malecom_backup_*.sql.gz" -mtime +7 -delete
    echo "🧹 Old backups cleaned up"
else
    echo "❌ Backup failed!"
    exit 1
fi

# scripts/restore.sh
#!/bin/bash
# Database restore script

if [ -z "$1" ]; then
    echo "Usage: ./scripts/restore.sh <backup_file>"
    echo "Available backups:"
    ls -la database/backups/
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "🔄 Restoring database from: $BACKUP_FILE"

# Check if file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo "📂 Decompressing backup..."
    gunzip -c "$BACKUP_FILE" | docker-compose exec -T database mysql -u root -p${DB_ROOT_PASSWORD:-rootpassword123} malecom_suits
else
    cat "$BACKUP_FILE" | docker-compose exec -T database mysql -u root -p${DB_ROOT_PASSWORD:-rootpassword123} malecom_suits
fi

if [ $? -eq 0 ]; then
    echo "✅ Database restored successfully!"
    echo "🔄 Restarting backend to refresh connections..."
    docker-compose restart backend
else
    echo "❌ Database restore failed!"
    exit 1
fi

# scripts/logs.sh
#!/bin/bash
# View application logs

SERVICE=${1:-all}

case $SERVICE in
    "backend"|"api")
        docker-compose logs -f backend
        ;;
    "frontend"|"web")
        docker-compose logs -f frontend
        ;;
    "database"|"db")
        docker-compose logs -f database
        ;;
    "redis")
        docker-compose logs -f redis
        ;;
    "nginx")
        docker-compose logs -f nginx
        ;;
    "all"|*)
        docker-compose logs -f
        ;;
esac

# scripts/clean.sh
#!/bin/bash
# Clean up Docker resources

echo "🧹 Cleaning up Docker resources..."

# Stop all containers
docker-compose down

# Remove unused containers, networks, images
docker system prune -f

# Remove volumes (optional - uncomment if you want to reset data)
# docker-compose down -v
# docker volume prune -f

echo "✅ Cleanup completed!"

