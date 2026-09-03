/**
 * Purpose: Handle public and authenticated settings API responses.
 * Caller: backend/routes/settingsRoutes.js.
 * Deps: settingsService and timezoneService.
 * MainFuncs: getAllSettings, getSetting, updateSetting, getPublicTimezone.
 * SideEffects: Reads and writes system settings through service boundaries.
 */

import settingsService from '../services/settingsService.js';
import { getTimezone, TIMEZONE_MAP } from '../services/timezoneService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function getTimezonePayload() {
    const timezone = getTimezone();
    // Prefer the friendly Indonesian alias (WIB/WITA/WIT); for any other IANA zone derive a label
    // from Intl instead of mislabelling it 'WIB'.
    let shortName = Object.keys(TIMEZONE_MAP).find((key) => TIMEZONE_MAP[key] === timezone);
    if (!shortName) {
        try {
            shortName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
                .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || timezone;
        } catch {
            shortName = timezone;
        }
    }

    return {
        timezone,
        shortName,
    };
}

export async function getAllSettings(request, reply) {
    try {
        const settingsObj = settingsService.getAllSettings();

        return reply.send({
            success: true,
            data: settingsObj,
        });
    } catch (error) {
        console.error('Get settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getSetting(request, reply) {
    try {
        const { key } = request.params;
        const data = settingsService.getSetting(key);

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Get setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/*
 * Settings hold secrets (bot tokens, gateway keys). An audit trail that copies values verbatim
 * turns the log itself into a place credentials leak, so anything whose key OR nested field name
 * looks secret is recorded as changed/unchanged, never quoted.
 */
const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|private|credential/i;

function redactForAudit(key, value) {
    if (SECRET_KEY_PATTERN.test(String(key))) return '[disunting]';
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
        const out = {};
        for (const [field, inner] of Object.entries(value)) {
            out[field] = SECRET_KEY_PATTERN.test(field)
                ? (inner ? '[disunting]' : null)
                : (typeof inner === 'object' ? '[objek]' : inner);
        }
        return out;
    }
    // Long free text (landing copy, HTML) would bloat every row; keep it recognisable, not whole.
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export async function updateSetting(request, reply) {
    try {
        const { key } = request.params;
        const { value, description } = request.body;

        // Read BEFORE the write: "what did it used to be" is the question an audit trail exists to
        // answer, and it is unrecoverable afterwards.
        let previousValue = null;
        try {
            previousValue = settingsService.getSetting(key)?.value ?? null;
        } catch {
            previousValue = null; // key did not exist yet — this update creates it
        }

        const data = settingsService.updateSetting(key, value, description);

        logAdminAction({
            action: 'UPDATE_SETTING',
            details: {
                key,
                from: redactForAudit(key, previousValue),
                to: redactForAudit(key, value),
                created: previousValue === null,
            },
            userId: request.user?.id,
        }, request);

        return reply.send({
            success: true,
            message: 'Setting updated successfully',
            data,
        });
    } catch (error) {
        // Surface validation failures as 400 instead of masking them as a
        // generic 500 (consistent with the other admin controllers).
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        console.error('Update setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getMapDefaultCenter(request, reply) {
    try {
        const data = settingsService.getMapDefaultCenter();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get map center error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getLandingPageSettings(request, reply) {
    try {
        const data = settingsService.getLandingPageSettings();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get landing page settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getPublicAdsSettings(request, reply) {
    try {
        const data = settingsService.getPublicAdsSettings();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get public ads settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getPublicTimezone(request, reply) {
    try {
        return reply.send({
            success: true,
            data: getTimezonePayload(),
        });
    } catch (error) {
        console.error('Get public timezone error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
