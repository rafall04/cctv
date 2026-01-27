# 📝 Contoh Implementasi Monetisasi

## Contoh 1: Implementasi di LandingPage.jsx

```jsx
import { useState, useEffect } from 'react';
import AdBanner from '../components/AdBanner';
import SponsorBadge from '../components/SponsorBadge';
import VideoPlayer from '../components/VideoPlayer';

function LandingPage() {
    const [cameras, setCameras] = useState([]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900">
            {/* Header */}
            <header className="bg-dark-800/50 backdrop-blur-md border-b border-dark-700/50">
                <div className="container mx-auto px-4 py-6">
                    <h1 className="text-3xl font-bold text-white">RAF NET CCTV</h1>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                {/* Top Banner Ad - Desktop Only */}
                <div className="hidden md:block mb-8">
                    <AdBanner 
                        network="medianet" 
                        position="top" 
                        size="leaderboard"
                        className="mx-auto"
                    />
                </div>

                {/* Mobile Banner Ad */}
                <div className="block md:hidden mb-6">
                    <AdBanner 
                        network="medianet" 
                        position="top" 
                        size="mobile"
                        className="mx-auto"
                    />
                </div>

                {/* Camera Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cameras.map((camera, index) => (
                        <>
                            {/* Camera Card dengan Sponsor Badge */}
                            <div key={camera.id} className="relative">
                                <div className="bg-dark-800/90 backdrop-blur-md rounded-xl overflow-hidden border border-dark-700/50 shadow-2xl">
                                    {/* Sponsor Badge jika ada */}
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

                                    {/* Video Player */}
                                    <VideoPlayer 
                                        camera={camera}
                                        streams={camera.streams}
                                    />

                                    {/* Camera Info */}
                                    <div className="p-4">
                                        <h3 className="text-lg font-semibold text-white">
                                            {camera.name}
                                        </h3>
                                        <p className="text-sm text-gray-400">
                                            {camera.location}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Inline Ad setiap 6 kamera */}
                            {(index + 1) % 6 === 0 && (
                                <div className="col-span-full my-4">
                                    <div className="bg-dark-800/50 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                                        <p className="text-xs text-gray-500 text-center mb-2">
                                            Advertisement
                                        </p>
                                        <AdBanner 
                                            network="adsterra" 
                                            position="inline" 
                                            size="rectangle"
                                            className="mx-auto"
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                    ))}
                </div>

                {/* Bottom Banner Ad */}
                <div className="mt-8 mb-4">
                    <div className="bg-dark-800/50 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-xs text-gray-500 text-center mb-2">
                            Advertisement
                        </p>
                        <AdBanner 
                            network="propellerads" 
                            position="bottom" 
                            size="leaderboard"
                            className="mx-auto"
                        />
                    </div>
                </div>
            </main>

            {/* Footer dengan Sponsor Info */}
            <footer className="bg-dark-800/50 backdrop-blur-md border-t border-dark-700/50 mt-12">
                <div className="container mx-auto px-4 py-8">
                    <div className="text-center text-gray-400 text-sm">
                        <p>© 2024 RAF NET CCTV. All rights reserved.</p>
                        <p className="mt-2">
                            Ingin menjadi sponsor? 
                            <a href="/sponsor" className="text-primary-400 hover:text-primary-300 ml-1">
                                Hubungi kami
                            </a>
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default LandingPage;
```

---

## Contoh 2: Sponsor Management di Admin Panel

```jsx
// frontend/src/pages/SponsorManagement.jsx
import { useState, useEffect } from 'react';
import { sponsorService } from '../services/sponsorService';

function SponsorManagement() {
    const [sponsors, setSponsors] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        logo: '',
        url: '',
        package: 'bronze',
        price: 500000,
        contact_name: '',
        contact_email: '',
        contact_phone: '',
        start_date: '',
        end_date: '',
        notes: ''
    });

    const packages = {
        bronze: {
            name: 'Bronze',
            price: 500000,
            features: ['Logo di 1 kamera', 'Mention di deskripsi']
        },
        silver: {
            name: 'Silver',
            price: 1500000,
            features: ['Logo di 3 kamera', 'Banner di landing page', 'Social media mention']
        },
        gold: {
            name: 'Gold',
            price: 3000000,
            features: ['Logo di semua kamera', 'Banner premium', 'Dedicated page', 'Monthly report']
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await sponsorService.createSponsor(formData);
            // Refresh list
            loadSponsors();
            setShowModal(false);
        } catch (error) {
            console.error('Failed to create sponsor:', error);
        }
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-white">Sponsor Management</h1>
                <button 
                    onClick={() => setShowModal(true)}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg"
                >
                    + Tambah Sponsor
                </button>
            </div>

            {/* Sponsor List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sponsors.map(sponsor => (
                    <div key={sponsor.id} className="bg-dark-800 rounded-lg p-6 border border-dark-700">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white">{sponsor.name}</h3>
                            <span className={`
                                px-3 py-1 rounded-full text-xs font-semibold
                                ${sponsor.package === 'gold' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                                ${sponsor.package === 'silver' ? 'bg-gray-400/20 text-gray-300' : ''}
                                ${sponsor.package === 'bronze' ? 'bg-orange-500/20 text-orange-400' : ''}
                            `}>
                                {packages[sponsor.package].name}
                            </span>
                        </div>

                        {sponsor.logo && (
                            <img 
                                src={sponsor.logo} 
                                alt={sponsor.name}
                                className="w-full h-24 object-contain bg-white rounded-lg mb-4"
                            />
                        )}

                        <div className="space-y-2 text-sm text-gray-400">
                            <p>💰 Rp {sponsor.price.toLocaleString('id-ID')}/bulan</p>
                            <p>📅 {sponsor.start_date} - {sponsor.end_date}</p>
                            <p>📧 {sponsor.contact_email}</p>
                        </div>

                        <div className="mt-4 flex gap-2">
                            <button className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-3 py-2 rounded text-sm">
                                Edit
                            </button>
                            <button className="flex-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm">
                                Hapus
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add Sponsor Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-dark-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold text-white mb-4">Tambah Sponsor Baru</h2>
                        
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Form fields */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Nama Sponsor
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Paket Sponsorship
                                </label>
                                <select
                                    value={formData.package}
                                    onChange={(e) => setFormData({
                                        ...formData, 
                                        package: e.target.value,
                                        price: packages[e.target.value].price
                                    })}
                                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white"
                                >
                                    {Object.entries(packages).map(([key, pkg]) => (
                                        <option key={key} value={key}>
                                            {pkg.name} - Rp {pkg.price.toLocaleString('id-ID')}/bulan
                                        </option>
                                    ))}
                                </select>
                                
                                {/* Package Features */}
                                <div className="mt-2 p-3 bg-dark-900/50 rounded-lg">
                                    <p className="text-xs text-gray-400 mb-2">Fitur paket:</p>
                                    <ul className="text-xs text-gray-300 space-y-1">
                                        {packages[formData.package].features.map((feature, i) => (
                                            <li key={i}>✓ {feature}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            {/* More form fields... */}

                            <div className="flex gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 bg-dark-700 hover:bg-dark-600 text-white px-4 py-2 rounded-lg"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg"
                                >
                                    Simpan
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SponsorManagement;
```

---

## Contoh 3: Proposal untuk Sponsor Lokal

```markdown
# 📄 Proposal Sponsorship RAF NET CCTV

## Tentang RAF NET CCTV

RAF NET CCTV adalah platform monitoring CCTV publik yang menyediakan akses 
real-time ke kamera keamanan di berbagai lokasi strategis.

### Statistik Platform:
- 👥 **10.000+ pengunjung/bulan**
- 📹 **24 kamera aktif**
- ⏱️ **Rata-rata durasi kunjungan: 5 menit**
- 📱 **70% mobile users, 30% desktop**
- 📍 **Coverage: Kelurahan X, Kecamatan Y**

---

## Paket Sponsorship

### 🥉 BRONZE - Rp 500.000/bulan
**Cocok untuk:** Toko/warung lokal, UMKM

**Benefit:**
- ✅ Logo sponsor di 1 kamera pilihan
- ✅ Mention di deskripsi kamera
- ✅ Link ke website/WhatsApp bisnis
- ✅ Estimasi impressions: 3.000/bulan

### 🥈 SILVER - Rp 1.500.000/bulan
**Cocok untuk:** Toko menengah, service provider

**Benefit:**
- ✅ Logo sponsor di 3 kamera strategis
- ✅ Banner di landing page
- ✅ Mention di social media (Instagram, Facebook)
- ✅ Dedicated sponsor page
- ✅ Estimasi impressions: 10.000/bulan

### 🥇 GOLD - Rp 3.000.000/bulan
**Cocok untuk:** Developer, dealer, perusahaan besar

**Benefit:**
- ✅ Logo sponsor di SEMUA kamera
- ✅ Banner premium di header website
- ✅ Dedicated sponsor page dengan detail lengkap
- ✅ Social media promotion (2x/minggu)
- ✅ Monthly analytics report
- ✅ Estimasi impressions: 30.000/bulan

---

## Mengapa Sponsor RAF NET CCTV?

### 1. Target Audience Tepat
- Warga lokal yang peduli keamanan
- Pemilik usaha di area coverage
- Calon pembeli properti
- Keluarga yang ingin monitor area

### 2. Exposure Berkelanjutan
- Website aktif 24/7
- Pengunjung rutin setiap hari
- Logo terlihat di setiap view kamera
- Branding yang konsisten

### 3. ROI Terukur
- Analytics report bulanan
- Click tracking ke website sponsor
- Conversion monitoring
- A/B testing untuk optimasi

### 4. Fleksibel & Terjangkau
- Paket mulai dari Rp 500rb/bulan
- Bisa trial 1 bulan
- Cancel anytime
- Custom package available

---

## Contoh Implementasi

[Screenshot: Logo sponsor di camera card]
[Screenshot: Banner sponsor di landing page]
[Screenshot: Dedicated sponsor page]

---

## Testimoni Sponsor

> "Sejak sponsor di RAF NET CCTV, traffic ke toko online kami naik 30%. 
> ROI sangat bagus!" - **Toko Elektronik ABC**

> "Branding kami jadi lebih dikenal di area ini. Worth it!" 
> - **Developer Perumahan XYZ**

---

## Cara Bergabung

1. **Pilih Paket** - Sesuai budget dan kebutuhan
2. **Hubungi Kami** - Via WhatsApp/Email
3. **Kirim Materi** - Logo, link website, deskripsi
4. **Go Live** - Dalam 24 jam setelah pembayaran
5. **Monitor** - Dapatkan report bulanan

---

## Kontak

📱 **WhatsApp:** 0812-3456-7890
📧 **Email:** sponsor@rafnet-cctv.id
🌐 **Website:** https://cctv.raf.my.id
📍 **Alamat:** [Alamat kantor/RT]

---

**Promo Spesial:**
Daftar sebelum akhir bulan, dapatkan diskon 20% untuk 3 bulan pertama!

*Slot terbatas, hubungi sekarang!*
```

---

## Tips Approach Sponsor

### 1. Identifikasi Target
- Buat list bisnis di area coverage kamera
- Prioritas: yang paling diuntungkan dari exposure
- Cari contact person (owner/marketing)

### 2. Persiapan Materi
- Buat proposal PDF yang menarik
- Screenshot analytics (traffic, demographics)
- Mockup logo sponsor di kamera
- Testimoni (jika sudah ada)

### 3. Approach Strategy
- **Email:** Kirim proposal + follow up 3 hari kemudian
- **WhatsApp:** Personal message dengan value proposition
- **Tatap Muka:** Kunjungi langsung dengan printed proposal
- **Social Media:** DM di Instagram/Facebook

### 4. Closing Technique
- Tawarkan trial 1 bulan dengan harga spesial
- Berikan deadline untuk promo (create urgency)
- Tunjukkan competitor yang sudah sponsor
- Guarantee: "Jika tidak puas, refund 100%"

### 5. Retention
- Kirim monthly report
- Update sponsor tentang traffic growth
- Minta feedback dan testimonial
- Tawarkan upgrade package

---

Semoga berhasil! 💰🚀
