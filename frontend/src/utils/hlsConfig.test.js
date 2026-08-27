/*
 * Purpose: Kunci bahwa konfigurasi HLS benar-benar menyesuaikan perangkat, dan bahwa preset
 *          ponselnya TIDAK memperpendek timeout pemuatan.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Seluruh preset ponsel di hlsConfig.js adalah KODE MATI sejak ditulis: ketiga pemutar meneruskan
 * `isMobile: false` yang di-hardcode, jadi tidak satu pun nilainya pernah dipakai di produksi.
 * Tidak ada tes yang bisa memberi tahu, karena tidak ada tes sama sekali untuk berkas itu.
 *
 * Dua hal yang dikunci di sini, dan keduanya pernah salah:
 *   1. Konfigurasinya HARUS berubah mengikuti perangkat - kalau tidak, presetnya mati lagi.
 *   2. Preset ponsel TIDAK BOLEH memperpendek timeout pemuatan. Nilai 10 dtk yang dulu ada di
 *      sana tidak pernah teruji di lapangan; 30 dtk milik tier sudah bertahun-tahun berjalan,
 *      pada armada yang justru paling rentan latensi (seluler Indonesia lewat Cloudflare SIN).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const kemampuan = vi.fn();
vi.mock('./deviceDetector.js', () => ({
    getDeviceCapabilities: (...a) => kemampuan(...a),
}));

const { getDeviceHLSConfig, getHLSConfig } = await import('./hlsConfig.js');

beforeEach(() => kemampuan.mockReset());

describe('konfigurasi HLS mengikuti perangkat yang sedang dipakai', () => {
    it('memakai preset ponsel pada ponsel - bukan kode mati', () => {
        kemampuan.mockReturnValue({ tier: 'medium', isMobile: true, mobileDeviceType: 'phone' });
        const ponsel = getDeviceHLSConfig();

        kemampuan.mockReturnValue({ tier: 'medium', isMobile: false, mobileDeviceType: 'desktop' });
        const meja = getDeviceHLSConfig();

        expect(ponsel.maxBufferLength).toBeLessThan(meja.maxBufferLength);
        expect(ponsel.maxBufferSize).toBeLessThan(meja.maxBufferSize);
    });

    it('TIDAK memperpendek timeout pemuatan di ponsel', () => {
        kemampuan.mockReturnValue({ tier: 'medium', isMobile: true, mobileDeviceType: 'phone' });
        const ponsel = getDeviceHLSConfig();
        const meja = getHLSConfig('medium');

        for (const kunci of ['fragLoadingTimeOut', 'levelLoadingTimeOut', 'manifestLoadingTimeOut']) {
            expect(ponsel[kunci], `${kunci} diperpendek di ponsel`).toBe(meja[kunci]);
        }
    });

    it('tablet juga mendapat buffer lebih kecil daripada desktop, tapi lebih besar dari ponsel', () => {
        kemampuan.mockReturnValue({ tier: 'medium', isMobile: true, mobileDeviceType: 'tablet' });
        const tablet = getDeviceHLSConfig();
        kemampuan.mockReturnValue({ tier: 'medium', isMobile: true, mobileDeviceType: 'phone' });
        const ponsel = getDeviceHLSConfig();

        expect(tablet.maxBufferLength).toBeGreaterThan(ponsel.maxBufferLength);
        expect(tablet.maxBufferLength).toBeLessThan(getHLSConfig('medium').maxBufferLength);
    });

    it('meneruskan override pemanggil di atas hasil perangkat', () => {
        kemampuan.mockReturnValue({ tier: 'medium', isMobile: true, mobileDeviceType: 'phone' });
        expect(getDeviceHLSConfig({ maxBufferLength: 99 }).maxBufferLength).toBe(99);
    });
});
