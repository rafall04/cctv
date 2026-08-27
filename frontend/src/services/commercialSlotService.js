/**
 * Purpose: Ambil SATU penghuni untuk satu slot komersial, satu kali per konteks per hari.
 * Caller: components/commerce/CommercialSlot.jsx.
 * Deps: apiClient.
 * MainFuncs: resolveCommercialSlotOnce, clearCommercialSlotCache.
 * SideEffects: Satu GET per konteks per hari (GET itulah yang menghitung impresi di server);
 *          membaca/menulis beberapa kunci sessionStorage.
 *
 * KENAPA ADA PENJAGA SATU-KALI-PER-HARI
 * -------------------------------------
 * GET-nya sendiri yang menghitung impresi di server, dan popup dibuka-tutup-dibuka terus-menerus
 * pada kamera yang sama. Lebih dari itu, `apiClient` MENGULANG GET yang gagal dua kali setelah
 * tunnel menyambung ulang - dan tiap pengulangan adalah impresi baru. Tanpa penjaga ini, lima kali
 * membuka kamera yang sama tercatat lima impresi untuk satu orang yang melihat satu blok.
 *
 * Penjaga ini SENGAJA berlaku untuk kedua jenis penghuni. Sebelum ada arbiter, hanya afiliasi yang
 * punya penjaga sementara promo tidak sama sekali - alasannya waktu itu masuk akal ("iklan milik
 * sendiri boleh longgar, statistik mitra berfaktur tidak"), tapi akibatnya angka keduanya tidak
 * pernah sepadan dibandingkan. Begitu keduanya berebut slot yang sama, membandingkannya menjadi
 * keharusan, jadi keduanya kini memakai disiplin yang lebih ketat.
 *
 * Hanya hasil POSITIF yang di-cache. Konteks tanpa penghuni ditanyakan lagi lain kali - tidak ada
 * impresi yang perlu dilindungi, dan menyimpan "tidak ada apa-apa" untuk satu sesi penuh akan
 * menyembunyikan tawaran yang baru diterbitkan operator saat pengunjung masih menjelajah.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';
import { sanitizePublicOffer } from './affiliateService';

const BASE = '/api/public/slot';

/** Namespace sessionStorage. Sesi, bukan localStorage - lihat catatan di bawah. */
const PREFIX = 'raf:slot:';

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
 * Satu penghuni untuk satu konteks, paling banyak satu panggilan jaringan per hari per sesi.
 *
 * @param {{placement: string, cameraId?: number, areaId?: number}} ctx
 * @returns {Promise<{kind: string, content: object}|null>}
 */
export async function resolveCommercialSlotOnce({ placement, cameraId, areaId } = {}) {
    if (!placement) return null;

    const kunci = kunciKonteks(placement, cameraId, areaId, hariIni());
    const tersimpan = baca(kunci);
    if (tersimpan) {
        try {
            return JSON.parse(tersimpan);
        } catch {
            /* nilai rusak: perlakukan seperti belum pernah diambil */
        }
    }

    try {
        const response = await apiClient.get(BASE, {
            params: {
                placement,
                ...(cameraId ? { cameraId } : {}),
                ...(areaId ? { areaId } : {}),
            },
            requestPolicy: REQUEST_POLICY.SILENT_PUBLIC,
        });
        const data = response.data?.data;
        if (!data?.kind || !data?.content) return null;

        const bersih = disaring(data);
        if (!bersih) return null;

        tulis(kunci, JSON.stringify(bersih));
        return bersih;
    } catch {
        // Blok komersial yang gagal dimuat tidak pernah boleh muncul sebagai galat di halaman
        // publik. Yang gagal menghilang, dan pengunjung tidak pernah tahu ada yang tidak beres.
        return null;
    }
}

/** Untuk tes dan untuk operator yang baru mengubah penempatan lalu ingin melihat hasilnya. */
export function clearCommercialSlotCache() {
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
