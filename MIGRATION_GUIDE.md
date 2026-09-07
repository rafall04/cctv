# Migration Guide

## Menjalankan Semua Migration (Aman untuk Data Existing)

Script ini akan menjalankan semua migration secara berurutan tanpa menghapus data yang sudah ada.

### Di Server Ubuntu

```bash
cd /var/www/cctv
git pull origin main
cd backend
npm run migrate
pm2 restart <client>-cctv-backend
```

### Di Development (Windows)

```bash
cd C:\project\cctv
git pull origin main
cd backend
npm run migrate
```

## Cara Kerja

1. **Dijalankan sekali per migrasi (ledger)** - Runner mencatat tiap migrasi yang sukses ke tabel
   `schema_migrations` dan **melewatinya** pada run berikutnya. Jadi `npm run migrate` tidak lagi
   menjalankan ulang semua migrasi tiap update; hanya file BARU yang dijalankan. (Pada run pertama di
   DB lama, ledger masih kosong sehingga semua migrasi berjalan sekali lalu tercatat.)

2. **Pola tiap migrasi** (SQLite — tidak ada `ADD COLUMN IF NOT EXISTS`):
   - `CREATE TABLE IF NOT EXISTS ...`
   - `PRAGMA table_info(...)` untuk cek kolom sebelum `ALTER TABLE ADD COLUMN`
   - Idempotensi adalah tanggung jawab tiap migrasi (belum dijamin runner) — sebaiknya
     transaksional agar gagal-di-tengah tidak meng-apply-ganda saat di-retry.

3. **Tidak menghapus data** - Hanya menambah:
   - Kolom baru
   - Tabel baru
   - Index baru
   - Default settings

3. **Urutan migration** dijaga otomatis oleh script
   - termasuk migration recent seperti public playback controls, area health override, external health mode, dan playback viewer sessions

## Output Example

```
🚀 Starting migration process...

📁 Database: /var/www/cctv/backend/data/cctv.db

⏳ Running: 001_migrate_security.js
✅ Success: 001_migrate_security.js

⏳ Running: add_settings_table.js
⏭️  Skipped: add_settings_table.js (already applied)

⏳ Running: add_timezone_settings.js
✅ Success: add_timezone_settings.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Migration Summary:
   ✅ Success: <will vary>
   ⏭️  Skipped: <will vary>
   ❌ Errors:  0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 All migrations completed successfully!
```

## Troubleshooting

### Database Locked

```bash
# Stop backend dulu
pm2 stop <client>-cctv-backend

# Run migration
cd backend
npm run migrate

# Start backend
pm2 start <client>-cctv-backend
```

### Permission Error

```bash
# Ubuntu
sudo chown -R www-data:www-data /var/www/cctv/backend/data
chmod 644 /var/www/cctv/backend/data/cctv.db
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

## Backup (WAJIB sebelum migrate)

Selalu cadangkan DB sebelum migrasi (invarian keamanan data). `deployment/update.sh` sudah
melakukannya otomatis (WAL-safe `sqlite3 .backup`); bila migrate manual, jalankan dulu:

```bash
# Backup database (WAL-safe — cp saja bisa merobek snapshot bila ada file -wal)
sqlite3 backend/data/cctv.db ".backup 'backend/data/cctv.db.backup-$(date +%Y%m%d-%H%M%S)'"

# Restore jika perlu
cp backend/data/cctv.db.backup-20260204 backend/data/cctv.db
```
