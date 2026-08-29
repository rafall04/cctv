/*
 * Purpose: Notice when one of the moving parts stops, and say so ONCE — restart policies keep a
 *          dead worker restarting, but nothing was telling anyone it kept dying.
 * Caller: server.js scheduler.
 * Deps: node:child_process (pm2/systemctl/docker probes), telegramService.sendHealthAlertMessage.
 * MainFuncs: checkWorkers, runWatchdogCycle.
 * SideEffects: Spawns short read-only status commands; sends Telegram alerts on state transitions.
 *
 * This system's workers live under THREE different supervisors, which is why "check pm2" was never
 * enough to know it was healthy:
 *   pm2      — rafnet-cctv-backend, rafnet-cctv-recorder, mediamtx
 *   systemd  — tg-archive.service (the Python uploader that actually ships recordings to Telegram)
 *   docker   — tg-archive-api (the local Bot API server the uploader talks to)
 *
 * Alerts fire on TRANSITION only (up->down and down->up), per the logging policy in AGENTS.md: a
 * worker that has been down for an hour must not send 60 messages about it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendHealthAlertMessage } from './telegramService.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 10_000;

// The pm2 apps are named `<CLIENT_CODE>-cctv-*` (deployment/ecosystem.config.cjs, CLIENT_CODE from
// client.config.sh). Hardcoding 'rafnet-*' meant a rebranded install — which source-code buyers are
// explicitly invited to do — would watch app names that DO NOT EXIST, so its recorder could die and
// crash-loop silently with no "Worker MATI" alert. Derive the prefix from THIS process's own pm2 app
// name (pm2 sets process.env.name to '<CLIENT_CODE>-cctv-backend'); fall back to an explicit
// CLIENT_CODE env, then 'rafnet' off pm2 (tests/dev) so the default install is unchanged.
const CLIENT_CODE = (() => {
    const own = String(process.env.name || '').match(/^(.+)-cctv-backend$/);
    if (own) return own[1];
    return process.env.CLIENT_CODE || 'rafnet';
})();

export const WATCHED_WORKERS = [
    { name: `${CLIENT_CODE}-cctv-backend`, supervisor: 'pm2', label: 'API + kesehatan kamera' },
    { name: `${CLIENT_CODE}-cctv-recorder`, supervisor: 'pm2', label: 'perekam CCTV' },
    // mediamtx is registered unprefixed in production, so it stays literal here.
    { name: 'mediamtx', supervisor: 'pm2', label: 'muxer RTSP→HLS' },
    { name: 'tg-archive.service', supervisor: 'systemd', label: 'pengunggah arsip Telegram' },
    { name: 'tg-archive-api', supervisor: 'docker', label: 'server Bot API lokal' },
];

// Last known state per worker. `undefined` = never observed, so the first cycle only establishes a
// baseline and never alerts (otherwise every backend restart would announce five "recoveries").
const lastState = new Map();

async function probe(worker) {
    try {
        if (worker.supervisor === 'pm2') {
            const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
            const entry = JSON.parse(stdout).find((p) => p.name === worker.name);
            return { up: entry?.pm2_env?.status === 'online', detail: entry?.pm2_env?.status || 'tidak terdaftar' };
        }
        if (worker.supervisor === 'systemd') {
            const { stdout } = await execFileAsync('systemctl', ['is-active', worker.name], { timeout: PROBE_TIMEOUT_MS });
            return { up: stdout.trim() === 'active', detail: stdout.trim() };
        }
        const { stdout } = await execFileAsync(
            'docker',
            ['inspect', '-f', '{{.State.Running}}', worker.name],
            { timeout: PROBE_TIMEOUT_MS }
        );
        return { up: stdout.trim() === 'true', detail: stdout.trim() };
    } catch (error) {
        // `systemctl is-active` and `docker inspect` EXIT NON-ZERO for a stopped unit, so a throw
        // here usually means "down", not "probe broken". Either way the operator wants to know.
        const detail = (error.stdout || error.message || 'probe gagal').toString().trim().slice(0, 80);
        return { up: false, detail };
    }
}

/** @returns {Array<{name,supervisor,label,up,detail,changed}>} */
export async function checkWorkers() {
    const results = [];
    for (const worker of WATCHED_WORKERS) {
        const { up, detail } = await probe(worker);
        const previous = lastState.get(worker.name);
        results.push({ ...worker, up, detail, changed: previous !== undefined && previous !== up });
        lastState.set(worker.name, up);
    }
    return results;
}

export async function runWatchdogCycle() {
    let results;
    try {
        results = await checkWorkers();
    } catch (error) {
        console.error('[Watchdog] Worker probe failed:', error.message);
        return { checked: 0, transitions: [] };
    }

    const transitions = results.filter((r) => r.changed);
    for (const worker of transitions) {
        const line = worker.up
            ? `✅ <b>Worker pulih</b>\n<code>${worker.name}</code> (${worker.label}) kembali jalan.`
            : `🚨 <b>Worker MATI</b>\n<code>${worker.name}</code> (${worker.label}) tidak jalan.\n`
              + `Pengawas: ${worker.supervisor} — status: <code>${worker.detail}</code>`;
        // A transition is real news: stderr as well as Telegram, so it survives a broken bot token.
        if (worker.up) console.log(`[Watchdog] ${worker.name} recovered`);
        else console.error(`[Watchdog] ${worker.name} is DOWN (${worker.supervisor}: ${worker.detail})`);
        try {
            await sendHealthAlertMessage(line);
        } catch (error) {
            console.error(`[Watchdog] Could not send alert for ${worker.name}:`, error.message);
        }
    }

    return { checked: results.length, transitions: transitions.map((t) => ({ name: t.name, up: t.up })) };
}

/** Test seam — lets a test start from a known baseline. */
export function resetWatchdogState() {
    lastState.clear();
}

export default { checkWorkers, runWatchdogCycle, resetWatchdogState, WATCHED_WORKERS };
