import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    createRestartWatchdogService,
    classifyExitReason,
    RESTART_WINDOW_MS,
} from '../services/restartWatchdogService.js';

const APPS = ['rafnet-cctv-backend', 'rafnet-cctv-recorder', 'mediamtx'];
const pm2 = (name, restarts) => ({ name, pm2_env: { status: 'online', restart_time: restarts } });

function makeService(overrides = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rwatch-'));
    const persisted = { value: null };
    const sent = [];
    const svc = createRestartWatchdogService({
        bootLogPath: join(dir, 'boots.jsonl'),
        pm2LogDir: dir,
        getHead: () => 'abc123',
        sendMessage: async (msg) => { sent.push(msg); },
        telegramConfigured: () => true,
        loadState: () => persisted.value,
        saveState: (s) => { persisted.value = s; },
        threshold: 3,
        logger: { log() {}, error() {}, warn() {} },
        ...overrides,
    });
    return { svc, dir, sent, persisted };
}

describe('classifyExitReason', () => {
    it('deploy wins over log signatures — an intended restart is not blamed on a stale tail', () => {
        expect(classifyExitReason({ headChanged: true, tail: 'heap out of memory' })).toBe('deploy');
    });
    it('maps fatal signatures', () => {
        expect(classifyExitReason({ tail: 'FATAL ERROR: Reached heap limit Allocation failed' })).toBe('oom');
        expect(classifyExitReason({ tail: 'Error: listen EADDRINUSE: address already in use' })).toBe('port-conflict');
        expect(classifyExitReason({ tail: 'Error: Cannot find module ./x.js' })).toBe('boot-crash');
        expect(classifyExitReason({ tail: 'SyntaxError: Unexpected token' })).toBe('boot-crash');
    });
    it('falls back to unknown for clean tails (kill / signal / memory cap)', () => {
        expect(classifyExitReason({ tail: 'some ordinary warning' })).toBe('unknown');
        expect(classifyExitReason({})).toBe('unknown');
    });
});

describe('recordBoot', () => {
    let dir;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('appends a boot line and records the previous boot timestamp', () => {
        dir = mkdtempSync(join(tmpdir(), 'rwatch-'));
        const svc = createRestartWatchdogService({
            bootLogPath: join(dir, 'boots.jsonl'), pm2LogDir: dir,
            getHead: () => 'h1', logger: { log() {}, error() {} },
        });
        const e1 = svc.recordBoot({ now: 1000 });
        const e2 = svc.recordBoot({ now: 2000 });
        expect(e1.prevBootAt).toBeNull();
        expect(e1.prevExitReason).toBeNull();
        expect(e2.prevBootAt).toBe(1000);
        const lines = readFileSync(join(dir, 'boots.jsonl'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[1]).pid).toBe(process.pid);
    });

    it('classifies the previous exit as deploy when HEAD moved', () => {
        dir = mkdtempSync(join(tmpdir(), 'rwatch-'));
        let head = 'v1';
        const svc = createRestartWatchdogService({
            bootLogPath: join(dir, 'boots.jsonl'), pm2LogDir: dir,
            getHead: () => head, logger: { log() {}, error() {} },
        });
        svc.recordBoot({ now: 1000 });
        head = 'v2';
        expect(svc.recordBoot({ now: 2000 }).prevExitReason).toBe('deploy');
    });

    it('classifies previous exit from the own-app error-log tail', () => {
        dir = mkdtempSync(join(tmpdir(), 'rwatch-'));
        const svc = createRestartWatchdogService({
            bootLogPath: join(dir, 'boots.jsonl'), pm2LogDir: dir,
            ownAppName: 'rafnet-cctv-backend',
            getHead: () => 'same', logger: { log() {}, error() {} },
        });
        svc.recordBoot({ now: 1000 });
        writeFileSync(join(dir, 'rafnet-cctv-backend-error.log'), 'FATAL ERROR: heap out of memory\n');
        expect(svc.recordBoot({ now: 2000 }).prevExitReason).toBe('oom');
    });
});

describe('runRestartCycle', () => {
    let dir;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    beforeEach(() => { dir = null; });

    it('first poll only establishes a baseline — never alerts', async () => {
        const { svc, sent, dir: d } = makeService({ readApps: async () => APPS.map((n) => pm2(n, 40)) });
        dir = d;
        const res = await svc.runRestartCycle({ now: 1_000 });
        expect(res.checked).toBe(3);
        expect(sent).toHaveLength(0);
    });

    it('alerts once when restarts cross the threshold, then stays quiet', async () => {
        let restarts = 0;
        const { svc, sent, dir: d } = makeService({ readApps: async () => [pm2('rafnet-cctv-backend', restarts)] });
        dir = d;
        const t0 = 1_000_000;
        await svc.runRestartCycle({ now: t0 });           // baseline 0
        restarts = 4;
        await svc.runRestartCycle({ now: t0 + 60_000 });  // +4 > 3 → alert
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain('rafnet-cctv-backend');
        expect(sent[0]).toContain('4 restart');
        await svc.runRestartCycle({ now: t0 + 120_000 }); // still over threshold, no repeat
        expect(sent).toHaveLength(1);
    });

    it('does NOT alert at exactly the threshold', async () => {
        let restarts = 0;
        const { svc, sent, dir: d } = makeService({ readApps: async () => [pm2('rafnet-cctv-backend', restarts)] });
        dir = d;
        await svc.runRestartCycle({ now: 0 });
        restarts = 3;
        await svc.runRestartCycle({ now: 60_000 });
        expect(sent).toHaveLength(0);
    });

    it('sends a recovery once the window clears', async () => {
        let restarts = 0;
        const { svc, sent, dir: d } = makeService({ readApps: async () => [pm2('rafnet-cctv-backend', restarts)] });
        dir = d;
        await svc.runRestartCycle({ now: 0 });
        restarts = 5;
        await svc.runRestartCycle({ now: 60_000 });
        expect(sent).toHaveLength(1);
        await svc.runRestartCycle({ now: 60_000 + RESTART_WINDOW_MS + 1 });
        expect(sent).toHaveLength(2);
        expect(sent[1]).toContain('normal kembali');
    });

    it('counts restarts that happened while the backend was down (persisted delta)', async () => {
        const { svc, sent, persisted, dir: d } = makeService();
        dir = d;
        // Simulate: last persisted state had backend at 10; pm2 now says 14 → 4 while we were dead.
        persisted.value = { counts: { 'rafnet-cctv-backend': 10 }, events: {}, lastReason: {}, alerted: {} };
        svc.state = null;
        const fresh = createRestartWatchdogService({
            bootLogPath: join(d, 'b2.jsonl'), pm2LogDir: d, getHead: () => 'x',
            sendMessage: async (m) => sent.push(m), telegramConfigured: () => true,
            loadState: () => persisted.value, saveState: (s) => { persisted.value = s; },
            threshold: 3, logger: { log() {}, error() {} },
            readApps: async () => [pm2('rafnet-cctv-backend', 14)],
        });
        await fresh.runRestartCycle({ now: Date.now() });
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain('Restart berulang');
    });

    it('stays silent when pm2 is unreachable and never throws', async () => {
        const { svc, sent, dir: d } = makeService({ readApps: async () => { throw new Error('pm2 missing'); } });
        dir = d;
        const res = await svc.runRestartCycle();
        expect(res.checked).toBe(0);
        expect(sent).toHaveLength(0);
    });

    it('does not alert when Telegram is unconfigured, but still marks the edge', async () => {
        let restarts = 0;
        const { svc, sent, dir: d } = makeService({
            telegramConfigured: () => false,
            readApps: async () => [pm2('rafnet-cctv-backend', restarts)],
        });
        dir = d;
        await svc.runRestartCycle({ now: 0 });
        restarts = 9;
        await svc.runRestartCycle({ now: 60_000 });
        expect(sent).toHaveLength(0);
        expect(svc.getState().alerted['rafnet-cctv-backend']).toBe(true);
    });

    it('ignores apps that are missing from pm2 jlist', async () => {
        const { svc, dir: d } = makeService({ readApps: async () => [] });
        dir = d;
        const res = await svc.runRestartCycle();
        expect(res.checked).toBe(3); // watched count, not probed count
        expect(svc.getState().counts).toEqual({});
    });
});
