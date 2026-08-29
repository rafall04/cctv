/**
 * Purpose: Decide when a camera has stopped being "offline" and started being GONE — dead at the
 *          upstream source, where only the stream provider can fix it.
 * Caller: cameraRuntimeStateService (maintains the streak), cameraSourceHealthService (reads it).
 * Deps: settingsService — only for the live confirm-window read; the streak logic stays pure.
 * MainFuncs: isDeadAtSourceReason, nextDeadStreak, isConfirmed, describeReason, getConfirmAfterHours.
 * SideEffects: None.
 *
 * WHY THIS DISTINCTION EARNS ITS OWN MODULE
 * Every fault in this system currently renders as "offline", so an operator cannot tell a camera
 * that will be back in five minutes from one whose provider took the feed down for good. On
 * production 6 of 36 cameras have been in the second category since 2026-07-31 — a stable 404 or a
 * playlist carrying #EXT-X-ENDLIST — and they look exactly like the first.
 *
 * WHY ONLY THESE TWO SYMPTOMS COUNT
 *   stream_ended  the playlist itself says it is finished (#EXT-X-ENDLIST). The encoder stopped;
 *                 this is the source telling us, not us guessing.
 *   http_404/410  the stream path is gone from the origin. A path that used to exist and now
 *                 answers "not found" is a decision someone made upstream.
 * A timeout, a refused connection, or a 5xx is the network or the origin having a bad day —
 * loud, but recoverable, and treating it as death would cry wolf every time a link flaps.
 * 403 is deliberately absent: on this fleet `data.bojonegorokab.go.id` answers 403 to any client
 * without a browser User-Agent, so 403 means "we asked wrongly" far more often than "it is gone".
 *
 * WHY A CONFIRMATION WINDOW
 * Even the two symptoms above can be momentary — a provider restarting an encoder emits ENDLIST,
 * and a path can 404 for a minute during a deploy. The streak has to survive a few hours before it
 * is worth an operator's attention, or the panel becomes noise and stops being read.
 */

import settingsService from './settingsService.js';

/** Reasons the health checker produces that mean "the source is gone", not "the link is bad". */
export const DEAD_AT_SOURCE_REASONS = Object.freeze([
    'stream_ended',
    'http_404',
    'http_410',
]);

const DEAD_SET = new Set(DEAD_AT_SOURCE_REASONS);

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Hours a symptom must hold before it is presented as dead. Configurable because a fleet of
 * municipal feeds that restart nightly wants a longer window than a fleet of owned cameras.
 *
 * Precedence DB -> env -> default(6): the admin field (`camera_source_dead_confirm_hours` in the
 * settings table) wins, `CAMERA_SOURCE_DEAD_CONFIRM_HOURS` stays a working fallback, and an
 * untouched install confirms after 6h as before. Read lazily so a change in the panel takes effect
 * on the next health pass without a restart; callers in a loop resolve it ONCE and pass it down.
 */
export function getConfirmAfterHours() {
    const stored = Number(settingsService.getSettingValue('camera_source_dead_confirm_hours'));
    if (Number.isFinite(stored) && stored > 0) return stored;
    const raw = Number(process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS);
    return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

export function isDeadAtSourceReason(reason) {
    return DEAD_SET.has(String(reason || ''));
}

/**
 * Advance, start, or clear the dead-at-source streak.
 *
 * @param {{isOnline: boolean|number, reason: string|null, currentSince: string|null,
 *          currentReason: string|null, timestamp: string}} input
 * @returns {{since: string|null, reason: string|null}}
 *
 * The streak clears on ANY other outcome — back online, or a different fault. That is deliberate:
 * a camera flapping between 404 and connection-refused is not a source that cleanly went away, and
 * presenting it as "dead since Tuesday" would misdescribe what the operator would actually find.
 */
export function nextDeadStreak({ isOnline, reason, currentSince, currentReason, timestamp }) {
    const online = isOnline === true || isOnline === 1;
    if (online || !isDeadAtSourceReason(reason)) {
        return { since: null, reason: null };
    }

    // Already dead for the same reason: keep the ORIGINAL start time. Restarting the clock on every
    // health tick would leave every camera permanently "dead for 30 seconds".
    if (currentSince && currentReason === reason) {
        return { since: currentSince, reason: currentReason };
    }

    return { since: timestamp, reason };
}

/**
 * Has the streak lasted long enough to be worth telling anyone about?
 * `confirmAfterHours` defaults to a fresh read; a caller filtering many rows should resolve it
 * once and pass it in so one health pass reads the setting once, not per camera.
 */
export function isConfirmed(since, now = Date.now(), confirmAfterHours = getConfirmAfterHours()) {
    const startedAt = since ? Date.parse(since) : NaN;
    if (!Number.isFinite(startedAt)) return false;
    return now - startedAt >= confirmAfterHours * MS_PER_HOUR;
}

/** Whole hours the streak has run, or null when there is no streak. */
export function deadHours(since, now = Date.now()) {
    const startedAt = since ? Date.parse(since) : NaN;
    if (!Number.isFinite(startedAt)) return null;
    return Math.max(0, Math.floor((now - startedAt) / MS_PER_HOUR));
}

/** What to tell the operator, in terms of what they would do about it. */
export function describeReason(reason) {
    if (reason === 'stream_ended') {
        return 'Playlist sumber sudah ditutup (#EXT-X-ENDLIST) — encoder di sisi penyedia berhenti.';
    }
    if (reason === 'http_404' || reason === 'http_410') {
        return 'Alamat stream sudah tidak ada di server penyedia (404/410).';
    }
    return 'Sumber tidak lagi mengirim stream.';
}

export default {
    DEAD_AT_SOURCE_REASONS,
    getConfirmAfterHours,
    isDeadAtSourceReason,
    nextDeadStreak,
    isConfirmed,
    deadHours,
    describeReason,
};
