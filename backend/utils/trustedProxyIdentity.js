/**
 * Purpose: Resolve client IP identity without trusting spoofable proxy headers from untrusted remotes.
 * Caller: live/playback viewer session services and future request identity checks.
 * Deps: config.security.trustedProxyCidrs.
 * MainFuncs: normalizeIp, isTrustedProxy, getTrustedViewerIdentity.
 * SideEffects: None.
 */

import { config } from '../config/config.js';

export function normalizeIp(value) {
    if (!value || typeof value !== 'string') {
        return 'unknown';
    }

    const firstValue = value.split(',')[0]?.trim() || '';
    if (!firstValue) {
        return 'unknown';
    }

    if (firstValue.startsWith('::ffff:')) {
        return firstValue.slice(7);
    }

    return firstValue;
}

function ipToInt(ip) {
    const parts = normalizeIp(ip).split('.');
    if (parts.length !== 4) {
        return null;
    }

    let result = 0;
    for (const part of parts) {
        const value = Number.parseInt(part, 10);
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            return null;
        }
        result = (result << 8) + value;
    }

    return result >>> 0;
}

function ipv4Mask(bits) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
        return 0;
    }

    if (bits === 0) {
        return 0;
    }

    return (0xffffffff << (32 - bits)) >>> 0;
}

export function isTrustedProxy(ip, trustedProxyCidrs = config.security?.trustedProxyCidrs || []) {
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
        const bits = Number.parseInt(bitString, 10);

        if (network.includes(':')) {
            if (bits === 128 && normalizeIp(network) === normalizedIp) {
                return true;
            }
            continue;
        }

        const ipInt = ipToInt(normalizedIp);
        const networkInt = ipToInt(network);
        if (ipInt === null || networkInt === null) {
            continue;
        }

        const mask = ipv4Mask(bits);
        if ((ipInt & mask) === (networkInt & mask)) {
            return true;
        }
    }

    return false;
}

export function getTrustedViewerIdentity(request, trustedProxyCidrs = config.security?.trustedProxyCidrs || []) {
    const remoteIp = normalizeIp(request?.ip || request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress);
    if (isTrustedProxy(remoteIp, trustedProxyCidrs)) {
        const forwardedFor = normalizeIp(request.headers?.['x-forwarded-for']);
        if (forwardedFor !== 'unknown') {
            return forwardedFor;
        }

        const realIp = normalizeIp(request.headers?.['x-real-ip']);
        if (realIp !== 'unknown') {
            return realIp;
        }
    }

    return remoteIp;
}
