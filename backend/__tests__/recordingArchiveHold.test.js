/**
 * Purpose: Kunci bahwa segmen belum-terarsip TIDAK dihapus saat outage, DIBATASI PENYIMPANAN
 *          (bukan waktu), dan bahwa lantai keamanan disk + batas storage tetap ditegakkan.
 * Caller: Backend test gate (vitest, node env).
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Retensi disk ~5 jam < MAX_LATE_HOURS uploader 12 jam. Outage di antara keduanya dulu MENGHAPUS
 * segmen sebelum terunggah - permanen, senyap. Perbaikan awalnya pakai tenggat 12 jam, tapi itu
 * konstanta buatan: kalau disk masih muat, kenapa buang rekaman yang belum terarsip? Batas yang
 * benar adalah PENYIMPANAN, bukan jam (permintaan operator 2026-08-29).
 *
 * Enam janji, tiap satunya bisa gagal ke arah berbahaya:
 *   1. belum terarsip + kamera aktif + storage muat        -> DITAHAN (inti perbaikan);
 *   2. sudah ada baris arsip (uploader memutuskan)          -> DIHAPUS;
 *   3. kamera tidak mengarsip (no_route / mati lama)        -> DIHAPUS (jangan isi disk sia-sia);
 *   4. sisa disk di bawah LANTAI KEAMANAN                    -> DIHAPUS (rekaman live harus bisa tulis);
 *   5. total rekaman mencapai BATAS PENYIMPANAN operator     -> DIHAPUS;
 *   6. TANPA tenggat waktu - umur segmen tidak lagi jadi batas.
 */

import { describe, it, expect, vi } from 'vitest';
import { createArchiveHoldPolicy, toSqliteUtc } from '../services/recordingArchiveHoldPolicy.js';
import { createExpiredDbSegmentCleanup } from '../services/recordingExpiredDbSegmentCleanup.js';
import { createEmptyResult } from '../services/recordingCleanupShared.js';

const GB = 1024 * 1024 * 1024;

describe('createArchiveHoldPolicy', () => {
    it('cameraArchivingActive true saat ada ok baru, dengan window yang diberikan pemanggil', () => {
        const query = vi.fn(() => [{ 1: 1 }]);
        const p = createArchiveHoldPolicy({ query });
        expect(p.cameraArchivingActive(9, '2026-07-30 00:00:00')).toBe(true);
        expect(query.mock.calls[0][0]).toMatch(/status = 'ok'/);
    });
    it('false saat tak ada ok baru; false saat tabel tak ada', () => {
        expect(createArchiveHoldPolicy({ query: () => [] }).cameraArchivingActive(9, 'x')).toBe(false);
        expect(createArchiveHoldPolicy({ query: () => { throw new Error('no table'); } }).cameraArchivingActive(9, 'x')).toBe(false);
    });
    it('hasArchiveVerdict: true saat ada baris/melempar, false saat kosong', () => {
        expect(createArchiveHoldPolicy({ query: () => [{ 1: 1 }] }).hasArchiveVerdict(5)).toBe(true);
        expect(createArchiveHoldPolicy({ query: () => [] }).hasArchiveVerdict(5)).toBe(false);
        expect(createArchiveHoldPolicy({ query: () => { throw new Error('locked'); } }).hasArchiveVerdict(5)).toBe(true);
    });
    it('toSqliteUtc: format datetime(now), tanpa T/Z/ms', () => {
        expect(toSqliteUtc(Date.UTC(2026, 7, 28, 14, 5, 9, 123))).toBe('2026-08-28 14:05:09');
    });
});

describe('cleanupExpiredDbSegments dibatasi PENYIMPANAN', () => {
    const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);
    const seg = (id, jamLalu) => ({
        id, camera_id: 9, filename: `s${id}.mp4`,
        start_time: new Date(NOW - jamLalu * 3600 * 1000).toISOString(),
        file_path: `/rec/s${id}.mp4`,
    });

    function jalankan({ segments, archiveHold, hold }) {
        const deleted = [];
        const repository = { findExpiredSegments: () => segments, deleteSegmentById: (id) => deleted.push(id) };
        const cleanup = createExpiredDbSegmentCleanup({
            repository, fs: { access: async () => {} },
            safeDelete: async () => ({ success: true }),
            isFileBeingProcessed: () => false,
            archiveHold, hold,
        });
        const result = createEmptyResult();
        return cleanup({ cameraId: 9, retentionWindow: { cutoffIso: 'x' }, result, nowMs: NOW })
            .then(() => ({ deleted, result }));
    }

    const KAMERA_AKTIF = { cameraArchivingActive: () => true, hasArchiveVerdict: () => false };
    // storage: disk lega, tanpa batas operator.
    const STORAGE_LEGA = { getFreeBytes: async () => 100 * GB, getUsedBytes: () => 50 * GB,
        recordingsBasePath: '/rec', maxStorageBytes: 0, safetyFloorBytes: 5 * GB, activeWindowMs: 30 * 86400e3 };

    it('MENAHAN belum-terarsip pada kamera aktif saat storage lega - APA PUN umurnya', async () => {
        // 100 jam lalu: dulu jauh melewati tenggat 12 jam, kini tetap ditahan.
        const { deleted, result } = await jalankan({ segments: [seg(1, 100)], archiveHold: KAMERA_AKTIF, hold: STORAGE_LEGA });
        expect(deleted, 'segmen tua tapi belum terarsip dihapus - rekaman hilang').toEqual([]);
        expect(result.archiveHeld).toBe(1);
    });

    it('MENGHAPUS yang sudah punya baris arsip', async () => {
        const hold = { cameraArchivingActive: () => true, hasArchiveVerdict: () => true };
        const { deleted } = await jalankan({ segments: [seg(2, 7)], archiveHold: hold, hold: STORAGE_LEGA });
        expect(deleted).toEqual([2]);
    });

    it('MENGHAPUS saat kamera tidak mengarsip (no_route / mati lama)', async () => {
        const hold = { cameraArchivingActive: () => false, hasArchiveVerdict: () => false };
        const { deleted } = await jalankan({ segments: [seg(3, 7)], archiveHold: hold, hold: STORAGE_LEGA });
        expect(deleted).toEqual([3]);
    });

    it('MENGHAPUS saat sisa disk di bawah LANTAI KEAMANAN (rekaman live harus bisa tulis)', async () => {
        const holdCfg = { ...STORAGE_LEGA, getFreeBytes: async () => 3 * GB };  // < 5 GB floor
        const { deleted, result } = await jalankan({ segments: [seg(4, 7)], archiveHold: KAMERA_AKTIF, hold: holdCfg });
        expect(deleted).toEqual([4]);
        expect(result.archiveHeld).toBe(0);
    });

    it('MENGHAPUS saat total rekaman mencapai BATAS PENYIMPANAN operator', async () => {
        const holdCfg = { ...STORAGE_LEGA, maxStorageBytes: 100 * GB, getUsedBytes: () => 100 * GB };
        const { deleted } = await jalankan({ segments: [seg(5, 7)], archiveHold: KAMERA_AKTIF, hold: holdCfg });
        expect(deleted).toEqual([5]);
    });

    it('menahan saat di BAWAH batas penyimpanan operator', async () => {
        const holdCfg = { ...STORAGE_LEGA, maxStorageBytes: 100 * GB, getUsedBytes: () => 80 * GB };
        const { deleted, result } = await jalankan({ segments: [seg(6, 7)], archiveHold: KAMERA_AKTIF, hold: holdCfg });
        expect(deleted).toEqual([]);
        expect(result.archiveHeld).toBe(1);
    });

    it('tanpa archiveHold/hold (fitur mati) -> perilaku lama, hapus semua', async () => {
        const { deleted } = await jalankan({ segments: [seg(7, 7)], archiveHold: null, hold: null });
        expect(deleted).toEqual([7]);
    });

    it('gerbang storage dihitung SEKALI per kamera (bukan per segmen)', async () => {
        const spyFree = vi.fn(async () => 100 * GB);
        const spyActive = vi.fn(() => true);
        await jalankan({
            segments: [seg(8, 7), seg(9, 7), seg(10, 7)],
            archiveHold: { cameraArchivingActive: spyActive, hasArchiveVerdict: () => true },
            hold: { ...STORAGE_LEGA, getFreeBytes: spyFree },
        });
        expect(spyFree).toHaveBeenCalledTimes(1);
        expect(spyActive).toHaveBeenCalledTimes(1);
    });
});
