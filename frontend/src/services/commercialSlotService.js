/**
 * Purpose: Ambil SATU penghuni untuk satu slot komersial, satu kali per konteks per hari.
 * Caller: components/commerce/CommercialSlot.jsx.
 * Deps: apiClient.
 * MainFuncs: resolveCommercialSlotOnce, clearCommercialSlotCache.
 * SideEffects: Satu GET per konteks per hari (GET itulah yang menghitung impresi di server);
 *          membaca/menulis beberapa kunci sessionStorage.
 *
 * KENAPA YANG DIINGAT ADALAH "SUDAH DIHITUNG", BUKAN ISINYA
 * ---------------------------------------------------------
 * GET-nya sendiri yang menghitung impresi di server, dan popup dibuka-tutup-dibuka terus-menerus
 * pada kamera yang sama. Lebih dari itu, `apiClient` MENGULANG GET yang gagal dua kali setelah
 * tunnel menyambung ulang - dan tiap pengulangan adalah impresi baru. Tanpa penjaga, lima kali
 * membuka kamera yang sama tercatat lima impresi untuk satu orang yang melihat satu blok.
 *
 * Versi pertama penjaga ini menyimpan MUATANNYA dan memakainya kembali seharian. Itu memperbaiki
 * hitungan dan merusak hal lain yang lebih penting: operator yang menyunting judul tawaran di
 * panel admin TIDAK PERNAH melihat hasilnya di tabnya sendiri - halaman publik terus menyajikan
 * salinan lama sampai tabnya ditutup. Terjadi sungguhan, 2026-08-27, pada 'CCTV Imou PS3D 3MP'.
 * Dan bentuk kegagalannya jahat: satu-satunya cara memeriksa suntingan Anda berhasil adalah
 * melihat halaman publik, dan justru itu yang berbohong.
 *
 * Jadi isinya TIDAK PERNAH lagi disinggahkan - tiap pemasangan mengambil yang segar. Yang
 * tersimpan hanya satu penanda "konteks ini sudah dihitung hari ini", dan penanda itu dikirim
 * balik sebagai `counted=1` supaya server tahu jangan menghitungnya lagi. Muatannya kecil dan
 * sudah `no-store`; yang mahal itu impresinya, bukan bytenya.
 *
 * Penjaga 10 detik per-IP di server tetap ada sebagai lapis kedua - ia yang menangkap pengulangan
 * apiClient - tapi ia terlalu pendek untuk menjadi penjaga harian, dan berbasis IP, yang di balik
 * CGNAT menyatukan banyak orang. Penanda per-sesi-peramban identitas yang lebih baik.
 *
 * Penjaga ini SENGAJA berlaku untuk kedua jenis penghuni. Sebelum ada arbiter, hanya afiliasi yang
 * punya penjaga sementara promo tidak sama sekali - alasannya waktu itu masuk akal ("iklan milik
 * sendiri boleh longgar, statistik mitra berfaktur tidak"), tapi akibatnya angka keduanya tidak
 * pernah sepadan dibandingkan. Begitu keduanya berebut slot yang sama, membandingkannya menjadi
 * keharusan, jadi keduanya kini memakai disiplin yang lebih ketat.
 *
 * Penanda hanya ditulis untuk hasil POSITIF. Konteks tanpa penghuni tidak punya impresi yang perlu
 * dilindungi, dan menandainya akan membuat tawaran yang baru diterbitkan operator gagal dihitung
 * saat pengunjung yang sama akhirnya melihatnya.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';
import { sanitizePublicOffer } from './affiliateService';

const BASE = '/api/public/slot';

/**
 * Namespace sessionStorage. Sesi, bukan localStorage - penjaganya ada untuk mencegah pengulangan
 * yang TIDAK DISENGAJA, bukan untuk mengikat seseorang lintas hari.
 *
 * Awalannya berganti dari 'raf:slot:' supaya kunci lama yang MASIH MEMUAT MUATAN BASI di tab yang
 * sedang terbuka tidak pernah terbaca lagi oleh kode baru.
 */
const PREFIX = 'raf:slot-counted:';

/** Hari kalender lokal. Impresi dihitung per hari, jadi penjaganya juga. */
function hariIni() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/*
 * Akses sessionStorage dibungkus di kedua sisi: Safari mode privat dan peramban tertanam yang
 * diperketat bisa MELEMPAR saat diakses, bukan sekadar mengembalikan null. Penjaga impresi tidak
 * pernah boleh membuat pengunjung kehilangan blok yang seharusnya ia lihat.
 */
function baca(kunci) {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(kunci) : null;
    } catch {
        return null;
    }
}

function tulis(kunci, nilai) {
    try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(kunci, nilai);
    } catch {
        /* penuh atau diblokir - penjaga yang hilang jauh lebih murah daripada blok yang hilang */
    }
}

/**
 * Kunci menyebutkan LINGKUP yang dimaksudnya, tidak menumpang pada kebetulan.
 *
 * Placement ikut di kunci karena satu pengunjung yang berpindah beranda -> area -> kamera memang
 * sah menghasilkan tiga impresi: menggabungkannya membuat "barang ini menarik" tidak bisa
 * dibedakan dari "kami memasangnya di lebih banyak tempat".
 */
function kunciKonteks(placement, cameraId, areaId, hari) {
    return `${PREFIX}${hari}:${placement}:c${cameraId || 0}:a${areaId || 0}`;
}

/**
 * Buang kunci singgahan versi lama yang masih memuat muatan.
 *
 * Tanpa ini, tab yang sudah terbuka sejak sebelum perbaikan tetap menyimpan judul lama sampai
 * ditutup - dan pengunjung yang paling setia justru yang tabnya paling lama terbuka.
 */
function buangSinggahanLama() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        for (const kunci of Object.keys(sessionStorage)) {
            if (kunci.startsWith('raf:slot:')) sessionStorage.removeItem(kunci);
        }
    } catch {
        /* tidak bisa diakses: tidak ada yang perlu dibersihkan */
    }
}

/*
 * Muatan afiliasi menjadi <a href> dan <img src> di halaman publik, jadi ia harus lewat penyaring
 * yang sama seperti sebelum ada arbiter: hanya kunci yang diizinkan disalin, dan tiap nilai yang
 * jadi tautan divonis dulu (skema http/https saja, /go internal saja, wa.me saja). Melewatkannya
 * berarti satu baris DB yang salah - atau sisi server yang meregresi - bisa menaruh javascript:
 * di halaman yang dilihat 605 orang sebulan.
 *
 * Promo TIDAK punya penyaring sisi klien dan memang tidak pernah punya, jadi ia diteruskan apa
 * adanya - bukan kelalaian di sini, melainkan keadaan yang sudah ada sebelum berkas ini.
 */
function disaring(data) {
    if (data.kind !== 'affiliate') return data;
    const bersih = sanitizePublicOffer(data.content);
    // Tawaran yang tidak lolos berarti tidak ada penghuni sama sekali - BUKAN kartu setengah jadi.
    return bersih ? { kind: 'affiliate', content: bersih } : null;
}

/**
 * Satu penghuni untuk satu konteks. Isinya SELALU segar; yang paling banyak sekali per hari per
 * sesi adalah IMPRESINYA, bukan permintaannya.
 *
 * @param {{placement: string, cameraId?: number, areaId?: number}} ctx
 * @returns {Promise<{kind: string, content: object}|null>}
 */
export async function resolveCommercialSlotOnce({ placement, cameraId, areaId } = {}) {
    if (!placement) return null;

    buangSinggahanLama();

    const kunci = kunciKonteks(placement, cameraId, areaId, hariIni());
    const sudahDihitung = Boolean(baca(kunci));

    try {
        const response = await apiClient.get(BASE, {
            params: {
                placement,
                ...(cameraId ? { cameraId } : {}),
                ...(areaId ? { areaId } : {}),
                // Hanya dikirim ketika memang sudah dihitung: parameter yang selalu ada akan
                // membelah cache edge tanpa alasan dan menyembunyikan maksudnya di log.
                ...(sudahDihitung ? { counted: 1 } : {}),
            },
            requestPolicy: REQUEST_POLICY.SILENT_PUBLIC,
        });
        const data = response.data?.data;
        if (!data?.kind || !data?.content) return null;

        const bersih = disaring(data);
        if (!bersih) return null;

        // Ditandai SESUDAH jawaban positif: konteks kosong tidak punya impresi untuk dilindungi.
        if (!sudahDihitung) tulis(kunci, '1');
        return bersih;
    } catch {
        // Blok komersial yang gagal dimuat tidak pernah boleh muncul sebagai galat di halaman
        // publik. Yang gagal menghilang, dan pengunjung tidak pernah tahu ada yang tidak beres.
        return null;
    }
}

/** Untuk tes, dan untuk melepas penjaga hitungan saat menguji sesuatu berulang kali. */
export function clearCommercialSlotCache() {
    buangSinggahanLama();
    try {
        if (typeof sessionStorage === 'undefined') return;
        for (const kunci of Object.keys(sessionStorage)) {
            if (kunci.startsWith(PREFIX)) sessionStorage.removeItem(kunci);
        }
    } catch {
        /* tidak bisa diakses: tidak ada yang perlu dibersihkan */
    }
}

export default { resolveCommercialSlotOnce, clearCommercialSlotCache };
