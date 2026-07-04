// Purpose: Kill stray FFmpeg recording processes left behind by a previous backend
//          instance (crash / OOM / pm2 hard-restart reparents child ffmpeg to init,
//          where they keep holding the camera's RTSP session and writing empty partials).
// Caller: server.js boot — ONCE, before this instance starts any recorder.
// Deps: child_process exec (injectable), recordingPaths RECORDINGS_BASE_PATH.
// MainFuncs: reapStrayRecordingProcesses.
// SideEffects: Runs `ps`/`kill` on Linux; no-op on other platforms. Never throws.

import { promisify } from 'util';
import { exec as nodeExec } from 'child_process';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';

const execAsync = promisify(nodeExec);

// Recording processes are the only ffmpeg that write to "<base>/cameraN/pending/".
// Matching on that (plus the resolved base path) avoids ever touching thumbnail
// ffmpeg or unrelated processes.
const RECORDING_OUTPUT_RE = /[/\\]camera\d+[/\\]pending[/\\]/;

/**
 * Reap stray recording ffmpeg. Safe to call ONLY at boot, before this instance
 * starts any recorder — at that point every ffmpeg writing to our recordings dir
 * is, by definition, an orphan from a previous instance. Graceful shutdown cannot
 * be relied on to prevent these (it loses the race with pm2's kill timeout, and a
 * SIGKILL/OOM/power-loss bypasses it entirely), so this is the reliable backstop.
 */
export async function reapStrayRecordingProcesses({
    recordingsBasePath = RECORDINGS_BASE_PATH,
    runCommand = (cmd) => execAsync(cmd),
    platform = process.platform,
    logger = console,
} = {}) {
    if (platform !== 'linux') {
        return { skipped: 'unsupported_platform', killed: [] };
    }
    if (!recordingsBasePath) {
        return { skipped: 'no_base_path', killed: [] };
    }

    const marker = String(recordingsBasePath).replace(/[/\\]+$/, '');

    try {
        const { stdout } = await runCommand('ps -eo pid=,args=');
        const pids = String(stdout || '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.includes('ffmpeg')
                && line.includes(marker)
                && RECORDING_OUTPUT_RE.test(line))
            .map((line) => Number.parseInt(line, 10))
            .filter((pid) => Number.isInteger(pid) && pid > 0);

        if (pids.length === 0) {
            return { killed: [] };
        }

        await runCommand(`kill -9 ${pids.join(' ')}`);
        logger.log?.(`[OrphanReaper] Killed ${pids.length} stray recording ffmpeg process(es) from a previous instance: ${pids.join(', ')}`);
        return { killed: pids };
    } catch (error) {
        logger.error?.('[OrphanReaper] Failed to reap stray recording processes:', error?.message || error);
        return { error: error?.message || String(error), killed: [] };
    }
}

export default reapStrayRecordingProcesses;
