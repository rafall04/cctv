# Database Migration Rules

## CRITICAL: Migration Checklist

Setiap kali menambahkan field baru ke database, WAJIB melakukan langkah-langkah berikut **DALAM URUTAN INI** untuk menghindari error 500:

### Urutan Langkah (PENTING!)

1. **Buat Migration File** - Tambahkan kolom ke database
2. **Jalankan Migration** - Eksekusi migration di development
3. **Update Schema Validator** - Tambahkan field ke schema (WAJIB!)
4. **Update Backend Controller** - Tambahkan field ke query dan logic
5. **Update Frontend** - Tambahkan field ke form dan UI
6. **Test di Development** - Verifikasi semua berfungsi
7. **Deploy ke Production** - Jalankan migration, restart backend

**JANGAN skip langkah 3 (Schema Validator)** - Ini penyebab paling umum error 500!

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
    console.log('🔄 Starting migration: add [field_name]...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(table_name)").all();
    const hasColumn = tableInfo.some(col => col.name === 'column_name');

    if (!hasColumn) {
        console.log('➕ Adding column_name column...');
        
        // Add column with appropriate type and default
        db.exec(`ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value`);
        
        console.log('✅ column_name column added successfully');
        
        // Optional: Update existing rows if needed
        const result = db.prepare(`UPDATE table_name SET column_name = ? WHERE column_name IS NULL`).run('default_value');
        console.log(`✅ Updated ${result.changes} existing rows with default value`);
    } else {
        console.log('✓ column_name column already exists');
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
node database/migrations/add_[field_name].js

# Production (Ubuntu 20.04 - as root)
cd /var/www/rafnet-cctv/backend
node database/migrations/add_[field_name].js
```

**Verifikasi migration berhasil:**
```bash
# Check kolom ada di database
sqlite3 backend/data/cctv.db "PRAGMA table_info(table_name)" | grep column_name

# Atau dengan Node.js
node -e "import('better-sqlite3').then(m => { const db = new m.default('./backend/data/cctv.db'); const info = db.prepare('PRAGMA table_info(table_name)').all(); console.log(info.find(c => c.name === 'column_name')); db.close(); })"
```

### 3. Update Schema Validator (WAJIB!)

**INI LANGKAH PALING PENTING - JANGAN SKIP!**

File `backend/middleware/schemaValidators.js` menggunakan `additionalProperties: false` yang berarti **semua field yang tidak ada di schema akan di-strip/dihapus**.

```javascript
// backend/middleware/schemaValidators.js

// Contoh: Menambahkan field 'video_codec' ke cameras
export const cameraSchemas = {
    create: {
        type: 'object',
        required: ['name', 'private_rtsp_url'],
        additionalProperties: false, // ← INI YANG BIKIN FIELD DI-STRIP!
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            private_rtsp_url: { type: 'string', minLength: 1 },
            description: { type: 'string', maxLength: 500 },
            location: { type: 'string', maxLength: 200 },
            group_name: { type: 'string', maxLength: 100 },
            area_id: { type: ['integer', 'null'] },
            enabled: { type: 'boolean' },
            status: { type: 'string', enum: ['active', 'maintenance', 'offline'] },
            is_online: { type: 'boolean' },
            is_tunnel: { type: 'boolean' },
            video_codec: { type: 'string', enum: ['h264', 'h265'] }, // ← TAMBAHKAN INI!
        }
    },
    update: {
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            private_rtsp_url: { type: 'string', minLength: 1 },
            description: { type: 'string', maxLength: 500 },
            location: { type: 'string', maxLength: 200 },
            group_name: { type: 'string', maxLength: 100 },
            area_id: { type: ['integer', 'null'] },
            enabled: { type: 'boolean' },
            status: { type: 'string', enum: ['active', 'maintenance', 'offline'] },
            is_online: { type: 'boolean' },
            is_tunnel: { type: 'boolean' },
            video_codec: { type: 'string', enum: ['h264', 'h265'] }, // ← TAMBAHKAN INI JUGA!
        }
    }
};
```

**Kenapa ini penting?**
- Jika field tidak ada di schema, request body akan di-strip
- Field tidak akan sampai ke controller
- Data tidak akan tersimpan ke database
- Tidak ada error message yang jelas (silent failure)
- Hasil: Error 500 atau data tidak tersimpan

**Cara verifikasi schema validator:**
```javascript
// Test di controller dengan console.log
export async function createCamera(request, reply) {
    console.log('Raw request.body:', request.body); // Cek field ada
    
    // Setelah validation, field yang tidak ada di schema akan hilang
    const { video_codec } = request.body;
    console.log('video_codec after validation:', video_codec); // Cek masih ada
}
```

### 4. Update Backend Controller

**4a. Update SELECT queries (getAll dan getById)**
```javascript
// backend/controllers/cameraController.js

// ✅ CORRECT - Include new field in SELECT
export async function getAllCameras(request, reply) {
    try {
        const cameras = query(`
            SELECT 
                id, name, private_rtsp_url, description, location, 
                group_name, area_id, enabled, status, is_online, 
                is_tunnel, stream_key, video_codec,  -- ← TAMBAHKAN INI
                created_at, updated_at
            FROM cameras 
            ORDER BY id ASC
        `);
        
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// ❌ WRONG - Missing new field
export async function getAllCameras(request, reply) {
    const cameras = query('SELECT id, name, location FROM cameras'); // video_codec tidak ada!
}
```

**4b. Update INSERT query (create function)**
```javascript
// ✅ CORRECT - Include new field in INSERT
export async function createCamera(request, reply) {
    try {
        const { 
            name, private_rtsp_url, description, location, 
            group_name, area_id, enabled, status, is_online, 
            is_tunnel, video_codec  // ← TAMBAHKAN INI
        } = request.body;
        
        const result = execute(`
            INSERT INTO cameras (
                name, private_rtsp_url, description, location, 
                group_name, area_id, enabled, status, is_online, 
                is_tunnel, stream_key, video_codec  -- ← TAMBAHKAN INI
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name, private_rtsp_url, description, location, 
            group_name, area_id, enabled, status, is_online, 
            is_tunnel, streamKey, video_codec || 'h264'  // ← TAMBAHKAN INI dengan default
        ]);
        
        // Log audit
        logAdminAction({
            action: 'camera_created',
            camera_id: result.lastInsertRowid,
            camera_name: name,
            video_codec: video_codec || 'h264',  // ← Include in audit log
            userId: request.user.id
        }, request);
        
        return reply.code(201).send({ 
            success: true, 
            data: { id: result.lastInsertRowid } 
        });
    } catch (error) {
        console.error('Create camera error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
```

**4c. Update UPDATE query (update function)**
```javascript
// ✅ CORRECT - Handle new field in UPDATE
export async function updateCamera(request, reply) {
    try {
        const { id } = request.params;
        const updates = request.body;
        
        const updateFields = [];
        const updateValues = [];
        
        // Handle all possible fields including new one
        if (updates.name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(updates.name);
        }
        // ... other fields ...
        
        if (updates.video_codec !== undefined) {  // ← TAMBAHKAN INI
            updateFields.push('video_codec = ?');
            updateValues.push(updates.video_codec);
        }
        
        if (updateFields.length === 0) {
            return reply.code(400).send({ 
                success: false, 
                message: 'No fields to update' 
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(id);
        
        const result = execute(`
            UPDATE cameras 
            SET ${updateFields.join(', ')} 
            WHERE id = ?
        `, updateValues);
        
        if (result.changes === 0) {
            return reply.code(404).send({ 
                success: false, 
                message: 'Camera not found' 
            });
        }
        
        // Log audit with changes
        logAdminAction({
            action: 'camera_updated',
            camera_id: id,
            changes: updates,  // Include video_codec if changed
            userId: request.user.id
        }, request);
        
        return reply.send({ success: true });
    } catch (error) {
        console.error('Update camera error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
```

### 5. Update Frontend

**5a. Update form initialValues**
```javascript
// frontend/src/pages/CameraManagement.jsx

const [formData, setFormData] = useState({
    name: '',
    private_rtsp_url: '',
    description: '',
    location: '',
    group_name: '',
    area_id: null,
    enabled: true,
    status: 'active',
    is_online: true,
    is_tunnel: false,
    video_codec: 'h264',  // ← TAMBAHKAN INI dengan default value
});
```

**5b. Update openAddModal**
```javascript
const openAddModal = () => {
    setFormData({
        name: '',
        private_rtsp_url: '',
        description: '',
        location: '',
        group_name: '',
        area_id: null,
        enabled: true,
        status: 'active',
        is_online: true,
        is_tunnel: false,
        video_codec: 'h264',  // ← TAMBAHKAN INI
    });
    setIsModalOpen(true);
    setEditingId(null);
};
```

**5c. Update openEditModal**
```javascript
const openEditModal = (camera) => {
    setFormData({
        name: camera.name,
        private_rtsp_url: camera.private_rtsp_url,
        description: camera.description || '',
        location: camera.location || '',
        group_name: camera.group_name || '',
        area_id: camera.area_id,
        enabled: camera.enabled,
        status: camera.status,
        is_online: camera.is_online,
        is_tunnel: camera.is_tunnel,
        video_codec: camera.video_codec || 'h264',  // ← TAMBAHKAN INI
    });
    setIsModalOpen(true);
    setEditingId(camera.id);
};
```

**5d. Update handleSubmit**
```javascript
const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
        const cameraData = {
            name: formData.name,
            private_rtsp_url: formData.private_rtsp_url,
            description: formData.description,
            location: formData.location,
            group_name: formData.group_name,
            area_id: formData.area_id,
            enabled: formData.enabled,
            status: formData.status,
            is_online: formData.is_online,
            is_tunnel: formData.is_tunnel,
            video_codec: formData.video_codec,  // ← TAMBAHKAN INI
        };
        
        if (editingId) {
            await cameraService.updateCamera(editingId, cameraData);
        } else {
            await cameraService.createCamera(cameraData);
        }
        
        // Refresh list, close modal, show success
    } catch (error) {
        console.error('Submit error:', error);
    }
};
```

**5e. Add UI element**
```jsx
{/* Video Codec Field */}
<div>
    <label className="block text-sm font-medium mb-2">
        Video Codec
    </label>
    <select
        value={formData.video_codec}
        onChange={(e) => setFormData({ ...formData, video_codec: e.target.value })}
        className="w-full px-4 py-2 rounded-lg border"
    >
        <option value="h264">H.264</option>
        <option value="h265">H.265 (HEVC)</option>
    </select>
</div>
```

### 6. Deploy Checklist
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

# Verify
curl http://localhost:3000/api/cameras | jq '.[0].video_codec'
```

## Common Mistakes to Avoid

### ❌ JANGAN:
1. **Skip schema validator update** - Ini penyebab #1 error 500!
2. Lupa menjalankan migration di server
3. Menggunakan path relatif yang salah di migration file
4. Lupa menambahkan field di SELECT query
5. Lupa menambahkan field di frontend form state
6. Restart backend sebelum jalankan migration
7. Lupa test di development sebelum deploy

### ✅ SELALU:
1. **Update schema validator PERTAMA** setelah migration
2. Test migration di local dulu
3. Gunakan `__dirname` untuk path yang reliable
4. Check apakah kolom sudah ada sebelum ALTER TABLE
5. Update SEMUA tempat yang menggunakan data tersebut
6. Verifikasi dengan console.log di controller
7. Test create dan update di development
8. Jalankan migration di production SEBELUM restart backend

## Field Addition Checklist

Saat menambahkan field baru, pastikan update di **SEMUA** tempat ini:

### Backend (URUTAN PENTING!):
- [ ] `backend/database/migrations/add_[field].js` - Migration file
- [ ] **Jalankan migration** - `node backend/database/migrations/add_[field].js`
- [ ] **Verifikasi kolom ada** - `sqlite3 data/cctv.db "PRAGMA table_info(table_name)"`
- [ ] `backend/middleware/schemaValidators.js` - **WAJIB!** Tambahkan di `create` schema
- [ ] `backend/middleware/schemaValidators.js` - **WAJIB!** Tambahkan di `update` schema
- [ ] `backend/controllers/[entity]Controller.js` - getAll SELECT query
- [ ] `backend/controllers/[entity]Controller.js` - getById SELECT query  
- [ ] `backend/controllers/[entity]Controller.js` - create function (destructure + INSERT)
- [ ] `backend/controllers/[entity]Controller.js` - update function (handle field)
- [ ] Test dengan console.log di controller - verifikasi field tidak di-strip

### Frontend:
- [ ] Form initialValues - tambahkan field dengan default value
- [ ] openAddModal resetWith - tambahkan field
- [ ] openEditModal resetWith - tambahkan field dari camera object
- [ ] handleSubmit data object - include field dalam request
- [ ] UI component untuk input/display field
- [ ] Test create new record - verifikasi field tersimpan
- [ ] Test edit existing record - verifikasi field terupdate

### Deployment:
- [ ] Commit semua perubahan ke Git
- [ ] Push ke GitHub
- [ ] git pull di server production
- [ ] **Jalankan migration di production** - SEBELUM restart!
- [ ] npm run build (frontend)
- [ ] pm2 restart backend
- [ ] Test API endpoint - verifikasi field ada di response
- [ ] Test create/update via UI - verifikasi field tersimpan

## Debugging Tips

### Jika field baru tidak tersimpan:

**1. Cek apakah migration sudah dijalankan:**
```bash
sqlite3 data/cctv.db "PRAGMA table_info(table_name)" | grep field_name
# Atau
node -e "import('better-sqlite3').then(m => { const db = new m.default('./backend/data/cctv.db'); const info = db.prepare('PRAGMA table_info(table_name)').all(); console.log(info.find(c => c.name === 'field_name')); db.close(); })"
```

**2. Cek apakah field ada di schema validator:**
```bash
grep -n "field_name" backend/middleware/schemaValidators.js
# Harus muncul di create schema DAN update schema
```

**3. Cek apakah field sampai ke controller:**
```javascript
// Tambahkan di controller
export async function createCamera(request, reply) {
    console.log('=== DEBUG REQUEST BODY ===');
    console.log('Raw body:', JSON.stringify(request.body, null, 2));
    console.log('field_name:', request.body.field_name);
    console.log('========================');
    
    // Jika field_name undefined, berarti di-strip oleh schema validator!
}
```

**4. Cek apakah field ada di response:**
```bash
# Test API endpoint
curl http://localhost:3000/api/cameras | jq '.[0].field_name'

# Atau di browser DevTools Console
fetch('/api/cameras')
  .then(r => r.json())
  .then(data => console.log('field_name:', data.data[0].field_name));
```

**5. Cek apakah field di-handle di UPDATE query:**
```javascript
// Pastikan ada di update function
if (updates.field_name !== undefined) {
    updateFields.push('field_name = ?');
    updateValues.push(updates.field_name);
}
```

### Error 500 Troubleshooting

**Penyebab umum error 500 saat add field:**

1. **Field tidak ada di schema validator** (80% kasus!)
   - Symptom: Field di-strip, tidak sampai ke controller
   - Fix: Tambahkan field ke `schemaValidators.js`

2. **Migration belum dijalankan**
   - Symptom: SQL error "no such column"
   - Fix: Jalankan migration file

3. **Field tidak ada di INSERT query**
   - Symptom: SQL error "column count mismatch"
   - Fix: Tambahkan field ke INSERT statement

4. **Field tidak ada di SELECT query**
   - Symptom: Field undefined di response
   - Fix: Tambahkan field ke SELECT statement

5. **Type mismatch**
   - Symptom: SQL error "datatype mismatch"
   - Fix: Pastikan type di schema validator match dengan database type

### Quick Debug Script

Buat file `debug-field.js` untuk quick check:
```javascript
import Database from 'better-sqlite3';

const db = new Database('./backend/data/cctv.db');

// Check if column exists
const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
const field = tableInfo.find(c => c.name === 'video_codec');

console.log('Field exists:', !!field);
console.log('Field info:', field);

// Check if data exists
const sample = db.prepare('SELECT id, name, video_codec FROM cameras LIMIT 1').get();
console.log('Sample data:', sample);

db.close();
```

Run: `node debug-field.js`
