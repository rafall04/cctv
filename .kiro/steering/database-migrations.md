# Database Migration Rules

## CRITICAL: Migration Checklist

Setiap kali menambahkan field baru ke database, WAJIB melakukan langkah-langkah berikut:

### 1. Buat Migration File
```javascript
// backend/database/migrations/add_[field_name].js
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PENTING: Gunakan path relatif dari lokasi file migration
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(table_name)").all();
    const hasColumn = tableInfo.some(col => col.name === 'column_name');

    if (!hasColumn) {
        db.exec(`ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value`);
        console.log('✓ Column added successfully');
    } else {
        console.log('✓ Column already exists');
    }
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
```

### 2. Update Controller
- Tambahkan field baru di query SELECT (untuk getAll dan getById)
- Tambahkan field baru di destructuring request.body
- Tambahkan handling untuk field baru di INSERT dan UPDATE

### 3. Update Frontend
- Tambahkan field di initialValues form
- Tambahkan field di openAddModal resetWith
- Tambahkan field di openEditModal resetWith
- Tambahkan field di handleSubmit data object
- Tambahkan UI element untuk field baru

### 4. Deploy Checklist
```bash
# Di server production:
cd /var/www/rafnet-cctv
git pull origin main

# WAJIB: Jalankan migration SEBELUM restart backend
node backend/database/migrations/add_[field_name].js

# Build frontend
cd frontend && npm run build

# Restart backend
pm2 restart rafnet-cctv-backend
```

## Common Mistakes to Avoid

### ❌ JANGAN:
1. Lupa menjalankan migration di server
2. Menggunakan path relatif yang salah di migration file
3. Lupa menambahkan field di SELECT query
4. Lupa menambahkan field di frontend form state
5. **Lupa menambahkan field di schemaValidators.js** (field akan di-strip karena `additionalProperties: false`)

### ✅ SELALU:
1. Test migration di local dulu
2. Gunakan `__dirname` untuk path yang reliable
3. Check apakah kolom sudah ada sebelum ALTER TABLE
4. Update SEMUA tempat yang menggunakan data tersebut
5. **Update schema validators di `backend/middleware/schemaValidators.js`**

## Field Addition Checklist

Saat menambahkan field baru, pastikan update di:

### Backend:
- [ ] `backend/database/migrations/add_[field].js` - Migration file
- [ ] `backend/middleware/schemaValidators.js` - **WAJIB** tambahkan field di schema (createSchema & updateSchema)
- [ ] `backend/controllers/[entity]Controller.js` - getAll query
- [ ] `backend/controllers/[entity]Controller.js` - getById query  
- [ ] `backend/controllers/[entity]Controller.js` - create function
- [ ] `backend/controllers/[entity]Controller.js` - update function

### Frontend:
- [ ] Form initialValues
- [ ] openAddModal resetWith
- [ ] openEditModal resetWith
- [ ] handleSubmit data object
- [ ] UI component untuk input/display

### Deployment:
- [ ] git pull di server
- [ ] Jalankan migration
- [ ] npm run build
- [ ] pm2 restart

## Debugging Tips

Jika field baru tidak tersimpan:
1. Cek apakah migration sudah dijalankan: `sqlite3 data/cctv.db ".schema table_name"`
2. Cek apakah field ada di request body: tambahkan `console.log(request.body)` di controller
3. Cek apakah field ada di response: cek Network tab di browser DevTools
4. Cek apakah field di-handle di UPDATE query: pastikan ada di `if (field !== undefined)` block
