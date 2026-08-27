/**
 * Purpose: Pilih SATU penghuni untuk satu slot komersial, dari beberapa sistem yang sebelumnya
 *          tidak saling tahu.
 * Caller: controllers/commercialSlotController.js.
 * Deps: affiliateOfferService, promoBannerService.
 * MainFuncs: resolveCommercialSlot.
 * SideEffects: None — pemanggilnya yang mencatat impresi, dan hanya untuk pemenang.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Empat sistem konten komersial berebut permukaan yang sama tanpa satu pun tahu yang lain ada:
 * `grep affiliate` di promoBannerService mengembalikan NOL hasil, dan sebaliknya. Karena tiap
 * sistem memutuskan sendiri, satu popup bisa menumpuk kartu afiliasi DAN banner promo DAN dua
 * slot iklan di bawah satu video — di layar ponsel, yang dipakai 79% penonton.
 *
 * Yang dijual permukaan ini bukan impresi, melainkan KELANGKAAN. CTR afiliasi terukur 12,6%
 * sementara norma banner display di bawah 1%; angka setinggi itu muncul karena satu tawaran
 * relevan tampil sendirian. Menambah blok menguji asumsi itu dengan risiko yang tidak setara —
 * pendapatan tambahan bisa dihitung, tetapi 66 orang yang membuka kamera yang sama sepuluh kali
 * sebulan tidak bisa ditarik kembali setelah pergi.
 *
 * KOMPOSISI, BUKAN PENULISAN ULANG
 * Kedua penyelesai yang ada sudah punya tanda tangan yang sama persis dan sudah menangani
 * kekhususan (kamera > area > semua) di dalam dirinya. Berkas ini tidak menyentuh satu baris pun
 * di sana; ia hanya memanggil keduanya berurutan dan berhenti di yang pertama cocok.
 */

import affiliateOfferService from './affiliateOfferService.js';
import { resolvePromoBannerForContext } from './promoBannerService.js';

/** Permukaan yang punya slot komersial. Sama persis dengan kosakata kedua penyelesai. */
export const SLOT_PLACEMENTS = ['popup', 'area', 'landing', 'playback'];

/**
 * Apakah promo ini bisa ditindaklanjuti pengunjung.
 *
 * Promo tanpa tujuan bukan sekadar tidak berguna — ia MERUGIKAN: ia memakai slot yang bisa diisi
 * tawaran yang bisa diklik, dan ia mengajari pengunjung bahwa blok di halaman ini tidak melakukan
 * apa-apa. Banner "Pemasangan CCTV Gratis" tercatat 1.402 impresi dengan 0 klik justru karena
 * `cta_url` dan `whatsapp_number` sama-sama kosong sehingga tombolnya tidak pernah dirender.
 *
 * `image_base` ikut disyaratkan dengan alasan yang sama seperti di PromoBanner: "tidak ada promo"
 * bisa tiba sebagai objek kosong yang cukup truthy untuk merender <img> yang rusak.
 */
function dapatDitindak(promo) {
    return Boolean(promo?.image_base) && Boolean(promo?.cta_url);
}

/**
 * Satu pemenang untuk satu slot, atau null bila tidak ada yang layak.
 *
 * TANGGA PRIORITAS (berhenti di yang pertama cocok):
 *   1. Tawaran afiliasi — penyelesainya sendiri sudah memeringkat kamera > area > semua
 *   2. Promo milik sendiri, HANYA bila bisa ditindaklanjuti
 *   3. Tidak ada — slotnya tidak dirender sama sekali, tanpa rangka dan tanpa tinggi cadangan
 *
 * Relevansi mengalahkan kepemilikan: tawaran yang ditargetkan ke kamera yang sedang ditonton
 * menang atas iklan milik sendiri. Itulah susunan yang menghasilkan 12,6%, bukan urutan siapa
 * yang punya halaman.
 *
 * CATATAN yang sengaja belum dikunci: peringkat promo harus ditinjau ulang setelah `cta_url`-nya
 * diperbaiki, karena angka 1.402/0 hari ini adalah artefak bug, bukan bukti bahwa promo tidak
 * laku. Nilai satu lead pemasangan jauh di atas komisi afiliasi; kalau pengukuran membenarkan
 * itu, tangga ini dibalik.
 *
 * @param {{placement: string, cameraId?: number|null, areaId?: number|null}} context
 * @returns {{kind: 'affiliate'|'promo', content: object}|null}
 */
export function resolveCommercialSlot({ placement, cameraId = null, areaId = null } = {}) {
    if (!SLOT_PLACEMENTS.includes(placement)) return null;

    const offer = affiliateOfferService.resolveOfferForContext({ placement, cameraId, areaId });
    if (offer) {
        return { kind: 'affiliate', content: offer };
    }

    const promo = resolvePromoBannerForContext({ placement, cameraId, areaId });
    if (dapatDitindak(promo)) {
        return { kind: 'promo', content: promo };
    }

    return null;
}

export default { resolveCommercialSlot, SLOT_PLACEMENTS };
