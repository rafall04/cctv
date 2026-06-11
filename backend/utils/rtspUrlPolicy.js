/*
 * Purpose: Validate CUSTOMER-supplied RTSP URLs for self-service camera onboarding.
 * Caller: customerCameraService (create/update own camera).
 * Deps: node:net isIP.
 * MainFuncs: validateCustomerRtspUrl.
 * SideEffects: None.
 *
 * Threat model: the backend (via MediaMTX/FFmpeg) will open a TCP connection to
 * whatever host the customer types — a classic SSRF primitive. RAF NET is an ISP
 * whose customer cameras legitimately live on RFC1918 / carrier private ranges,
 * so we must NOT block those. What we do block:
 *   - non-rtsp(s) schemes,
 *   - loopback / link-local / unspecified / multicast / broadcast literals
 *     (probing the VPS itself or its link), and
 *   - an env blocklist (BILLING_RTSP_BLOCKED_HOSTS, comma-separated exact hosts
 *     or IPv4 prefixes like "172.17.11.") for crown jewels such as the VPS's
 *     own management addresses.
 * Hostnames are allowed as-is (DNS-rebinding-grade attacks are out of scope for
 * v1 and the admin can audit self-added cameras in the camera list).
 */

import { isIP } from 'net';

const MAX_URL_LENGTH = 500;

function parseBlockedHosts() {
    return (process.env.BILLING_RTSP_BLOCKED_HOSTS || 'localhost')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function isBlockedLiteralIp(host) {
    if (isIP(host) === 4) {
        const octets = host.split('.').map(Number);
        if (octets[0] === 127) return true;             // loopback
        if (octets[0] === 0) return true;               // unspecified
        if (octets[0] === 169 && octets[1] === 254) return true; // link-local
        if (octets[0] >= 224) return true;              // multicast/reserved/broadcast
        return false;
    }
    if (isIP(host) === 6) {
        const lower = host.toLowerCase();
        return lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('ff');
    }
    return false;
}

export function validateCustomerRtspUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, message: 'URL RTSP wajib diisi' };
    }
    const url = rawUrl.trim();
    if (url.length > MAX_URL_LENGTH) {
        return { ok: false, message: `URL RTSP maksimal ${MAX_URL_LENGTH} karakter` };
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, message: 'Format URL RTSP tidak valid' };
    }

    if (!['rtsp:', 'rtsps:'].includes(parsed.protocol)) {
        return { ok: false, message: 'URL harus diawali rtsp:// atau rtsps://' };
    }

    const host = (parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) {
        return { ok: false, message: 'URL RTSP harus memuat alamat kamera' };
    }

    if (isBlockedLiteralIp(host)) {
        return { ok: false, message: 'Alamat kamera tidak diizinkan' };
    }

    for (const blocked of parseBlockedHosts()) {
        if (host === blocked || (blocked.endsWith('.') && host.startsWith(blocked))) {
            return { ok: false, message: 'Alamat kamera tidak diizinkan' };
        }
    }

    return { ok: true, url };
}

export default { validateCustomerRtspUrl };
