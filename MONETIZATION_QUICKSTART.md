# 🚀 Quick Start: Monetisasi RAF NET CCTV

## Langkah Cepat (5 Menit)

### 1. Jalankan Migration Database

```bash
cd backend
node database/migrations/add_sponsor_fields.js
```

Output yang diharapkan:
```
🔄 Adding sponsor fields to cameras table...
✅ Sponsor fields added successfully
✅ Sponsors table created/verified
✅ Banner ads table created/verified
✨ Migration completed successfully!
```

### 2. Restart Backend Server

```bash
# Development
npm run dev

# Production (Ubuntu 20.04)
pm2 restart rafnet-cctv-backend
```

### 3. Akses Sponsor Management

1. Login ke admin panel: `http://localhost:5173/admin/login`
2. Buka menu **Sponsors** di sidebar
3. Klik **+ Tambah Sponsor**

### 4. Tambah Sponsor Pertama

**Contoh Data:**
- **Nama:** Toko Elektronik ABC
- **URL Logo:** https://via.placeholder.com/150x75?text=ABC+Electronics
- **Website:** https://example.com
- **Paket:** Bronze (Rp 500.000/bulan)
- **Kontak:** John Doe, john@example.com, 0812-3456-7890
- **Periode:** 2024-01-01 s/d 2024-12-31

### 5. Assign Sponsor ke Kamera

Di halaman Camera Management:
1. Edit kamera yang ingin diberi sponsor
2. Scroll ke bawah ke bagian "Sponsor"
3. Pilih sponsor dari dropdown
4. Simpan

---

## Setup Ad Networks (10 Menit)

### Option 1: Media.net

1. **Daftar:** https://www.media.net/
2. **Approval:** 2-3 hari
3. **Dapatkan Credentials:**
   - CID (Customer ID)
   - CRID (Creative ID)

4. **Update AdBanner.jsx:**
```javascript
// Line 50-60 di frontend/src/components/AdBanner.jsx
medianet_crid = "YOUR_MEDIA_NET_CRID";  // Ganti dengan CRID Anda
// ...
script.src = '//contextual.media.net/nmedianet.js?cid=YOUR_MEDIA_NET_CID';  // Ganti dengan CID Anda
```

### Option 2: Adsterra

1. **Daftar:** https://www.adsterra.com/
2. **Approval:** Instant (24 jam)
3. **Buat Zone:**
   - Type: Native Banner
   - Size: 728x90 (Leaderboard)
4. **Copy Ad Code**

5. **Update AdBanner.jsx:**
```javascript
// Line 70-80
'key' : 'YOUR_ADSTERRA_KEY',  // Ganti dengan key Anda
// ...
script.src = '//www.topcreativeformat.com/YOUR_ADSTERRA_ID/invoke.js';  // Ganti dengan ID Anda
```

### Option 3: PropellerAds

1. **Daftar:** https://www.propellerads.com/
2. **Approval:** Instant
3. **Buat Zone:**
   - Type: Native Ads
   - Size: Responsive
4. **Copy Zone ID**

5. **Update AdBanner.jsx:**
```javascript
// Line 90
script.src = '//pl123456.puhtml.com/YOUR_ZONE_ID.js';  // Ganti dengan Zone ID Anda
```

---

## Implementasi di Landing Page (5 Menit)

### Update LandingPage.jsx

```jsx
import AdBanner from '../components/AdBanner';
import SponsorBadge from '../components/SponsorBadge';

function LandingPage() {
    // ... existing code ...

    return (
        <div>
            {/* Top Banner - Desktop */}
            <div className="hidden md:block mb-8">
                <AdBanner 
                    network="medianet"  // atau "adsterra" / "propellerads"
                    position="top" 
                    size="leaderboard"
                />
            </div>

            {/* Camera Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {cameras.map((camera, index) => (
                    <>
                        <div key={camera.id} className="relative">
                            {/* Sponsor Badge */}
                            {camera.sponsor_name && (
                                <SponsorBadge 
                                    sponsor={{
                                        name: camera.sponsor_name,
                                        logo: camera.sponsor_logo,
                                        url: camera.sponsor_url,
                                        package: camera.sponsor_package
                                    }}
                                    size="small"
                                    position="bottom-right"
                                />
                            )}
                            
                            {/* Camera Card */}
                            <VideoPlayer camera={camera} />
                        </div>

                        {/* Inline Ad setiap 6 kamera */}
                        {(index + 1) % 6 === 0 && (
                            <div className="col-span-full my-4">
                                <AdBanner 
                                    network="adsterra"
                                    position="inline" 
                                    size="rectangle"
                                />
                            </div>
                        )}
                    </>
                ))}
            </div>
        </div>
    );
}
```

---

## Testing (2 Menit)

### 1. Test Sponsor Management
- ✅ Bisa tambah sponsor baru
- ✅ Bisa edit sponsor
- ✅ Bisa hapus sponsor
- ✅ Statistik muncul dengan benar

### 2. Test Sponsor Badge
- ✅ Logo sponsor muncul di camera card
- ✅ Klik logo membuka website sponsor
- ✅ Tooltip muncul saat hover

### 3. Test Ad Banner
- ✅ Banner muncul di posisi yang benar
- ✅ Responsive di mobile dan desktop
- ✅ Tidak mengganggu UX

---

## Approach Sponsor Lokal (30 Menit)

### Template Email

```
Subject: Peluang Sponsorship - RAF NET CCTV

Halo [Nama Bisnis],

Saya dari RAF NET CCTV, platform monitoring CCTV publik yang melayani 
[area coverage] dengan 10.000+ pengunjung per bulan.

Kami menawarkan paket sponsorship untuk meningkatkan brand awareness 
bisnis Anda di area ini:

🥉 BRONZE - Rp 500.000/bulan
- Logo di 1 kamera strategis
- Link ke website/WhatsApp bisnis
- Estimasi 3.000 impressions/bulan

🥈 SILVER - Rp 1.500.000/bulan
- Logo di 3 kamera
- Banner di landing page
- Social media mention
- Estimasi 10.000 impressions/bulan

🥇 GOLD - Rp 3.000.000/bulan
- Logo di SEMUA kamera
- Banner premium
- Monthly analytics report
- Estimasi 30.000 impressions/bulan

PROMO SPESIAL: Diskon 20% untuk 3 bulan pertama!

Tertarik? Hubungi saya di [WhatsApp/Email]

Salam,
[Nama Anda]
RAF NET CCTV
```

### Target Bisnis Prioritas

1. **Toko/Warung** di area kamera
2. **Perusahaan Keamanan** (CCTV installer)
3. **Developer Perumahan**
4. **Provider Internet** (ISP lokal)
5. **Dealer Kendaraan**
6. **Bank/Koperasi**
7. **Toko Elektronik**

### Follow-up Strategy

**Day 1:** Kirim email/WhatsApp
**Day 3:** Follow-up pertama
**Day 7:** Follow-up kedua dengan mockup
**Day 14:** Final follow-up dengan promo deadline

---

## Monitoring & Optimization (Ongoing)

### Weekly Tasks
- [ ] Check ad network earnings
- [ ] Monitor CPM per network
- [ ] Review sponsor feedback
- [ ] Update sponsor analytics

### Monthly Tasks
- [ ] Send sponsor monthly report
- [ ] Analyze best performing ads
- [ ] Optimize ad placement
- [ ] Approach new sponsors

### Quarterly Tasks
- [ ] Review sponsor contracts
- [ ] Negotiate renewals
- [ ] A/B test ad positions
- [ ] Update pricing if needed

---

## Troubleshooting

### Ads tidak muncul
1. Check browser console untuk errors
2. Verify ad network credentials
3. Test dengan ad network test mode
4. Check ad blocker

### Sponsor badge tidak muncul
1. Verify sponsor data di database
2. Check camera has sponsor assigned
3. Verify SponsorBadge component imported
4. Check console untuk errors

### Database migration gagal
1. Backup database dulu
2. Check database path di migration file
3. Run migration dengan node (bukan npm)
4. Check error message untuk detail

---

## Next Steps

1. ✅ Setup complete - sistem siap digunakan
2. 📝 Daftar ke 2-3 ad networks
3. 💼 Approach 5-10 sponsor lokal
4. 📊 Monitor performance selama 1 minggu
5. 🔄 Optimize berdasarkan data
6. 💰 Scale up!

---

## Support & Resources

- **Dokumentasi Lengkap:** MONETIZATION.md
- **Contoh Implementasi:** MONETIZATION_EXAMPLE.md
- **Ad Network Guides:**
  - Media.net: https://www.media.net/publishers
  - Adsterra: https://adsterra.com/publishers
  - PropellerAds: https://propellerads.com/blog

**Questions?** Check dokumentasi atau test di development dulu!

**Good luck! 💰🚀**
