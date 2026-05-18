// Purpose: Atomically promote a temp recording file to its final path, plus stability check + safe unlink.
// Caller: recordingSegmentFinalizer.
// Deps: fs promises.
// MainFuncs: createRecordingFilePromoter, promote, ensureStable, removeIfExists.
// SideEffects: rename/copy/unlink on the filesystem.

import { promises as defaultFs } from 'fs';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRecordingFilePromoter({ fs = defaultFs, sleepFn = sleep } = {}) {
    /**
     * Check that the file size has stopped growing across a stabilityDelayMs window.
     * Returns { stable, size, mtimeMs }. stable=false means the writer is still active.
     */
    async function ensureStable(filePath, stabilityDelayMs) {
        const first = await fs.stat(filePath);
        await sleepFn(stabilityDelayMs);
        const second = await fs.stat(filePath);
        return {
            stable: first.size === second.size,
            size: second.size,
            mtimeMs: second.mtimeMs,
        };
    }

    /**
     * Atomic rename → final path. Falls back to copy+unlink for cross-device (EXDEV).
     */
    async function promote(tempPath, finalPath) {
        try {
            await fs.rename(tempPath, finalPath);
        } catch (error) {
            if (error.code !== 'EXDEV') {
                throw error;
            }
            await fs.copyFile(tempPath, finalPath);
            await fs.unlink(tempPath);
        }
    }

    async function removeIfExists(filePath) {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    return { ensureStable, promote, removeIfExists };
}
