// Purpose: Re-attach this instance to recording FFmpeg left running by the previous one.
// Caller: recordingService facade (boot flow, before auto-start).
// Deps: recordingOrphanReaper scan/reap, recordingFfmpegLog path helper, connectionPool query.
// MainFuncs: createRecordingAdopter, adoptExisting.
// SideEffects: Registers adopted processes in the process manager; retires recorders
//              whose camera no longer exists.
//
// WHY ADOPTION EXISTS
// -------------------
// Recorders are spawned detached (own process group, stderr on a file) so that a
// backend restart does not interrupt them. That only pays off if the incoming
// instance takes them back instead of starting from scratch — otherwise the
// segment still dies, just one step later. This module is that hand-off.
//
// POLICY IS DELIBERATELY NOT DUPLICATED HERE
// ------------------------------------------
// We adopt every recorder whose camera row still exists, even if that camera should
// no longer be recording. The lifecycle reconciler runs immediately afterwards and
// already owns the "should this be running?" decision; letting it stop an adopted
// process (SIGINT, segment closes cleanly) is strictly better than this module
// second-guessing the policy and killing something it misjudged. Only recorders for
// a camera that has been deleted outright are retired here, since no reconcile pass
// will ever look at them again.

import { query as defaultQuery } from '../database/connectionPool.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import { getFfmpegLogPath } from './recordingFfmpegLog.js';
import {
    reapStrayRecordingProcesses as defaultReap,
    scanRecordingProcesses as defaultScan,
} from './recordingOrphanReaper.js';

export function createRecordingAdopter({
    query = defaultQuery,
    scan = defaultScan,
    reap = defaultReap,
    processManager,
    recordingsBasePath = RECORDINGS_BASE_PATH,
    logger = console,
    buildCallbacks = () => ({}),
} = {}) {
    if (!processManager) {
        throw new Error('recordingAdopter requires a processManager');
    }

    async function adoptExisting() {
        try {
            const scanResult = await scan({ recordingsBasePath, logger });
            if (scanResult.skipped) {
                return { success: true, adopted: [], retired: [], skipped: scanResult.skipped };
            }
            if (scanResult.error) {
                return { success: false, adopted: [], retired: [], error: scanResult.error };
            }

            const processes = scanResult.processes || [];
            if (processes.length === 0) {
                return { success: true, adopted: [], retired: [] };
            }

            const cameraIds = [...new Set(processes.map((entry) => entry.cameraId))];
            const placeholders = cameraIds.map(() => '?').join(',');
            const rows = cameraIds.length
                ? query(`SELECT * FROM cameras WHERE id IN (${placeholders})`, cameraIds)
                : [];
            const camerasById = new Map(rows.map((row) => [row.id, row]));

            const adopted = [];
            const seenCameras = new Set();

            for (const { pid, cameraId } of processes) {
                const camera = camerasById.get(cameraId);
                if (!camera) {
                    continue; // camera deleted — leave it for the reap pass below
                }
                // Two live recorders for one camera means the older one is a duplicate.
                // Adopt the first and let the reap pass retire the rest cleanly.
                if (seenCameras.has(cameraId)) {
                    continue;
                }

                const result = processManager.adopt(cameraId, {
                    pid,
                    camera,
                    streamSource: camera.stream_source || 'internal',
                    stderrLogPath: getFfmpegLogPath(recordingsBasePath, cameraId),
                    ...buildCallbacks(cameraId, camera),
                });

                if (result?.success) {
                    seenCameras.add(cameraId);
                    adopted.push({ cameraId, pid });
                } else {
                    logger.warn?.(`[Recording] Could not adopt camera ${cameraId} pid ${pid}: ${result?.message}`);
                }
            }

            const reapResult = await reap({
                recordingsBasePath,
                logger,
                keepPids: adopted.map((entry) => entry.pid),
            });

            if (adopted.length > 0) {
                logger.log?.(`[Recording] Adopted ${adopted.length} recorder(s) still running from the previous instance — segments continue uninterrupted`);
            }

            return {
                success: true,
                adopted,
                retired: reapResult.killed || [],
            };
        } catch (error) {
            logger.error?.('[Recording] Adoption failed:', error?.message || error);
            return { success: false, adopted: [], retired: [], error: error?.message || String(error) };
        }
    }

    return { adoptExisting };
}

export default createRecordingAdopter;
