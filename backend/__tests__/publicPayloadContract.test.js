/**
 * Purpose: Contract test — pin the EXACT key allowlist each anonymous-facing payload may carry.
 * Caller: Vitest backend suite.
 * Deps: real SQL projections against in-memory SQLite; real strip/build pipeline; mocks only for
 *       infra (cache, health enrichment, access gate, vouchers, vehicle-count).
 *
 * WHY AN ALLOWLIST (the denylist tests already exist)
 * ---------------------------------------------------
 * publicSurfaceProjections.test.js proves known-bad fields are absent. That is a DENYLIST: it can
 * only name the fields somebody already thought about. The recurring defect shape in this codebase
 * is the opposite — a new column (or a `SELECT *` drift) rides through a projection nobody
 * re-audited. An allowlist inverts the guarantee: every key that leaves the building must be named
 * here, so adding a column upstream FAILS this test until a human decides whether the public may
 * see it.
 *
 * The `leak_canary` column is the trip-wire: it exists only in this schema. If either projection
 * ever regresses to `c.*`, the canary value appears in the payload and both assertions catch it.
 *
 * Surfaces pinned:
 *   - GET /api/cameras/active   → cameraService.getPublicLandingCameraList()
 *   - GET /api/stream/:id       → streamService.getStreamUrls()
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

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

vi.mock('../services/cacheService.js', () => ({
    cacheGetOrSetSync: (_key, fn) => fn(),
    cacheInvalidate: vi.fn(),
    cacheKey: (ns, k) => `${ns}:${k}`,
    CacheNamespace: { CAMERAS: 'cameras' },
}));

/*
 * The enrichment shape mirrors cameraHealthService.enrichCameraAvailability: it appends the
 * public availability_* triple AND the internal health_mode/monitoring_* fields that the strip
 * layer must then remove — so this test exercises that removal, not just the happy path.
 */
vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        enrichCameraAvailability: (camera) => ({
            ...camera,
            availability_state: 'online',
            availability_reason: 'healthy',
            availability_confidence: 0.98,
            health_mode: 'default',
            monitoring_state: 'online',
            monitoring_reason: 'health_check_online',
        }),
    },
}));

vi.mock('../services/cameraRuntimeStateService.js', () => ({
    default: { seedMissingRows: () => {}, upsertRuntimeState: () => {} },
}));

// The gate is exercised by publicSurfaceGates.test.js; here it would only decide WHETHER the
// payload builds, not what it contains — stub it open so the contract under test is the shape.
vi.mock('../services/cameraAccessService.js', () => ({
    getAccessInfo: () => ({}),
    canViewLive: () => ({ allowed: true }),
    invalidateCameraAccessCache: () => {},
}));

vi.mock('../services/voucherService.js', () => ({
    default: { isAreaAccessGated: () => false },
}));

vi.mock('../services/vehicleCountService.js', () => ({
    getAnnotatedStreamPath: () => null,
}));

vi.mock('../services/cameraViewStatsService.js', () => ({
    default: {
        getPublicStatsByCamera: () => ({}),
        emptyStats: { live_viewers: 0, total_views: 0, total_watch_seconds: 0, last_viewed_at: null },
    },
}));

// Pinned so the stream-URL shape is a property of the code, not of the dev's .env.
vi.mock('../config/config.js', () => ({
    config: { mediamtx: { hlsUrl: '/hls', webrtcUrl: null, publicBaseUrl: '' }, jwt: { secret: 't' } },
}));

// cameraService-only imports with potential import-time side effects — never exercised by the
// read-model path, so stub them rather than pay for real singletons.
vi.mock('../services/mediaMtxService.js', () => ({ default: {} }));
vi.mock('../services/cameraSourceLifecycleService.js', () => ({ default: {} }));
vi.mock('../services/streamWarmer.js', () => ({ default: {} }));
vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(), logCameraCreated: vi.fn(), logCameraUpdated: vi.fn(), logCameraDeleted: vi.fn(),
}));
vi.mock('../middleware/cacheMiddleware.js', () => ({ invalidateCache: vi.fn() }));

const cameraService = (await import('../services/cameraService.js')).default;
const streamService = (await import('../services/streamService.js')).default;

/*
 * Keys the public may see on GET /api/cameras/active. Adding a key here must be a deliberate
 * decision — the test's job is to force that pause, not to block change.
 */
const LANDING_CAMERA_ALLOWLIST = new Set([
    'id', 'name', 'description', 'location', 'group_name', 'area_id', 'is_tunnel',
    'latitude', 'longitude', 'status', 'enabled', 'enable_recording', 'camera_class',
    'video_codec', 'thumbnail_path', 'thumbnail_updated_at', 'stream_source',
    'external_hls_url', 'delivery_type', 'external_stream_url', 'external_embed_url',
    'external_snapshot_url', 'external_origin_mode', 'external_use_proxy', 'external_tls_mode',
    'area_name', 'live_viewers', 'total_views', 'is_online', 'viewer_stats',
    'availability_state', 'availability_reason', 'availability_confidence',
]);

// GET /api/stream/:id top-level response envelope.
const STREAM_TOP_ALLOWLIST = new Set([
    'camera', 'streams', 'stream_source', 'delivery_type', 'stream_capabilities',
    'external_use_proxy', 'external_tls_mode', 'external_stream_url', 'external_embed_url',
    'external_snapshot_url', 'external_origin_mode',
    'availability_state', 'availability_reason', 'availability_confidence',
]);

// The nested `camera` card inside that envelope.
const STREAM_CAMERA_ALLOWLIST = new Set([
    'id', 'name', 'description', 'location', 'group_name', 'area_id', 'area_name',
    'is_tunnel', 'latitude', 'longitude', 'video_codec', 'rt', 'rw', 'kelurahan', 'kecamatan',
    'availability_state', 'availability_reason', 'availability_confidence',
    'external_use_proxy', 'external_tls_mode', 'delivery_type', 'stream_capabilities',
    'external_stream_url', 'external_embed_url', 'external_snapshot_url', 'external_origin_mode',
]);

const CANARY_VALUE = 'CANARY-LEAK-777';

beforeAll(() => {
    db.exec(`
        CREATE TABLE areas (
            id INTEGER PRIMARY KEY,
            name TEXT,
            rt TEXT, rw TEXT, kelurahan TEXT, kecamatan TEXT,
            internal_ingest_policy_default TEXT,
            internal_on_demand_close_after_seconds INTEGER,
            external_health_mode_override TEXT
        );
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            name TEXT, description TEXT, location TEXT, group_name TEXT,
            area_id INTEGER, is_tunnel INTEGER, latitude REAL, longitude REAL,
            status TEXT, enabled INTEGER, enable_recording INTEGER,
            camera_class TEXT, is_public INTEGER, billing_status TEXT,
            video_codec TEXT, thumbnail_path TEXT, thumbnail_updated_at TEXT,
            stream_source TEXT, delivery_type TEXT,
            private_rtsp_url TEXT, stream_key TEXT,
            external_hls_url TEXT, external_stream_url TEXT,
            external_embed_url TEXT, external_snapshot_url TEXT,
            external_origin_mode TEXT, external_use_proxy INTEGER, external_tls_mode TEXT,
            external_health_mode TEXT,
            public_playback_mode TEXT, public_playback_preview_minutes INTEGER,
            internal_ingest_policy_override TEXT,
            internal_on_demand_close_after_seconds_override INTEGER,
            source_profile TEXT,
            is_online INTEGER, last_online_check TEXT,
            owner_user_id INTEGER,
            leak_canary TEXT
        );
        CREATE TABLE camera_runtime_state (
            camera_id INTEGER PRIMARY KEY,
            is_online INTEGER, monitoring_state TEXT, monitoring_reason TEXT,
            last_runtime_signal_at TEXT, last_runtime_signal_type TEXT,
            last_health_check_at TEXT, updated_at TEXT
        );
        CREATE TABLE camera_view_stats (
            camera_id INTEGER PRIMARY KEY, total_live_views INTEGER
        );
        CREATE TABLE viewer_sessions (
            id INTEGER PRIMARY KEY, camera_id INTEGER, is_active INTEGER
        );
    `);

    db.prepare(`INSERT INTO areas (id, name, rt, rw, kelurahan, kecamatan,
                internal_ingest_policy_default, internal_on_demand_close_after_seconds,
                external_health_mode_override)
            VALUES (10, 'Kediri Kota', '01', '02', 'Kel', 'Kec', 'default', 30, 'default')`).run();

    const insertCamera = db.prepare(`
        INSERT INTO cameras (id, name, description, location, group_name, area_id, is_tunnel,
            latitude, longitude, status, enabled, enable_recording, camera_class, is_public,
            billing_status, video_codec, thumbnail_path, thumbnail_updated_at, stream_source,
            delivery_type, private_rtsp_url, stream_key, external_hls_url, external_stream_url,
            external_embed_url, external_snapshot_url, external_origin_mode, external_use_proxy,
            external_tls_mode, external_health_mode, public_playback_mode,
            public_playback_preview_minutes, internal_ingest_policy_override,
            internal_on_demand_close_after_seconds_override, source_profile, is_online,
            last_online_check, owner_user_id, leak_canary)
        VALUES (@id, @name, 'desc', 'loc', 'grp', 10, 0, -7.8, 112.0, 'active', 1, 1,
            @camera_class, 0, 'active', 'h264', '/api/thumbnails/cam1.jpg', '2026-09-21',
            'internal', 'internal_hls', 'rtsp://admin:canary@10.0.0.9:554/stream1',
            'sekrit_stream_key_9', NULL, NULL, NULL, NULL, 'direct', 1, 'strict', 'default',
            'inherit', NULL, 'default', NULL, 'default', 1, '2026-09-21', 42, '${CANARY_VALUE}')`);

    insertCamera.run({ id: 1, name: 'Balai Kota', camera_class: 'community' });
    insertCamera.run({ id: 2, name: 'Privat Owner', camera_class: 'owner_private' });

    db.prepare(`INSERT INTO camera_runtime_state (camera_id, is_online, monitoring_state,
                monitoring_reason, updated_at) VALUES (1, 1, 'online', 'ok', '2026-09-21')`).run();
    db.prepare('INSERT INTO camera_view_stats (camera_id, total_live_views) VALUES (1, 150)').run();
    db.prepare('INSERT INTO viewer_sessions (camera_id, is_active) VALUES (1, 1), (1, 1)').run();
});

// Every serialized string the client receives, flattened — catches a leak nested under an
// allowlisted key (e.g. a future `camera.streams` carrying the raw RTSP path).
const serialized = (payload) => JSON.stringify(payload);

describe('kontrak payload publik — allowlist field per surface', () => {
    it('GET /api/cameras/active: setiap kunci kamera ada di allowlist', () => {
        const list = cameraService.getPublicLandingCameraList();
        expect(list.length).toBe(1); // owner_private tersaring PUBLIC_LIVE_SQL

        for (const camera of list) {
            for (const key of Object.keys(camera)) {
                expect(LANDING_CAMERA_ALLOWLIST.has(key), `unexpected key "${key}"`).toBe(true);
            }
            // Kunci wajib — kontrak juga gagal kalau field publik hilang.
            for (const key of ['id', 'name', 'is_online', 'availability_state', 'viewer_stats']) {
                expect(camera).toHaveProperty(key);
            }
        }
    });

    it('GET /api/cameras/active: tidak ada nilai internal/canary yang bocor di payload', () => {
        const list = cameraService.getPublicLandingCameraList();
        const body = serialized(list);
        expect(body).not.toContain('rtsp://');
        expect(body).not.toContain('sekrit_stream_key_9');
        expect(body).not.toContain(CANARY_VALUE);
        expect(body).not.toContain('stream_key');
        expect(body).not.toContain('private_rtsp_url');
        expect(body).not.toContain('leak_canary');
    });

    it('GET /api/stream/:id: kunci envelope dan kamera nested ada di allowlist', () => {
        const payload = streamService.getStreamUrls(1, 'cctv.raf.my.id');

        for (const key of Object.keys(payload)) {
            expect(STREAM_TOP_ALLOWLIST.has(key), `unexpected top-level key "${key}"`).toBe(true);
        }
        for (const key of Object.keys(payload.camera)) {
            expect(STREAM_CAMERA_ALLOWLIST.has(key), `unexpected camera key "${key}"`).toBe(true);
        }
        expect(payload.camera.id).toBe(1);
        expect(payload.streams.hls).toMatch(/^\/hls\//);
    });

    it('GET /api/stream/:id: tidak ada nilai internal/canary yang bocor di payload', () => {
        const body = serialized(streamService.getStreamUrls(1, 'cctv.raf.my.id'));
        expect(body).not.toContain('rtsp://');
        expect(body).not.toContain(CANARY_VALUE);
        expect(body).not.toContain('private_rtsp_url');
        expect(body).not.toContain('leak_canary');
        // stream_key sebagai KEY dilarang; nilainya memang disematkan di path /hls/<key>/
        // (by design — HLS tidak bisa dimainkan tanpa path identifier itu).
        expect(body).not.toContain('"stream_key"');
    });
});
