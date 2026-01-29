# Troubleshooting: Codec Info Tidak Muncul

## Masalah

Codec info (H264/H265) tidak muncul di deskripsi bawah video popup/modal saat play CCTV.

**Gejala:**
- Hanya muncul: "CCTV NAME | LOCATION | STATUS"
- Tidak ada: "Codec: H264" atau badge codec

## Metodologi Debugging

### Step 1: Cek Frontend Component
```bash
# Cari apakah codec info sudah diimplementasikan
grep -n "video_codec" frontend/src/components/MapView.jsx
grep -n "CodecBadge" frontend/src/pages/LandingPage.jsx
```

**Hasil:** ✅ Frontend sudah benar - ada conditional render `{camera.video_codec && ...}`

### Step 2: Cek Backend API Response
```bash
# Cari endpoint yang mengembalikan data cameras
grep -n "getAllActiveStreams" backend/controllers/streamController.js
```

**Hasil:** ✅ Backend query sudah benar - SELECT `video_codec` dari database

### Step 3: Cek Database Schema
```javascript
// Buat script check database
import Database from 'better-sqlite3';
const db = new Database('./backend/data/cctv.db');
const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
const codecField = tableInfo.find(r => r.name === 'video_codec');
console.log('video_codec field:', codecField);
```

**Hasil:** ❌ **Field `video_codec` TIDAK ADA di database!**

```
video_codec field: undefined
SqliteError: no such column: video_codec
```

## Akar Masalah

**Field `video_codec` tidak ada di tabel `cameras` di database.**

### Kenapa Ini Terjadi?

1. **Migration tidak dijalankan** - Field baru ditambahkan di kode tapi migration belum dijalankan
2. **Database lama** - Database dibuat sebelum field `video_codec` ditambahkan
3. **Migration gagal** - Migration pernah dijalankan tapi gagal tanpa error yang jelas

## Solusi

### 1. Buat Migration File

```javascript
// backend/database/migrations/add_video_codec.js
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add video_codec field...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasColumn = tableInfo.some(col => col.name === 'video_codec');

    if (!hasColumn) {
        console.log('➕ Adding video_codec column...');
        
        // Add video_codec column with default 'h264'
        db.exec(`ALTER TABLE cameras ADD COLUMN video_codec TEXT DEFAULT 'h264'`);
        
        console.log('✅ video_codec column added successfully');
        
        // Update existing cameras to have h264 as default
        const result = db.prepare(`UPDATE cameras SET video_codec = 'h264' WHERE video_codec IS NULL`).run();
        console.log(`✅ Updated ${result.changes} existing cameras with default codec h264`);
    } else {
        console.log('✓ video_codec column already exists');
    }
    
    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
```

### 2. Jalankan Migration

```bash
# Development (Windows)
cd backend
node database/migrations/add_video_codec.js

# Production (Ubuntu 20.04 - as root)
cd /var/www/rafnet-cctv/backend
node database/migrations/add_video_codec.js
```

**Output yang diharapkan:**
```
🔄 Starting migration: add video_codec field...
➕ Adding video_codec column...
✅ video_codec column added successfully
✅ Updated 5 existing cameras with default codec h264
✅ Migration completed successfully
```

### 3. Verifikasi

```bash
# Buat script verifikasi
node -e "import('better-sqlite3').then(m => { const db = new m.default('./backend/data/cctv.db'); const cameras = db.prepare('SELECT id, name, video_codec FROM cameras LIMIT 3').all(); console.log(cameras); db.close(); })"
```

**Output yang diharapkan:**
```javascript
[
  { id: 1, name: 'CCTV LAPANGAN DANDER', video_codec: 'h264' },
  { id: 2, name: 'TES', video_codec: 'h264' },
  { id: 5, name: 'Bsbdnnd', video_codec: 'h264' }
]
```

### 4. Restart Backend

```bash
# Development
# Ctrl+C dan npm run dev lagi

# Production
pm2 restart rafnet-cctv-backend
```

### 5. Test di Browser

1. Buka aplikasi
2. Klik kamera untuk play
3. Cek deskripsi bawah video
4. Seharusnya muncul: "Codec: H264" + badge hijau

## Deployment Checklist

Saat deploy ke production:

- [ ] Pull latest code dari GitHub
- [ ] Jalankan migration: `node database/migrations/add_video_codec.js`
- [ ] Verifikasi field ada: `sqlite3 data/cctv.db "PRAGMA table_info(cameras)" | grep video_codec`
- [ ] Restart backend: `pm2 restart rafnet-cctv-backend`
- [ ] Test di browser

## Pencegahan

### 1. Selalu Buat Migration untuk Schema Changes

Jika menambahkan field baru:
1. Buat migration file di `backend/database/migrations/`
2. Jalankan migration di development
3. Test di development
4. Commit migration file ke Git
5. Deploy dan jalankan migration di production

### 2. Checklist Field Baru

Saat menambahkan field baru ke database:

- [ ] Buat migration file
- [ ] Jalankan migration di development
- [ ] Update backend controller (SELECT query)
- [ ] Update backend schema validator (jika ada)
- [ ] Update frontend component
- [ ] Test di development
- [ ] Commit semua perubahan
- [ ] Deploy ke production
- [ ] Jalankan migration di production
- [ ] Test di production

### 3. Database Schema Documentation

Dokumentasikan schema di `backend/database/schema.sql` atau README:

```sql
CREATE TABLE cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    private_rtsp_url TEXT NOT NULL,
    description TEXT,
    location TEXT,
    group_name TEXT,
    area_id INTEGER,
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    is_online INTEGER DEFAULT 1,
    is_tunnel INTEGER DEFAULT 0,
    stream_key TEXT UNIQUE,
    video_codec TEXT DEFAULT 'h264',  -- ← DOKUMENTASIKAN FIELD BARU
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
);
```

## Lessons Learned

1. **Jangan asumsikan field ada** - Selalu verifikasi database schema
2. **Migration adalah wajib** - Tidak cukup hanya update kode
3. **Test di development dulu** - Jangan langsung deploy ke production
4. **Dokumentasi penting** - Catat semua schema changes
5. **Verifikasi setelah deploy** - Selalu test setelah migration

## Tools untuk Debugging

### 1. SQLite CLI
```bash
sqlite3 backend/data/cctv.db
.schema cameras
.quit
```

### 2. Node.js Script
```javascript
import Database from 'better-sqlite3';
const db = new Database('./backend/data/cctv.db');
const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
console.log(tableInfo);
db.close();
```

### 3. Browser DevTools
```javascript
// Console
fetch('/api/stream')
  .then(r => r.json())
  .then(data => console.log(data.data[0]));
// Cek apakah video_codec ada di response
```

### 4. Backend Logs
```bash
# Development
# Cek console output

# Production
pm2 logs rafnet-cctv-backend
```

## Summary

**Masalah:** Codec info tidak muncul
**Akar Penyebab:** Field `video_codec` tidak ada di database
**Solusi:** Jalankan migration untuk menambahkan field
**Pencegahan:** Selalu buat dan jalankan migration untuk schema changes
