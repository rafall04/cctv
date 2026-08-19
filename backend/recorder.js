// Purpose: Standalone recording worker — owns FFmpeg recorders and the whole recording
//          pipeline in its OWN process, so restarting the API never touches recording.
// Caller: pm2 app `<client>-cctv-recorder` (deployment/ecosystem.config.cjs).
// Deps: recordingDomainBootstrap, recordingService, recordingScheduler,
//       recordingWorkerStateRepository, connectionPool.
// MainFuncs: start, publishState, drainReconcileRequests, shutdown.
// SideEffects: Spawns/adopts FFmpeg, writes recording state tables, no HTTP surface.
//
// WHY A SEPARATE PROCESS
// ----------------------
// Recording used to live inside the API server. Every deploy — including pure UI and
// route changes, which is the overwhelming majority — restarted the process that owned
// ffmpeg. Detach+adopt (see recordingStarter/recordingAdopter) already stops a restart
// from breaking segments; this splits the blast radius as well, so API deploys do not
// even involve the recording pipeline.
//
// NO HTTP SURFACE ON PURPOSE
// --------------------------
// The API talks to this worker through SQLite (already WAL, so multi-process is safe):
// it queues reconcile requests, and reads the process state / health snapshot this
// worker publishes. That keeps the worker off the network entirely — no new port, no
// new auth surface, nothing extra to firewall on a box that already shares a LAN.

import fs from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';

// Same IPv4 pinning as server.js: this VPS has working IPv4 but dead IPv6 egress, and
// the recorder reaches external HLS sources + Telegram alerts.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

// Declare the role BEFORE anything reads config, so any shared module that branches on
// worker mode sees the worker's own answer rather than the API's .env value.
process.env.RECORDING_WORKER_ENABLED = 'true';

const { config } = await import('./config/config.js');
const { recordingService } = await import('./services/recordingService.js');
const { default: recordingScheduler } = await import('./services/recordingScheduler.js');
const { default: recordingHealthDashboardService } = await import('./services/recordingHealthDashboardService.js');
const { startRecordingDomain, stopRecordingDomain } = await import('./services/recordingDomainBootstrap.js');
const { default: workerState } = await import('./services/recordingWorkerStateRepository.js');
// connectionPool exports the pool teardown as `closeAll` (server.js imports it the same way).
// Importing the wrong name left closeDbConnections undefined, so every recorder shutdown threw
// "closeDbConnections is not a function" and skipped the WAL checkpoint (non-fatal — the WAL
// recovers on next open — which is why it stayed hidden).
const { closeAll: closeDbConnections } = await import('./database/connectionPool.js');

recordingService.attachScheduler(recordingScheduler);

const RECONCILE_REQUEST_INTERVAL_MS = config.recording.reconcileRequestIntervalMs;
const RECONCILE_SWEEP_INTERVAL_MS = config.recording.reconcileSweepIntervalMs;
const STATE_PUBLISH_INTERVAL_MS = config.recording.statePublishIntervalMs;

/**
 * Mirror the in-memory recorder map into recording_process_state, and the dashboard
 * payload into recording_health_snapshot. The API cannot see either directly any more.
 *
 * The snapshot doubles as the worker's heartbeat: readHealthSnapshot() reports it stale
 * past WORKER_HEARTBEAT_STALE_MS, which is how the API distinguishes "not recording"
 * from "I have no idea, the worker is gone".
 */
function publishState() {
    try {
        const activeIds = new Set(recordingService.getActiveRecordingCameraIds());

        for (const cameraId of activeIds) {
            const status = recordingService.getRecordingStatus(cameraId);
            workerState.publishProcessState(cameraId, {
                pid: status.pid,
                status: status.status,
                streamSource: status.streamSource,
                adopted: status.adopted,
                startedAt: status.startTime,
            });
        }

        // Drop rows for cameras this worker no longer records, so the API never reads
        // a stale "recording" for something that stopped.
        for (const row of workerState.readAllProcessState()) {
            if (!activeIds.has(row.camera_id)) {
                workerState.clearProcessState(row.camera_id);
            }
        }

        // Belt-and-suspenders for cameras.recording_status: handleRecordingClosed already resets it
        // on a close event, but this also heals rows a close never fires for (older build, process
        // lost across a hard crash). Cheap — it only writes when a row is actually stale.
        const corrected = recordingService.reconcileRecordingStatusColumn();
        if (corrected > 0) {
            console.log(`[Recorder] Corrected recording_status for ${corrected} stale camera row(s)`);
        }
    } catch (error) {
        console.error('[Recorder] Failed publishing process state:', error?.message || error);
    }

    try {
        workerState.publishHealthSnapshot(recordingHealthDashboardService.getSnapshot(), process.pid);
    } catch (error) {
        console.error('[Recorder] Failed publishing health snapshot:', error?.message || error);
    }
}

/**
 * Claim reconcile requests the API queued (camera edited, health flipped, settings
 * changed) and act on them. Replaces the direct in-process call the API used to make.
 */
async function drainReconcileRequests() {
    let requests;
    try {
        requests = workerState.takeReconcileRequests();
    } catch (error) {
        console.error('[Recorder] Failed reading reconcile requests:', error?.message || error);
        return;
    }

    for (const { cameraId, reason, action = 'reconcile' } of requests) {
        try {
            // An imperative is honoured as an imperative. Routing stop/restart through reconcile
            // meant the desired-state decision answered `noop_recording` for a camera that was
            // already running — so the admin stop button did nothing at all, and a changed RTSP
            // URL kept being recorded from the OLD source, both while replying success.
            if (action === 'stop') {
                await recordingService.stopRecording(cameraId, { reason });
            } else if (action === 'restart') {
                await recordingService.restartRecording(cameraId, reason);
            } else if (action === 'start') {
                await recordingService.startRecording(cameraId);
            } else {
                await recordingService.reconcileRecordingLifecycle(cameraId, reason);
            }
        } catch (error) {
            console.error(`[Recorder] ${action} failed for camera ${cameraId} (${reason}):`, error?.message || error);
        }
    }
}

async function start() {
    console.log('');
    console.log('🎥 RAF CCTV Recording Worker');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   pid: ${process.pid}`);
    console.log(`   reconcile requests : every ${RECONCILE_REQUEST_INTERVAL_MS}ms`);
    console.log(`   full sweep         : every ${RECONCILE_SWEEP_INTERVAL_MS}ms`);
    console.log(`   state publish      : every ${STATE_PUBLISH_INTERVAL_MS}ms`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await startRecordingDomain({ logger: console });

    recordingScheduler.register({
        name: 'recorder-reconcile-requests',
        task: drainReconcileRequests,
        intervalMs: RECONCILE_REQUEST_INTERVAL_MS,
        initialDelayMs: RECONCILE_REQUEST_INTERVAL_MS,
    });

    // Backstop: the request queue is the fast path, this catches anything missed
    // (row lost, worker restarted mid-request, camera changed while we were down).
    recordingScheduler.register({
        name: 'recorder-reconcile-sweep',
        task: () => recordingService.reconcileRecordingLifecycleAll('worker_sweep'),
        intervalMs: RECONCILE_SWEEP_INTERVAL_MS,
        initialDelayMs: RECONCILE_SWEEP_INTERVAL_MS,
    });

    recordingScheduler.register({
        name: 'recorder-publish-state',
        task: publishState,
        intervalMs: STATE_PUBLISH_INTERVAL_MS,
        initialDelayMs: 2000,
    });

    // Publish immediately so the API is not briefly told the worker is stale on boot.
    publishState();

    console.log('[Recorder] Worker ready — API restarts no longer touch recording');

    // pm2 wait_ready
    process.send?.('ready');
}

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log(`\n[Recorder] ${signal} received — detaching recorders (they keep running)...`);

    try {
        // Detach, do NOT stop: ffmpeg carries on across this restart and the next
        // worker boot adopts it. Same guarantee the API process gives.
        const detached = await stopRecordingDomain();
        console.log(`[Recorder] Detached ${detached.length} recorder(s) — still running, next boot will adopt them`);
    } catch (error) {
        console.error('[Recorder] Detach error:', error?.message || error);
    }

    // Separate blocks on purpose. Sharing one meant a throw from the scheduler skipped the
    // DB close entirely — the later step silently paying for the earlier one's failure.
    // Nothing is lost when that happens (process.exit hands the fds back and SQLite
    // recovers the WAL on next open), but the WAL goes uncheckpointed and the failure that
    // caused it is the one thing you would want reported cleanly.
    try {
        recordingScheduler.stop();
    } catch (error) {
        console.error('[Recorder] Scheduler stop error:', error?.message || error);
    }

    try {
        closeDbConnections();
    } catch (error) {
        console.error('[Recorder] Database cleanup error:', error?.message || error);
    }

    // Written synchronously for the same reason the fatal handler below is: console.log goes
    // to a pm2 PIPE, Node buffers it, and the process.exit() on the next line throws that
    // buffer away. The last lines of a shutdown — the ones saying it finished cleanly — are
    // therefore the ones most likely to vanish. Verified: the connection-pool close line was
    // being lost exactly this way, so the shutdown looked silent even though it worked.
    try {
        fs.writeSync(1, '[Recorder] Shutdown complete — recorders detached, database closed\n');
    } catch { /* stdout already gone */ }

    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

process.on('uncaughtException', (error) => {
    // Written synchronously: console/pino go to a pm2 PIPE, which Node buffers and
    // process.exit() discards — that is exactly how a boot crash once hid itself for
    // hours as a silent restart loop. See the same guard in server.js.
    try {
        fs.writeSync(2, `[Recorder][Fatal] Uncaught exception: ${error?.stack || error}\n`);
    } catch { /* stderr unavailable */ }
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
    // Log, do not tear down: recorders are mid-write and a detached per-task rejection
    // is not worth interrupting the whole pipeline for.
    console.error('[Recorder][UnhandledRejection] non-fatal, logged (worker stays up):', reason);
});

try {
    await start();
} catch (error) {
    try {
        fs.writeSync(2, `[Recorder][Fatal] Startup failed: ${error?.stack || error}\n`);
    } catch { /* stderr unavailable */ }
    process.exit(1);
}
