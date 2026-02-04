# Backup & Restore Guide

## Overview

Fitur backup/restore memungkinkan export/import complete database untuk:
- Migrasi ke backend Go
- Disaster recovery
- Clone setup ke server lain
- Development/testing data

## Format Backup

```json
{
  "version": "1.0",
  "exported_at": "2026-02-05T10:30:00.000Z",
  "data": {
    "users": [...],
    "cameras": [...],
    "areas": [...],
    "audit_logs": [...],
    "feedbacks": [...],
    "api_keys": [...],
    "viewer_sessions": [...],
    "viewer_session_history": [...],
    "system_settings": [...],
    "saweria_settings": [...]
  }
}
```

## Export Backup

### Via UI (Admin Panel)

1. Login sebagai admin
2. Buka **System Settings**
3. Scroll ke section **Backup & Restore Database**
4. Klik **Export Backup**
5. File akan didownload: `rafnet-cctv-backup-YYYY-MM-DD.json`

### Via API

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:3000/api/admin/backup/export \
     -o backup.json
```

## Import Backup

### Mode Import

**1. MERGE Mode (Recommended)**
- Data existing dipertahankan
- Hanya menambah data baru
- Skip duplicate berdasarkan primary key
- Aman untuk restore partial data
- Users & API keys di-skip untuk security

**2. REPLACE Mode (Destructive)**
- ⚠️ HAPUS semua data existing
- Replace dengan data dari backup
- Gunakan untuk migrasi penuh
- Tidak bisa di-undo!

### Via UI (Admin Panel)

1. Login sebagai admin
2. Buka **System Settings**
3. Scroll ke section **Backup & Restore Database**
4. Pilih file backup JSON
5. Preview akan muncul (version, exported date, table counts)
6. Pilih mode: **Merge** atau **Replace**
7. Klik **Import Backup**
8. Konfirmasi action
9. Page akan reload setelah import selesai

### Via API

```bash
# Preview backup
curl -X POST http://localhost:3000/api/admin/backup/preview \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @backup.json

# Import (merge mode)
curl -X POST http://localhost:3000/api/admin/backup/import \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup": <BACKUP_JSON_CONTENT>,
    "mode": "merge"
  }'

# Import (replace mode)
curl -X POST http://localhost:3000/api/admin/backup/import \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup": <BACKUP_JSON_CONTENT>,
    "mode": "replace"
  }'
```

## Use Cases

### 1. Migrasi ke Go Backend

```bash
# 1. Export dari Node.js backend
curl -H "Authorization: Bearer TOKEN" \
     http://old-server.com/api/admin/backup/export \
     -o migration.json

# 2. Parse JSON di Go backend
# Format sudah standar, tinggal unmarshal ke struct
# Contoh Go code:

type Backup struct {
    Version    string                 `json:"version"`
    ExportedAt string                 `json:"exported_at"`
    Data       map[string][]map[string]interface{} `json:"data"`
}

func ImportBackup(backupFile string) error {
    data, _ := ioutil.ReadFile(backupFile)
    var backup Backup
    json.Unmarshal(data, &backup)
    
    // Insert ke database Go
    for table, records := range backup.Data {
        for _, record := range records {
            // INSERT INTO table ...
        }
    }
}
```

### 2. Clone Setup ke Server Baru

```bash
# Server lama
cd /var/www/rafnet-cctv
curl -H "Authorization: Bearer TOKEN" \
     http://localhost:3000/api/admin/backup/export \
     -o /tmp/clone-backup.json

# Transfer ke server baru
scp /tmp/clone-backup.json user@new-server:/tmp/

# Server baru (setelah install)
# Upload via UI atau API import
```

### 3. Disaster Recovery

```bash
# Backup otomatis (cron job)
0 2 * * * curl -H "Authorization: Bearer TOKEN" \
          http://localhost:3000/api/admin/backup/export \
          -o /backup/rafnet-cctv-$(date +\%Y\%m\%d).json

# Restore saat disaster
# Upload file backup via UI dengan mode REPLACE
```

### 4. Development/Testing Data

```bash
# Export production data
curl -H "Authorization: Bearer PROD_TOKEN" \
     https://prod.example.com/api/admin/backup/export \
     -o prod-data.json

# Import ke dev (merge mode untuk testing)
curl -X POST http://localhost:3000/api/admin/backup/import \
  -H "Authorization: Bearer DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d @prod-data.json
```

## Security Notes

### Merge Mode Protection

Untuk security, mode MERGE akan skip tables berikut:
- `users` - Hindari overwrite admin credentials
- `api_keys` - Hindari key collision

Jika perlu import users/api_keys, gunakan mode REPLACE.

### Backup File Security

⚠️ **Backup file berisi data sensitif:**
- User passwords (hashed)
- API keys
- RTSP URLs dengan credentials
- Audit logs

**Best Practices:**
- Encrypt backup file saat transfer
- Simpan di secure storage
- Jangan commit ke Git
- Set proper file permissions (600)

```bash
# Encrypt backup
gpg -c backup.json  # Creates backup.json.gpg

# Decrypt
gpg backup.json.gpg  # Creates backup.json
```

## Troubleshooting

### Import Failed: Invalid Format

```
Error: Invalid backup format
```

**Fix:** Pastikan file JSON valid dan memiliki structure:
```json
{
  "version": "1.0",
  "exported_at": "...",
  "data": { ... }
}
```

### Import Failed: Table Not Found

```
Error: no such table: table_name
```

**Fix:** Run migrations terlebih dahulu:
```bash
cd /var/www/rafnet-cctv/backend
node database/migrations/run_all_migrations.js
```

### Partial Import Success

Response:
```json
{
  "success": true,
  "imported": {
    "cameras": 10,
    "areas": 5
  },
  "skipped": {
    "users": "Skipped for security (merge mode)"
  },
  "errors": {
    "invalid_table": "no such table"
  }
}
```

**Action:** Check errors, fix schema, retry import.

## API Reference

### GET /api/admin/backup/export

Export complete database backup.

**Auth:** Required (JWT)

**Response:**
```json
{
  "version": "1.0",
  "exported_at": "2026-02-05T10:30:00.000Z",
  "data": { ... }
}
```

**Headers:**
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="rafnet-cctv-backup-YYYY-MM-DD.json"`

### POST /api/admin/backup/preview

Preview backup statistics before import.

**Auth:** Required (JWT)

**Body:**
```json
{
  "backup": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "version": "1.0",
    "exported_at": "2026-02-05T10:30:00.000Z",
    "tables": {
      "users": 5,
      "cameras": 10,
      "areas": 3
    }
  }
}
```

### POST /api/admin/backup/import

Import backup data.

**Auth:** Required (JWT)

**Body:**
```json
{
  "backup": { ... },
  "mode": "merge",  // or "replace"
  "tables": ["cameras", "areas"]  // optional, default: all
}
```

**Response:**
```json
{
  "success": true,
  "message": "Backup berhasil diimport",
  "data": {
    "imported": {
      "cameras": 10,
      "areas": 5
    },
    "skipped": {
      "users": "Skipped for security (merge mode)"
    },
    "errors": {}
  }
}
```

## Audit Logging

Semua backup/restore operations dicatat di audit log:

```sql
SELECT * FROM audit_logs 
WHERE action IN ('backup_exported', 'backup_imported')
ORDER BY created_at DESC;
```

Log details:
```json
{
  "action": "backup_exported",
  "details": {
    "stats": {
      "version": "1.0",
      "tables": { ... }
    }
  },
  "userId": 1,
  "ip_address": "192.168.1.100"
}
```

## Best Practices

1. **Regular Backups**
   - Schedule daily exports via cron
   - Keep 7 days of backups
   - Test restore quarterly

2. **Before Major Changes**
   - Export backup sebelum update
   - Export sebelum migration
   - Export sebelum bulk delete

3. **Secure Storage**
   - Encrypt backup files
   - Store off-site (S3, Google Drive)
   - Restrict access (chmod 600)

4. **Testing**
   - Test restore di dev environment
   - Verify data integrity
   - Check foreign key constraints

5. **Documentation**
   - Document backup schedule
   - Document restore procedures
   - Train team on recovery process
