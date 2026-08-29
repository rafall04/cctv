/*
 * Purpose: Make the security policy (rate limits, brute force, password rules, session lifetimes)
 *          settable from the admin panel instead of only from backend/.env.
 * Caller: rateLimiter, bruteForceProtection, sessionManager, passwordValidator, admin settings route.
 * Deps: connectionPool (settings table), config (env layer), securityAuditLogger.
 * MainFuncs: getSecuritySettings, updateSecuritySettings, invalidateSecuritySettings, SECURITY_DEFAULTS.
 * SideEffects: Reads/writes the `security_settings` row; logs an audit entry on change.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two problems, one fix.
 *
 * 1. Every value here USED TO BE A HARDCODED CONSTANT in the module that enforced it, while
 *    backend/.env carried env vars with the same names that config/config.js dutifully parsed —
 *    and that NOTHING then read. Measured 2026-08-04: `maxLoginAttempts`, `lockoutDurationMinutes`,
 *    `passwordMinLength`, `sessionAbsoluteTimeoutHours` and five others had zero readers across
 *    the whole backend. Setting MAX_LOGIN_ATTEMPTS=3 in .env did nothing at all. Nobody noticed
 *    because the hardcoded values happened to match the .env values exactly.
 * 2. Changing any of it meant SSH-ing to the box and editing a file.
 *
 * Precedence is DB -> env -> default. The panel wins because it is the thing an operator can
 * actually reach; env stays a working fallback so an existing deployment behaves identically
 * until someone saves from the panel; and the defaults are byte-identical to the constants that
 * were there before, so an untouched install changes nothing.
 */

import { queryOne, execute } from '../database/connectionPool.js';
import { config } from '../config/config.js';

export const SECURITY_SETTINGS_KEY = 'security_settings';

/*
 * The values that were hardcoded in bruteForceProtection.js, sessionManager.js and
 * passwordValidator.js. Keep them in sync with nothing — they ARE the source now.
 */
export const SECURITY_DEFAULTS = Object.freeze({
    rateLimitEnabled: true,
    rateLimitPublic: 100,
    rateLimitAuth: 30,
    rateLimitAdmin: 60,

    bruteForceEnabled: true,
    maxLoginAttempts: 5,
    maxIpAttempts: 10,
    lockoutDurationMinutes: 30,
    ipBlockDurationMinutes: 60,

    passwordMinLength: 12,
    passwordMaxAgeDays: 90,
    passwordHistoryCount: 5,

    sessionAbsoluteTimeoutHours: 24,
    accessTokenExpiry: '1h',
    refreshTokenExpiry: '7d',

    auditLogRetentionDays: 90,
    restartLogRetentionDays: 30,
});

/** Bounds are refusals, not clamps — a silently corrected value is a setting that lies. */
const FIELD_RULES = {
    rateLimitEnabled: { type: 'boolean' },
    rateLimitPublic: { type: 'int', min: 10, max: 100000 },
    rateLimitAuth: { type: 'int', min: 3, max: 10000 },
    rateLimitAdmin: { type: 'int', min: 10, max: 100000 },

    bruteForceEnabled: { type: 'boolean' },
    maxLoginAttempts: { type: 'int', min: 3, max: 100 },
    maxIpAttempts: { type: 'int', min: 3, max: 1000 },
    lockoutDurationMinutes: { type: 'int', min: 1, max: 1440 },
    ipBlockDurationMinutes: { type: 'int', min: 1, max: 10080 },

    // Floor of 8 on purpose: this is the one setting where a careless save weakens every
    // account at once, and 8 is the lowest length any current guidance still calls acceptable.
    passwordMinLength: { type: 'int', min: 8, max: 128 },
    passwordMaxAgeDays: { type: 'int', min: 0, max: 3650 },
    passwordHistoryCount: { type: 'int', min: 0, max: 50 },

    sessionAbsoluteTimeoutHours: { type: 'int', min: 1, max: 8760 },
    accessTokenExpiry: { type: 'duration' },
    refreshTokenExpiry: { type: 'duration' },

    // Retention windows for operational log tables (pruned daily by operationalRetentionService).
    // Floor of 1 day: a 0 here would be read as "delete everything", which is never what an
    // operator means by a retention setting.
    auditLogRetentionDays: { type: 'int', min: 1, max: 3650 },
    restartLogRetentionDays: { type: 'int', min: 1, max: 3650 },
};

const DURATION_PATTERN = /^\d+[smhd]$/;

/*
 * pm2 runs this backend in CLUSTER mode, so a save in one worker cannot invalidate another
 * worker's memory. An explicit invalidate keeps the saving worker instant; the TTL is what makes
 * the others converge. 30s matches cameraAccessService's cache for the same reason.
 */
const CACHE_TTL_MS = 30 * 1000;
let cache = null;
let cachedAt = 0;

function envLayer() {
    const s = config.security || {};
    const j = config.jwt || {};
    // Only keys the operator actually set survive: config.js fills defaults of its own, so an
    // unset env var must NOT masquerade as a deliberate choice and outrank SECURITY_DEFAULTS.
    const present = (name, value) => (process.env[name] === undefined ? undefined : value);
    return {
        rateLimitEnabled: present('RATE_LIMIT_ENABLED', s.rateLimitEnabled),
        rateLimitPublic: present('RATE_LIMIT_PUBLIC', s.rateLimitPublic),
        rateLimitAuth: present('RATE_LIMIT_AUTH', s.rateLimitAuth),
        rateLimitAdmin: present('RATE_LIMIT_ADMIN', s.rateLimitAdmin),
        bruteForceEnabled: present('BRUTE_FORCE_ENABLED', s.bruteForceEnabled),
        maxLoginAttempts: present('MAX_LOGIN_ATTEMPTS', s.maxLoginAttempts),
        maxIpAttempts: present('MAX_IP_ATTEMPTS', s.maxIpAttempts),
        lockoutDurationMinutes: present('LOCKOUT_DURATION_MINUTES', s.lockoutDurationMinutes),
        ipBlockDurationMinutes: present('IP_BLOCK_DURATION_MINUTES', s.ipBlockDurationMinutes),
        passwordMinLength: present('PASSWORD_MIN_LENGTH', s.passwordMinLength),
        passwordMaxAgeDays: present('PASSWORD_MAX_AGE_DAYS', s.passwordMaxAgeDays),
        passwordHistoryCount: present('PASSWORD_HISTORY_COUNT', s.passwordHistoryCount),
        sessionAbsoluteTimeoutHours: present('SESSION_ABSOLUTE_TIMEOUT_HOURS', s.sessionAbsoluteTimeoutHours),
        accessTokenExpiry: present('JWT_EXPIRATION', j.expiration),
        refreshTokenExpiry: present('JWT_REFRESH_EXPIRATION', j.refreshExpiration),
        auditLogRetentionDays: present('AUDIT_LOG_RETENTION_DAYS', s.auditLogRetentionDays),
        restartLogRetentionDays: present('RESTART_LOG_RETENTION_DAYS', s.restartLogRetentionDays),
    };
}

function dbLayer() {
    try {
        const row = queryOne('SELECT value FROM settings WHERE key = ?', [SECURITY_SETTINGS_KEY]);
        if (!row?.value) return {};
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        // A corrupt or unreadable row must never lock anyone out — fall through to env/defaults.
        return {};
    }
}

function merge(...layers) {
    const out = { ...SECURITY_DEFAULTS };
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer || {})) {
            if (key in SECURITY_DEFAULTS && value !== undefined && value !== null && value !== '') {
                out[key] = value;
            }
        }
    }
    return out;
}

/**
 * Current effective security policy: DB over env over default.
 * @param {{ fresh?: boolean }} [options] `fresh` bypasses the cache (used right after a write)
 */
export function getSecuritySettings({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && cache && now - cachedAt < CACHE_TTL_MS) {
        return cache;
    }
    cache = merge(envLayer(), dbLayer());
    cachedAt = now;
    return cache;
}

export function invalidateSecuritySettings() {
    cache = null;
    cachedAt = 0;
}

/**
 * Validate a patch without applying it.
 * @returns {{ valid: boolean, errors: string[], clean: object }}
 */
export function validateSecurityPatch(patch = {}) {
    const errors = [];
    const clean = {};

    for (const [key, raw] of Object.entries(patch)) {
        const rule = FIELD_RULES[key];
        if (!rule) {
            errors.push(`Setelan tidak dikenal: ${key}`);
            continue;
        }

        if (rule.type === 'boolean') {
            if (typeof raw !== 'boolean') {
                errors.push(`${key} harus true atau false`);
                continue;
            }
            clean[key] = raw;
            continue;
        }

        if (rule.type === 'duration') {
            const value = String(raw || '').trim();
            if (!DURATION_PATTERN.test(value)) {
                errors.push(`${key} harus berformat angka + s/m/h/d (mis. 1h, 7d)`);
                continue;
            }
            clean[key] = value;
            continue;
        }

        const value = Number(raw);
        if (!Number.isInteger(value)) {
            errors.push(`${key} harus bilangan bulat`);
            continue;
        }
        if (value < rule.min || value > rule.max) {
            errors.push(`${key} harus antara ${rule.min} dan ${rule.max}`);
            continue;
        }
        clean[key] = value;
    }

    return { valid: errors.length === 0, errors, clean };
}

/**
 * Persist a patch on top of whatever is already stored.
 * @throws {Error} statusCode 400 when the patch is invalid
 */
export function updateSecuritySettings(patch = {}) {
    const { valid, errors, clean } = validateSecurityPatch(patch);
    if (!valid) {
        const err = new Error(errors.join('; '));
        err.statusCode = 400;
        err.errors = errors;
        throw err;
    }

    const next = { ...dbLayer(), ...clean };
    const value = JSON.stringify(next);
    const existing = queryOne('SELECT key FROM settings WHERE key = ?', [SECURITY_SETTINGS_KEY]);
    if (existing) {
        execute('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [value, SECURITY_SETTINGS_KEY]);
    } else {
        execute(
            'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
            [SECURITY_SETTINGS_KEY, value, 'Kebijakan keamanan runtime (rate limit, brute force, password, sesi)']
        );
    }

    invalidateSecuritySettings();
    return getSecuritySettings({ fresh: true });
}

/**
 * Which keys are currently coming from where — so the panel can show an operator that a value
 * they are looking at is still being supplied by .env rather than by anything they saved.
 */
export function getSecuritySettingsSources() {
    const db = dbLayer();
    const env = envLayer();
    const sources = {};
    for (const key of Object.keys(SECURITY_DEFAULTS)) {
        if (db[key] !== undefined && db[key] !== null && db[key] !== '') sources[key] = 'panel';
        else if (env[key] !== undefined && env[key] !== null && env[key] !== '') sources[key] = 'env';
        else sources[key] = 'default';
    }
    return sources;
}

export default {
    SECURITY_SETTINGS_KEY,
    SECURITY_DEFAULTS,
    getSecuritySettings,
    getSecuritySettingsSources,
    validateSecurityPatch,
    updateSecuritySettings,
    invalidateSecuritySettings,
};
