/**
 * HLS Proxy Routes
 * Proxies HLS stream requests to MediaMTX while tracking viewer sessions.
 */

import axios from 'axios';
import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import { isIP } from 'net';
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
    maxLimiterKeys: 5000,
    externalProxyAllowPrivateHosts: false,
    externalProxyAllowedHosts: [],
    externalProxyTimeoutMs: 30000,
    sessionCloseBatchSize: 25,
    sessionCloseTimeoutMs: 2000,
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
    constructor(limit, windowMs, maxEntries = Infinity) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
    }

    isAllowed(key, now = Date.now()) {
        let entry = this.entries.get(key);
        if (!entry || now - entry.windowStart >= this.windowMs) {
            if (!entry && this.entries.size >= this.maxEntries) {
                this.evictOldestEntry();
            }
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

    evictOldestEntry() {
        let oldestKey = null;
        let oldestEntry = null;

        for (const [key, entry] of this.entries.entries()) {
            if (!oldestEntry || entry.lastSeen < oldestEntry.lastSeen) {
                oldestEntry = entry;
                oldestKey = key;
            }
        }

        if (oldestKey !== null) {
            this.entries.delete(oldestKey);
        }
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
        this.pendingSessionCloses = new Set();
        this.sessionCreateLimiter = new FixedWindowLimiter(
            this.options.maxSessionCreatesPerWindow,
            this.options.controlWindowMs,
            this.options.maxLimiterKeys
        );
        this.cameraLookupMissLimiter = new FixedWindowLimiter(
            this.options.maxCameraLookupMissesPerWindow,
            this.options.controlWindowMs,
            this.options.maxLimiterKeys
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

        this.queueSessionClose(oldestEntry.sessionId);

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

        for (const entry of this.entries.values()) {
            if (entry.expiresAt <= now) {
                expiredEntries.push(entry);
            }
        }

        for (const entry of expiredEntries) {
            this.removeSessionEntry(entry.identity, entry.cameraId);
            this.queueSessionClose(entry.sessionId);
        }

        for (const [key, value] of this.cameraIdCache.entries()) {
            if (now - value.lastAccessAt >= this.options.cameraIdCacheTtlMs) {
                this.cameraIdCache.delete(key);
            }
        }

        this.sessionCreateLimiter.cleanup(now);
        this.cameraLookupMissLimiter.cleanup(now);
        await this.drainPendingSessionCloses(endSession);
        return expiredEntries.length;
    }

    async cleanupAll(endSession) {
        const allEntries = Array.from(this.entries.values());
        for (const entry of allEntries) {
            this.removeSessionEntry(entry.identity, entry.cameraId);
            this.queueSessionClose(entry.sessionId);
        }
        this.cameraIdCache.clear();
        this.sessionCreateLimiter.clear();
        this.cameraLookupMissLimiter.clear();
        await this.drainPendingSessionCloses(endSession);
        return allEntries.length;
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

    queueSessionClose(sessionId) {
        if (sessionId) {
            this.pendingSessionCloses.add(sessionId);
        }
    }

    async drainPendingSessionCloses(endSession, options = {}) {
        if (this.pendingSessionCloses.size === 0) {
            return 0;
        }

        const batchSize = options.batchSize || this.options.sessionCloseBatchSize || this.pendingSessionCloses.size;
        const sessionIds = Array.from(this.pendingSessionCloses).slice(0, batchSize);
        for (const sessionId of sessionIds) {
            this.pendingSessionCloses.delete(sessionId);
        }

        for (const sessionId of sessionIds) {
            await endSession(sessionId);
        }
        return sessionIds.length;
    }

    clear() {
        this.entries.clear();
        this.entriesByCamera.clear();
        this.inflight.clear();
        this.cameraIdCache.clear();
        this.pendingSessionCloses.clear();
        this.sessionCreateLimiter.clear();
        this.cameraLookupMissLimiter.clear();
    }
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

function createHlsHttpClient(timeout = DEFAULT_HLS_CONFIG.externalProxyTimeoutMs, extraConfig = {}) {
    return axios.create({
        timeout,
        validateStatus: () => true,
        maxRedirects: 0,
        httpAgent,
        httpsAgent,
        ...extraConfig,
    });
}

function normalizeExternalTlsMode(value) {
    return value === 'insecure' ? 'insecure' : 'strict';
}

function safeAbort(controller) {
    if (!controller || controller.signal?.aborted) {
        return;
    }

    try {
        controller.abort();
    } catch {
        // Ignore repeated aborts from already-settled upstream requests.
    }
}

function isReadableStream(value) {
    return !!value && typeof value.pipe === 'function' && typeof value.destroy === 'function';
}

function safeDestroyStream(stream) {
    if (!isReadableStream(stream) || stream.destroyed) {
        return;
    }

    try {
        stream.destroy();
    } catch {
        // Ignore stream destroy errors during cleanup.
    }
}

function isPrivateOrLocalIp(hostname) {
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
        const value = ipToInt(hostname);
        if (value === null) {
            return false;
        }

        return (
            (value >>> 24) === 10 ||
            (value >>> 24) === 127 ||
            (((value & 0xFFF00000) >>> 0) === 0xAC100000) ||
            (((value & 0xFFFF0000) >>> 0) === 0xC0A80000) ||
            (((value & 0xFFFF0000) >>> 0) === 0xA9FE0000)
        );
    }

    if (ipVersion === 6) {
        const normalized = hostname.toLowerCase();
        return (
            normalized === '::1' ||
            normalized === '::' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd') ||
            normalized.startsWith('fe80:')
        );
    }

    return false;
}

export function isExternalProxyTargetAllowed(rawUrl, options = {}) {
    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return false;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
    }

    if (!parsedUrl.hostname) {
        return false;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const allowPrivateHosts = options.allowPrivateHosts === true;
    const allowedHosts = new Set((options.allowedHosts || []).map((host) => host.toLowerCase()));

    if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
        return false;
    }

    if (allowPrivateHosts) {
        return true;
    }

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return false;
    }

    if (isPrivateOrLocalIp(hostname)) {
        return false;
    }

    return true;
}

export function isExternalProxyUrlCompatible(cameraExternalUrl, requestedUrl) {
    try {
        const configuredUrl = new URL(cameraExternalUrl);
        const targetUrl = new URL(requestedUrl);

        if (
            configuredUrl.protocol !== targetUrl.protocol ||
            configuredUrl.hostname.toLowerCase() !== targetUrl.hostname.toLowerCase() ||
            configuredUrl.port !== targetUrl.port
        ) {
            return false;
        }

        const configuredBaseUrl = new URL('.', configuredUrl).href;
        return targetUrl.href === configuredUrl.href || targetUrl.href.startsWith(configuredBaseUrl);
    } catch {
        return false;
    }
}

export function resolveExternalCameraProxyConfig(camera, requestedUrl) {
    if (!camera || camera.stream_source !== 'external' || !camera.external_hls_url) {
        return null;
    }

    if (!isExternalProxyUrlCompatible(camera.external_hls_url, requestedUrl)) {
        return null;
    }

    return {
        cameraId: camera.id,
        externalUseProxy: camera.external_use_proxy !== 0 && camera.external_use_proxy !== false,
        externalTlsMode: normalizeExternalTlsMode(camera.external_tls_mode),
    };
}

export function cleanupUpstreamResponse({ controller, response, upstreamStream } = {}) {
    safeAbort(controller);
    safeDestroyStream(upstreamStream || response?.data);
}

// Only attach this to successful binary streams that are being piped to the client.
export function attachAbortCleanup({ request, reply, controller, upstreamStream }) {
    let cleanedUp = false;
    let listenersAttached = false;
    let upstreamEnded = false;
    let replyCompleted = false;
    let replyErrored = false;

    const removeListeners = () => {
        if (!listenersAttached) {
            return;
        }

        request.raw.off('aborted', onRequestAborted);
        reply.raw.off('close', onReplyClose);
        reply.raw.off('finish', onReplyFinish);
        reply.raw.off('error', onReplyError);
        if (isReadableStream(upstreamStream)) {
            upstreamStream.off('end', onStreamEnd);
            upstreamStream.off('error', onStreamError);
            upstreamStream.off('close', onStreamClose);
        }
        listenersAttached = false;
    };

    const cleanup = ({ abortController = false, destroyStream = false } = {}) => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        removeListeners();
        if (abortController) {
            safeAbort(controller);
        }
        if (destroyStream) {
            safeDestroyStream(upstreamStream);
        }
    };

    const onRequestAborted = () => {
        cleanup({ abortController: true, destroyStream: true });
    };

    const onReplyFinish = () => {
        replyCompleted = true;
    };

    const onReplyError = () => {
        replyErrored = true;
        cleanup({ abortController: true, destroyStream: true });
    };

    const onReplyClose = () => {
        const shouldAbort = !replyCompleted && !replyErrored && !upstreamEnded;
        cleanup({ abortController: shouldAbort, destroyStream: shouldAbort });
    };

    const onStreamEnd = () => {
        upstreamEnded = true;
        cleanup();
    };

    const onStreamError = () => {
        cleanup({ abortController: true, destroyStream: true });
    };

    const onStreamClose = () => {
        cleanup({ abortController: !upstreamEnded, destroyStream: !upstreamEnded });
    };

    const attach = () => {
        if (listenersAttached || !request?.raw || !reply?.raw) {
            return cleanup;
        }

        request.raw.on('aborted', onRequestAborted);
        reply.raw.on('close', onReplyClose);
        reply.raw.on('finish', onReplyFinish);
        reply.raw.on('error', onReplyError);
        if (isReadableStream(upstreamStream)) {
            upstreamStream.on('end', onStreamEnd);
            upstreamStream.on('error', onStreamError);
            upstreamStream.on('close', onStreamClose);
        }
        listenersAttached = true;
        return cleanup;
    };

    return { attach, cleanup };
}

// Text helpers are only for playlist-like responses and never manage stream lifecycle.
export async function fetchTextUpstream({
    httpClient,
    targetUrl,
    headers,
    maxContentLength,
    maxBodyLength,
}) {
    return httpClient.get(targetUrl, {
        headers,
        responseType: 'text',
        ...(Number.isFinite(maxContentLength) ? { maxContentLength } : {}),
        ...(Number.isFinite(maxBodyLength) ? { maxBodyLength } : {}),
    });
}

// Binary helper only fetches/retries upstream responses and cleans failed attempts.
export async function fetchBinaryUpstream({
    httpClient,
    targetUrl,
    headers,
    maxRetries = 1,
    retryDelayMs = 500,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        let response = null;

        try {
            response = await httpClient.get(targetUrl, {
                headers,
                responseType: 'stream',
                signal: controller.signal,
            });

            if (response.status === 200) {
                return {
                    controller,
                    response,
                    status: response.status,
                    stream: response.data,
                };
            }

            const shouldRetry = response.status === 404 && attempt < maxRetries - 1;
            if (!shouldRetry) {
                return {
                    controller,
                    response,
                    status: response.status,
                    stream: response.data,
                };
            }

            cleanupUpstreamResponse({ controller, response });
            await sleep(retryDelayMs);
        } catch (error) {
            cleanupUpstreamResponse({ controller, response, upstreamStream: error?.response?.data });
            lastError = error;

            if (attempt < maxRetries - 1) {
                await sleep(retryDelayMs);
                continue;
            }
        }
    }

    throw lastError || new Error('Failed to fetch upstream binary response');
}

function applyHlsCorsHeaders(request, reply) {
    const origin = request.headers.origin;
    if (!origin) {
        return;
    }

    const allowedOrigins = config.security?.allowedOrigins || [];
    if (!allowedOrigins.includes(origin)) {
        return;
    }

    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');
}

async function endSessionWithTimeout(sessionId, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_HLS_CONFIG.sessionCloseTimeoutMs;
    const endSession = options.endSession;

    if (typeof endSession !== 'function') {
        return false;
    }

    try {
        await Promise.race([
            Promise.resolve(endSession(sessionId)),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Timed out ending session ${sessionId}`)), timeoutMs);
            }),
        ]);
        return true;
    } catch (error) {
        console.error('[HLSProxy] Session close error:', error.message);
        return false;
    }
}

function rewriteExternalPlaylist(playlistText, sourceUrl, cameraId = null) {
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

        const query = new URLSearchParams({ url: absoluteUrl });
        if (cameraId !== null && cameraId !== undefined) {
            query.set('cameraId', String(cameraId));
        }

        lines[index] = `/hls/proxy?${query.toString()}`;
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
    const httpClient = createHlsHttpClient(hlsOptions.externalProxyTimeoutMs);
    let cleanupInterval = null;
    let sessionCleanupQueue = Promise.resolve();
    const cleanupMetrics = {
        queueDepth: 0,
        lastCleanupDurationMs: 0,
    };

    const runSessionCleanup = (task) => {
        cleanupMetrics.queueDepth += 1;
        sessionCleanupQueue = sessionCleanupQueue
            .catch(() => {})
            .then(async () => {
                const startedAt = Date.now();
                try {
                    return await task();
                } finally {
                    cleanupMetrics.queueDepth = Math.max(0, cleanupMetrics.queueDepth - 1);
                    cleanupMetrics.lastCleanupDurationMs = Date.now() - startedAt;
                }
            });
        return sessionCleanupQueue;
    };

    const endSession = (sessionId) => endSessionWithTimeout(sessionId, {
        timeoutMs: hlsOptions.sessionCloseTimeoutMs,
        endSession: (activeSessionId) => viewerSessionService.endSession(activeSessionId),
    });

    const state = {
        options: hlsOptions,
        store,
        httpClient,
        trustedProxyCidrs: options.trustedProxyCidrs || config.security?.trustedProxyCidrs || [],
        start() {
            if (cleanupInterval) {
                return;
            }

            cleanupInterval = setInterval(() => {
                runSessionCleanup(() => store.cleanupExpired(endSession)).catch((error) => {
                    console.error('[HLSProxy] Session cleanup error:', error.message);
                });
            }, hlsOptions.sessionCleanupIntervalMs);
        },
        async stop() {
            if (cleanupInterval) {
                clearInterval(cleanupInterval);
                cleanupInterval = null;
            }

            await runSessionCleanup(async () => {
                await store.cleanupAll(endSession);
            });
            store.clear();
        },
        flushPendingSessionCloses() {
            return runSessionCleanup(() => store.drainPendingSessionCloses(endSession));
        },
        getStats() {
            return {
                ...store.getStats(),
                pendingSessionCloses: store.pendingSessionCloses.size,
                sessionCleanupQueueDepth: cleanupMetrics.queueDepth,
                lastCleanupDurationMs: cleanupMetrics.lastCleanupDurationMs,
            };
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
        getExternalCameraProxyConfig(cameraId, rawUrl) {
            if (!cameraId) {
                return null;
            }

            const parsedCameraId = parseInt(cameraId, 10);
            if (!Number.isInteger(parsedCameraId) || parsedCameraId <= 0) {
                return null;
            }

            try {
                const camera = queryOne(
                    `SELECT id, stream_source, external_hls_url,
                            COALESCE(external_use_proxy, 1) as external_use_proxy,
                            CASE
                                WHEN external_tls_mode IN ('strict', 'insecure') THEN external_tls_mode
                                ELSE 'strict'
                            END as external_tls_mode
                     FROM cameras
                     WHERE id = ?`,
                    [parsedCameraId]
                );

                return resolveExternalCameraProxyConfig(camera, rawUrl);
            } catch (error) {
                console.error('[HLSProxy] Error looking up external camera proxy config:', error.message);
                return null;
            }
        },
        async getOrCreateSession(identity, cameraId, request) {
            const sessionId = await store.getOrCreateSession({
                identity,
                cameraId,
                request,
                startSession: async (resolvedCameraId, resolvedRequest) => (
                    viewerSessionService.startSession(resolvedCameraId, resolvedRequest)
                ),
                heartbeat: async (activeSessionId) => viewerSessionService.heartbeat(activeSessionId),
            });
            void state.flushPendingSessionCloses().catch((error) => {
                console.error('[HLSProxy] Pending session close error:', error.message);
            });
            return sessionId;
        },
        async recordSegmentAccess(identity, cameraId) {
            const sessionId = await store.recordSegmentAccess(
                identity,
                cameraId,
                async (activeSessionId) => viewerSessionService.heartbeat(activeSessionId)
            );
            void state.flushPendingSessionCloses().catch((error) => {
                console.error('[HLSProxy] Pending session close error:', error.message);
            });
            return sessionId;
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
    applyHlsCorsHeaders(request, reply);
    const { url, cameraId } = request.query;
    if (!url) {
        return reply.code(400).send('Missing url parameter');
    }

    if (!isExternalProxyTargetAllowed(url, {
        allowPrivateHosts: state.options.externalProxyAllowPrivateHosts,
        allowedHosts: state.options.externalProxyAllowedHosts,
    })) {
        return reply.code(400).send('Invalid url parameter');
    }

    try {
        const externalCameraConfig = cameraId
            ? state.getExternalCameraProxyConfig(cameraId, url)
            : null;
        if (cameraId && !externalCameraConfig) {
            return reply.code(400).send('Invalid cameraId parameter');
        }

        const externalTlsMode = externalCameraConfig?.externalTlsMode || 'strict';
        const requestHttpClient = externalTlsMode === 'insecure'
            ? createHlsHttpClient(state.options.externalProxyTimeoutMs, {
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            })
            : state.httpClient;
        const isTextFile = url.includes('.m3u8');
        
        let originUrl = '';
        try {
            originUrl = new URL(url).origin;
        } catch {
            originUrl = '';
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...(originUrl ? { 'Referer': `${originUrl}/`, 'Origin': originUrl } : {})
        };

        if (isTextFile) {
            const response = await fetchTextUpstream({
                httpClient: requestHttpClient,
                targetUrl: url,
                headers,
                maxContentLength: state.options.maxExternalPlaylistBytes,
                maxBodyLength: state.options.maxExternalPlaylistBytes,
            });

            if (response.status !== 200) {
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            reply.header('Content-Type', 'application/vnd.apple.mpegurl');
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            return reply.send(rewriteExternalPlaylist(response.data, url, externalCameraConfig?.cameraId ?? null));
        }

        const { controller, response } = await fetchBinaryUpstream({
            httpClient: requestHttpClient,
            targetUrl: url,
            headers,
        });

        if (response.status !== 200) {
            cleanupUpstreamResponse({ controller, response });
            reply.header('Content-Type', 'text/plain');
            reply.header('Cache-Control', 'no-cache');
            return reply.code(response.status).send('');
        }

        let contentType = 'application/octet-stream';
        if (url.includes('.ts')) {
            contentType = 'video/mp2t';
        } else if (url.includes('.mp4') || url.includes('.m4s')) {
            contentType = 'video/mp4';
        }

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');

        attachAbortCleanup({
            request,
            reply,
            controller,
            upstreamStream: response.data,
        }).attach();
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

    fastify.addHook('onRequest', async (request, reply) => {
        applyHlsCorsHeaders(request, reply);
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
            const headers = {
                'User-Agent': request.headers['user-agent'] || 'HLSProxy',
            };

            let contentType = 'application/octet-stream';
            if (fileName.endsWith('.m3u8')) {
                contentType = 'application/vnd.apple.mpegurl';
            } else if (fileName.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (fileName.endsWith('.mp4') || fileName.endsWith('.m4s')) {
                contentType = 'video/mp4';
            }

            if (isTextFile) {
                const response = await fetchTextUpstream({
                    httpClient: state.httpClient,
                    targetUrl,
                    headers,
                });

                if (response.status !== 200) {
                    reply.header('Content-Type', 'text/plain');
                    reply.header('Cache-Control', 'no-cache');
                    return reply.code(response.status).send('');
                }

                reply.header('Content-Type', contentType);
                reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                reply.header('Pragma', 'no-cache');
                reply.header('Expires', '0');
                return reply.send(response.data);
            }

            const { controller, response } = await fetchBinaryUpstream({
                httpClient: state.httpClient,
                targetUrl,
                headers,
                maxRetries: isInitFile ? 3 : 1,
            });

            if (response.status !== 200) {
                cleanupUpstreamResponse({ controller, response });
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');

            attachAbortCleanup({
                request,
                reply,
                controller,
                upstreamStream: response.data,
            }).attach();
            return reply.send(response.data);
        } catch (error) {
            console.error(`[HLSProxy] Error proxying ${fullPath}:`, error.message);
            return reply.code(502).send('');
        }
    });
}


