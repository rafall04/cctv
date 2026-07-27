// Purpose: Discover recording FFmpeg processes left by a previous backend instance,
//          so boot can ADOPT the ones we still want and retire only the rest.
// Caller: server.js boot (via recordingService.adoptExistingRecordings).
// Deps: child_process exec (injectable), recordingPaths RECORDINGS_BASE_PATH.
// MainFuncs: scanRecordingProcesses, parseRecordingProcesses, reapStrayRecordingProcesses.
// SideEffects: Runs `ps`/`kill` on Linux; no-op on other platforms. Never throws.
//
// HISTORY — why this file no longer kills everything it finds
// -----------------------------------------------------------
// It used to `kill -9` every recorder from a previous instance, on the theory that
// any survivor was garbage. Two things were wrong with that:
//
//   1. SIGKILL gives ffmpeg no chance to write the moov atom, so the in-flight
//      segment became UNPLAYABLE rather than merely short. Prod logs were full of
//      "moov atom not found" from exactly this.
//   2. Those processes are mostly not garbage — they are healthy recorders still
//      writing good video. Killing them is what made every backend restart punch a
//      hole in the recordings.
//
// Recorders are now spawned detached with their stderr on a file, specifically so
// they survive a restart and the next instance can re-attach. This module's job is
// therefore discovery; retiring a process is the exception, and when it does happen
// it goes SIGINT-first so the segment closes cleanly.

import { promisify } from 'util';
import { exec as nodeExec } from 'child_process';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';

const execAsync = promisify(nodeExec);

// Recording processes are the only ffmpeg that write to "<base>/cameraN/pending/".
// Matching on that (plus the resolved base path) avoids ever touching thumbnail
// ffmpeg or unrelated processes. The capture group carries the camera id, which is
// what lets adoption map a pid back to the camera it belongs to.
const RECORDING_OUTPUT_RE = /[/\\]camera(\d+)[/\\]pending[/\\]/;

// Time given to a retired recorder to flush its moov atom before SIGKILL.
export const REAP_GRACEFUL_STOP_MS = 8000;

/**
 * Pure parser: `ps -eo pid=,args=` output → [{ pid, cameraId }] for our recorders.
 */
export function parseRecordingProcesses(psOutput, marker) {
    if (!marker) {
        return [];
    }

    return String(psOutput || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('ffmpeg') && line.includes(marker))
        .map((line) => {
            const match = RECORDING_OUTPUT_RE.exec(line);
            if (!match) {
                return null;
            }
            const pid = Number.parseInt(line, 10);
            const cameraId = Number.parseInt(match[1], 10);
            if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(cameraId)) {
                return null;
            }
            return { pid, cameraId };
        })
        .filter(Boolean);
}

/**
 * List the recording ffmpeg currently running against our recordings directory.
 * Safe to call at any time; it only reads process state.
 */
export async function scanRecordingProcesses({
    recordingsBasePath = RECORDINGS_BASE_PATH,
    runCommand = (cmd) => execAsync(cmd),
    platform = process.platform,
    logger = console,
} = {}) {
    if (platform !== 'linux') {
        return { skipped: 'unsupported_platform', processes: [] };
    }
    if (!recordingsBasePath) {
        return { skipped: 'no_base_path', processes: [] };
    }

    const marker = String(recordingsBasePath).replace(/[/\\]+$/, '');

    try {
        const { stdout } = await runCommand('ps -eo pid=,args=');
        return { processes: parseRecordingProcesses(stdout, marker) };
    } catch (error) {
        logger.error?.('[OrphanReaper] Failed to scan recording processes:', error?.message || error);
        return { error: error?.message || String(error), processes: [] };
    }
}

/**
 * Retire recording ffmpeg that this instance does NOT want to keep.
 *
 * `keepPids` is the set adoption claimed — everything else is a recorder for a
 * camera that should no longer be recording (disabled, deleted, unrecordable) or
 * a duplicate. SIGINT first so ffmpeg finalizes its segment; SIGKILL only for
 * whatever ignores that.
 */
export async function reapStrayRecordingProcesses({
    recordingsBasePath = RECORDINGS_BASE_PATH,
    runCommand = (cmd) => execAsync(cmd),
    platform = process.platform,
    logger = console,
    keepPids = [],
    gracefulStopMs = REAP_GRACEFUL_STOP_MS,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    const scan = await scanRecordingProcesses({ recordingsBasePath, runCommand, platform, logger });
    if (scan.skipped || scan.error) {
        return { skipped: scan.skipped, error: scan.error, killed: [] };
    }

    const keep = new Set(keepPids);
    const pids = scan.processes.map((entry) => entry.pid).filter((pid) => !keep.has(pid));

    if (pids.length === 0) {
        return { killed: [] };
    }

    try {
        // SIGINT: ffmpeg treats it as "finish the file and exit", which is the whole
        // difference between a short segment and a corrupt one.
        await runCommand(`kill -INT ${pids.join(' ')}`);
        logger.log?.(`[OrphanReaper] Retiring ${pids.length} unwanted recording ffmpeg (SIGINT): ${pids.join(', ')}`);

        await wait(gracefulStopMs);

        const after = await scanRecordingProcesses({ recordingsBasePath, runCommand, platform, logger });
        const survivors = after.processes
            .map((entry) => entry.pid)
            .filter((pid) => pids.includes(pid));

        if (survivors.length > 0) {
            await runCommand(`kill -9 ${survivors.join(' ')}`);
            logger.warn?.(`[OrphanReaper] ${survivors.length} recorder(s) ignored SIGINT, force-killed: ${survivors.join(', ')}`);
        }

        return { killed: pids, forceKilled: survivors };
    } catch (error) {
        logger.error?.('[OrphanReaper] Failed to reap stray recording processes:', error?.message || error);
        return { error: error?.message || String(error), killed: [] };
    }
}

export default reapStrayRecordingProcesses;
