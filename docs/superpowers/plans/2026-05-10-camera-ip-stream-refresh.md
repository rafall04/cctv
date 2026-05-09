<!--
Purpose: Implementation plan for fixing live stream reconnect behavior after Camera Management source/IP updates.
Caller: Agentic workers implementing the Camera Management stream refresh fix.
Deps: SYSTEM_MAP.md, backend/services/.module_map.md, cameraService.js, mediaMtxService.js, cameraHealthService.js, VideoPlayer.jsx.
MainFuncs: Defines ordered TDD tasks, target files, expected behavior, verification commands, and commit boundaries.
SideEffects: None; documentation only.
-->

# Camera IP Stream Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Updating CCTV IP/source/RTSP transport/codec from Camera Management must reconnect MediaMTX and live HLS without requiring manual disable, waiting, and enable.

**Architecture:** Treat source updates as runtime lifecycle changes, not only database/config edits. Backend owns MediaMTX path refresh and health runtime reset; frontend only performs a hard player reload when the backend reports a stream source refresh.

**Tech Stack:** Node.js 20+, Fastify, Vitest, MediaMTX v1.9.0 Control API, React 18, Vite, HLS.js.

---

## File Structure

- Modify: `backend/services/mediaMtxService.js`
  - Add a focused MediaMTX path refresh method for source changes.
  - Keep existing `updateCameraPath()` behavior for non-source changes.
- Modify: `backend/services/cameraService.js`
  - Call MediaMTX refresh when source-affecting fields change.
  - Reset camera health runtime after source-affecting updates.
  - Preserve existing recording reconcile behavior.
- Modify: `backend/services/cameraHealthService.js`
  - Add a narrow runtime reset method for one camera/path.
  - Avoid broad health-loop refactor.
- Modify: `backend/services/.module_map.md`
  - Document new source update side effect.
- Test: `backend/__tests__/mediaMtxService.test.js`
  - Cover refresh behavior and fallback strategy.
- Test: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`
  - Extend camera update tests to verify stream refresh is invoked.
- Optional later modify: `frontend/src/hooks/admin/useCameraManagementPage.js`
  - Surface backend refresh result to users.
- Optional later modify: `frontend/src/components/VideoPlayer.jsx`
  - Force remount/reload only if backend reset is not enough for open players.

---

## Behavior Contract

- Source-affecting fields:
  - `private_rtsp_url`
  - `internal_rtsp_transport_override`
  - `delivery_type`
  - `stream_source`
  - `video_codec`
  - `enabled`
- If only metadata changes, such as `name`, `description`, `area_id`, or coordinates, do not reset MediaMTX path.
- If an internal HLS camera source changes while enabled, backend must:
  - update the MediaMTX path config,
  - force a path lifecycle refresh,
  - clear stale health runtime signals,
  - return update success even if MediaMTX refresh fails, but include a warning/result for diagnostics.
- If camera is disabled after update, backend must remove or leave inactive path according to current existing behavior; do not start a new stream.
- Recording reconcile remains separate and must still run after source/codec/delivery changes.

---

### Task 1: Add MediaMTX Path Refresh Test

**Files:**
- Modify: `backend/__tests__/mediaMtxService.test.js`
- Modify later: `backend/services/mediaMtxService.js`

- [ ] **Step 1: Locate current MediaMTX service tests**

Run:

```bash
cd backend
npm test -- mediaMtxService.test.js
```

Expected: existing MediaMTX service tests pass before changes.

- [ ] **Step 2: Add failing test for source refresh fallback**

Add a test that mocks the MediaMTX API calls in this order:

```text
GET /v3/config/paths/get/<streamKey> -> 200 old config
PATCH or POST /v3/config/paths/patch/<streamKey> -> 200
DELETE /v3/config/paths/delete/<streamKey> -> 200
POST /v3/config/paths/add/<streamKey> -> 200
```

Expected assertion:

```javascript
expect(result).toMatchObject({
    success: true,
    action: 'refreshed',
    pathName: streamKey,
});
```

Expected: FAIL because `refreshCameraPathAfterSourceChange()` does not exist.

- [ ] **Step 3: Add failing test for no-op when config already missing**

Mock:

```text
GET /v3/config/paths/get/<streamKey> -> 404
POST /v3/config/paths/add/<streamKey> -> 200
```

Expected assertion:

```javascript
expect(result).toMatchObject({
    success: true,
    action: 'created',
    pathName: streamKey,
});
```

Expected: FAIL until implementation handles missing path safely.

- [ ] **Step 4: Run focused test and capture failure**

Run:

```bash
cd backend
npm test -- mediaMtxService.test.js -t "refresh"
```

Expected: FAIL with missing method or unexpected API calls.

---

### Task 2: Implement MediaMTX Path Refresh

**Files:**
- Modify: `backend/services/mediaMtxService.js`
- Test: `backend/__tests__/mediaMtxService.test.js`

- [ ] **Step 1: Add method skeleton with Header Doc preserved**

Add method inside the existing service class:

```javascript
async refreshCameraPathAfterSourceChange(streamKey, rtspUrl, camera = {}) {
    const pathName = this.normalizePathName(streamKey);
    const pathConfig = this.buildInternalPathConfig({
        ...camera,
        rtsp_url: rtspUrl,
    });

    return this.refreshPathConfig(pathName, pathConfig);
}
```

Expected: test still fails because `refreshPathConfig()` does not exist.

- [ ] **Step 2: Implement refresh helper using delete plus add fallback**

Implement private-style class method:

```javascript
async refreshPathConfig(pathName, pathConfig) {
    const currentConfig = await this.getPathConfig(pathName).catch((error) => {
        if (error?.statusCode === 404 || error?.response?.status === 404) {
            return null;
        }
        throw error;
    });

    if (!currentConfig) {
        await this.writePathConfig('add', pathName, pathConfig);
        return {
            success: true,
            action: 'created',
            pathName,
        };
    }

    await this.writePathConfig('patch', pathName, pathConfig);

    try {
        await this.writePathConfig('delete', pathName);
        await this.writePathConfig('add', pathName, pathConfig);
        return {
            success: true,
            action: 'refreshed',
            pathName,
        };
    } catch (error) {
        console.error(`MediaMTX path refresh failed for ${pathName}:`, error);
        return {
            success: false,
            action: 'patch_only',
            pathName,
            message: error.message,
        };
    }
}
```

If existing helper names differ, adapt to the exact local method names already used by `updateCameraPath()`.

- [ ] **Step 3: Run focused MediaMTX tests**

Run:

```bash
cd backend
npm test -- mediaMtxService.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit MediaMTX refresh unit**

Run:

```bash
git status
git add backend/services/mediaMtxService.js backend/__tests__/mediaMtxService.test.js
git commit -m "Fix: refresh MediaMTX path after camera source change"
```

Expected: commit succeeds with only those two files staged.

---

### Task 3: Add Camera Update Wiring Test

**Files:**
- Modify: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`
- Modify later: `backend/services/cameraService.js`

- [ ] **Step 1: Add test for RTSP URL update invoking stream refresh**

Add a test case in the existing camera update suite:

```javascript
it('refreshes MediaMTX path when internal camera RTSP URL changes', async () => {
    mediaMtxService.refreshCameraPathAfterSourceChange = vi.fn().mockResolvedValue({
        success: true,
        action: 'refreshed',
        pathName: 'camera-1',
    });

    const result = await cameraService.updateCamera(1, {
        private_rtsp_url: 'rtsp://192.168.1.200:554/stream1',
        delivery_type: 'internal_hls',
        enabled: 1,
    });

    expect(result.success).toBe(true);
    expect(mediaMtxService.refreshCameraPathAfterSourceChange).toHaveBeenCalledWith(
        expect.any(String),
        'rtsp://192.168.1.200:554/stream1',
        expect.objectContaining({
            delivery_type: 'internal_hls',
        })
    );
});
```

Adapt fixture camera ID/fields to the existing test setup.

- [ ] **Step 2: Add test that metadata-only update does not refresh path**

Add:

```javascript
it('does not refresh MediaMTX path for metadata-only camera updates', async () => {
    mediaMtxService.refreshCameraPathAfterSourceChange = vi.fn().mockResolvedValue({
        success: true,
    });

    const result = await cameraService.updateCamera(1, {
        name: 'Updated Name Only',
    });

    expect(result.success).toBe(true);
    expect(mediaMtxService.refreshCameraPathAfterSourceChange).not.toHaveBeenCalled();
});
```

Expected: FAIL until camera service uses the new refresh method selectively.

- [ ] **Step 3: Run focused failing test**

Run:

```bash
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js -t "MediaMTX path"
```

Expected: FAIL because `cameraService.updateCamera()` still calls only `updateCameraPath()`.

---

### Task 4: Wire Camera Update To Stream Refresh

**Files:**
- Modify: `backend/services/cameraService.js`
- Test: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`

- [ ] **Step 1: Add source-affecting detection near existing update comparison**

Use the already-loaded previous camera and updated camera values. Add:

```javascript
const streamSourceChanged = [
    rtspChanged,
    rtspTransportChanged,
    deliveryChanged,
    streamSourceChanged,
    codecChanged,
].some(Boolean);
```

If a local variable already uses `streamSourceChanged`, name this `requiresStreamRuntimeRefresh`.

- [ ] **Step 2: Replace internal source update call**

For enabled internal HLS cameras, use:

```javascript
let streamRefreshResult = null;

if (updatedCamera.delivery_type === 'internal_hls' && updatedCamera.private_rtsp_url) {
    if (requiresStreamRuntimeRefresh) {
        streamRefreshResult = await mediaMtxService.refreshCameraPathAfterSourceChange(
            updatedCamera.stream_key,
            updatedCamera.private_rtsp_url,
            updatedCamera
        );
    } else if (rtspChanged || rtspTransportChanged || updatedCamera.enabled) {
        streamRefreshResult = await mediaMtxService.updateCameraPath(
            updatedCamera.stream_key,
            updatedCamera.private_rtsp_url,
            updatedCamera
        );
    }
}
```

Preserve existing logging and error handling style around MediaMTX failures.

- [ ] **Step 3: Include refresh result in service response data**

Add a diagnostic field without changing API success shape:

```javascript
return {
    success: true,
    message: 'Camera updated successfully',
    data: updatedCamera,
    stream_refresh: streamRefreshResult,
};
```

If current method returns only camera data, adapt minimally and keep existing route/controller response compatibility.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd backend
npm test -- cameraServiceRecordingLifecycle.test.js
```

Expected: PASS.

---

### Task 5: Reset Health Runtime After Source Update

**Files:**
- Modify: `backend/services/cameraHealthService.js`
- Modify: `backend/services/cameraService.js`
- Test: `backend/__tests__/cameraHealthService.test.js`
- Test: `backend/__tests__/cameraServiceRecordingLifecycle.test.js`

- [ ] **Step 1: Add failing health reset test**

Add a focused test:

```javascript
it('clears per-camera runtime health state after source refresh', () => {
    cameraHealthService.healthState.set(1, { isOnline: true, reason: 'old_path_ready' });
    cameraHealthService.probeCache.set('camera:1', { status: 'online' });
    cameraHealthService.internalPathRepairBackoff.set('camera-1', Date.now());
    cameraHealthService.lastActivePathMap.set('camera-1', { ready: true });

    cameraHealthService.clearCameraRuntimeState(1, 'camera-1');

    expect(cameraHealthService.healthState.has(1)).toBe(false);
    expect(cameraHealthService.probeCache.has('camera:1')).toBe(false);
    expect(cameraHealthService.internalPathRepairBackoff.has('camera-1')).toBe(false);
    expect(cameraHealthService.lastActivePathMap.has('camera-1')).toBe(false);
});
```

Adapt map keys to the exact keys used in `cameraHealthService.js`.

- [ ] **Step 2: Implement narrow reset method**

Add to `cameraHealthService.js`:

```javascript
clearCameraRuntimeState(cameraId, pathName) {
    this.healthState.delete(Number(cameraId));
    this.probeCache.delete(`camera:${cameraId}`);

    if (pathName) {
        this.internalPathRepairBackoff.delete(pathName);
        this.lastActivePathMap.delete(pathName);
    }
}
```

Do not alter scheduling, scoring, Telegram, or DB write logic in this task.

- [ ] **Step 3: Wire reset after stream refresh attempt**

In `cameraService.updateCamera()` after source refresh:

```javascript
if (requiresStreamRuntimeRefresh) {
    cameraHealthService.clearCameraRuntimeState(
        updatedCamera.id,
        updatedCamera.stream_key
    );
}
```

Use existing import style. If importing `cameraHealthService` creates a circular dependency, extract the reset to a tiny helper service instead of importing routes/controllers.

- [ ] **Step 4: Run health and camera focused tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraServiceRecordingLifecycle.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit health reset unit**

Run:

```bash
git status
git add backend/services/cameraHealthService.js backend/services/cameraService.js backend/__tests__/cameraHealthService.test.js backend/__tests__/cameraServiceRecordingLifecycle.test.js
git commit -m "Fix: reset camera health runtime after source update"
```

Expected: commit succeeds with only relevant files staged.

---

### Task 6: Update Service Map Documentation

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update Cross-Service Side Effects**

Append this sentence to the camera mutation bullet:

```markdown
Live internal HLS source changes must refresh the MediaMTX path lifecycle and clear per-camera health runtime caches so stale active paths do not leave Camera Management stuck in reconnecting state.
```

- [ ] **Step 2: Commit documentation**

Run:

```bash
git status
git add backend/services/.module_map.md
git commit -m "Docs: document camera source refresh flow"
```

Expected: commit succeeds.

---

### Task 7: Backend Verification Gate

**Files:**
- No edits.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd backend
npm test -- mediaMtxService.test.js cameraServiceRecordingLifecycle.test.js cameraHealthService.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full backend gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: migrations complete and all backend tests pass.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status
```

Expected: clean except intentional commits already created.

---

### Task 8: Manual Runtime Verification

**Files:**
- No edits unless runtime exposes a new bug.

- [ ] **Step 1: Start backend and MediaMTX in normal dev mode**

Run:

```bash
cd backend
npm run dev
```

Expected: Fastify starts, MediaMTX API is reachable, no startup error.

- [ ] **Step 2: Update one internal HLS camera IP in admin Camera Management**

Manual expected behavior:

```text
Save camera update
MediaMTX path refresh runs once
No manual disable/enable needed
Live player reconnects to new CCTV source
Recording reconcile still runs for recordable cameras
```

- [ ] **Step 3: Confirm MediaMTX path points to new source**

Run:

```bash
curl http://127.0.0.1:9997/v3/config/paths/get/<stream_key>
```

Expected: response `source` equals the new RTSP URL.

---

### Task 9: Frontend Follow-Up Only If Open Player Still Sticks

**Files:**
- Modify only if manual verification shows already-open players do not reload.
- Modify: `frontend/src/hooks/admin/useCameraManagementPage.js`
- Modify: `frontend/src/components/VideoPlayer.jsx`

- [ ] **Step 1: Add backend result awareness in camera management hook**

When `updateCamera()` returns `stream_refresh`, show a reconnecting notification:

```javascript
if (result.stream_refresh || result.data?.stream_refresh) {
    info('Stream Refresh', 'Camera source updated. Live stream is reconnecting.');
}
```

Use the existing notification API names in the hook.

- [ ] **Step 2: Force VideoPlayer remount on stream revision**

If the camera model includes `updated_at`, derive a stable revision:

```javascript
const streamRevision = camera?.updated_at || camera?.stream_revision || '';
const effectiveHlsUrl = streams?.hls
    ? `${streams.hls}${streams.hls.includes('?') ? '&' : '?'}v=${encodeURIComponent(streamRevision)}`
    : streams?.hls;
```

Use `effectiveHlsUrl` only for HLS loading; preserve token/query handling.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit frontend follow-up**

Run:

```bash
git status
git add frontend/src/hooks/admin/useCameraManagementPage.js frontend/src/components/VideoPlayer.jsx
git commit -m "Fix: reload live player after camera source refresh"
```

Expected: commit succeeds only if frontend edits were needed.

---

### Task 10: Push After Verified Fix

**Files:**
- No edits.

- [ ] **Step 1: Confirm branch and status**

Run:

```bash
git branch --show-current
git status
```

Expected: on intended branch, working tree clean.

- [ ] **Step 2: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds.

---

## Rollback Plan

- If MediaMTX delete/add refresh causes live instability, revert only the MediaMTX refresh commit and keep tests as evidence.
- If health reset causes noisy offline notifications, remove only the `clearCameraRuntimeState()` call from `cameraService.updateCamera()` and keep MediaMTX refresh in place.
- If frontend cache-busting breaks authenticated/proxied HLS URLs, revert frontend follow-up only; backend fix remains valid.

## Completion Criteria

- Updating internal HLS camera IP from Camera Management reconnects without manual disable/enable.
- Metadata-only camera edits do not reset MediaMTX path.
- Recording source reconcile from the previous fix still passes.
- Focused backend tests pass.
- Full backend test gate passes.
- Changes are committed and pushed to `main` only after verification.
