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