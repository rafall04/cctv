/**
 * Purpose: Create, share, validate, and revoke scoped public playback access tokens.
 * Caller: playback token controllers and recordingPlaybackService.
 * Deps: crypto, SQLite connection helpers.
 * MainFuncs: createToken, listTokens, revokeToken, validateRequestForCamera, buildShareText.
 * SideEffects: Writes playback token rows and lightweight token usage touches.
 */

import crypto from 'crypto';
import { execute, query, queryOne } from '../database/connectionPool.js';

export const PLAYBACK_TOKEN_COOKIE = 'raf_playback_token';

const DEFAULT_SHARE_TEMPLATE = `Halo, berikut token akses playback CCTV RAF NET.

Token: {{token}}
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
        preset: row.preset,
        scope_type: row.scope_type,
        camera_ids: cameraIds,
        playback_window_hours: row.playback_window_hours,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        last_used_at: row.last_used_at,
        use_count: row.use_count,
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

    buildPlaybackUrl({ token, request }) {
        const origin = getRequestOrigin(request);
        const queryToken = encodeURIComponent(token);
        return `${origin}/playback?token=${queryToken}`;
    }

    buildShareText({ token, tokenRow, request }) {
        const row = sanitizeTokenRow(tokenRow) || tokenRow;
        const template = row?.share_template?.trim() || DEFAULT_SHARE_TEMPLATE;
        const playbackUrl = this.buildPlaybackUrl({ token, request });
        const cameraScope = row?.scope_type === 'selected'
            ? `${row.camera_ids?.length || 0} kamera terpilih`
            : 'Semua kamera playback';
        const expiresAt = row?.expires_at || 'Selamanya';
        const playbackWindow = row?.playback_window_hours
            ? `${row.playback_window_hours} jam terakhir`
            : 'Full sesuai rekaman tersedia';

        return template
            .replaceAll('{{token}}', token)
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
        const tokenHash = hashToken(token);
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
        const label = String(payload.label || preset.label).trim() || preset.label;
        const shareTemplate = typeof payload.share_template === 'string' && payload.share_template.trim()
            ? payload.share_template.trim()
            : DEFAULT_SHARE_TEMPLATE;

        const result = execute(
            `INSERT INTO playback_tokens
            (label, token_hash, token_prefix, preset, scope_type, camera_ids_json, playback_window_hours, expires_at, share_template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                label,
                tokenHash,
                token.slice(0, 12),
                presetKey,
                scopeType,
                JSON.stringify(cameraIds),
                playbackWindowHours,
                toSqlDate(expiresAt),
                shareTemplate,
                request?.user?.id || null,
            ]
        );

        const row = queryOne('SELECT * FROM playback_tokens WHERE id = ?', [result.lastInsertRowid]);
        const data = sanitizeTokenRow(row);

        return {
            token,
            data,
            share_text: this.buildShareText({ token, tokenRow: data, request }),
        };
    }

    listTokens() {
        return query(
            `SELECT * FROM playback_tokens
            ORDER BY created_at DESC, id DESC
            LIMIT 200`
        ).map(sanitizeTokenRow);
    }

    revokeToken(id) {
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

        return sanitizeTokenRow(queryOne('SELECT * FROM playback_tokens WHERE id = ?', [tokenId]));
    }

    getTokenFromRequest(request = {}) {
        const bearer = request.headers?.authorization?.startsWith('Playback ')
            ? request.headers.authorization.slice('Playback '.length).trim()
            : '';
        return bearer || request.cookies?.[PLAYBACK_TOKEN_COOKIE] || '';
    }

    validateRawTokenForCamera(rawToken, cameraId, { touch = false } = {}) {
        if (!rawToken) {
            return null;
        }

        const row = queryOne('SELECT * FROM playback_tokens WHERE token_hash = ?', [hashToken(rawToken)]);
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

        if (touch) {
            execute(
                `UPDATE playback_tokens
                SET last_used_at = CURRENT_TIMESTAMP, use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [token.id]
            );
        }

        return token;
    }

    validateRequestForCamera(request, cameraId, options = {}) {
        return this.validateRawTokenForCamera(this.getTokenFromRequest(request), cameraId, options);
    }
}

export default new PlaybackTokenService();
