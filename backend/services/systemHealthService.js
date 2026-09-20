// Purpose: One-shot host/process/storage health aggregate behind GET /api/admin/system-health.
//          The 217-restart crash-loop and the load-11-on-8-core saturation found in the 2026-09
//          audit were invisible until someone shelled into the box — this endpoint is the
//          operator's answer to "is the SERVER okay", distinct from /recording-health (pipeline)
//          and /debug/camera-health (per-camera detail).
// Caller: controllers/adminController.js#getSystemHealth.
// Deps: node:os, node:fs.statfs, pm2 jlist (15s cache — spawning pm2 on every poll is itself load),
//       recordingWorkerStateRepository (worker heartbeat + reconcile queue), telegramArchiveService
//       (archive backlog), cameraHealthService (sweep liveness), connectionPool (WAL/DB file state).
// MainFuncs: createSystemHealthService (injectable factory), getSnapshot.
// SideEffects: Reads process/OS counters; spawns `pm2 jlist` at most once per PM2_CACHE_MS.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';
import { queryOne } from '../database/connectionPool.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import workerState from './recordingWorkerStateRepository.js';
import telegramArchiveService from './telegramArchiveService.js';
import playbackTelemetryService from './playbackTelemetryService.js';
import cameraHealthService from './cameraHealthService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const PM2_CACHE_MS = 15_000;
const PM2_TIMEOUT_MS = 5_000;
// Below this, recordingEmergencyDiskService starts bulk-deleting registered segments — that is a
// footage-loss event, so the health verdict goes critical BEFORE the emergency threshold.
const DISK_CRITICAL_FREE_PCT = 5;
const DISK_DEGRADED_FREE_PCT = 15;
const LOAD_DEGRADED_PER_CPU = 1.5;
const MEM_DEGRADED_PCT = 90;
const RECONCILE_QUEUE_DEGRADED = 500;

// dbPath is computed the same way connectionPool does — importing the resolved path would couple
// this read-only reporter to the pool's internals for no benefit.
const dbPath = path.isAbsolute(config.database.path)
    ? config.database.path
    : path.join(__dirname, '..', config.database.path);

async function probe(fn) {
    try {
        return { ok: true, data: await fn() };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export function createSystemHealthService({
    osApi = os,
    fsApi = fs,
    execFilePm2 = () => execFileAsync('pm2', ['jlist'], { timeout: PM2_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }),
    queryOneFn = queryOne,
    workerStateApi = workerState,
    telegramArchiveApi = telegramArchiveService,
    playbackTelemetryApi = playbackTelemetryService,
    cameraHealthApi = cameraHealthService,
    recordingsPath = RECORDINGS_BASE_PATH,
    workerEnabled = config.recording.workerEnabled,
    now = () => Date.now(),
} = {}) {
    let pm2Cache = { at: 0, result: null };

    async function pm2Processes() {
        if (pm2Cache.result && now() - pm2Cache.at < PM2_CACHE_MS) {
            return pm2Cache.result;
        }
        try {
            const { stdout } = await execFilePm2();
            const apps = JSON.parse(stdout).map((app) => ({
                name: app.name,
                status: app.pm2_env?.status || 'unknown',
                restarts: app.pm2_env?.restart_time ?? null,
                uptimeMs: app.pm2_env?.pm_uptime ? Math.max(0, now() - app.pm2_env.pm_uptime) : null,
                mode: app.pm2_env?.exec_mode || null,
                memBytes: app.monit?.memory ?? null,
                cpuPct: app.monit?.cpu ?? null,
            }));
            pm2Cache = { at: now(), result: { available: true, processes: apps } };
        } catch (error) {
            // Not running under pm2 (dev box, tests) is an expected condition, not a fault.
            pm2Cache = { at: now(), result: { available: false, processes: [], error: error.message } };
        }
        return pm2Cache.result;
    }

    function diskStats() {
        const st = fsApi.statfsSync(recordingsPath);
        const totalBytes = st.blocks * st.bsize;
        const freeBytes = st.bavail * st.bsize;
        return {
            path: recordingsPath,
            totalBytes,
            freeBytes,
            usedBytes: totalBytes - freeBytes,
            usedPct: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : null,
            freePct: totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 10 : null,
        };
    }

    function databaseStats() {
        const { journal_mode: journalMode } = queryOneFn('PRAGMA journal_mode');
        const stat = (suffix) => {
            try { return fsApi.statSync(`${dbPath}${suffix}`).size; } catch { return null; }
        };
        return {
            journalMode,
            dbBytes: stat(''),
            walBytes: stat('-wal'),
            shmBytes: stat('-shm'),
        };
    }

    function reconcileQueueDepth() {
        return queryOneFn('SELECT COUNT(*) AS n FROM recording_reconcile_requests')?.n ?? 0;
    }

    return {
        async getSnapshot() {
            const [pm2, recordingWorker, telegramArchive, playbackTelemetry, cameraHealth, disk, database] = await Promise.all([
                probe(pm2Processes),
                probe(async () => {
                    const published = workerStateApi.readHealthSnapshot();
                    return {
                        workerEnabled,
                        reachable: published.available && !published.stale,
                        stale: published.stale,
                        updatedAt: published.updatedAt,
                        ageMs: published.ageMs ?? null,
                        workerPid: published.workerPid,
                        reconcileQueueDepth: reconcileQueueDepth(),
                    };
                }),
                probe(async () => {
                    const delivery = telegramArchiveApi.deliveryHealth();
                    return {
                        configured: telegramArchiveApi.hasConfiguredRoutes(),
                        sidecarAvailable: telegramArchiveApi.isAvailable(),
                        evidenceAvailable: delivery.evidenceAvailable,
                        backlogMinutes: delivery.backlogMinutes,
                        stalled: delivery.stalled,
                        failingCameras: delivery.failing?.length ?? 0,
                    };
                }),
                probe(async () => playbackTelemetryApi.getSummary()),
                probe(() => cameraHealthApi.getStatus()),
                probe(async () => diskStats()),
                probe(async () => databaseStats()),
            ]);

            const problems = [];
            const critical = [];
            const d = disk.ok ? disk.data : null;
            if (!disk.ok) critical.push('recordings disk unreadable');
            else if (d.freePct != null && d.freePct <= DISK_CRITICAL_FREE_PCT) critical.push(`recordings disk ${d.freePct}% free`);
            else if (d.freePct != null && d.freePct <= DISK_DEGRADED_FREE_PCT) problems.push(`recordings disk ${d.freePct}% free`);
            if (!database.ok) critical.push('database unreachable');

            const cpus = osApi.cpus().length;
            const load = osApi.loadavg();
            if (cpus > 0 && load[0] / cpus > LOAD_DEGRADED_PER_CPU) problems.push(`load1 ${load[0].toFixed(1)} on ${cpus} cores`);
            const memUsedPct = Math.round(((osApi.totalmem() - osApi.freemem()) / osApi.totalmem()) * 1000) / 10;
            if (memUsedPct >= MEM_DEGRADED_PCT) problems.push(`memory ${memUsedPct}% used`);

            if (pm2.ok && pm2.data.available) {
                for (const app of pm2.data.processes) {
                    if (app.status !== 'online') critical.push(`pm2 ${app.name}: ${app.status}`);
                }
            }
            const rw = recordingWorker.ok ? recordingWorker.data : null;
            if (workerEnabled && (!rw || !rw.reachable)) critical.push('recording worker heartbeat stale/absent');
            if (rw && rw.reconcileQueueDepth > RECONCILE_QUEUE_DEGRADED) problems.push(`reconcile queue depth ${rw.reconcileQueueDepth}`);

            const tg = telegramArchive.ok ? telegramArchive.data : null;
            if (tg?.configured && tg.sidecarAvailable && tg.stalled) problems.push(`archive backlog ~${Math.round(tg.backlogMinutes)}m`);

            const ch = cameraHealth.ok ? cameraHealth.data : null;
            if (ch && ch.isRunning === false) problems.push('camera health sweep not running');

            return {
                status: critical.length > 0 ? 'critical' : problems.length > 0 ? 'degraded' : 'ok',
                problems,
                critical,
                checkedAt: new Date(now()).toISOString(),
                host: {
                    cpuCount: cpus,
                    loadavg: load,
                    memTotalBytes: osApi.totalmem(),
                    memFreeBytes: osApi.freemem(),
                    memUsedPct,
                    hostUptimeSec: Math.floor(osApi.uptime()),
                    processUptimeSec: Math.floor(process.uptime()),
                    node: process.version,
                    pm2Managed: process.env.pm_id != null,
                },
                recordingsDisk: disk.ok ? d : { error: disk.error },
                database: database.ok ? database.data : { error: database.error },
                pm2: pm2.ok ? pm2.data : { available: false, error: pm2.error },
                recordingWorker: rw || { error: recordingWorker.error },
                telegramArchive: tg || { error: telegramArchive.error },
                playbackTelemetry: playbackTelemetry.ok ? playbackTelemetry.data : { error: playbackTelemetry.error },
                cameraHealth: ch || { error: cameraHealth.error },
            };
        },
    };
}

export default createSystemHealthService();
