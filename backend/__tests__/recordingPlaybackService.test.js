/**
 * Purpose: Validate recording playback service controls, stream authorization, and safe file access.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool, fs, recordingService, settings, tokens, and security audit logger.
 * MainFuncs: getSegments, getStreamSegment, updateRecordingSettings.
 * SideEffects: None; external services and filesystem access are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();
const reconcileRecordingLifecycleMock = vi.fn();
const getRecordingStatusMock = vi.fn();
const getStorageUsageMock = vi.fn();
const logAdminActionMock = vi.fn();
const getPublicPlaybackSettingsMock = vi.fn();
const existsSyncMock = vi.fn();
const statSyncMock = vi.fn();
const validateRequestForCameraMock = vi.fn();

// The identical ../database/database.js mock that used to sit here is gone along with
// that module's last importer — everything now reads through connectionPool.
vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    statSync: statSyncMock,
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        startRecording: startRecordingMock,
        stopRecording: stopRecordingMock,
        reconcileRecordingLifecycle: reconcileRecordingLifecycleMock,
        getRecordingStatus: getRecordingStatusMock,
        getStorageUsage: getStorageUsageMock,
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: logAdminActionMock,
}));

vi.mock('../services/settingsService.js', () => ({
    default: {
        getPublicPlaybackSettings: getPublicPlaybackSettingsMock,
    },
}));

vi.mock('../services/playbackTokenService.js', () => ({
    default: {
        validateRequestForCamera: validateRequestForCameraMock,
    },
}));

const { default: recordingPlaybackService } = await import('../services/recordingPlaybackService.js');

describe('recordingPlaybackService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ size: 100 });
        getPublicPlaybackSettingsMock.mockReturnValue({
            publicPlaybackEnabled: true,
            previewMinutes: 10,
            notice: {
                enabled: true,
                title: 'Notice',
                text: 'Playback publik dibatasi',
            },
            contactMode: 'branding_whatsapp',
        });
        validateRequestForCameraMock.mockReturnValue(null);
    });

    it('returns enriched overview camera fields for recording dashboard', async () => {
        queryMock.mockReturnValueOnce([
            {
                id: 5,
                name: 'CCTV ALUN',
                location: 'Bojonegoro',
                enabled: 1,
                status: 'active',
                enable_recording: 1,
                recording_status: 'recording',
                recording_duration_hours: 24,
                last_recording_start: '2026-03-16T00:00:00.000Z',
                stream_source: 'external',
            },
        ]).mockReturnValueOnce([{ count: 2 }]);

        getRecordingStatusMock.mockReturnValue({ isRecording: true, status: 'recording' });
        getStorageUsageMock.mockReturnValue({ totalSize: 1024, segmentCount: 2 });

        const result = await recordingPlaybackService.getRecordingsOverview();

        expect(result.cameras).toEqual([
            expect.objectContaining({
                id: 5,
                location: 'Bojonegoro',
                enabled: 1,
                status: 'active',
                stream_source: 'external',
                runtime_status: { isRecording: true, status: 'recording' },
                storage: { totalSize: 1024, segmentCount: 2 },
            }),
        ]);
    });

    it('updates recording settings and reconciles lifecycle when enabled', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV PASAR',
            enabled: 1,
        });
        reconcileRecordingLifecycleMock.mockResolvedValue({ success: true });

        await recordingPlaybackService.updateRecordingSettings(
            7,
            { enable_recording: true, recording_duration_hours: 12 },
            { user: { id: 1 } }
        );

        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET enable_recording = ?, recording_duration_hours = ? WHERE id = ?',
            [1, 12, 7]
        );
        expect(reconcileRecordingLifecycleMock).toHaveBeenCalledWith(7, 'settings_changed');
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
        expect(logAdminActionMock).toHaveBeenCalled();
    });

    it('rejects enabling recording for non-recordable delivery types', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV MJPEG',
            enabled: 1,
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
        });

        await expect(recordingPlaybackService.updateRecordingSettings(
            7,
            { enable_recording: true },
            { user: { id: 1 } }
        )).rejects.toMatchObject({
            statusCode: 400,
            message: 'Recording only supports internal HLS or external HLS cameras',
        });

        expect(executeMock).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE cameras SET enable_recording'),
            expect.any(Array)
        );
    });

    it('rejects recording retention outside accepted bounds', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV HLS',
            enabled: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
        });

        await expect(recordingPlaybackService.updateRecordingSettings(
            7,
            { recording_duration_hours: 3000 },
            { user: { id: 1 } }
        )).rejects.toMatchObject({
            statusCode: 400,
            message: 'Recording retention must be between 1 and 2160 hours',
        });
    });

    it('returns the latest preview segments for public playback', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' });
        queryMock.mockReturnValueOnce([
            { id: 2, filename: 'second.mp4', start_time: '2026-03-20T10:10:00.000Z', end_time: '2026-03-20T10:20:00.000Z', duration: 600, file_path: 'b', file_size: 100, created_at: '2026-03-20T10:10:00.000Z' },
        ]);

        const result = recordingPlaybackService.getSegments(9, { query: {} });

        expect(result.playback_policy).toEqual(expect.objectContaining({
            accessMode: 'public_preview',
            previewMinutes: 10,
        }));
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].filename).toBe('second.mp4');
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
    });

    /*
     * REGRESSION: an empty segment list is a normal state, not a missing resource.
     *
     * getAccessibleSegments used to throw 404 "No segments found" whenever a camera had
     * nothing recorded yet, which is what every fresh camera looks like. That made the
     * condition indistinguishable from 404 "Camera not found" without string-matching the
     * message, and printed a red console error on /playback and /admin/playback while both
     * pages were working correctly. generatePlaylist keeps its 404 — an HLS manifest with no
     * segments cannot express "nothing here" and would just stall the player.
     */
    it('returns an empty segment list with a policy instead of throwing 404', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' });
        queryMock.mockReturnValueOnce([]);

        const result = recordingPlaybackService.getSegments(9, { query: {} });

        expect(result.segments).toEqual([]);
        expect(result.total_segments).toBe(0);
        expect(result.camera_id).toBe(9);
        expect(result.playback_policy).toEqual(expect.objectContaining({ segmentCount: 0 }));
    });

    it('still 404s the HLS playlist when there is nothing to put in it', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' });
        queryMock.mockReturnValueOnce([]);

        expect(() => recordingPlaybackService.generatePlaylist(9, { query: {} }))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
    });

    it('strips file_path from segment rows before returning them to a client', () => {
        // The repository SELECT still includes file_path because the
        // server-side streaming path needs it, but exposing the absolute
        // filesystem path to a browser leaks the deployment layout. The
        // service must sanitize it from every segment in the response.
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' });
        queryMock.mockReturnValueOnce([
            {
                id: 2,
                filename: 'second.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: '/var/www/rafnet-cctv/recordings/camera9/second.mp4',
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            },
        ]);

        const result = recordingPlaybackService.getSegments(9, { query: {} });

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).not.toHaveProperty('file_path');
        // Other fields the client legitimately needs must still survive.
        expect(result.segments[0]).toMatchObject({
            id: 2,
            filename: 'second.mp4',
            start_time: '2026-03-20T10:10:00.000Z',
            end_time: '2026-03-20T10:20:00.000Z',
            duration: 600,
            file_size: 100,
        });
    });

    it('allows admin full playback when admin scope is requested by authenticated user', () => {
        queryOneMock.mockReturnValueOnce({
            id: 10,
            name: 'CCTV ALUN',
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: null,
        });
        queryMock.mockReturnValueOnce([
            { id: 1, filename: 'first.mp4', start_time: '2026-03-20T10:00:00.000Z', end_time: '2026-03-20T10:10:00.000Z', duration: 600, file_path: 'a', file_size: 100, created_at: '2026-03-20T10:00:00.000Z' },
            { id: 2, filename: 'second.mp4', start_time: '2026-03-20T10:10:00.000Z', end_time: '2026-03-20T10:20:00.000Z', duration: 600, file_path: 'b', file_size: 100, created_at: '2026-03-20T10:10:00.000Z' },
        ]);

        const result = recordingPlaybackService.getSegments(10, {
            query: { scope: 'admin' },
            user: { id: 1, role: 'admin' },
        });

        expect(result.playback_policy.accessMode).toBe('admin_full');
        expect(result.segments).toHaveLength(2);
    });

    it('rejects admin playback scope for authenticated non-staff (customer) users', () => {
        queryOneMock.mockReturnValueOnce({
            id: 10,
            name: 'CCTV ALUN',
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: null,
        });

        expect(() => recordingPlaybackService.getSegments(10, {
            query: { scope: 'admin' },
            user: { id: 7, role: 'customer' },
        })).toThrow('Unauthorized playback access');
    });

    it('denies public playback for non-community cameras even via playback token', () => {
        validateRequestForCameraMock.mockReturnValue({
            id: 20,
            scope_type: 'all',
            effective_playback_window_hours: 12,
        });

        const access = recordingPlaybackService.resolvePlaybackAccess({
            id: 5,
            camera_class: 'subscriber',
            public_playback_mode: 'inherit',
            public_playback_preview_minutes: 10,
        }, { query: {}, url: '/api/recordings/5/segments', cookies: { raf_playback_token: 'token' } });

        expect(access.accessMode).toBe('public_denied');
        expect(access.deniedReason).toBe('camera_admin_only');
        // Token validation must not even be consulted for rented cameras.
        expect(validateRequestForCameraMock).not.toHaveBeenCalled();
    });

    it('blocks public playback for admin-only cameras', () => {
        queryOneMock.mockReturnValueOnce({
            id: 11,
            name: 'CCTV PRIVAT',
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: null,
        });

        expect(() => recordingPlaybackService.getSegments(11, { query: {} })).toThrow('Playback publik tidak tersedia untuk kamera ini');
    });

    it('allows explicit selected token for admin_only camera', () => {
        validateRequestForCameraMock.mockReturnValue({
            id: 20,
            scope_type: 'selected',
            effective_playback_window_hours: 12,
        });

        const access = recordingPlaybackService.resolvePlaybackAccess({
            id: 4,
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: 10,
        }, { query: {}, url: '/api/recordings/4/segments', cookies: { raf_playback_token: 'token' } });

        expect(validateRequestForCameraMock).toHaveBeenCalledWith(
            expect.any(Object),
            4,
            expect.objectContaining({
                camera: expect.objectContaining({ id: 4 }),
            })
        );
        expect(access).toMatchObject({
            accessMode: 'token_full',
            playbackWindowHours: 12,
            tokenId: 20,
        });
    });

    it('falls back to public-preview resolution when cookie token is rejected for the camera', () => {
        // Cookie-based 401/403 from validateRequestForCamera must NOT
        // propagate as a hard deny — having a stale/out-of-scope cookie
        // used to be strictly worse than having no cookie at all, hiding
        // the camera picker behind a full-page denial placeholder. After
        // the fix, the error is swallowed and the access mode is resolved
        // against the public preview policy. For an admin_only camera
        // that still ends in a denial (the camera itself is not public),
        // but via the public-preview path, not via the throw.
        validateRequestForCameraMock.mockImplementation(() => {
            const err = new Error('Token playback tidak mencakup kamera ini');
            err.statusCode = 403;
            throw err;
        });

        const access = recordingPlaybackService.resolvePlaybackAccess({
            id: 4,
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: 10,
        }, { query: {}, url: '/api/recordings/4/segments', cookies: { raf_playback_token: 'stale' } });

        expect(access).toMatchObject({
            accessMode: 'public_denied',
            deniedReason: 'camera_admin_only',
        });
    });

    it('restores public preview when a stale playback cookie throws 401', () => {
        // A cookie pointing at a revoked/expired token must NOT lock a
        // public visitor out of preview access for a camera that supports
        // it. Before this fix, validateRequestForCamera's 401 propagated
        // up, the controller returned 401, and the frontend replaced the
        // entire page with the "Playback Publik Tidak Tersedia"
        // placeholder — covering the camera picker.
        validateRequestForCameraMock.mockImplementation(() => {
            const err = new Error('Token playback sudah dicabut');
            err.statusCode = 401;
            throw err;
        });

        const access = recordingPlaybackService.resolvePlaybackAccess({
            id: 8,
            public_playback_mode: 'inherit',
            public_playback_preview_minutes: 30,
        }, { query: {}, url: '/api/recordings/8/segments', cookies: { raf_playback_token: 'revoked' } });

        expect(access).toMatchObject({
            accessMode: 'public_preview',
            previewMinutes: 30,
            isPublicPreview: true,
        });
    });

    it('rethrows unexpected errors from validateRequestForCamera', () => {
        // Non-credential errors (e.g. unexpected service failure) still
        // bubble up — we only swallow the 401/403 credential class.
        validateRequestForCameraMock.mockImplementation(() => {
            throw new Error('database is locked');
        });

        expect(() => recordingPlaybackService.resolvePlaybackAccess({
            id: 8,
            public_playback_mode: 'inherit',
            public_playback_preview_minutes: 30,
        }, { query: {}, url: '/api/recordings/8/segments', cookies: { raf_playback_token: 'x' } }))
            .toThrow('database is locked');
    });

    it('streams by filename without loading every segment for the camera', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera9', '20260517_010000.mp4');
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' })
            .mockReturnValueOnce({
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            {
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
            },
        ]);

        const result = recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', { query: {} });

        expect(result.segment.filename).toBe('20260517_010000.mp4');
        expect(queryOneMock.mock.calls[2][0]).toContain('WHERE camera_id = ? AND filename = ?');
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('ORDER BY start_time ASC'), [9]);
    });

    it('authorizes token stream lookup with a direct playback-window filename query', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera9', '20260517_010000.mp4');
        validateRequestForCameraMock.mockReturnValue({
            id: 20,
            scope_type: 'selected',
            effective_playback_window_hours: 12,
        });
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'admin_only',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-05-17T01:00:00.000Z',
                end_time: '2026-05-17T01:10:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-05-17T01:00:00.000Z',
            })
            .mockReturnValueOnce({ id: 2, filename: '20260517_010000.mp4' });

        const result = recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', {
            query: {},
            url: '/api/recordings/9/stream/20260517_010000.mp4',
            cookies: { raf_playback_token: 'token' },
        });

        expect(result.segment.filename).toBe('20260517_010000.mp4');
        expect(queryOneMock.mock.calls[2][0]).toContain('AND start_time >= ?');
        expect(queryMock).not.toHaveBeenCalledWith(
            expect.stringContaining('LIMIT ?'),
            [9, 1000]
        );
    });

    it('rejects stream segment when DB path escapes camera recording directory', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' })
            .mockReturnValueOnce({
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-05-17T01:00:00.000Z',
                end_time: '2026-05-17T01:10:00.000Z',
                duration: 600,
                file_path: 'C:\\escape\\20260517_010000.mp4',
                file_size: 100,
                created_at: '2026-05-17T01:00:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            { id: 2, filename: '20260517_010000.mp4', start_time: '2026-05-17T01:00:00.000Z' },
        ]);

        expect(() => recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', { query: {} }))
            .toThrow('Segment file path is not safe');
    });

    it('does not mutate recording_segments during stream lookup when file size differs on disk', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera12', '20260517_011000.mp4');
        queryOneMock
            .mockReturnValueOnce({
                id: 12,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' })
            .mockReturnValueOnce({
                id: 4,
                filename: '20260517_011000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            {
                id: 4,
                filename: '20260517_011000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
            },
        ]);

        statSyncMock.mockReturnValue({ size: 2 * 1024 * 1024 });

        const result = recordingPlaybackService.getStreamSegment(12, '20260517_011000.mp4', { query: {} });

        expect(result.segment.filename).toBe('20260517_011000.mp4');
        expect(executeMock).not.toHaveBeenCalledWith(
            'UPDATE recording_segments SET file_size = ? WHERE id = ?',
            [2 * 1024 * 1024, 4]
        );
    });

    it('uses connectionPool helpers instead of legacy database.js helpers', async () => {
        const source = await readFile(new URL('../services/recordingPlaybackService.js', import.meta.url), 'utf8');

        expect(source).toContain("../database/connectionPool.js");
        expect(source).not.toContain("../database/database.js");
    });
});

/*
 * The fall-through itself is right: a stale cookie must never be worse than no cookie. What was
 * wrong is that it happened in COMPLETE silence, so a token holder whose access was broken was
 * indistinguishable from an ordinary anonymous visitor. A missing area_id hid behind this for
 * hours — the symptom was "the recordings just aren't there", and nothing said a token was refused.
 */
describe('resolvePlaybackAccess leaves a trace when a token is refused', () => {
    const refusedCamera = (id) => ({
        id,
        camera_class: 'community',
        public_playback_mode: 'inherit',
        public_playback_preview_minutes: 10,
    });
    const segmentRequest = (id) => ({
        query: {}, url: `/api/recordings/${id}/segments`, cookies: { raf_playback_token: 'basi' },
    });

    const refuse = (statusCode, message) => {
        validateRequestForCameraMock.mockImplementation(() => {
            const err = new Error(message);
            err.statusCode = statusCode;
            throw err;
        });
    };

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('reports the refusal and still serves the public preview', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        refuse(403, 'Token tidak mencakup kamera ini');

        const access = recordingPlaybackService.resolvePlaybackAccess(refusedCamera(701), segmentRequest(701));

        // The behaviour is unchanged — that part was never the bug.
        expect(access.accessMode).toBe('public_preview');
        // What is new: somebody can now find out WHY.
        expect(log).toHaveBeenCalledWith(expect.stringContaining('camera 701'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Token tidak mencakup kamera ini'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('403'));
    });

    it('says it once, not once per request — /segments is hit on every camera change', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        refuse(401, 'Token playback tidak valid');

        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(702), segmentRequest(702));
        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(702), segmentRequest(702));
        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(702), segmentRequest(702));

        expect(log.mock.calls.filter(([line]) => String(line).includes('camera 702'))).toHaveLength(1);
    });

    it('reports a different camera separately, so one dead cookie does not mask another fault', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        refuse(403, 'Token tidak mencakup kamera ini');

        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(703), segmentRequest(703));
        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(704), segmentRequest(704));

        expect(log.mock.calls.filter(([line]) => String(line).includes('camera 703'))).toHaveLength(1);
        expect(log.mock.calls.filter(([line]) => String(line).includes('camera 704'))).toHaveLength(1);
    });

    it('uses stdout, not stderr — an expired cookie is expected, not broken', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        refuse(401, 'Session playback tidak aktif');

        recordingPlaybackService.resolvePlaybackAccess(refusedCamera(705), segmentRequest(705));

        expect(err).not.toHaveBeenCalled();
    });

    it('still rethrows anything that is NOT a credential refusal', () => {
        validateRequestForCameraMock.mockImplementation(() => {
            const boom = new Error('database is locked');
            boom.statusCode = 500;
            throw boom;
        });

        expect(() => recordingPlaybackService.resolvePlaybackAccess(refusedCamera(706), segmentRequest(706)))
            .toThrow('database is locked');
    });
});
