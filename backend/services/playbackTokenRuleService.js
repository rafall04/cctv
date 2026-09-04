/**
 * Purpose: Normalize, persist, and evaluate per-camera playback token entitlement rules.
 * Caller: playbackTokenService and recordingPlaybackService.
 * Deps: SQLite connection helpers and timeService.
 * MainFuncs: normalizeRules, replaceRulesForToken, getRulesForToken, getAllowedCameraIds, resolveCameraAccess, buildCameraRulesSummary.
 * SideEffects: Replaces playback token camera rule rows when token scope is created or updated.
 */

import { execute, query, transaction } from '../database/connectionPool.js';
import { parseUtcSql, toUtcSql } from './timeService.js';

function normalizePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : toUtcSql(date);
}

function parseLegacyCameraIds(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return [...new Set(parsed
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isInteger(item) && item > 0))];
    } catch {
        return [];
    }
}

/**
 * Area ids carried by an 'area'-scoped token. Same shape and validation as camera ids, deliberately
 * a separate name at every call site: the two lists are interchangeable to a parser and catastrophic
 * to confuse, since reading one as the other silently resolves to a different set of cameras.
 */
function parseAreaIds(value) {
    return parseLegacyCameraIds(value);
}

/** Cameras currently in these areas. Recomputed per call — that IS the point of area scope. */
function camerasInAreas(areaIds) {
    if (!Array.isArray(areaIds) || areaIds.length === 0) {
        return [];
    }
    const placeholders = areaIds.map(() => '?').join(',');
    try {
        return query(
            `SELECT id FROM cameras
              WHERE area_id IN (${placeholders})
                AND COALESCE(public_playback_mode, '') <> 'admin_only'
              ORDER BY id`,
            areaIds
        ).map((row) => row.id);
    } catch {
        // Fail closed: an unreadable camera table must not be read as "no restriction".
        return [];
    }
}

function isMissingRuleSchemaError(error) {
    const message = String(error?.message || '');
    return message.includes('playback_token_camera_rules')
        && (
            message.includes('no such table')
            || message.includes('no such column')
        );
}

/**
 * A per-camera live OVERRIDE is tri-state: null = inherit the token-level default, true = live
 * allowed for this camera, false = live denied for this camera even if the token default is on.
 * Anything not clearly true/false becomes null so an unreadable value fails to "inherit", never to
 * "grant" — live is opt-in and must never be widened by a malformed value.
 */
function normalizeAllowLiveOverride(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    return value === true || value === 1 || value === '1';
}

function normalizeRuleRow(row) {
    return {
        camera_id: Number.parseInt(row.camera_id, 10),
        enabled: row.enabled === true || row.enabled === 1,
        playback_window_hours: normalizePositiveInteger(row.playback_window_hours),
        expires_at: row.expires_at || null,
        note: typeof row.note === 'string' ? row.note : '',
        allow_live: normalizeAllowLiveOverride(row.allow_live),
    };
}

class PlaybackTokenRuleService {
    normalizeRules(rawRules = []) {
        if (!Array.isArray(rawRules)) {
            return [];
        }

        const seen = new Set();
        const rules = [];
        rawRules.forEach((rawRule) => {
            const cameraId = Number.parseInt(rawRule?.camera_id ?? rawRule?.cameraId, 10);
            if (!Number.isInteger(cameraId) || cameraId <= 0 || seen.has(cameraId)) {
                return;
            }

            seen.add(cameraId);
            rules.push({
                camera_id: cameraId,
                enabled: rawRule?.enabled !== false && rawRule?.enabled !== 0,
                playback_window_hours: normalizePositiveInteger(rawRule?.playback_window_hours ?? rawRule?.playbackWindowHours),
                expires_at: normalizeDate(rawRule?.expires_at ?? rawRule?.expiresAt),
                note: typeof rawRule?.note === 'string' ? rawRule.note.trim() : '',
                allow_live: normalizeAllowLiveOverride(rawRule?.allow_live ?? rawRule?.allowLive),
            });
        });

        return rules;
    }

    replaceRulesForToken(tokenId, rawRules = []) {
        const normalizedTokenId = Number.parseInt(tokenId, 10);
        if (!Number.isInteger(normalizedTokenId) || normalizedTokenId <= 0) {
            const err = new Error('Token playback tidak valid');
            err.statusCode = 400;
            throw err;
        }

        const rules = this.normalizeRules(rawRules);
        const replaceRows = transaction(() => {
            execute('DELETE FROM playback_token_camera_rules WHERE token_id = ?', [normalizedTokenId]);
            rules.forEach((rule) => {
                execute(
                    `INSERT INTO playback_token_camera_rules
                    (token_id, camera_id, enabled, playback_window_hours, expires_at, note, allow_live)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        normalizedTokenId,
                        rule.camera_id,
                        rule.enabled ? 1 : 0,
                        rule.playback_window_hours,
                        rule.expires_at,
                        rule.note,
                        rule.allow_live === null ? null : (rule.allow_live ? 1 : 0),
                    ]
                );
            });
        });
        replaceRows();
        return rules;
    }

    getRulesForToken(tokenId) {
        const normalizedTokenId = Number.parseInt(tokenId, 10);
        if (!Number.isInteger(normalizedTokenId) || normalizedTokenId <= 0) {
            return [];
        }

        try {
            return query(
                `SELECT camera_id, enabled, playback_window_hours, expires_at, note, allow_live
                FROM playback_token_camera_rules
                WHERE token_id = ?
                ORDER BY camera_id ASC`,
                [normalizedTokenId]
            ).map(normalizeRuleRow);
        } catch (error) {
            if (isMissingRuleSchemaError(error)) {
                return [];
            }

            throw error;
        }
    }

    getAllowedCameraIds(token) {
        const rules = Array.isArray(token?.camera_rules) ? token.camera_rules : this.getRulesForToken(token?.id);
        const enabledRuleIds = rules
            .filter((rule) => rule.enabled !== false && rule.enabled !== 0)
            .map((rule) => Number.parseInt(rule.camera_id, 10))
            .filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0);

        if (enabledRuleIds.length > 0) {
            return [...new Set(enabledRuleIds)];
        }

        if (token?.scope_type === 'selected') {
            return parseLegacyCameraIds(token.camera_ids_json || token.camera_ids);
        }

        if (token?.scope_type === 'area') {
            return camerasInAreas(parseAreaIds(token.area_ids_json || token.area_ids));
        }

        return [];
    }

    resolveCameraAccess({ token, camera, rules = null } = {}) {
        const cameraId = Number.parseInt(camera?.id, 10);
        const tokenRules = Array.isArray(rules)
            ? rules.map(normalizeRuleRow)
            : (Array.isArray(token?.camera_rules) ? token.camera_rules : this.getRulesForToken(token?.id));
        const matchingRule = tokenRules.find((rule) => rule.camera_id === cameraId);
        const enabledRule = matchingRule && matchingRule.enabled !== false && matchingRule.enabled !== 0
            ? matchingRule
            : null;
        const tokenWindow = normalizePositiveInteger(token?.playback_window_hours);
        // Live is the token-wide default UNLESS a per-camera rule overrides it (tri-state: the
        // override is only consulted when it is not null). allowLive is meaningful only when the
        // camera is allowed at all — every denied branch returns allowLive:false so live can never
        // outrun playback: no playback access => no live access, by construction.
        const tokenAllowLive = token?.allow_live === true || token?.allow_live === 1;
        const ruleAllowLive = enabledRule && enabledRule.allow_live !== null
            ? enabledRule.allow_live
            : tokenAllowLive;

        if (enabledRule?.expires_at && (parseUtcSql(enabledRule.expires_at)?.getTime() ?? 0) <= Date.now()) {
            return {
                allowed: false,
                reason: 'camera_rule_expired',
                message: 'Akses token untuk kamera ini sudah kedaluwarsa',
                playbackWindowHours: null,
                allowLive: false,
                ruleSource: 'camera_rule',
            };
        }

        if (enabledRule) {
            return {
                allowed: true,
                reason: null,
                message: null,
                playbackWindowHours: enabledRule.playback_window_hours || tokenWindow,
                allowLive: ruleAllowLive,
                ruleSource: 'camera_rule',
            };
        }

        if (token?.scope_type === 'selected') {
            const legacyAllowed = parseLegacyCameraIds(token.camera_ids_json || token.camera_ids).includes(cameraId);
            return {
                allowed: legacyAllowed,
                reason: legacyAllowed ? null : 'token_selected_excludes_camera',
                message: legacyAllowed ? null : 'Token playback tidak mencakup kamera ini',
                playbackWindowHours: legacyAllowed ? tokenWindow : null,
                allowLive: legacyAllowed ? tokenAllowLive : false,
                ruleSource: legacyAllowed ? 'legacy_camera_ids' : 'none',
            };
        }

        /*
         * Area scope MUST be decided here, above the fall-through below. Everything that is not
         * 'selected' used to reach that fall-through and be allowed for every camera, so a new scope
         * added without its own branch would silently grant the whole fleet.
         *
         * Membership is judged from the camera's CURRENT area, which is what makes a camera moved
         * into (or added to) an area covered by a token issued earlier — the whole reason for this
         * scope. A camera whose area_id is missing or unparseable is DENIED: an access decision made
         * from data we do not have must fail closed.
         */
        if (token?.scope_type === 'area') {
            const areaIds = parseAreaIds(token.area_ids_json || token.area_ids);
            const cameraAreaId = Number.parseInt(camera?.area_id, 10);
            const inArea = Number.isInteger(cameraAreaId) && areaIds.includes(cameraAreaId);

            if (!inArea) {
                return {
                    allowed: false,
                    reason: 'token_area_excludes_camera',
                    message: 'Token playback tidak mencakup area kamera ini',
                    playbackWindowHours: null,
                    allowLive: false,
                    ruleSource: 'none',
                };
            }

            if (camera?.public_playback_mode === 'admin_only') {
                return {
                    allowed: false,
                    reason: 'token_area_excludes_admin_only',
                    message: 'Token playback tidak mencakup kamera admin-only ini',
                    playbackWindowHours: null,
                    allowLive: false,
                    ruleSource: 'none',
                };
            }

            return {
                allowed: true,
                reason: null,
                message: null,
                playbackWindowHours: tokenWindow,
                allowLive: tokenAllowLive,
                ruleSource: 'token_area_scope',
            };
        }

        if (camera?.public_playback_mode === 'admin_only') {
            return {
                allowed: false,
                reason: 'token_all_excludes_admin_only',
                message: 'Token playback tidak mencakup kamera admin-only ini',
                playbackWindowHours: null,
                allowLive: false,
                ruleSource: 'none',
            };
        }

        return {
            allowed: true,
            reason: null,
            message: null,
            playbackWindowHours: tokenWindow,
            allowLive: tokenAllowLive,
            ruleSource: 'token_scope',
        };
    }

    buildCameraRulesSummary(token) {
        const allowedCameraIds = this.getAllowedCameraIds(token);
        return {
            allowed_camera_ids: allowedCameraIds,
            camera_count: allowedCameraIds.length,
            // Pass 'area' through rather than collapsing it to 'all' — the summary is what the admin
            // UI and share text read, and calling an area token "all" would misdescribe its reach.
            scope_type: ['selected', 'area'].includes(token?.scope_type) ? token.scope_type : 'all',
        };
    }
}

export default new PlaybackTokenRuleService();
