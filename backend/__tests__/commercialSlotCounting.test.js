/**
 * Purpose: Kunci gerbang penghitung slot komersial — kapan impresi ditulis, dan kapan tidak.
 * Caller: Backend test gate (vitest, node env).
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Penjaga "satu impresi per konteks per hari" dulunya tinggal di peramban sebagai singgahan
 * MUATAN: sekali sebuah slot terselesaikan, salinannya dipakai ulang seharian. Hitungannya benar,
 * tapi operator yang menyunting judul tawaran di panel admin TIDAK PERNAH melihat hasilnya di
 * halaman publik sampai tabnya ditutup — terjadi sungguhan pada "CCTV Imou PS3D 3MP", 2026-08-27.
 * Bentuk kegagalan yang jahat: satu-satunya cara memeriksa suntingan berhasil adalah melihat
 * halaman publik, dan justru itu yang berbohong.
 *
 * Sekarang klien SELALU mengambil yang segar dan hanya mengingat "konteks ini sudah dihitung hari
 * ini", lalu mengirimnya balik sebagai `counted=1`. Berkas ini menjaga sisi server dari kontrak itu.
 *
 * Penjaga hariannya TIDAK boleh pindah ke server: penjaga server berkunci IP, dan di balik CGNAT
 * satu IP adalah banyak orang — menjadikannya harian akan menghitung satu impresi untuk sekampung.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordImpression = vi.fn();
const recordPromoImpression = vi.fn();
const resolveCommercialSlot = vi.fn();

vi.mock('../services/commercialSlotService.js', () => ({
    resolveCommercialSlot: (...a) => resolveCommercialSlot(...a),
    SLOT_PLACEMENTS: ['popup', 'area', 'landing', 'playback'],
}));
vi.mock('../services/affiliateOfferService.js', () => ({
    default: { recordImpression: (...a) => recordImpression(...a) },
}));
/* Controller mengimpornya sebagai `recordImpression`, dialiaskan jadi recordPromoImpression. */
vi.mock('../services/promoBannerService.js', () => ({
    recordImpression: (...a) => recordPromoImpression(...a),
}));
vi.mock('../middleware/rateLimiter.js', () => ({ resolveClientIp: () => '203.0.113.7' }));

const { getCommercialSlot } = await import('../controllers/commercialSlotController.js');
const { _resetThrottleForTests } = await import('../utils/affiliateCountThrottle.js');

const TAWARAN = { kind: 'affiliate', content: { id: 4, product_title: 'CCTV Imou PS3D 3MP' } };
const PROMO = { kind: 'promo', content: { id: 3, title: 'Pemasangan CCTV Gratis' } };

function permintaan(query) {
    return { query, headers: {} };
}

function balasan() {
    return {
        payload: undefined,
        headers: {},
        header(k, v) { this.headers[k] = v; return this; },
        code() { return this; },
        send(p) { this.payload = p; return this; },
    };
}

const panggil = async (query) => {
    const reply = balasan();
    await getCommercialSlot(permintaan(query), reply);
    return reply;
};

beforeEach(() => {
    vi.clearAllMocks();
    _resetThrottleForTests();
    resolveCommercialSlot.mockReturnValue(TAWARAN);
});

describe('gerbang penghitung', () => {
    it('TANPA penanda: impresi ditulis', async () => {
        await panggil({ placement: 'popup', cameraId: '1444' });

        expect(recordImpression).toHaveBeenCalledWith(4, 'popup');
    });

    it('DENGAN counted=1: impresi TIDAK ditulis', async () => {
        await panggil({ placement: 'popup', cameraId: '1444', counted: '1' });

        expect(recordImpression).not.toHaveBeenCalled();
    });

    it('promo mengikuti gerbang yang sama', async () => {
        resolveCommercialSlot.mockReturnValue(PROMO);

        await panggil({ placement: 'landing', counted: '1' });
        expect(recordPromoImpression).not.toHaveBeenCalled();

        _resetThrottleForTests();
        await panggil({ placement: 'landing' });
        expect(recordPromoImpression).toHaveBeenCalledWith(3);
    });

    it('ISINYA tetap disajikan penuh walaupun tidak dihitung', async () => {
        // Ini inti perbaikannya: tidak menghitung BUKAN alasan menahan isinya. Kalau keduanya
        // ikut dilewati, judul yang baru disunting tetap tidak akan pernah sampai.
        const reply = await panggil({ placement: 'popup', cameraId: '1444', counted: '1' });

        expect(reply.payload.data.content.product_title).toBe('CCTV Imou PS3D 3MP');
    });
});

describe('penanda dibaca ketat, bukan lewat truthiness', () => {
    /*
     * `counted=0` dan `counted=false` datang dari klien yang bermaksud "belum", dan KEDUANYA
     * truthy sebagai string. Membacanya lewat truthiness mentah akan menghentikan penghitungan
     * sepenuhnya, diam-diam, pada klien mana pun yang mengirim bentuk itu.
     */
    for (const nilai of ['0', 'false', '', 'yes', 'null', '2']) {
        it(`counted=${JSON.stringify(nilai)} TIDAK dianggap sudah dihitung`, async () => {
            await panggil({ placement: 'popup', cameraId: '1444', counted: nilai });

            expect(recordImpression).toHaveBeenCalled();
        });
    }

    for (const nilai of ['1', 1, 'true']) {
        it(`counted=${JSON.stringify(nilai)} dianggap sudah dihitung`, async () => {
            await panggil({ placement: 'popup', cameraId: '1444', counted: nilai });

            expect(recordImpression).not.toHaveBeenCalled();
        });
    }
});

describe('throttle 10 detik tetap jadi lapis kedua', () => {
    it('dua permintaan beruntun tanpa penanda hanya menulis satu impresi', async () => {
        // Ini yang menangkap pengulangan GET oleh apiClient (400ms/1200ms) sesudah tunnel putus.
        await panggil({ placement: 'popup', cameraId: '1444' });
        await panggil({ placement: 'popup', cameraId: '1444' });

        expect(recordImpression).toHaveBeenCalledTimes(1);
    });

    it('konteks berbeda tidak saling memblokir', async () => {
        await panggil({ placement: 'popup', cameraId: '1444' });
        await panggil({ placement: 'playback', cameraId: '1444' });

        expect(recordImpression).toHaveBeenCalledTimes(2);
    });
});

describe('tanpa penghuni tidak ada yang dihitung', () => {
    it('data null, nol tulisan', async () => {
        resolveCommercialSlot.mockReturnValue(null);

        const reply = await panggil({ placement: 'popup', cameraId: '1444' });

        expect(reply.payload).toEqual({ success: true, data: null });
        expect(recordImpression).not.toHaveBeenCalled();
        expect(recordPromoImpression).not.toHaveBeenCalled();
    });

    it('respons selalu no-store - tidak ada perantara yang boleh memutarnya ulang', async () => {
        const reply = await panggil({ placement: 'popup', cameraId: '1444' });

        expect(reply.headers['Cache-Control']).toBe('no-store');
    });
});
