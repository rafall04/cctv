# 💰 Panduan Monetisasi RAF NET CCTV

## Strategi Monetisasi

Project RAF NET CCTV dapat dimonetisasi melalui beberapa cara:

### 1. **Banner Ads (Ad Networks)**

#### Media.net (Rekomendasi #1)
- **CPM:** $1-3 per 1000 views
- **Approval:** 2-3 hari
- **Minimum Payout:** $100
- **Payment:** PayPal, Wire Transfer
- **Daftar:** https://www.media.net/

**Setup:**
1. Daftar akun di Media.net
2. Tambahkan domain/subdomain Anda
3. Dapatkan CID dan CRID
4. Update `AdBanner.jsx` dengan credentials Anda

#### Adsterra (Rekomendasi #2)
- **CPM:** $1.5-4 per 1000 views
- **Approval:** Instant (24 jam)
- **Minimum Payout:** $5
- **Payment:** PayPal, Payoneer, Bitcoin
- **Daftar:** https://www.adsterra.com/

**Setup:**
1. Daftar akun di Adsterra
2. Buat zone untuk banner ads
3. Copy ad code
4. Update `AdBanner.jsx` dengan zone ID

#### PropellerAds (Rekomendasi #3)
- **CPM:** $2-5 per 1000 views
- **Approval:** Instant
- **Minimum Payout:** $5
- **Payment:** PayPal, Payoneer
- **Daftar:** https://www.propellerads.com/

**Jenis Iklan:**
- Native ads (di antara grid kamera)
- Push notifications
- Interstitial ads

---

### 2. **Direct Sponsorship (Paling Menguntungkan)**

#### Paket Sponsorship

**BRONZE - Rp 500.000/bulan**
- Logo sponsor di 1 kamera pilihan
- Mention di deskripsi kamera
- Link ke website sponsor

**SILVER - Rp 1.500.000/bulan**
- Logo sponsor di 3 kamera
- Banner di landing page
- Mention di social media
- Dedicated sponsor page

**GOLD - Rp 3.000.000/bulan**
- Logo sponsor di semua kamera
- Banner premium di header
- Dedicated sponsor page
- Social media promotion
- Monthly analytics report

#### Target Sponsor Potensial:
1. **Toko/Warung Lokal** - yang berada di area kamera
2. **Perusahaan Keamanan** - CCTV installer, security services
3. **Developer Perumahan** - promosi perumahan di area
4. **Provider Internet** - ISP lokal
5. **Dealer Kendaraan** - motor, mobil
6. **Bank/Koperasi** - financial services
7. **Toko Elektronik** - gadget, CCTV equipment

---

### 3. **Popunder Ads (High CPM)**

#### Monetag (PopCash)
- **CPM:** $3-8 per 1000 views
- **Approval:** Instant
- **Minimum Payout:** $5
- **Payment:** PayPal, Payoneer, Bitcoin
- **Daftar:** https://www.monetag.com/

**Catatan:** Popunder muncul 1x per user per 24 jam, tidak mengganggu UX.

---

## Implementasi Teknis

### 1. Jalankan Migration

```bash
cd backend
node database/migrations/add_sponsor_fields.js
```

### 2. Update Schema Validators

Edit `backend/middleware/schemaValidators.js`:

```javascript
export const createCameraSchema = {
    body: {
        properties: {
            // ... existing fields
            sponsor_name: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
            },
            sponsor_logo: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_url: {
                anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }]
            },
            sponsor_package: {
                anyOf: [
                    { type: 'string', enum: ['bronze', 'silver', 'gold'] },
                    { type: 'null' }
                ]
            }
        }
    }
};
```

### 3. Update Camera Controller

Edit `backend/controllers/cameraController.js` untuk handle sponsor fields.

### 4. Tambahkan AdBanner di Landing Page

Edit `frontend/src/pages/LandingPage.jsx`:

```jsx
import AdBanner from '../components/AdBanner';

function LandingPage() {
    return (
        <div>
            {/* Top Banner */}
            <AdBanner 
                network="medianet" 
                position="top" 
                size="leaderboard"
                className="mb-6"
            />

            {/* Camera Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {cameras.map((camera, index) => (
                    <>
                        <CameraCard key={camera.id} camera={camera} />
                        
                        {/* Inline ad setiap 6 kamera */}
                        {(index + 1) % 6 === 0 && (
                            <div className="col-span-full">
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

            {/* Bottom Banner */}
            <AdBanner 
                network="propellerads" 
                position="bottom" 
                size="leaderboard"
                className="mt-6"
            />
        </div>
    );
}
```

### 5. Tambahkan Sponsor Badge di Camera Card

```jsx
import SponsorBadge from '../components/SponsorBadge';

function CameraCard({ camera }) {
    return (
        <div className="relative">
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
            
            {/* Camera content */}
            <VideoPlayer camera={camera} />
        </div>
    );
}
```

---

## Estimasi Pendapatan

### Skenario 1: Traffic Rendah (1.000 views/hari)
- Media.net Banner: $2/hari = Rp 30.000/hari
- Adsterra Native: $3/hari = Rp 45.000/hari
- Monetag Popunder: $5/hari = Rp 75.000/hari
- **Total: Rp 150.000/hari = Rp 4.500.000/bulan**

### Skenario 2: Traffic Sedang (5.000 views/hari)
- Media.net Banner: $10/hari = Rp 150.000/hari
- Adsterra Native: $15/hari = Rp 225.000/hari
- Monetag Popunder: $25/hari = Rp 375.000/hari
- Direct Sponsor (2 Bronze): Rp 1.000.000/bulan
- **Total: Rp 750.000/hari = Rp 23.500.000/bulan**

### Skenario 3: Traffic Tinggi (10.000 views/hari)
- Media.net Banner: $20/hari = Rp 300.000/hari
- Adsterra Native: $30/hari = Rp 450.000/hari
- Monetag Popunder: $50/hari = Rp 750.000/hari
- Direct Sponsor (1 Gold + 2 Silver): Rp 6.000.000/bulan
- **Total: Rp 1.500.000/hari = Rp 51.000.000/bulan**

*Catatan: Estimasi menggunakan kurs Rp 15.000/$1*

---

## Tips Optimasi Pendapatan

### 1. Tingkatkan Traffic
- SEO optimization
- Social media marketing
- Telegram channel/group
- WhatsApp broadcast
- Kolaborasi dengan RT/RW setempat

### 2. Placement Iklan Optimal
- **Top Banner:** First impression, CPM tinggi
- **Inline Ads:** Setiap 6 kamera, natural placement
- **Bottom Banner:** Setelah user scroll, engagement tinggi
- **Sidebar:** Desktop only, persistent visibility

### 3. A/B Testing
- Test berbagai ad networks
- Test posisi iklan
- Monitor CTR dan CPM
- Pilih kombinasi terbaik

### 4. User Experience
- Jangan terlalu banyak iklan (max 3-4 per page)
- Hindari intrusive ads
- Pastikan loading time tetap cepat
- Mobile-friendly ads

### 5. Direct Sponsorship Strategy
- Buat media kit (traffic stats, demographics)
- Approach bisnis lokal secara langsung
- Tawarkan trial period 1 bulan
- Berikan analytics report bulanan

---

## Legal & Compliance

### 1. Privacy Policy
Tambahkan informasi tentang iklan di privacy policy:
- Penggunaan cookies untuk targeted ads
- Third-party ad networks
- User tracking

### 2. Terms of Service
- Disclaimer tentang konten iklan
- Tidak bertanggung jawab atas produk/jasa yang diiklankan

### 3. Ad Quality
- Review iklan yang muncul secara berkala
- Block kategori iklan yang tidak sesuai (adult, gambling, dll)
- Gunakan ad network yang reputable

---

## Monitoring & Analytics

### 1. Track Revenue
- Buat spreadsheet untuk tracking pendapatan
- Monitor CPM per ad network
- Bandingkan performance

### 2. Traffic Analytics
- Google Analytics untuk traffic monitoring
- Heatmap untuk ad placement optimization
- Conversion tracking untuk sponsor

### 3. Monthly Report
- Total views
- Total revenue
- CPM per network
- Best performing ads
- Recommendations

---

## Next Steps

1. ✅ Pilih 2-3 ad networks untuk dicoba
2. ✅ Daftar akun di ad networks pilihan
3. ✅ Jalankan migration untuk sponsor fields
4. ✅ Implementasi AdBanner component
5. ✅ Test ads di development
6. ✅ Deploy ke production
7. ✅ Monitor performance selama 1 minggu
8. ✅ Optimize berdasarkan data
9. ✅ Approach sponsor lokal untuk direct sponsorship
10. ✅ Scale up!

---

## Support

Jika ada pertanyaan tentang implementasi monetisasi:
1. Check dokumentasi ad network
2. Test di development dulu
3. Monitor console untuk errors
4. Adjust placement berdasarkan performance

**Good luck monetizing! 💰🚀**
