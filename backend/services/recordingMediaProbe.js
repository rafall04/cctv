// Purpose: Thin ffprobe wrapper that returns rounded-integer recording duration in seconds.
// Caller: recordingSegmentFinalizer.
// Deps: child_process exec via promisify.
// MainFuncs: createRecordingMediaProbe, probeDuration.
// SideEffects: Spawns ffprobe child process.

import { exec } from 'child_process';
import { promisify } from 'util';

const defaultExecPromise = promisify(exec);

function parseDurationStdout(stdout) {
    const duration = Math.round(parseFloat(String(stdout || '').trim()));
    return Number.isFinite(duration) && duration >= 1 ? duration : null;
}

export function createRecordingMediaProbe({
    execPromise = defaultExecPromise,
    timeoutMs = 5000,
} = {}) {
    async function probeDuration(filePath) {
        const { stdout } = await execPromise(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf8', timeout: timeoutMs }
        );
        return parseDurationStdout(stdout);
    }

    return { probeDuration };
}

export { parseDurationStdout };
