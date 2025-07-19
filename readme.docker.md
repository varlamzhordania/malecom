# 🐳 Malecom Suits - Docker Setup

Complete Docker-based development and production environment for the Malecom Suits vacation rental platform.

## 🚀 Quick Start

### Prerequisites

- **Docker Desktop** (Windows/Mac) or **Docker Engine** (Linux)
- **Docker Compose** v2.0+
- **Git**

### 1-Minute Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd malecom-suits

# Run the setup script
chmod +x setup.sh
./setup.sh

# Or use Make
make setup
```

That's it! 🎉 Your application will be running at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Database Admin**: http://localhost:8080

## 📦 What's Included

### Services

| Service | Port | Description |
|---------|------|-------------|
| **Frontend** | 3000 | React application |
| **Backend** | 5000 | Node.js API server |
| **Database** | 3306 | MySQL 8.0 database |
| **Redis** | 6379 | Cache and sessions |
| **Adminer** | 8080 | Database management |
| **Nginx** | 80/443 | Reverse proxy (production) |

### Features

✅ **Complete Environment**: Database, API, Frontend, Cache  
✅ **Hot Reload**: Live development with file watching  
✅ **Sample Data**: Pre-loaded with test users and properties  
✅ **Database Management**: Web-based Adminer interface  
✅ **Health Checks**: Service monitoring and auto-restart  
✅ **Logging**: Centralized logging with rotation  
✅ **Security**: Secure defaults and secret generation  
✅ **Production Ready**: Production optimized configurations  

## 🛠️ Commands

### Using Make (Recommended)

```bash
make setup      # Initial setup
make dev        # Start development
make prod       # Deploy production
make stop       # Stop all services
make logs       # View logs
make backup     # Backup database
make clean      # Clean Docker resources
```

### Using Docker Compose

```bash
# Development
docker-compose up -d                    # Start all services
docker-compose down                     # Stop all services
docker-compose logs -f                  # View logs
docker-compose restart backend         # Restart specific service

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Using Scripts

```bash
./scripts/dev.sh           # Start development
./scripts/prod.sh          # Start production
./scripts/backup.sh        # Backup database
./scripts/restore.sh       # Restore database
./scripts/logs.sh          # View logs
./scripts/clean.sh         # Clean up
```

## ⚙️ Configuration

### Environment Variables

The `.env` file contains all configuration. Key settings:

```bash
# Database
DB_PASSWORD=auto-generated-secure-password

# Authentication
JWT_SECRET=auto-generated-64-char-secret

# Email (Required for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Payments (Required for bookings)
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_PUBLIC_KEY=pk_test_your_stripe_key

# File Storage (Required for images)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Service Configuration

**Development** (default):
- Hot reload enabled
- Debug logging
- Source maps
- Development tools

**Production**:
- Optimized builds
- Nginx reverse proxy
- SSL termination
- Resource limits

## 🗄️ Database

### Sample Data

The database is automatically populated with:
- **Admin User**: `admin@malecomsuits.com` / `password123`
- **Property Owners**: 3 verified hosts with properties
- **Sample Properties**: 5 vacation rentals with images
- **Sample Bookings**: Test reservations and payments
- **Reviews & Messages**: Sample guest interactions

### Management

```bash
# Database shell
make exec-db
# or
docker-compose exec database mysql -u root -p

# Adminer (Web interface)
http://localhost:8080
Server: database
Username: malecom_user
Password: (from .env file)
Database: malecom_suits
```

### Backup & Restore

```bash
# Create backup
make backup

# Restore from backup
make restore FILE=database/backups/malecom_backup_20250101_120000.sql.gz

# Manual backup
docker-compose exec database mysqldump -u root -p malecom_suits > backup.sql
```

## 🔍 Development

### Hot Reload

Both frontend and backend support hot reload:
- **Backend**: Nodemon restarts on file changes
- **Frontend**: React fast refresh

### Debugging

```bash
# View service logs
make logs                    # All services
make logs SERVICE=backend    # Specific service

# Shell access
docker-compose exec backend sh    # Backend container
docker-compose exec database sh   # Database container

# Debug backend
docker-compose exec backend npm run debug
```

### Testing

```bash
# Run tests
make test

# Run specific tests
docker-compose exec backend npm test -- routes/auth.test.js

# Coverage report
docker-compose exec backend npm run test:coverage
```

## 🚀 Production Deployment

### Local Production Testing

```bash
# Start production environment
make prod

# Test production build
curl http://localhost/api/v1/health
```

### Real Production Deployment

1. **Server Setup**:
```bash
# On your server
git clone <your-repo>
cd malecom-suits
cp .env.docker .env
```

2. **Configure Environment**:
```bash
# Edit .env with production values
nano .env

# Key changes for production:
NODE_ENV=production
JWT_SECRET=very-long-random-production-secret
DB_PASSWORD=strong-production-password
FRONTEND_URL=https://yourdomain.com
```

3. **SSL Setup**:
```bash
# Add SSL certificates
mkdir -p nginx/ssl
cp your-cert.pem nginx/ssl/
cp your-key.pem nginx/ssl/
```

4. **Deploy**:
```bash
make prod
```

### Environment-Specific Configs

**Development** (`docker-compose.override.yml`):
- Source code mounting
- Hot reload
- Development tools
- Debug logging

**Production** (`docker-compose.prod.yml`):
- Optimized builds
- Nginx proxy
- Resource limits
- Production logging

## 🔧 Customization

### Adding New Services

1. **Add to docker-compose.yml**:
```yaml
  new-service:
    image: your-image
    container_name: malecom_new_service
    networks:
      - malecom_network
```

2. **Update scripts** if needed

### Modifying Configurations

- **Backend**: Edit `backend/Dockerfile`
- **Frontend**: Add `frontend/Dockerfile`
- **Database**: Modify `database/my.cnf`
- **Nginx**: Edit `nginx/nginx.conf`

### Environment Overrides

Create environment-specific compose files:
```bash
# Staging
docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d

# Custom development
docker-compose -f docker-compose.yml -f docker-compose.custom.yml up -d
```

## 🛡️ Security

### Default Security Features

- **JWT Authentication** with secure secrets
- **Database** isolated in Docker network
- **Redis** password protected
- **CORS** configured for frontend domain
- **Rate Limiting** enabled
- **Input Validation** on all endpoints

### Production Security Checklist

- [ ] Change all default passwords
- [ ] Use strong JWT secret (64+ characters)
- [ ] Configure SSL certificates
- [ ] Set up firewall rules
- [ ] Enable log monitoring
- [ ] Configure backup encryption
- [ ] Set up intrusion detection

## 🔍 Troubleshooting

### Common Issues

**Port Already in Use**:
```bash
# Check what's using the port
netstat -tulpn | grep :3000

# Stop conflicting services
make stop
```

**Database Connection Failed**:
```bash
# Check database logs
make logs SERVICE=database

# Reset database
docker-compose down -v
make setup
```

**Backend Not Starting**:
```bash
# Check backend logs
make logs SERVICE=backend

# Rebuild backend
docker-compose build backend
docker-compose restart backend
```

**Frontend Build Errors**:
```bash
# Clear node_modules and rebuild
docker-compose down
docker-compose build frontend --no-cache
docker-compose up -d
```

### Health Checks

```bash
# Check all services
docker-compose ps

# Backend health
curl http://localhost:5000/health

# Database health
docker-compose exec database mysqladmin ping
```

### Performance Issues

**Slow Database**:
- Check `database/my.cnf` settings
- Monitor disk space: `df -h`
- Check for long-running queries

**High Memory Usage**:
```bash
# Check container resources
docker stats

# Set memory limits in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 512M
```

## 📚 Additional Resources

### Documentation
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [MySQL Docker Image](https://hub.docker.com/_/mysql)
- [Node.js Docker Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)

### Monitoring
- **Logs**: `./logs/` directory
- **Health**: http://localhost:5000/health
- **Database**: http://localhost:8080
- **Metrics**: Available via API endpoints

### Development Tools
- **API Testing**: Use Postman or curl
- **Database**: Adminer web interface
- **Logs**: Real-time with `make logs`

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/new-feature`
3. **Test** with Docker: `make dev && make test`
4. **Commit** changes: `git commit -m 'Add feature'`
5. **Push** branch: `git push origin feature/new-feature`
6. **Create** Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🎉 You're All Set!

Your Malecom Suits platform is now running with Docker! 

**Next Steps**:
1. 🔧 Configure your API keys in `.env`
2. 🎨 Customize the frontend styling
3. 📧 Set up email notifications
4. 💳 Configure payment processing
5. 🚀 Deploy to production

**Need Help?**
- Check the troubleshooting section
- View logs: `make logs`
- Join our community discussions

Happy coding! 🚀