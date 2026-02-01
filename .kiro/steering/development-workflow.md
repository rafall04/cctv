# Development Workflow

## Core Principle: MINIMAL ACTION, MAXIMUM IMPACT

### ❌ NEVER DO (Waste of Time)

1. **Jangan buat file dokumentasi yang tidak diminta:**
   - ❌ `*_TROUBLESHOOTING.md`
   - ❌ `*_FIX_SUMMARY.md`
   - ❌ `*_GUIDE.md`
   - ❌ `CHANGELOG.md`
   - ❌ Status/progress markdown files

2. **Jangan buat deployment scripts untuk hal sederhana:**
   - ❌ Script bash untuk 1-2 command
   - ✅ Cukup kasih command langsung ke user

3. **Jangan buat multiple files untuk satu fix:**
   - ❌ Fix script + troubleshooting doc + summary doc
   - ✅ Cukup fix masalahnya, push, done

4. **Jangan verbose explanation:**
   - ❌ Panjang lebar explain root cause
   - ✅ Langsung ke solusi

### ✅ ALWAYS DO (Efficient)

1. **Langsung fix masalah:**
   - Identifikasi masalah
   - Edit file yang perlu diubah
   - Push ke GitHub
   - Kasih command deployment (1-3 baris)

2. **Minimal response:**
   - 1-2 kalimat explain masalah
   - Show file changes
   - Command untuk deploy
   - Done

3. **Only create files when:**
   - User explicitly asks
   - File is part of actual codebase (not documentation)

### Workflow Template

```
User: "Fix X tidak jalan"

Response:
"Masalah: [1 kalimat]
Fix: [edit file]
Deploy: [1-3 command]"

DONE. No extra files, no long explanation.
```

## Problem Solving Methodology

### 1. Analisis Sebelum Aksi
- **JANGAN langsung edit kode** sebelum memahami akar masalah
- Baca error message dengan teliti
- Identifikasi SATU masalah utama

### 2. Lokalisasi Masalah

| Gejala | Kemungkinan Sumber |
|--------|-------------------|
| CORS error | Nginx, Backend CORS config, atau duplikasi |
| 502 Bad Gateway | Backend tidak running atau crash |
| 404 pada API | Route tidak terdaftar atau typo path |
| Stream tidak load | MediaMTX, HLS proxy, atau CORS |
| Data tidak tersimpan | Controller, Schema validator, atau Database |

### 3. Verifikasi Hipotesis

```bash
# Test endpoint langsung
curl -v http://localhost:3000/api/endpoint

# Cek service running
pm2 status
systemctl status nginx

# Cek logs
pm2 logs rafnet-cctv-backend --lines 50
tail -f /var/log/nginx/error.log
```

### 4. Perbaikan Minimal
- Edit HANYA file yang relevan
- Jangan refactor saat fixing bug
- Satu commit = satu fix

## Common Issues & Quick Fixes

### CORS Errors

**Gejala: "Access-Control-Allow-Origin contains multiple values"**
- **Penyebab:** Header CORS di lebih dari satu tempat
- **Solusi:** Pilih SATU tempat (Fastify CORS plugin), hapus yang lain

**Gejala: "No 'Access-Control-Allow-Origin' header"**
- **Penyebab:** Origin tidak di whitelist
- **Solusi:** Tambahkan origin ke `ALLOWED_ORIGINS` di `.env`

### Database Errors

**Field baru tidak tersimpan:**
1. [ ] Migration sudah dijalankan?
2. [ ] Field ada di `schemaValidators.js`? (WAJIB!)
3. [ ] Field ada di controller INSERT/UPDATE query?
4. [ ] Field ada di frontend form state?

**"SQLITE_BUSY: database is locked":**
```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
```

### Stream/Video Errors

**HLS stream 404:**
1. MediaMTX running? `curl http://localhost:9997/v3/paths/list`
2. Camera path ada? `curl http://localhost:8888/camera1/index.m3u8`
3. RTSP source valid? Test dengan ffplay

### API Errors

**403 Forbidden:**
- API Key tidak valid → Cek header `X-API-Key`
- Origin tidak diizinkan → Cek `ALLOWED_ORIGINS`
- CSRF token invalid → Cek cookie dan header

**401 Unauthorized:**
- Token expired atau invalid, perlu login ulang

## Anti-Pattern (JANGAN Lakukan)

### ❌ Langsung Edit Tanpa Analisis
```
User: "Ada error CORS"
SALAH: Langsung tambah header CORS di semua tempat
BENAR: Cek dulu header apa yang sudah ada, di mana duplikasinya
```

### ❌ Over-Engineering Fix
```
SALAH: Refactor seluruh CORS handling saat fix satu bug
BENAR: Edit minimal, hanya yang menyebabkan masalah
```

### ❌ Asumsi Tanpa Verifikasi
```
SALAH: "Pasti masalah di Nginx" → langsung edit nginx.conf
BENAR: Test dulu dengan curl ke backend langsung
```

### ❌ Multiple Changes Sekaligus
```
SALAH: Fix CORS + tambah feature + refactor dalam satu commit
BENAR: Satu commit untuk satu fix, test sebelum lanjut
```

## Quick Debug Commands

```bash
# Backend health
curl http://localhost:3000/health

# MediaMTX status
curl http://localhost:9997/v3/paths/list

# Nginx config test
nginx -t

# PM2 status
pm2 status

# Recent backend logs
pm2 logs rafnet-cctv-backend --lines 100

# Nginx error logs
tail -50 /var/log/nginx/rafnet-cctv-backend.error.log

# Test CORS headers
curl -v -H "Origin: https://cctv.raf.my.id" http://localhost:3000/api/cameras/active
```

## Red Flags (Stop Immediately)

If you're about to:
- Create a markdown file with "TROUBLESHOOTING" in name → STOP
- Create a markdown file with "SUMMARY" in name → STOP
- Create a bash script for <5 commands → STOP
- Write >10 lines of explanation → STOP
- Create multiple files for one fix → STOP

## Exceptions (When Verbose is OK)

- User explicitly asks for documentation
- Creating actual project documentation (README.md for new project)
- Complex architectural changes that need explanation
- User asks "explain why"

## Cleanup Policy

### MANDATORY: Delete Test Files After Planning Complete

**When to delete:**
- After spec/planning phase complete
- After property-based tests validated implementation
- Before final commit/push of completed feature

**Test file patterns to delete:**
```bash
# Frontend
frontend/src/__tests__/*.test.js
frontend/src/__tests__/*.property.test.js

# Backend
backend/__tests__/*.test.js
backend/__tests__/*.property.test.js
```

**Cleanup commands:**
```bash
# Windows PowerShell
Remove-Item -Recurse -Force frontend/src/__tests__
Remove-Item -Recurse -Force backend/__tests__

# Ubuntu 20.04
rm -rf frontend/src/__tests__
rm -rf backend/__tests__
```

### Files to Remove After Development
- Temporary fix scripts (*.sh in root)
- Debug/diagnostic files
- Backup files (*.backup, *.bak, *.old)
- Generated documentation not requested
- Empty or placeholder files

### Files to KEEP
- Source code (*.js, *.jsx, *.ts, *.tsx)
- Configuration files (.env, *.config.js, *.yml)
- Documentation explicitly requested
- Deployment scripts in deployment/ folder
- Steering rules in .kiro/steering/

## Summary

**Default Mode: MINIMAL**
- Fix code
- Push
- Deploy command
- DONE

**Only be verbose when user asks.**
