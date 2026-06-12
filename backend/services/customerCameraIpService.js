/**
 * Purpose: Admin routing aid — list the destination host/IP of every subscriber (customer)
 *          camera so the network team can policy-route that traffic over the ISP broadband
 *          link and keep the dedicated link unburdened. Shows ONLY host/IP (credentials and
 *          path are stripped — RTSP URLs never leave the backend, even for admins).
 * Caller: billingAdminController (GET /api/admin/billing/camera-ips).
 * Deps: connectionPool, node:dns (resolve DDNS hostnames), node:net (isIP classify).
 * MainFuncs: listEndpoints (pure, no DNS), listEndpointsResolved (resolves hostnames),
 *            parseRtspHost, classifyIp.
 * SideEffects: DNS lookups (best-effort, timeout-bounded) in listEndpointsResolved.
 */

import { promises as dns } from 'dns';
import { isIP } from 'net';
import { query } from '../database/connectionPool.js';

const RESOLVE_TIMEOUT_MS = 3000;

/**
 * Classify an IP literal into a routing category:
 *   public    → routable over the internet (the ones to push to broadband)
 *   private   → RFC1918 / IPv6 ULA (LAN — needs a tunnel, not internet-routable)
 *   cgnat     → 100.64/10 carrier-grade NAT (ISP-internal)
 *   loopback / link-local / reserved → not a real camera endpoint
 */
export function classifyIp(ip) {
    const version = isIP(ip);
    if (version === 4) {
        const o = ip.split('.').map(Number);
        if (o[0] === 10) return 'private';
        if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return 'private';
        if (o[0] === 192 && o[1] === 168) return 'private';
        if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return 'cgnat';
        if (o[0] === 127) return 'loopback';
        if (o[0] === 169 && o[1] === 254) return 'link-local';
        if (o[0] === 0 || o[0] >= 224) return 'reserved';
        return 'public';
    }
    if (version === 6) {
        const lower = ip.toLowerCase();
        if (lower === '::1') return 'loopback';
        if (lower.startsWith('fe80:')) return 'link-local';
        if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private'; // ULA
        return 'public';
    }
    return 'unknown';
}

/** Parse host + port from an rtsp(s) URL, dropping credentials and path. */
export function parseRtspHost(rawUrl) {
    try {
        const url = new URL(String(rawUrl));
        const host = (url.hostname || '').replace(/^\[|\]$/g, '');
        if (!host) {
            return null;
        }
        return { host, port: url.port ? Number(url.port) : 554, isLiteral: isIP(host) !== 0 };
    } catch {
        return null;
    }
}

class CustomerCameraIpService {
    /** Pure: subscriber cameras with their RTSP host + classification (literals only; no DNS). */
    listEndpoints() {
        const cameras = query(`
            SELECT c.id, c.name, c.private_rtsp_url, c.billing_status,
                   u.id AS owner_user_id, u.username AS owner_username
            FROM cameras c
            JOIN users u ON u.id = c.owner_user_id
            WHERE c.camera_class = 'subscriber'
            ORDER BY u.username COLLATE NOCASE ASC, c.name COLLATE NOCASE ASC
        `);

        return cameras.map((cam) => {
            const parsed = parseRtspHost(cam.private_rtsp_url);
            const host = parsed?.host || null;
            const ip = host && parsed.isLiteral ? host : null;
            return {
                camera_id: cam.id,
                camera_name: cam.name,
                owner: cam.owner_username,
                owner_user_id: cam.owner_user_id,
                billing_status: cam.billing_status,
                host,
                port: parsed?.port ?? null,
                is_hostname: !!host && !parsed.isLiteral,
                ip,
                kind: ip ? classifyIp(ip) : (host ? 'hostname' : 'invalid'),
            };
        });
    }

    /**
     * Resolve DDNS hostnames to their current IP (best-effort, timeout-bounded) and finalize
     * classification, then build the deduplicated list of PUBLIC IPs for the routing config.
     */
    async listEndpointsResolved() {
        const endpoints = this.listEndpoints();

        await Promise.all(endpoints.map(async (endpoint) => {
            if (!endpoint.is_hostname) {
                return;
            }
            const ip = await this._resolve(endpoint.host);
            if (ip) {
                endpoint.ip = ip;
                endpoint.kind = classifyIp(ip);
            } else {
                endpoint.kind = 'unresolved';
            }
        }));

        const publicIps = [...new Set(
            endpoints.filter((e) => e.kind === 'public' && e.ip).map((e) => e.ip)
        )].sort();

        return {
            endpoints,
            public_ips: publicIps,
            summary: {
                total: endpoints.length,
                public_count: endpoints.filter((e) => e.kind === 'public').length,
                private_count: endpoints.filter((e) => e.kind === 'private' || e.kind === 'cgnat').length,
                unresolved_count: endpoints.filter((e) => e.kind === 'unresolved').length,
            },
        };
    }

    async _resolve(host) {
        let timer;
        try {
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), RESOLVE_TIMEOUT_MS);
            });
            const result = await Promise.race([dns.lookup(host, { family: 0 }), timeout]);
            return result?.address || null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }
}

export default new CustomerCameraIpService();
