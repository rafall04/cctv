/**
 * Purpose: Pure date/money helpers for the billing engine — no DB, no state, no side effects.
 * Caller: billingService (re-exports these), and anything importing the date/money helpers.
 * Deps: timezoneService (read-only getTimezone).
 * SideEffects: none.
 *
 * Split out of billingService.js so the engine file stays under the size budget and these
 * timezone/rounding rules — the part most worth unit-testing in isolation — sit on their own.
 */

import { getTimezone } from './timezoneService.js';

/** Prorated daily cost of a monthly price. INTEGER rupiah, min 1 for any priced sub, 0 = free. */
export function dailyCostOf(monthlyPrice) {
    if (!monthlyPrice || monthlyPrice <= 0) {
        return 0; // free (trial/admin-free) subscriptions never touch the wallet
    }
    return Math.max(1, Math.round(monthlyPrice / 30));
}

/** Today's calendar date in the configured billing timezone (Asia/Jakarta by default), YYYY-MM-DD. */
export function localDateString(now = new Date()) {
    let timeZone;
    try {
        timeZone = getTimezone() || 'Asia/Jakarta';
    } catch {
        timeZone = 'Asia/Jakarta';
    }
    try {
        // en-CA renders as YYYY-MM-DD.
        return now.toLocaleDateString('en-CA', { timeZone });
    } catch {
        return now.toISOString().slice(0, 10);
    }
}

/**
 * Local (configured-tz) calendar date of a timestamp already STORED in the DB. getTimestamp() writes
 * an offset-less local wall-clock 'YYYY-MM-DD HH:MM:SS' (Asia/Jakarta by default) whose date is ALREADY
 * the local date — take it verbatim so the comparison is OS-timezone-INDEPENDENT. The old
 * `localDateString(new Date(stored))` reparsed that offset-less string as the SERVER-OS timezone and
 * then re-projected it, so on a UTC-hosted deploy a WIB-evening online-time shifted +7h to the next
 * day, the offline-skip check saw "not online today", and the daily charge was silently dropped. A
 * legacy ISO-8601 value (has a 'T' or trailing 'Z') is a real UTC instant and IS projected into tz.
 */
export function storedLocalDate(stored) {
    const s = String(stored || '');
    if (!s) return '';
    if (s.includes('T') || s.endsWith('Z')) {
        return localDateString(new Date(s));
    }
    return s.slice(0, 10);
}

/** Idempotency key for one subscription's charge on one local day. */
export function chargeReference(subscriptionId, dateString) {
    return `charge:${subscriptionId}:${dateString}`;
}
