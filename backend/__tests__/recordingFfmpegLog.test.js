/**
 * Purpose: Verify the per-camera ffmpeg stderr log + tailer that replaces the stdio
 *          pipe, so recorders can outlive the backend and still be observed.
 * Caller: Vitest backend suite.
 * Deps: real temp files (the tailer's whole job is filesystem behaviour).
 * SideEffects: Creates and removes files under os.tmpdir().
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, closeSync, mkdtempSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    createLogTailer,
    getFfmpegLogPath,
    openFfmpegLog,
} from '../services/recordingFfmpegLog.js';

let dir;
let logPath;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffmpeglog-'));
    logPath = join(dir, 'ffmpeg.log');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/**
 * The tailer reads through an async stream, so a fixed sleep is a flake waiting to
 * happen on a loaded machine. Poll until the expectation holds (or the deadline).
 */
async function pollUntil(tailer, predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
        tailer.pollNow();
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (predicate()) return;
    } while (Date.now() < deadline);
}

/** Drive a few polls when the expectation is that NOTHING new arrives. */
async function pollAndSettle(tailer) {
    for (let i = 0; i < 3; i += 1) {
        tailer.pollNow();
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

describe('getFfmpegLogPath', () => {
    it('puts one log next to each camera recording directory', () => {
        expect(getFfmpegLogPath('/srv/rec', 42)).toBe(join('/srv/rec', 'camera42', 'ffmpeg.log'));
    });
});

describe('openFfmpegLog', () => {
    it('creates the camera directory and returns an appendable fd', () => {
        const nested = join(dir, 'camera7', 'ffmpeg.log');
        const fd = openFfmpegLog(nested);
        expect(typeof fd).toBe('number');
        closeSync(fd);
        expect(statSync(nested).size).toBe(0);
    });
});

describe('createLogTailer', () => {
    it('delivers newly appended output', async () => {
        writeFileSync(logPath, '');
        const chunks = [];
        const tailer = createLogTailer({ logPath, onData: (c) => chunks.push(c), intervalMs: 60_000 });

        appendFileSync(logPath, 'frame= 100 fps=25\n');
        await pollUntil(tailer, () => chunks.join('') === 'frame= 100 fps=25\n');

        expect(chunks.join('')).toBe('frame= 100 fps=25\n');
        tailer.stop();
    });

    it('fromEnd skips existing history — adoption must not replay old events', async () => {
        // An adopted recorder's log already holds hours of output. Replaying it would
        // re-fire stale segment-completion events and reset freshness on stale data.
        writeFileSync(logPath, 'OLD segment completed a.mp4\n');
        const chunks = [];
        const tailer = createLogTailer({ logPath, fromEnd: true, onData: (c) => chunks.push(c), intervalMs: 60_000 });

        await pollAndSettle(tailer);
        expect(chunks).toEqual([]);

        appendFileSync(logPath, 'NEW\n');
        await pollUntil(tailer, () => chunks.join('') === 'NEW\n');
        expect(chunks.join('')).toBe('NEW\n');

        tailer.stop();
    });

    it('truncates itself once past maxBytes so progress spam cannot fill the disk', async () => {
        writeFileSync(logPath, '');
        const tailer = createLogTailer({ logPath, onData: () => {}, maxBytes: 64, intervalMs: 60_000 });

        appendFileSync(logPath, 'x'.repeat(200));
        await pollUntil(tailer, () => statSync(logPath).size === 0);

        expect(statSync(logPath).size).toBe(0);
        tailer.stop();
    });

    it('recovers when the file is truncated underneath it', async () => {
        writeFileSync(logPath, 'first-chunk-of-output\n');
        const chunks = [];
        const tailer = createLogTailer({ logPath, onData: (c) => chunks.push(c), intervalMs: 60_000 });

        await pollUntil(tailer, () => chunks.join('') === 'first-chunk-of-output\n');
        expect(chunks.join('')).toBe('first-chunk-of-output\n');

        // What actually happens in production: the file is emptied (our own maxBytes
        // sweep, or an operator), then ffmpeg keeps appending at the new zero end.
        truncateSync(logPath, 0);
        appendFileSync(logPath, 'second\n');
        await pollUntil(tailer, () => chunks.join('') === 'first-chunk-of-output\nsecond\n');

        expect(chunks.join('')).toBe('first-chunk-of-output\nsecond\n');
        tailer.stop();
    });

    it('restarts from zero when the path is replaced by a new file (logrotate)', async () => {
        writeFileSync(logPath, 'old-file-contents\n');
        const chunks = [];
        const tailer = createLogTailer({ logPath, onData: (c) => chunks.push(c), intervalMs: 60_000 });

        await pollUntil(tailer, () => chunks.join('') === 'old-file-contents\n');
        chunks.length = 0;

        // Move the old log aside and put a fresh file at the same path — byte offsets
        // from the previous inode must not be carried over.
        renameSync(logPath, join(dir, 'ffmpeg.log.1'));
        writeFileSync(logPath, 'brand new file\n');
        await pollUntil(tailer, () => chunks.join('') === 'brand new file\n');

        expect(chunks.join('')).toBe('brand new file\n');
        tailer.stop();
    });

    it('tolerates a missing log without throwing', async () => {
        const tailer = createLogTailer({ logPath: join(dir, 'nope.log'), onData: () => {}, intervalMs: 60_000 });
        await expect(pollAndSettle(tailer)).resolves.toBeUndefined();
        tailer.stop();
    });
});

/*
 * REGRESSION (production, 2026-08-17): FFmpeg's stderr is BLOCK-buffered when it points at a
 * file rather than a terminal, so a recorder that dies quickly flushes its last words only as
 * it exits — after the tailer's final 1s poll. Camera 1169 closed with an empty captured tail
 * while "Too many packets buffered for output stream 0:0." sat plainly in its ffmpeg.log, so
 * the exit classified as the generic `ffmpeg_failed` and the recorder could learn nothing from
 * it. This read is what closes that window at close time.
 */
describe('readFfmpegLogTail', () => {
    it('returns the tail of a log the tailer never got to poll', async () => {
        const { readFfmpegLogTail } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-tail-${process.pid}.log`);
        writeFileSync(logPath, 'frame= 1\nToo many packets buffered for output stream 0:0.\n');

        try {
            expect(readFfmpegLogTail({ logPath })).toContain('Too many packets buffered');
        } finally {
            rmSync(logPath, { force: true });
        }
    });

    it('returns only the LAST maxBytes, so a 8 MB log cannot be pulled into memory', async () => {
        const { readFfmpegLogTail } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-tail-big-${process.pid}.log`);
        writeFileSync(logPath, `${'x'.repeat(5000)}TAIL_MARKER`);

        try {
            const tail = readFfmpegLogTail({ logPath, maxBytes: 64 });
            expect(tail).toContain('TAIL_MARKER');
            expect(tail.length).toBeLessThanOrEqual(64);
        } finally {
            rmSync(logPath, { force: true });
        }
    });

    /* A crashed recorder must never be turned into a second crash by its own diagnostics. */
    it('answers empty instead of throwing when there is no log to read', async () => {
        const { readFfmpegLogTail } = await import('../services/recordingFfmpegLog.js');

        expect(readFfmpegLogTail({ logPath: join(tmpdir(), 'tidak-ada-berkas-ini.log') })).toBe('');
        expect(readFfmpegLogTail({})).toBe('');
        expect(readFfmpegLogTail()).toBe('');
    });
});

/*
 * REGRESSION (production, 2026-08-17): the log is append-only and outlives every recorder that
 * writes to it, so an unbounded tail reports the PREVIOUS process's crash as this one's. Camera
 * 1169 failed with "method SETUP failed: 500" — a refused connection — and the tail still
 * carried an earlier "Too many packets buffered", classifying it as a stalled audio track and
 * pointing the self-repair at the wrong problem entirely.
 */
describe('readFfmpegLogTail respects where this process started writing', () => {
    it('never reads backwards into the previous recorder output', async () => {
        const { readFfmpegLogTail, currentLogSize } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-offset-${process.pid}.log`);
        writeFileSync(logPath, 'Too many packets buffered for output stream 0:0.\n');
        const offset = currentLogSize(logPath);
        appendFileSync(logPath, 'method SETUP failed: 500 Internal Server Error\n');

        try {
            const scoped = readFfmpegLogTail({ logPath, fromOffset: offset });
            expect(scoped).toContain('SETUP failed');
            expect(scoped).not.toContain('Too many packets');

            // Without the bound, the old line comes back — this is the bug, pinned.
            expect(readFfmpegLogTail({ logPath })).toContain('Too many packets');
        } finally {
            rmSync(logPath, { force: true });
        }
    });

    it('answers empty when this process wrote nothing at all', async () => {
        const { readFfmpegLogTail, currentLogSize } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-offset-empty-${process.pid}.log`);
        writeFileSync(logPath, 'riwayat lama\n');

        try {
            expect(readFfmpegLogTail({ logPath, fromOffset: currentLogSize(logPath) })).toBe('');
        } finally {
            rmSync(logPath, { force: true });
        }
    });

    it('currentLogSize answers 0 for a log that does not exist yet', async () => {
        const { currentLogSize } = await import('../services/recordingFfmpegLog.js');

        expect(currentLogSize(join(tmpdir(), 'belum-ada.log'))).toBe(0);
        expect(currentLogSize(null)).toBe(0);
    });
});

/*
 * REGRESSION (2026-08-19 audit T5): the tailer truncates the log itself once it passes 8 MB, but
 * anyone else holding a byte offset into that file is then pointing past its end. The exit
 * classifier does exactly that, and a stale offset made readFfmpegLogTail return nothing at all —
 * re-creating the very blindness the offset was introduced to prevent, arriving by another door.
 */
describe('createLogTailer memberi tahu pemegang offset saat log dipangkas', () => {
    it('memanggil onTruncate sesudah memangkas log yang melewati batas', async () => {
        const { createLogTailer } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-trunc-${process.pid}.log`);
        writeFileSync(logPath, 'x'.repeat(400));
        let truncated = 0;

        const tailer = createLogTailer({
            logPath, maxBytes: 100, intervalMs: 20,
            onData: () => {},
            onTruncate: () => { truncated += 1; },
        });

        try {
            await new Promise((r) => setTimeout(r, 200));
            expect(truncated).toBeGreaterThan(0);
            expect(statSync(logPath).size).toBe(0);
        } finally {
            tailer.stop();
            rmSync(logPath, { force: true });
        }
    }, 4000);

    it('tidak memanggil onTruncate untuk log yang masih di bawah batas', async () => {
        const { createLogTailer } = await import('../services/recordingFfmpegLog.js');
        const logPath = join(tmpdir(), `ffmpeg-notrunc-${process.pid}.log`);
        writeFileSync(logPath, 'kecil saja\n');
        let truncated = 0;

        const tailer = createLogTailer({
            logPath, maxBytes: 1_000_000, intervalMs: 20,
            onData: () => {},
            onTruncate: () => { truncated += 1; },
        });

        try {
            await new Promise((r) => setTimeout(r, 150));
            expect(truncated).toBe(0);
        } finally {
            tailer.stop();
            rmSync(logPath, { force: true });
        }
    }, 4000);
});
