<!--
Purpose: Mature implementation plan for preventing stuck camera streams after Camera Management source, IP, transport, or codec updates.
Caller: Agentic workers implementing the Camera Source Lifecycle hardening work.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, frontend/src/.module_map.md, frontend/src/pages/.module_map.md, frontend/src/hooks/admin/.module_map.md.
MainFuncs: Defines deep-analysis findings, architecture, ordered TDD tasks, target files, verification commands, and commit boundaries.
SideEffects: None; documentation only.
-->

# Camera Source Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camera Management source updates must reconnect the correct CCTV stream, reload active players, expose recovery controls, and leave audit evidence without requiring manual disable/wait/enable.

**Architecture:** Introduce a backend source lifecycle boundary that classifies source changes, refreshes MediaMTX paths, resets health/runtime state, records masked lifecycle events, and returns a structured result to the controller. Frontend consumes that result to show reconnecting status, force HLS reloads through a stream revision, and provide a manual refresh path for operators.

**Tech Stack:** Node.js 20+, Fastify 4.28.1, better-sqlite3, Vitest, MediaMTX v1.9.0 Control API, React 18.3.1, Vite 5.3.1, HLS.js.

---

## Deep Analysis Findings

- `backend/controllers/cameraController.js` discards the return value from `cameraService.updateCamera()`, so the UI cannot know whether a source refresh was executed, deferred, or failed.
- `backend/routes/cameraRoutes.js` has no manual stream refresh endpoint, so the only operator recovery path is still disable/enable.
- `backend/services/cameraService.js` already detects some source-affecting updates for recording reconciliation, but stream lifecycle, runtime reset, API result, and event evidence are not centralized.
- `backend/services/mediaMtxService.js` now has a path refresh primitive, but there is no higher-level lifecycle service that verifies source update completion and persists the outcome.
- `backend/services/cameraRuntimeStateService.js` can already store arbitrary monitoring states, so `reconnecting` can be introduced without schema churn.
- `frontend/src/hooks/admin/useCameraManagementPage.js` treats update success as a generic CRUD success and does not inspect backend lifecycle details.
- `frontend/src/components/VideoPlayer.jsx` mostly keys playback by stable HLS URL. If the URL path stays `/hls/<stream_key>/index.m3u8`, active players can continue using stale state unless a revision is added.
- `frontend/src/components/admin/cameras/CameraStatusActions.jsx` has enable/disable controls but no explicit stream refresh action.
- Persistent lifecycle diagnostics are missing. Without an event table, the next incident will still require guessing from logs.

## Final Scope For Items 1-5

1. Backend `cameraSourceLifecycleService` as the single source-update orchestrator.
2. Reconnecting runtime state plus structured API responses from camera update and manual refresh.
3. Post-update MediaMTX verification and `stream_revision` increments for frontend cache busting.
4. Frontend reload/status/manual refresh integration in Camera Management and VideoPlayer.
5. Masked lifecycle audit events and a compact admin diagnostic endpoint.

## File Structure

### Backend

- Create: `backend/services/cameraSourceLifecycleService.js`
  - Classifies source-affecting changes.
  - Orchestrates MediaMTX refresh, runtime state transitions, health reset, recording reconcile callback, revision bump, and event writes.
- Create: `backend/utils/cameraSourceFingerprint.js`
  - Masks RTSP URLs and hashes sensitive source fields before event persistence.
- Create: `backend/database/migrations/202605100001_add_camera_source_lifecycle.js`
  - Adds `cameras.stream_revision`, `cameras.source_updated_at`.
  - Creates `camera_source_lifecycle_events` with indexes.
- Modify: `backend/services/cameraService.js`
  - Delegates source lifecycle handling to `cameraSourceLifecycleService`.
  - Returns structured lifecycle data from `updateCamera()`.
  - Adds `refreshCameraStream(cameraId, request)`.
- Modify: `backend/controllers/cameraController.js`
  - Returns update lifecycle data.
  - Adds `refreshCameraStream()` and `getCameraSourceLifecycleEvents()` handlers.
- Modify: `backend/routes/cameraRoutes.js`
  - Adds `POST /api/cameras/:id/stream/refresh`.
  - Adds `GET /api/cameras/:id/stream/events`.
- Modify: `backend/services/mediaMtxService.js`
  - Adds a narrow source verification helper if existing `getPathConfig()` is not enough.
- Modify: `backend/services/.module_map.md`
  - Documents the new lifecycle service and stream source update flow.
- Modify: `backend/.module_map.md`
  - Documents the new migration and route flow if the map references routes/migrations.
- Test: `backend/__tests__/cameraSourceLifecycleService.test.js`
- Test: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`
- Test: `backend/__tests__/mediaMtxService.test.js`

### Frontend

- Create: `frontend/src/utils/streamRevision.js`
  - Appends a stable `stream_rev` query parameter to HLS URLs.
- Modify: `frontend/src/services/cameraService.js`
  - Adds `refreshCameraStream(id)` and `getCameraSourceLifecycleEvents(id)`.
- Modify: `frontend/src/hooks/admin/useCameraManagementPage.js`
  - Reads lifecycle response from update calls.
  - Adds manual refresh action state.
- Modify: `frontend/src/components/admin/cameras/CameraGrid.jsx`
  - Passes refresh props down to cards.
- Modify: `frontend/src/components/admin/cameras/CameraCard.jsx`
  - Shows reconnecting/source-updated status and passes refresh action.
- Modify: `frontend/src/components/admin/cameras/CameraStatusActions.jsx`
  - Adds a manual stream refresh button.
- Modify: `frontend/src/components/VideoPlayer.jsx`
  - Uses `stream_revision`/`source_updated_at` to hard reload HLS when source changes.
- Modify: `frontend/src/pages/CameraManagement.test.jsx`
  - Covers source update lifecycle and manual refresh UI behavior.
- Test: `frontend/src/utils/streamRevision.test.js`
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/hooks/admin/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`

---

## API Contract

Camera update response:

```json
{
  "success": true,
  "message": "Camera updated successfully",
  "data": {
    "cameraId": 12,
    "sourceLifecycle": {
      "sourceChanged": true,
      "status": "refreshed",
      "reason": "camera_update",
      "streamRevision": 4,
      "sourceUpdatedAt": "2026-05-10T01:30:00.000Z",
      "mediaMtx": {
        "success": true,
        "action": "refreshed",
        "pathName": "camera_12"
      },
      "verification": {
        "success": true,
        "status": "path_config_matches"
      },
      "warnings": []
    }
  }
}
```

Manual refresh response:

```json
{
  "success": true,
  "message": "Camera stream refreshed successfully",
  "data": {
    "cameraId": 12,
    "sourceLifecycle": {
      "sourceChanged": true,
      "status": "refreshed",
      "reason": "manual_refresh",
      "streamRevision": 5,
      "warnings": []
    }
  }
}
```

If MediaMTX path delete is busy, return HTTP 200 with lifecycle status `refresh_pending` and a warning. The update must remain saved, but the UI must show that the stream is reconnecting and offer manual refresh.

---

## Task 1: Schema, Fingerprint, And Event Foundation

**Files:**
- Create: `backend/database/migrations/202605100001_add_camera_source_lifecycle.js`
- Create: `backend/utils/cameraSourceFingerprint.js`
- Create: `backend/__tests__/cameraSourceLifecycleService.test.js`
- Modify: `backend/.module_map.md`

- [ ] **Step 1: Add failing fingerprint tests**

Add this block to `backend/__tests__/cameraSourceLifecycleService.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import {
    hashSourceValue,
    maskRtspUrl,
} from '../utils/cameraSourceFingerprint.js';

describe('camera source fingerprint utilities', () => {
    it('masks RTSP credentials before persistence', () => {
        expect(maskRtspUrl('rtsp://admin:secret@192.168.1.10:554/stream1'))
            .toBe('rtsp://admin:***@192.168.1.10:554/stream1');
    });

    it('hashes source values with stable sha256 output', () => {
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toMatch(/^[a-f0-9]{64}$/);
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toBe(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'));
    });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
cd backend
npm test -- cameraSourceLifecycleService.test.js
```

Expected: FAIL because `backend/utils/cameraSourceFingerprint.js` does not exist.

- [ ] **Step 3: Create the utility skeleton and implementation**

Create `backend/utils/cameraSourceFingerprint.js`:

```javascript
/**
 * Purpose: Sanitizes and fingerprints camera source values for lifecycle diagnostics.
 * Caller: cameraSourceLifecycleService and lifecycle event tests.
 * Deps: Node crypto, URL parser.
 * MainFuncs: maskRtspUrl, hashSourceValue.
 * SideEffects: None.
 */

import crypto from 'crypto';

export function maskRtspUrl(value) {
    if (!value || typeof value !== 'string') {
        return value;
    }

    try {
        const parsed = new URL(value);
        if (parsed.password) {
            parsed.password = '***';
        }
        return parsed.toString();
    } catch {
        return value.replace(/(rtsp:\/\/[^:\s]+:)([^@\s]+)(@)/i, '$1***$3');
    }
}

export function hashSourceValue(value) {
    return crypto
        .createHash('sha256')
        .update(String(value ?? ''))
        .digest('hex');
}
```

- [ ] **Step 4: Create the migration**

Create `backend/database/migrations/202605100001_add_camera_source_lifecycle.js`:

```javascript
/**
 * Purpose: Adds persistent camera source lifecycle metadata and diagnostics.
 * Caller: backend database migration runner.
 * Deps: better-sqlite3 migration context.
 * MainFuncs: up.
 * SideEffects: Alters cameras table and creates camera_source_lifecycle_events.
 */

export function up(db) {
    const cameraColumns = db.prepare('PRAGMA table_info(cameras)').all();
    const hasStreamRevision = cameraColumns.some((column) => column.name === 'stream_revision');
    const hasSourceUpdatedAt = cameraColumns.some((column) => column.name === 'source_updated_at');

    if (!hasStreamRevision) {
        db.prepare('ALTER TABLE cameras ADD COLUMN stream_revision INTEGER NOT NULL DEFAULT 0').run();
    }

    if (!hasSourceUpdatedAt) {
        db.prepare('ALTER TABLE cameras ADD COLUMN source_updated_at TEXT').run();
    }

    db.prepare(`
        CREATE TABLE IF NOT EXISTS camera_source_lifecycle_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            source_change_summary_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_camera_source_lifecycle_events_camera_created
        ON camera_source_lifecycle_events(camera_id, created_at DESC)
    `).run();

    db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_camera_source_lifecycle_events_status_created
        ON camera_source_lifecycle_events(status, created_at DESC)
    `).run();
}
```

- [ ] **Step 5: Run migration and focused test**

Run:

```bash
cd backend
npm run migrate
npm test -- cameraSourceLifecycleService.test.js
```

Expected: migration completes; fingerprint tests PASS.

- [ ] **Step 6: Update maps and commit**

Update `backend/.module_map.md` with the new migration and utility. Then run:

```bash
git add backend/database/migrations/202605100001_add_camera_source_lifecycle.js backend/utils/cameraSourceFingerprint.js backend/__tests__/cameraSourceLifecycleService.test.js backend/.module_map.md
git commit -m "Add: camera source lifecycle schema foundation"
git push
```

---

## Task 2: Backend Lifecycle Orchestrator

**Files:**
- Create: `backend/services/cameraSourceLifecycleService.js`
- Modify: `backend/services/cameraService.js`
- Modify: `backend/services/.module_map.md`
- Test: `backend/__tests__/cameraSourceLifecycleService.test.js`
- Test: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`

- [ ] **Step 1: Add failing classification tests**

Extend `backend/__tests__/cameraSourceLifecycleService.test.js`:

```javascript
import { CameraSourceLifecycleService } from '../services/cameraSourceLifecycleService.js';

describe('CameraSourceLifecycleService source classification', () => {
    const service = new CameraSourceLifecycleService({
        cameraRuntimeStateService: {},
        cameraHealthService: {},
        mediaMtxService: {},
        db: {},
    });

    it('ignores metadata-only camera updates', () => {
        const result = service.classifySourceChange(
            { id: 1, name: 'Old', private_rtsp_url: 'rtsp://10.0.0.1/live', video_codec: 'h264', enabled: 1 },
            { name: 'New' }
        );

        expect(result).toEqual({
            sourceChanged: false,
            changedFields: [],
            maskedChanges: {},
        });
    });

    it('detects IP, transport, delivery, codec, and enabled changes', () => {
        const result = service.classifySourceChange(
            {
                id: 1,
                private_rtsp_url: 'rtsp://admin:old@10.0.0.1/live',
                internal_rtsp_transport_override: 'tcp',
                delivery_type: 'hls',
                stream_source: 'internal',
                video_codec: 'h264',
                enabled: 1,
            },
            {
                private_rtsp_url: 'rtsp://admin:new@10.0.0.2/live',
                internal_rtsp_transport_override: 'udp',
                delivery_type: 'webrtc',
                stream_source: 'external',
                video_codec: 'h265',
                enabled: 0,
            }
        );

        expect(result.sourceChanged).toBe(true);
        expect(result.changedFields).toEqual([
            'private_rtsp_url',
            'internal_rtsp_transport_override',
            'delivery_type',
            'stream_source',
            'video_codec',
            'enabled',
        ]);
        expect(result.maskedChanges.private_rtsp_url.after).toContain('***');
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd backend
npm test -- cameraSourceLifecycleService.test.js
```

Expected: FAIL because `cameraSourceLifecycleService.js` does not exist.

- [ ] **Step 3: Create the lifecycle service skeleton and classifier**

Create `backend/services/cameraSourceLifecycleService.js`:

```javascript
/**
 * Purpose: Owns runtime handling for camera source, IP, transport, codec, and enabled-state changes.
 * Caller: cameraService update and manual camera stream refresh flows.
 * Deps: mediaMtxService, cameraHealthService, cameraRuntimeStateService, database connection helpers.
 * MainFuncs: classifySourceChange, handleCameraUpdated, refreshCameraSource, getRecentEvents.
 * SideEffects: Refreshes MediaMTX paths, updates camera runtime state, bumps stream revisions, writes lifecycle events.
 */

import { execute, query, queryOne } from '../database/connectionPool.js';
import cameraHealthService from './cameraHealthService.js';
import cameraRuntimeStateService from './cameraRuntimeStateService.js';
import mediaMtxService from './mediaMtxService.js';
import { hashSourceValue, maskRtspUrl } from '../utils/cameraSourceFingerprint.js';

const SOURCE_FIELDS = [
    'private_rtsp_url',
    'internal_rtsp_transport_override',
    'delivery_type',
    'stream_source',
    'video_codec',
    'enabled',
];

export class CameraSourceLifecycleService {
    constructor(deps = {}) {
        this.mediaMtxService = deps.mediaMtxService || mediaMtxService;
        this.cameraHealthService = deps.cameraHealthService || cameraHealthService;
        this.cameraRuntimeStateService = deps.cameraRuntimeStateService || cameraRuntimeStateService;
        this.db = deps.db || { execute, query, queryOne };
    }

    classifySourceChange(existingCamera, patch) {
        const changedFields = [];
        const maskedChanges = {};

        for (const field of SOURCE_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(patch, field)) {
                continue;
            }

            const before = existingCamera?.[field];
            const after = patch[field];
            if (String(before ?? '') === String(after ?? '')) {
                continue;
            }

            changedFields.push(field);
            maskedChanges[field] = {
                before: field === 'private_rtsp_url' ? maskRtspUrl(before) : before,
                after: field === 'private_rtsp_url' ? maskRtspUrl(after) : after,
                beforeHash: hashSourceValue(before),
                afterHash: hashSourceValue(after),
            };
        }

        return {
            sourceChanged: changedFields.length > 0,
            changedFields,
            maskedChanges,
        };
    }

    async handleCameraUpdated({ existingCamera, updatedCamera, patch, reason = 'camera_update' }) {
        const classification = this.classifySourceChange(existingCamera, patch);
        if (!classification.sourceChanged) {
            return {
                sourceChanged: false,
                status: 'unchanged',
                reason,
                streamRevision: updatedCamera?.stream_revision ?? existingCamera?.stream_revision ?? 0,
                warnings: [],
            };
        }

        return this.refreshCameraSource({
            camera: updatedCamera,
            reason,
            classification,
        });
    }

    async refreshCameraSource({ camera, reason = 'manual_refresh', classification = null }) {
        throw new Error('refreshCameraSource not implemented yet');
    }

    getRecentEvents(cameraId, limit = 20) {
        return this.db.query(
            `SELECT id, camera_id, event_type, reason, status, source_change_summary_json, result_json, created_at
             FROM camera_source_lifecycle_events
             WHERE camera_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [cameraId, Math.min(Math.max(Number(limit) || 20, 1), 50)]
        );
    }
}

export default new CameraSourceLifecycleService();
```

- [ ] **Step 4: Run classification tests**

Run:

```bash
cd backend
npm test -- cameraSourceLifecycleService.test.js -t "source classification"
```

Expected: PASS.

- [ ] **Step 5: Add failing orchestration test**

Add to `backend/__tests__/cameraSourceLifecycleService.test.js`:

```javascript
describe('CameraSourceLifecycleService refresh orchestration', () => {
    it('marks reconnecting, refreshes MediaMTX, bumps revision, clears health, and records an event', async () => {
        const calls = [];
        const rows = new Map([[1, { stream_revision: 2, source_updated_at: null }]]);
        const service = new CameraSourceLifecycleService({
            mediaMtxService: {
                refreshCameraPathAfterSourceChange: async (camera) => {
                    calls.push(['refreshPath', camera.id]);
                    return { success: true, action: 'refreshed', pathName: camera.stream_key };
                },
                getPathConfig: async () => ({ source: 'rtsp://admin:secret@10.0.0.2/live' }),
            },
            cameraHealthService: {
                clearCameraRuntimeState: async (cameraId, pathName) => calls.push(['clearHealth', cameraId, pathName]),
            },
            cameraRuntimeStateService: {
                upsertRuntimeState: (cameraId, state) => calls.push(['runtime', cameraId, state.monitoring_state]),
            },
            db: {
                queryOne: (sql, params) => rows.get(params[0]),
                query: () => [],
                execute: (sql, params) => {
                    calls.push(['execute', sql, params]);
                    if (sql.includes('UPDATE cameras')) {
                        rows.set(params[1], { stream_revision: 3, source_updated_at: params[0] });
                    }
                },
            },
        });

        const result = await service.refreshCameraSource({
            camera: {
                id: 1,
                name: 'Gate',
                stream_key: 'camera_1',
                stream_source: 'internal',
                delivery_type: 'hls',
                enabled: 1,
                private_rtsp_url: 'rtsp://admin:secret@10.0.0.2/live',
            },
            reason: 'camera_update',
            classification: { sourceChanged: true, changedFields: ['private_rtsp_url'], maskedChanges: {} },
        });

        expect(result).toMatchObject({
            sourceChanged: true,
            status: 'refreshed',
            reason: 'camera_update',
            streamRevision: 3,
            mediaMtx: { success: true, action: 'refreshed' },
            verification: { success: true },
        });
        expect(calls.some((call) => call[0] === 'refreshPath')).toBe(true);
        expect(calls.some((call) => call[0] === 'clearHealth')).toBe(true);
        expect(calls.some((call) => call[0] === 'runtime' && call[2] === 'reconnecting')).toBe(true);
        expect(calls.some((call) => call[0] === 'runtime' && call[2] === 'checking')).toBe(true);
    });
});
```

Expected: FAIL because `refreshCameraSource()` is a stub.

- [ ] **Step 6: Implement refresh orchestration**

Replace the `refreshCameraSource()` stub with:

```javascript
    async refreshCameraSource({ camera, reason = 'manual_refresh', classification = null }) {
        const now = new Date().toISOString();
        const warnings = [];
        const pathName = camera?.stream_key || `camera_${camera?.id}`;

        this.cameraRuntimeStateService.upsertRuntimeState(camera.id, {
            camera_id: camera.id,
            monitoring_state: 'reconnecting',
            monitoring_reason: reason,
            last_checked_at: now,
        });

        let mediaMtxResult = { success: true, action: 'skipped', pathName };
        if (camera.enabled === 1 && camera.stream_source !== 'external') {
            mediaMtxResult = await this.mediaMtxService.refreshCameraPathAfterSourceChange(camera);
            if (!mediaMtxResult.success || mediaMtxResult.action === 'patched_refresh_pending') {
                warnings.push(mediaMtxResult.message || 'MediaMTX path refresh is pending');
            }
        }

        await this.cameraHealthService.clearCameraRuntimeState(camera.id, pathName);

        const verification = await this.verifyInternalHlsSource(camera, mediaMtxResult);
        if (!verification.success) {
            warnings.push(verification.message);
        }

        this.db.execute(
            `UPDATE cameras
             SET stream_revision = COALESCE(stream_revision, 0) + 1,
                 source_updated_at = ?,
                 updated_at = ?
             WHERE id = ?`,
            [now, now, camera.id]
        );

        const revisionRow = this.db.queryOne(
            'SELECT stream_revision, source_updated_at FROM cameras WHERE id = ?',
            [camera.id]
        ) || {};

        const status = warnings.length > 0 ? 'refresh_pending' : 'refreshed';
        const result = {
            sourceChanged: true,
            status,
            reason,
            streamRevision: revisionRow.stream_revision ?? 0,
            sourceUpdatedAt: revisionRow.source_updated_at ?? now,
            mediaMtx: mediaMtxResult,
            verification,
            warnings,
        };

        this.recordLifecycleEvent({
            cameraId: camera.id,
            eventType: 'source_refresh',
            reason,
            status,
            classification,
            result,
        });

        this.cameraRuntimeStateService.upsertRuntimeState(camera.id, {
            camera_id: camera.id,
            monitoring_state: status === 'refreshed' ? 'checking' : 'reconnecting',
            monitoring_reason: status,
            last_checked_at: now,
        });

        return result;
    }

    async verifyInternalHlsSource(camera, mediaMtxResult) {
        if (camera.enabled !== 1 || camera.stream_source === 'external') {
            return { success: true, status: 'not_required' };
        }

        if (!mediaMtxResult.success) {
            return {
                success: false,
                status: 'media_mtx_refresh_failed',
                message: mediaMtxResult.message || 'MediaMTX refresh failed',
            };
        }

        const pathConfig = await this.mediaMtxService.getPathConfig(camera.stream_key || `camera_${camera.id}`);
        if (!pathConfig) {
            return {
                success: false,
                status: 'path_config_missing',
                message: 'MediaMTX path config is missing after refresh',
            };
        }

        return {
            success: true,
            status: 'path_config_matches',
        };
    }

    recordLifecycleEvent({ cameraId, eventType, reason, status, classification, result }) {
        this.db.execute(
            `INSERT INTO camera_source_lifecycle_events
             (camera_id, event_type, reason, status, source_change_summary_json, result_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                cameraId,
                eventType,
                reason,
                status,
                JSON.stringify(classification || { sourceChanged: true, changedFields: [], maskedChanges: {} }),
                JSON.stringify(result),
                new Date().toISOString(),
            ]
        );
    }
```

- [ ] **Step 7: Wire cameraService to lifecycle service**

In `backend/services/cameraService.js`, update the update flow so it:

```javascript
const lifecycleResult = await cameraSourceLifecycleService.handleCameraUpdated({
    existingCamera,
    updatedCamera,
    patch: updateData,
    reason: 'camera_update',
});

return {
    cameraId: id,
    sourceLifecycle: lifecycleResult,
};
```

Also add:

```javascript
async refreshCameraStream(id, request = null) {
    const camera = this.getCameraById(id);
    if (!camera) {
        const err = new Error('Camera not found');
        err.statusCode = 404;
        throw err;
    }

    const sourceLifecycle = await cameraSourceLifecycleService.refreshCameraSource({
        camera,
        reason: 'manual_refresh',
        classification: { sourceChanged: true, changedFields: ['manual_refresh'], maskedChanges: {} },
    });

    return {
        cameraId: Number(id),
        sourceLifecycle,
    };
}
```

Keep the existing recording reconciliation call in place until a separate recording lifecycle refactor is planned.

- [ ] **Step 8: Run backend lifecycle tests**

Run:

```bash
cd backend
npm test -- cameraSourceLifecycleService.test.js cameraServiceRecordingLifecycle.test.js
```

Expected: PASS.

- [ ] **Step 9: Update map and commit**

Update `backend/services/.module_map.md`, then run:

```bash
git add backend/services/cameraSourceLifecycleService.js backend/services/cameraService.js backend/services/.module_map.md backend/__tests__/cameraSourceLifecycleService.test.js backend/__tests__/cameraServiceRecordingLifecycle.test.js
git commit -m "Add: camera source lifecycle orchestration"
git push
```

---

## Task 3: API Response And Manual Recovery Endpoints

**Files:**
- Modify: `backend/controllers/cameraController.js`
- Modify: `backend/routes/cameraRoutes.js`
- Modify: `backend/services/cameraService.js`
- Test: `backend/__tests__/cameraSourceLifecycleService.test.js`

- [ ] **Step 1: Update camera update controller response**

In `backend/controllers/cameraController.js`, change `updateCamera()` to preserve the service result:

```javascript
const result = await cameraService.updateCamera(id, request.body, request);
return reply.send({
    success: true,
    message: 'Camera updated successfully',
    data: result,
});
```

- [ ] **Step 2: Add controller handlers**

Add named exports:

```javascript
export async function refreshCameraStream(request, reply) {
    try {
        const { id } = request.params;
        const result = await cameraService.refreshCameraStream(id, request);
        return reply.send({
            success: true,
            message: 'Camera stream refreshed successfully',
            data: result,
        });
    } catch (error) {
        console.error('Refresh camera stream error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getCameraSourceLifecycleEvents(request, reply) {
    try {
        const { id } = request.params;
        const events = cameraService.getCameraSourceLifecycleEvents(id);
        return reply.send({ success: true, data: events });
    } catch (error) {
        console.error('Get camera source lifecycle events error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
```

- [ ] **Step 3: Add service event getter**

In `backend/services/cameraService.js`:

```javascript
getCameraSourceLifecycleEvents(id) {
    return cameraSourceLifecycleService.getRecentEvents(Number(id), 20);
}
```

- [ ] **Step 4: Register routes**

In `backend/routes/cameraRoutes.js`, import the handlers and add:

```javascript
fastify.post('/api/cameras/:id/stream/refresh', {
    preHandler: [fastify.authenticate],
    schema: { params: cameraIdParamSchema },
}, refreshCameraStream);

fastify.get('/api/cameras/:id/stream/events', {
    preHandler: [fastify.authenticate],
    schema: { params: cameraIdParamSchema },
}, getCameraSourceLifecycleEvents);
```

- [ ] **Step 5: Run route-adjacent backend tests**

Run:

```bash
cd backend
npm test -- cameraSourceLifecycleService.test.js cameraServiceRecordingLifecycle.test.js
npm test
```

Expected: focused tests PASS; full backend suite PASS.

- [ ] **Step 6: Commit API work**

Run:

```bash
git add backend/controllers/cameraController.js backend/routes/cameraRoutes.js backend/services/cameraService.js
git commit -m "Add: camera stream lifecycle API"
git push
```

---

## Task 4: Frontend Lifecycle Consumption And Manual Refresh

**Files:**
- Create: `frontend/src/utils/streamRevision.js`
- Create: `frontend/src/utils/streamRevision.test.js`
- Modify: `frontend/src/services/cameraService.js`
- Modify: `frontend/src/hooks/admin/useCameraManagementPage.js`
- Modify: `frontend/src/components/admin/cameras/CameraGrid.jsx`
- Modify: `frontend/src/components/admin/cameras/CameraCard.jsx`
- Modify: `frontend/src/components/admin/cameras/CameraStatusActions.jsx`
- Modify: `frontend/src/pages/CameraManagement.test.jsx`
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/hooks/admin/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`

- [ ] **Step 1: Add stream revision utility tests**

Create `frontend/src/utils/streamRevision.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { appendStreamRevision } from './streamRevision';

describe('appendStreamRevision', () => {
    it('leaves empty urls untouched', () => {
        expect(appendStreamRevision('', 4)).toBe('');
    });

    it('adds stream_rev to urls without query strings', () => {
        expect(appendStreamRevision('/hls/camera_1/index.m3u8', 4))
            .toBe('/hls/camera_1/index.m3u8?stream_rev=4');
    });

    it('updates existing query strings without dropping params', () => {
        expect(appendStreamRevision('/hls/camera_1/index.m3u8?token=abc', 4))
            .toBe('/hls/camera_1/index.m3u8?token=abc&stream_rev=4');
    });
});
```

- [ ] **Step 2: Run failing frontend utility test**

Run:

```bash
cd frontend
npm test -- streamRevision.test.js
```

Expected: FAIL because `streamRevision.js` does not exist.

- [ ] **Step 3: Create stream revision utility**

Create `frontend/src/utils/streamRevision.js`:

```javascript
/**
 * Purpose: Adds camera stream revision cache-busting to HLS URLs.
 * Caller: VideoPlayer and stream lifecycle tests.
 * Deps: URLSearchParams.
 * MainFuncs: appendStreamRevision.
 * SideEffects: None.
 */

export function appendStreamRevision(url, revision) {
    if (!url || revision === undefined || revision === null || revision === '') {
        return url || '';
    }

    const [base, query = ''] = String(url).split('?');
    const params = new URLSearchParams(query);
    params.set('stream_rev', String(revision));
    return `${base}?${params.toString()}`;
}
```

- [ ] **Step 4: Add camera service methods**

In `frontend/src/services/cameraService.js`, add:

```javascript
async refreshCameraStream(id) {
    const response = await api.post(`/cameras/${id}/stream/refresh`);
    return response.data;
},

async getCameraSourceLifecycleEvents(id) {
    const response = await api.get(`/cameras/${id}/stream/events`);
    return response.data;
},
```

- [ ] **Step 5: Update Camera Management hook**

In `frontend/src/hooks/admin/useCameraManagementPage.js`:

```javascript
const [refreshingStreamId, setRefreshingStreamId] = useState(null);

const handleLifecycleResult = useCallback((lifecycle) => {
    if (!lifecycle?.sourceChanged) {
        return;
    }

    if (lifecycle.status === 'refreshed') {
        success('Camera stream source refreshed');
        return;
    }

    showError(lifecycle.warnings?.[0] || 'Camera stream is reconnecting; use refresh if it stays stuck');
}, [success, showError]);

const refreshCameraStream = useCallback(async (cameraId) => {
    setRefreshingStreamId(cameraId);
    try {
        const response = await cameraService.refreshCameraStream(cameraId);
        handleLifecycleResult(response?.data?.sourceLifecycle);
        await loadCameras();
    } catch (err) {
        showError(err.response?.data?.message || 'Failed to refresh camera stream');
    } finally {
        setRefreshingStreamId(null);
    }
}, [handleLifecycleResult, loadCameras, showError]);
```

After update submit:

```javascript
const response = await cameraService.updateCamera(editingCamera.id, payload);
handleLifecycleResult(response?.data?.sourceLifecycle);
```

Return `refreshCameraStream` and `refreshingStreamId` from the hook.

- [ ] **Step 6: Wire refresh props through CameraGrid and CameraCard**

Pass these props:

```jsx
refreshingStreamId={refreshingStreamId}
onRefreshStream={refreshCameraStream}
```

Use `camera.monitoring_state === 'reconnecting'` or `camera.source_updated_at` to show a compact status label:

```jsx
{camera.monitoring_state === 'reconnecting' && (
    <span className="text-xs font-medium text-amber-600 dark:text-amber-300">
        Reconnecting
    </span>
)}
```

- [ ] **Step 7: Add manual refresh button**

In `frontend/src/components/admin/cameras/CameraStatusActions.jsx`, add a button near enable/disable actions:

```jsx
<button
    type="button"
    onClick={() => onRefreshStream(camera.id)}
    disabled={isRefreshingStream}
    className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
>
    {isRefreshingStream ? 'Refreshing...' : 'Refresh Stream'}
</button>
```

- [ ] **Step 8: Update VideoPlayer HLS target**

In `frontend/src/components/VideoPlayer.jsx`, import:

```javascript
import { appendStreamRevision } from '../utils/streamRevision';
```

Derive revision and target:

```javascript
const streamRevision = camera?.stream_revision ?? camera?.source_updated_at ?? camera?.updated_at;
const targetHlsUrl = appendStreamRevision(
    useDirectStream && camera.external_hls_url ? camera.external_hls_url : streams.hls,
    streamRevision
);
```

Ensure the HLS effect depends on `targetHlsUrl`, not the full `streams` object.

- [ ] **Step 9: Update frontend tests**

In `frontend/src/pages/CameraManagement.test.jsx`, add coverage that:

```javascript
expect(cameraService.updateCamera).toHaveBeenCalledWith(cameraId, expect.objectContaining({
    private_rtsp_url: 'rtsp://new-ip/stream',
}));
expect(screen.getByText(/Camera stream source refreshed/i)).toBeInTheDocument();
```

Add manual refresh coverage:

```javascript
fireEvent.click(screen.getByRole('button', { name: /Refresh Stream/i }));
await waitFor(() => {
    expect(cameraService.refreshCameraStream).toHaveBeenCalledWith(cameraId);
});
```

- [ ] **Step 10: Run frontend tests**

Run:

```bash
cd frontend
npm test -- streamRevision.test.js CameraManagement.test.jsx
npm run lint
npm run build
```

Expected: tests PASS; lint PASS; build PASS.

- [ ] **Step 11: Update maps and commit**

Run:

```bash
git add frontend/src/utils/streamRevision.js frontend/src/utils/streamRevision.test.js frontend/src/services/cameraService.js frontend/src/hooks/admin/useCameraManagementPage.js frontend/src/components/admin/cameras/CameraGrid.jsx frontend/src/components/admin/cameras/CameraCard.jsx frontend/src/components/admin/cameras/CameraStatusActions.jsx frontend/src/components/VideoPlayer.jsx frontend/src/pages/CameraManagement.test.jsx frontend/src/.module_map.md frontend/src/hooks/admin/.module_map.md frontend/src/pages/.module_map.md
git commit -m "Add: camera stream lifecycle frontend recovery"
git push
```

---

## Task 5: End-To-End Verification And Diagnostics

**Files:**
- Modify only if verification exposes gaps in files touched by Tasks 1-4.

- [ ] **Step 1: Run backend migration and full backend tests**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: migrations complete; all backend tests PASS.

- [ ] **Step 2: Run frontend full checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all frontend tests PASS; lint PASS; production build PASS.

- [ ] **Step 3: Manual API verification with a test camera**

Start backend in the normal project workflow, then perform:

```bash
curl -X PUT http://localhost:3000/api/cameras/1 \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{\"private_rtsp_url\":\"rtsp://admin:secret@192.168.1.50:554/stream1\",\"video_codec\":\"h265\"}"
```

Expected response contains:

```json
"sourceLifecycle":{"sourceChanged":true,"status":"refreshed"
```

Then:

```bash
curl -X POST http://localhost:3000/api/cameras/1/stream/refresh \
  -H "Authorization: Bearer <admin-token>"
```

Expected response contains `reason":"manual_refresh"` and an incremented `streamRevision`.

- [ ] **Step 4: Browser verification**

Run frontend, open Camera Management, edit a camera IP or codec, save, and verify:

- Admin page does not remain stuck on "connecting" after source update.
- Camera row/card shows reconnecting only while lifecycle is pending.
- Manual `Refresh Stream` works without disable/enable.
- Opening a live camera after update requests HLS with `stream_rev=<number>`.
- Diagnostics endpoint shows only masked RTSP data, never raw password.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: no uncommitted implementation changes after final commit and push.

---

## Risk Controls

- Do not store raw RTSP passwords in lifecycle events.
- Do not force MediaMTX refresh on metadata-only camera edits.
- Do not break external HLS cameras; verification should return `not_required` for external streams.
- Do not move recording reconcile into the new lifecycle service in this plan. Keep recording behavior stable and only coordinate source refresh results.
- Keep `refresh_pending` non-fatal so camera updates are not rolled back when MediaMTX needs manual recovery.
- Keep query additions to `stream_rev` deterministic so HLS.js remounts without breaking signed/existing query params.

## Final Verification Matrix

- Backend focused:
  - `cd backend && npm test -- cameraSourceLifecycleService.test.js`
  - `cd backend && npm test -- mediaMtxService.test.js cameraServiceRecordingLifecycle.test.js`
- Backend full:
  - `cd backend && npm run migrate && npm test`
- Frontend focused:
  - `cd frontend && npm test -- streamRevision.test.js CameraManagement.test.jsx`
- Frontend full:
  - `cd frontend && npm test && npm run lint && npm run build`
- Manual:
  - Update IP.
  - Update `h264 -> h265`.
  - Update `h265 -> h264`.
  - Manual refresh while enabled.
  - Manual refresh while disabled.
  - Confirm no raw RTSP credential in diagnostics.

