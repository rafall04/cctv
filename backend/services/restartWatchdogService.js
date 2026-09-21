/*
 * Purpose: Restart forensics + alerting for the pm2 processes. workerWatchdogService reports
 *          "is it up" — this answers the other question nobody could: "how OFTEN is pm2
 *          restarting it, and why". A crash-looping backend looks healthy in `pm2 list`
 *          between crashes, which is exactly how the 2026-09 instability stayed invisible.
 * Caller: server.js — recordBoot() early in start() (before listen, so a crash-looping boot
 *         still leaves a marker), start() arms the periodic counter poll.
 * Deps: child_process.execFile (pm2 jlist), fs (boot log, pm2 error-log tail, .git/HEAD),
 *       settingsService (persisted counters/events/alerted flags), telegramService.
 * MainFuncs: recordBoot, runRestartCycle, start, classifyExitReason.
 * SideEffects: appends data/process-boots.jsonl; sends Telegram alerts on transitions only;
 *              persists watcher state to a settings row.
 *
 * How it measures: pm2_env.restart_time is a durable counter — the DELTA between polls is the
 * restart count. Persisted in settings, so restarts that happened while this process itself
 * was down are still counted on the next tick. Events land in a rolling 60-min window; an app
 * crosses the alert edge at >RESTART_THRESHOLD restarts inside the window, and the alert
 * fires ONCE per edge (a recovery notice fires when the window clears) — never per-tick spam.
 *
 * Forensics: every boot appends one JSONL line {ts, pid, head, prevBootAt, prevExitReason}.
 * prevExitReason is classified at the NEXT boot: a changed git HEAD means the previous exit
 * was a deploy; otherwise the pm2 error-log tail is scanned for fatal signatures (heap OOM,
 * EADDRINUSE, module/syntax boot crashes). `unknown` is honest — a SIGKILL or pm2
 * max_memory_restart leaves no app-level trace.
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import settingsService from './settingsService.js';
import { sendHealthAlertMessage, isTelegramConfigured } from './telegramService.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const REPO_ROOT = resolve(__dirname, '..', '..');

export const RESTART_WINDOW_MS = 60 * 60 * 1000;
export const RESTART_THRESHOLD = Number(process.env.RESTART_ALERT_THRESHOLD) || 3;
export const BOOT_LOG_CAP = 300;
const PM2_TIMEOUT_MS = 10_000;
const ERROR_TAIL_BYTES = 64 * 1024;
const STATE_KEY = 'restart_watch_state';
const MAX_EVENTS_PER_APP = 200;

// Same derivation as workerWatchdogService: pm2 sets process.env.name to '<CLIENT>-cctv-backend'.
const CLIENT_CODE = (() => {
    const own = String(process.env.name || '').match(/^(.+)-cctv-backend$/);
    if (own) return own[1];
    return process.env.CLIENT_CODE || 'rafnet';
})();

const WATCHED_APPS = [
    `${CLIENT_CODE}-cctv-backend`,
    `${CLIENT_CODE}-cctv-recorder`,
    'mediamtx',
];

const REASON_LABELS = {
    deploy: 'deploy (HEAD berubah)',
    oom: 'kemungkinan heap OOM — error log menyebut "out of memory"',
    'port-conflict': 'kemungkinan port bentrok (EADDRINUSE)',
    'boot-crash': 'kemungkinan crash saat boot (module/syntax error di log)',
    unknown: 'tidak diketahui — kill/signal/memory-cap tidak meninggalkan jejak aplikasi',
};

/** Pure classifier — injectable seam kept tiny so tests cover every branch. */
export function classifyExitReason({ headChanged = false, tail = '' } = {}) {
    if (headChanged) return 'deploy';
    if (/heap out of memory|Allocation failed|JavaScript stack trace/i.test(tail)) return 'oom';
    if (/EADDRINUSE/i.test(tail)) return 'port-conflict';
    if (/Cannot find module|require\([^)]*\) is not defined|SyntaxError|Cannot use import statement/i.test(tail)) {
        return 'boot-crash';
    }
    return 'unknown';
}

/** Resolve the checked-out commit without spawning git — .git/HEAD + ref file is enough. */
function currentGitHead(gitDir = join(REPO_ROOT, '.git')) {
    try {
        const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
        const refMatch = head.match(/^ref: (.+)$/);
        if (!refMatch) return head; // detached HEAD — the file IS the hash
        try {
            return readFileSync(join(gitDir, refMatch[1]), 'utf8').trim();
        } catch {
            // Packed refs: grep the single file instead of walking objects/.
            const packed = readFileSync(join(gitDir, 'packed-refs'), 'utf8');
            const line = packed.split('\n').find((l) => l.endsWith(` ${refMatch[1]}`));
            return line ? line.split(' ')[0].trim() : null;
        }
    } catch {
        return null; // no .git on the box (tarball deploy) — headChanged stays false
    }
}

export function createRestartWatchdogService({
    bootLogPath = join(DATA_DIR, 'process-boots.jsonl'),
    pm2LogDir = join(homedir(), '.pm2', 'logs'),
    ownAppName = `${CLIENT_CODE}-cctv-backend`,
    watchedApps = WATCHED_APPS,
    readApps = async () => {
        const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: PM2_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
        return JSON.parse(stdout);
    },
    getHead = currentGitHead,
    sendMessage = sendHealthAlertMessage,
    telegramConfigured = isTelegramConfigured,
    loadState = () => {
        const raw = settingsService.getSettingValue(STATE_KEY);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },
    saveState = (state) => settingsService.updateSetting(STATE_KEY, state, 'Auto: state internal restart watcher'),
    threshold = RESTART_THRESHOLD,
    windowMs = RESTART_WINDOW_MS,
    logger = console,
} = {}) {
    let state = null; // {counts: {app:n}, events: {app:[ts]}, lastReason: {app:reason}, alerted: {app:bool}}

    function ensureLoaded() {
        if (state) return;
        state = { counts: {}, events: {}, lastReason: {}, alerted: {} };
        try {
            const raw = loadState();
            if (raw && typeof raw === 'object') {
                for (const k of ['counts', 'events', 'lastReason', 'alerted']) {
                    if (raw[k] && typeof raw[k] === 'object') state[k] = raw[k];
                }
            }
        } catch (error) {
            logger.error?.('[RestartWatch] load state failed:', error?.message || error);
        }
    }

    function persist() {
        try {
            saveState(state);
        } catch (error) {
            logger.error?.('[RestartWatch] save state failed:', error?.message || error);
        }
    }

    /** Last ~ERROR_TAIL_BYTES of the pm2 error log, as text. Missing file → ''. */
    function errorTail(appName) {
        try {
            const p = join(pm2LogDir, `${appName}-error.log`);
            const fd = readFileSync(p);
            return fd.length > ERROR_TAIL_BYTES ? fd.subarray(-ERROR_TAIL_BYTES).toString('utf8') : fd.toString('utf8');
        } catch {
            return '';
        }
    }

    function readBootLines() {
        try {
            return readFileSync(bootLogPath, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((l) => { try { return JSON.parse(l); } catch { return null; } })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Boot marker — one JSONL line per process start, written SYNCHRONOUSLY so a process that
     * dies during its own startup still leaves the record. Also stamps the previous boot's
     * exit reason, which only this next boot can know.
     */
    function recordBoot({ now = Date.now() } = {}) {
        try {
            const dir = dirname(bootLogPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const lines = readBootLines();
            const prev = lines[lines.length - 1] || null;
            const head = getHead();
            const prevExitReason = prev
                ? classifyExitReason({ headChanged: Boolean(head && prev.head && head !== prev.head), tail: errorTail(ownAppName) })
                : null;
            const entry = {
                ts: now,
                pid: process.pid,
                head,
                prevBootAt: prev?.ts ?? null,
                prevExitReason,
            };
            const next = [...lines, entry].slice(-BOOT_LOG_CAP);
            if (next.length < lines.length + 1) {
                writeFileSync(bootLogPath, next.map((l) => JSON.stringify(l)).join('\n') + '\n');
            } else {
                appendFileSync(bootLogPath, JSON.stringify(entry) + '\n');
            }
            logger.log?.(`[RestartWatch] Boot marker #${next.length} (prev exit: ${prevExitReason || 'n/a'})`);
            return entry;
        } catch (error) {
            logger.error?.('[RestartWatch] recordBoot failed:', error?.message || error);
            return null;
        }
    }

    function buildAlertMessage(appName, count, reason) {
        return [
            `🚨 <b>Restart berulang — ${appName}</b>`,
            `${count} restart dalam 60 menit terakhir (ambang: ${threshold}/jam).`,
            `Dugaan penyebab exit terakhir: ${REASON_LABELS[reason] || reason}.`,
            `Cek: <code>pm2 describe ${appName}</code> · tail <code>~/.pm2/logs/${appName}-error.log</code>`,
        ].join('\n');
    }

    function buildRecoverMessage(appName, count) {
        return `✅ <b>Restart normal kembali — ${appName}</b>\n${count} restart dalam 60 menit terakhir (di bawah ambang ${threshold}/jam).`;
    }

    /**
     * One poll of the pm2 restart counters. Delta-vs-persisted makes restarts that happened
     * while we were down visible too — they surface as a burst of events on the first tick
     * after boot, which is exactly when a crash-loop verdict matters most.
     */
    async function runRestartCycle({ now = Date.now() } = {}) {
        ensureLoaded();
        let apps;
        try {
            apps = await readApps();
        } catch (error) {
            logger.error?.('[RestartWatch] pm2 jlist failed:', error?.message || error);
            return { checked: 0, alerts: [] };
        }
        const alerts = [];
        let changed = false;

        for (const name of watchedApps) {
            const app = Array.isArray(apps) ? apps.find((a) => a.name === name) : null;
            const restarts = app?.pm2_env?.restart_time;
            if (typeof restarts !== 'number') continue;

            const events = (state.events[name] ||= []).filter((ts) => now - ts < windowMs);
            const prev = state.counts[name];
            if (typeof prev === 'number' && restarts > prev) {
                const delta = Math.min(restarts - prev, MAX_EVENTS_PER_APP);
                for (let i = 0; i < delta; i++) events.push(now);
                const reason = classifyExitReason({ tail: errorTail(name) });
                state.lastReason[name] = reason;
                logger.error?.(`[RestartWatch] ${name} restart +${restarts - prev} (reason: ${reason})`);
                changed = true;
            }
            if (state.counts[name] !== restarts) { state.counts[name] = restarts; changed = true; }
            state.events[name] = events.slice(-MAX_EVENTS_PER_APP);

            const count = state.events[name].length;
            const over = count > threshold;
            if (over && !state.alerted[name]) {
                state.alerted[name] = true;
                changed = true;
                if (telegramConfigured()) {
                    try {
                        await sendMessage(buildAlertMessage(name, count, state.lastReason[name] || 'unknown'));
                        alerts.push({ name, kind: 'alert', count });
                    } catch (error) {
                        logger.error?.(`[RestartWatch] alert send failed for ${name}:`, error?.message || error);
                    }
                }
            } else if (!over && state.alerted[name]) {
                state.alerted[name] = false;
                changed = true;
                if (telegramConfigured()) {
                    try {
                        await sendMessage(buildRecoverMessage(name, count));
                        alerts.push({ name, kind: 'recovery', count });
                    } catch (error) {
                        logger.error?.(`[RestartWatch] recovery send failed for ${name}:`, error?.message || error);
                    }
                }
            }
        }
        if (changed) persist();
        return { checked: watchedApps.length, alerts };
    }

    function start({ tickMs = 5 * 60 * 1000, firstTickMs = 2 * 60 * 1000 } = {}) {
        const tick = () => runRestartCycle()
            .catch((error) => logger.error?.('[RestartWatch] cycle failed:', error?.message || error));
        setTimeout(tick, firstTickMs).unref();
        setInterval(tick, tickMs).unref();
        logger.log?.(`[RestartWatch] Restart watcher armed (>${threshold}/jam, tick ${tickMs / 60000}m)`);
    }

    /** Test seam — inspect persisted-equivalent state. */
    function getState() {
        ensureLoaded();
        return state;
    }

    return { recordBoot, runRestartCycle, start, getState, classifyExitReason };
}

export default createRestartWatchdogService();
