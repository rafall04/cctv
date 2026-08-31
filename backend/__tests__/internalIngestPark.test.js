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

    /*
     * REGRESSION: camera_runtime_state writes last_online_at / last_health_check_at as ZONELESS
     * wall-clock in the DISPLAY tz (WIB), not UTC. On the UTC prod process a naive parse read them ~7h
     * in the future, so `now - lastOnline` went negative and a dead camera NEVER parked. With the tz
     * supplied, the zoneless value resolves to the right instant regardless of the test process tz.
     * NOW = 12:00Z = 19:00 WIB, so 18:00 WIB = 11:00Z = 1h ago (dead long enough), 18:59 WIB = 1min ago (health fresh).
     */
    it('menafsirkan health timestamp zoneless sbg wall-clock tz yang diberikan (bukan UTC proses)', () => {
        const wibCamera = {
            ...deadCamera,
            last_online_at: '2026-08-19 18:00:00',
            last_health_check_at: '2026-08-19 18:59:00',
        };
        expect(shouldParkInternalIngest(wibCamera, NOW, { timeZone: 'Asia/Jakarta' })).toBe(true);
        // A different tz resolves the SAME wall-clock to a different instant — proof the tz is applied,
        // not ignored. In WIT (+9) 18:00 = 09:00Z = 3h ago; still dead, but health 18:59 WIT = 09:59Z is
        // ~2h stale (> freshness window) → must NOT park (stale-health guard), unlike the WIB reading.
        expect(shouldParkInternalIngest(wibCamera, NOW, { timeZone: 'Asia/Jayapura' })).toBe(false);
    });

    it('is_online null/undefined dianggap belum diketahui, bukan mati', () => {
        expect(shouldParkInternalIngest({ ...deadCamera, is_online: null }, NOW)).toBe(false);
        expect(shouldParkInternalIngest({ ...deadCamera, is_online: undefined }, NOW)).toBe(false);
    });

    /*
     * REGRESSION (produksi, 2026-08-19): keluar-parkir dulu memakai syarat yang sama dengan
     * masuk-parkir, jadi kamera yang health check-nya melewati jendela kesegaran MEMBATALKAN
     * parkirnya sendiri — MediaMTX memalu lagi, cek berikutnya mendarat, ia parkir lagi.
     * 493 parkir / 464 unpark dalam satu sore, masing-masing dua round-trip API: mekanisme yang
     * dibangun untuk menghentikan churn justru memproduksinya sendiri.
     */
    it('kamera yang SUDAH diparkir tetap diparkir walau health check-nya jadi basi', () => {
        const basi = { ...deadCamera, last_health_check_at: iso(INGEST_PARK_HEALTH_FRESH_MS + 60_000) };

        expect(shouldParkInternalIngest(basi, NOW, { currentlyParked: false })).toBe(false);
        expect(shouldParkInternalIngest(basi, NOW, { currentlyParked: true })).toBe(true);
    });

    it('hanya BUKTI HIDUP yang melepaskan parkir', () => {
        expect(shouldParkInternalIngest(
            { ...deadCamera, is_online: 1 }, NOW, { currentlyParked: true },
        )).toBe(false);
    });

    it('status tak-diketahui bukan bukti apa pun — parkir dipertahankan apa adanya', () => {
        for (const unknown of [null, undefined]) {
            expect(shouldParkInternalIngest({ ...deadCamera, is_online: unknown }, NOW, { currentlyParked: true })).toBe(true);
            expect(shouldParkInternalIngest({ ...deadCamera, is_online: unknown }, NOW, { currentlyParked: false })).toBe(false);
        }
    });

    it('jendela kesegaran harus di ATAS cadence health paling lambat (10 mnt)', () => {
        expect(INGEST_PARK_HEALTH_FRESH_MS).toBeGreaterThan(10 * 60 * 1000);
    });

    it('tombol mati fleet-wide mematikan seluruh mekanisme', () => {
        process.env.MEDIAMTX_PARK_DEAD_INGEST = 'off';
        expect(isIngestParkEnabled()).toBe(false);
        expect(shouldParkInternalIngest(deadCamera, NOW)).toBe(false);
        // Termasuk melepaskan yang sedang terparkir — tombol mati berarti mati.
        expect(shouldParkInternalIngest(deadCamera, NOW, { currentlyParked: true })).toBe(false);

        process.env.MEDIAMTX_PARK_DEAD_INGEST = 'on';
        expect(isIngestParkEnabled()).toBe(true);
        expect(shouldParkInternalIngest(deadCamera, NOW)).toBe(true);
    });
});
