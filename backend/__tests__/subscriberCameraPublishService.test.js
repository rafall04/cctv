/**
 * Purpose: Lock the operator's ONE-WAY lever over a customer's rented camera — it may take a
 *          camera off the public hub, and it may never put one on.
 * Caller: backend test gate.
 * Deps: vitest, mocked connectionPool + cameraService + cameraAccessService + audit logger.
 * SideEffects: None.
 *
 * WHY THE ASYMMETRY IS THE POINT
 * Publishing a customer's camera exposes THEIR property to the whole internet, and that consent is
 * theirs — they hold that switch in their own portal. Unpublishing only ever removes exposure, and
 * an operator needs it for moderation. So the module exports no publish path at all, and this file
 * exists mostly to make sure one never grows back: a symmetric `setPublic(true/false)` would be an
 * easy, natural-looking refactor and a privacy regression.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock, executeMock } = vi.hoisted(() => ({
    queryOneMock: vi.fn(),
    executeMock: vi.fn(() => ({ changes: 1 })),
}));
const { invalidateAccessMock, invalidateListMock, auditMock } = vi.hoisted(() => ({
    invalidateAccessMock: vi.fn(),
    invalidateListMock: vi.fn(),
    auditMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []),
    queryOne: queryOneMock,
    execute: executeMock,
}));
vi.mock('../services/cameraService.js', () => ({
    default: { invalidateCameraCache: invalidateListMock },
}));
vi.mock('../services/cameraAccessService.js', () => ({
    invalidateCameraAccessCache: invalidateAccessMock,
}));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: auditMock }));

const modul = await import('../services/subscriberCameraPublishService.js');
const { unpublishSubscriberCamera } = modul;

const KAMERA = (isi = {}) => ({
    id: 7, name: 'Toko Budi', camera_class: 'subscriber', owner_user_id: 42,
    billing_status: 'active', is_public: 1, ...isi,
});

function siapkan(sebelum, sesudah = null) {
    queryOneMock.mockReset();
    queryOneMock
        .mockReturnValueOnce(sebelum)
        .mockReturnValueOnce(sesudah || { ...sebelum, is_public: 0 });
}

beforeEach(() => {
    executeMock.mockClear();
    invalidateAccessMock.mockClear();
    invalidateListMock.mockClear();
    auditMock.mockClear();
});

describe('tidak ada jalur publikasi sama sekali', () => {
    it('modul ini tidak mengekspor apa pun yang bisa MEMPUBLIKASIKAN kamera pelanggan', () => {
        // Penjaga sengaja kasar: `setPublic(true/false)` yang simetris adalah refactor yang
        // kelihatan wajar dan sekaligus kemunduran privasi. Kalau nama seperti itu muncul,
        // keputusannya harus dibuat sadar, bukan menyelinap.
        const terlarang = Object.keys(modul).filter((nama) => /publish[^S]|setPublic|makePublic/i.test(nama));
        expect(terlarang).toEqual([]);
        expect(Object.keys(modul).sort()).toEqual(['default', 'unpublishSubscriberCamera']);
    });

    it('tidak menerima argumen yang bisa membalik arahnya', () => {
        siapkan(KAMERA());
        // Argumen kedua adalah `request` (untuk audit), bukan flag. Kalau suatu saat jadi
        // payload boolean, tes ini yang jatuh duluan.
        unpublishSubscriberCamera(7, { user: { id: 1 } });
        expect(executeMock.mock.calls[0][0]).toContain('is_public = 0');
    });
});

describe('menyembunyikan kamera sewa dari hub publik', () => {
    it('menulis is_public = 0', () => {
        siapkan(KAMERA());
        const hasil = unpublishSubscriberCamera(7);

        expect(executeMock.mock.calls[0][1]).toEqual([7]);
        expect(hasil.already_private).toBe(false);
    });

    it('membersihkan cache AKSES LIVE, bukan hanya cache daftar', () => {
        // Cache daftar saja berarti kamera lenyap dari halaman publik seketika sementara stream
        // live-nya masih bisa dibuka siapa pun yang pegang URL sampai 30 detik.
        siapkan(KAMERA());
        unpublishSubscriberCamera(7);

        expect(invalidateAccessMock).toHaveBeenCalledWith(7);
        expect(invalidateListMock).toHaveBeenCalled();
    });

    it('kamera yang sudah privat bukan error, dan tidak ditulis ulang', () => {
        siapkan(KAMERA({ is_public: 0 }));
        const hasil = unpublishSubscriberCamera(7);

        expect(hasil.already_private).toBe(true);
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('langganan ditangguhkan tetap boleh disembunyikan', () => {
        // Moderasi tidak boleh bergantung pada keadaan tagihan.
        siapkan(KAMERA({ billing_status: 'suspended' }));
        unpublishSubscriberCamera(7);
        expect(executeMock).toHaveBeenCalled();
    });
});

describe('yang ditolak', () => {
    it.each(['community', 'owner_private'])("kelas '%s' ditolak", (kelas) => {
        siapkan(KAMERA({ camera_class: kelas }));
        expect(() => unpublishSubscriberCamera(7)).toThrow(/kamera sewa/i);
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('kamera tidak ada -> 404', () => {
        queryOneMock.mockReset().mockReturnValue(null);
        expect(() => unpublishSubscriberCamera(7)).toThrow('Camera not found');
    });

    it('id tidak valid -> 404, tanpa menyentuh DB', () => {
        queryOneMock.mockReset();
        expect(() => unpublishSubscriberCamera('abc')).toThrow('Camera not found');
        expect(queryOneMock).not.toHaveBeenCalled();
    });
});

describe('jejak audit', () => {
    it('mencatat siapa pemilik kamera yang diturunkan operator', () => {
        siapkan(KAMERA());
        unpublishSubscriberCamera(7, { user: { id: 1 } });

        expect(auditMock).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'billing_camera_unpublished',
                cameraId: 7,
                ownerUserId: 42,
            }),
            expect.any(Object)
        );
    });
});
