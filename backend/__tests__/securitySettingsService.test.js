/*
 * Purpose: Prove the security policy is genuinely settable at runtime — and that saving one
 *          actually changes what the enforcing modules do, not just what a panel displays.
 * Caller: Vitest backend suite.
 * Deps: mocked connectionPool (settings row), real securitySettingsService + its consumers.
 * MainFuncs: precedence (DB > env > default), validation, and live effect on the enforcers.
 * SideEffects: None — the settings row is an in-memory fake.
 *
 * WHY THE "LIVE EFFECT" TESTS MATTER MOST
 * ---------------------------------------
 * The bug this feature fixes was not a missing UI. It was that MAX_LOGIN_ATTEMPTS,
 * PASSWORD_MIN_LENGTH, LOCKOUT_DURATION_MINUTES, SESSION_ABSOLUTE_TIMEOUT_HOURS and five others
 * were parsed out of .env into config and then read BY NOTHING, while the real policy sat in
 * hardcoded constants. An operator could change them and nothing happened. Shipping a settings
 * page with that same disconnect would just move the lie somewhere prettier — so these assert
 * through the enforcing modules, not through the settings service's own getters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = await vi.hoisted(async () => ({ row: null, env: {} }));

vi.mock('../database/connectionPool.js', () => ({
    queryOne: (sql) => (/settings/i.test(sql) ? h.row : null),
    query: () => [],
    execute: vi.fn(),
    pool: {},
}));

/*
 * config.js is mocked, not merely bypassed. It calls dotenv.config() at import, so on a developer
 * box every re-import silently repopulates backend/.env — which meant "this value comes from the
 * defaults" could never be asserted, and the whole test would have been reading someone's local
 * file instead of its own fixture.
 */
vi.mock('../config/config.js', () => ({
    config: {
        get security() {
            return {
                rateLimitEnabled: h.env.RATE_LIMIT_ENABLED !== 'false',
                rateLimitPublic: Number(h.env.RATE_LIMIT_PUBLIC),
                rateLimitAuth: Number(h.env.RATE_LIMIT_AUTH),
                rateLimitAdmin: Number(h.env.RATE_LIMIT_ADMIN),
                bruteForceEnabled: h.env.BRUTE_FORCE_ENABLED !== 'false',
                maxLoginAttempts: Number(h.env.MAX_LOGIN_ATTEMPTS),
                maxIpAttempts: Number(h.env.MAX_IP_ATTEMPTS),
                lockoutDurationMinutes: Number(h.env.LOCKOUT_DURATION_MINUTES),
                ipBlockDurationMinutes: Number(h.env.IP_BLOCK_DURATION_MINUTES),
                passwordMinLength: Number(h.env.PASSWORD_MIN_LENGTH),
                passwordMaxAgeDays: Number(h.env.PASSWORD_MAX_AGE_DAYS),
                passwordHistoryCount: Number(h.env.PASSWORD_HISTORY_COUNT),
                sessionAbsoluteTimeoutHours: Number(h.env.SESSION_ABSOLUTE_TIMEOUT_HOURS),
                auditLogRetentionDays: Number(h.env.AUDIT_LOG_RETENTION_DAYS),
                restartLogRetentionDays: Number(h.env.RESTART_LOG_RETENTION_DAYS),
            };
        },
        get jwt() {
            return { expiration: h.env.JWT_EXPIRATION, refreshExpiration: h.env.JWT_REFRESH_EXPIRATION };
        },
    },
}));

/** Make process.env show exactly the keys this test declares, nothing the dev box happens to set. */
function setEnv(vars = {}) {
    const KEYS = [
        'RATE_LIMIT_ENABLED', 'RATE_LIMIT_PUBLIC', 'RATE_LIMIT_AUTH', 'RATE_LIMIT_ADMIN',
        'BRUTE_FORCE_ENABLED', 'MAX_LOGIN_ATTEMPTS', 'MAX_IP_ATTEMPTS',
        'LOCKOUT_DURATION_MINUTES', 'IP_BLOCK_DURATION_MINUTES',
        'PASSWORD_MIN_LENGTH', 'PASSWORD_MAX_AGE_DAYS', 'PASSWORD_HISTORY_COUNT',
        'SESSION_ABSOLUTE_TIMEOUT_HOURS', 'JWT_EXPIRATION', 'JWT_REFRESH_EXPIRATION',
        'AUDIT_LOG_RETENTION_DAYS', 'RESTART_LOG_RETENTION_DAYS',
    ];
    for (const key of KEYS) delete process.env[key];
    h.env = {};
    for (const [key, value] of Object.entries(vars)) {
        process.env[key] = String(value);
        h.env[key] = String(value);
    }
}

const setStored = (obj) => { h.row = obj ? { value: JSON.stringify(obj) } : null; };

describe('securitySettingsService precedence', () => {
    let svc;

    beforeEach(async () => {
        vi.resetModules();
        h.row = null;
        setEnv();
        svc = await import('../services/securitySettingsService.js');
        svc.invalidateSecuritySettings();
    });

    it('falls back to the defaults that used to be hardcoded', () => {
        const s = svc.getSecuritySettings({ fresh: true });
        expect(s.maxLoginAttempts).toBe(5);
        expect(s.passwordMinLength).toBe(12);
        expect(s.sessionAbsoluteTimeoutHours).toBe(24);
        expect(s.accessTokenExpiry).toBe('1h');
        // Log-retention windows joined the batch — same DB->env->default machinery.
        expect(s.auditLogRetentionDays).toBe(90);
        expect(s.restartLogRetentionDays).toBe(30);
    });

    it('lets .env override the log-retention windows', async () => {
        setEnv({ AUDIT_LOG_RETENTION_DAYS: 45, RESTART_LOG_RETENTION_DAYS: 14 });
        vi.resetModules();
        const fresh = await import('../services/securitySettingsService.js');
        const s = fresh.getSecuritySettings({ fresh: true });
        expect(s.auditLogRetentionDays).toBe(45);
        expect(s.restartLogRetentionDays).toBe(14);
    });

    it('refuses a retention window below 1 day (0 would read as "delete everything")', () => {
        const { valid, errors } = svc.validateSecurityPatch({ auditLogRetentionDays: 0 });
        expect(valid).toBe(false);
        expect(errors.join(' ')).toMatch(/auditLogRetentionDays/);
    });

    it('lets .env override a default (so existing deployments keep working)', async () => {
        setEnv({ MAX_LOGIN_ATTEMPTS: 3 });
        vi.resetModules();
        const fresh = await import('../services/securitySettingsService.js');
        expect(fresh.getSecuritySettings({ fresh: true }).maxLoginAttempts).toBe(3);
    });

    it('lets the panel override .env — the panel is what an operator can actually reach', async () => {
        setEnv({ MAX_LOGIN_ATTEMPTS: 3 });
        vi.resetModules();
        const fresh = await import('../services/securitySettingsService.js');
        setStored({ maxLoginAttempts: 7 });
        expect(fresh.getSecuritySettings({ fresh: true }).maxLoginAttempts).toBe(7);
        expect(fresh.getSecuritySettingsSources().maxLoginAttempts).toBe('panel');
    });

    it('reports where each value came from, so an inherited one is not mistaken for a saved one', async () => {
        setEnv({ PASSWORD_MIN_LENGTH: 16 });
        vi.resetModules();
        const fresh = await import('../services/securitySettingsService.js');
        setStored({ maxLoginAttempts: 7 });
        const sources = fresh.getSecuritySettingsSources();
        expect(sources.maxLoginAttempts).toBe('panel');
        expect(sources.passwordMinLength).toBe('env');
        expect(sources.rateLimitPublic).toBe('default');
    });

    it('survives a corrupt settings row instead of locking everyone out', () => {
        h.row = { value: '{not json' };
        expect(svc.getSecuritySettings({ fresh: true }).maxLoginAttempts).toBe(5);
    });
});

describe('securitySettingsService validation', () => {
    let svc;
    beforeEach(async () => {
        vi.resetModules();
        h.row = null;
        setEnv();
        svc = await import('../services/securitySettingsService.js');
    });

    it('refuses out-of-range values rather than silently clamping them', () => {
        // A clamped value is a setting that lies: the panel would show 5000 and enforce 100.
        const res = svc.validateSecurityPatch({ maxLoginAttempts: 1 });
        expect(res.valid).toBe(false);
        expect(res.errors[0]).toMatch(/antara/);
    });

    it('refuses a password minimum below 8 — one careless save weakens every account', () => {
        expect(svc.validateSecurityPatch({ passwordMinLength: 4 }).valid).toBe(false);
        expect(svc.validateSecurityPatch({ passwordMinLength: 8 }).valid).toBe(true);
    });

    it('refuses unknown keys so a typo cannot look like it saved', () => {
        const res = svc.validateSecurityPatch({ maxLoginAttemps: 5 });
        expect(res.valid).toBe(false);
        expect(res.errors[0]).toMatch(/tidak dikenal/);
    });

    it('accepts only real duration strings for token lifetimes', () => {
        expect(svc.validateSecurityPatch({ accessTokenExpiry: '15m' }).valid).toBe(true);
        expect(svc.validateSecurityPatch({ accessTokenExpiry: 'forever' }).valid).toBe(false);
    });

    it('throws a 400 the admin UI can render', () => {
        expect(() => svc.updateSecuritySettings({ maxLoginAttempts: 0 }))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
});

/*
 * The part that would have caught the original bug.
 */
describe('a saved setting actually reaches the code that enforces it', () => {
    beforeEach(() => {
        vi.resetModules();
        h.row = null;
        setEnv();
    });

    it('brute force reads the saved attempt limits, not its hardcoded constant', async () => {
        const bf = await import('../services/bruteForceProtection.js');
        const svc = await import('../services/securitySettingsService.js');

        expect(bf.getBruteForceConfig().maxAttempts.username).toBe(5);

        setStored({ maxLoginAttempts: 9, ipBlockDurationMinutes: 120 });
        svc.invalidateSecuritySettings();

        expect(bf.getBruteForceConfig().maxAttempts.username).toBe(9);
        expect(bf.getBruteForceConfig().lockoutDuration.ip).toBe(120 * 60 * 1000);
        // The exported constant is now only the DEFAULT and must not have moved.
        expect(bf.BRUTE_FORCE_CONFIG.maxAttempts.username).toBe(5);
    });

    it('password validation rejects on the saved minimum length', async () => {
        const pv = await import('../services/passwordValidator.js');
        const svc = await import('../services/securitySettingsService.js');

        expect(pv.validatePassword('Abcdefgh123!', 'x').valid).toBe(true);

        setStored({ passwordMinLength: 20 });
        svc.invalidateSecuritySettings();

        const res = pv.validatePassword('Abcdefgh123!', 'x');
        expect(res.valid).toBe(false);
        expect(res.errors.join(' ')).toContain('20 karakter');
    });

    it('session lifetime follows the saved value', async () => {
        const sm = await import('../services/sessionManager.js');
        const svc = await import('../services/securitySettingsService.js');

        expect(sm.getSessionConfig().absoluteTimeout).toBe(24 * 60 * 60 * 1000);

        setStored({ sessionAbsoluteTimeoutHours: 2, accessTokenExpiry: '15m' });
        svc.invalidateSecuritySettings();

        expect(sm.getSessionConfig().absoluteTimeout).toBe(2 * 60 * 60 * 1000);
        expect(sm.getSessionConfig().accessTokenExpiry).toBe('15m');
    });

    it('the rate limiter enforces the saved ceiling', async () => {
        const rl = await import('../middleware/rateLimiter.js');
        const svc = await import('../services/securitySettingsService.js');

        expect(rl.getRateLimitForType('public').max).toBe(100);

        setStored({ rateLimitPublic: 500 });
        svc.invalidateSecuritySettings();

        expect(rl.getRateLimitForType('public').max).toBe(500);
    });
});
