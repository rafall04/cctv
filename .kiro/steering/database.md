# Database Management

## Database Helper Functions

File `backend/database/database.js` menyediakan helper functions:

```javascript
// ✅ CORRECT - Available exports
import { query, queryOne, execute, transaction, db } from '../database/database.js';

// ❌ WRONG - These do NOT exist
import { run, get, all } from '../database/database.js';
```

### Function Usage

**query() - SELECT multiple rows:**
```javascript
const cameras = query('SELECT * FROM cameras WHERE enabled = ?', [1]);
// Returns: Array of objects
```

**queryOne() - SELECT single row:**
```javascript
const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [1]);
// Returns: Object or undefined
```

**execute() - INSERT/UPDATE/DELETE:**
```javascript
const result = execute('INSERT INTO cameras (name) VALUES (?)', ['Camera 1']);
// Returns: { changes, lastInsertRowid }

const result = execute('UPDATE cameras SET name = ? WHERE id = ?', ['New Name', 1]);
const result = execute('DELETE FROM cameras WHERE id = ?', [1]);
```

**transaction() - Multiple operations:**
```javascript
const insertMany = transaction((items) => {
    const stmt = db.prepare('INSERT INTO cameras (name) VALUES (?)');
    for (const item of items) {
        stmt.run(item.name);
    }
});

insertMany([{ name: 'Cam1' }, { name: 'Cam2' }]);
```

## Database Migrations

### CRITICAL: Migration Checklist

**URUTAN WAJIB (JANGAN SKIP!):**

1. **Buat migration file**
2. **Jalankan migration**
3. **Update schema validator** ← WAJIB! (`additionalProperties: false`)
4. **Update backend controller** (SELECT, INSERT, UPDATE)
5. **Update frontend** (form state, UI)
6. **Deploy** (migration dulu, baru restart)

### 1. Buat Migration File

```javascript
// backend/database/migrations/add_field_name.js
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add field_name...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(table_name)").all();
    const hasColumn = tableInfo.some(col => col.name === 'field_name');

    if (!hasColumn) {
        console.log('➕ Adding field_name column...');
        
        db.exec(`ALTER TABLE table_name ADD COLUMN field_name TYPE DEFAULT value`);
        
        console.log('✅ field_name column added');
        
        // Update existing rows if needed
        const result = db.prepare(`UPDATE table_name SET field_name = ? WHERE field_name IS NULL`).run('default');
        console.log(`✅ Updated ${result.changes} rows`);
    } else {
        console.log('✓ field_name column already exists');
    }
    
    console.log('✅ Migration completed');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
```

### 2. Jalankan Migration

```bash
# Development
cd backend
node database/migrations/add_field_name.js

# Production
cd /var/www/rafnet-cctv/backend
node database/migrations/add_field_name.js
```

**Verifikasi:**
```bash
sqlite3 backend/data/cctv.db "PRAGMA table_info(table_name)" | grep field_name
```

### 3. Update Schema Validator (WAJIB!)

**INI LANGKAH PALING PENTING - JANGAN SKIP!**

```javascript
// backend/middleware/schemaValidators.js

export const cameraSchemas = {
    create: {
        type: 'object',
        required: ['name', 'private_rtsp_url'],
        additionalProperties: false, // ← Field tidak di schema akan di-strip!
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            private_rtsp_url: { type: 'string', minLength: 1 },
            // ... existing fields ...
            field_name: { type: 'string' }, // ← TAMBAHKAN INI!
        }
    },
    update: {
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            // ... existing fields ...
            field_name: { type: 'string' }, // ← TAMBAHKAN INI JUGA!
        }
    }
};
```

**Kenapa penting?**
- `additionalProperties: false` = field tidak di schema akan di-strip
- Field tidak sampai ke controller
- Data tidak tersimpan
- Tidak ada error message (silent failure)

### 4. Update Backend Controller

**4a. Update SELECT queries:**
```javascript
// ✅ CORRECT - Include new field
const cameras = query(`
    SELECT 
        id, name, location, field_name  -- ← TAMBAHKAN INI
    FROM cameras 
    ORDER BY id ASC
`);

// ❌ WRONG - Missing new field
const cameras = query('SELECT id, name FROM cameras'); // field_name tidak ada!
```

**4b. Update INSERT query:**
```javascript
// ✅ CORRECT
const { name, location, field_name } = request.body;

const result = execute(`
    INSERT INTO cameras (name, location, field_name) 
    VALUES (?, ?, ?)
`, [name, location, field_name || 'default']);
```

**4c. Update UPDATE query:**
```javascript
// ✅ CORRECT
if (updates.field_name !== undefined) {
    updateFields.push('field_name = ?');
    updateValues.push(updates.field_name);
}
```

### 5. Update Frontend

**5a. Update form state:**
```javascript
const [formData, setFormData] = useState({
    name: '',
    location: '',
    field_name: 'default', // ← TAMBAHKAN INI
});
```

**5b. Update modals:**
```javascript
const openAddModal = () => {
    setFormData({
        name: '',
        field_name: 'default', // ← TAMBAHKAN INI
    });
};

const openEditModal = (camera) => {
    setFormData({
        name: camera.name,
        field_name: camera.field_name || 'default', // ← TAMBAHKAN INI
    });
};
```

**5c. Update submit:**
```javascript
const cameraData = {
    name: formData.name,
    field_name: formData.field_name, // ← TAMBAHKAN INI
};
```

**5d. Add UI element:**
```jsx
<input
    value={formData.field_name}
    onChange={(e) => setFormData({ ...formData, field_name: e.target.value })}
/>
```

### 6. Deploy Checklist

```bash
cd /var/www/rafnet-cctv
git pull origin main

# WAJIB: Migration SEBELUM restart
node backend/database/migrations/add_field_name.js

# Build frontend
cd frontend && npm run build

# Restart backend
pm2 restart rafnet-cctv-backend

# Verify
curl http://localhost:3000/api/cameras | jq '.[0].field_name'
```

## Audit Logging

### Available Functions

```javascript
// Admin actions
import { logAdminAction } from '../services/securityAuditLogger.js';

logAdminAction({
    action: 'camera_created',
    camera_id: result.lastInsertRowid,
    camera_name: cameraData.name,
    userId: request.user.id
}, request);

// ❌ WRONG - logAuditEvent does NOT exist
logAuditEvent('camera_created', { ... });
```

### Common Actions

```javascript
// Camera
logAdminAction({ action: 'camera_created', camera_id, camera_name, userId }, request);
logAdminAction({ action: 'camera_updated', camera_id, changes, userId }, request);
logAdminAction({ action: 'camera_deleted', camera_id, camera_name, userId }, request);

// User
logAdminAction({ action: 'user_created', new_user_id, username, userId }, request);
logAdminAction({ action: 'user_updated', target_user_id, changes, userId }, request);
logAdminAction({ action: 'user_deleted', deleted_user_id, username, userId }, request);

// Sponsor
logAdminAction({ action: 'sponsor_created', sponsor_id, sponsor_name, userId }, request);
logAdminAction({ action: 'sponsor_assigned', camera_id, sponsor_name, userId }, request);
```

### Other Security Logging

```javascript
import { 
    logAuthAttempt,
    logRateLimitViolation,
    logApiKeyFailure,
    logCsrfFailure,
    logAccountLockout,
    logPasswordChanged 
} from '../services/securityAuditLogger.js';

logAuthAttempt(success, { username, reason }, request);
logRateLimitViolation({ ip, endpoint }, request);
logApiKeyFailure({ reason, key }, request);
```

## Debugging Tips

### Jika field tidak tersimpan:

**1. Cek migration:**
```bash
sqlite3 data/cctv.db "PRAGMA table_info(table_name)" | grep field_name
```

**2. Cek schema validator:**
```bash
grep -n "field_name" backend/middleware/schemaValidators.js
# Harus ada di create schema DAN update schema
```

**3. Cek controller:**
```javascript
// Tambahkan debug log
console.log('Raw body:', JSON.stringify(request.body, null, 2));
console.log('field_name:', request.body.field_name);
// Jika undefined, berarti di-strip oleh schema validator!
```

**4. Cek response:**
```bash
curl http://localhost:3000/api/cameras | jq '.[0].field_name'
```

## Common Mistakes

### ❌ JANGAN:
1. Skip schema validator update (penyebab #1 error!)
2. Lupa jalankan migration di server
3. Restart backend sebelum migration
4. Lupa field di SELECT query
5. Lupa field di frontend form state

### ✅ SELALU:
1. Update schema validator PERTAMA setelah migration
2. Test migration di local dulu
3. Jalankan migration di production SEBELUM restart
4. Update SEMUA tempat yang gunakan data
5. Verifikasi dengan console.log
