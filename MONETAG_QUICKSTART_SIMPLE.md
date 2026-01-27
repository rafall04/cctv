# 🚀 Quick Start: Monetag Popunder (Paling Mudah!)

## ⏱️ Total Waktu: 10 Menit

Panduan ini fokus ke **Popunder** saja - jenis iklan paling mudah dan paling menguntungkan dari Monetag.

---

## ✅ Keuntungan Popunder

1. **TIDAK BUTUH TEMPAT KHUSUS** - Tidak perlu ubah design website
2. **TIDAK MENGGANGGU USER** - Tab muncul di belakang, user tetap lihat website Anda
3. **CPM TERTINGGI** - $3-8 per 1000 views (Indonesia)
4. **SETUP PALING MUDAH** - Hanya 3 langkah!
5. **TIDAK PERLU SERVICE WORKER** - Tidak perlu upload sw.js

---

## 📋 Langkah 1: Daftar Monetag (3 Menit)

### 1.1 Buat Akun
```
1. Buka: https://www.monetag.com/
2. Klik "Sign Up" (pojok kanan atas)
3. Pilih "Publisher"
4. Isi form:
   - Email: email@anda.com
   - Password: (buat password kuat)
   - Country: Indonesia
5. Verify email
```

### 1.2 Tambahkan Website
```
1. Login ke dashboard
2. Klik "Websites" di sidebar
3. Klik "Add Website"
4. Isi:
   - Website URL: https://cctv.raf.my.id
   - Category: Technology
5. Klik "Add Website"
6. ✅ APPROVED INSTANT!
```

---

## 📋 Langkah 2: Buat Popunder Zone (2 Menit)

```
1. Dashboard → "Ad Zones" → "Create Zone"
2. Pilih format: "Popunder"
3. Settings:
   - Name: RAF NET CCTV - Popunder
   - Website: cctv.raf.my.id
   - Frequency: 1 per 24 hours (default)
4. Klik "Create"
5. ✅ ZONE CREATED!
```

### Copy Zone ID

Setelah zone dibuat, Anda akan lihat:
```
Zone ID: 8360606  ← COPY INI!
```

**PENTING:** Simpan Zone ID ini, Anda akan butuh di langkah berikutnya.

---

## 📋 Langkah 3: Update Kode (5 Menit)

### 3.1 Edit MonetagAds.jsx

Buka file: `frontend/src/components/MonetagAds.jsx`

Cari bagian ini (sekitar line 20):
```javascript
const MONETAG_CONFIG = {
    popunder: {
        enabled: true,
        zoneId: 'YOUR_POPUNDER_ZONE_ID', // ← GANTI INI!
    },
```

Ganti dengan Zone ID Anda:
```javascript
const MONETAG_CONFIG = {
    popunder: {
        enabled: true,
        zoneId: '8360606', // ← Zone ID dari Monetag
    },
```

**Save file!**

### 3.2 Verify Implementasi

Buka file: `frontend/src/pages/LandingPage.jsx`

Pastikan ada baris ini (sekitar line 3550):
```javascript
import { MonetagPopunder } from '../components/MonetagAds';

// ...

function LandingPage() {
    return (
        <div>
            {/* ... */}
            <MonetagPopunder /> {/* ← Harus ada ini! */}
            {/* ... */}
        </div>
    );
}
```

Jika belum ada, tambahkan `<MonetagPopunder />` di dalam return statement.

**Save file!**

---

## 📋 Langkah 4: Build & Deploy (5 Menit)

### 4.1 Build Frontend

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

### 4.2 Deploy ke Production

#### Option A: Via Git (Recommended)

```bash
# Commit changes
git add .
git commit -m "Add Monetag popunder ads"
git push origin main

# SSH ke server
ssh root@172.17.11.12

# Pull changes
cd /var/www/rafnet-cctv
git pull origin main

# Build frontend
cd frontend
npm run build

# Done!
```

#### Option B: Manual Upload

```bash
# Upload dist folder ke server via SCP/FTP
# Target: /var/www/rafnet-cctv/frontend/dist/
```

---

## 🧪 Testing (2 Menit)

### Test 1: Buka Website

```
1. Buka: https://cctv.raf.my.id
2. Klik di mana saja di halaman (klik pertama)
3. Tab baru akan muncul DI BELAKANG
4. Anda tetap lihat website CCTV
5. Close tab utama → tab iklan baru terlihat
```

**CATATAN:** Popunder hanya muncul 1x per 24 jam per user!

### Test 2: Check Console

```
1. Buka website
2. Tekan F12 (Developer Tools)
3. Tab "Console"
4. Lihat log:
   [Monetag] Popunder loaded
```

Jika ada error, check:
- Zone ID sudah benar?
- File MonetagAds.jsx sudah di-save?
- Build sudah di-deploy?

---

## 📊 Monitor Earnings

### Dashboard Monetag

```
1. Login: https://www.monetag.com/
2. Dashboard → "Statistics"
3. Lihat:
   - Impressions: Jumlah views hari ini
   - CPM: Cost per 1000 impressions
   - Revenue: Pendapatan hari ini
   - Estimated: Estimasi bulan ini
```

### Metrics Penting

| Metric | Target | Keterangan |
|--------|--------|------------|
| **Impressions** | Naik setiap hari | Jumlah popunder yang muncul |
| **CPM** | $3-8 | Cost per 1000 impressions (Indonesia) |
| **Fill Rate** | >90% | Persentase iklan yang terisi |
| **Revenue** | Sesuai traffic | Pendapatan harian |

### Estimasi Pendapatan

```
Traffic 1.000 views/hari:
1.000 × 30 hari = 30.000 views/bulan
30.000 / 1.000 × $5 CPM = $150/bulan
$150 × Rp 15.000 = Rp 2.250.000/bulan

Traffic 5.000 views/hari:
5.000 × 30 hari = 150.000 views/bulan
150.000 / 1.000 × $5 CPM = $750/bulan
$750 × Rp 15.000 = Rp 11.250.000/bulan

Traffic 10.000 views/hari:
10.000 × 30 hari = 300.000 views/bulan
300.000 / 1.000 × $6 CPM = $1.800/bulan
$1.800 × Rp 15.000 = Rp 27.000.000/bulan
```

---

## 💰 Payment

### Schedule
- **Payment Date:** Tanggal 1 setiap bulan
- **Minimum Payout:** $5
- **Payment Method:** PayPal, Payoneer, Bitcoin, Wire Transfer
- **Processing Time:** 1-3 hari kerja

### Setup Payment

```
1. Dashboard → "Settings" → "Payment"
2. Pilih payment method (PayPal recommended)
3. Isi payment details
4. Save
```

---

## 🎯 Tips Optimasi

### 1. Increase Traffic

Lebih banyak traffic = lebih banyak revenue!

**Cara:**
- Share link di social media
- SEO optimization
- Telegram group/channel
- WhatsApp broadcast
- Kolaborasi dengan RT/RW

### 2. Monitor CPM

Check CPM setiap minggu:
- CPM naik? Good! Keep going
- CPM turun? Check fill rate atau contact support

### 3. User Experience

Jangan tambah iklan lain yang mengganggu:
- Popunder sudah cukup
- Jangan tambah popup
- Jangan tambah redirect
- User experience tetap prioritas

### 4. Test Different Times

CPM bisa beda-beda tergantung waktu:
- Weekday vs Weekend
- Pagi vs Siang vs Malam
- Monitor dan optimize

---

## ❓ FAQ

### Q: Popunder tidak muncul?
**A:** 
- Check Zone ID sudah benar
- Test tanpa ad blocker
- Clear cookies dan test lagi
- Popunder hanya 1x per 24 jam per user

### Q: CPM rendah?
**A:**
- Normal untuk Indonesia: $3-8
- US/Europe bisa $10-20
- Increase traffic untuk increase revenue

### Q: Kapan dapat bayaran?
**A:**
- Tanggal 1 setiap bulan
- Minimum $5
- Processing 1-3 hari kerja

### Q: Bisa tambah iklan lain?
**A:**
- Bisa, tapi tidak recommended
- Popunder sudah optimal
- Terlalu banyak iklan = user complain

### Q: User complain?
**A:**
- Popunder tidak mengganggu (di belakang)
- Hanya 1x per 24 jam
- Jika banyak complain, check implementasi

---

## 🐛 Troubleshooting

### Error: Zone ID not configured

**Problem:**
```javascript
zoneId: 'YOUR_POPUNDER_ZONE_ID' // ← Belum diganti!
```

**Solution:**
```javascript
zoneId: '8360606' // ← Ganti dengan Zone ID Anda
```

### Error: Popunder not loading

**Check:**
1. Zone ID sudah benar?
2. File sudah di-save?
3. Build sudah di-deploy?
4. Browser console ada error?

**Solution:**
```bash
# Rebuild dan redeploy
cd frontend
npm run build
# Upload ke server
```

### Error: No impressions in dashboard

**Possible causes:**
1. Website belum ada traffic
2. Zone ID salah
3. Ad blocker block semua user
4. Implementation error

**Solution:**
1. Check traffic di Google Analytics
2. Verify Zone ID di dashboard Monetag
3. Test tanpa ad blocker
4. Check browser console

---

## ✅ Checklist

- [ ] Daftar Monetag
- [ ] Tambahkan website
- [ ] Buat Popunder zone
- [ ] Copy Zone ID
- [ ] Update MonetagAds.jsx dengan Zone ID
- [ ] Verify LandingPage.jsx ada `<MonetagPopunder />`
- [ ] Build frontend
- [ ] Deploy ke production
- [ ] Test: klik website, popunder muncul
- [ ] Monitor earnings di dashboard
- [ ] Setup payment method

---

## 🎉 Selesai!

Selamat! Anda sudah setup Monetag Popunder dengan benar.

**Next Steps:**
1. Monitor earnings setiap hari
2. Increase traffic untuk increase revenue
3. Jika sudah jalan lancar, bisa tambah Native Banner (optional)
4. Withdraw pertama saat reach $5!

**Questions?**
- Monetag Support: support@monetag.com
- Monetag Dashboard: https://www.monetag.com/

**Good luck! 💰🚀**
