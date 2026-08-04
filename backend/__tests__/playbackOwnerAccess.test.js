/**
 * Purpose: Lock the ONE deliberate opening in the "subscriber = live-only" rule — a rental
 *          camera's OWNER may replay their own footage, and nobody else gains anything.
 * Caller: backend test gate.
 * Deps: vitest, mocked connectionPool + playback token/settings/archive services.
 * SideEffects: None.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now `resolvePlaybackAccess` denied every non-community camera outright, which is why
 * paying customers could not see a second of their own recordings. Opening that is a product
 * decision; opening it WIDELY would be a privacy incident — one customer replaying another
 * customer's house, or a scope parameter becoming a back door into community/owner_private
 * cameras that were never meant to be replayed this way.
 *
 * So the tests below are written mostly as attacks. The permissive case is one test; the rest
 * are the ways this could have gone wrong.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock } = vi.hoisted(() => ({ queryOneMock: vi.fn() }));

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []),
    queryOne: queryOneMock,
    execute: vi.fn(() => ({ changes: 0 })),
}));
const { validateForCameraMock } = vi.hoisted(() => ({ validateForCameraMock: vi.fn(() => null) }));
vi.mock('../services/playbackTokenService.js', () => ({
    default: {
        validateFromRequest: vi.fn(() => null),
        validateRequestForCamera: validateForCameraMock,
    },
}));
vi.mock('../services/settingsService.js', () => ({
    default: { getPublicPlaybackSettings: () => ({ publicPlaybackEnabled: true, previewMinutes: 10, notice: {}, contact: null }) },
}));
vi.mock('../services/archivedSegmentSourceService.js', () => ({ default: { listArchivedSegments: () => [] } }));
vi.mock('../services/recordingSegmentRepository.js', () => ({ default: { findPlaybackSegments: () => [], findSegmentInWindow: () => null } }));
vi.mock('../services/recordingService.js', () => ({ recordingService: { getStorageUsage: () => ({}) } }));
vi.mock('../services/recordingControlService.js', () => ({ default: { start: vi.fn(), stop: vi.fn(), getRuntimeStatus: vi.fn() } }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

const { default: service } = await import('../services/recordingPlaybackService.js');

const KAMERA_SEWA = {
    id: 7, name: 'Kamera Budi', enabled: 1, enable_recording: 1,
    owner_user_id: 42, area_id: null, camera_class: 'subscriber',
    billing_status: 'active', public_playback_mode: 'inherit', public_playback_preview_minutes: 10,
};

const minta = (scope, user) => ({ query: scope ? { scope } : {}, user, url: '/api/recordings/7/segments' });

beforeEach(() => {
    queryOneMock.mockReset();
    validateForCameraMock.mockReset().mockReturnValue(null);
});

describe('pemilik boleh memutar ulang kameranya sendiri', () => {
    it('pemilik yang benar mendapat riwayat penuh', () => {
        const akses = service.resolvePlaybackAccess(KAMERA_SEWA, minta('owner', { id: 42, role: 'customer' }));
        expect(akses.accessMode).toBe('owner_full');
        expect(akses.isPublicPreview).toBe(false);
    });

    it('pelanggan LAIN ditolak — bukan sekadar diberi pratinjau', () => {
        // Kalau ini hanya jatuh ke pratinjau, satu pelanggan bisa mengintip rumah pelanggan lain.
        expect(() => service.resolvePlaybackAccess(KAMERA_SEWA, minta('owner', { id: 99, role: 'customer' })))
            .toThrow('Unauthorized playback access');
    });

    it('tanpa login ditolak', () => {
        expect(() => service.resolvePlaybackAccess(KAMERA_SEWA, minta('owner', undefined)))
            .toThrow('Unauthorized playback access');
    });

    it('scope=owner BUKAN pintu belakang ke kamera komunitas', () => {
        const komunitas = { ...KAMERA_SEWA, camera_class: 'community', owner_user_id: 42 };
        expect(() => service.resolvePlaybackAccess(komunitas, minta('owner', { id: 42, role: 'customer' })))
            .toThrow('Unauthorized playback access');
    });

    it('scope=owner BUKAN pintu belakang ke kamera owner_private', () => {
        const privat = { ...KAMERA_SEWA, camera_class: 'owner_private', owner_user_id: 42 };
        expect(() => service.resolvePlaybackAccess(privat, minta('owner', { id: 42, role: 'customer' })))
            .toThrow('Unauthorized playback access');
    });

    it('langganan yang ditangguhkan berhenti menyajikan riwayat, sama seperti berhenti menyiarkan', () => {
        const ditangguhkan = { ...KAMERA_SEWA, billing_status: 'suspended' };
        const akses = service.resolvePlaybackAccess(ditangguhkan, minta('owner', { id: 42, role: 'customer' }));
        expect(akses.accessMode).toBe('public_denied');
        expect(akses.deniedReason).toBe('langganan_tidak_aktif');
    });

    it('peran admin tidak bisa memakai scope=owner untuk kamera orang lain', () => {
        // Admin punya scope=admin sendiri; jalur pemilik memeriksa kepemilikan, bukan peran.
        expect(() => service.resolvePlaybackAccess(KAMERA_SEWA, minta('owner', { id: 1, role: 'admin' })))
            .toThrow('Unauthorized playback access');
    });
});

describe('aturan lama tetap berlaku untuk semua jalur lain', () => {
    it('kamera sewa tanpa scope tetap ditolak untuk publik', () => {
        const akses = service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined));
        expect(akses.accessMode).toBe('public_denied');
        expect(akses.deniedReason).toBe('camera_admin_only');
    });

    it('pelanggan tidak bisa naik ke scope=admin', () => {
        expect(() => service.resolvePlaybackAccess(KAMERA_SEWA, minta('admin', { id: 42, role: 'customer' })))
            .toThrow('Unauthorized playback access');
    });

    it('scope yang tidak dikenal diperlakukan sebagai publik, bukan diistimewakan', () => {
        const akses = service.resolvePlaybackAccess(KAMERA_SEWA, minta('superuser', { id: 42, role: 'customer' }));
        expect(akses.accessMode).toBe('public_denied');
    });
});

describe('tautan yang diterbitkan pemilik untuk kameranya sendiri', () => {
    const token = (isi) => ({
        id: 5, scope_type: 'selected', created_by: 42, playback_window_hours: 24, ...isi,
    });

    it('token milik pemilik, dicakup ke kamera itu, membuka riwayat', () => {
        validateForCameraMock.mockReturnValue(token());
        const akses = service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined));

        expect(akses.accessMode).toBe('token_full');
        expect(akses.tokenId).toBe(5);
    });

    it("token bercakupan 'all' TIDAK membuka kamera sewa", () => {
        // Inilah yang dulu dijaga dengan menolak sebelum validasi token. Perlindungannya tetap,
        // hanya pemeriksaannya yang kini eksplisit.
        validateForCameraMock.mockReturnValue(token({ scope_type: 'all' }));
        expect(service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });

    it("token bercakupan 'area' juga tidak", () => {
        validateForCameraMock.mockReturnValue(token({ scope_type: 'area' }));
        expect(service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });

    it('token terbitan pelanggan LAIN tidak membuka kamera ini', () => {
        validateForCameraMock.mockReturnValue(token({ created_by: 99 }));
        expect(service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });

    it('token terbitan admin pun tidak — hanya pemilik kamera yang bisa', () => {
        validateForCameraMock.mockReturnValue(token({ created_by: 1 }));
        expect(service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });

    it('langganan ditangguhkan → tautan ikut mati', () => {
        validateForCameraMock.mockReturnValue(token());
        const ditangguhkan = { ...KAMERA_SEWA, billing_status: 'suspended' };
        expect(service.resolvePlaybackAccess(ditangguhkan, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });

    it('token ditolak (kedaluwarsa/dicabut) tidak menjatuhkan permintaan', () => {
        const err = new Error('Token expired');
        err.statusCode = 403;
        validateForCameraMock.mockImplementation(() => { throw err; });

        expect(() => service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined))).not.toThrow();
        expect(service.resolvePlaybackAccess(KAMERA_SEWA, minta(null, undefined)).accessMode)
            .toBe('public_denied');
    });
});
