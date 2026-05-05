/**
 * Purpose: Create, share, validate, audit, and revoke scoped public playback access tokens.
 * Caller: playback token controllers and recordingPlaybackService.
 * Deps: crypto, SQLite connection helpers.
 * MainFuncs: createToken, listTokens, listAuditLogs, createPlaybackSession, assertPlaybackSession, clearTokenSessions, revokeToken, buildRepeatShareText, validateRequestForCamera, buildShareText.
 * SideEffects: Writes playback token rows, session rows, audit rows, share keys, and lightweight token usage touches.
 */

import crypto from 'crypto';
import { execute, query, queryOne } from '../database/connectionPool.js';

export const PLAYBACK_TOKEN_COOKIE = 'raf_playback_token';
export const PLAYBACK_TOKEN_SESSION_COOKIE = 'raf_playback_session';

const DEFAULT_SHARE_TEMPLATE = `Halo, berikut token akses playback CCTV RAF NET.

Kode Akses: {{token}}
Link: {{playback_url}}
Berlaku: {{expires_at}}
Akses: {{camera_scope}}`;

const TOKEN_PRESETS = {
    trial_1d: {
        label: 'Trial 1 Hari',
        expiresInHours: 24,
        playbackWindowHours: 24,
    },
    trial_3d: {
        label: 'Trial 3 Hari',
        expiresInHours: 72,
        playbackWindowHours: 72,
    },
    client_30d: {
        label: 'Client 30 Hari',
        expiresInHours: 24 * 30,
        playbackWindowHours: 24 * 30,
    },
    lifetime: {
        label: 'Lifetime',
        expiresInHours: null,
        playbackWindowHours: null,
    },
    custom: {
        label: 'Custom',
        expiresInHours: null,
        playbackWindowHours: null,
    },
};

const ACCESS_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEFAULT_ACCESS_CODE_LENGTH = 8;
const MIN_ACCESS_CODE_LENGTH = 6;
const MAX_ACCESS_CODE_LENGTH = 32;
const SESSION_LIMIT_MODES = new Set(['strict', 'replace_oldest', 'unlimited']);
const DEFAULT_SESSION_TIMEOUT_SECONDS = 60;
const MIN_SESSION_TIMEOUT_SECONDS = 30;
const MAX_SESSION_TIMEOUT_SECONDS = 3600;

function toSqlDate(date) {
    if (!date) {
        return null;
    }

    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNonNegativeInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeSessionLimitMode(value) {
    return SESSION_LIMIT_MODES.has(value) ? value : 'unlimited';
}

function resolveEffectiveSessionLimitMode(token) {
    const mode = normalizeSessionLimitMode(token?.session_limit_mode);
    return mode === 'unlimited' && token?.max_active_sessions ? 'strict' : mode;
}

function normalizeSessionTimeoutSeconds(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SESSION_TIMEOUT_SECONDS;
    }

    return Math.min(Math.max(parsed, MIN_SESSION_TIMEOUT_SECONDS), MAX_SESSION_TIMEOUT_SECONDS);
}

function normalizeAccessCodeLength(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_ACCESS_CODE_LENGTH;
    }

    return Math.min(Math.max(parsed, MIN_ACCESS_CODE_LENGTH), MAX_ACCESS_CODE_LENGTH);
}

function normalizeScopeType(value) {
    return value === 'selected' ? 'selected' : 'all';
}

function normalizeCameraIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0))];
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken() {
    return `rafpb_${crypto.randomBytes(24).toString('base64url')}`;
}

function generateSessionId() {
    return `rafpsess_${crypto.randomBytes(24).toString('base64url')}`;
}

function generateAccessCode(length = DEFAULT_ACCESS_CODE_LENGTH) {
    const normalizedLength = normalizeAccessCodeLength(length);
    let code = '';
    for (let index = 0; index < normalizedLength; index += 1) {
        const randomIndex = crypto.randomInt(0, ACCESS_CODE_CHARS.length);
        code += ACCESS_CODE_CHARS[randomIndex];
    }
    return code;
}

function normalizeCustomAccessCode(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) {
        const err = new Error('Kode akses custom wajib diisi');
        err.statusCode = 400;
        throw err;
    }

    if (code.length < MIN_ACCESS_CODE_LENGTH || code.length > MAX_ACCESS_CODE_LENGTH) {
        const err = new Error(`Kode akses harus ${MIN_ACCESS_CODE_LENGTH}-${MAX_ACCESS_CODE_LENGTH} karakter`);
        err.statusCode = 400;
        throw err;
    }

    if (!/^[A-Z0-9_-]+$/.test(code)) {
        const err = new Error('Kode akses hanya boleh huruf, angka, underscore, atau strip');
        err.statusCode = 400;
        throw err;
    }

    return code;
}

function isMissingAuditSchemaError(error) {
    const message = String(error?.message || '');
    return message.includes('playback_token_audit_logs')
        && (
            message.includes('no such table')
            || message.includes('no such column')
        );
}

function isMissingSessionSchemaError(error) {
    const message = String(error?.message || '');
    return (message.includes('playback_token_sessions')
        || message.includes('max_active_sessions')
        || message.includes('session_limit_mode')
        || message.includes('session_timeout_seconds'))
        && (
            message.includes('no such table')
            || message.includes('no such column')
        );
}

function parseCameraIdsJson(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return normalizeCameraIds(parsed);
    } catch {
        return [];
    }
}

function sanitizeTokenRow(row) {
    if (!row) {
        return null;
    }

    const cameraIds = parseCameraIdsJson(row.camera_ids_json);
    return {
        id: row.id,
        label: row.label,
        token_prefix: row.token_prefix,
        share_key_prefix: row.share_key_prefix || null,
        preset: row.preset,
        scope_type: row.scope_type,
        camera_ids: cameraIds,
        playback_window_hours: row.playback_window_hours,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        last_used_at: row.last_used_at,
        use_count: row.use_count,
        max_active_sessions: row.max_active_sessions ?? null,
        session_limit_mode: row.session_limit_mode || 'unlimited',
        session_timeout_seconds: row.session_timeout_seconds || DEFAULT_SESSION_TIMEOUT_SECONDS,
        client_note: row.client_note || '',
        active_session_count: row.active_session_count || 0,
        latest_session_ip: row.latest_session_ip || null,
        latest_session_user_agent: row.latest_session_user_agent || null,
        latest_session_seen_at: row.latest_session_seen_at || null,
        share_template: row.share_template,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    };
}

function getRequestOrigin(request) {
    const origin = request?.headers?.origin;
    if (origin) {
        return origin.replace(/\/$/, '');
    }

    const host = request?.headers?.host;
    if (!host) {
        return '';
    }

    const proto = request?.headers?.['x-forwarded-proto'] || request?.protocol || 'http';
    return `${proto}://${host}`;
}

class PlaybackTokenService {
    getDefaultShareTemplate() {
        return DEFAULT_SHARE_TEMPLATE;
    }

    getClientIp(request = {}) {
        const forwardedFor = request.headers?.['x-forwarded-for'];
        if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
            return forwardedFor.split(',')[0].trim();
        }

        return request.ip || request.socket?.remoteAddress || null;
    }

    recordAudit({
        tokenId,
        eventType,
        cameraId = null,
        request = {},
        detail = {},
    }) {
        try {
            execute(
                `INSERT INTO playback_token_audit_logs
                (token_id, event_type, camera_id, actor_user_id, ip_address, user_agent, detail_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    tokenId || null,
                    eventType,
                    cameraId || null,
                    request?.user?.id || null,
                    this.getClientIp(request),
                    request?.headers?.['user-agent'] || null,
                    JSON.stringify(detail || {}),
                ]
            );
        } catch (error) {
            if (isMissingAuditSchemaError(error)) {
                console.warn('[PlaybackToken] Audit table missing; run npm run migrate to enable audit logs');
                return;
            }

            throw error;
        }
    }

    buildPlaybackUrl({ token, shareKey, request }) {
        const origin = getRequestOrigin(request);
        const queryName = shareKey ? 'share' : 'token';
        const queryValue = encodeURIComponent(shareKey || token);
        return `${origin}/playback?${queryName}=${queryValue}`;
    }

    ensureShareKeyAvailable(shareKey) {
        const existing = queryOne(
            'SELECT id FROM playback_tokens WHERE share_key_hash = ?',
            [hashToken(shareKey)]
        );

        if (existing) {
            const err = new Error('Kode akses sudah digunakan, pilih kode lain');
            err.statusCode = 409;
            throw err;
        }
    }

    createShareKey(payload = {}) {
        if (payload.access_code_mode === 'custom') {
            const customCode = normalizeCustomAccessCode(payload.custom_access_code);
            this.ensureShareKeyAvailable(customCode);
            return customCode;
        }

        const length = normalizeAccessCodeLength(payload.access_code_length);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const code = generateAccessCode(length);
            const existing = queryOne(
                'SELECT id FROM playback_tokens WHERE share_key_hash = ?',
                [hashToken(code)]
            );
            if (!existing) {
                return code;
            }
        }

        const err = new Error('Gagal membuat kode akses unik, coba lagi');
        err.statusCode = 409;
        throw err;
    }

    resolveSessionPolicy(payload = {}, presetKey = 'custom') {
        const presetDefaults = {
            trial_1d: { maxActiveSessions: 1, mode: 'strict', timeoutSeconds: 60 },
            trial_3d: { maxActiveSessions: 1, mode: 'strict', timeoutSeconds: 60 },
            client_30d: { maxActiveSessions: 3, mode: 'strict', timeoutSeconds: 60 },
            lifetime: { maxActiveSessions: null, mode: 'unlimited', timeoutSeconds: 60 },
            custom: { maxActiveSessions: null, mode: 'unlimited', timeoutSeconds: 60 },
        }[presetKey] || { maxActiveSessions: null, mode: 'unlimited', timeoutSeconds: 60 };

        const requestedMode = payload.session_limit_mode
            ? normalizeSessionLimitMode(payload.session_limit_mode)
            : presetDefaults.mode;
        const requestedMax = Object.prototype.hasOwnProperty.call(payload, 'max_active_sessions')
            ? normalizeNonNegativeInteger(payload.max_active_sessions)
            : presetDefaults.maxActiveSessions;
        const mode = requestedMode === 'unlimited' || requestedMax === 0 ? 'unlimited' : requestedMode;
        const maxActiveSessions = mode === 'unlimited' ? null : (requestedMax || presetDefaults.maxActiveSessions || 1);

        return {
            maxActiveSessions,
            sessionLimitMode: mode,
            sessionTimeoutSeconds: normalizeSessionTimeoutSeconds(
                payload.session_timeout_seconds || presetDefaults.timeoutSeconds
            ),
            clientNote: typeof payload.client_note === 'string' ? payload.client_note.trim() : '',
        };
    }

    buildShareText({ token, shareKey, tokenRow, request }) {
        const row = sanitizeTokenRow(tokenRow) || tokenRow;
        const template = row?.share_template?.trim() || DEFAULT_SHARE_TEMPLATE;
        const accessCode = shareKey || token;
        const playbackUrl = this.buildPlaybackUrl({ token, shareKey, request });
        const cameraScope = row?.scope_type === 'selected'
            ? `${row.camera_ids?.length || 0} kamera terpilih`
            : 'Semua kamera playback';
        const expiresAt = row?.expires_at || 'Selamanya';
        const playbackWindow = row?.playback_window_hours
            ? `${row.playback_window_hours} jam terakhir`
            : 'Full sesuai rekaman tersedia';

        return template
            .replaceAll('{{token}}', accessCode)
            .replaceAll('{{playback_url}}', playbackUrl)
            .replaceAll('{{expires_at}}', expiresAt)
            .replaceAll('{{label}}', row?.label || '')
            .replaceAll('{{camera_scope}}', cameraScope)
            .replaceAll('{{playback_window}}', playbackWindow);
    }

    createToken(payload = {}, request = {}) {
        const presetKey = TOKEN_PRESETS[payload.preset] ? payload.preset : 'custom';
        const preset = TOKEN_PRESETS[presetKey];
        const token = generateToken();
        const shareKey = this.createShareKey(payload);
        const tokenHash = hashToken(token);
        const shareKeyHash = hashToken(shareKey);
        const scopeType = normalizeScopeType(payload.scope_type);
        const cameraIds = scopeType === 'selected' ? normalizeCameraIds(payload.camera_ids) : [];

        if (scopeType === 'selected' && cameraIds.length === 0) {
            const err = new Error('Pilih minimal satu kamera untuk scope selected');
            err.statusCode = 400;
            throw err;
        }

        const now = new Date();
        const customExpiresAt = parseDate(payload.expires_at);
        const expiresAt = preset.expiresInHours === null
            ? customExpiresAt
            : new Date(now.getTime() + preset.expiresInHours * 60 * 60 * 1000);
        const playbackWindowHours = presetKey === 'custom'
            ? normalizePositiveInteger(payload.playback_window_hours)
            : preset.playbackWindowHours;
        const sessionPolicy = this.resolveSessionPolicy(payload, presetKey);
        const label = String(payload.label || preset.label).trim() || preset.label;
        const shareTemplate = typeof payload.share_template === 'string' && payload.share_template.trim()
            ? payload.share_template.trim()
            : DEFAULT_SHARE_TEMPLATE;

        const result = execute(
            `INSERT INTO playback_tokens
            (label, token_hash, token_prefix, share_key_hash, share_key_prefix, preset, scope_type, camera_ids_json, playback_window_hours, expires_at, max_active_sessions, session_limit_mode, session_timeout_seconds, client_note, share_template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                label,
                tokenHash,
                token.slice(0, 12),
                shareKeyHash,
                shareKey.slice(0, 12),
                presetKey,
                scopeType,
                JSON.stringify(cameraIds),
                playbackWindowHours,
                toSqlDate(expiresAt),
                sessionPolicy.maxActiveSessions,
                sessionPolicy.sessionLimitMode,
                sessionPolicy.sessionTimeoutSeconds,
                sessionPolicy.clientNote,
                shareTemplate,
                request?.user?.id || null,
            ]
        );

        const row = queryOne('SELECT * FROM playback_tokens WHERE id = ?', [result.lastInsertRowid]);
        const data = sanitizeTokenRow(row);
        this.recordAudit({
            tokenId: data.id,
            eventType: 'created',
            request,
            detail: { preset: presetKey, scope_type: scopeType, camera_count: cameraIds.length },
        });

        return {
            token,
            data,
            share_key: shareKey,
            share_text: this.buildShareText({ shareKey, tokenRow: data, request }),
        };
    }

    listTokens() {
        try {
            return query(
                `SELECT
                    pt.*,
                    COALESCE(active_sessions.active_session_count, 0) as active_session_count,
                    latest_session.ip_address as latest_session_ip,
                    latest_session.user_agent as latest_session_user_agent,
                    latest_session.last_seen_at as latest_session_seen_at
                FROM playback_tokens pt
                LEFT JOIN (
                    SELECT token_id, COUNT(*) as active_session_count, MAX(id) as latest_session_id
                    FROM playback_token_sessions
                    WHERE ended_at IS NULL AND expires_at > CURRENT_TIMESTAMP
                    GROUP BY token_id
                ) active_sessions ON active_sessions.token_id = pt.id
                LEFT JOIN playback_token_sessions latest_session ON latest_session.id = active_sessions.latest_session_id
                ORDER BY pt.created_at DESC, pt.id DESC
                LIMIT 200`
            ).map(sanitizeTokenRow);
        } catch (error) {
            if (isMissingSessionSchemaError(error)) {
                return query(
                    `SELECT * FROM playback_tokens
                    ORDER BY created_at DESC, id DESC
                    LIMIT 200`
                ).map(sanitizeTokenRow);
            }

            throw error;
        }
    }

    cleanupExpiredSessions(tokenId) {
        try {
            execute(
                `UPDATE playback_token_sessions
                SET ended_at = CURRENT_TIMESTAMP, end_reason = ?, updated_at = CURRENT_TIMESTAMP
                WHERE token_id = ?
                  AND ended_at IS NULL
                  AND expires_at <= CURRENT_TIMESTAMP`,
                ['expired', tokenId]
            );
        } catch (error) {
            if (!isMissingSessionSchemaError(error)) {
                throw error;
            }
        }
    }

    getActiveSessions(tokenId) {
        try {
            return query(
                `SELECT *
                FROM playback_token_sessions
                WHERE token_id = ?
                  AND ended_at IS NULL
                  AND expires_at > CURRENT_TIMESTAMP
                ORDER BY last_seen_at ASC, id ASC`,
                [tokenId]
            );
        } catch (error) {
            if (isMissingSessionSchemaError(error)) {
                return [];
            }

            throw error;
        }
    }

    createPlaybackSession({ token, clientId = '', request = {} }) {
        if (!token?.id) {
            const err = new Error('Token playback tidak valid');
            err.statusCode = 401;
            throw err;
        }

        const mode = resolveEffectiveSessionLimitMode(token);
        const maxActiveSessions = token.max_active_sessions ?? null;
        const timeoutSeconds = normalizeSessionTimeoutSeconds(token.session_timeout_seconds);

        this.cleanupExpiredSessions(token.id);
        const activeSessions = this.getActiveSessions(token.id);

        if (mode !== 'unlimited' && maxActiveSessions && activeSessions.length >= maxActiveSessions) {
            if (mode === 'replace_oldest') {
                execute(
                    `UPDATE playback_token_sessions
                    SET ended_at = CURRENT_TIMESTAMP, end_reason = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?`,
                    ['replaced', activeSessions[0].id]
                );
            } else {
                const err = new Error('Batas perangkat aktif untuk token ini sudah penuh');
                err.statusCode = 429;
                throw err;
            }
        }

        const sessionId = generateSessionId();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000);
        execute(
            `INSERT INTO playback_token_sessions
            (token_id, session_id_hash, client_id_hash, ip_address, user_agent, last_seen_at, expires_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
            [
                token.id,
                hashToken(sessionId),
                clientId ? hashToken(clientId) : null,
                this.getClientIp(request),
                request?.headers?.['user-agent'] || null,
                toSqlDate(expiresAt),
            ]
        );

        this.recordAudit({
            tokenId: token.id,
            eventType: 'session_started',
            request,
            detail: {
                mode,
                max_active_sessions: maxActiveSessions,
                timeout_seconds: timeoutSeconds,
            },
        });

        return {
            session_id: sessionId,
            timeout_seconds: timeoutSeconds,
            active_session_count: mode === 'replace_oldest' && activeSessions.length >= (maxActiveSessions || 0)
                ? activeSessions.length
                : activeSessions.length + 1,
        };
    }

    assertPlaybackSession({ request = {}, token, touch = false } = {}) {
        if (!token?.id || resolveEffectiveSessionLimitMode(token) === 'unlimited') {
            return null;
        }

        const sessionId = request.cookies?.[PLAYBACK_TOKEN_SESSION_COOKIE];
        if (!sessionId) {
            const err = new Error('Session playback tidak aktif');
            err.statusCode = 401;
            throw err;
        }

        const row = queryOne(
            `SELECT *
            FROM playback_token_sessions
            WHERE token_id = ?
              AND session_id_hash = ?
              AND ended_at IS NULL
              AND expires_at > CURRENT_TIMESTAMP`,
            [token.id, hashToken(sessionId)]
        );

        if (!row) {
            const err = new Error('Session playback tidak aktif');
            err.statusCode = 401;
            throw err;
        }

        if (touch) {
            const timeoutSeconds = normalizeSessionTimeoutSeconds(token.session_timeout_seconds);
            const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
            execute(
                `UPDATE playback_token_sessions
                SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [toSqlDate(expiresAt), row.id]
            );
        }

        return row;
    }

    stopPlaybackSession(request = {}, reason = 'stopped') {
        const sessionId = request.cookies?.[PLAYBACK_TOKEN_SESSION_COOKIE];
        if (!sessionId) {
            return null;
        }

        return execute(
            `UPDATE playback_token_sessions
            SET ended_at = CURRENT_TIMESTAMP, end_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE session_id_hash = ? AND ended_at IS NULL`,
            [reason, hashToken(sessionId)]
        );
    }

    clearTokenSessions(tokenId, request = {}) {
        const result = execute(
            `UPDATE playback_token_sessions
            SET ended_at = CURRENT_TIMESTAMP, end_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE token_id = ? AND ended_at IS NULL`,
            ['admin_cleared', tokenId]
        );
        this.recordAudit({ tokenId, eventType: 'sessions_cleared', request, detail: { cleared: result.changes } });
        return result.changes;
    }

    listAuditLogs({ tokenId = null, limit = 100 } = {}) {
        const normalizedTokenId = Number.parseInt(tokenId, 10);
        const normalizedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 200);
        const params = [];
        let whereClause = '';

        if (Number.isInteger(normalizedTokenId) && normalizedTokenId > 0) {
            whereClause = 'WHERE al.token_id = ?';
            params.push(normalizedTokenId);
        }

        params.push(normalizedLimit);

        let rows = [];
        try {
            rows = query(
                `SELECT
                    al.id,
                    al.token_id,
                    pt.label as token_label,
                    pt.token_prefix,
                    al.event_type,
                    al.camera_id,
                    c.name as camera_name,
                    al.actor_user_id,
                    u.username as actor_username,
                    al.ip_address,
                    al.user_agent,
                    al.detail_json,
                    al.created_at
                FROM playback_token_audit_logs al
                LEFT JOIN playback_tokens pt ON pt.id = al.token_id
                LEFT JOIN cameras c ON c.id = al.camera_id
                LEFT JOIN users u ON u.id = al.actor_user_id
                ${whereClause}
                ORDER BY al.created_at DESC, al.id DESC
                LIMIT ?`,
                params
            );
        } catch (error) {
            if (isMissingAuditSchemaError(error)) {
                return [];
            }

            throw error;
        }

        return rows.map((row) => {
            let detail = {};
            try {
                detail = JSON.parse(row.detail_json || '{}');
            } catch {
                detail = {};
            }

            return {
                ...row,
                detail,
            };
        });
    }

    buildRepeatShareText(id, request = {}) {
        const tokenId = Number.parseInt(id, 10);
        if (!Number.isInteger(tokenId) || tokenId <= 0) {
            const err = new Error('Invalid token id');
            err.statusCode = 400;
            throw err;
        }

        const row = queryOne('SELECT * FROM playback_tokens WHERE id = ?', [tokenId]);
        const token = sanitizeTokenRow(row);
        if (!token) {
            const err = new Error('Token tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }

        if (!token.is_active) {
            const err = new Error('Token tidak aktif dan tidak bisa dibagikan ulang');
            err.statusCode = 400;
            throw err;
        }

        const shareKey = this.createShareKey({ access_code_length: DEFAULT_ACCESS_CODE_LENGTH });
        execute(
            `UPDATE playback_tokens
            SET share_key_hash = ?, share_key_prefix = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [hashToken(shareKey), shareKey.slice(0, 12), tokenId]
        );

        const updated = sanitizeTokenRow(queryOne('SELECT * FROM playback_tokens WHERE id = ?', [tokenId]));
        const shareText = this.buildShareText({ shareKey, tokenRow: updated, request });
        this.recordAudit({
            tokenId,
            eventType: 'shared',
            request,
            detail: { share_key_prefix: shareKey.slice(0, 12) },
        });

        return {
            data: updated,
            share_text: shareText,
        };
    }

    revokeToken(id, request = {}) {
        const tokenId = Number.parseInt(id, 10);
        if (!Number.isInteger(tokenId) || tokenId <= 0) {
            const err = new Error('Invalid token id');
            err.statusCode = 400;
            throw err;
        }

        const result = execute(
            `UPDATE playback_tokens
            SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revoked_at IS NULL`,
            [tokenId]
        );

        if (result.changes === 0) {
            const err = new Error('Token tidak ditemukan atau sudah dicabut');
            err.statusCode = 404;
            throw err;
        }

        const token = sanitizeTokenRow(queryOne('SELECT * FROM playback_tokens WHERE id = ?', [tokenId]));
        this.recordAudit({ tokenId, eventType: 'revoked', request });
        return token;
    }

    getTokenFromRequest(request = {}) {
        const bearer = request.headers?.authorization?.startsWith('Playback ')
            ? request.headers.authorization.slice('Playback '.length).trim()
            : '';
        return bearer || request.cookies?.[PLAYBACK_TOKEN_COOKIE] || '';
    }

    validateRawTokenForCamera(rawToken, cameraId, options = {}) {
        const { touch = false } = options;
        if (!rawToken) {
            return null;
        }

        const credentialHash = hashToken(rawToken);
        const row = queryOne(
            `SELECT * FROM playback_tokens
            WHERE token_hash = ? OR share_key_hash = ?`,
            [credentialHash, credentialHash]
        );
        const token = sanitizeTokenRow(row);
        if (!token) {
            const err = new Error('Token playback tidak valid');
            err.statusCode = 401;
            throw err;
        }

        if (token.revoked_at) {
            const err = new Error('Token playback sudah dicabut');
            err.statusCode = 401;
            throw err;
        }

        if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
            const err = new Error('Token playback sudah kedaluwarsa');
            err.statusCode = 401;
            throw err;
        }

        const normalizedCameraId = Number.parseInt(cameraId, 10);
        if (token.scope_type === 'selected' && normalizedCameraId > 0 && !token.camera_ids.includes(normalizedCameraId)) {
            const err = new Error('Token playback tidak mencakup kamera ini');
            err.statusCode = 403;
            throw err;
        }

        if (options.requireSession !== false) {
            this.assertPlaybackSession({ request: options.request || {}, token, touch });
        }

        if (touch) {
            execute(
                `UPDATE playback_tokens
                SET last_used_at = CURRENT_TIMESTAMP, use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [token.id]
            );
            this.recordAudit({
                tokenId: token.id,
                eventType: options.eventType || 'access',
                cameraId: normalizedCameraId > 0 ? normalizedCameraId : null,
                request: options.request || {},
                detail: { scope_type: token.scope_type },
            });
        }

        return token;
    }

    validateRequestForCamera(request, cameraId, options = {}) {
        return this.validateRawTokenForCamera(this.getTokenFromRequest(request), cameraId, {
            ...options,
            request,
        });
    }
}

export default new PlaybackTokenService();
