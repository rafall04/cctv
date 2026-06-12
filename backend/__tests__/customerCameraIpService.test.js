/**
 * Purpose: Verify the customer-camera IP routing aid — RTSP host extraction (credentials/path
 *          stripped), public/private/CGNAT classification, subscriber-only scoping, and the
 *          deduplicated public-IP list + summary. DNS resolution is exercised only with literal
 *          IPs (no network) so the test stays deterministic.
 * Caller: Backend focused test gate for customerCameraIpService.
 * Deps: vitest, better-sqlite3 (in-memory); mocked connectionPool.
 * MainFuncs: classifyIp / parseRtspHost / listEndpoints / listEndpointsResolved tests.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

import customerCameraIpService, { classifyIp, parseRtspHost } from '../services/customerCameraIpService.js';

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            private_rtsp_url TEXT,
            owner_user_id INTEGER,
            camera_class TEXT NOT NULL DEFAULT 'community',
            billing_status TEXT
        );
        INSERT INTO users (id, username) VALUES (1, 'budi'), (2, 'siti');
    `);
}

describe('classifyIp', () => {
    it('classifies IPv4 ranges', () => {
        expect(classifyIp('36.66.1.2')).toBe('public');
        expect(classifyIp('8.8.8.8')).toBe('public');
        expect(classifyIp('10.0.0.5')).toBe('private');
        expect(classifyIp('172.16.0.1')).toBe('private');
        expect(classifyIp('172.31.255.1')).toBe('private');
        expect(classifyIp('172.32.0.1')).toBe('public'); // just outside RFC1918
        expect(classifyIp('192.168.1.10')).toBe('private');
        expect(classifyIp('100.64.0.1')).toBe('cgnat');
        expect(classifyIp('127.0.0.1')).toBe('loopback');
        expect(classifyIp('169.254.1.1')).toBe('link-local');
        expect(classifyIp('224.0.0.1')).toBe('reserved');
    });

    it('classifies IPv6 and rejects non-IPs', () => {
        expect(classifyIp('::1')).toBe('loopback');
        expect(classifyIp('fe80::1')).toBe('link-local');
        expect(classifyIp('fd00::1')).toBe('private');
        expect(classifyIp('2001:4860:4860::8888')).toBe('public');
        expect(classifyIp('not-an-ip')).toBe('unknown');
    });
});

describe('parseRtspHost', () => {
    it('extracts host + port, dropping credentials and path', () => {
        expect(parseRtspHost('rtsp://admin:secret@36.66.1.2:554/Streaming/Channels/101'))
            .toEqual({ host: '36.66.1.2', port: 554, isLiteral: true });
        expect(parseRtspHost('rtsp://cam.ddns.net/live'))
            .toEqual({ host: 'cam.ddns.net', port: 554, isLiteral: false });
        expect(parseRtspHost('rtsps://[2001:db8::1]:8554/x'))
            .toEqual({ host: '2001:db8::1', port: 8554, isLiteral: true });
    });

    it('returns null for junk', () => {
        expect(parseRtspHost('bukan url')).toBe(null);
        expect(parseRtspHost('')).toBe(null);
        expect(parseRtspHost(null)).toBe(null);
    });
});

describe('customerCameraIpService.listEndpoints', () => {
    beforeEach(() => {
        seedSchema();
    });

    it('lists only subscriber cameras with host/ip/kind, never credentials', () => {
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class, billing_status) VALUES ('Toko', 'rtsp://u:p@36.66.1.2:554/ch1', 1, 'subscriber', 'active')").run();
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class, billing_status) VALUES ('Gudang', 'rtsp://u:p@192.168.1.10/ch1', 1, 'subscriber', 'active')").run();
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, camera_class) VALUES ('Publik', 'rtsp://10.0.0.9/x', 'community')").run(); // excluded

        const list = customerCameraIpService.listEndpoints();
        expect(list).toHaveLength(2);
        const toko = list.find((e) => e.camera_name === 'Toko');
        expect(toko).toMatchObject({ owner: 'budi', host: '36.66.1.2', ip: '36.66.1.2', port: 554, kind: 'public', is_hostname: false });
        // No credential leakage anywhere in the projection.
        expect(JSON.stringify(list)).not.toMatch(/secret|:p@|u:p/);
        expect(list.find((e) => e.camera_name === 'Gudang').kind).toBe('private');
    });

    it('flags hostnames (to be resolved) and invalid URLs', () => {
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('DDNS', 'rtsp://cam.ddns.net:8554/live', 2, 'subscriber')").run();
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('Rusak', 'bukan-url', 2, 'subscriber')").run();

        const list = customerCameraIpService.listEndpoints();
        expect(list.find((e) => e.camera_name === 'DDNS')).toMatchObject({ host: 'cam.ddns.net', is_hostname: true, ip: null, kind: 'hostname', port: 8554 });
        expect(list.find((e) => e.camera_name === 'Rusak')).toMatchObject({ host: null, kind: 'invalid' });
    });
});

describe('customerCameraIpService.listEndpointsResolved (literal IPs, no DNS)', () => {
    beforeEach(() => {
        seedSchema();
    });

    it('dedupes public IPs and summarizes counts', async () => {
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('A', 'rtsp://36.66.1.2:554/1', 1, 'subscriber')").run();
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('B', 'rtsp://36.66.1.2:554/2', 1, 'subscriber')").run(); // same public IP
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('C', 'rtsp://114.5.6.7/3', 2, 'subscriber')").run();
        db.prepare("INSERT INTO cameras (name, private_rtsp_url, owner_user_id, camera_class) VALUES ('D', 'rtsp://192.168.1.5/4', 2, 'subscriber')").run();

        const result = await customerCameraIpService.listEndpointsResolved();
        expect(result.public_ips).toEqual(['114.5.6.7', '36.66.1.2']); // deduped + sorted
        expect(result.summary).toMatchObject({ total: 4, public_count: 3, private_count: 1, unresolved_count: 0 });
    });
});
