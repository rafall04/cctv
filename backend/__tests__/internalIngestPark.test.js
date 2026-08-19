/**
 * Purpose: Lock the ingest circuit breaker — when MediaMTX may stop dialling a dead camera, and
 *          (far more important) when it may NOT.
 * Caller: Backend Vitest suite.
 * Deps: pure policy only.
 * SideEffects: Mutates process.env.MEDIAMTX_PARK_DEAD_INGEST inside its own tests; always restored.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    INGEST_PARK_AFTER_MS,
    INGEST_PARK_HEALTH_FRESH_MS,
    isIngestParkEnabled,
    shouldParkInternalIngest,
} from '../utils/internalIngestPolicy.js';

const NOW = Date.parse('2026-08-19T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** A camera that is dead, was alive an hour ago, and whose health verdict is current. */
const deadCamera = {
    id: 7,
    is_online: 0,
    last_online_at: iso(60 * 60 * 1000),
    last_health_check_at: iso(60 * 1000),
};

afterEach(() => {
    delete process.env.MEDIAMTX_PARK_DEAD_INGEST;
});

describe('shouldParkInternalIngest', () => {
    it('memarkir kamera yang mati lama dengan vonis health yang masih segar', () => {
        expect(shouldParkInternalIngest(deadCamera, NOW)).toBe(true);
    });

    it('tidak memarkir kamera yang online', () => {
        expect(shouldParkInternalIngest({ ...deadCamera, is_online: 1 }, NOW)).toBe(false);
    });

    it('tidak memarkir kamera yang baru saja mati — mati sebentar itu normal', () => {
        expect(shouldParkInternalIngest({
            ...deadCamera, last_online_at: iso(INGEST_PARK_AFTER_MS - 60_000),
        }, NOW)).toBe(false);
    });

    /*
     * Pengaman terpenting. Sweep health pernah beku 2 hari (2026-08-17) dan mengunci vonis SELURUH
     * armada di nilai basi. Tanpa syarat ini, pembekuan itu akan memarkir semua kamera sekaligus.
     */
    it('TIDAK memarkir apa pun saat health sendiri sudah basi (sweep beku)', () => {
        expect(shouldParkInternalIngest({
            ...deadCamera, last_health_check_at: iso(INGEST_PARK_HEALTH_FRESH_MS + 60_000),
        }, NOW)).toBe(false);

        expect(shouldParkInternalIngest({ ...deadCamera, last_health_check_at: null }, NOW)).toBe(false);
    });

    /* Kamera yang belum pernah online = salah konfigurasi, bukan wedge. Jangan didemosi diam-diam. */
    it('tidak memarkir kamera yang belum pernah sekali pun online', () => {
        expect(shouldParkInternalIngest({ ...deadCamera, last_online_at: null }, NOW)).toBe(false);
    });

    it('tidak tersinggung oleh timestamp rusak', () => {
        for (const bad of ['bukan-tanggal', '', 0]) {
            expect(shouldParkInternalIngest({ ...deadCamera, last_online_at: bad }, NOW)).toBe(false);
            expect(shouldParkInternalIngest({ ...deadCamera, last_health_check_at: bad }, NOW)).toBe(false);
        }
    });

    it('membaca format timestamp SQLite "YYYY-MM-DD HH:MM:SS" maupun ISO', () => {
        const sqliteStyle = new Date(NOW - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        expect(shouldParkInternalIngest({
            ...deadCamera, last_online_at: `${sqliteStyle}Z`,
        }, NOW)).toBe(true);
    });

    it('is_online null/undefined dianggap belum diketahui, bukan mati', () => {
        expect(shouldParkInternalIngest({ ...deadCamera, is_online: null }, NOW)).toBe(false);
        expect(shouldParkInternalIngest({ ...deadCamera, is_online: undefined }, NOW)).toBe(false);
    });

    it('tombol mati fleet-wide mematikan seluruh mekanisme', () => {
        process.env.MEDIAMTX_PARK_DEAD_INGEST = 'off';
        expect(isIngestParkEnabled()).toBe(false);
        expect(shouldParkInternalIngest(deadCamera, NOW)).toBe(false);

        process.env.MEDIAMTX_PARK_DEAD_INGEST = 'on';
        expect(isIngestParkEnabled()).toBe(true);
        expect(shouldParkInternalIngest(deadCamera, NOW)).toBe(true);
    });
});
