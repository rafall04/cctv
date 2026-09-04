/**
 * Purpose: Lock the end of history the archive LIMIT bites, and the order rows come back in.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool.
 * MainFuncs: listArchivedSegments.
 * SideEffects: None.
 *
 * The bug this guards: the query ordered ASC and capped at 1000, which kept the OLDEST 1000 rows.
 * Production had ~1,400 archived segments per camera, so the 334-431 most recent ones — exactly the
 * stretch already pruned off local disk — never reached the player, and the playback timeline drew
 * 42-63 hours of red "Hilang" over footage that was in the archive the whole time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
}));

const { default: archivedSegmentSourceService } = await import('../services/archivedSegmentSourceService.js');

/** A row in the shape the DB hands back, so the mock cannot drift from the real SELECT. */
function archiveRow(id, recordedAt) {
    return {
        segment_id: id,
        camera_id: 7,
        filename: `${id}.mp4`,
        file_size: 1024,
        recorded_at: recordedAt,
        recorded_until: recordedAt.replace('T0', 'T1'),
        duration_seconds: 600,
        uploaded_at: recordedAt,
    };
}

describe('archivedSegmentSourceService.listArchivedSegments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMock.mockReturnValue([]);
    });

    it('caps at the NEWEST end — the SQL must order descending', () => {
        archivedSegmentSourceService.listArchivedSegments(7);

        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('ORDER BY u.recorded_at DESC');
        expect(sql).not.toContain('ORDER BY u.recorded_at ASC');
        expect(params).toEqual([7, 1000]);
    });

    it('returns rows oldest-first regardless of the order they were selected in', () => {
        // Newest-first, as the DESC query hands them over.
        queryMock.mockReturnValue([
            archiveRow(3, '2026-08-06T03:00:00.000Z'),
            archiveRow(2, '2026-08-06T02:00:00.000Z'),
            archiveRow(1, '2026-08-06T01:00:00.000Z'),
        ]);

        const segments = archivedSegmentSourceService.listArchivedSegments(7);

        expect(segments.map((segment) => segment.id)).toEqual([1, 2, 3]);
        expect(segments.map((segment) => segment.start_time)).toEqual([
            '2026-08-06T01:00:00.000Z',
            '2026-08-06T02:00:00.000Z',
            '2026-08-06T03:00:00.000Z',
        ]);
    });

    it('maps into the local segment shape and marks the source so the player picks the right route', () => {
        queryMock.mockReturnValue([archiveRow(42, '2026-08-06T01:00:00.000Z')]);

        expect(archivedSegmentSourceService.listArchivedSegments(7)[0]).toEqual({
            id: 42,
            camera_id: 7,
            filename: '42.mp4',
            start_time: '2026-08-06T01:00:00.000Z',
            end_time: '2026-08-06T11:00:00.000Z',
            file_size: 1024,
            duration: 600,
            created_at: '2026-08-06T01:00:00.000Z',
            source: 'archive',
        });
    });

    it('narrows to the requested range so a day view does not pay for ten days of rows', () => {
        archivedSegmentSourceService.listArchivedSegments(7, {
            range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-01T23:59:59.999Z' },
        });

        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('AND u.recorded_at >= ?');
        expect(sql).toContain('AND u.recorded_at < ?');
        expect(params).toEqual([7, '2026-08-01T00:00:00.000Z', '2026-08-01T23:59:59.999Z', 1000]);
    });

    it('accepts a half-open range — a window with no upper bound is the common case', () => {
        archivedSegmentSourceService.listArchivedSegments(7, { range: { from: '2026-08-01T00:00:00.000Z', to: null } });

        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('AND u.recorded_at >= ?');
        expect(sql).not.toContain('AND u.recorded_at < ?');
        expect(params).toEqual([7, '2026-08-01T00:00:00.000Z', 1000]);
    });

    it('clamps the limit rather than letting a caller ask for the whole table', () => {
        archivedSegmentSourceService.listArchivedSegments(7, { limit: 99999 });
        expect(queryMock.mock.calls[0][1]).toEqual([7, 5000]);

        // 0 reads as "unset", not "fetch nothing" — a caller that forgot the option still gets a page.
        queryMock.mockClear();
        archivedSegmentSourceService.listArchivedSegments(7, { limit: 0 });
        expect(queryMock.mock.calls[0][1]).toEqual([7, 1000]);
    });

    it('rejects a non-camera id without touching the database', () => {
        expect(archivedSegmentSourceService.listArchivedSegments('abc')).toEqual([]);
        expect(archivedSegmentSourceService.listArchivedSegments(0)).toEqual([]);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('degrades to "no archive" instead of failing the whole listing', () => {
        queryMock.mockImplementation(() => { throw new Error('no such table'); });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(archivedSegmentSourceService.listArchivedSegments(7)).toEqual([]);

        errorSpy.mockRestore();
    });
});
