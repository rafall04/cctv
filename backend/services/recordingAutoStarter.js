// Purpose: Coordinate one-shot recording auto-start on service init via the lifecycle reconciler.
// Caller: recordingService facade (init flow).
// Deps: connectionPool query helper, recordingService for suspendOffline + reconcileAll.
// MainFuncs: createRecordingAutoStarter, autoStart.
// SideEffects: Reads camera rows, marks offline cameras as suspended, delegates start/stop decisions
//              to the lifecycle reconciler.

import { query as defaultQuery } from '../database/connectionPool.js';

export function createRecordingAutoStarter({
    query = defaultQuery,
    suspendOffline,
    reconcileAll,
    logger = console,
} = {}) {
    if (typeof suspendOffline !== 'function') {
        throw new Error('recordingAutoStarter requires suspendOffline callback');
    }
    if (typeof reconcileAll !== 'function') {
        throw new Error('recordingAutoStarter requires reconcileAll callback');
    }

    async function autoStart() {
        try {
            const offlineCameras = query(
                'SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1 AND COALESCE(is_online, 1) != 1'
            );
            for (const camera of offlineCameras) {
                suspendOffline(camera.id);
            }

            const result = await reconcileAll('auto_start');
            const started = result.results.filter((r) => r.action === 'start' && r.success).length;
            const skipped = result.results.length - started;
            logger.log?.(`[Recording] Auto-start complete: ${started} started, ${skipped} skipped (offline/cooldown/disabled)`);
            return { success: true, started, skipped, total: result.results.length };
        } catch (error) {
            logger.error?.('[Recording] Error in auto-starting recordings:', error);
            return { success: false, error: error?.message || String(error) };
        }
    }

    return { autoStart };
}
