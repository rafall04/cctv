# Panduan Penyelesaian Masalah (Problem Solving Guide)

## Prinsip Utama

### 1. Analisis Sebelum Aksi
- **JANGAN langsung edit kode** sebelum memahami akar masalah
- Baca error message dengan teliti - seringkali solusi ada di pesan error
- Identifikasi SATU masalah utama, jangan campur aduk beberapa masalah

### 2. Lokalisasi Masalah
- Tentukan layer mana yang bermasalah: Frontend, Backend, Database, Nginx, MediaMTX
- Gunakan proses eliminasi untuk mempersempit scope

## Alur Penyelesaian Masalah

### Step 1: Baca Error Message
```
Error message adalah petunjuk utama. Contoh:
- "CORS policy: multiple values" → Ada duplikasi header
- "ECONNREFUSED" → Service tidak running
- "404 Not Found" → Route/file tidak ada
- "SQLITE_BUSY" → Database locked
```

### Step 2: Identifikasi Sumber Masalah
| Gejala | Kemungkinan Sumber |
|--------|-------------------|
| CORS error | Nginx, Backend CORS config, atau keduanya (duplikasi) |
| 502 Bad Gateway | Backend tidak running atau crash |
| 404 pada API | Route tidak terdaftar atau typo path |
| Stream tidak load | MediaMTX, HLS proxy, atau CORS |
| Data tidak tersimpan | Controller, Schema validator, atau Database |

### Step 3: Verifikasi Hipotesis
Sebelum edit, SELALU verifikasi dengan:
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

### Step 4: Perbaikan Minimal
- Edit HANYA file yang relevan dengan masalah
- Jangan refactor atau "improve" kode lain saat fixing bug
- Satu commit = satu fix

## Masalah Umum & Solusi Cepat

### CORS Errors

#### Gejala: "Access-Control-Allow-Origin contains multiple values"
**Penyebab:** Header CORS ditambahkan di lebih dari satu tempat
**Solusi:**
1. Cek semua tempat yang menambahkan CORS header:
   - `backend/server.js` (Fastify CORS plugin)
   - Route files (manual header)
   - `deployment/nginx.conf`
2. Pilih SATU tempat untuk handle CORS, hapus yang lain
3. Rekomendasi: Biarkan Fastify CORS plugin yang handle, hapus manual headers

#### Gejala: "No 'Access-Control-Allow-Origin' header"
**Penyebab:** Origin tidak ada di whitelist
**Solusi:**
1. Tambahkan origin ke `allowedOrigins` di `server.js`
2. Atau set CORS origin ke `true` untuk accept all (development only)

### Database Errors

#### Gejala: Field baru tidak tersimpan
**Checklist:**
1. [ ] Migration sudah dijalankan?
2. [ ] Field ada di `schemaValidators.js`? (WAJIB - karena `additionalProperties: false`)
3. [ ] Field ada di controller INSERT/UPDATE query?
4. [ ] Field ada di frontend form state?

#### Gejala: "SQLITE_BUSY: database is locked"
**Solusi:**
```javascript
// Gunakan WAL mode
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
```

### Stream/Video Errors

#### Gejala: HLS stream 404
**Checklist:**
1. MediaMTX running? `curl http://localhost:9997/v3/paths/list`
2. Camera path ada? `curl http://localhost:8888/camera1/index.m3u8`
3. RTSP source valid? Test dengan ffplay

#### Gejala: Stream loads tapi video blank
**Penyebab:** Codec incompatibility atau CORS
**Solusi:** Cek browser console untuk error spesifik

### API Errors

#### Gejala: 403 Forbidden
**Kemungkinan:**
1. API Key tidak valid → Cek header `X-API-Key`
2. Origin tidak diizinkan → Cek `originValidator.js`
3. CSRF token invalid → Cek cookie dan header

#### Gejala: 401 Unauthorized
**Solusi:** Token expired atau invalid, perlu login ulang

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
BENAR: Test dulu dengan curl ke backend langsung, baru tentukan
```

### ❌ Multiple Changes Sekaligus
```
SALAH: Fix CORS + tambah feature + refactor dalam satu commit
BENAR: Satu commit untuk satu fix, test sebelum lanjut
```

## Template Analisis Masalah

Gunakan template ini saat menganalisis masalah:

```markdown
## Analisis Masalah

### Error Message
[Copy paste error lengkap]

### Interpretasi
[Apa yang error message katakan]

### Hipotesis
1. [Kemungkinan penyebab 1]
2. [Kemungkinan penyebab 2]

### Verifikasi
- [ ] Test [hipotesis 1]: [command/langkah]
- [ ] Test [hipotesis 2]: [command/langkah]

### Akar Masalah
[Setelah verifikasi, apa penyebab sebenarnya]

### Solusi
[File apa yang perlu diedit, perubahan apa yang diperlukan]
```

## Prioritas Pengecekan

Saat ada masalah, cek dalam urutan ini:

1. **Error message** - Baca dengan teliti
2. **Recent changes** - Apa yang baru diubah?
3. **Service status** - Semua service running?
4. **Logs** - Ada error di logs?
5. **Configuration** - Ada config yang salah?
6. **Code** - Baru cek kode jika semua di atas sudah clear

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

## Catatan Penting

1. **CORS adalah masalah paling umum** - Selalu cek duplikasi header
2. **Schema validator sering dilupakan** - Field baru WAJIB ditambahkan
3. **Restart service setelah edit** - `pm2 restart` atau `systemctl restart`
4. **Clear browser cache** - Saat test frontend setelah fix
5. **Git pull di server** - Jangan lupa deploy perubahan
