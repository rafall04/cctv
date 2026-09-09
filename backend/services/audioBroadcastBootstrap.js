/*
Purpose: Boot the Audio Broadcast background work in one call, so server.js gains only a single line.
         Mirrors recordingDomainBootstrap's role for recording. Route registration stays in server.js
         (where every fastify.register lives) — a service must never import a route.
Caller: backend/server.js (startup phase).
Deps: audioClipService (ensureAudioDir), audioScheduleService (startScheduler).
MainFuncs: startAudioBroadcast.
SideEffects: on the primary worker, creates data/audio and starts the schedule ticker.
*/

import { ensureAudioDir } from './audioClipService.js';
import { startScheduler } from './audioScheduleService.js';
import { startCapabilitySweep } from './audioCapabilityService.js';
import { startImportWorker } from './audioImportService.js';

/**
 * ensureAudioDir runs on every worker (a harmless mkdir), but the schedule ticker runs ONLY on the
 * primary worker: the per-camera busy-guard is per-process, so two workers firing the same schedule
 * would push overlapping RTP to one speaker and garble it (same reason the Telegram poller is gated).
 * @param {boolean} isPrimaryWorker
 */
export function startAudioBroadcast(isPrimaryWorker) {
    ensureAudioDir();
    if (isPrimaryWorker) {
        startScheduler();
        startCapabilitySweep();
        startImportWorker();
    } else {
        console.log('[Audio] Scheduler not started on secondary worker (runs only on worker 0)');
    }
}
