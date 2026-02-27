import { describe, it, expect, vi, beforeEach } from 'vitest';
import recordingPlaybackService from '../services/recordingPlaybackService.js';
import * as db from '../database/database.js';

// Mock the database module
vi.mock('../database/database.js', () => ({
    query: vi.fn(),
    queryOne: vi.fn(),
    execute: vi.fn()
}));

describe('RecordingPlaybackService - generatePlaylist Discontinuity', () => {
    const cameraId = 1;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should inject #EXT-X-DISCONTINUITY when there is a gap > 2 seconds', () => {
        // Mock camera existence
        db.queryOne.mockImplementation((sql, params) => {
            if (sql.includes('COUNT(*)')) {
                return { count: 2 };
            }
            if (sql.includes('FROM cameras')) {
                return { id: cameraId, name: 'Test Camera' };
            }
            return null;
        });

        // Mock segments with a 5-second gap
        // Segment 1 ends at 10:00:00
        // Segment 2 starts at 10:00:05
        const t1_start = '2026-02-28T10:00:00.000Z';
        const t1_end = '2026-02-28T10:10:00.000Z';
        const t2_start = '2026-02-28T10:10:05.000Z';
        const t2_end = '2026-02-28T10:20:05.000Z';

        db.query.mockReturnValue([
            {
                filename: 'segment1.mp4',
                duration: 600,
                start_time: t1_start,
                end_time: t1_end
            },
            {
                filename: 'segment2.mp4',
                duration: 600,
                start_time: t2_start,
                end_time: t2_end
            }
        ]);

        const playlist = recordingPlaybackService.generatePlaylist(cameraId);

        expect(playlist).toContain('#EXTM3U');
        expect(playlist).toContain('#EXT-X-DISCONTINUITY');
        
        // Verify order: segment1 -> discontinuity -> segment2
        const lines = playlist.split('\n');
        const s1Idx = lines.findIndex(l => l.includes('segment1.mp4'));
        const discIdx = lines.findIndex(l => l.includes('#EXT-X-DISCONTINUITY'));
        const s2Idx = lines.findIndex(l => l.includes('segment2.mp4'));

        expect(s1Idx).toBeGreaterThan(-1);
        expect(discIdx).toBeGreaterThan(s1Idx);
        expect(s2Idx).toBeGreaterThan(discIdx);
    });

    it('should NOT inject #EXT-X-DISCONTINUITY when there is a gap <= 2 seconds', () => {
        // Mock camera existence
        db.queryOne.mockImplementation((sql, params) => {
            if (sql.includes('COUNT(*)')) {
                return { count: 2 };
            }
            if (sql.includes('FROM cameras')) {
                return { id: cameraId, name: 'Test Camera' };
            }
            return null;
        });

        // Mock segments with a 1-second gap
        const t1_start = '2026-02-28T10:00:00.000Z';
        const t1_end = '2026-02-28T10:10:00.000Z';
        const t2_start = '2026-02-28T10:10:01.000Z';
        const t2_end = '2026-02-28T10:20:01.000Z';

        db.query.mockReturnValue([
            {
                filename: 'segment1.mp4',
                duration: 600,
                start_time: t1_start,
                end_time: t1_end
            },
            {
                filename: 'segment2.mp4',
                duration: 600,
                start_time: t2_start,
                end_time: t2_end
            }
        ]);

        const playlist = recordingPlaybackService.generatePlaylist(cameraId);

        expect(playlist).toContain('#EXTM3U');
        expect(playlist).not.toContain('#EXT-X-DISCONTINUITY');
    });
});
