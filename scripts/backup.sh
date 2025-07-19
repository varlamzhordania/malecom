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