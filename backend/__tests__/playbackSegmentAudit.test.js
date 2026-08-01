/**
 * Purpose: Cover the "which clip did they watch" audit entry — what it records, and the
 *          de-duplication that keeps one clip from becoming dozens of rows.
 * Caller: Backend test gate.
 * Deps: vitest, mocked playbackTokenService.
 * MainFuncs: recordSegmentWatch cases.
 * SideEffects: None; the audit write is mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('../services/playbackTokenService.js', () => ({
    default: { recordAudit },
}));

const { recordSegmentWatch, resetSegmentWatchCache } = await import('../services/playbackSegmentAuditService.js');

const SEGMENT = {
    filename: '20260801_134000.mp4',
    start_time: '2026-08-01 13:40:00',
    end_time: '2026-08-01 13:50:00',
    duration: 600,
};

beforeEach(() => {
    recordAudit.mockClear();
    resetSegmentWatchCache();
});

describe('recordSegmentWatch', () => {
    it('records WHICH footage was played, not just that something was', () => {
        expect(recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: SEGMENT, request: {} })).toBe(true);

        expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
            tokenId: 7,
            cameraId: 16,
            eventType: 'watch_segment',
            detail: {
                filename: '20260801_134000.mp4',
                // The point of the entry: footage from 13.40, which is NOT when they clicked.
                start_time: '2026-08-01 13:40:00',
                end_time: '2026-08-01 13:50:00',
                duration: 600,
            },
        }));
    });

    it('writes one row per clip, however many Range requests the player makes', () => {
        // A <video> element asks for a file in pieces — seek, buffer, resume.
        for (let i = 0; i < 20; i += 1) {
            recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: SEGMENT, request: {} });
        }

        expect(recordAudit).toHaveBeenCalledTimes(1);
    });

    it('still records a DIFFERENT clip watched moments later', () => {
        // The existing per-token throttle would have swallowed this, and the log would then claim
        // the second clip was never opened.
        recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: SEGMENT, request: {} });
        recordSegmentWatch({
            tokenId: 7,
            cameraId: 16,
            segment: { ...SEGMENT, filename: '20260801_135000.mp4', start_time: '2026-08-01 13:50:00' },
            request: {},
        });

        expect(recordAudit).toHaveBeenCalledTimes(2);
    });

    it('keeps two tokens separate even on the same clip', () => {
        recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: SEGMENT, request: {} });
        recordSegmentWatch({ tokenId: 8, cameraId: 16, segment: SEGMENT, request: {} });

        expect(recordAudit).toHaveBeenCalledTimes(2);
    });

    it('ignores anonymous views, which have no token to attach to', () => {
        expect(recordSegmentWatch({ tokenId: null, cameraId: 16, segment: SEGMENT, request: {} })).toBe(false);
        expect(recordSegmentWatch({ tokenId: 0, cameraId: 16, segment: SEGMENT, request: {} })).toBe(false);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it('ignores a call with nothing identifiable to log', () => {
        expect(recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: {}, request: {} })).toBe(false);
        expect(recordSegmentWatch({})).toBe(false);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it('never lets a failed audit write break playback for the viewer', () => {
        recordAudit.mockImplementationOnce(() => { throw new Error('audit table gone'); });

        expect(() => recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: SEGMENT, request: {} }))
            .not.toThrow();
    });

    it('tolerates a segment row missing its times rather than skipping the entry', () => {
        // Older rows predate the timing columns; the filename alone still identifies the clip.
        recordSegmentWatch({ tokenId: 7, cameraId: 16, segment: { filename: 'old.mp4' }, request: {} });

        expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
            detail: { filename: 'old.mp4', start_time: null, end_time: null, duration: null },
        }));
    });
});
