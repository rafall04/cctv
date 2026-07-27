// Purpose: The recording domain's start/stop sequence, shared by the API process
//          (single-process mode) and by backend/recorder.js (worker mode).
// Caller: server.js when config.recording.workerEnabled is false; recorder.js always.
// Deps: recordingService, recordingScheduler, recordingHealthAlertService.
// MainFuncs: startRecordingDomain, stopRecordingDomain.
// SideEffects: Adopts/starts FFmpeg recorders, registers scheduler tasks.
//
// Extracted so the boot order cannot drift between the two processes. The order is
// load-bearing: adoption MUST run before auto-start, or a camera whose recorder
// survived the restart gets a second ffmpeg pointed at the same output directory.

import { recordingService } from './recordingService.js';
import recordingScheduler from './recordingScheduler.js';
import recordingHealthAlertService from './recordingHealthAlertService.js';

export async function startRecordingDomain({
    logger = console,
    mediaMtxSettleMs = 5000,
    registerHealthAlerts = true,
} = {}) {
    if (mediaMtxSettleMs > 0) {
        logger.log?.('[Recording] Waiting for MediaMTX paths to be ready...');
        await new Promise((resolve) => setTimeout(resolve, mediaMtxSettleMs));
    }

    // Re-attach to recorders left running by the previous instance instead of killing
    // them. This is what makes a restart invisible to recording. Must precede
    // auto-start so adopted cameras are already known to be recording.
    const adoption = await recordingService.adoptExistingRecordings();
    if (adoption.adopted?.length) {
        logger.log?.(`[Recording] Adopted ${adoption.adopted.length} running recorder(s) — no segment interrupted by this restart`);
    }
    if (adoption.retired?.length) {
        logger.log?.(`[Recording] Retired ${adoption.retired.length} recorder(s) with no matching camera`);
    }

    logger.log?.('[Recording] Auto-starting recordings with retry logic...');
    await recordingService.autoStartRecordings();
    recordingService.initializeBackgroundWork();
    logger.log?.('[Recording] Background scheduler initialized');

    if (registerHealthAlerts) {
        // Edge-triggered Telegram alerts when the pipeline level changes (ok ⇄ warning ⇄ critical).
        recordingScheduler.register({
            name: 'recording-health-alert',
            task: () => recordingHealthAlertService.checkAndAlert(),
            intervalMs: 60000,
            initialDelayMs: 60000,
        });
        logger.log?.('[Recording] Health-alert watcher registered');
    }

    logger.log?.('[Recording] Recording service initialized');
    return { adoption };
}

/**
 * Stop owning the recording domain. Recorders are DETACHED (still running) unless the
 * caller explicitly asks otherwise — see recordingService.shutdown().
 */
export async function stopRecordingDomain(options = {}) {
    return recordingService.shutdown(options);
}

export default { startRecordingDomain, stopRecordingDomain };
