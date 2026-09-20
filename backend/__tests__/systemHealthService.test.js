// Purpose: Cover the system-health aggregate's verdict rules and fail-soft sections.
// Caller: backend test gate.
// Deps: createSystemHealthService with injected os/fs/pm2/db fakes — no real host probing.
// MainFuncs: getSnapshot status derivation, per-section degradation, pm2 cache.
// SideEffects: None — every probe is injected.

import { describe, expect, it, vi } from 'vitest';
import { createSystemHealthService } from '../services/systemHealthService.js';

const healthyOs = {
    cpus: () => new Array(8).fill({}),
    loadavg: () => [2, 2, 2],
    totalmem: () => 16 * 1024 ** 3,
    freemem: () => 6 * 1024 ** 3,
    uptime: () => 86_400,
};

const healthyFs = {
    statfsSync: () => ({ blocks: 1000, bsize: 1024 * 1024, bavail: 400 }), // 400 GiB free of 1 TiB
    statSync: () => ({ size: 1024 }),
};

const pm2Online = vi.fn(async () => ({
    stdout: JSON.stringify([
        { name: 'rafnet-cctv-backend', pm2_env: { status: 'online', restart_time: 217, pm_uptime: Date.now() - 3_600_000, exec_mode: 'fork_mode' }, monit: { memory: 400e6, cpu: 5 } },
    ]),
}));

const okQuery = vi.fn((sql) => (sql.includes('journal_mode') ? { journal_mode: 'wal' } : { n: 3 }));

const baseDeps = () => ({
    osApi: healthyOs,
    fsApi: healthyFs,
    execFilePm2: pm2Online,
    queryOneFn: okQuery,
    workerStateApi: { readHealthSnapshot: () => ({ available: true, stale: false, snapshot: {}, updatedAt: 'x', workerPid: 1, ageMs: 1000 }) },
    telegramArchiveApi: {
        deliveryHealth: () => ({ evidenceAvailable: true, backlogMinutes: 1, stalled: false, failing: [] }),
        hasConfiguredRoutes: () => true,
        isAvailable: () => true,
    },
    cameraHealthApi: { getStatus: async () => ({ total: 10, online: 9, offline: 1, isRunning: true }) },
    workerEnabled: true,
});

describe('systemHealthService.getSnapshot', () => {
    it('reports ok with all sections populated on a healthy box', async () => {
        const snap = await createSystemHealthService(baseDeps()).getSnapshot();
        expect(snap.status).toBe('ok');
        expect(snap.critical).toEqual([]);
        expect(snap.host.cpuCount).toBe(8);
        expect(snap.recordingsDisk.usedPct).toBe(60);
        expect(snap.database.journalMode).toBe('wal');
        expect(snap.pm2.processes[0].restarts).toBe(217);
        expect(snap.recordingWorker.reconcileQueueDepth).toBe(3);
        expect(snap.telegramArchive.stalled).toBe(false);
        expect(snap.cameraHealth.online).toBe(9);
    });

    it('goes critical when recordings disk is nearly full', async () => {
        const deps = baseDeps();
        deps.fsApi = { ...healthyFs, statfsSync: () => ({ blocks: 1000, bsize: 1, bavail: 30 }) }; // 3% free
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('critical');
        expect(snap.critical[0]).toMatch(/recordings disk/);
    });

    it('degrades on load-per-core saturation and memory pressure', async () => {
        const deps = baseDeps();
        deps.osApi = { ...healthyOs, loadavg: () => [13, 9, 7], freemem: () => 0.5 * 1024 ** 3 };
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('degraded');
        expect(snap.problems.join(' ')).toMatch(/load1 13\.0 on 8 cores/);
        expect(snap.problems.join(' ')).toMatch(/memory 9[0-9.]*% used/);
    });

    it('goes critical when a pm2 app is not online', async () => {
        const deps = baseDeps();
        deps.execFilePm2 = vi.fn(async () => ({
            stdout: JSON.stringify([{ name: 'rafnet-cctv-recorder', pm2_env: { status: 'errored' }, monit: {} }]),
        }));
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('critical');
        expect(snap.critical.join(' ')).toMatch(/pm2 rafnet-cctv-recorder: errored/);
    });

    it('survives pm2 being absent (dev box) without a verdict penalty', async () => {
        const deps = baseDeps();
        deps.execFilePm2 = vi.fn(async () => { throw new Error('pm2 not found'); });
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.pm2.available).toBe(false);
        expect(snap.status).toBe('ok');
    });

    it('caches pm2 jlist output inside the cache window', async () => {
        const deps = baseDeps();
        const freshPm2 = vi.fn(async () => ({ stdout: '[]' }));
        deps.execFilePm2 = freshPm2;
        const svc = createSystemHealthService(deps);
        await svc.getSnapshot();
        await svc.getSnapshot();
        expect(freshPm2).toHaveBeenCalledTimes(1);
    });

    it('goes critical when the recording worker heartbeat is stale', async () => {
        const deps = baseDeps();
        deps.workerStateApi = { readHealthSnapshot: () => ({ available: true, stale: true, snapshot: {}, updatedAt: 'x', workerPid: 1, ageMs: 999_999 }) };
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('critical');
        expect(snap.critical.join(' ')).toMatch(/recording worker/);
    });

    it('does not penalize a stale worker snapshot when the worker is disabled', async () => {
        const deps = baseDeps();
        deps.workerEnabled = false;
        deps.workerStateApi = { readHealthSnapshot: () => ({ available: false, stale: true, snapshot: null, updatedAt: null, workerPid: null }) };
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('ok');
    });

    it('goes critical when the database probe throws', async () => {
        const deps = baseDeps();
        deps.queryOneFn = vi.fn(() => { throw new Error('SQLITE_CANTOPEN'); });
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('critical');
        expect(snap.critical).toContain('database unreachable');
    });

    it('degrades when the archive backlog is stalled', async () => {
        const deps = baseDeps();
        deps.telegramArchiveApi.deliveryHealth = () => ({ evidenceAvailable: true, backlogMinutes: 90, stalled: true, failing: [] });
        const snap = await createSystemHealthService(deps).getSnapshot();
        expect(snap.status).toBe('degraded');
        expect(snap.problems.join(' ')).toMatch(/archive backlog ~90m/);
    });
});
