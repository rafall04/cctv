# Migration Guide

## Menjalankan Semua Migration (Aman untuk Data Existing)

Script ini akan menjalankan semua migration secara berurutan tanpa menghapus data yang sudah ada.

### Di Server Ubuntu

```bash
cd /var/www/rafnet-cctv
git pull origin main
node backend/database/migrations/run_all_migrations.js
pm2 restart rafnet-cctv-backend
```

### Di Development (Windows)

```bash
cd C:\project\cctv
git pull origin main
node backend/database/migrations/run_all_migrations.js
```

## Cara Kerja

1. **Aman untuk dijalankan berulang kali** - Migration menggunakan pattern:
   - `ALTER TABLE ADD COLUMN IF NOT EXISTS`
   - `CREATE TABLE IF NOT EXISTS`
   - Check existing columns sebelum add

2. **Tidak menghapus data** - Hanya menambah:
   - Kolom baru
   - Tabel baru
   - Index baru
   - Default settings

3. **Urutan migration** dijaga otomatis oleh script

## Output Example

```
🚀 Starting migration process...

📁 Database: /var/www/rafnet-cctv/backend/data/cctv.db

⏳ Running: 001_migrate_security.js
✅ Success: 001_migrate_security.js

⏳ Running: add_settings_table.js
⏭️  Skipped: add_settings_table.js (already applied)

⏳ Running: add_timezone_settings.js
✅ Success: add_timezone_settings.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Migration Summary:
   ✅ Success: 18
   ⏭️  Skipped: 6
   ❌ Errors:  0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 All migrations completed successfully!
```

## Troubleshooting

### Database Locked

```bash
# Stop backend dulu
pm2 stop rafnet-cctv-backend

# Run migration
node backend/database/migrations/run_all_migrations.js

# Start backend
pm2 start rafnet-cctv-backend
```

### Permission Error

```bash
# Ubuntu
sudo chown -R www-data:www-data /var/www/rafnet-cctv/backend/data
chmod 644 /var/www/rafnet-cctv/backend/data/cctv.db
```

### Verify Migration

```bash
# Check table structure
sqlite3 backend/data/cctv.db ".schema cameras"

# Check data masih ada
sqlite3 backend/data/cctv.db "SELECT COUNT(*) FROM cameras"
```

## Manual Migration (Jika Perlu)

Jika ingin run migration tertentu saja:

```bash
# Single migration
node backend/database/migrations/add_video_codec.js

# Check result
sqlite3 backend/data/cctv.db "PRAGMA table_info(cameras)" | grep video_codec
```

## Backup (Opsional)

Meskipun migration aman, backup tetap recommended:

```bash
# Backup database
cp backend/data/cctv.db backend/data/cctv.db.backup-$(date +%Y%m%d)

# Restore jika perlu
cp backend/data/cctv.db.backup-20260204 backend/data/cctv.db
```
