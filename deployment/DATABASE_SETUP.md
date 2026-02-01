# Database Setup Guide

Panduan lengkap setup database untuk client baru dan update existing database.

## Untuk Client Baru (Fresh Install)

### Opsi 1: Setup Otomatis (Recommended)

Jalankan satu command ini untuk setup database lengkap:

```bash
cd /var/www/rafnet-cctv/backend
npm run setup-db
```

Script ini akan:
1. ✅ Create folder `data/` jika belum ada
2. ✅ Create database file `data/cctv.db`
3. ✅ Create semua tabel dasar (users, cameras, areas, audit_logs, feedbacks)
4. ✅ Create default admin user (username: admin, password: admin123)
5. ✅ **Otomatis run SEMUA migrations** (17 migrations)
6. ✅ Database siap pakai!

**Output yang diharapkan:**
```
✓ Created data directory
✓ Created users table
✓ Created areas table
✓ Created cameras table
✓ Created audit_logs table
✓ Created feedbacks table
✓ Created default admin user
  Username: admin
  Password: admin123
  ⚠️  CHANGE THIS PASSWORD IN PRODUCTION!

🔄 Running database migrations...
Found 17 migration files:

====================================================
📄 Running: add_analytics_indexes.js
====================================================
✅ Migration completed

... (16 more migrations)

====================================================
📊 Migration Summary:
====================================================
✅ Success: 17
⏭️  Skipped: 0
❌ Errors: 0
📁 Total: 17

✅ All migrations completed successfully!
✅ Database setup completed successfully!
```

### Opsi 2: Setup Manual (Step by Step)

Jika ingin kontrol penuh:

**Step 1: Create basic tables**
```bash
cd /var/www/rafnet-cctv/backend
node database/setup.js
```

**Step 2: Run all migrations**
```bash
npm run migrate
```

## Untuk Update Existing Database

Jika database sudah ada dan hanya perlu update ke versi terbaru:

```bash
cd /var/www/rafnet-cctv/backend
npm run migrate
```

Script akan:
- ✅ Detect migrations yang sudah dijalankan (skip)
- ✅ Run migrations yang belum dijalankan
- ✅ Show summary

## List Migrations

Berikut 17 migrations yang akan dijalankan (urutan alfabetis):

| # | Migration File | Purpose |
|---|----------------|---------|
| 1 | add_analytics_indexes.js | Index untuk performa analytics |
| 2 | add_area_coordinates.js | Koordinat GPS untuk areas |
| 3 | add_branding_settings.js | **Branding customization (16 fields)** |
| 4 | add_camera_online_status.js | Status online/offline camera |
| 5 | add_camera_status.js | Status camera (active/maintenance) |
| 6 | add_coordinates.js | Koordinat GPS untuk cameras |
| 7 | add_core_indexes.js | Index untuk performa queries |
| 8 | add_feedbacks_table.js | Tabel feedback users |
| 9 | add_is_tunnel_field.js | Flag tunnel connection |
| 10 | add_recording_system.js | Sistem recording |
| 11 | add_saweria_settings.js | Saweria donation settings |
| 12 | add_settings_table.js | General settings |
| 13 | add_sponsor_fields.js | Sponsor/ads system |
| 14 | add_stream_key.js | Stream key untuk security |
| 15 | add_viewer_sessions.js | Tracking viewer sessions |
| 16 | create_recordings_table.js | Tabel recordings |
| 17 | (future migrations) | ... |

## Database Schema Overview

Setelah setup selesai, database akan memiliki tabel-tabel ini:

### Core Tables
- **users** - Admin accounts
- **cameras** - Camera configurations
- **areas** - Area/location grouping
- **audit_logs** - Admin action logs
- **feedbacks** - User feedback

### Feature Tables
- **branding_settings** - Branding customization (16 fields)
- **settings** - General app settings
- **saweria_settings** - Donation settings
- **viewer_sessions** - Active viewer tracking
- **recordings** - Recording metadata
- **sponsors** - Sponsor/ads data

### Indexes
- Core indexes untuk performa
- Analytics indexes untuk dashboard

## Verifikasi Database

### Check Tables
```bash
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db ".tables"
```

Expected output:
```
areas                 feedbacks             sponsors
audit_logs            recordings            users
branding_settings     saweria_settings      viewer_sessions
cameras               settings
```

### Check Branding Settings
```bash
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db \
  "SELECT COUNT(*) FROM branding_settings"
```

Expected: `16` (16 branding fields)

### Check Admin User
```bash
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db \
  "SELECT username, role FROM users"
```

Expected: `admin|admin`

## Troubleshooting

### Error: "database is locked"

Database sedang digunakan. Stop backend dulu:
```bash
pm2 stop rafnet-cctv-backend
npm run setup-db
pm2 start rafnet-cctv-backend
```

### Error: "table already exists"

Ini normal jika migration sudah pernah dijalankan. Script akan skip otomatis.

### Migration Failed

Cek error message. Biasanya:
1. Database locked → Stop backend
2. Permission denied → Check file permissions
3. Syntax error → Update code dari GitHub

### Reset Database (DANGER!)

**⚠️ WARNING: Ini akan HAPUS SEMUA DATA!**

```bash
cd /var/www/rafnet-cctv/backend
rm -f data/cctv.db
npm run setup-db
```

## Best Practices

### Untuk Development
```bash
# Setup database
npm run setup-db

# Test migrations
npm run migrate

# Reset jika perlu
rm data/cctv.db && npm run setup-db
```

### Untuk Production

**Initial Setup:**
```bash
cd /var/www/rafnet-cctv/backend
npm run setup-db
# Change admin password via admin panel!
```

**Update Database:**
```bash
cd /var/www/rafnet-cctv
git pull origin main
cd backend
npm run migrate
pm2 restart rafnet-cctv-backend
```

### Backup Database

**Before Migration:**
```bash
cp backend/data/cctv.db backend/data/cctv.db.backup.$(date +%Y%m%d_%H%M%S)
```

**Restore Backup:**
```bash
cp backend/data/cctv.db.backup.YYYYMMDD_HHMMSS backend/data/cctv.db
pm2 restart rafnet-cctv-backend
```

## FAQ

**Q: Apakah perlu run migration satu-satu?**
A: TIDAK! Gunakan `npm run setup-db` untuk client baru atau `npm run migrate` untuk update.

**Q: Bagaimana jika ada migration baru?**
A: Cukup `git pull` dan `npm run migrate`. Script akan detect dan run migration baru saja.

**Q: Apakah aman run migrate berkali-kali?**
A: YA! Script akan skip migration yang sudah dijalankan.

**Q: Bagaimana cara customize branding setelah setup?**
A: Login admin panel → Settings → Branding. Lihat `BRANDING_CUSTOMIZATION.md`.

**Q: Database location?**
A: `backend/data/cctv.db` (SQLite file)

## Support

Untuk bantuan lebih lanjut:
- WhatsApp: +62 896-8564-5956
- Email: admin@raf.my.id
- GitHub: https://github.com/rafall04/cctv
