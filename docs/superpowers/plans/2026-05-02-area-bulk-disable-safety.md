# Area Bulk Disable Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Area Management bulk disable actions safe for mixed camera areas without weakening protections for type-specific enable/policy actions.

**Architecture:** Keep the change inside existing bulk-area flow. Backend eligibility helpers in `cameraService.js` decide whether a payload is a broad fail-safe disable or a restricted policy update; tests lock behavior for mixed internal, external, and unresolved cameras. Frontend changes are limited to operator-facing copy, because backend is the source of truth.

**Tech Stack:** Node.js 20+, Fastify service layer, SQLite access through `connectionPool.js`, Vitest, React 18 Area Management page.

Purpose: Implementation checklist for approved area bulk disable safety design.
Caller: Agentic worker executing the approved design.
Deps: `backend/services/cameraService.js`, `backend/__tests__/cameraBulkArea.test.js`, `frontend/src/pages/AreaManagement.jsx`.
MainFuncs: Plan tasks for backend tests, eligibility helpers, bulk summary messaging, optional UI guidance, and verification.
SideEffects: Documentation only until executed; implementation will change bulk area update behavior.

---

## File Structure

- Modify `backend/__tests__/cameraBulkArea.test.js`: add mixed-area fixtures and five targeted regression tests before changing production code.
- Modify `backend/services/cameraService.js`: add payload-intent helpers near existing bulk target helpers; update `getBulkEligibility()` only.
- Modify `frontend/src/pages/AreaManagement.jsx`: add short helper text below the relevant selects if backend behavior changes are accepted by tests.
- No database migration is required.
- No route/controller change is required because `bulkUpdateArea()` already returns the needed summary shape.

## Verification Commands

Use the compatible Vitest runner because local Node is known to be older than the version required by the repo-installed Vitest/Rolldown pair.

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
@'
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
    },
});
'@ | Set-Content -LiteralPath $config
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected final result:

```text
Test Files  1 passed
Tests       7 passed
```

---

### Task 1: Add Mixed-Area Regression Fixtures And Public Disable Test

**Files:**
- Modify: `backend/__tests__/cameraBulkArea.test.js`

- [ ] **Step 1: Add reusable mixed-area camera fixture**

Add this helper below the imports and above `describe('cameraService.bulkUpdateArea', ...)`:

```javascript
function createMixedAreaCameras() {
    return [
        {
            id: 11,
            name: 'Cam Internal',
            area_id: 7,
            enabled: 1,
            is_online: 1,
            enable_recording: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://internal/cam-11',
            external_hls_url: null,
            external_stream_url: null,
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 12,
            name: 'Cam HLS',
            area_id: 7,
            enabled: 1,
            is_online: 1,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: 'external_hls',
            private_rtsp_url: null,
            external_hls_url: 'https://example.com/cam-12/index.m3u8',
            external_stream_url: 'https://example.com/cam-12/index.m3u8',
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 13,
            name: 'Cam MJPEG',
            area_id: 7,
            enabled: 1,
            is_online: 0,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            private_rtsp_url: null,
            external_hls_url: null,
            external_stream_url: 'https://example.com/cam-13/live.mjpeg',
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 14,
            name: 'Cam Unresolved',
            area_id: 7,
            enabled: 1,
            is_online: 0,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: null,
            private_rtsp_url: null,
            external_hls_url: null,
            external_stream_url: null,
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
    ];
}
```

- [ ] **Step 2: Write failing preview test for public disable**

Add this test inside the `describe` block:

```javascript
    it('mengizinkan bulk status publik matikan untuk mixed area tanpa external-only lock', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enabled: 0,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 4,
            blockedCount: 0,
        }));
        expect(result.summary.blockedReasons).toEqual([]);
    });
```

- [ ] **Step 3: Run the targeted test and confirm baseline**

Run:

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected: existing tests pass and the new public disable test should also pass. If it fails, keep the failure output because it identifies whether frontend effective filter or backend eligibility is already interfering.

- [ ] **Step 4: Commit test fixture and public disable coverage**

```powershell
git add backend/__tests__/cameraBulkArea.test.js
git commit -m "Add: area bulk public disable coverage"
git push origin main
```

---

### Task 2: Add Recording Disable And Recording Enable Protection Tests

**Files:**
- Modify: `backend/__tests__/cameraBulkArea.test.js`

- [ ] **Step 1: Write failing preview test for recording disable**

Add this test inside the `describe` block:

```javascript
    it('mengizinkan bulk recording matikan untuk mixed area tanpa internal-only block', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 0,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 4,
            blockedCount: 0,
        }));
        expect(result.summary.blockedReasons).toEqual([]);
    });
```

- [ ] **Step 2: Write protection test for recording enable**

Add this test inside the `describe` block:

```javascript
    it('tetap membatasi bulk recording aktifkan hanya untuk kamera internal', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 1,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 1,
            blockedCount: 3,
        }));
        expect(result.summary.blockedReasons).toEqual([
            { reason: 'internal_only_policy', count: 3 },
        ]);
        expect(result.summary.blockedExamples).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 12, reason: 'internal_only_policy' }),
            expect.objectContaining({ id: 13, reason: 'internal_only_policy' }),
            expect.objectContaining({ id: 14, reason: 'internal_only_policy' }),
        ]));
    });
```

- [ ] **Step 3: Run tests to confirm one failure**

Run:

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected before implementation: recording disable fails because non-internal cameras are blocked with `internal_only_policy`; recording enable remains protected.

---

### Task 3: Implement Payload Intent Helpers And Recording Disable Eligibility

**Files:**
- Modify: `backend/services/cameraService.js`

- [ ] **Step 1: Add helper functions near existing bulk policy helpers**

Insert these functions above `requiresExternalHlsAreaPolicy()`:

```javascript
function isRecordingDisable(payload = {}) {
    return payload.enable_recording === 0 || payload.enable_recording === false;
}

function isRecordingEnable(payload = {}) {
    return payload.enable_recording === 1 || payload.enable_recording === true;
}

function isPublicStatusDisable(payload = {}) {
    return payload.enabled === 0 || payload.enabled === false;
}

function isHealthMonitoringDisable(payload = {}) {
    return payload.external_health_mode === 'disabled';
}
```

- [ ] **Step 2: Replace recording eligibility block**

Find this exact block:

```javascript
    if ((operation === 'policy_update' || operation === 'maintenance') && payload.enable_recording !== undefined) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }
```

Replace with:

```javascript
    if ((operation === 'policy_update' || operation === 'maintenance') && isRecordingEnable(payload)) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }
```

Rationale: `enable_recording = 0` is a safe disable and must not be blocked by delivery type; `enable_recording = 1` still requires internal cameras.

- [ ] **Step 3: Run bulk area tests**

Run:

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected: all current tests pass, including recording disable and recording enable protection.

- [ ] **Step 4: Commit backend eligibility change**

```powershell
git add backend/services/cameraService.js backend/__tests__/cameraBulkArea.test.js
git commit -m "Fix: allow area bulk recording disable"
git push origin main
```

---

### Task 4: Add Health Monitoring Disable Summary Test

**Files:**
- Modify: `backend/__tests__/cameraBulkArea.test.js`

- [ ] **Step 1: Add preview test for health monitoring disabled**

Add this test inside the `describe` block:

```javascript
    it('mengarahkan health monitoring disabled ke external valid dan memberi summary jelas', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                external_health_mode: 'disabled',
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('external_streams_only');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 2,
            eligibleCount: 2,
            blockedCount: 0,
        }));
        expect(result.guidance).toContain('external_streams_only');
        expect(result.guidance).toContain('health monitoring policy');
    });
```

- [ ] **Step 2: Run tests**

Run:

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected: pass. This confirms existing external-stream target normalization is retained and the message is not the misleading external-HLS proxy message.

- [ ] **Step 3: Commit health disable coverage**

```powershell
git add backend/__tests__/cameraBulkArea.test.js
git commit -m "Add: area bulk health disable coverage"
git push origin main
```

---

### Task 5: Add Apply-Mode Recording Disable Regression Test

**Files:**
- Modify: `backend/__tests__/cameraBulkArea.test.js`

- [ ] **Step 1: Mock update path and assert every mixed camera receives disable patch**

Add this test inside the `describe` block:

```javascript
    it('apply bulk recording matikan mengirim patch ke semua kamera mixed area', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(cameraService, 'invalidateCameraCache').mockImplementation(() => {});
        const updateSpy = vi.spyOn(cameraService, 'updateCamera').mockResolvedValue({ success: true });

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 0,
            },
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.success).toBe(true);
        expect(result.changes).toBe(4);
        expect(updateSpy).toHaveBeenCalledTimes(4);
        expect(updateSpy).toHaveBeenNthCalledWith(1, 11, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(2, 12, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(3, 13, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(4, 14, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
    });
```

- [ ] **Step 2: Run tests**

Run:

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected: pass. This covers the real apply path, not only preview summary.

- [ ] **Step 3: Commit apply coverage**

```powershell
git add backend/__tests__/cameraBulkArea.test.js
git commit -m "Add: area bulk recording disable apply coverage"
git push origin main
```

---

### Task 6: Clarify Area Management Operator Copy

**Files:**
- Modify: `frontend/src/pages/AreaManagement.jsx`

- [ ] **Step 1: Add copy below Health Monitoring select**

Find the `Health Monitoring` select container and add this paragraph after the closing `</select>`:

```jsx
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Berlaku untuk kamera external valid; kamera internal atau metadata belum lengkap akan dilewati oleh preview.
                                        </p>
```

- [ ] **Step 2: Add copy below Recording select**

Find the `Recording` select container and add this paragraph after the closing `</select>`:

```jsx
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Matikan aman untuk semua tipe kamera; aktifkan recording tetap diproteksi untuk kamera internal.
                                        </p>
```

- [ ] **Step 3: Add copy below Status Publik select**

Find the `Status Publik` select container and add this paragraph after the closing `</select>`:

```jsx
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Matikan menyembunyikan semua kamera terpilih dari publik tanpa bergantung pada tipe delivery.
                                        </p>
```

- [ ] **Step 4: Run frontend lint if dependencies are available**

Run:

```powershell
cd frontend
npm run lint
```

Expected: lint passes. If npm dependencies are unavailable, record the exact blocker and continue with backend verification.

- [ ] **Step 5: Commit UI copy**

```powershell
git add frontend/src/pages/AreaManagement.jsx
git commit -m "Add: clarify area bulk disable guidance"
git push origin main
```

---

### Task 7: Final Verification And Risk Check

**Files:**
- Check: `backend/__tests__/cameraBulkArea.test.js`
- Check: `backend/services/cameraService.js`
- Check: `frontend/src/pages/AreaManagement.jsx`

- [ ] **Step 1: Run backend targeted suite**

```powershell
$config = Join-Path $env:TEMP 'cctv-vitest-node.config.mjs'
npx -y vitest@3.2.4 --run backend/__tests__/cameraBulkArea.test.js --config $config
```

Expected:

```text
Test Files  1 passed
Tests       7 passed
```

- [ ] **Step 2: Run git diff review**

```powershell
git status --short
git diff -- backend/services/cameraService.js backend/__tests__/cameraBulkArea.test.js frontend/src/pages/AreaManagement.jsx
```

Expected:

```text
git status --short
```

shows no unintended files except the current task files before commit. The diff should show only eligibility helper additions, recording enable eligibility replacement, tests, and copy text.

- [ ] **Step 3: Commit any remaining verified changes**

If `git status --short` still shows verified uncommitted task changes:

```powershell
git add backend/services/cameraService.js backend/__tests__/cameraBulkArea.test.js frontend/src/pages/AreaManagement.jsx
git commit -m "Fix: harden area bulk disable behavior"
git push origin main
```

- [ ] **Step 4: Report residual risks**

Final response must mention:

```text
Verified: backend/__tests__/cameraBulkArea.test.js with vitest@3.2.4.
Residual risk: full backend suite may still be blocked locally by Node/Vitest version mismatch unless Node is upgraded to a compatible version.
```

---

## Self-Review

- Spec coverage: public disable, recording disable, recording enable protection, health monitoring disabled summary, UI guidance, and targeted verification are all mapped to tasks.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: payload keys match existing `bulkUpdateArea()` code: `enabled`, `enable_recording`, `external_health_mode`, `targetFilter`, `operation`, and `preview`.
