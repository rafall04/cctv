/*
 * Purpose: Kunci dua perilaku yang paling mudah salah pada status jam kamera.
 * Caller: vitest.
 * Deps: connectionPool di-mock; tidak menyentuh DB sungguhan.
 *
 * KENAPA DUA HAL INI YANG DIUJI
 * -----------------------------
 * Sisanya pemetaan kolom yang salahnya akan langsung terlihat. Dua ini tidak:
 *
 *   1. STATUS BASI HARUS DILAPORKAN BASI. Kalau penyelarasnya mati — tidak terpasang,
 *      di-disable, atau gagal — tabelnya berhenti diperbarui sementara isinya tetap hijau.
 *      Panel yang menampilkan "semua sehat" dari data seminggu lalu adalah persis bentuk
 *      kebohongan yang seluruh fitur ini dibuat untuk mengakhiri.
 *
 *   2. KOSONG BERARTI KEMBALI KE DEFAULT, bukan nama pengguna kosong. Menyimpan '' akan
 *      membuat penyelaras mencoba autentikasi dengan string kosong dan gagal selamanya,
 *      dengan penyebab yang mustahil terlihat dari panel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as database from '../database/connectionPool.js';
import cameraTimeStatusService, { STALE_AFTER_MINUTES } from '../services/cameraTimeStatusService.js';

/** Waktu UTC `menit` yang lalu, dalam bentuk yang ditulis penyelaras (isoformat, tanpa zona). */
function menitLalu(menit) {
    return new Date(Date.now() - menit * 60000).toISOString().replace('Z', '').split('.')[0];
}

function barisKamera(overrides = {}) {
    return {
        id: 1,
        name: 'CCTV Uji',
        has_onvif_credentials: 0,
        checked_at: menitLalu(5),
        reachable: 1,
        mode: 'NTP',
        drift_seconds: 0,
        method: 'onvif',
        healthy: 1,
        note: 'ok',
        ...overrides,
    };
}

beforeEach(() => {
    vi.spyOn(database, 'queryOne').mockReturnValue({ last: menitLalu(5) });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('status basi tidak pernah dilaporkan sebagai sehat', () => {
    it('kamera yang baru diperiksa dan sehat memang sehat', () => {
        vi.spyOn(database, 'query').mockReturnValue([barisKamera()]);

        const [kamera] = cameraTimeStatusService.getCameraTimeStatus();

        expect(kamera.stale).toBe(false);
        expect(kamera.healthy).toBe(true);
    });

    it('baris sehat yang sudah kedaluwarsa dilaporkan TIDAK sehat', () => {
        // Isi barisnya persis sama sehatnya; hanya umurnya yang berbeda.
        vi.spyOn(database, 'query').mockReturnValue([
            barisKamera({ checked_at: menitLalu(STALE_AFTER_MINUTES + 1) }),
        ]);

        const [kamera] = cameraTimeStatusService.getCameraTimeStatus();

        expect(kamera.stale).toBe(true);
        expect(kamera.healthy).toBe(false);
    });

    it('kamera yang belum pernah diperiksa tetap muncul, dan tidak diklaim sehat', () => {
        /*
         * Kalau ia disembunyikan, kamera yang tak pernah tersentuh penyelaras jadi tak terlihat —
         * dan tak terlihat itu persis yang membuat lima kamera berhenti di tahun 1970 tanpa ada
         * yang tahu.
         */
        vi.spyOn(database, 'query').mockReturnValue([
            barisKamera({ checked_at: null, reachable: 0, mode: null, healthy: 0, note: null }),
        ]);

        const daftar = cameraTimeStatusService.getCameraTimeStatus();

        expect(daftar).toHaveLength(1);
        expect(daftar[0].stale).toBe(true);
        expect(daftar[0].healthy).toBe(false);
        expect(daftar[0].ageMinutes).toBeNull();
    });

    it('ringkasan menghitung yang basi sebagai masalah, bukan sebagai sehat', () => {
        vi.spyOn(database, 'query').mockReturnValue([
            barisKamera({ id: 1 }),
            barisKamera({ id: 2, checked_at: menitLalu(STALE_AFTER_MINUTES + 60) }),
        ]);

        const ringkasan = cameraTimeStatusService.getCameraTimeSummary();

        expect(ringkasan.total).toBe(2);
        expect(ringkasan.healthy).toBe(1);
        expect(ringkasan.stale).toBe(1);
        expect(ringkasan.problems).toBe(1);
    });

    it('membedakan "penyelaras belum pernah jalan" dari "jalan tapi menemukan masalah"', () => {
        vi.spyOn(database, 'query').mockReturnValue([]);
        vi.spyOn(database, 'queryOne').mockReturnValue({ last: null });

        expect(cameraTimeStatusService.getCameraTimeSummary().syncerEverRan).toBe(false);
    });
});

describe('kredensial ONVIF: kosong berarti kembali ke kredensial RTSP', () => {
    function tangkapUpdate() {
        const panggilan = [];
        vi.spyOn(database, 'queryOne').mockReturnValue({ id: 7 });
        vi.spyOn(database, 'execute').mockImplementation((sql, params) => {
            panggilan.push({ sql, params });
            return { changes: 1 };
        });
        return panggilan;
    }

    it('menyimpan nilai yang diisi, terpangkas', () => {
        const panggilan = tangkapUpdate();

        const hasil = cameraTimeStatusService.setOnvifCredentials(7, {
            username: '  admin  ',
            password: ' rahasia ',
        });

        expect(panggilan[0].params.slice(0, 2)).toEqual(['admin', 'rahasia']);
        expect(hasil.hasOnvifCredentials).toBe(true);
    });

    it('memetakan string kosong ke NULL, bukan menyimpan string kosong', () => {
        const panggilan = tangkapUpdate();

        const hasil = cameraTimeStatusService.setOnvifCredentials(7, { username: '', password: '' });

        expect(panggilan[0].params.slice(0, 2)).toEqual([null, null]);
        expect(hasil.hasOnvifCredentials).toBe(false);
    });

    it('memetakan spasi saja ke NULL juga', () => {
        const panggilan = tangkapUpdate();

        cameraTimeStatusService.setOnvifCredentials(7, { username: '   ', password: '\t' });

        expect(panggilan[0].params.slice(0, 2)).toEqual([null, null]);
    });

    it('memakai SQL berparameter, tidak pernah menempel nilai ke teks SQL', () => {
        const panggilan = tangkapUpdate();

        cameraTimeStatusService.setOnvifCredentials(7, { username: "a'; DROP TABLE cameras; --" });

        expect(panggilan[0].sql).not.toContain('DROP TABLE');
        expect(panggilan[0].params[0]).toBe("a'; DROP TABLE cameras; --");
    });

    it('menolak kamera yang tidak ada dengan 404, bukan menulis diam-diam', () => {
        vi.spyOn(database, 'queryOne').mockReturnValue(undefined);
        const execute = vi.spyOn(database, 'execute').mockReturnValue({ changes: 0 });

        expect(() => cameraTimeStatusService.setOnvifCredentials(999, { username: 'x' }))
            .toThrow(/not found/i);
        expect(execute).not.toHaveBeenCalled();
    });
});
