# Analisa Masalah Recording - Tidak Ada File Recording Baru

## 1. DIAGNOSIS MASALAH

### 1.1 Gejala dari Log
```
FFmpeg process for camera 9 exited with code 1
[tcp @ 0x562f76b55a00] Connection to tcp://192.168.13.3:554?timeout=0 failed: No route to host
rtsp://admin:aldivarama123@192.168.13.3:554/stream1: No route to host
```

**Interpretasi:**
- Recording service **SUDAH BERJALAN** (FFmpeg process aktif)
- FFmpeg mencoba record dari RTSP URL
- **GAGAL** karena tidak bisa connect ke kamera (No route to host)
- Kamera dengan IP 192.168.13.3 tidak reachable dari server

### 1.2 Root Cause Analysis

**MASALAH BUKAN di kode recording, tapi di:**
1. **Network connectivity** - Server tidak bisa reach kamera
2. **Camera offline** - Kamera mati atau tidak terhubung
3. **RTSP URL salah** - IP/port/credentials tidak valid
4. **Firewall** - Blocking koneksi ke kamera

## 2. VERIFIKASI SISTEM RECORDING

### 2.1 Cek Status Recording di Database
```bash
# Login ke server
ssh root@172.17.11.12

# Cek cameras dengan recording enabled
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
SELECT id, name, enable_recording, is_recording, enabled, private_rtsp_url 
FROM cameras 
WHERE enable_recording = 1
"
```


### 2.2 Cek Apakah Recording Service Berjalan
```bash
# Cek backend logs untuk recording service
pm2 logs rafnet-cctv-backend | grep -i recording

# Expected output jika service berjalan:
# [Recording] Initializing recording service...
# [Recording] Recording service initialized
# [Recording] Resuming recordings for X cameras...
```

### 2.3 Cek MediaMTX Recording Configuration
```bash
# Cek apakah MediaMTX support recording
curl http://localhost:9997/v3/config/global/get | jq '.record'

# Expected: true

# Cek path configuration untuk camera yang recording
curl http://localhost:9997/v3/config/paths/list | jq '.items[] | select(.record == true)'
```

### 2.4 Cek Recordings Directory
```bash
# Cek apakah directory recordings ada
ls -la /var/www/rafnet-cctv/recordings/

# Cek apakah ada file recording
find /var/www/rafnet-cctv/recordings -name "*.mp4" -mtime -1

# Cek disk space
df -h /var/www/rafnet-cctv/recordings
```

## 3. MASALAH AKTUAL: NETWORK CONNECTIVITY

### 3.1 Test Koneksi ke Kamera
```bash
# Test ping ke kamera
ping -c 3 192.168.13.3

# Test RTSP port
nc -zv 192.168.13.3 554

# Test RTSP stream dengan FFmpeg
ffmpeg -rtsp_transport tcp -i "rtsp://admin:aldivarama123@192.168.13.3:554/stream1" -t 5 -f null -

# Jika gagal, coba dengan ffprobe
ffprobe -rtsp_transport tcp "rtsp://admin:aldivarama123@192.168.13.3:554/stream1"
```

### 3.2 Kemungkinan Penyebab "No Route to Host"

**A. Kamera Offline/Mati**
- Kamera tidak terhubung ke network
- Kamera mati atau restart
- Solusi: Cek fisik kamera, pastikan power dan network cable terpasang

**B. IP Address Berubah**
- Kamera mendapat IP baru dari DHCP
- Solusi: Set static IP di kamera atau update RTSP URL di database

**C. Network Segmentation**
- Server dan kamera di subnet berbeda tanpa routing
- Solusi: Pastikan server bisa reach subnet kamera

**D. Firewall Blocking**
- Firewall di server atau kamera blocking port 554
- Solusi: Allow port 554 (RTSP) di firewall

## 4. SOLUSI PRAKTIS

### 4.1 Identifikasi Kamera yang Bermasalah
```bash
# Query database untuk camera 9
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
SELECT id, name, private_rtsp_url, enable_recording, is_recording, enabled 
FROM cameras 
WHERE id = 9
"

# Test koneksi ke kamera tersebut
# Extract IP dari RTSP URL dan test
```

### 4.2 Disable Recording untuk Kamera Bermasalah
```bash
# Sementara disable recording untuk camera yang error
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
UPDATE cameras 
SET enable_recording = 0, is_recording = 0 
WHERE id = 9
"

# Restart backend untuk apply changes
pm2 restart rafnet-cctv-backend
```

### 4.3 Test Recording dengan Kamera yang Online
```bash
# Cek kamera mana yang online dan bisa di-record
# 1. List semua kamera
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
SELECT id, name, private_rtsp_url, enabled 
FROM cameras 
WHERE enabled = 1
"

# 2. Test RTSP connection untuk setiap kamera
# Contoh untuk camera 1:
ffprobe -rtsp_transport tcp "rtsp://[RTSP_URL_CAMERA_1]"

# 3. Enable recording untuk kamera yang online
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
UPDATE cameras 
SET enable_recording = 1 
WHERE id = [CAMERA_ID_YANG_ONLINE]
"

# 4. Restart backend
pm2 restart rafnet-cctv-backend

# 5. Monitor logs
pm2 logs rafnet-cctv-backend --lines 50 | grep -i recording
```


## 5. KEMUNGKINAN MASALAH LAIN

### 5.1 Recording Service Belum Diimplementasikan
**Cek:** Apakah file `backend/services/recordingService.js` ada?

```bash
ls -la /var/www/rafnet-cctv/backend/services/recordingService.js
```

**Jika file tidak ada**, recording service belum diimplementasikan. Ini normal karena:
- Analisa recording-playback baru selesai dibuat
- Implementasi belum dilakukan
- Yang terlihat di log adalah **MediaMTX mencoba record** bukan recording service kita

### 5.2 MediaMTX Auto-Recording
MediaMTX mungkin sudah dikonfigurasi untuk auto-record semua path.

**Cek MediaMTX config:**
```bash
cat /var/www/rafnet-cctv/mediamtx/mediamtx.yml | grep -A 5 "record"
```

**Jika ada:**
```yaml
record: yes
recordPath: /path/to/recordings/%path/%Y-%m-%d_%H-%M-%S
```

Maka MediaMTX **sudah mencoba record** tapi gagal karena kamera offline.

### 5.3 Recordings Table Belum Ada
**Cek apakah table recordings ada:**
```bash
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
SELECT name FROM sqlite_master WHERE type='table' AND name='recordings'
"
```

**Jika tidak ada**, table belum dibuat. Recording service belum diimplementasikan.

## 6. KESIMPULAN & REKOMENDASI

### 6.1 Status Saat Ini
Berdasarkan log error:
- ✅ MediaMTX **SUDAH** mencoba melakukan recording
- ❌ Recording **GAGAL** karena kamera tidak reachable
- ❓ Recording service custom (recordingService.js) **BELUM** diimplementasikan
- ❓ Database table `recordings` **BELUM** ada

### 6.2 Dua Skenario Berbeda

**Skenario A: MediaMTX Auto-Recording (Sudah Aktif)**
- MediaMTX config sudah set `record: yes`
- MediaMTX otomatis record semua stream
- Gagal karena kamera offline
- **Solusi:** Fix network connectivity ke kamera

**Skenario B: Custom Recording Service (Belum Implementasi)**
- Recording service belum dibuat
- Table recordings belum ada
- Perlu implementasi sesuai analisa
- **Solusi:** Implementasi recording service

### 6.3 Langkah Selanjutnya

**PRIORITAS 1: Identifikasi Skenario**
```bash
# Cek MediaMTX config
cat /var/www/rafnet-cctv/mediamtx/mediamtx.yml | grep -i record

# Cek recording service
ls -la /var/www/rafnet-cctv/backend/services/recordingService.js

# Cek recordings table
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db ".schema recordings"
```

**PRIORITAS 2: Fix Network Issue (Jika Skenario A)**
```bash
# Test koneksi ke semua kamera
for i in {1..10}; do
  echo "Testing camera $i..."
  sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
    SELECT id, name, private_rtsp_url FROM cameras WHERE id = $i
  " | while read line; do
    echo "$line"
  done
done

# Disable recording untuk kamera offline
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
UPDATE cameras SET enable_recording = 0 WHERE id IN (
  SELECT id FROM cameras WHERE private_rtsp_url LIKE '%192.168.13.3%'
)
"
```

**PRIORITAS 3: Implementasi Recording Service (Jika Skenario B)**
- Ikuti roadmap di `recording-playback-analysis.md`
- Mulai dari Phase 1: Database & Backend Core
- Estimasi: 12-19 hari untuk full implementation

## 7. QUICK FIX - DISABLE PROBLEMATIC CAMERAS

Untuk menghentikan error log sementara:

```bash
# Login ke server
ssh root@172.17.11.12

# Disable recording untuk camera 9 (yang error)
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
UPDATE cameras 
SET enable_recording = 0, is_recording = 0 
WHERE id = 9
"

# Atau disable semua recording sementara
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "
UPDATE cameras 
SET enable_recording = 0, is_recording = 0
"

# Restart backend
pm2 restart rafnet-cctv-backend

# Monitor logs - error seharusnya hilang
pm2 logs rafnet-cctv-backend --lines 20
```

## 8. NEXT STEPS

1. **Identifikasi skenario** (A atau B)
2. **Jika Skenario A**: Fix network connectivity
3. **Jika Skenario B**: Mulai implementasi recording service
4. **Test dengan 1 kamera online** terlebih dahulu
5. **Scale ke semua kamera** setelah berhasil

---

**Catatan Penting:**
Error "No route to host" adalah **masalah network**, bukan masalah kode. Recording system sudah mencoba berjalan tapi gagal karena tidak bisa connect ke kamera.
