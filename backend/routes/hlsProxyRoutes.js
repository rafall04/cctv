/**
 * HLS Proxy Routes
 * Proxies HLS stream requests to MediaMTX while tracking viewer sessions.
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import viewerSessionService from '../services/viewerSessionService.js';
import { queryOne } from '../database/connectionPool.js';

const IPV4_MAPPED_PREFIX = '::ffff:';
const DEFAULT_HLS_CONFIG = {
    maxSessionCacheEntries: 5000,
    maxSessionCacheEntriesPerCamera: 1000,
    sessionCacheTtlMs: 25000,
    sessionCleanupIntervalMs: 10000,
    cameraIdCacheTtlMs: 300000,
    maxExternalPlaylistBytes: 1024 * 1024,
    maxSessionCreatesPerWindow: 12,
    maxCameraLookupMissesPerWindow: 30,
    controlWindowMs: 60000,
};

function normalizeIp(ip) {
    if (!ip || typeof ip !== 'string') {
        return 'unknown';
    }

    let normalized = ip.trim();
    if (!normalized) {
        return 'unknown';
    }

    if (normalized.includes(',')) {
        normalized = normalized.split(',')[0].trim();
    }

    if (normalized.startsWith(IPV4_MAPPED_PREFIX)) {
        normalized = normalized.slice(IPV4_MAPPED_PREFIX.length);
    }

    if (normalized === '::1') {
        return '::1';
    }

    if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(normalized)) {
        normalized = normalized.split(':')[0];
    }

    return normalized;
}

function ipToInt(ip) {
    const parts = normalizeIp(ip).split('.');
    if (parts.length !== 4) {
        return null;
    }

    let result = 0;
    for (const part of parts) {
        const value = Number(part);
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            return null;
        }
        result = (result << 8) + value;
    }

    return result >>> 0;
}

function ipv4Mask(bits) {
    if (bits <= 0) {
        return 0;
    }
    if (bits >= 32) {
        return 0xFFFFFFFF;
    }
    return (0xFFFFFFFF << (32 - bits)) >>> 0;
}

export function isTrustedProxy(ip, trustedProxyCidrs = []) {
    const normalizedIp = normalizeIp(ip);
    if (normalizedIp === 'unknown') {
        return false;
    }

    for (const cidr of trustedProxyCidrs) {
        if (!cidr) {
            continue;
        }

        if (!cidr.includes('/')) {
            if (normalizeIp(cidr) === normalizedIp) {
                return true;
            }
            continue;
        }

        const [network, bitString] = cidr.split('/');
        const bits = Number(bitString);

        if (network.includes(':')) {
            if (bits === 128 && normalizeIp(network) === normalizedIp) {
                return true;
            }
            continue;
        }

        const ipInt = ipToInt(normalizedIp);
        const networkInt = ipToInt(network);
        if (ipInt === null || networkInt === null || !Number.isInteger(bits)) {
            continue;
        }

        const mask = ipv4Mask(bits);
        if ((ipInt & mask) === (networkInt & mask)) {
            return true;
        }
    }

    return false;
}

export function getViewerIdentity(request, trustedProxyCidrs = []) {
    const remoteIp = normalizeIp(request.ip || request.socket?.remoteAddress || request.raw?.socket?.remoteAddress);
    if (isTrustedProxy(remoteIp, trustedProxyCidrs)) {
        const forwardedFor = normalizeIp(request.headers['x-forwarded-for']);
        if (forwardedFor !== 'unknown') {
            return forwardedFor;
        }

        const realIp = normalizeIp(request.headers['x-real-ip']);
        if (realIp !== 'unknown') {
            return realIp;
        }
    }

    return remoteIp;
}

export class FixedWindowLimiter {
    constructor(limit, windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.entries = new Map();
    }

    isAllowed(key, now = Date.now()) {
        let entry = this.entries.get(key);
        if (!entry || now - entry.windowStart >= this.windowMs) {
            entry = { count: 0, windowStart: now, lastSeen: now };
            this.entries.set(key, entry);
        }

        entry.lastSeen = now;
        if (entry.count >= this.limit) {
            return false;
        }

        entry.count += 1;
        return true;
    }

    cleanup(now = Date.now()) {
        for (const [key, entry] of this.entries.entries()) {
            if (now - entry.lastSeen >= this.windowMs) {
                this.entries.delete(key);
            }
        }
    }

    size() {
        return this.entries.size;
    }

    clear() {
        this.entries.clear();
    }
}

export class HlsSessionStore {
    constructor(options = {}) {
        this.options = {
            ...DEFAULT_HLS_CONFIG,
            ...options,
        };
        this.entries = new Map();
        this.entriesByCamera = new Map();
        this.inflight = new Map();
        this.cameraIdCache = new Map();
        this.sessionCreateLimiter = new FixedWindowLimiter(
            this.options.maxSessionCreatesPerWindow,
            this.options.controlWindowMs
        );
        this.cameraLookupMissLimiter = new FixedWindowLimiter(
            this.options.maxCameraLookupMissesPerWindow,
            this.options.controlWindowMs
        );
    }

    buildDedupKey(identity, cameraId) {
        return `${identity}:${cameraId}`;
    }

    getStats() {
        return {
            sessionEntries: this.entries.size,
            inflightEntries: this.inflight.size,
            cameraIdCacheEntries: this.cameraIdCache.size,
            sessionCreateLimiterEntries: this.sessionCreateLimiter.size(),
            cameraLookupMissLimiterEntries: this.cameraLookupMissLimiter.size(),
        };
    }

    getSessionEntry(identity, cameraId) {
        return this.entries.get(this.buildDedupKey(identity, cameraId)) || null;
    }

    touchSession(identity, cameraId, type, now = Date.now()) {
        const dedupKey = this.buildDedupKey(identity, cameraId);
        const entry = this.entries.get(dedupKey);
        if (!entry) {
            return null;
        }

        if (type === 'playlist') {
            entry.lastPlaylistAt = now;
        } else {
            entry.lastSegmentAt = now;
        }
        entry.lastTouchedAt = now;
        entry.expiresAt = now + this.options.sessionCacheTtlMs;
        return entry;
    }

    removeSessionEntry(identity, cameraId) {
        const dedupKey = this.buildDedupKey(identity, cameraId);
        const entry = this.entries.get(dedupKey);
        if (!entry) {
            return null;
        }

        this.entries.delete(dedupKey);
        const cameraEntries = this.entriesByCamera.get(entry.cameraId);
        if (cameraEntries) {
            cameraEntries.delete(dedupKey);
            if (cameraEntries.size === 0) {
                this.entriesByCamera.delete(entry.cameraId);
            }
        }

        return entry;
    }

    setSessionEntry(identity, cameraId, sessionId, now = Date.now()) {
        const dedupKey = this.buildDedupKey(identity, cameraId);
        const entry = {
            identity,
            cameraId,
            sessionId,
            lastPlaylistAt: now,
            lastSegmentAt: 0,
            lastTouchedAt: now,
            expiresAt: now + this.options.sessionCacheTtlMs,
        };

        this.entries.set(dedupKey, entry);
        if (!this.entriesByCamera.has(cameraId)) {
            this.entriesByCamera.set(cameraId, new Set());
        }
        this.entriesByCamera.get(cameraId).add(dedupKey);
        this.enforceBounds(cameraId);
        return entry;
    }

    evictOldestEntry(cameraId = null) {
        let oldestKey = null;
        let oldestEntry = null;
        const keys = cameraId === null
            ? this.entries.keys()
            : (this.entriesByCamera.get(cameraId) || []).values();

        for (const key of keys) {
            const entry = this.entries.get(key);
            if (!entry) {
                continue;
            }
            if (!oldestEntry || entry.lastTouchedAt < oldestEntry.lastTouchedAt) {
                oldestEntry = entry;
                oldestKey = key;
            }
        }

        if (!oldestKey || !oldestEntry) {
            return null;
        }

        this.entries.delete(oldestKey);
        const cameraEntries = this.entriesByCamera.get(oldestEntry.cameraId);
        if (cameraEntries) {
            cameraEntries.delete(oldestKey);
            if (cameraEntries.size === 0) {
                this.entriesByCamera.delete(oldestEntry.cameraId);
            }
        }

        return oldestEntry;
    }

    enforceBounds(cameraId) {
        while (this.entries.size > this.options.maxSessionCacheEntries) {
            this.evictOldestEntry();
        }

        const cameraEntries = this.entriesByCamera.get(cameraId);
        while (cameraEntries && cameraEntries.size > this.options.maxSessionCacheEntriesPerCamera) {
            this.evictOldestEntry(cameraId);
        }
    }

    async cleanupExpired(endSession, now = Date.now()) {
        const expiredEntries = [];

        for (const [dedupKey, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) {
                expiredEntries.push({ dedupKey, entry });
            }
        }

        for (const { entry } of expiredEntries) {
            this.removeSessionEntry(entry.identity, entry.cameraId);
            await endSession(entry.sessionId);
        }

        for (const [key, value] of this.cameraIdCache.entries()) {
            if (now - value.lastAccessAt >= this.options.cameraIdCacheTtlMs) {
                this.cameraIdCache.delete(key);
            }
        }

        this.sessionCreateLimiter.cleanup(now);
        this.cameraLookupMissLimiter.cleanup(now);
        return expiredEntries.length;
    }

    async getOrCreateSession({ identity, cameraId, request, startSession, heartbeat }) {
        const now = Date.now();
        const dedupKey = this.buildDedupKey(identity, cameraId);
        const existing = this.entries.get(dedupKey);

        if (existing) {
            const alive = await heartbeat(existing.sessionId);
            if (alive) {
                this.touchSession(identity, cameraId, 'playlist', now);
                return existing.sessionId;
            }
            this.removeSessionEntry(identity, cameraId);
        }

        if (this.inflight.has(dedupKey)) {
            return this.inflight.get(dedupKey);
        }

        if (!this.sessionCreateLimiter.isAllowed(identity, now)) {
            return null;
        }

        const createPromise = (async () => {
            const sessionId = await startSession(cameraId, request);
            this.setSessionEntry(identity, cameraId, sessionId, now);
            return sessionId;
        })().finally(() => {
            this.inflight.delete(dedupKey);
        });

        this.inflight.set(dedupKey, createPromise);
        return createPromise;
    }

    async recordSegmentAccess(identity, cameraId, heartbeat) {
        const entry = this.getSessionEntry(identity, cameraId);
        if (!entry) {
            return null;
        }

        const alive = await heartbeat(entry.sessionId);
        if (!alive) {
            this.removeSessionEntry(identity, cameraId);
            return null;
        }

        this.touchSession(identity, cameraId, 'segment');
        return entry.sessionId;
    }

    getCameraId(streamPath) {
        const cached = this.cameraIdCache.get(streamPath);
        if (!cached) {
            return null;
        }

        if (Date.now() - cached.lastAccessAt >= this.options.cameraIdCacheTtlMs) {
            this.cameraIdCache.delete(streamPath);
            return null;
        }

        cached.lastAccessAt = Date.now();
        return cached.cameraId;
    }

    setCameraId(streamPath, cameraId, now = Date.now()) {
        this.cameraIdCache.set(streamPath, { cameraId, lastAccessAt: now });
    }

    isLookupMissAllowed(identity, streamPath, now = Date.now()) {
        return this.cameraLookupMissLimiter.isAllowed(`${identity}:${streamPath}`, now);
    }

    clear() {
        this.entries.clear();
        this.entriesByCamera.clear();
        this.inflight.clear();
        this.cameraIdCache.clear();
        this.sessionCreateLimiter.clear();
        this.cameraLookupMissLimiter.clear();
    }
}

function createHlsHttpClient() {
    return axios.create({
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
    });
}

function attachStreamAbortHandlers({ request, reply, controller, upstreamStream }) {
    let finished = false;

    const cleanup = () => {
        if (finished) {
            return;
        }
        finished = true;
        controller.abort();
        if (upstreamStream && !upstreamStream.destroyed) {
            upstreamStream.destroy();
        }
        request.raw.off('aborted', onAbort);
        reply.raw.off('close', onAbort);
        reply.raw.off('error', onAbort);
    };

    const onAbort = () => {
        cleanup();
    };

    request.raw.on('aborted', onAbort);
    reply.raw.on('close', onAbort);
    reply.raw.on('error', onAbort);
    if (upstreamStream) {
        upstreamStream.once('end', cleanup);
        upstreamStream.once('error', cleanup);
        upstreamStream.once('close', cleanup);
    }
}

function rewriteExternalPlaylist(playlistText, sourceUrl) {
    const baseUrlMatch = sourceUrl.match(/^(.*\/)/);
    const baseUrl = baseUrlMatch ? baseUrlMatch[1] : '';
    const lines = String(playlistText || '').split('\n');

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        let absoluteUrl = line;
        if (!line.startsWith('http://') && !line.startsWith('https://')) {
            absoluteUrl = line.startsWith('/')
                ? new URL(line, baseUrl).href
                : baseUrl + line;
        }

        lines[index] = `/hls/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    }

    return lines.join('\n');
}

export function createHlsRouteState(options = {}) {
    const hlsOptions = {
        ...DEFAULT_HLS_CONFIG,
        ...(config.security?.hls || {}),
        ...options,
    };

    const store = new HlsSessionStore(hlsOptions);
    const httpClient = createHlsHttpClient();
    let cleanupInterval = null;

    const state = {
        options: hlsOptions,
        store,
        httpClient,
        trustedProxyCidrs: options.trustedProxyCidrs || config.security?.trustedProxyCidrs || [],
        start() {
            if (cleanupInterval) {
                return;
            }

            cleanupInterval = setInterval(async () => {
                try {
                    await store.cleanupExpired((sessionId) => Promise.resolve(viewerSessionService.endSession(sessionId)));
                } catch (error) {
                    console.error('[HLSProxy] Session cleanup error:', error.message);
                }
            }, hlsOptions.sessionCleanupIntervalMs);
        },
        async stop() {
            if (cleanupInterval) {
                clearInterval(cleanupInterval);
                cleanupInterval = null;
            }
            await store.cleanupExpired((sessionId) => Promise.resolve(viewerSessionService.endSession(sessionId)));
            store.clear();
        },
        getViewerIdentity(request) {
            return getViewerIdentity(request, state.trustedProxyCidrs);
        },
        extractCameraId(streamPath, identity) {
            const cachedCameraId = store.getCameraId(streamPath);
            if (cachedCameraId !== null) {
                return cachedCameraId;
            }

            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidPattern.test(streamPath)) {
                return null;
            }

            if (!store.isLookupMissAllowed(identity, streamPath)) {
                return null;
            }

            try {
                const camera = queryOne('SELECT id FROM cameras WHERE stream_key = ?', [streamPath]);
                if (camera) {
                    store.setCameraId(streamPath, camera.id);
                    return camera.id;
                }
            } catch (error) {
                console.error('[HLSProxy] Error looking up camera by stream_key:', error.message);
            }

            return null;
        },
        async getOrCreateSession(identity, cameraId, request) {
            return store.getOrCreateSession({
                identity,
                cameraId,
                request,
                startSession: async (resolvedCameraId, resolvedRequest) => viewerSessionService.startSession(resolvedCameraId, resolvedRequest),
                heartbeat: async (sessionId) => viewerSessionService.heartbeat(sessionId),
            });
        },
        async recordSegmentAccess(identity, cameraId) {
            return store.recordSegmentAccess(identity, cameraId, async (sessionId) => viewerSessionService.heartbeat(sessionId));
        },
    };

    return state;
}

function verifyStreamToken(request, reply, done) {
    let token = request.query.token;

    if (!token) {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }

    if (!token) {
        return done();
    }

    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        if (decoded.type !== 'stream_access') {
            return reply.code(403).send({
                success: false,
                message: 'Invalid token type',
            });
        }

        request.streamToken = decoded;
        done();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return reply.code(401).send({
                success: false,
                message: 'Stream token expired',
            });
        }

        return reply.code(403).send({
            success: false,
            message: 'Invalid stream token',
        });
    }
}

async function handleExternalStreamProxy(state, request, reply) {
    const { url } = request.query;
    if (!url) {
        return reply.code(400).send('Missing url parameter');
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return reply.code(400).send('Invalid url parameter');
    }

    try {
        const isTextFile = url.includes('.m3u8');
        const controller = new AbortController();
        const response = await state.httpClient.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            responseType: isTextFile ? 'text' : 'stream',
            maxContentLength: isTextFile ? state.options.maxExternalPlaylistBytes : Infinity,
            maxBodyLength: isTextFile ? state.options.maxExternalPlaylistBytes : Infinity,
            signal: controller.signal,
        });

        if (response.status !== 200) {
            reply.header('Content-Type', 'text/plain');
            reply.header('Cache-Control', 'no-cache');
            return reply.code(response.status).send('');
        }

        let contentType = 'application/octet-stream';
        if (url.includes('.m3u8')) {
            contentType = 'application/vnd.apple.mpegurl';
        } else if (url.includes('.ts')) {
            contentType = 'video/mp2t';
        }

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');

        if (isTextFile) {
            return reply.send(rewriteExternalPlaylist(response.data, url));
        }

        attachStreamAbortHandlers({
            request,
            reply,
            controller,
            upstreamStream: response.data,
        });
        return reply.send(response.data);
    } catch (error) {
        console.error(`[HLS Proxy] External fetch error for ${url}:`, error.message);
        return reply.code(502).send('');
    }
}

export default async function hlsProxyRoutes(fastify, _options) {
    const mediamtxHlsUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
    const state = createHlsRouteState();
    state.start();

    fastify.addHook('onClose', async () => {
        await state.stop();
    });

    fastify.get('/proxy', async (request, reply) => handleExternalStreamProxy(state, request, reply));

    fastify.get('/*', { preHandler: verifyStreamToken }, async (request, reply) => {
        const fullPath = request.params['*'];
        if (!fullPath) {
            return reply.code(400).send('Invalid path - use /hls/{cameraPath}/index.m3u8');
        }

        const pathParts = fullPath.split('/');
        const cameraPath = pathParts[0];
        const fileName = pathParts[pathParts.length - 1];
        const isTextFile = fileName.endsWith('.m3u8');
        const identity = state.getViewerIdentity(request);
        const cameraId = state.extractCameraId(cameraPath, identity);

        if (cameraId && isTextFile) {
            try {
                await state.getOrCreateSession(identity, cameraId, request);
            } catch (error) {
                console.error('[HLSProxy] Session error:', error.message);
            }
        } else if (cameraId && !isTextFile) {
            try {
                await state.recordSegmentAccess(identity, cameraId);
            } catch {
                // Ignore heartbeat errors in streaming path.
            }
        }

        try {
            const targetUrl = `${mediamtxHlsUrl}/${fullPath}`;
            const isInitFile = fileName.includes('init.mp4') || fileName.includes('_init.mp4');
            const maxRetries = isInitFile ? 3 : 1;
            let response = null;
            let lastError = null;
            let controller = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    controller = new AbortController();
                    response = await state.httpClient.get(targetUrl, {
                        headers: {
                            'User-Agent': request.headers['user-agent'] || 'HLSProxy',
                        },
                        responseType: isTextFile ? 'text' : 'stream',
                        signal: controller.signal,
                    });

                    if (response.status === 200) {
                        break;
                    }

                    if (isInitFile && response.status === 404 && attempt < maxRetries - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        continue;
                    }

                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < maxRetries - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                }
            }

            if (!response && lastError) {
                throw lastError;
            }

            let contentType = 'application/octet-stream';
            if (fileName.endsWith('.m3u8')) {
                contentType = 'application/vnd.apple.mpegurl';
            } else if (fileName.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (fileName.endsWith('.mp4') || fileName.endsWith('.m4s')) {
                contentType = 'video/mp4';
            }

            if (response.status !== 200) {
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');

            if (isTextFile) {
                return reply.send(response.data);
            }

            attachStreamAbortHandlers({
                request,
                reply,
                controller,
                upstreamStream: response.data,
            });
            return reply.send(response.data);
        } catch (error) {
            console.error(`[HLSProxy] Error proxying ${fullPath}:`, error.message);
            return reply.code(502).send('');
        }
    });
}

