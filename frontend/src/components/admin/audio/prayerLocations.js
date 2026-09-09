/*
 * Purpose: Preset lokasi (kabupaten/kota) untuk konfigurasi Adzan — pilih lokasi, koordinat + zona waktu
 *   terisi otomatis, jadi operator tak perlu mengetik lintang/bujur mentah (sumber bug "waktu geser ~7 jam"
 *   ketika koordinat dibiarkan 0,0). Statis + offline (tak ada API). Jawa Timur lengkap (lokasi deployment);
 *   ibu kota provinsi + kota besar seluruh Indonesia untuk kesiapan produk (WIB/WITA/WIT).
 * Caller: components/admin/audio/PrayerConfig.jsx.
 * Catatan akurasi: koordinat = pusat kota/kabupaten (~beberapa km); selisih waktu sholat < ~20 detik.
 *   Untuk lokasi yang tak terdaftar, operator tetap bisa isi lintang/bujur manual atau pakai GPS HP.
 * tz = offset UTC (WIB +7, WITA +8, WIT +9).
 */

// group dipakai untuk optgroup di <select>.
export const PRAYER_LOCATIONS = [
    // ————————————————————————— Jawa Timur (WIB) — lokasi deployment, lengkap 38 kab/kota
    { id: 'bojonegoro', name: 'Kab. Bojonegoro', group: 'Jawa Timur (WIB)', lat: -7.1502, lon: 111.8817, tz: 7 },
    { id: 'tuban', name: 'Kab. Tuban', group: 'Jawa Timur (WIB)', lat: -6.8976, lon: 112.0644, tz: 7 },
    { id: 'lamongan', name: 'Kab. Lamongan', group: 'Jawa Timur (WIB)', lat: -7.1216, lon: 112.4167, tz: 7 },
    { id: 'gresik', name: 'Kab. Gresik', group: 'Jawa Timur (WIB)', lat: -7.1550, lon: 112.6530, tz: 7 },
    { id: 'surabaya', name: 'Kota Surabaya', group: 'Jawa Timur (WIB)', lat: -7.2575, lon: 112.7521, tz: 7 },
    { id: 'sidoarjo', name: 'Kab. Sidoarjo', group: 'Jawa Timur (WIB)', lat: -7.4478, lon: 112.7183, tz: 7 },
    { id: 'mojokerto-kab', name: 'Kab. Mojokerto', group: 'Jawa Timur (WIB)', lat: -7.4700, lon: 112.4419, tz: 7 },
    { id: 'mojokerto-kota', name: 'Kota Mojokerto', group: 'Jawa Timur (WIB)', lat: -7.4722, lon: 112.4381, tz: 7 },
    { id: 'jombang', name: 'Kab. Jombang', group: 'Jawa Timur (WIB)', lat: -7.5468, lon: 112.2330, tz: 7 },
    { id: 'nganjuk', name: 'Kab. Nganjuk', group: 'Jawa Timur (WIB)', lat: -7.6050, lon: 111.9030, tz: 7 },
    { id: 'madiun-kab', name: 'Kab. Madiun', group: 'Jawa Timur (WIB)', lat: -7.6298, lon: 111.5239, tz: 7 },
    { id: 'madiun-kota', name: 'Kota Madiun', group: 'Jawa Timur (WIB)', lat: -7.6298, lon: 111.5300, tz: 7 },
    { id: 'magetan', name: 'Kab. Magetan', group: 'Jawa Timur (WIB)', lat: -7.6558, lon: 111.3300, tz: 7 },
    { id: 'ngawi', name: 'Kab. Ngawi', group: 'Jawa Timur (WIB)', lat: -7.4062, lon: 111.4463, tz: 7 },
    { id: 'ponorogo', name: 'Kab. Ponorogo', group: 'Jawa Timur (WIB)', lat: -7.8686, lon: 111.4620, tz: 7 },
    { id: 'pacitan', name: 'Kab. Pacitan', group: 'Jawa Timur (WIB)', lat: -8.1947, lon: 111.1000, tz: 7 },
    { id: 'trenggalek', name: 'Kab. Trenggalek', group: 'Jawa Timur (WIB)', lat: -8.0500, lon: 111.7100, tz: 7 },
    { id: 'tulungagung', name: 'Kab. Tulungagung', group: 'Jawa Timur (WIB)', lat: -8.0654, lon: 111.9025, tz: 7 },
    { id: 'blitar-kab', name: 'Kab. Blitar', group: 'Jawa Timur (WIB)', lat: -8.0983, lon: 112.1681, tz: 7 },
    { id: 'blitar-kota', name: 'Kota Blitar', group: 'Jawa Timur (WIB)', lat: -8.0954, lon: 112.1609, tz: 7 },
    { id: 'kediri-kab', name: 'Kab. Kediri', group: 'Jawa Timur (WIB)', lat: -7.8480, lon: 112.0170, tz: 7 },
    { id: 'kediri-kota', name: 'Kota Kediri', group: 'Jawa Timur (WIB)', lat: -7.8166, lon: 112.0114, tz: 7 },
    { id: 'malang-kab', name: 'Kab. Malang', group: 'Jawa Timur (WIB)', lat: -8.1069, lon: 112.6667, tz: 7 },
    { id: 'malang-kota', name: 'Kota Malang', group: 'Jawa Timur (WIB)', lat: -7.9666, lon: 112.6326, tz: 7 },
    { id: 'batu', name: 'Kota Batu', group: 'Jawa Timur (WIB)', lat: -7.8672, lon: 112.5239, tz: 7 },
    { id: 'pasuruan-kab', name: 'Kab. Pasuruan', group: 'Jawa Timur (WIB)', lat: -7.6450, lon: 112.9070, tz: 7 },
    { id: 'pasuruan-kota', name: 'Kota Pasuruan', group: 'Jawa Timur (WIB)', lat: -7.6450, lon: 112.9080, tz: 7 },
    { id: 'probolinggo-kab', name: 'Kab. Probolinggo', group: 'Jawa Timur (WIB)', lat: -7.7443, lon: 113.4180, tz: 7 },
    { id: 'probolinggo-kota', name: 'Kota Probolinggo', group: 'Jawa Timur (WIB)', lat: -7.7543, lon: 113.2159, tz: 7 },
    { id: 'lumajang', name: 'Kab. Lumajang', group: 'Jawa Timur (WIB)', lat: -8.1335, lon: 113.2243, tz: 7 },
    { id: 'jember', name: 'Kab. Jember', group: 'Jawa Timur (WIB)', lat: -8.1727, lon: 113.7002, tz: 7 },
    { id: 'bondowoso', name: 'Kab. Bondowoso', group: 'Jawa Timur (WIB)', lat: -7.9135, lon: 113.8210, tz: 7 },
    { id: 'situbondo', name: 'Kab. Situbondo', group: 'Jawa Timur (WIB)', lat: -7.7066, lon: 114.0094, tz: 7 },
    { id: 'banyuwangi', name: 'Kab. Banyuwangi', group: 'Jawa Timur (WIB)', lat: -8.2192, lon: 114.3691, tz: 7 },
    { id: 'bangkalan', name: 'Kab. Bangkalan', group: 'Jawa Timur (WIB)', lat: -7.0455, lon: 112.7370, tz: 7 },
    { id: 'sampang', name: 'Kab. Sampang', group: 'Jawa Timur (WIB)', lat: -7.1923, lon: 113.2492, tz: 7 },
    { id: 'pamekasan', name: 'Kab. Pamekasan', group: 'Jawa Timur (WIB)', lat: -7.1568, lon: 113.4749, tz: 7 },
    { id: 'sumenep', name: 'Kab. Sumenep', group: 'Jawa Timur (WIB)', lat: -7.0055, lon: 113.8494, tz: 7 },

    // ————————————————————————— Jawa & sekitarnya (WIB)
    { id: 'jakarta', name: 'DKI Jakarta', group: 'Jawa & sekitarnya (WIB)', lat: -6.2088, lon: 106.8456, tz: 7 },
    { id: 'bekasi', name: 'Kota Bekasi', group: 'Jawa & sekitarnya (WIB)', lat: -6.2383, lon: 106.9756, tz: 7 },
    { id: 'depok', name: 'Kota Depok', group: 'Jawa & sekitarnya (WIB)', lat: -6.4025, lon: 106.7942, tz: 7 },
    { id: 'bogor', name: 'Kota Bogor', group: 'Jawa & sekitarnya (WIB)', lat: -6.5950, lon: 106.8166, tz: 7 },
    { id: 'tangerang', name: 'Kota Tangerang', group: 'Jawa & sekitarnya (WIB)', lat: -6.1783, lon: 106.6319, tz: 7 },
    { id: 'serang', name: 'Kota Serang (Banten)', group: 'Jawa & sekitarnya (WIB)', lat: -6.1200, lon: 106.1500, tz: 7 },
    { id: 'bandung', name: 'Kota Bandung', group: 'Jawa & sekitarnya (WIB)', lat: -6.9175, lon: 107.6191, tz: 7 },
    { id: 'cirebon', name: 'Kota Cirebon', group: 'Jawa & sekitarnya (WIB)', lat: -6.7320, lon: 108.5523, tz: 7 },
    { id: 'tasikmalaya', name: 'Kota Tasikmalaya', group: 'Jawa & sekitarnya (WIB)', lat: -7.3274, lon: 108.2207, tz: 7 },
    { id: 'semarang', name: 'Kota Semarang', group: 'Jawa & sekitarnya (WIB)', lat: -6.9667, lon: 110.4167, tz: 7 },
    { id: 'solo', name: 'Kota Surakarta (Solo)', group: 'Jawa & sekitarnya (WIB)', lat: -7.5667, lon: 110.8167, tz: 7 },
    { id: 'tegal', name: 'Kota Tegal', group: 'Jawa & sekitarnya (WIB)', lat: -6.8694, lon: 109.1402, tz: 7 },
    { id: 'yogyakarta', name: 'Kota Yogyakarta', group: 'Jawa & sekitarnya (WIB)', lat: -7.8014, lon: 110.3644, tz: 7 },

    // ————————————————————————— Sumatra (WIB)
    { id: 'banda-aceh', name: 'Banda Aceh', group: 'Sumatra (WIB)', lat: 5.5483, lon: 95.3238, tz: 7 },
    { id: 'medan', name: 'Kota Medan', group: 'Sumatra (WIB)', lat: 3.5952, lon: 98.6722, tz: 7 },
    { id: 'padang', name: 'Kota Padang', group: 'Sumatra (WIB)', lat: -0.9471, lon: 100.4172, tz: 7 },
    { id: 'pekanbaru', name: 'Kota Pekanbaru', group: 'Sumatra (WIB)', lat: 0.5071, lon: 101.4478, tz: 7 },
    { id: 'batam', name: 'Kota Batam', group: 'Sumatra (WIB)', lat: 1.1301, lon: 104.0529, tz: 7 },
    { id: 'jambi', name: 'Kota Jambi', group: 'Sumatra (WIB)', lat: -1.6101, lon: 103.6131, tz: 7 },
    { id: 'palembang', name: 'Kota Palembang', group: 'Sumatra (WIB)', lat: -2.9761, lon: 104.7754, tz: 7 },
    { id: 'bengkulu', name: 'Kota Bengkulu', group: 'Sumatra (WIB)', lat: -3.8004, lon: 102.2655, tz: 7 },
    { id: 'bandar-lampung', name: 'Bandar Lampung', group: 'Sumatra (WIB)', lat: -5.3971, lon: 105.2668, tz: 7 },
    { id: 'pangkalpinang', name: 'Pangkalpinang', group: 'Sumatra (WIB)', lat: -2.1289, lon: 106.1136, tz: 7 },
    { id: 'tanjungpinang', name: 'Tanjungpinang', group: 'Sumatra (WIB)', lat: 0.9186, lon: 104.4558, tz: 7 },

    // ————————————————————————— Kalimantan Barat & Tengah (WIB)
    { id: 'pontianak', name: 'Kota Pontianak', group: 'Kalimantan Barat/Tengah (WIB)', lat: -0.0263, lon: 109.3425, tz: 7 },
    { id: 'palangkaraya', name: 'Palangka Raya', group: 'Kalimantan Barat/Tengah (WIB)', lat: -2.2100, lon: 113.9200, tz: 7 },

    // ————————————————————————— WITA (+8)
    { id: 'banjarmasin', name: 'Banjarmasin', group: 'WITA (+8)', lat: -3.3194, lon: 114.5906, tz: 8 },
    { id: 'balikpapan', name: 'Balikpapan', group: 'WITA (+8)', lat: -1.2379, lon: 116.8529, tz: 8 },
    { id: 'samarinda', name: 'Samarinda', group: 'WITA (+8)', lat: -0.5022, lon: 117.1536, tz: 8 },
    { id: 'tarakan', name: 'Tarakan', group: 'WITA (+8)', lat: 3.3000, lon: 117.6333, tz: 8 },
    { id: 'denpasar', name: 'Denpasar (Bali)', group: 'WITA (+8)', lat: -8.6705, lon: 115.2126, tz: 8 },
    { id: 'mataram', name: 'Mataram (NTB)', group: 'WITA (+8)', lat: -8.5833, lon: 116.1167, tz: 8 },
    { id: 'kupang', name: 'Kupang (NTT)', group: 'WITA (+8)', lat: -10.1772, lon: 123.6070, tz: 8 },
    { id: 'makassar', name: 'Kota Makassar', group: 'WITA (+8)', lat: -5.1477, lon: 119.4327, tz: 8 },
    { id: 'parepare', name: 'Parepare', group: 'WITA (+8)', lat: -4.0135, lon: 119.6255, tz: 8 },
    { id: 'palu', name: 'Kota Palu', group: 'WITA (+8)', lat: -0.8917, lon: 119.8707, tz: 8 },
    { id: 'kendari', name: 'Kota Kendari', group: 'WITA (+8)', lat: -3.9985, lon: 122.5127, tz: 8 },
    { id: 'manado', name: 'Kota Manado', group: 'WITA (+8)', lat: 1.4748, lon: 124.8421, tz: 8 },
    { id: 'gorontalo', name: 'Kota Gorontalo', group: 'WITA (+8)', lat: 0.5435, lon: 123.0568, tz: 8 },
    { id: 'mamuju', name: 'Mamuju (Sulbar)', group: 'WITA (+8)', lat: -2.6748, lon: 118.8885, tz: 8 },

    // ————————————————————————— WIT (+9)
    { id: 'ambon', name: 'Kota Ambon', group: 'WIT (+9)', lat: -3.6954, lon: 128.1814, tz: 9 },
    { id: 'ternate', name: 'Ternate', group: 'WIT (+9)', lat: 0.7900, lon: 127.3800, tz: 9 },
    { id: 'sofifi', name: 'Sofifi (Malut)', group: 'WIT (+9)', lat: 0.7333, lon: 127.5500, tz: 9 },
    { id: 'sorong', name: 'Sorong', group: 'WIT (+9)', lat: -0.8762, lon: 131.2558, tz: 9 },
    { id: 'manokwari', name: 'Manokwari', group: 'WIT (+9)', lat: -0.8615, lon: 134.0620, tz: 9 },
    { id: 'jayapura', name: 'Kota Jayapura', group: 'WIT (+9)', lat: -2.5330, lon: 140.7180, tz: 9 },
    { id: 'merauke', name: 'Merauke', group: 'WIT (+9)', lat: -8.4932, lon: 140.4018, tz: 9 },
];

// Urutan optgroup di UI.
export const PRAYER_LOCATION_GROUPS = [
    'Jawa Timur (WIB)',
    'Jawa & sekitarnya (WIB)',
    'Sumatra (WIB)',
    'Kalimantan Barat/Tengah (WIB)',
    'WITA (+8)',
    'WIT (+9)',
];

/** Cocokkan koordinat tersimpan ke preset terdekat (dalam ~3 km) supaya dropdown menampilkan pilihan aktif. */
export function matchLocation(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return null;
    let best = null;
    let bestD = Infinity;
    for (const loc of PRAYER_LOCATIONS) {
        const d = Math.abs(loc.lat - la) + Math.abs(loc.lon - lo);
        if (d < bestD) { bestD = d; best = loc; }
    }
    return bestD <= 0.03 ? best : null; // ~3 km ambang
}
