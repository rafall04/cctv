/**
 * Purpose: Pin the projections that stand between internal database rows and anonymous visitors.
 * Caller: Vitest backend suite.
 * Deps: a real in-memory SQLite for the SQL-level projections; pure calls for the JS-level ones.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A four-lens sweep of the public surface (2026-08-20) found the same defect shape in six places:
 * a handler that an anonymous caller can reach, reading `SELECT *` (or spreading a whole enriched
 * row) and sending it out. Each one had been hardened once for the field somebody was thinking
 * about that day — a stream_key here, a camera count there — while the rest of the row rode along.
 *
 * The tests below are deliberately written against BEHAVIOUR, not SQL text. Asserting on the query
 * string would pass for a wrong change and fail for a right one; and mocking the database away
 * would be worse still, because on the SQL-level projections the mock IS the thing under test —
 * a stub that returns every column would let a `SELECT *` regression sail through green. So the
 * area test runs the real statement against a real (in-memory) table whose columns match
 * production, and asserts on what comes back.
 *
 * Each `it` states which endpoint it protects, because the projection and the route that needs it
 * live in different files and only one of them is obviously dangerous.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn),
}));

const areaService = (await import('../services/areaService.js')).default;
const { stripInternalStreamFields, PUBLIC_STREAM_INTERNAL_FIELDS } = await import('../services/publicLandingProjection.js');

/*
 * Operating policy: how this backend TALKS to a camera. Not credentials, but a description of the
 * streaming tier's behaviour, which is reconnaissance and has no public consumer. Verified before
 * the fix: zero references to any of these in non-admin frontend code.
 */
const AREA_INTERNAL_COLUMNS = [
    'external_health_mode_override',
    'internal_ingest_policy_default',
    'internal_on_demand_close_after_seconds',
    'internal_rtsp_transport_default',
];

/* What the public map and landing filters genuinely read — removing these would break the UI. */
const AREA_PUBLIC_COLUMNS = [
    'id', 'name', 'slug', 'description',
    'rt', 'rw', 'kelurahan', 'kecamatan',
    'latitude', 'longitude',
    'coverage_scope', 'viewport_zoom_override',
    'show_on_grid_default', 'grid_default_camera_limit',
    'is_access_gated', 'camera_count',
];

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;

        -- Column set mirrors production. A fixture that omitted the internal columns could not
        -- fail, which is the same reason the promo fixture missed camera_class for months.
        CREATE TABLE areas (
            id INTEGER PRIMARY KEY, name TEXT, description TEXT, created_at TEXT,
            rt TEXT, rw TEXT, kelurahan TEXT, kecamatan TEXT,
            latitude REAL, longitude REAL,
            external_health_mode_override TEXT, coverage_scope TEXT,
            viewport_zoom_override INTEGER, show_on_grid_default INTEGER,
            grid_default_camera_limit INTEGER, internal_ingest_policy_default TEXT,
            internal_on_demand_close_after_seconds INTEGER, internal_rtsp_transport_default TEXT,
            slug TEXT, is_access_gated INTEGER
        );
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY, area_id INTEGER, enabled INTEGER,
            camera_class TEXT, is_public INTEGER, billing_status TEXT
        );

        INSERT INTO areas (
            id, name, description, rt, rw, kelurahan, kecamatan, latitude, longitude,
            external_health_mode_override, coverage_scope, viewport_zoom_override,
            show_on_grid_default, grid_default_camera_limit, internal_ingest_policy_default,
            internal_on_demand_close_after_seconds, internal_rtsp_transport_default,
            slug, is_access_gated
        ) VALUES
            (2, 'DANDER', 'Kecamatan Dander', '01', '02', 'Dander', 'Dander',
             -7.2, 111.8, 'probe_only', 'kecamatan', 14, 1, 12, 'always_on', 90, 'tcp',
             'dander', 0);

        INSERT INTO cameras (id, area_id, enabled, camera_class, is_public, billing_status) VALUES
            (11, 2, 1, 'community', 1, NULL),
            (77, 2, 1, 'owner_private', 0, NULL);
    `);
    areaService.invalidateAreaCache();
}

beforeEach(resetSchema);

describe('GET /api/areas/public — proyeksi area', () => {
    const publicAreas = () => areaService.getAllAreas({ publicOnly: true }).areas;

    /*
     * This one was LIVE, not latent: the areas table has rows and the landing page calls this
     * endpoint on every visit, so these values were being published continuously.
     */
    it('tidak menerbitkan kebijakan ingest/health internal ke pengunjung anonim', () => {
        const [area] = publicAreas();

        for (const column of AREA_INTERNAL_COLUMNS) {
            expect(area).not.toHaveProperty(column);
        }
    });

    it('tetap membawa semua kolom yang dipakai peta dan filter landing', () => {
        const [area] = publicAreas();

        for (const column of AREA_PUBLIC_COLUMNS) {
            expect(area).toHaveProperty(column);
        }
    });

    /*
     * Asserted as an exact set, not just "does not contain the four". A negative list only catches
     * the columns someone already thought of; the actual risk of a star-select is the NEXT column a
     * migration adds, which ships publicly with no code change and no review.
     */
    it('membawa PERSIS kumpulan kolom publik, tidak lebih', () => {
        const [area] = publicAreas();

        expect(Object.keys(area).sort()).toEqual([...AREA_PUBLIC_COLUMNS].sort());
    });

    it('varian ADMIN tetap melihat semuanya — gerbangnya publik, bukan fiturnya', () => {
        const [area] = areaService.getAllAreas().areas;

        for (const column of AREA_INTERNAL_COLUMNS) {
            expect(area).toHaveProperty(column);
        }
    });

    /* The count filter was already correct; pinned so a projection edit cannot quietly undo it. */
    it('hitungan kamera publik tetap hanya menghitung kamera community', () => {
        expect(publicAreas()[0].camera_count).toBe(1);
    });
});

describe('GET /api/stream/ — proyeksi stream', () => {
    /*
     * buildCameraResponse destructured private_rtsp_url and stream_key off with a comment
     * explaining why, and shipped everything else. The fields below are the "everything else".
     */
    const enrichedRow = () => ({
        id: 11,
        name: 'CCTV LAPANGAN DANDER',
        is_online: 1,
        availability_state: 'live',
        source_profile: 'sub',
        internal_ingest_policy_override: 'always_on',
        internal_on_demand_close_after_seconds_override: 30,
        internal_on_demand_close_after_seconds: 90,
        area_internal_ingest_policy_default: 'on_demand',
        internal_rtsp_transport_override: 'tcp',
        area_internal_rtsp_transport_default: 'udp',
        last_online_check: '2026-08-20T04:00:00Z',
        monitoring_state: 'healthy',
        health_mode: 'probe',
    });

    it('membuang kebijakan ingest dan routing dari muatan publik', () => {
        const publicRow = stripInternalStreamFields(enrichedRow());

        for (const field of PUBLIC_STREAM_INTERNAL_FIELDS) {
            expect(publicRow).not.toHaveProperty(field);
        }
    });

    it('juga membuang keadaan monitoring — sama seperti daftar landing', () => {
        const publicRow = stripInternalStreamFields(enrichedRow());

        expect(publicRow).not.toHaveProperty('monitoring_state');
        expect(publicRow).not.toHaveProperty('health_mode');
    });

    /* The player needs these; over-stripping would trade a leak for a broken stream list. */
    it('mempertahankan yang dibutuhkan pemutar', () => {
        const publicRow = stripInternalStreamFields(enrichedRow());

        expect(publicRow.id).toBe(11);
        expect(publicRow.name).toBe('CCTV LAPANGAN DANDER');
        expect(publicRow.is_online).toBe(1);
        expect(publicRow.availability_state).toBe('live');
    });

    it('tidak meledak pada masukan yang bukan objek', () => {
        expect(stripInternalStreamFields(null)).toBeNull();
        expect(stripInternalStreamFields(undefined)).toBeUndefined();
    });

    it('tidak mengubah objek aslinya', () => {
        const original = enrichedRow();
        stripInternalStreamFields(original);

        expect(original.source_profile).toBe('sub');
    });
});
