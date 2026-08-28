/**
 * Purpose: Kunci bahwa segmen KADALUARSA yang belum terarsip TIDAK dihapus saat outage, dan bahwa
 *          penahanannya tetap berbatas agar disk tak pernah terisi.
 * Caller: Backend test gate (vitest, node env).
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Retensi disk ~5 jam < MAX_LATE_HOURS uploader 12 jam. Sebelum ini, outage jaringan di antara
 * keduanya membuat pemangkas retensi MENGHAPUS segmen sebelum sempat terunggah — permanen, senyap.
 * Diminta diperbaiki 2026-08-28: "agar tidak ada rekaman yang hilang".
 *
 * Empat janji yang dikunci di sini, dan tiap satunya bisa gagal ke arah berbahaya:
 *   1. belum terarsip + kamera aktif + dalam jendela  -> DITAHAN (inti perbaikan);
 *   2. sudah ada baris arsip (uploader memutuskan)      -> DIHAPUS (jangan tahan selamanya);
 *   3. kamera tidak sedang mengarsip (no_route/mati)    -> DIHAPUS (jangan isi disk sia-sia);
 *   4. lebih tua dari jendela penahanan                 -> DIHAPUS (uploader sendiri sudah menyerah).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createArchiveHoldPolicy, toSqliteUtc } from '../services/recordingArchiveHoldPolicy.js';
import { createExpiredDbSegmentCleanup } from '../services/recordingExpiredDbSegmentCleanup.js';
import { createEmptyResult } from '../services/recordingCleanupShared.js';

/* ---- Kebijakan: dua primitif, diuji terhadap query tiruan ---- */
describe('createArchiveHoldPolicy', () => {
    it('cameraArchivingActive true saat ada unggahan ok baru', () => {
        const query = vi.fn(() => [{ 1: 1 }]);
        const p = createArchiveHoldPolicy({ query });
        expect(p.cameraArchivingActive(9, '2026-08-28 00:00:00')).toBe(true);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toMatch(/status = 'ok'/);
        expect(params).toEqual([9, '2026-08-28 00:00:00']);
    });

    it('cameraArchivingActive false saat tidak ada ok baru', () => {
        const p = createArchiveHoldPolicy({ query: () => [] });
        expect(p.cameraArchivingActive(9, '2026-08-28 00:00:00')).toBe(false);
    });

    it('cameraArchivingActive false (jangan tahan) saat tabel arsip tidak ada', () => {
        const p = createArchiveHoldPolicy({ query: () => { throw new Error('no such table'); } });
        expect(p.cameraArchivingActive(9, 'x')).toBe(false);
    });

    it('hasArchiveVerdict true saat baris ada, false saat tidak', () => {
        expect(createArchiveHoldPolicy({ query: () => [{ 1: 1 }] }).hasArchiveVerdict(5)).toBe(true);
        expect(createArchiveHoldPolicy({ query: () => [] }).hasArchiveVerdict(5)).toBe(false);
    });

    it('hasArchiveVerdict true (jangan tahan selamanya) saat query melempar', () => {
        const p = createArchiveHoldPolicy({ query: () => { throw new Error('locked'); } });
        expect(p.hasArchiveVerdict(5)).toBe(true);
    });

    it('toSqliteUtc menghasilkan format datetime(now): tanpa T, tanpa Z, tanpa ms', () => {
        expect(toSqliteUtc(Date.UTC(2026, 7, 28, 14, 5, 9, 123))).toBe('2026-08-28 14:05:09');
    });
});

/* ---- Penjaga di dalam cleanupExpiredDbSegments ---- */
describe('cleanupExpiredDbSegments menahan yang belum terarsip', () => {
    const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);   // 12:00:00Z
    // Segmen kadaluarsa (>5 jam), umurnya berbeda-beda relatif NOW.
    const seg = (id, jamLalu) => ({
        id, camera_id: 9, filename: `s${id}.mp4`,
        start_time: new Date(NOW - jamLalu * 3600 * 1000).toISOString(),
        file_path: `/rec/s${id}.mp4`,
    });

    function jalankan({ segments, archiveHold, holdHours = 12 }) {
        const deleted = [];
        const repository = {
            findExpiredSegments: () => segments,
            deleteSegmentById: (id) => deleted.push(id),
        };
        const fs = { access: async () => {} };  // semua berkas ADA
        const safeDelete = async ({ filename }) => { return { success: true }; };
        const cleanup = createExpiredDbSegmentCleanup({
            repository, fs, safeDelete,
            isFileBeingProcessed: () => false,
            archiveHold, holdHours,
        });
        const result = createEmptyResult();
        return cleanup({ cameraId: 9, retentionWindow: { cutoffIso: 'x' }, result, nowMs: NOW })
            .then(() => ({ deleted, result }));
    }

    const KAMERA_AKTIF = { cameraArchivingActive: () => true, hasArchiveVerdict: () => false };

    it('MENAHAN segmen belum terarsip pada kamera aktif dalam jendela', async () => {
        const { deleted, result } = await jalankan({ segments: [seg(1, 7)], archiveHold: KAMERA_AKTIF });
        expect(deleted, 'segmen belum terarsip DIHAPUS - rekaman hilang saat outage').toEqual([]);
        expect(result.archiveHeld).toBe(1);
    });

    it('MENGHAPUS segmen yang sudah punya baris arsip (uploader memutuskan)', async () => {
        const hold = { cameraArchivingActive: () => true, hasArchiveVerdict: () => true };
        const { deleted } = await jalankan({ segments: [seg(2, 7)], archiveHold: hold });
        expect(deleted).toEqual([2]);
    });

    it('MENGHAPUS saat kamera tidak sedang mengarsip (no_route / arsip mati)', async () => {
        const hold = { cameraArchivingActive: () => false, hasArchiveVerdict: () => false };
        const { deleted } = await jalankan({ segments: [seg(3, 7)], archiveHold: hold });
        expect(deleted, 'kamera non-arsip ikut ditahan - disk terisi sia-sia').toEqual([3]);
    });

    it('MENGHAPUS segmen lebih tua dari jendela penahanan (uploader pun menyerah)', async () => {
        // 13 jam > holdHours 12 -> lepas.
        const { deleted } = await jalankan({ segments: [seg(4, 13)], archiveHold: KAMERA_AKTIF });
        expect(deleted).toEqual([4]);
    });

    it('campur: tahan yang di jendela, hapus yang lewat jendela - dalam satu larian', async () => {
        const { deleted, result } = await jalankan({
            segments: [seg(5, 6), seg(6, 20)], archiveHold: KAMERA_AKTIF,
        });
        expect(deleted).toEqual([6]);      // yang 20 jam lepas
        expect(result.archiveHeld).toBe(1); // yang 6 jam ditahan
    });

    it('holdHours=0 (fitur mati) -> hapus semua seperti perilaku lama', async () => {
        const { deleted } = await jalankan({ segments: [seg(7, 7)], archiveHold: KAMERA_AKTIF, holdHours: 0 });
        expect(deleted).toEqual([7]);
    });

    it('tanpa archiveHold (null) -> perilaku lama persis, tak ada query', async () => {
        const { deleted } = await jalankan({ segments: [seg(8, 7)], archiveHold: null });
        expect(deleted).toEqual([8]);
    });

    it('cameraArchivingActive dipanggil SEKALI per kamera, bukan per segmen', async () => {
        const spy = vi.fn(() => true);
        const hold = { cameraArchivingActive: spy, hasArchiveVerdict: () => true };
        await jalankan({ segments: [seg(9, 7), seg(10, 7), seg(11, 7)], archiveHold: hold });
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
