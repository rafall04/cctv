import { queryOne, execute } from '../database/connectionPool.js';

const TIMEZONE_MAP = {
    'WIB': 'Asia/Jakarta',      // UTC+7
    'WITA': 'Asia/Makassar',    // UTC+8
    'WIT': 'Asia/Jayapura'      // UTC+9
};

export function getTimezone() {
    const setting = queryOne(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['timezone']
    );
    return setting?.setting_value || 'Asia/Jakarta';
}

/**
 * Timezone for BILLING day-labels — pinned SEPARATELY from the display timezone above.
 *
 * A display-tz toggle (WIB↔WITA↔WIT) must NOT move the billing day boundary. Near midnight it would
 * relabel "today" (e.g. 22:30 WIB → 00:30 WIT the next date), making a subscription already charged
 * for the old label look due again and double-charging it within minutes. Seeded once from the
 * display tz by migration and never touched by setTimezone(), so billing days stay stable regardless
 * of what an operator sets the display tz to. Falls back to the display tz until the seed exists.
 */
export function getBillingTimezone() {
    const setting = queryOne(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['billing_timezone']
    );
    return setting?.setting_value || getTimezone();
}

/**
 * Any real IANA zone name (or a WIB/WITA/WIT alias). Not locked to Indonesia — a future deployment
 * could be anywhere, so we validate against the runtime's own zone database instead of a fixed list.
 * `Intl.DateTimeFormat` throws a RangeError for an unknown zone; that is the check.
 */
export function isValidTimezone(timezone) {
    const resolved = TIMEZONE_MAP[timezone] || timezone;
    if (typeof resolved !== 'string' || !resolved) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: resolved });
        return true;
    } catch {
        return false;
    }
}

export function setTimezone(timezone) {
    const validTimezone = TIMEZONE_MAP[timezone] || timezone;
    if (!isValidTimezone(validTimezone)) {
        const err = new Error(`Invalid timezone: ${timezone}`);
        err.statusCode = 400;
        throw err;
    }
    execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at)
         VALUES ('timezone', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = CURRENT_TIMESTAMP`,
        [validTimezone]
    );
}

export function formatDateTime(date, timezone = null) {
    const tz = timezone || getTimezone();
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(new Date(date));
}

export { TIMEZONE_MAP };
