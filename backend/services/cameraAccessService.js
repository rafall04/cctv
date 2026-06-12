/**
 * Purpose: Single decision point for camera class/tenancy access (community vs owner_private vs
 *          subscriber) and the subscriber billing gate used by every stream-serving surface.
 * Caller: streamService, hlsProxyRoutes, externalStreamProxyService, recordingPlaybackService,
 *         customer routes, thumbnail gating hook.
 * Deps: connectionPool (read-only camera lookups).
 * MainFuncs: getAccessInfo, getAccessInfoByStreamKey, isPublicCamera, canViewLive,
 *            invalidateCameraAccessCache.
 * SideEffects: Maintains a small in-memory TTL cache of camera access rows; no writes.
 */

import { queryOne } from '../database/connectionPool.js';

export const CAMERA_CLASSES = ['community', 'owner_private', 'subscriber'];
export const STAFF_ROLES = new Set(['admin', 'viewer']);

// 30s TTL: suspension/resume and class changes take effect on live streams within
// this window without putting a DB lookup on every HLS segment request.
const ACCESS_CACHE_TTL_MS = 30000;
const ACCESS_PROJECTION = 'id, stream_key, enabled, owner_user_id, camera_class, billing_status, is_public';

const cacheById = new Map();
const cacheByStreamKey = new Map();

function normalizeInfo(row) {
    if (!row) {
        return null;
    }
    const cameraClass = CAMERA_CLASSES.includes(row.camera_class) ? row.camera_class : 'community';
    return {
        id: row.id,
        stream_key: row.stream_key || null,
        enabled: row.enabled === 1 || row.enabled === true,
        owner_user_id: row.owner_user_id ?? null,
        camera_class: cameraClass,
        billing_status: row.billing_status || null,
        is_public: row.is_public === 1 || row.is_public === true,
    };
}

// A published, actively-paid subscriber camera is public-live just like a community one.
function isPublishedSubscriber(info) {
    return !!info && info.camera_class === 'subscriber' && info.is_public && info.billing_status === 'active';
}

function readCache(map, key, now) {
    const entry = map.get(key);
    if (entry && now - entry.at < ACCESS_CACHE_TTL_MS) {
        return entry.info;
    }
    if (entry) {
        map.delete(key);
    }
    return undefined;
}

function writeCache(info) {
    const entry = { info, at: Date.now() };
    if (info) {
        cacheById.set(info.id, entry);
        if (info.stream_key) {
            cacheByStreamKey.set(info.stream_key, entry);
        }
    }
}

export function invalidateCameraAccessCache(cameraId = null) {
    if (cameraId === null || cameraId === undefined) {
        cacheById.clear();
        cacheByStreamKey.clear();
        return;
    }
    const entry = cacheById.get(Number(cameraId)) || cacheById.get(cameraId);
    if (entry?.info?.stream_key) {
        cacheByStreamKey.delete(entry.info.stream_key);
    }
    cacheById.delete(Number(cameraId));
    cacheById.delete(cameraId);
}

export function getAccessInfo(cameraId) {
    const numericId = Number(cameraId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        return null;
    }
    const now = Date.now();
    const cached = readCache(cacheById, numericId, now);
    if (cached !== undefined) {
        return cached;
    }
    const info = normalizeInfo(
        queryOne(`SELECT ${ACCESS_PROJECTION} FROM cameras WHERE id = ?`, [numericId])
    );
    if (info) {
        writeCache(info);
    }
    return info;
}

export function getAccessInfoByStreamKey(streamKey) {
    if (!streamKey || typeof streamKey !== 'string') {
        return null;
    }
    const now = Date.now();
    const cached = readCache(cacheByStreamKey, streamKey, now);
    if (cached !== undefined) {
        return cached;
    }
    const info = normalizeInfo(
        queryOne(`SELECT ${ACCESS_PROJECTION} FROM cameras WHERE stream_key = ?`, [streamKey])
    );
    if (info) {
        writeCache(info);
    }
    return info;
}

export function isPublicCamera(info) {
    return !!info && (info.camera_class === 'community' || isPublishedSubscriber(info));
}

export function isStaff(user) {
    return !!user && STAFF_ROLES.has(user.role);
}

export function isOwner(info, user) {
    return !!user && !!info && info.owner_user_id !== null
        && Number(user.id) === Number(info.owner_user_id);
}

/**
 * Live-view decision for a single camera.
 *
 * @param {object} params
 * @param {object|null} params.info        result of getAccessInfo*
 * @param {object|null} params.user        decoded JWT user ({id, role}) or null
 * @param {object|null} params.streamToken decoded stream_access JWT ({cameraId}) or null
 * @returns {{allowed: boolean, statusCode?: number, reason?: string}}
 */
export function canViewLive({ info, user = null, streamToken = null }) {
    if (!info || !info.enabled) {
        return { allowed: false, statusCode: 404, reason: 'camera_not_found' };
    }

    if (info.camera_class === 'community') {
        return { allowed: true };
    }

    // A subscriber camera the owner published is public-live while actively paid — anyone
    // may view it, no token/login. When it suspends (billing_status !== 'active') it falls
    // through and only the owner/staff/token can see it, so it disappears from the public.
    if (isPublishedSubscriber(info)) {
        return { allowed: true };
    }

    // Staff bypass: ops must be able to inspect any stream, including suspended ones.
    if (isStaff(user)) {
        return { allowed: true };
    }

    const tokenMatchesCamera = !!streamToken
        && Number(streamToken.cameraId) === Number(info.id);
    const viewerAuthorized = isOwner(info, user) || tokenMatchesCamera;

    if (!viewerAuthorized) {
        return { allowed: false, statusCode: 403, reason: 'not_camera_owner' };
    }

    if (info.camera_class === 'subscriber' && info.billing_status !== 'active') {
        return { allowed: false, statusCode: 402, reason: 'subscription_suspended' };
    }

    return { allowed: true };
}

export default {
    CAMERA_CLASSES,
    getAccessInfo,
    getAccessInfoByStreamKey,
    isPublicCamera,
    isStaff,
    isOwner,
    canViewLive,
    invalidateCameraAccessCache,
};
