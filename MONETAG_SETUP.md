# 🚀 Setup Monetag untuk RAF NET CCTV

## Tentang Monetag

Monetag (sebelumnya PropellerAds/PopCash) adalah ad network dengan CPM tertinggi untuk traffic Indonesia:
- **CPM:** $3-8 per 1000 views
- **Approval:** Instant
- **Minimum Payout:** $5
- **Payment:** PayPal, Payoneer, Bitcoin, Wire Transfer
- **Payment Schedule:** NET 30 (dibayar setiap tanggal 1)

---

## 📋 Langkah 1: Daftar Monetag (5 Menit)

### 1.1 Buat Akun
1. Kunjungi: https://www.monetag.com/
2. Klik **Sign Up** (pojok kanan atas)
3. Pilih **Publisher** (bukan Advertiser)
4. Isi form:
   - Email
   - Password
   - Country: Indonesia
   - Payment method: PayPal (atau pilihan lain)
5. Verify email

### 1.2 Tambahkan Website
1. Login ke dashboard Monetag
2. Klik **Websites** di sidebar
3. Klik **Add Website**
4. Isi data:
   - **Website URL:** https://cctv.raf.my.id (atau subdomain Anda)
   - **Category:** Technology / Security
   - **Traffic:** Pilih yang sesuai (misal: 1000-5000 daily visitors)
5. Klik **Add Website**
6. **Approval:** Instant! Website langsung approved

---

## 📋 Langkah 2: Buat Ad Zones (10 Menit)

### 2.1 Popunder Zone (RECOMMENDED - CPM Tertinggi)

**Apa itu Popunder?**
- Tab baru yang muncul di belakang tab aktif
- User tidak terganggu (baru terlihat saat close tab)
- Muncul 1x per user per 24 jam
- CPM tertinggi: $3-8

**Cara Buat:**
1. Dashboard → **Ad Zones** → **Create Zone**
2. Pilih format: **Popunder**
3. Settings:
   - **Name:** RAF NET CCTV - Popunder
   - **Website:** Pilih website Anda
   - **Frequency:** 1 per 24 hours (default)
   - **Categories:** Allow all (atau filter jika perlu)
4. Klik **Create**
5. **Copy Zone ID** (contoh: 8360606)

### 2.2 Native Banner Zone (OPTIONAL)

**Apa itu Native Banner?**
- Iklan yang blend dengan konten website
- Tidak mengganggu UX
- CPM sedang: $1-3

**Cara Buat:**
1. Dashboard → **Ad Zones** → **Create Zone**
2. Pilih format: **Native Banner**
3. Settings:
   - **Name:** RAF NET CCTV - Native Banner
   - **Website:** Pilih website Anda
   - **Size:** 300x250 (Medium Rectangle)
4. Klik **Create**
5. **Copy Zone ID**

### 2.3 Push Notifications Zone (OPTIONAL)

**Apa itu Push Notifications?**
- Notifikasi browser yang muncul di desktop/mobile
- User harus opt-in (allow notifications)
- CPM tinggi: $2-5

**Cara Buat:**
1. Dashboard → **Ad Zones** → **Create Zone**
2. Pilih format: **Push Notifications**
3. Settings:
   - **Name:** RAF NET CCTV - Push
   - **Website:** Pilih website Anda
4. Klik **Create**
5. **Copy Zone ID**

---

## 📋 Langkah 3: Update Kode (5 Menit)

### 3.1 Update MonetagAds.jsx

Edit file `frontend/src/components/MonetagAds.jsx`:

```javascript
const MONETAG_CONFIG = {
    // Popunder - WAJIB (CPM tertinggi)
    popunder: {
        enabled: true,
        zoneId: '8360606', // ← Ganti dengan Zone ID Anda
    },
    
    // Native Banner - OPTIONAL
    nativeBanner: {
        enabled: true, // Set false jika tidak digunakan
        zoneId: '8360607', // ← Ganti dengan Zone ID Anda
    },
    
    // Direct Link - OPTIONAL
    directLink: {
        enabled: false, // Set true jika ingin gunakan
        zoneId: 'YOUR_DIRECT_LINK_ZONE_ID',
    },
    
    // Push Notifications - OPTIONAL
    pushNotifications: {
        enabled: true, // Set false jika tidak digunakan
        zoneId: '8360609', // ← Ganti dengan Zone ID Anda
        swPath: '/sw.js',
    },
    
    // Social Bar - OPTIONAL
    socialBar: {
        enabled: false, // Set true jika ingin gunakan
        zoneId: 'YOUR_SOCIAL_BAR_ZONE_ID',
    }
};
```

### 3.2 Update Service Worker (Jika Pakai Push Notifications)

Edit file `frontend/public/sw.js`:

```javascript
const MONETAG_TOKEN = 'YOUR_MONETAG_TOKEN'; // ← Ganti dengan token dari dashboard
```

**Cara Dapatkan Token:**
1. Dashboard Monetag → **Push Notifications Zone**
2. Klik zone yang sudah dibuat
3. Copy **Token** dari code snippet

---

## 📋 Langkah 4: Implementasi di Landing Page (5 Menit)

### 4.1 Import Monetag Components

Edit `frontend/src/pages/LandingPage.jsx`:

```jsx
import { 
    MonetagAds, 
    MonetagNativeBanner, 
    MonetagBanner 
} from '../components/MonetagAds';

function LandingPage() {
    const [cameras, setCameras] = useState([]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900">
            {/* Monetag Popunder + Push (Load once) */}
            <MonetagAds />

            {/* Header */}
            <header>
                <h1>RAF NET CCTV</h1>
            </header>

            <main className="container mx-auto px-4 py-8">
                {/* Native Banner - Desktop Only */}
                <div className="hidden md:block mb-8">
                    <div className="bg-dark-800/50 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-xs text-gray-500 text-center mb-2">Advertisement</p>
                        <MonetagNativeBanner />
                    </div>
                </div>

                {/* Camera Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cameras.map((camera, index) => (
                        <>
                            {/* Camera Card */}
                            <CameraCard key={camera.id} camera={camera} />

                            {/* Inline Native Banner setiap 6 kamera */}
                            {(index + 1) % 6 === 0 && (
                                <div className="col-span-full my-4">
                                    <div className="bg-dark-800/50 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                                        <p className="text-xs text-gray-500 text-center mb-2">Advertisement</p>
                                        <MonetagNativeBanner />
                                    </div>
                                </div>
                            )}
                        </>
                    ))}
                </div>

                {/* Bottom Native Banner */}
                <div className="mt-8">
                    <div className="bg-dark-800/50 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-xs text-gray-500 text-center mb-2">Advertisement</p>
                        <MonetagNativeBanner />
                    </div>
                </div>
            </main>
        </div>
    );
}
```

---

## 📋 Langkah 5: Deploy ke Production (10 Menit)

### 5.1 Build Frontend

```bash
cd frontend
npm run build
```

### 5.2 Upload sw.js ke Production

**PENTING:** File `sw.js` harus di root domain, bukan di subfolder!

#### Option A: Manual Upload (Recommended)

```bash
# Di local machine
cd frontend/public

# Upload ke server via SCP
scp sw.js root@172.17.11.12:/var/www/rafnet-cctv/frontend/dist/

# Atau via FTP/SFTP menggunakan FileZilla
# Upload sw.js ke: /var/www/rafnet-cctv/frontend/dist/
```

#### Option B: Via SSH

```bash
# SSH ke server
ssh root@172.17.11.12

# Copy sw.js dari source ke dist
cd /var/www/rafnet-cctv
cp frontend/public/sw.js frontend/dist/

# Verify file exists
ls -la frontend/dist/sw.js
```

### 5.3 Verify sw.js Accessible

Test di browser:
```
https://cctv.raf.my.id/sw.js
```

Harus return file JavaScript, bukan 404!

### 5.4 Update Nginx (Jika Perlu)

Edit `/etc/nginx/sites-available/cctv`:

```nginx
server {
    listen 800;
    server_name cctv.raf.my.id;
    root /var/www/rafnet-cctv/frontend/dist;

    # Service Worker - MUST be served from root
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        add_header Service-Worker-Allowed "/";
        try_files $uri =404;
    }

    # ... rest of config
}
```

Restart Nginx:
```bash
nginx -t
systemctl restart nginx
```

### 5.5 Deploy Frontend

```bash
# Di server
cd /var/www/rafnet-cctv/frontend
npm run build

# Verify sw.js copied
ls -la dist/sw.js
```

---

## 📋 Langkah 6: Testing (5 Menit)

### 6.1 Test Popunder

1. Buka website: https://cctv.raf.my.id
2. Klik di mana saja di halaman
3. Popunder akan muncul di tab baru (di belakang)
4. **Note:** Hanya 1x per 24 jam per user

### 6.2 Test Push Notifications

1. Buka website
2. Browser akan minta permission untuk notifications
3. Klik **Allow**
4. Notification akan muncul setelah beberapa saat

### 6.3 Test Native Banner

1. Scroll halaman
2. Native banner akan muncul di posisi yang sudah ditentukan
3. Iklan akan blend dengan design website

### 6.4 Check Console

Buka browser console (F12):
```
[Monetag] Service Worker registered
[Monetag SW] Service Worker installing...
[Monetag SW] Service Worker activated
```

Jika ada error, check:
- Zone IDs sudah benar?
- sw.js accessible di root domain?
- Browser support service worker?

---

## 📊 Monitoring Earnings

### Dashboard Monetag

1. Login ke https://www.monetag.com/
2. Dashboard → **Statistics**
3. Lihat:
   - **Impressions:** Jumlah views
   - **CPM:** Cost per 1000 impressions
   - **Revenue:** Pendapatan hari ini
   - **Estimated Earnings:** Estimasi bulan ini

### Metrics Penting

- **Impressions:** Harus naik setiap hari
- **CPM:** $3-8 untuk popunder (Indonesia)
- **Fill Rate:** Harus >90%
- **CTR:** Tidak relevan untuk popunder

### Payment

- **Schedule:** NET 30 (dibayar tanggal 1 setiap bulan)
- **Minimum:** $5
- **Method:** PayPal, Payoneer, Bitcoin, Wire Transfer
- **Fee:** Tergantung payment method

---

## 🎯 Optimization Tips

### 1. Fokus ke Popunder

Popunder memberikan CPM tertinggi ($3-8) tanpa mengganggu UX. Prioritaskan ini!

### 2. Jangan Overload Ads

Terlalu banyak iklan akan:
- Menurunkan UX
- Meningkatkan bounce rate
- Menurunkan CPM

**Rekomendasi:**
- 1x Popunder per 24 jam ✅
- 2-3 Native Banner per page ✅
- Push Notifications (opt-in) ✅
- Social Bar (optional) ⚠️

### 3. Monitor Performance

Check setiap minggu:
- CPM trend (naik/turun?)
- Fill rate (>90%?)
- User complaints (terlalu banyak ads?)

### 4. A/B Testing

Test berbagai placement:
- Native banner di atas vs di bawah
- Inline ads setiap 6 vs 9 kamera
- Push notifications timing

---

## 🐛 Troubleshooting

### Popunder tidak muncul

**Penyebab:**
- Zone ID salah
- Ad blocker aktif
- Sudah muncul dalam 24 jam terakhir

**Solusi:**
- Verify zone ID di MonetagAds.jsx
- Test dengan browser lain / incognito
- Clear cookies dan test lagi

### Push Notifications tidak muncul

**Penyebab:**
- sw.js tidak accessible
- Browser tidak support
- User belum allow notifications

**Solusi:**
- Test https://cctv.raf.my.id/sw.js (harus return JS file)
- Check browser console untuk errors
- Test di Chrome/Firefox (support terbaik)

### Native Banner tidak load

**Penyebab:**
- Zone ID salah
- Ad blocker
- Network error

**Solusi:**
- Check zone ID
- Test tanpa ad blocker
- Check browser console

### CPM rendah

**Penyebab:**
- Traffic quality rendah
- Geo targeting (Indonesia CPM lebih rendah dari US)
- Fill rate rendah

**Solusi:**
- Increase traffic quality
- Enable all ad categories
- Contact Monetag support

---

## 📈 Estimasi Pendapatan

### Skenario 1: Traffic Rendah (1.000 views/hari)

**Popunder Only:**
- Impressions: 1.000/hari = 30.000/bulan
- CPM: $5 (average)
- Revenue: (30.000 / 1.000) × $5 = $150/bulan
- **IDR: Rp 2.250.000/bulan** (kurs Rp 15.000)

### Skenario 2: Traffic Sedang (5.000 views/hari)

**Popunder + Native Banner:**
- Popunder: 5.000 × $5 CPM = $25/hari
- Native: 5.000 × $2 CPM = $10/hari
- Total: $35/hari = $1.050/bulan
- **IDR: Rp 15.750.000/bulan**

### Skenario 3: Traffic Tinggi (10.000 views/hari)

**Popunder + Native + Push:**
- Popunder: 10.000 × $6 CPM = $60/hari
- Native: 10.000 × $2 CPM = $20/hari
- Push: 2.000 subscribers × $3 CPM = $6/hari
- Total: $86/hari = $2.580/bulan
- **IDR: Rp 38.700.000/bulan**

---

## ✅ Checklist Setup

- [ ] Daftar akun Monetag
- [ ] Tambahkan website
- [ ] Buat Popunder zone
- [ ] Buat Native Banner zone (optional)
- [ ] Buat Push Notifications zone (optional)
- [ ] Update MonetagAds.jsx dengan zone IDs
- [ ] Update sw.js dengan token (jika pakai push)
- [ ] Implementasi di LandingPage.jsx
- [ ] Build frontend
- [ ] Upload sw.js ke production root
- [ ] Deploy ke server
- [ ] Test semua ad formats
- [ ] Monitor earnings di dashboard

---

## 🆘 Support

**Monetag Support:**
- Email: support@monetag.com
- Live Chat: Dashboard → Support
- Response time: 24-48 jam

**Documentation:**
- https://monetag.com/help
- https://monetag.com/blog

**Community:**
- Monetag Publisher Forum
- Reddit: r/MonetizeYourSite

---

**Selamat monetisasi! 💰🚀**

Dengan setup yang benar, Monetag bisa menghasilkan $3-8 CPM untuk traffic Indonesia. 
Focus ke popunder untuk hasil maksimal!
