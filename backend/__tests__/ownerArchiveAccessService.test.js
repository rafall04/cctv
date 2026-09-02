/**
 * Purpose: Pin the owner-archive access decision — an owner (or admin / owner-issued token) may stream
 *          their own rental camera's archived segment; anything short of a full-replay scope is refused.
 *          (Audit v1.2.0, P-01.)
 * Caller: Backend Vitest suite for services/ownerArchiveAccessService.js.
 * Deps: vitest; connectionPool, telegramArchiveLibraryService and recordingPlaybackService mocked.
 * MainFuncs: resolveArchiveOwnerAccess allow/deny matrix.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();
const getUploadMock = vi.fn();
const resolveAccessMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    queryOne: (...a) => queryOneMock(...a),
    query: vi.fn(),
    execute: vi.fn(),
}));
vi.mock('../services/telegramArchiveLibraryService.js', () => ({
    default: { getUpload: (...a) => getUploadMock(...a) },
    getUpload: (...a) => getUploadMock(...a),
}));
vi.mock('../services/recordingPlaybackService.js', () => ({
    default: { resolvePlaybackAccess: (...a) => resolveAccessMock(...a) },
}));

const { resolveArchiveOwnerAccess } = await import('../services/ownerArchiveAccessService.js');

const UPLOAD = { segment_id: 42, camera_id: 7, file_size: 1234, file_id: 'tg-file-abc' };
const SUB_CAM = { id: 7, camera_class: 'subscriber', owner_user_id: 99, billing_status: 'active' };

beforeEach(() => {
    queryOneMock.mockReset(); getUploadMock.mockReset(); resolveAccessMock.mockReset();
    getUploadMock.mockReturnValue(UPLOAD);
    queryOneMock.mockReturnValue(SUB_CAM);
});

describe('resolveArchiveOwnerAccess', () => {
    for (const mode of ['owner_full', 'admin_full', 'token_full']) {
        it(`allows ${mode} and returns the segment bytes descriptor`, () => {
            resolveAccessMock.mockReturnValue({ accessMode: mode });
            const out = resolveArchiveOwnerAccess(42, { user: { id: 99 }, query: { scope: 'owner' } });
            expect(out).toEqual({ segmentId: 42, fileSize: 1234 });
        });
    }

    it('refuses public_preview with 403 for an authenticated non-owner', () => {
        resolveAccessMock.mockReturnValue({ accessMode: 'public_preview' });
        expect(() => resolveArchiveOwnerAccess(42, { user: { id: 5 }, query: {} }))
            .toThrowError(expect.objectContaining({ statusCode: 403 }));
    });

    it('refuses an anonymous public_denied with 401', () => {
        resolveAccessMock.mockReturnValue({ accessMode: 'public_denied', deniedReason: null });
        expect(() => resolveArchiveOwnerAccess(42, { query: {} }))
            .toThrowError(expect.objectContaining({ statusCode: 401 }));
    });

    it('reports lapsed subscription (403) distinctly', () => {
        resolveAccessMock.mockReturnValue({ accessMode: 'public_denied', deniedReason: 'langganan_tidak_aktif' });
        expect(() => resolveArchiveOwnerAccess(42, { user: { id: 99 }, query: { scope: 'owner' } }))
            .toThrowError(/Langganan tidak aktif/);
    });

    it('404s an unknown or not-yet-uploaded segment (no file_id)', () => {
        getUploadMock.mockReturnValue({ ...UPLOAD, file_id: null });
        expect(() => resolveArchiveOwnerAccess(42, { user: { id: 99 } }))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
        getUploadMock.mockReturnValue(undefined);
        expect(() => resolveArchiveOwnerAccess(42, { user: { id: 99 } }))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
    });

    it('404s when the camera row is gone', () => {
        queryOneMock.mockReturnValue(undefined);
        expect(() => resolveArchiveOwnerAccess(42, { user: { id: 99 } }))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
    });
});
