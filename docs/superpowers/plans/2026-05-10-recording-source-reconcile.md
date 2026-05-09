<!--
Purpose: Implementation plan for automatic recording lifecycle reconciliation after camera source updates.
Caller: Agents and maintainers fixing stuck recording after RTSP IP or codec changes.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, cameraService.js, recordingService.js.
MainFuncs: Maps tests, camera update lifecycle changes, verification, commit, and push sequence.
SideEffects: Documentation only.
-->

# Recording Source Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active recordings automatically restart or stop when a camera update changes the source, codec, delivery type, enabled state, or recording eligibility so operators no longer need to disable and re-enable recording manually.

**Architecture:** Keep the fix in the backend camera mutation boundary because every admin UI, recording page, import flow, and direct API call eventually depends on `cameraService.updateCamera()`. Add a small source-change policy inside `cameraService.js` that decides whether recording should restart, start, stop, or remain untouched after the DB write and MediaMTX path sync. Preserve `recordingService` as the owner of FFmpeg process lifecycle.

**Tech Stack:** Node.js 20+, Fastify services, SQLite via `connectionPool`, Vitest module mocks, existing `recordingService.restartRecording()` and `recordingService.startRecording()` APIs.

---

## File Structure

- Modify: `backend/services/cameraService.js`
  - Responsibility: detect material camera source changes during `updateCamera()` and reconcile recording after DB and MediaMTX path updates.
  - Keep the change scoped to pure helper functions plus one post-update lifecycle block.
- Create: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`
  - Responsibility: regression coverage for RTSP URL, codec, enabled, delivery, and non-material update behavior.
- Modify: `backend/services/.module_map.md`
  - Responsibility: document that camera source mutations reconcile recording lifecycle automatically.

## Task 1: Add Failing Recording Reconcile Tests

**Files:**
- Create: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`

- [ ] **Step 1: Write the failing test file**

Create `backend/__tests__/cameraServiceRecordingLifecycle.test.js` with this content:

```javascript
/*
Purpose: Regression coverage for camera update driven recording lifecycle reconciliation.
Caller: Vitest backend suite.
Deps: cameraService.updateCamera(), mocked connectionPool, MediaMTX, recordingService, audit/cache services.
MainFuncs: createExistingCamera(), runUpdate(), recording restart/start/stop assertions.
SideEffects: Mocks database, MediaMTX, cache, audit, and recording lifecycle calls.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();
const queryMock = vi.fn();
const executeMock = vi.fn();
const updateCameraPathMock = vi.fn();
const removeCameraPathByKeyMock = vi.fn();
const restartRecordingMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
    transaction: vi.fn((fn) => fn()),
}));

vi.mock('../services/mediaMtxService.js', () => ({
    default: {
        updateCameraPath: updateCameraPathMock,
        removeCameraPathByKey: removeCameraPathByKeyMock,
    },
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        restartRecording: restartRecordingMock,
        startRecording: startRecordingMock,
        stopRecording: stopRecordingMock,
        getRecordingStatus: vi.fn(() => ({ status: 'recording', isRecording: true })),
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
    logCameraCreated: vi.fn(),
    logCameraUpdated: vi.fn(),
    logCameraDeleted: vi.fn(),
}));

vi.mock('../middleware/cacheMiddleware.js', () => ({
    invalidateCache: vi.fn(),
}));

vi.mock('../services/cacheService.js', () => ({
    cacheGetOrSetSync: vi.fn((key, factory) => factory()),
    cacheInvalidate: vi.fn(),
    cacheKey: vi.fn((...parts) => parts.join(':')),
    CacheNamespace: {
        CAMERAS: 'cameras',
        PUBLIC: 'public',
    },
}));

vi.mock('../services/thumbnailPathService.js', () => ({
    sanitizeCameraThumbnail: vi.fn((camera) => camera),
    sanitizeCameraThumbnailList: vi.fn((cameras) => cameras),
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        checkCamera: vi.fn(),
    },
}));

vi.mock('../services/cameraRuntimeStateService.js', () => ({
    default: {
        updateState: vi.fn(),
    },
}));

function createExistingCamera(overrides = {}) {
    return {
        id: 7,
        name: 'Gate Camera',
        private_rtsp_url: 'rtsp://user:pass@10.0.0.7/stream1',
        area_id: 2,
        enabled: 1,
        stream_key: 'stream-key-7',
        enable_recording: 1,
        stream_source: 'internal',
        delivery_type: 'internal_hls',
        external_hls_url: null,
        external_stream_url: null,
        external_embed_url: null,
        external_snapshot_url: null,
        external_origin_mode: 'direct',
        external_use_proxy: 1,
        external_tls_mode: 'strict',
        external_health_mode: 'default',
        public_playback_mode: 'inherit',
        public_playback_preview_minutes: 10,
        internal_ingest_policy_override: 'default',
        internal_on_demand_close_after_seconds_override: null,
        internal_rtsp_transport_override: 'default',
        thumbnail_strategy: 'default',
        source_profile: null,
        video_codec: 'h264',
        recording_status: 'recording',
        ...overrides,
    };
}

async function runUpdate(payload, existing = createExistingCamera()) {
    vi.resetModules();
    queryOneMock.mockImplementation((sql) => {
        if (sql.includes('FROM cameras WHERE id = ?')) {
            return existing;
        }
        if (sql.includes('FROM areas WHERE id = ?')) {
            return {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: 30,
                internal_rtsp_transport_default: 'default',
            };
        }
        return null;
    });
    const cameraService = (await import('../services/cameraService.js')).default;
    await cameraService.updateCamera(7, payload, {
        user: { id: 3, username: 'admin' },
        ip: '127.0.0.1',
    });
}

describe('cameraService.updateCamera recording lifecycle reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMock.mockReturnValue([]);
        executeMock.mockReturnValue({ changes: 1, lastInsertRowid: 7 });
        updateCameraPathMock.mockResolvedValue({ success: true, action: 'updated' });
        removeCameraPathByKeyMock.mockResolvedValue({ success: true });
        restartRecordingMock.mockResolvedValue({ success: true });
        startRecordingMock.mockResolvedValue({ success: true });
        stopRecordingMock.mockResolvedValue({ success: true });
    });

    it('restarts active recording after RTSP URL changes', async () => {
        await runUpdate({ private_rtsp_url: 'rtsp://user:pass@10.0.0.8/stream1' });

        expect(updateCameraPathMock).toHaveBeenCalledWith(
            'stream-key-7',
            'rtsp://user:pass@10.0.0.8/stream1',
            expect.objectContaining({ private_rtsp_url: 'rtsp://user:pass@10.0.0.8/stream1' })
        );
        expect(restartRecordingMock).toHaveBeenCalledWith(7, 'camera_source_updated');
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('restarts active recording after video codec changes', async () => {
        await runUpdate({ video_codec: 'h265' });

        expect(restartRecordingMock).toHaveBeenCalledWith(7, 'camera_source_updated');
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('stops recording when delivery changes to a non-recordable type', async () => {
        await runUpdate({
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            external_stream_url: 'https://example.test/live.mjpeg',
        });

        expect(removeCameraPathByKeyMock).toHaveBeenCalledWith('stream-key-7');
        expect(stopRecordingMock).toHaveBeenCalledWith(7, expect.objectContaining({
            reason: 'camera_source_updated',
        }));
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(startRecordingMock).not.toHaveBeenCalled();
    });

    it('starts recording when an enabled recordable camera is enabled from disabled state', async () => {
        await runUpdate({ enabled: 1 }, createExistingCamera({
            enabled: 0,
            recording_status: 'stopped',
        }));

        expect(startRecordingMock).toHaveBeenCalledWith(7);
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('does not restart recording for metadata-only edits', async () => {
        await runUpdate({ name: 'Gate Camera Updated', location: 'North Gate' });

        expect(updateCameraPathMock).not.toHaveBeenCalled();
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js
```

Expected result before implementation:

```text
FAIL backend/__tests__/cameraServiceRecordingLifecycle.test.js
AssertionError: expected "spy" to be called with arguments: [ 7, 'camera_source_updated' ]
```

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git status --short
git add backend/__tests__/cameraServiceRecordingLifecycle.test.js
git commit -m "Add: cover recording reconcile on camera updates"
git push
```

Expected result:

```text
[branch ...] Add: cover recording reconcile on camera updates
```

## Task 2: Add Camera Update Recording Reconcile Helpers

**Files:**
- Modify: `backend/services/cameraService.js`

- [ ] **Step 1: Add helper functions near existing recording helper functions**

In `backend/services/cameraService.js`, insert this block after `isRecordableDeliveryType(deliveryType)`:

```javascript
function boolEnabled(value) {
    return value === 1 || value === true;
}

function hasOwn(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload, key);
}

function resolveUpdatedCameraSnapshot(existingCamera, data, deliveryConfig) {
    return {
        ...existingCamera,
        enabled: hasOwn(data, 'enabled') ? (boolEnabled(data.enabled) ? 1 : 0) : existingCamera.enabled,
        enable_recording: hasOwn(data, 'enable_recording')
            ? (isRecordableDeliveryType(deliveryConfig.deliveryType) && boolEnabled(data.enable_recording) ? 1 : 0)
            : existingCamera.enable_recording,
        private_rtsp_url: hasOwn(data, 'private_rtsp_url') ? (data.private_rtsp_url || '') : existingCamera.private_rtsp_url,
        delivery_type: deliveryConfig.deliveryType,
        stream_source: deliveryConfig.compatStreamSource,
        external_hls_url: deliveryConfig.externalHlsUrl,
        external_stream_url: deliveryConfig.externalStreamUrl,
        external_embed_url: deliveryConfig.externalEmbedUrl,
        external_snapshot_url: deliveryConfig.externalSnapshotUrl,
        external_origin_mode: deliveryConfig.externalOriginMode,
        video_codec: hasOwn(data, 'video_codec') ? data.video_codec : existingCamera.video_codec,
        internal_rtsp_transport_override: hasOwn(data, 'internal_rtsp_transport_override')
            ? normalizeInternalRtspTransport(data.internal_rtsp_transport_override)
            : existingCamera.internal_rtsp_transport_override,
    };
}

function didRecordingSourceChange(existingCamera, updatedCamera, data) {
    const sourceKeys = [
        'private_rtsp_url',
        'delivery_type',
        'stream_source',
        'external_hls_url',
        'external_stream_url',
        'video_codec',
        'internal_rtsp_transport_override',
    ];

    if (hasOwn(data, 'enabled') && boolEnabled(existingCamera.enabled) !== boolEnabled(updatedCamera.enabled)) {
        return true;
    }

    return sourceKeys.some((key) => String(existingCamera[key] ?? '') !== String(updatedCamera[key] ?? ''));
}

function shouldRecordingBeActive(camera) {
    return boolEnabled(camera.enabled)
        && boolEnabled(camera.enable_recording)
        && isRecordableDeliveryType(camera.delivery_type);
}
```

- [ ] **Step 2: Run the focused test and verify it still fails only on missing lifecycle calls**

Run:

```powershell
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js
```

Expected result:

```text
FAIL backend/__tests__/cameraServiceRecordingLifecycle.test.js
AssertionError: expected "spy" to be called with arguments
```

- [ ] **Step 3: Commit helper skeleton**

Run:

```powershell
git status --short
git add backend/services/cameraService.js
git commit -m "Add: recording reconcile helpers"
git push
```

Expected result:

```text
[branch ...] Add: recording reconcile helpers
```

## Task 3: Wire Recording Reconcile After Camera Updates

**Files:**
- Modify: `backend/services/cameraService.js`

- [ ] **Step 1: Compute updated camera snapshot and source change**

In `backend/services/cameraService.js`, replace the block starting at `const currentDeliveryType = deliveryConfig.deliveryType;` through the `rtspTransportChanged` declaration with:

```javascript
        const updatedCamera = resolveUpdatedCameraSnapshot(existingCamera, data, deliveryConfig);
        const currentDeliveryType = deliveryConfig.deliveryType;
        const newEnabled = updatedCamera.enabled;
        const newRtspUrl = updatedCamera.private_rtsp_url;
        const newAreaId = area_id !== undefined ? area_id : existingCamera.area_id;
        const rtspChanged = private_rtsp_url !== undefined && private_rtsp_url !== existingCamera.private_rtsp_url;
        const enabledChanged = enabled !== undefined && boolEnabled(enabled) !== boolEnabled(existingCamera.enabled);
        const rtspTransportChanged = internal_rtsp_transport_override !== undefined
            && normalizeInternalRtspTransport(internal_rtsp_transport_override) !== existingCamera.internal_rtsp_transport_override;
        const recordingSourceChanged = didRecordingSourceChange(existingCamera, updatedCamera, data);
```

- [ ] **Step 2: Replace enable-only recording block with reconcile block**

In `backend/services/cameraService.js`, replace the whole block starting at `if (enable_recording !== undefined) {` and ending before `async deleteCamera(id, request) {` with:

```javascript
        const oldShouldRecord = shouldRecordingBeActive(existingCamera);
        const nextShouldRecord = shouldRecordingBeActive(updatedCamera);
        const shouldReconcileRecording = enable_recording !== undefined || recordingSourceChanged;

        if (shouldReconcileRecording) {
            const { recordingService } = await import('./recordingService.js');
            const cameraId = parseInt(id, 10);

            if (!nextShouldRecord) {
                if (oldShouldRecord || enable_recording !== undefined || recordingSourceChanged) {
                    console.log(`[Camera ${id}] Stopping recording after camera update`);
                    try {
                        await recordingService.stopRecording(cameraId, { reason: 'camera_source_updated' });
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to stop recording:`, err.message);
                    }
                }
            } else if (!oldShouldRecord) {
                console.log(`[Camera ${id}] Starting recording after camera update`);
                try {
                    await recordingService.startRecording(cameraId);
                } catch (err) {
                    console.error(`[Camera ${id}] Failed to start recording:`, err.message);
                }
            } else if (recordingSourceChanged) {
                console.log(`[Camera ${id}] Restarting recording after source update`);
                try {
                    await recordingService.restartRecording(cameraId, 'camera_source_updated');
                } catch (err) {
                    console.error(`[Camera ${id}] Failed to restart recording:`, err.message);
                }
            }
        }
```

- [ ] **Step 3: Run focused test and verify it passes**

Run:

```powershell
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js
```

Expected result:

```text
PASS backend/__tests__/cameraServiceRecordingLifecycle.test.js
```

- [ ] **Step 4: Run existing related backend tests**

Run:

```powershell
cd backend
npm test -- cameraBulkArea.test.js cameraDelivery.test.js recordingService.test.js recordingProcessManager.test.js
```

Expected result:

```text
PASS backend/__tests__/cameraBulkArea.test.js
PASS backend/__tests__/cameraDelivery.test.js
PASS backend/__tests__/recordingService.test.js
PASS backend/__tests__/recordingProcessManager.test.js
```

- [ ] **Step 5: Commit implementation**

Run:

```powershell
git status --short
git add backend/services/cameraService.js
git commit -m "Fix: reconcile recording after camera source updates"
git push
```

Expected result:

```text
[branch ...] Fix: reconcile recording after camera source updates
```

## Task 4: Document Recording Lifecycle Flow

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update cross-service side effects documentation**

In `backend/services/.module_map.md`, replace this bullet:

```markdown
- Camera mutations may invalidate cache, write audit logs, update MediaMTX, update runtime/health state, and start/stop recording for recordable HLS delivery types (`internal_hls`, `external_hls`). Internal RTSP transport and thumbnail strategy changes are opt-in and preserve existing behavior unless a camera override is set.
```

with:

```markdown
- Camera mutations may invalidate cache, write audit logs, update MediaMTX, update runtime/health state, and reconcile recording for recordable HLS delivery types (`internal_hls`, `external_hls`). RTSP URL, codec, delivery, enabled-state, external HLS URL, and internal RTSP transport changes must restart/start/stop FFmpeg automatically so operators do not need a manual disable/enable cycle. Internal RTSP transport and thumbnail strategy changes are opt-in and preserve existing behavior unless a camera override is set.
```

- [ ] **Step 2: Run focused tests once after documentation change**

Run:

```powershell
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js cameraBulkArea.test.js recordingService.test.js
```

Expected result:

```text
PASS backend/__tests__/cameraServiceRecordingLifecycle.test.js
PASS backend/__tests__/cameraBulkArea.test.js
PASS backend/__tests__/recordingService.test.js
```

- [ ] **Step 3: Commit documentation**

Run:

```powershell
git status --short
git add backend/services/.module_map.md
git commit -m "Add: document recording reconcile flow"
git push
```

Expected result:

```text
[branch ...] Add: document recording reconcile flow
```

## Task 5: Final Backend Verification

**Files:**
- No file changes expected.

- [ ] **Step 1: Run backend migration and full test gate**

Run:

```powershell
cd backend
npm run migrate
npm test
```

Expected result:

```text
All migrations completed
Test Files  all passed
Tests  all passed
```

- [ ] **Step 2: Check final git status**

Run:

```powershell
git status --short
```

Expected result:

```text
```

No output means the working tree is clean.

## Self-Review

- Spec coverage: The plan covers RTSP/IP changes, codec h264/h265 changes, delivery eligibility changes, enabled-state transitions, external HLS source changes, automatic start/stop/restart, tests, docs, commit, and push.
- Placeholder scan: No unresolved markers, deferred edge cases, or duplicated-step shortcuts remain.
- Type consistency: Helper names used in implementation tasks match test expectations and existing service APIs: `restartRecording(cameraId, reason)`, `startRecording(cameraId)`, and `stopRecording(cameraId, options)`.
