# 🎯 Monetag Implementation Guide - Popunder + Native Banner

## ✅ Implementasi Selesai!

Sistem monetisasi Monetag dengan kombinasi **Popunder + Native Banner** sudah selesai diimplementasikan dengan strategi optimal:

1. **Popunder** - Background revenue (tidak terlihat, tidak mengganggu)
2. **Native Banner** - Muncul HANYA saat video play (di bawah video)
3. **Clean UI** - Saat tidak ada video play, halaman tetap bersih

---

## 🎨 Strategi Implementasi

### 1. Popunder (Background Revenue)
- **Lokasi**: Load di background saat user pertama kali buka website
- **Frekuensi**: 1x per user per 24 jam
- **CPM**: $3-8 (tertinggi)
- **UX Impact**: TIDAK MENGGANGGU (tab muncul di belakang)

### 2. Native Banner (Conditional Display)
- **Lokasi**: Di bawah video player (modal/popup)
- **Kondisi**: Muncul HANYA saat video sedang play (status === 'live')
- **Hidden**: Saat fullscreen, loading, error, atau offline
- **CPM**: $1-3
- **UX Impact**: MINIMAL (hanya muncul saat user fokus nonton)

---

## 📁 File yang Dimodifikasi

### 1. `frontend/src/components/MonetagAds.jsx`
**Perubahan:**
```javascript
nativeBanner: {
    enabled: true,  // ← ENABLED (sebelumnya false)
    zoneId: 'YOUR_NATIVE_ZONE_ID',
},
```

### 2. `frontend/src/components/MonetagVideoAd.jsx` (NEW)
**Component baru** untuk Native Banner yang conditional:
- Hanya render saat `isPlaying === true`
- Auto-load Monetag script saat video play
- Auto-cleanup saat video stop
- Support 3 ukuran: small (300x250), medium (468x60), large (728x90)

### 3. `frontend/src/pages/LandingPage.jsx`
**Perubahan:**
- Import `MonetagVideoAd`
- Tambah Native Banner di VideoPopup footer
- Kondisi: `{status === 'live' && !isFullscreen && ...}`

---

## 🎯 Cara Kerja

### Skenario 1: User Buka Website (Landing Page)
```
User buka https://cctv.raf.my.id
         ↓
Popunder load di background (1x per 24 jam)
         ↓
User lihat grid kamera (CLEAN, tidak ada iklan terlihat)
         ↓
User klik kamera untuk play
         ↓
Modal video muncul
         ↓
Video mulai play (status === 'live')
         ↓
Native Banner muncul di bawah video ✅
```

### Skenario 2: Video Loading/Error
```
User klik kamera
         ↓
Modal video muncul
         ↓
Video loading... (status === 'connecting')
         ↓
Native Banner TIDAK muncul (halaman tetap clean)
         ↓
Video berhasil play (status === 'live')
         ↓
Native Banner muncul ✅
```

### Skenario 3: Fullscreen Mode
```
User play video
         ↓
Native Banner muncul di bawah video
         ↓
User klik fullscreen
         ↓
Native Banner HIDDEN (fullscreen mode)
         ↓
User exit fullscreen
         ↓
Native Banner muncul lagi ✅
```

---

## 🚀 Setup Instructions

### Step 1: Daftar Monetag & Buat Zones (10 menit)

#### 1.1 Daftar Monetag
```
1. Buka: https://www.monetag.com/
2. Sign Up → Publisher
3. Verify email
4. Login
```

#### 1.2 Tambahkan Website
```
Dashboard → Websites → Add Website
- URL: https://cctv.raf.my.id
- Category: Technology
Submit → APPROVED INSTANT!
```

#### 1.3 Buat Popunder Zone
```
Dashboard → Ad Zones → Create Zone
- Format: Popunder
- Name: RAF NET CCTV - Popunder
- Website: cctv.raf.my.id
- Frequency: 1 per 24 hours
Create → COPY ZONE ID (contoh: 8360606)
```

#### 1.4 Buat Native Banner Zone
```
Dashboard → Ad Zones → Create Zone
- Format: Native Banner
- Name: RAF NET CCTV - Video Banner
- Website: cctv.raf.my.id
- Size: 728x90 (Leaderboard)
Create → COPY ZONE ID (contoh: 8360607)
```

---

### Step 2: Update Zone IDs di Kode (2 menit)

#### 2.1 Update MonetagAds.jsx
File: `frontend/src/components/MonetagAds.jsx` (line ~20)

**SEBELUM:**
```javascript
const MONETAG_CONFIG = {
    popunder: {
        enabled: true,
        zoneId: 'YOUR_POPUNDER_ZONE_ID', // ← GANTI INI!
    },
    nativeBanner: {
        enabled: true,
        zoneId: 'YOUR_NATIVE_ZONE_ID', // ← GANTI INI!
    },
```

**SESUDAH:**
```javascript
const MONETAG_CONFIG = {
    popunder: {
        enabled: true,
        zoneId: '8360606', // ← Zone ID Popunder dari Monetag
    },
    nativeBanner: {
        enabled: true,
        zoneId: '8360607', // ← Zone ID Native Banner dari Monetag
    },
```

#### 2.2 Update MonetagVideoAd.jsx
File: `frontend/src/components/MonetagVideoAd.jsx` (line ~15)

**SEBELUM:**
```javascript
const MONETAG_CONFIG = {
    nativeBanner: {
        enabled: true,
        zoneId: 'YOUR_NATIVE_ZONE_ID', // ← GANTI INI!
    }
};
```

**SESUDAH:**
```javascript
const MONETAG_CONFIG = {
    nativeBanner: {
        enabled: true,
        zoneId: '8360607', // ← Zone ID Native Banner (SAMA dengan MonetagAds.jsx)
    }
};
```

**⚠️ PENTING:** Zone ID Native Banner harus SAMA di kedua file!

---

### Step 3: Build & Deploy (5 menit)

#### 3.1 Build Frontend
```bash
cd frontend
npm run build
```

Output:
```
✓ built in 15s
dist/index.html                   2.5 kB
dist/assets/index-abc123.js       450 kB
```

#### 3.2 Commit & Push
```bash
git add .
git commit -m "Feature: Monetag Popunder + Native Banner - Optimal monetization strategy"
git push origin main
```

#### 3.3 Deploy ke Server
```bash
# SSH ke server
ssh root@172.17.11.12

# Pull changes
cd /var/www/rafnet-cctv
git pull origin main

# Build frontend
cd frontend
npm run build

# Restart Nginx (optional)
systemctl restart nginx
```

---

## 🧪 Testing

### Test 1: Popunder
```
1. Buka: https://cctv.raf.my.id
2. Klik di mana saja di halaman (klik pertama)
3. ✅ Tab baru muncul DI BELAKANG
4. Anda tetap lihat website CCTV
5. Close tab utama → tab iklan terlihat
```

**CATATAN:** Popunder hanya muncul 1x per 24 jam per user!

### Test 2: Native Banner
```
1. Buka: https://cctv.raf.my.id
2. Klik salah satu kamera
3. Modal video muncul
4. Tunggu video play (status LIVE)
5. ✅ Native Banner muncul di bawah video
6. Klik fullscreen
7. ✅ Native Banner HIDDEN
8. Exit fullscreen
9. ✅ Native Banner muncul lagi
```

### Test 3: Clean UI
```
1. Buka: https://cctv.raf.my.id
2. ✅ Halaman grid kamera CLEAN (tidak ada iklan terlihat)
3. Klik kamera
4. Video loading...
5. ✅ Native Banner TIDAK muncul (halaman tetap clean)
6. Video play
7. ✅ Native Banner baru muncul
```

---

## 💰 Estimasi Pendapatan

### Formula
```
Total Revenue = Popunder Revenue + Native Banner Revenue
```

### Popunder Revenue
```
Traffic 1.000 views/hari:
1.000 × 30 hari = 30.000 views/bulan
30.000 / 1.000 × $5 CPM = $150/bulan
$150 × Rp 15.000 = Rp 2.250.000/bulan
```

### Native Banner Revenue
```
Asumsi: 30% user klik kamera dan play video
1.000 views/hari × 30% = 300 video plays/hari
300 × 30 hari = 9.000 video plays/bulan
9.000 / 1.000 × $2 CPM = $18/bulan
$18 × Rp 15.000 = Rp 270.000/bulan
```

### Total Revenue
| Traffic/Hari | Popunder | Native Banner | Total/Bulan | IDR (Rp 15.000) |
|--------------|----------|---------------|-------------|-----------------|
| 1.000 | $150 | $18 | $168 | **Rp 2.520.000** |
| 2.500 | $375 | $45 | $420 | **Rp 6.300.000** |
| 5.000 | $750 | $90 | $840 | **Rp 12.600.000** |
| 7.500 | $1.125 | $135 | $1.260 | **Rp 18.900.000** |
| 10.000 | $1.500 | $180 | $1.680 | **Rp 25.200.000** |

**Asumsi:**
- Popunder CPM: $5
- Native Banner CPM: $2
- Video play rate: 30% dari total traffic
- 1 USD = Rp 15.000

---

## 📊 Monitor Earnings

### Dashboard Monetag
```
Login: https://www.monetag.com/
Dashboard → Statistics
```

### Metrics Penting

#### Popunder Metrics
- **Impressions**: Jumlah popunder yang muncul
- **CPM**: Cost per 1000 impressions ($3-8)
- **Fill Rate**: Persentase iklan terisi (target >90%)
- **Revenue**: Pendapatan harian

#### Native Banner Metrics
- **Impressions**: Jumlah banner yang muncul (saat video play)
- **CPM**: Cost per 1000 impressions ($1-3)
- **Fill Rate**: Persentase iklan terisi (target >90%)
- **Revenue**: Pendapatan harian

### Expected Metrics (1.000 views/hari)
```
Popunder:
- Impressions: ~1.000/hari
- CPM: $5
- Revenue: $5/hari = $150/bulan

Native Banner:
- Impressions: ~300/hari (30% play rate)
- CPM: $2
- Revenue: $0.60/hari = $18/bulan

Total: $168/bulan = Rp 2.520.000
```

---

## 🎯 Optimasi Tips

### 1. Increase Traffic
- Share link di social media
- SEO optimization
- Telegram group/channel
- WhatsApp broadcast
- Kolaborasi dengan RT/RW

### 2. Increase Video Play Rate
- Thumbnail yang menarik
- Deskripsi kamera yang jelas
- Lokasi yang spesifik
- Status LIVE yang jelas

### 3. Monitor & Optimize
- Check CPM setiap minggu
- Monitor fill rate (target >90%)
- Track video play rate
- A/B test banner placement

### 4. User Experience
- Jangan tambah iklan lain yang mengganggu
- Popunder + Native Banner sudah optimal
- User experience tetap prioritas
- Monitor user feedback

---

## ❓ FAQ

### Q: Native Banner tidak muncul?
**A:**
1. Check Zone ID sudah benar di kedua file (MonetagAds.jsx dan MonetagVideoAd.jsx)
2. Pastikan video sudah play (status === 'live')
3. Pastikan tidak dalam fullscreen mode
4. Check browser console untuk error
5. Test tanpa ad blocker

### Q: Native Banner muncul saat loading?
**A:** Tidak seharusnya. Native Banner hanya muncul saat `status === 'live'`. Check implementasi di LandingPage.jsx.

### Q: Popunder tidak muncul?
**A:**
1. Check Zone ID Popunder sudah benar
2. Test tanpa ad blocker
3. Clear cookies dan test lagi
4. Popunder hanya 1x per 24 jam per user

### Q: CPM rendah?
**A:**
- Normal untuk Indonesia: Popunder $3-8, Native $1-3
- US/Europe bisa lebih tinggi
- Increase traffic untuk increase revenue

### Q: Bisa tambah iklan lain?
**A:**
- Bisa, tapi tidak recommended
- Popunder + Native Banner sudah optimal
- Terlalu banyak iklan = user complain

---

## 🐛 Troubleshooting

### Error: Zone ID not configured

**Problem:**
```javascript
zoneId: 'YOUR_POPUNDER_ZONE_ID' // ← Belum diganti!
```

**Solution:**
```javascript
zoneId: '8360606' // ← Ganti dengan Zone ID dari Monetag
```

### Error: Native Banner tidak load

**Check:**
1. Zone ID sama di MonetagAds.jsx dan MonetagVideoAd.jsx?
2. Video sudah play (status === 'live')?
3. Tidak dalam fullscreen mode?
4. Browser console ada error?

**Solution:**
```bash
# Rebuild dan redeploy
cd frontend
npm run build
# Upload ke server
```

### Error: No impressions di dashboard

**Possible causes:**
1. Website belum ada traffic
2. Zone ID salah
3. Ad blocker block semua user
4. Implementation error

**Solution:**
1. Check traffic di Google Analytics
2. Verify Zone ID di Monetag dashboard
3. Test tanpa ad blocker
4. Check browser console

---

## ✅ Checklist Deployment

### Pre-Deployment (SUDAH SELESAI)
- [x] Component MonetagAds.jsx updated (native banner enabled)
- [x] Component MonetagVideoAd.jsx created
- [x] LandingPage.jsx updated (import + integration)
- [x] Dokumentasi lengkap
- [x] Git commit & push

### Deployment (YANG HARUS ANDA LAKUKAN)
- [ ] Daftar Monetag
- [ ] Tambahkan website
- [ ] Buat Popunder zone → Copy Zone ID
- [ ] Buat Native Banner zone → Copy Zone ID
- [ ] Update Zone IDs di MonetagAds.jsx
- [ ] Update Zone ID di MonetagVideoAd.jsx
- [ ] Build frontend (`npm run build`)
- [ ] Deploy ke production
- [ ] Test popunder functionality
- [ ] Test native banner functionality
- [ ] Monitor earnings di dashboard

### Post-Deployment
- [ ] Setup payment method (PayPal/Payoneer)
- [ ] Monitor CPM dan fill rate
- [ ] Track video play rate
- [ ] Optimize traffic untuk increase revenue

---

## 🎉 Summary

### ✅ Yang Sudah Selesai:
- Implementasi Popunder (background revenue)
- Implementasi Native Banner (conditional display)
- Clean UI strategy (iklan hanya muncul saat video play)
- Dokumentasi lengkap
- Git commit & push

### 🚀 Yang Harus Anda Lakukan:
- Daftar Monetag (5 menit)
- Buat 2 zones: Popunder + Native Banner (5 menit)
- Update Zone IDs di 2 file (2 menit)
- Build & deploy (5 menit)
- Test & monitor (ongoing)

### 💰 Expected Revenue:
- 1.000 views/hari: **Rp 2.520.000/bulan**
- 5.000 views/hari: **Rp 12.600.000/bulan**
- 10.000 views/hari: **Rp 25.200.000/bulan**

---

**Status:** ✅ READY TO DEPLOY

**Strategy:** Optimal (Popunder + Native Banner conditional)

**UX Impact:** Minimal (clean UI, iklan hanya saat video play)

**Good luck! 💰🚀**
