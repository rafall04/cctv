/*
Purpose: SSRF-safe validation for audio-import URLs. The box sits ON the camera subnet (172.17.x /
         192.168.x) and can reach internal cameras + a cloud metadata endpoint, so an operator-supplied
         URL (fetched by Node, or handed to yt-dlp) MUST be proven public before we open a socket to it.
         Deliberately its own module — outboundUrlPolicy has no private-range block, and rtspUrlPolicy
         ALLOWS RFC1918; neither is safe to reuse here.
Caller: audioImportService.
MainFuncs: assertSafeImportUrl.
SideEffects: performs a DNS lookup (all addresses) to catch a public hostname that resolves private.
*/

import dns from 'dns';
import net from 'net';

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

function ipv4IsPrivate(ip) {
    const p = ip.split('.').map((n) => parseInt(n, 10));
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed -> reject
    const [a, b] = p;
    if (a === 10) return true;                              // 10.0.0.0/8
    if (a === 127) return true;                             // loopback
    if (a === 0) return true;                               // 0.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16
    if (a === 169 && b === 254) return true;                // link-local + 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                              // multicast / reserved
    return false;
}

function ipIsPrivate(ip) {
    if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;                 // loopback / unspecified
    if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true; // link-local + ULA
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);      // IPv4-mapped IPv6
    if (mapped) return ipv4IsPrivate(mapped[1]);
    return false;
}

/**
 * Validate an operator-supplied import URL and classify it.
 * @param {string} raw
 * @returns {Promise<{url: string, kind: 'youtube'|'url', host: string}>}
 * @throws Error with statusCode 400 on any unsafe/invalid URL.
 */
export async function assertSafeImportUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); }
    catch { const e = new Error('URL tidak valid'); e.statusCode = 400; throw e; }

    if (u.protocol !== 'https:') { const e = new Error('URL harus https://'); e.statusCode = 400; throw e; }
    if (u.username || u.password) { const e = new Error('URL tidak boleh memuat kredensial'); e.statusCode = 400; throw e; }

    const host = u.hostname.toLowerCase();
    const kind = YT_HOSTS.has(host) ? 'youtube' : 'url';

    // If the host is a literal IP, check it directly; else resolve ALL addresses and reject if any is private.
    // The validated address(es) are RETURNED so the caller can PIN the socket to them (see pinnedLookup).
    // Without pinning, the fetch re-resolves the hostname independently; a rebinding DNS server (public on
    // THIS lookup, private on the connect lookup a moment later) would defeat the check (TOCTOU). Pinning
    // the validated address into the connection closes that gap — it is the same resolution that validated.
    let addresses;
    if (net.isIP(host)) {
        if (ipIsPrivate(host)) { const e = new Error('Alamat internal tidak diizinkan'); e.statusCode = 400; throw e; }
        addresses = [{ address: host, family: net.isIP(host) }]; // net.isIP -> 4 | 6
    } else {
        let addrs;
        try { addrs = await dns.promises.lookup(host, { all: true }); }
        catch { const e = new Error('Host tidak dapat di-resolve'); e.statusCode = 400; throw e; }
        if (addrs.length === 0 || addrs.some((a) => ipIsPrivate(a.address))) {
            const e = new Error('Host mengarah ke alamat internal'); e.statusCode = 400; throw e;
        }
        addresses = addrs.map((a) => ({ address: a.address, family: a.family }));
    }
    return { url: u.toString(), kind, host, addresses };
}

/**
 * Build a Node dns-style lookup() that returns ONLY the pre-validated addresses. Pass it to
 * https.request({ lookup }) to pin the TCP socket to an address already proven public by
 * assertSafeImportUrl (the SAME resolution that validated it) — so there is no second, unchecked DNS
 * lookup for a rebinding server to poison. TLS SNI + certificate identity still use the real hostname
 * (lookup only decides the socket address), so pinning does NOT weaken cert validation. Build it
 * PER-HOP from that hop's addresses: a redirect to another host must be re-validated and re-pinned.
 */
export function pinnedLookup(addresses) {
    return function lookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (options && options.all) return callback(null, addresses);
        const first = addresses[0];
        return callback(null, first.address, first.family);
    };
}

export default { assertSafeImportUrl, pinnedLookup };
