/**
 * Purpose: Satu endpoint publik yang mengembalikan SATU penghuni untuk satu slot komersial.
 * Caller: routes/commercialSlotRoutes.js.
 * Deps: commercialSlotService, affiliateOfferService.recordImpression,
 *       promoBannerService.recordImpression, affiliateCountThrottle, rateLimiter.resolveClientIp.
 * MainFuncs: getCommercialSlot.
 * SideEffects: Menulis satu impresi — untuk PEMENANG saja.
 *
 * KENAPA IMPRESINYA DIHITUNG DI SINI
 * ----------------------------------
 * Sebelum ada arbiter, tiap sistem menghitung impresinya sendiri saat resolve. Karena keduanya
 * dipasang berdampingan, satu tampilan halaman mencatat DUA impresi untuk dua blok yang keduanya
 * memang tampil. Sekarang hanya satu yang tampil, jadi hanya satu yang boleh dihitung — kalau
 * tidak, angkanya menghitung sesuatu yang tidak pernah dilihat siapa pun.
 *
 * THROTTLE YANG SAMA UNTUK KEDUANYA, dan ini memperbaiki ketimpangan lama. Klik dan impresi
 * afiliasi selama ini lewat throttle 10 detik; promo lewat NOL, sementara klien mengulang GET
 * sampai dua kali pada galat jaringan. Akibatnya angka promo menggelembung relatif terhadap
 * afiliasi dan keduanya tidak pernah sepadan dibandingkan. Semua yang lewat jalur ini memakai
 * jendela yang sama, jadi angka dari jalur ini bisa dibandingkan.
 */

import { resolveCommercialSlot } from '../services/commercialSlotService.js';
import affiliateOfferService from '../services/affiliateOfferService.js';
import { recordImpression as recordPromoImpression } from '../services/promoBannerService.js';
import { allowCount } from '../utils/affiliateCountThrottle.js';
import { resolveClientIp } from '../middleware/rateLimiter.js';
import { logControllerError } from '../utils/controllerErrorLog.js';

/** Id numerik positif, atau null. Bentuk yang sama dipakai kedua penyelesai. */
function parseId(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Apakah klien menyatakan konteks ini sudah dihitung hari ini.
 *
 * Hanya '1' / 1 / 'true' yang diterima. Sengaja tidak memakai truthiness mentah: `counted=0`
 * dan `counted=false` datang dari klien yang bermaksud "belum", dan keduanya truthy sebagai
 * string - membacanya terbalik akan MENGHENTIKAN penghitungan sepenuhnya, diam-diam.
 */
function sudahDihitungKlien(nilai) {
    return nilai === '1' || nilai === 1 || nilai === 'true';
}

/**
 * Tulis impresi untuk pemenang. Best-effort: penghitung tidak pernah boleh membuat pengunjung
 * kehilangan blok yang seharusnya ia lihat — tapi kegagalannya ditelan dengan BERISIK, karena
 * kedua layanan memang dispesifikasikan menjaga UPSERT-nya sendiri dan seharusnya tidak melempar.
 */
function catatImpresi(request, hasil, placement) {
    try {
        const kunci = `${resolveClientIp(request)}:slot:${hasil.kind}:${hasil.content.id}:${placement}`;
        if (!allowCount(kunci)) return;

        if (hasil.kind === 'affiliate') {
            affiliateOfferService.recordImpression(hasil.content.id, placement);
        } else {
            recordPromoImpression(hasil.content.id);
        }
    } catch (error) {
        logControllerError('Commercial slot impression write failed', error);
    }
}

/**
 * GET /api/public/slot?placement=popup&cameraId=123
 *
 * Selalu 200 dengan `data: null` saat tidak ada yang layak — "tidak ada penghuni" adalah jawaban
 * yang sah, bukan galat, dan memberi 404 akan membuat klien menampilkan pesan untuk keadaan yang
 * sepenuhnya normal.
 */
export async function getCommercialSlot(request, reply) {
    reply.header('Cache-Control', 'no-store');
    try {
        const { placement, cameraId, areaId, counted } = request.query || {};
        const surface = typeof placement === 'string' ? placement : '';

        const hasil = resolveCommercialSlot({
            placement: surface,
            cameraId: parseId(cameraId),
            areaId: parseId(areaId),
        });

        /*
         * `counted=1` berarti klien sudah punya penanda "konteks ini dihitung hari ini".
         *
         * Penjaga hariannya HARUS tinggal di klien, bukan di sini: penjaga di server berkunci IP,
         * dan di balik CGNAT satu IP adalah banyak orang - menjadikannya harian akan menghitung
         * satu impresi untuk sekampung. Penanda per-sesi-peramban identitas yang jauh lebih baik.
         *
         * Klien nakal bisa selalu mengirimnya dan membuat angkanya KURANG. Itu pertukaran yang
         * disengaja: arah sebaliknya - menggelembungkan impresi mitra yang membayar - jauh lebih
         * mahal, dan itu tetap dijaga throttle 10 detik di bawah.
         */
        if (hasil && !sudahDihitungKlien(counted)) {
            catatImpresi(request, hasil, surface);
        }

        return reply.send({ success: true, data: hasil || null });
    } catch (error) {
        logControllerError('Commercial slot resolve', error);
        // Halaman publik tidak pernah menampilkan galat untuk blok komersial: yang gagal
        // menghilang, dan pengunjung tidak pernah tahu ada yang tidak beres.
        return reply.send({ success: true, data: null });
    }
}

export default { getCommercialSlot };
