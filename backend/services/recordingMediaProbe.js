// Purpose: Thin ffprobe wrapper that returns rounded-integer recording duration in seconds.
// Caller: recordingSegmentFinalizer.
// Deps: child_process exec via promisify.
// MainFuncs: createRecordingMediaProbe, probeDuration.
// SideEffects: Spawns ffprobe child process.

// execFile + argv array: no shell means `$( )`/backticks/quotes in a path can never become
// command injection — even though the caller's filenames are already regex-locked.
import { execFile } from 'child_process';
import { promisify } from 'util';

const defaultExecFilePromise = promisify(execFile);

function parseDurationStdout(stdout) {
    const duration = Math.round(parseFloat(String(stdout || '').trim()));
    return Number.isFinite(duration) && duration >= 1 ? duration : null;
}

export function createRecordingMediaProbe({
    execFilePromise = defaultExecFilePromise,
    timeoutMs = 5000,
} = {}) {
    async function probeDuration(filePath) {
        const { stdout } = await execFilePromise(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
            { encoding: 'utf8', timeout: timeoutMs }
        );
        return parseDurationStdout(stdout);
    }

    return { probeDuration };
}

export { parseDurationStdout };
