import { queryOne, execute } from '../database/database.js';

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

export function setTimezone(timezone) {
    const validTimezone = TIMEZONE_MAP[timezone] || timezone;
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
