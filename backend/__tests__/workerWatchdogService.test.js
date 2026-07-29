/*
 * Purpose: Lock in that the watchdog alerts on TRANSITIONS only — a worker that stays down must not
 *          resend the same alarm every cycle.
 * Caller: Backend Vitest suite.
 * Deps: mocked child_process probes + mocked telegramService.
 * MainFuncs: runWatchdogCycle transition tests.
 * SideEffects: None.
 *
 * The rate rule matters as much as the alert: at a 5-minute cycle, alerting on STATE instead of
 * TRANSITION would send 288 messages a day for one dead worker — which is how an alert channel
 * stops being read, exactly the failure the log cleanup in this repo was about.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const sendHealthAlertMock = vi.fn(() => Promise.resolve());

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('../services/telegramService.js', () => ({
    sendHealthAlertMessage: sendHealthAlertMock,
}));

// promisify(execFile) reads the custom symbol when present; supplying it keeps the service's
// `promisify` wrapper honest without us re-implementing callback plumbing per test.
execFileMock[Symbol.for('nodejs.util.promisify.custom')] = (...args) => execFileMock.impl(...args);

const { runWatchdogCycle, resetWatchdogState, WATCHED_WORKERS } = await import('../services/workerWatchdogService.js');

/** Make every probe report the same up/down verdict. */
function allWorkers(up) {
    execFileMock.impl = (cmd) => {
        if (cmd === 'pm2') {
            return Promise.resolve({
                stdout: JSON.stringify(
                    WATCHED_WORKERS.filter((w) => w.supervisor === 'pm2')
                        .map((w) => ({ name: w.name, pm2_env: { status: up ? 'online' : 'stopped' } }))
                ),
            });
        }
        if (cmd === 'systemctl') return Promise.resolve({ stdout: up ? 'active\n' : 'failed\n' });
        return Promise.resolve({ stdout: up ? 'true\n' : 'false\n' });
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetWatchdogState();
});

describe('workerWatchdogService', () => {
    it('the FIRST cycle only establishes a baseline — it never alerts', async () => {
        allWorkers(true);
        const result = await runWatchdogCycle();

        expect(result.checked).toBe(WATCHED_WORKERS.length);
        expect(result.transitions).toEqual([]);
        // Otherwise every backend restart would announce five "recoveries".
        expect(sendHealthAlertMock).not.toHaveBeenCalled();
    });

    it('alerts once when a worker goes down, and STAYS QUIET while it remains down', async () => {
        allWorkers(true);
        await runWatchdogCycle();               // baseline: all up

        allWorkers(false);
        const first = await runWatchdogCycle();  // everything just died
        expect(first.transitions).toHaveLength(WATCHED_WORKERS.length);
        expect(sendHealthAlertMock).toHaveBeenCalledTimes(WATCHED_WORKERS.length);
        expect(sendHealthAlertMock.mock.calls[0][0]).toMatch(/Worker MATI/);

        sendHealthAlertMock.mockClear();
        const second = await runWatchdogCycle(); // still down — must be silent
        expect(second.transitions).toEqual([]);
        expect(sendHealthAlertMock).not.toHaveBeenCalled();
    });

    it('alerts again when the worker comes back', async () => {
        allWorkers(true);
        await runWatchdogCycle();
        allWorkers(false);
        await runWatchdogCycle();
        sendHealthAlertMock.mockClear();

        allWorkers(true);
        const recovered = await runWatchdogCycle();

        expect(recovered.transitions.every((t) => t.up)).toBe(true);
        expect(sendHealthAlertMock).toHaveBeenCalledTimes(WATCHED_WORKERS.length);
        expect(sendHealthAlertMock.mock.calls[0][0]).toMatch(/Worker pulih/);
    });

    it('treats a probe that throws as DOWN — systemctl/docker exit non-zero for a stopped unit', async () => {
        allWorkers(true);
        await runWatchdogCycle();

        execFileMock.impl = () => Promise.reject(Object.assign(new Error('Unit not found'), { stdout: '' }));
        const result = await runWatchdogCycle();

        expect(result.transitions).toHaveLength(WATCHED_WORKERS.length);
        expect(result.transitions.every((t) => t.up === false)).toBe(true);
    });

    it('a failing Telegram send does not stop the remaining workers being checked', async () => {
        allWorkers(true);
        await runWatchdogCycle();
        sendHealthAlertMock.mockRejectedValue(new Error('bot token invalid'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        allWorkers(false);
        const result = await runWatchdogCycle();

        expect(result.checked).toBe(WATCHED_WORKERS.length);
        expect(result.transitions).toHaveLength(WATCHED_WORKERS.length);
    });

    it('watches all three supervisors — pm2, systemd AND docker', async () => {
        // The uploader (systemd) and the local Bot API (docker) are invisible to `pm2 list`, which
        // is why a pm2-only check reported everything healthy while an archive worker was missing.
        const supervisors = new Set(WATCHED_WORKERS.map((w) => w.supervisor));
        expect(supervisors).toEqual(new Set(['pm2', 'systemd', 'docker']));
    });
});
