/*
Purpose: Lock the archive timeline rules — UTC parsing, gap detection, and the time jump.
Caller: Vitest frontend suite.
Deps: utils/admin/archiveTimeline.
MainFuncs: parseWhen, buildTimeline, findSegmentAt assertions.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import { buildTimeline, findSegmentAt, parseWhen, segmentWindow } from './archiveTimeline';

const seg = (id, startUtc, endUtc, duration = 600) => ({
    segmentId: id,
    cameraName: 'CCTV A',
    recordedAt: startUtc,
    recordedUntil: endUtc,
    durationSeconds: duration,
    fileSize: 1024,
    playable: true,
});

describe('parseWhen', () => {
    it('reads segment times as UTC — dropping the Z renders every label 7 hours early in WIB', () => {
        // Verified against prod: a clip whose own filename says 193250 is stored as 12:32:50.
        const parsed = parseWhen('2026-07-27 12:32:50');
        expect(parsed.toISOString()).toBe('2026-07-27T12:32:50.000Z');
        expect(parsed.toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
        })).toBe('19.32');
    });

    it('does not double-stamp a value that already carries a zone', () => {
        expect(parseWhen('2026-07-27T12:32:50Z').toISOString()).toBe('2026-07-27T12:32:50.000Z');
    });
});

describe('segmentWindow', () => {
    it('renders a RANGE, because one start time cannot answer "which clip contains 19.36?"', () => {
        const win = segmentWindow(seg(1, '2026-07-27 12:32:00', '2026-07-27 12:42:00'));
        expect(win.range).toMatch(/–/);
        expect(win.duration).toBe('10 mnt');
    });
});

describe('buildTimeline gaps', () => {
    const rows = [
        seg(1, '2026-07-27 12:00:00', '2026-07-27 12:10:00'),
        // 20-minute hole here
        seg(2, '2026-07-27 12:30:00', '2026-07-27 12:40:00'),
    ];

    it('marks a hole between consecutive clips — an incomplete run must not look unbroken', () => {
        const days = buildTimeline(rows, { detectGaps: true, now: new Date('2026-07-27T13:00:00Z') });
        const gaps = days.flatMap((d) => d.items).filter((i) => i.kind === 'gap');
        expect(gaps).toHaveLength(1);
        expect(gaps[0].seconds).toBe(1200);
    });

    it('ignores a few seconds of seam — segments are cut on a timer, not to the millisecond', () => {
        const tight = [
            seg(1, '2026-07-27 12:00:00', '2026-07-27 12:10:00'),
            seg(2, '2026-07-27 12:10:03', '2026-07-27 12:20:00'),
        ];
        const days = buildTimeline(tight, { detectGaps: true });
        expect(days.flatMap((d) => d.items).filter((i) => i.kind === 'gap')).toHaveLength(0);
    });

    it('never draws a gap across a mixed feed — a hole between two cameras is not a hole', () => {
        const days = buildTimeline(rows, { detectGaps: false });
        expect(days.flatMap((d) => d.items).filter((i) => i.kind === 'gap')).toHaveLength(0);
    });

    it('groups by day, newest first', () => {
        const days = buildTimeline([
            seg(1, '2026-07-26 12:00:00', '2026-07-26 12:10:00'),
            seg(2, '2026-07-27 12:00:00', '2026-07-27 12:10:00'),
        ], { now: new Date('2026-07-27T13:00:00Z') });
        expect(days).toHaveLength(2);
        expect(days[0].items[0].row.segmentId).toBe(2);
    });
});

describe('findSegmentAt', () => {
    const rows = [
        seg(1, '2026-07-27 12:00:00', '2026-07-27 12:10:00'),
        seg(2, '2026-07-27 12:30:00', '2026-07-27 12:40:00'),
    ];

    it('finds the clip that actually contains the requested minute', () => {
        // 12:35 UTC == 19:35 WIB; the helper matches against the local clock the operator reads.
        const target = new Date('2026-07-27T12:35:00Z');
        const hhmm = target.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        expect(findSegmentAt(rows, hhmm)?.segmentId).toBe(2);
    });

    it('rejects nonsense rather than guessing', () => {
        expect(findSegmentAt(rows, '99:99')).toBeNull();
        expect(findSegmentAt(rows, 'pagi')).toBeNull();
    });
});
