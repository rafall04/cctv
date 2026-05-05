<!--
Purpose: Implementation plan for public area SEO pages, trending CCTV, and branded sharing.
Caller: Agents implementing docs/superpowers/specs/2026-05-06-public-growth-foundation-design.md.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, backend/.module_map.md, existing public camera/view stats flows.
MainFuncs: Defines task sequence, file ownership, verification commands, and commit boundaries.
SideEffects: Documentation only.
-->

# Public Growth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public area pages, trending CCTV surfaces, and branded share helpers without exposing private stream data or breaking existing public/admin routes.

**Architecture:** Backend exposes sanitized public growth endpoints under `/api/public/*`, backed by focused controller/service units and existing camera/view stats tables. Frontend adds a public area route and small reusable growth components/services that reuse existing camera cards and video popup behavior. Metadata/share helpers stay pure so they can be tested without booting the whole app.

**Tech Stack:** Node.js 20+, Fastify, SQLite/better-sqlite3, React 18, Vite, Tailwind CSS, Vitest.

---

## File Structure

- Create `backend/services/publicGrowthService.js`: public area lookup, sanitized camera listing, trending camera queries.
- Create `backend/controllers/publicGrowthController.js`: request parsing and `{ success, data }` responses.
- Create `backend/routes/publicGrowthRoutes.js`: route wiring only.
- Modify `backend/server.js`: register `publicGrowthRoutes` with prefix `/api/public`.
- Create `backend/__tests__/publicGrowthService.test.js`: service sanitization and trending tests.
- Create `backend/__tests__/publicGrowthRoutes.test.js`: public endpoint behavior tests.
- Create `frontend/src/services/publicGrowthService.js`: public API wrapper.
- Create `frontend/src/utils/publicGrowthShare.js`: pure share text/link builders.
- Create `frontend/src/components/landing/LandingTrendingCameras.jsx`: compact top-viewed section.
- Create `frontend/src/pages/AreaPublicPage.jsx`: `/area/:areaSlug` page.
- Modify `frontend/src/App.jsx`: lazy route for `/area/:areaSlug`.
- Modify `frontend/src/pages/LandingPage.jsx`: load/render global trending section.
- Modify `frontend/src/.module_map.md` and `backend/.module_map.md`: document new public growth flow.
- Create/modify focused frontend tests:
  - `frontend/src/services/publicGrowthService.test.js`
  - `frontend/src/utils/publicGrowthShare.test.js`
  - `frontend/src/components/landing/LandingTrendingCameras.test.jsx`
  - `frontend/src/pages/AreaPublicPage.test.jsx`

## Task 1: Skeleton And Route Registration

**Files:**
- Create: `backend/services/publicGrowthService.js`
- Create: `backend/controllers/publicGrowthController.js`
- Create: `backend/routes/publicGrowthRoutes.js`
- Create: `frontend/src/services/publicGrowthService.js`
- Create: `frontend/src/utils/publicGrowthShare.js`
- Create: `frontend/src/components/landing/LandingTrendingCameras.jsx`
- Create: `frontend/src/pages/AreaPublicPage.jsx`
- Modify: `backend/server.js`
- Modify: `frontend/src/App.jsx`

- [x] **Step 1: Add backend skeleton files**

Create `backend/services/publicGrowthService.js` with this skeleton:

```js
/**
 * Purpose: Build sanitized public growth read models for area pages and trending CCTV.
 * Caller: publicGrowthController and public growth route tests.
 * Deps: database connection helpers.
 * MainFuncs: getPublicAreaBySlug, getPublicAreaCameras, getTrendingCameras.
 * SideEffects: Reads public camera, area, runtime, and compact view stats data.
 */

export function getPublicAreaBySlug(areaSlug) {
    throw new Error('getPublicAreaBySlug not implemented');
}

export function getPublicAreaCameras(areaSlug) {
    throw new Error('getPublicAreaCameras not implemented');
}

export function getTrendingCameras({ areaSlug = '', limit = 10 } = {}) {
    throw new Error('getTrendingCameras not implemented');
}
```

Create `backend/controllers/publicGrowthController.js`:

```js
/**
 * Purpose: Handle public growth API responses for area pages and trending CCTV.
 * Caller: backend/routes/publicGrowthRoutes.js.
 * Deps: publicGrowthService.
 * MainFuncs: getPublicArea, getPublicAreaCameras, getPublicTrendingCameras.
 * SideEffects: Reads sanitized public CCTV data.
 */

import {
    getPublicAreaBySlug,
    getPublicAreaCameras as getPublicAreaCamerasData,
    getTrendingCameras,
} from '../services/publicGrowthService.js';

export async function getPublicArea(request, reply) {
    const data = getPublicAreaBySlug(request.params.slug);
    return reply.send({ success: true, data });
}

export async function getPublicAreaCameras(request, reply) {
    const data = getPublicAreaCamerasData(request.params.slug);
    return reply.send({ success: true, data });
}

export async function getPublicTrendingCameras(request, reply) {
    const data = getTrendingCameras({
        areaSlug: request.query?.areaSlug || '',
        limit: request.query?.limit,
    });
    return reply.send({ success: true, data });
}
```

Create `backend/routes/publicGrowthRoutes.js`:

```js
/**
 * Purpose: Register public growth endpoints for area pages and trending CCTV.
 * Caller: backend/server.js route bootstrap.
 * Deps: publicGrowthController and cacheMiddleware.
 * MainFuncs: publicGrowthRoutes.
 * SideEffects: Adds public cached read-only Fastify routes.
 */

import {
    getPublicArea,
    getPublicAreaCameras,
    getPublicTrendingCameras,
} from '../controllers/publicGrowthController.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';

export default async function publicGrowthRoutes(fastify) {
    fastify.get('/areas/:slug', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicArea,
    });

    fastify.get('/areas/:slug/cameras', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicAreaCameras,
    });

    fastify.get('/trending-cameras', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicTrendingCameras,
    });
}
```

- [x] **Step 2: Register backend route**

In `backend/server.js`, add import near other routes:

```js
import publicGrowthRoutes from './routes/publicGrowthRoutes.js';
```

Register after settings/config public routes and before viewer routes:

```js
await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });
```

- [x] **Step 3: Add frontend skeleton files**

Create `frontend/src/services/publicGrowthService.js`:

```js
/*
 * Purpose: Fetch public growth data for area pages and trending CCTV.
 * Caller: AreaPublicPage and landing growth components.
 * Deps: apiClient.
 * MainFuncs: publicGrowthService.getArea, getAreaCameras, getTrendingCameras.
 * SideEffects: Performs public GET requests.
 */

import apiClient from './apiClient';

const publicRequestConfig = {
    skipGlobalErrorNotification: true,
    skipAuthRefresh: true,
};

export const publicGrowthService = {
    async getArea(slug) {
        const response = await apiClient.get(`/api/public/areas/${encodeURIComponent(slug)}`, publicRequestConfig);
        return response.data;
    },

    async getAreaCameras(slug) {
        const response = await apiClient.get(`/api/public/areas/${encodeURIComponent(slug)}/cameras`, publicRequestConfig);
        return response.data;
    },

    async getTrendingCameras({ areaSlug = '', limit = 10 } = {}) {
        const response = await apiClient.get('/api/public/trending-cameras', {
            ...publicRequestConfig,
            params: { areaSlug, limit },
        });
        return response.data;
    },
};

export default publicGrowthService;
```

Create `frontend/src/utils/publicGrowthShare.js`:

```js
/*
 * Purpose: Build branded public CCTV share URLs and text for areas and cameras.
 * Caller: AreaPublicPage, LandingTrendingCameras, and public share buttons.
 * Deps: Browser URL APIs.
 * MainFuncs: buildAreaShareText, buildCameraShareText, buildAreaUrl, buildCameraUrl.
 * SideEffects: None.
 */

export function buildAreaUrl(slug, origin = window.location.origin) {
    return `${origin}/area/${encodeURIComponent(slug)}`;
}

export function buildCameraUrl(camera, origin = window.location.origin) {
    const areaSlug = camera.area_slug || camera.areaSlug || 'all';
    const baseUrl = buildAreaUrl(areaSlug, origin);
    return `${baseUrl}?camera=${encodeURIComponent(camera.id)}`;
}

export function buildAreaShareText(area, origin = window.location.origin) {
    const url = buildAreaUrl(area.slug, origin);
    return `CCTV Online ${area.name} - RAF NET\nPantau kamera publik area ${area.name}:\n${url}`;
}

export function buildCameraShareText(camera, origin = window.location.origin) {
    const url = buildCameraUrl(camera, origin);
    const areaName = camera.area_name || camera.areaName || 'Area publik';
    return `CCTV ${camera.name} - RAF NET\nArea: ${areaName}\nLive: ${url}`;
}
```

Create `frontend/src/components/landing/LandingTrendingCameras.jsx`:

```jsx
/*
 * Purpose: Render a compact public top-viewed CCTV strip for landing and area pages.
 * Caller: LandingPage and AreaPublicPage.
 * Deps: LandingCameraCard-style camera data and public share helpers.
 * MainFuncs: LandingTrendingCameras.
 * SideEffects: Invokes caller-provided camera click/share handlers.
 */

export default function LandingTrendingCameras({
    cameras = [],
    title = 'CCTV Paling Banyak Ditonton',
    loading = false,
    onCameraClick,
}) {
    if (loading) {
        return <section data-testid="trending-loading" className="mx-auto max-w-7xl px-4 py-4" />;
    }

    if (!cameras.length) {
        return null;
    }

    return (
        <section data-testid="trending-cameras" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cameras.map((camera) => (
                    <button
                        key={camera.id}
                        type="button"
                        onClick={() => onCameraClick?.(camera)}
                        className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-primary/60 dark:border-gray-800 dark:bg-gray-900"
                    >
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                        <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{camera.area_name || camera.location || 'Area publik'}</div>
                        <div className="mt-2 text-xs font-medium text-primary">{Number(camera.total_views || 0).toLocaleString('id-ID')}x ditonton</div>
                    </button>
                ))}
            </div>
        </section>
    );
}
```

Create `frontend/src/pages/AreaPublicPage.jsx`:

```jsx
/*
 * Purpose: Render public area-specific CCTV pages with trending, grid, and share entry points.
 * Caller: App route /area/:areaSlug.
 * Deps: React Router, publicGrowthService, publicGrowthShare, landing components.
 * MainFuncs: AreaPublicPage.
 * SideEffects: Fetches public area/camera data and updates document metadata.
 */

export default function AreaPublicPage() {
    return (
        <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
            <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                <h1 className="text-2xl font-bold">Area CCTV</h1>
            </div>
        </main>
    );
}
```

- [x] **Step 4: Register frontend route**

In `frontend/src/App.jsx`, add lazy import:

```js
const AreaPublicPage = lazyWithRetry(() => import('./pages/AreaPublicPage'), 'area-public-page');
```

Add public route after `/`:

```jsx
<Route path="/area/:areaSlug" element={
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
        <AreaPublicPage />
    </Suspense>
} />
```

- [x] **Step 5: Run skeleton build checks**

Run:

```bash
cd backend
npm test -- publicGrowthRoutes.test.js
```

Expected: test file may not exist yet, so Vitest reports no matching tests. This is acceptable only for skeleton gate.

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

- [x] **Step 6: Commit skeleton**

```bash
git add backend/services/publicGrowthService.js backend/controllers/publicGrowthController.js backend/routes/publicGrowthRoutes.js backend/server.js frontend/src/services/publicGrowthService.js frontend/src/utils/publicGrowthShare.js frontend/src/components/landing/LandingTrendingCameras.jsx frontend/src/pages/AreaPublicPage.jsx frontend/src/App.jsx
git commit -m "Add: public growth feature skeleton"
git push
```

## Task 2: Backend Public Growth Data

**Files:**
- Modify: `backend/services/publicGrowthService.js`
- Modify: `backend/controllers/publicGrowthController.js`
- Test: `backend/__tests__/publicGrowthService.test.js`
- Test: `backend/__tests__/publicGrowthRoutes.test.js`

- [x] **Step 1: Write service tests**

Create `backend/__tests__/publicGrowthService.test.js`:

```js
/**
 * Purpose: Verify public growth read models are sanitized and ordered correctly.
 * Caller: Backend focused public growth test gate.
 * Deps: vitest, mocked connectionPool, publicGrowthService.
 * MainFuncs: Public area, camera sanitization, and trending tests.
 * SideEffects: Mocks database reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('publicGrowthService', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('returns a public area by slug with computed counts', async () => {
        queryOneMock.mockReturnValue({
            id: 7,
            name: 'KAB SURABAYA',
            slug: 'kab-surabaya',
            camera_count: 2,
            online_count: 1,
            total_views: 12,
        });

        const service = await import('../services/publicGrowthService.js');
        expect(service.getPublicAreaBySlug('kab-surabaya')).toEqual({
            id: 7,
            name: 'KAB SURABAYA',
            slug: 'kab-surabaya',
            camera_count: 2,
            online_count: 1,
            total_views: 12,
            description: 'Pantau CCTV publik area KAB SURABAYA secara online melalui RAF NET.',
        });
    });

    it('does not expose private camera source fields', async () => {
        queryOneMock.mockReturnValue({ id: 7, name: 'KAB SURABAYA', slug: 'kab-surabaya' });
        queryMock.mockReturnValue([
            {
                id: 1,
                name: 'CCTV A',
                area_name: 'KAB SURABAYA',
                area_slug: 'kab-surabaya',
                location: 'Jalan A',
                status: 'online',
                stream_path: 'abc/index.m3u8',
                rtsp_url: 'rtsp://admin:secret@10.0.0.1',
                username: 'admin',
                password: 'secret',
                total_views: 9,
                live_viewers: 1,
            },
        ]);

        const service = await import('../services/publicGrowthService.js');
        const cameras = service.getPublicAreaCameras('kab-surabaya');

        expect(cameras).toHaveLength(1);
        expect(cameras[0]).toMatchObject({
            id: 1,
            name: 'CCTV A',
            area_name: 'KAB SURABAYA',
            area_slug: 'kab-surabaya',
            total_views: 9,
            live_viewers: 1,
        });
        expect(cameras[0]).not.toHaveProperty('rtsp_url');
        expect(cameras[0]).not.toHaveProperty('username');
        expect(cameras[0]).not.toHaveProperty('password');
    });

    it('limits trending cameras and filters by area slug', async () => {
        queryMock.mockReturnValue([{ id: 1, name: 'CCTV A', total_views: 30 }]);
        const service = await import('../services/publicGrowthService.js');

        expect(service.getTrendingCameras({ areaSlug: 'kab-surabaya', limit: 4 })).toEqual([
            expect.objectContaining({ id: 1, name: 'CCTV A', total_views: 30 }),
        ]);
        expect(queryMock.mock.calls[0][1]).toEqual(['kab-surabaya', 4]);
    });
});
```

- [x] **Step 2: Implement service**

Replace `backend/services/publicGrowthService.js` with:

```js
/**
 * Purpose: Build sanitized public growth read models for area pages and trending CCTV.
 * Caller: publicGrowthController and public growth route tests.
 * Deps: database connection helpers.
 * MainFuncs: getPublicAreaBySlug, getPublicAreaCameras, getTrendingCameras.
 * SideEffects: Reads public camera, area, runtime, and compact view stats data.
 */

import { query, queryOne } from '../database/connectionPool.js';

const PUBLIC_CAMERA_COLUMNS = `
    c.id,
    c.name,
    c.location,
    c.status,
    c.stream_path,
    c.external_hls_url,
    c.external_embed_url,
    c.external_snapshot_url,
    c.thumbnail_path,
    c.delivery_type,
    c.is_tunnel,
    c.latitude,
    c.longitude,
    c.video_codec,
    c.enable_recording,
    c.is_recording,
    a.name AS area_name,
    LOWER(REPLACE(a.name, ' ', '-')) AS area_slug,
    COALESCE(cvs.total_views, 0) AS total_views,
    COALESCE(cvs.live_viewers, 0) AS live_viewers
`;

function normalizeLimit(limit) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isNaN(parsed)) return 10;
    return Math.min(Math.max(parsed, 1), 20);
}

function toAreaSlug(name = '') {
    return String(name).trim().toLowerCase().replace(/\s+/g, '-');
}

function assertArea(row, slug) {
    if (!row) {
        const error = new Error(`Area ${slug} tidak ditemukan`);
        error.statusCode = 404;
        throw error;
    }
}

function sanitizeCamera(row) {
    return {
        id: row.id,
        name: row.name,
        location: row.location,
        status: row.status,
        stream_path: row.stream_path,
        external_hls_url: row.external_hls_url,
        external_embed_url: row.external_embed_url,
        external_snapshot_url: row.external_snapshot_url,
        thumbnail_path: row.thumbnail_path,
        delivery_type: row.delivery_type,
        is_tunnel: row.is_tunnel,
        latitude: row.latitude,
        longitude: row.longitude,
        video_codec: row.video_codec,
        enable_recording: row.enable_recording,
        is_recording: row.is_recording,
        area_name: row.area_name,
        area_slug: row.area_slug || toAreaSlug(row.area_name),
        total_views: Number(row.total_views || 0),
        live_viewers: Number(row.live_viewers || 0),
    };
}

export function getPublicAreaBySlug(areaSlug) {
    const row = queryOne(`
        SELECT
            a.id,
            a.name,
            LOWER(REPLACE(a.name, ' ', '-')) AS slug,
            COUNT(c.id) AS camera_count,
            SUM(CASE WHEN c.status = 'online' THEN 1 ELSE 0 END) AS online_count,
            COALESCE(SUM(cvs.total_views), 0) AS total_views
        FROM areas a
        LEFT JOIN cameras c ON c.area_id = a.id AND c.is_active = 1 AND c.public_enabled = 1
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        WHERE LOWER(REPLACE(a.name, ' ', '-')) = ?
        GROUP BY a.id
    `, [areaSlug]);

    assertArea(row, areaSlug);

    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        camera_count: Number(row.camera_count || 0),
        online_count: Number(row.online_count || 0),
        total_views: Number(row.total_views || 0),
        description: `Pantau CCTV publik area ${row.name} secara online melalui RAF NET.`,
    };
}

export function getPublicAreaCameras(areaSlug) {
    const area = queryOne(`
        SELECT id, name, LOWER(REPLACE(name, ' ', '-')) AS slug
        FROM areas
        WHERE LOWER(REPLACE(name, ' ', '-')) = ?
    `, [areaSlug]);
    assertArea(area, areaSlug);

    return query(`
        SELECT ${PUBLIC_CAMERA_COLUMNS}
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        WHERE c.is_active = 1
          AND c.public_enabled = 1
          AND LOWER(REPLACE(a.name, ' ', '-')) = ?
        ORDER BY c.name COLLATE NOCASE ASC
    `, [areaSlug]).map(sanitizeCamera);
}

export function getTrendingCameras({ areaSlug = '', limit = 10 } = {}) {
    const normalizedLimit = normalizeLimit(limit);
    const params = areaSlug ? [areaSlug, normalizedLimit] : [normalizedLimit];
    const areaFilter = areaSlug ? "AND LOWER(REPLACE(a.name, ' ', '-')) = ?" : '';

    return query(`
        SELECT ${PUBLIC_CAMERA_COLUMNS}
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        WHERE c.is_active = 1
          AND c.public_enabled = 1
          ${areaFilter}
        ORDER BY COALESCE(cvs.total_views, 0) DESC, c.name COLLATE NOCASE ASC, c.id ASC
        LIMIT ?
    `, params).map(sanitizeCamera);
}
```

- [x] **Step 3: Harden controller errors**

Update `backend/controllers/publicGrowthController.js` handlers to catch service errors:

```js
function sendError(reply, error, fallbackMessage) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
        success: false,
        message: statusCode === 500 ? fallbackMessage : error.message,
    });
}
```

Each handler should wrap service calls in `try/catch` and call `sendError(reply, error, 'Internal server error')`.

- [x] **Step 4: Write route tests**

Create `backend/__tests__/publicGrowthRoutes.test.js`:

```js
/**
 * Purpose: Verify public growth endpoints respond without admin authentication.
 * Caller: Backend focused public growth route test gate.
 * Deps: Fastify, vitest, publicGrowthRoutes.
 * MainFuncs: Public route behavior tests.
 * SideEffects: Mocks publicGrowthService.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPublicAreaBySlugMock = vi.fn();
const getPublicAreaCamerasMock = vi.fn();
const getTrendingCamerasMock = vi.fn();

vi.mock('../services/publicGrowthService.js', () => ({
    getPublicAreaBySlug: getPublicAreaBySlugMock,
    getPublicAreaCameras: getPublicAreaCamerasMock,
    getTrendingCameras: getTrendingCamerasMock,
}));

describe('publicGrowthRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        getPublicAreaBySlugMock.mockReset();
        getPublicAreaCamerasMock.mockReset();
        getTrendingCamerasMock.mockReset();
    });

    it('serves public area data without auth', async () => {
        getPublicAreaBySlugMock.mockReturnValue({ name: 'KAB SURABAYA', slug: 'kab-surabaya' });
        const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
        const fastify = Fastify();
        await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });

        const response = await fastify.inject({ method: 'GET', url: '/api/public/areas/kab-surabaya' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, data: { slug: 'kab-surabaya' } });
        await fastify.close();
    });

    it('returns 404 for unknown public area', async () => {
        const error = new Error('Area hilang tidak ditemukan');
        error.statusCode = 404;
        getPublicAreaBySlugMock.mockImplementation(() => { throw error; });
        const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
        const fastify = Fastify();
        await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });

        const response = await fastify.inject({ method: 'GET', url: '/api/public/areas/hilang' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ success: false, message: 'Area hilang tidak ditemukan' });
        await fastify.close();
    });
});
```

- [x] **Step 5: Run backend focused tests**

```bash
cd backend
npm test -- publicGrowthService.test.js publicGrowthRoutes.test.js
```

Expected: all tests PASS.

- [x] **Step 6: Commit backend data layer**

```bash
git add backend/services/publicGrowthService.js backend/controllers/publicGrowthController.js backend/routes/publicGrowthRoutes.js backend/__tests__/publicGrowthService.test.js backend/__tests__/publicGrowthRoutes.test.js
git commit -m "Add: public growth read endpoints"
git push
```

## Task 3: Frontend Share Helpers And API Wrapper

**Files:**
- Modify: `frontend/src/services/publicGrowthService.js`
- Modify: `frontend/src/utils/publicGrowthShare.js`
- Test: `frontend/src/services/publicGrowthService.test.js`
- Test: `frontend/src/utils/publicGrowthShare.test.js`

- [x] **Step 1: Write share helper tests**

Create `frontend/src/utils/publicGrowthShare.test.js`:

```js
/*
 * Purpose: Verify public CCTV branded share helper output.
 * Caller: Frontend focused public growth utility test gate.
 * Deps: vitest, publicGrowthShare.
 * MainFuncs: Area and camera share text tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { buildAreaShareText, buildAreaUrl, buildCameraShareText, buildCameraUrl } from './publicGrowthShare';

describe('publicGrowthShare', () => {
    it('builds stable area URLs', () => {
        expect(buildAreaUrl('kab-surabaya', 'https://cctv.raf.my.id')).toBe('https://cctv.raf.my.id/area/kab-surabaya');
    });

    it('builds branded area share text', () => {
        expect(buildAreaShareText({ name: 'KAB SURABAYA', slug: 'kab-surabaya' }, 'https://cctv.raf.my.id')).toBe(
            'CCTV Online KAB SURABAYA - RAF NET\nPantau kamera publik area KAB SURABAYA:\nhttps://cctv.raf.my.id/area/kab-surabaya'
        );
    });

    it('builds camera share URLs and text', () => {
        const camera = { id: 1168, name: 'CCTV ALANG', area_name: 'KAB SURABAYA', area_slug: 'kab-surabaya' };
        expect(buildCameraUrl(camera, 'https://cctv.raf.my.id')).toBe('https://cctv.raf.my.id/area/kab-surabaya?camera=1168');
        expect(buildCameraShareText(camera, 'https://cctv.raf.my.id')).toContain('CCTV CCTV ALANG - RAF NET');
    });
});
```

- [x] **Step 2: Write API wrapper tests**

Create `frontend/src/services/publicGrowthService.test.js`:

```js
/*
 * Purpose: Verify public growth API wrapper uses public no-auth request policy.
 * Caller: Frontend focused public growth service test gate.
 * Deps: vitest, mocked apiClient, publicGrowthService.
 * MainFuncs: publicGrowthService request tests.
 * SideEffects: Mocks HTTP client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('./apiClient', () => ({
    default: { get: getMock },
}));

import publicGrowthService from './publicGrowthService';

describe('publicGrowthService', () => {
    beforeEach(() => {
        getMock.mockReset();
        getMock.mockResolvedValue({ data: { success: true, data: [] } });
    });

    it('loads an area using the public endpoint', async () => {
        await publicGrowthService.getArea('kab-surabaya');
        expect(getMock).toHaveBeenCalledWith('/api/public/areas/kab-surabaya', expect.objectContaining({
            skipGlobalErrorNotification: true,
            skipAuthRefresh: true,
        }));
    });

    it('loads trending cameras with area and limit params', async () => {
        await publicGrowthService.getTrendingCameras({ areaSlug: 'kab-surabaya', limit: 4 });
        expect(getMock).toHaveBeenCalledWith('/api/public/trending-cameras', expect.objectContaining({
            params: { areaSlug: 'kab-surabaya', limit: 4 },
        }));
    });
});
```

- [x] **Step 3: Run focused frontend utility tests**

```bash
cd frontend
npm test -- publicGrowthShare.test.js publicGrowthService.test.js
```

Expected: all tests PASS.

- [x] **Step 4: Commit helper layer**

```bash
git add frontend/src/services/publicGrowthService.js frontend/src/services/publicGrowthService.test.js frontend/src/utils/publicGrowthShare.js frontend/src/utils/publicGrowthShare.test.js
git commit -m "Add: public growth share helpers"
git push
```

## Task 4: Trending Component And Landing Integration

**Files:**
- Modify: `frontend/src/components/landing/LandingTrendingCameras.jsx`
- Modify: `frontend/src/pages/LandingPage.jsx`
- Test: `frontend/src/components/landing/LandingTrendingCameras.test.jsx`

- [x] **Step 1: Write component test**

Create `frontend/src/components/landing/LandingTrendingCameras.test.jsx`:

```jsx
/*
 * Purpose: Verify public trending CCTV section rendering and interactions.
 * Caller: Frontend focused landing growth component test gate.
 * Deps: React Testing Library, vitest, LandingTrendingCameras.
 * MainFuncs: Trending camera render tests.
 * SideEffects: None.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LandingTrendingCameras from './LandingTrendingCameras';

describe('LandingTrendingCameras', () => {
    it('renders nothing when there are no cameras', () => {
        const { container } = render(<LandingTrendingCameras cameras={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders top-viewed cameras and opens selected camera', async () => {
        const onCameraClick = vi.fn();
        render(
            <LandingTrendingCameras
                cameras={[{ id: 1, name: 'CCTV A', area_name: 'Area A', total_views: 24 }]}
                onCameraClick={onCameraClick}
            />
        );

        expect(screen.getByTestId('trending-cameras')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /CCTV A/i }));
        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });
});
```

- [x] **Step 2: Integrate landing trending load**

In `frontend/src/pages/LandingPage.jsx`, import:

```js
import publicGrowthService from '../services/publicGrowthService';
import LandingTrendingCameras from '../components/landing/LandingTrendingCameras';
```

Inside `LandingPageContent`, add state:

```js
const [trendingCameras, setTrendingCameras] = useState([]);
const [trendingLoading, setTrendingLoading] = useState(true);
```

Add effect:

```js
useEffect(() => {
    let mounted = true;

    publicGrowthService.getTrendingCameras({ limit: 4 })
        .then((response) => {
            if (mounted) {
                setTrendingCameras(response.data || []);
            }
        })
        .catch(() => {
            if (mounted) {
                setTrendingCameras([]);
            }
        })
        .finally(() => {
            if (mounted) {
                setTrendingLoading(false);
            }
        });

    return () => {
        mounted = false;
    };
}, []);
```

Render before `LandingCamerasSection` in full mode:

```jsx
<LandingTrendingCameras
    cameras={trendingCameras}
    loading={trendingLoading}
    onCameraClick={handleGridPopupOpen}
/>
```

For simple mode, pass `trendingCameras` and `LandingTrendingCameras` only if `LandingPageSimple` supports extension props. If it does not, leave simple mode unchanged in this batch.

- [x] **Step 3: Run component test and build**

```bash
cd frontend
npm test -- LandingTrendingCameras.test.jsx
npm run build
```

Expected: both PASS.

- [x] **Step 4: Commit landing trending**

```bash
git add frontend/src/components/landing/LandingTrendingCameras.jsx frontend/src/components/landing/LandingTrendingCameras.test.jsx frontend/src/pages/LandingPage.jsx
git commit -m "Add: public trending CCTV section"
git push
```

## Task 5: Public Area Page

**Files:**
- Modify: `frontend/src/pages/AreaPublicPage.jsx`
- Test: `frontend/src/pages/AreaPublicPage.test.jsx`

- [ ] **Step 1: Write page test**

Create `frontend/src/pages/AreaPublicPage.test.jsx`:

```jsx
/*
 * Purpose: Verify public area page data loading, empty state, and metadata behavior.
 * Caller: Frontend focused public area page test gate.
 * Deps: React Testing Library, MemoryRouter, vitest, AreaPublicPage.
 * MainFuncs: AreaPublicPage render tests.
 * SideEffects: Mocks public growth API.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAreaMock = vi.fn();
const getAreaCamerasMock = vi.fn();
const getTrendingCamerasMock = vi.fn();

vi.mock('../services/publicGrowthService', () => ({
    default: {
        getArea: getAreaMock,
        getAreaCameras: getAreaCamerasMock,
        getTrendingCameras: getTrendingCamerasMock,
    },
}));

import AreaPublicPage from './AreaPublicPage';

function renderPage(path = '/area/kab-surabaya') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/area/:areaSlug" element={<AreaPublicPage />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('AreaPublicPage', () => {
    beforeEach(() => {
        getAreaMock.mockReset();
        getAreaCamerasMock.mockReset();
        getTrendingCamerasMock.mockReset();
    });

    it('renders area data and cameras', async () => {
        getAreaMock.mockResolvedValue({ success: true, data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 } });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: [{ id: 1, name: 'CCTV A', area_name: 'KAB SURABAYA', total_views: 9 }] });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [{ id: 1, name: 'CCTV A', area_name: 'KAB SURABAYA', total_views: 9 }] });

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { name: /KAB SURABAYA/i })).toBeInTheDocument());
        expect(screen.getByText(/1 kamera/i)).toBeInTheDocument();
        expect(screen.getByText(/CCTV A/i)).toBeInTheDocument();
    });

    it('renders public not found state', async () => {
        getAreaMock.mockRejectedValue({ response: { status: 404 } });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: [] });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage('/area/hilang');

        await waitFor(() => expect(screen.getByText(/Area tidak ditemukan/i)).toBeInTheDocument());
    });
});
```

- [ ] **Step 2: Implement area page**

Replace skeleton in `frontend/src/pages/AreaPublicPage.jsx` with a page that:

- Uses `useParams` to read `areaSlug`.
- Calls `publicGrowthService.getArea(areaSlug)`, `getAreaCameras(areaSlug)`, and `getTrendingCameras({ areaSlug, limit: 4 })`.
- Updates `document.title` to `CCTV Online ${area.name} - RAF NET`.
- Updates meta description and `og:title`/`og:description` using `document.querySelector`.
- Shows loading, not found, empty, and populated states.
- Uses `LandingTrendingCameras` for area trending.
- Renders camera buttons/cards in a responsive grid and opens the existing `VideoPopup` when clicked.

The minimal populated grid can use buttons first; reuse `LandingCameraCard` only if props align without extra refactor.

- [ ] **Step 3: Run area page tests and build**

```bash
cd frontend
npm test -- AreaPublicPage.test.jsx
npm run build
```

Expected: both PASS.

- [ ] **Step 4: Commit area page**

```bash
git add frontend/src/pages/AreaPublicPage.jsx frontend/src/pages/AreaPublicPage.test.jsx frontend/src/App.jsx
git commit -m "Add: public area CCTV page"
git push
```

## Task 6: Maps, Full Verification, And Polish

**Files:**
- Modify: `SYSTEM_MAP.md` if root critical flow changes need mention.
- Modify: `backend/.module_map.md`
- Modify: `frontend/src/.module_map.md`
- Modify: any touched tests/components from prior tasks if verification exposes bugs.

- [ ] **Step 1: Sync module maps**

Update `backend/.module_map.md` Domain Ownership:

```md
- Public growth pages: `routes/publicGrowthRoutes.js`, `controllers/publicGrowthController.js`, and `services/publicGrowthService.js` expose sanitized area/trending camera read models for SEO/shareable public pages.
```

Update `frontend/src/.module_map.md` Route Ownership:

```md
- Public area pages: `pages/AreaPublicPage.jsx`, `services/publicGrowthService.js`, `utils/publicGrowthShare.js`, and `components/landing/LandingTrendingCameras.jsx`.
```

- [ ] **Step 2: Run focused backend tests**

```bash
cd backend
npm test -- publicGrowthService.test.js publicGrowthRoutes.test.js
```

Expected: PASS.

- [ ] **Step 3: Run focused frontend tests**

```bash
cd frontend
npm test -- publicGrowthShare.test.js publicGrowthService.test.js LandingTrendingCameras.test.jsx AreaPublicPage.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Run frontend build and lint**

```bash
cd frontend
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Optional backend full gate if time allows**

```bash
cd backend
npm test
```

Expected: PASS or document unrelated failures with exact test names.

- [ ] **Step 6: Commit docs/polish**

```bash
git add SYSTEM_MAP.md backend/.module_map.md frontend/src/.module_map.md
git commit -m "Add: document public growth flow"
git push
```

## Self-Review

- Spec coverage: area route, public sanitized endpoints, trending cameras, share helpers, metadata, tests, and map updates are covered.
- Security: plan explicitly sanitizes public camera fields and keeps RTSP/credentials out of responses.
- DB performance: trending uses `camera_view_stats` with `LIMIT` and does not scan session history.
- Scope: client branding, billing, SSR/prerender, and reports remain out of scope.
- Deferred-content scan: the only intentionally incomplete code is Task 1 skeleton code, which is required by repository SDD rules before internal logic.
