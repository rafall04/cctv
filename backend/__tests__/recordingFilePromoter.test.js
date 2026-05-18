/**
 * Purpose: Validate file stability checking, atomic promote with EXDEV fallback, and noop unlink.
 * Caller: Vitest backend suite.
 * Deps: createRecordingFilePromoter with mocked fs + sleep.
 * MainFuncs: ensureStable, promote, removeIfExists.
 * SideEffects: None; fs is mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingFilePromoter } from '../services/recordingFilePromoter.js';

function makeFs() {
    return {
        stat: vi.fn(),
        rename: vi.fn(),
        copyFile: vi.fn(),
        unlink: vi.fn(),
    };
}

describe('createRecordingFilePromoter.ensureStable', () => {
    it('returns stable=true when two stats have identical size', async () => {
        const fs = makeFs();
        fs.stat
            .mockResolvedValueOnce({ size: 1024, mtimeMs: 100 })
            .mockResolvedValueOnce({ size: 1024, mtimeMs: 200 });
        const sleepFn = vi.fn().mockResolvedValue(undefined);
        const promoter = createRecordingFilePromoter({ fs, sleepFn });

        const result = await promoter.ensureStable('/x', 50);

        expect(result).toEqual({ stable: true, size: 1024, mtimeMs: 200 });
        expect(sleepFn).toHaveBeenCalledWith(50);
    });

    it('returns stable=false when size changed', async () => {
        const fs = makeFs();
        fs.stat
            .mockResolvedValueOnce({ size: 1024, mtimeMs: 100 })
            .mockResolvedValueOnce({ size: 2048, mtimeMs: 200 });
        const promoter = createRecordingFilePromoter({ fs, sleepFn: () => Promise.resolve() });

        const result = await promoter.ensureStable('/x', 10);

        expect(result).toEqual({ stable: false, size: 2048, mtimeMs: 200 });
    });
});

describe('createRecordingFilePromoter.promote', () => {
    it('renames in the happy path', async () => {
        const fs = makeFs();
        fs.rename.mockResolvedValue(undefined);
        const promoter = createRecordingFilePromoter({ fs });

        await promoter.promote('/tmp/a', '/final/a');

        expect(fs.rename).toHaveBeenCalledWith('/tmp/a', '/final/a');
        expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('falls back to copy+unlink on EXDEV', async () => {
        const fs = makeFs();
        const exdev = new Error('cross-device');
        exdev.code = 'EXDEV';
        fs.rename.mockRejectedValue(exdev);
        fs.copyFile.mockResolvedValue(undefined);
        fs.unlink.mockResolvedValue(undefined);
        const promoter = createRecordingFilePromoter({ fs });

        await promoter.promote('/tmp/a', '/final/a');

        expect(fs.copyFile).toHaveBeenCalledWith('/tmp/a', '/final/a');
        expect(fs.unlink).toHaveBeenCalledWith('/tmp/a');
    });

    it('rethrows non-EXDEV rename errors', async () => {
        const fs = makeFs();
        fs.rename.mockRejectedValue(new Error('EACCES'));
        const promoter = createRecordingFilePromoter({ fs });

        await expect(promoter.promote('/tmp/a', '/final/a')).rejects.toThrow('EACCES');
        expect(fs.copyFile).not.toHaveBeenCalled();
    });
});

describe('createRecordingFilePromoter.removeIfExists', () => {
    it('swallows ENOENT', async () => {
        const fs = makeFs();
        const enoent = new Error('no such file');
        enoent.code = 'ENOENT';
        fs.unlink.mockRejectedValue(enoent);
        const promoter = createRecordingFilePromoter({ fs });

        await expect(promoter.removeIfExists('/x')).resolves.toBeUndefined();
    });

    it('rethrows non-ENOENT errors', async () => {
        const fs = makeFs();
        fs.unlink.mockRejectedValue(new Error('EBUSY'));
        const promoter = createRecordingFilePromoter({ fs });

        await expect(promoter.removeIfExists('/x')).rejects.toThrow('EBUSY');
    });

    it('completes silently when unlink succeeds', async () => {
        const fs = makeFs();
        fs.unlink.mockResolvedValue(undefined);
        const promoter = createRecordingFilePromoter({ fs });

        await expect(promoter.removeIfExists('/x')).resolves.toBeUndefined();
        expect(fs.unlink).toHaveBeenCalledWith('/x');
    });
});
