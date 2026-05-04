<!--
Purpose: Provide the implementation plan for customizable internal RTSP ingest policy.
Caller: Superpowers writing-plans handoff after approved internal ingest policy design.
Deps: docs/superpowers/specs/2026-05-04-internal-ingest-policy-design.md, backend stream/MediaMTX services, frontend area/camera admin UI.
MainFuncs: backend policy resolution, stream warmer filtering, admin area/camera controls, focused verification.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Internal Ingest Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins configure internal RTSP cameras as `always_on` or `on_demand` per area and per camera, with only `always_on` cameras prewarmed.

**Architecture:** Keep the existing DB columns and make `backend/utils/internalIngestPolicy.js` the pure source of truth for policy resolution. MediaMTX continues to configure all internal paths, while `streamWarmer` filters by the resolved policy. Frontend Area and Camera admin forms expose the existing fields and show resolved ingest badges without hardcoding Surabaya.

**Tech Stack:** Node.js 20 ES modules, Fastify backend services, better-sqlite3 through existing helpers, React 18/Vite frontend, Vitest.

---

## File Structure

- Modify `backend/utils/internalIngestPolicy.js`: change ordinary internal fallback to `always_on`; keep strict profile compatibility fallback as `on_demand`.
- Create `backend/__tests__/internalIngestPolicy.test.js`: pure policy coverage.
- Modify `backend/services/streamWarmer.js`: import `resolveInternalIngestPolicy()`, skip cameras whose resolved mode is not `always_on`, return a summary for tests/logging.
- Create `backend/__tests__/streamWarmer.test.js`: mocked axios/timer coverage for warm filtering.
- Modify `backend/__tests__/mediaMtxService.test.js`: add explicit always-on and on-demand path config assertions.
- Modify `frontend/src/components/admin/areas/AreaFormModal.jsx`: keep existing area policy controls and copy aligned with approved design.
- Modify `frontend/src/components/admin/areas/AreaFormModal.test.jsx`: assert area policy field changes are emitted.
- Modify `frontend/src/components/admin/cameras/CameraSourceFields.jsx`: keep existing camera override controls and copy aligned with approved design.
- Modify `frontend/src/utils/admin/cameraFormAdapter.test.js`: assert internal ingest override payload and external camera reset.
- Modify `frontend/src/components/admin/cameras/CameraCard.jsx`: show resolved ingest badge for internal cameras.
- Modify `frontend/src/pages/CameraManagement.test.jsx`: assert an internal camera can render the ingest badge.
- Modify `SYSTEM_MAP.md`, `backend/.module_map.md`, `backend/services/.module_map.md`, and `frontend/src/.module_map.md` only if implementation changes documented flow names or ownership.

---

### Task 1: Backend Policy Resolution

**Files:**
- Modify: `backend/utils/internalIngestPolicy.js`
- Create: `backend/__tests__/internalIngestPolicy.test.js`

- [ ] **Step 1: Write failing policy tests**

Create `backend/__tests__/internalIngestPolicy.test.js`:

```javascript
/*
Purpose: Validate internal RTSP ingest policy resolution for area defaults, camera overrides, and compatibility profiles.
Caller: Backend Vitest suite before changing MediaMTX or stream warmer behavior.
Deps: internalIngestPolicy utility.
MainFuncs: resolveInternalIngestPolicy, buildInternalIngestPolicySummary, normalizeOnDemandCloseAfterSeconds.
SideEffects: None; pure policy tests only.
*/

import { describe, expect, it } from 'vitest';
import {
    buildInternalIngestPolicySummary,
    normalizeOnDemandCloseAfterSeconds,
    resolveInternalIngestPolicy,
} from '../utils/internalIngestPolicy.js';

describe('internalIngestPolicy', () => {
    it('defaults ordinary internal RTSP cameras to always_on', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://local-camera/stream',
            internal_ingest_policy_override: 'default',
            source_profile: null,
            description: '',
            enable_recording: 1,
        }, {
            internal_ingest_policy_default: 'default',
        })).toMatchObject({
            mode: 'always_on',
            closeAfterSeconds: null,
            isStrictOnDemandProfile: false,
        });
    });

    it('uses area on_demand before ordinary global fallback', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 45,
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 45,
        });
    });

    it('uses camera override before area default', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://exception-camera/stream',
            internal_ingest_policy_override: 'always_on',
            internal_on_demand_close_after_seconds_override: 15,
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 45,
        })).toMatchObject({
            mode: 'always_on',
            closeAfterSeconds: null,
        });
    });

    it('keeps strict Surabaya compatibility profile on demand when no area or camera override exists', () => {
        expect(resolveInternalIngestPolicy({
            private_rtsp_url: 'rtsp://surabaya-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: 'surabaya_private_rtsp',
            enable_recording: 0,
        }, {
            internal_ingest_policy_default: 'default',
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 15,
            isStrictOnDemandProfile: true,
            sourceProfile: 'surabaya_private_rtsp',
        });
    });

    it('normalizes close-after seconds to the supported 5..300 range', () => {
        expect(normalizeOnDemandCloseAfterSeconds('1', null)).toBe(5);
        expect(normalizeOnDemandCloseAfterSeconds('301', null)).toBe(300);
        expect(normalizeOnDemandCloseAfterSeconds('', 30)).toBe(null);
        expect(normalizeOnDemandCloseAfterSeconds('bad', 30)).toBe(30);
    });

    it('builds a complete operator summary', () => {
        expect(buildInternalIngestPolicySummary({
            private_rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: '',
        }, {
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 20,
        })).toMatchObject({
            mode: 'on_demand',
            closeAfterSeconds: 20,
            cameraPolicyOverride: 'default',
            areaPolicyDefault: 'on_demand',
            cameraCloseAfterOverrideSeconds: null,
            areaCloseAfterDefaultSeconds: 20,
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- internalIngestPolicy.test.js
```

Expected: FAIL because ordinary internal cameras still resolve to `on_demand`.

- [ ] **Step 3: Change fallback resolution**

In `backend/utils/internalIngestPolicy.js`, replace the `mode` resolution block with:

```javascript
    let mode = cameraMode !== 'default'
        ? cameraMode
        : (areaMode !== 'default' ? areaMode : 'always_on');

    if (strictProfile && cameraMode === 'default' && areaMode === 'default') {
        mode = 'on_demand';
    }
```

Keep the existing close-after calculation unchanged because it already returns `null` for `always_on` and uses strict/general fallbacks for `on_demand`.

- [ ] **Step 4: Run focused policy test**

Run:

```bash
cd backend
npm test -- internalIngestPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/internalIngestPolicy.js backend/__tests__/internalIngestPolicy.test.js
git commit -m "Fix: resolve internal ingest policy defaults"
git push
```

---

### Task 2: Filter Stream Warmer By Policy

**Files:**
- Modify: `backend/services/streamWarmer.js`
- Create: `backend/__tests__/streamWarmer.test.js`

- [ ] **Step 1: Write failing warmer tests**

Create `backend/__tests__/streamWarmer.test.js`:

```javascript
/*
Purpose: Regression coverage for policy-aware internal stream prewarming.
Caller: Backend Vitest suite before changing stream warmer startup behavior.
Deps: streamWarmer service with mocked axios and fake timers.
MainFuncs: warmAllCameras policy filtering.
SideEffects: Uses fake timers; no network calls.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();
const axiosHeadMock = vi.fn();

vi.mock('axios', () => ({
    default: {
        get: axiosGetMock,
        head: axiosHeadMock,
    },
}));

vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: {
            apiUrl: 'http://localhost:9997',
            hlsUrlInternal: 'http://localhost:8888',
        },
    },
}));

describe('streamWarmer policy filtering', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        axiosGetMock.mockResolvedValue({ data: { sourceReady: true } });
        axiosHeadMock.mockResolvedValue({});
    });

    afterEach(async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        streamWarmer.stopAll();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('warms only cameras resolved as always_on', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        const waitSpy = vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        const summary = await streamWarmer.warmAllCameras([
            {
                id: 1,
                stream_key: 'local-key',
                private_rtsp_url: 'rtsp://local/stream',
                internal_ingest_policy_override: 'always_on',
                _areaPolicy: { internal_ingest_policy_default: 'default' },
            },
            {
                id: 2,
                stream_key: 'remote-key',
                private_rtsp_url: 'rtsp://remote/stream',
                internal_ingest_policy_override: 'default',
                _areaPolicy: { internal_ingest_policy_default: 'on_demand' },
            },
        ]);

        expect(summary).toEqual({
            total: 2,
            warmed: 1,
            skipped: 1,
        });
        expect(streamWarmer.getWarmedStreams()).toEqual(['local-key']);
        expect(axiosGetMock).toHaveBeenCalledWith(
            'http://localhost:9997/v3/paths/get/local-key',
            { timeout: 5000 }
        );
        expect(axiosGetMock).not.toHaveBeenCalledWith(
            'http://localhost:9997/v3/paths/get/remote-key',
            expect.anything()
        );

        waitSpy.mockRestore();
    });

    it('skips strict compatibility profiles unless explicitly overridden always_on', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        const summary = await streamWarmer.warmAllCameras([
            {
                id: 3,
                stream_key: 'surabaya-key',
                private_rtsp_url: 'rtsp://surabaya/stream',
                internal_ingest_policy_override: 'default',
                source_profile: 'surabaya_private_rtsp',
                enable_recording: 0,
                _areaPolicy: { internal_ingest_policy_default: 'default' },
            },
        ]);

        expect(summary.warmed).toBe(0);
        expect(summary.skipped).toBe(1);
        expect(streamWarmer.getWarmedStreams()).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- streamWarmer.test.js
```

Expected: FAIL because `warmAllCameras()` warms every camera and does not return the expected summary.

- [ ] **Step 3: Add policy-aware filtering**

At the top of `backend/services/streamWarmer.js`, add:

```javascript
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';
```

Inside the class, add this method before `warmAllCameras()`:

```javascript
    async waitBetweenWarmStarts(delayMs = 5000) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
```

Replace `warmAllCameras(cameras)` with:

```javascript
    async warmAllCameras(cameras) {
        let warmed = 0;
        let skipped = 0;

        console.log(`[StreamWarmer] Evaluating ${cameras.length} camera streams for pre-warm...`);

        for (const camera of cameras) {
            const resolvedPolicy = resolveInternalIngestPolicy(camera, camera._areaPolicy || null);
            if (resolvedPolicy.mode !== 'always_on') {
                skipped++;
                const pathName = camera.stream_key || `camera${camera.id}`;
                this.stopWarming(pathName);
                continue;
            }

            const pathName = camera.stream_key || `camera${camera.id}`;
            this.warmStream(pathName);
            warmed++;

            await this.waitBetweenWarmStarts();
        }

        console.log(`[StreamWarmer] Pre-warm active for ${warmed} stream(s), skipped ${skipped} on-demand stream(s)`);
        return {
            total: cameras.length,
            warmed,
            skipped,
        };
    }
```

- [ ] **Step 4: Run focused backend tests**

Run:

```bash
cd backend
npm test -- internalIngestPolicy.test.js streamWarmer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/streamWarmer.js backend/__tests__/streamWarmer.test.js
git commit -m "Fix: prewarm only always-on camera streams"
git push
```

---

### Task 3: Assert MediaMTX Path Config

**Files:**
- Modify: `backend/__tests__/mediaMtxService.test.js`

- [ ] **Step 1: Add path config tests**

Append these tests inside the existing `describe('mediaMtxService on-demand path sync', () => { ... })` block in `backend/__tests__/mediaMtxService.test.js`:

```javascript
    it('builds always-on MediaMTX path config for local cameras', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://local-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: null,
            description: '',
            enable_recording: 1,
            _areaPolicy: {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: null,
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://local-camera/stream',
            sourceProtocol: 'tcp',
            sourceOnDemand: false,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '30s',
        });
    });

    it('builds on-demand MediaMTX path config from area policy', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: null,
            description: '',
            enable_recording: 0,
            _areaPolicy: {
                internal_ingest_policy_default: 'on_demand',
                internal_on_demand_close_after_seconds: 45,
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://remote-camera/stream',
            sourceProtocol: 'tcp',
            sourceOnDemand: true,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '45s',
        });
    });
```

- [ ] **Step 2: Run MediaMTX focused tests**

Run:

```bash
cd backend
npm test -- mediaMtxService.test.js
```

Expected: PASS after Task 1. If the first test fails on `sourceOnDemand`, Task 1 fallback was not applied correctly.

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/mediaMtxService.test.js
git commit -m "Add: verify MediaMTX ingest policy config"
git push
```

---

### Task 4: Area Admin Policy Controls

**Files:**
- Modify: `frontend/src/components/admin/areas/AreaFormModal.jsx`
- Modify: `frontend/src/components/admin/areas/AreaFormModal.test.jsx`

- [ ] **Step 1: Add focused form assertions**

In `frontend/src/components/admin/areas/AreaFormModal.test.jsx`, after the existing error assertions, add:

```javascript
        expect(screen.getByText('Internal RTSP / MediaMTX Policy')).toBeTruthy();
        expect(screen.getByDisplayValue('Ikuti Default Sistem')).toBeTruthy();
```

After the name field `fireEvent.change(...)`, add:

```javascript
        fireEvent.change(screen.getByDisplayValue('Ikuti Default Sistem'), {
            target: { name: 'internal_ingest_policy_default', value: 'on_demand' },
        });
        fireEvent.change(screen.getByPlaceholderText('Kosong = ikuti default'), {
            target: { name: 'internal_on_demand_close_after_seconds', value: '15' },
        });
```

After `expect(onChange).toHaveBeenCalled();`, add:

```javascript
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            target: expect.objectContaining({
                name: 'internal_ingest_policy_default',
                value: 'on_demand',
            }),
        }));
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            target: expect.objectContaining({
                name: 'internal_on_demand_close_after_seconds',
                value: '15',
            }),
        }));
```

- [ ] **Step 2: Run area form test**

Run:

```bash
cd frontend
npm test -- src/components/admin/areas/AreaFormModal.test.jsx
```

Expected: PASS if current controls are present. If this fails because copy differs, update `AreaFormModal.jsx` copy to the approved labels: `Internal RTSP / MediaMTX Policy`, `Default Ingest Mode`, and `Idle Close Timeout (detik)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/areas/AreaFormModal.jsx frontend/src/components/admin/areas/AreaFormModal.test.jsx
git commit -m "Add: verify area ingest policy controls"
git push
```

---

### Task 5: Camera Admin Override Payload

**Files:**
- Modify: `frontend/src/components/admin/cameras/CameraSourceFields.jsx`
- Modify: `frontend/src/utils/admin/cameraFormAdapter.test.js`

- [ ] **Step 1: Add adapter assertions**

Append these tests in `frontend/src/utils/admin/cameraFormAdapter.test.js`:

```javascript
    it('builds internal camera payload with ingest policy override fields', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'Internal On Demand Cam',
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            private_rtsp_url: 'rtsp://example.local/stream',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: '15',
            source_profile: 'remote_private_rtsp',
        });

        expect(payload).toMatchObject({
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            private_rtsp_url: 'rtsp://example.local/stream',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: 15,
            source_profile: 'remote_private_rtsp',
        });
    });

    it('clears internal ingest fields for external cameras', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            delivery_type: 'external_hls',
            stream_source: 'external',
            external_stream_url: 'https://example.com/live.m3u8',
            internal_ingest_policy_override: 'on_demand',
            internal_on_demand_close_after_seconds_override: '15',
            source_profile: 'remote_private_rtsp',
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_hls',
            stream_source: 'external',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: null,
        });
    });
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
cd frontend
npm test -- src/utils/admin/cameraFormAdapter.test.js
```

Expected: PASS if current adapter already preserves these fields. If it fails, update `buildCameraPayload()` to match the expected payload shape exactly.

- [ ] **Step 3: Align camera override copy**

In `frontend/src/components/admin/cameras/CameraSourceFields.jsx`, ensure internal camera controls use these operator labels:

```javascript
const INTERNAL_INGEST_POLICY_OPTIONS = [
    { value: 'default', label: 'Use Area Default', description: 'Gunakan default policy internal dari area kamera ini.' },
    { value: 'always_on', label: 'Always On', description: 'MediaMTX menjaga source tetap tersambung walau tidak ada viewer.' },
    { value: 'on_demand', label: 'On Demand', description: 'Source hanya dibuka saat ada viewer lalu ditutup lagi saat idle.' },
];
```

Keep the existing field names:
- `internal_ingest_policy_override`
- `internal_on_demand_close_after_seconds_override`
- `source_profile`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/cameras/CameraSourceFields.jsx frontend/src/utils/admin/cameraFormAdapter.test.js
git commit -m "Add: camera ingest override payload coverage"
git push
```

---

### Task 6: Camera Card Resolved Ingest Badge

**Files:**
- Modify: `frontend/src/components/admin/cameras/CameraCard.jsx`
- Modify: `frontend/src/pages/CameraManagement.test.jsx`

- [ ] **Step 1: Inspect existing card props**

Run:

```bash
Get-Content -LiteralPath 'C:\project\cctv\frontend\src\components\admin\cameras\CameraCard.jsx' -TotalCount 260
```

Expected: Identify the existing status badge row that currently renders delivery/monitoring badges.

- [ ] **Step 2: Add local badge helper**

In `frontend/src/components/admin/cameras/CameraCard.jsx`, near existing helper functions, add:

```javascript
function getResolvedIngestPolicy(camera) {
    const cameraOverride = camera.internal_ingest_policy_override;
    const areaDefault = camera.area_internal_ingest_policy_default;
    const strictProfile = camera.source_profile === 'surabaya_private_rtsp';

    if (cameraOverride === 'always_on' || cameraOverride === 'on_demand') {
        return cameraOverride;
    }

    if (areaDefault === 'always_on' || areaDefault === 'on_demand') {
        return areaDefault;
    }

    return strictProfile ? 'on_demand' : 'always_on';
}

function getIngestBadge(camera) {
    if ((camera.delivery_type || 'internal_hls') !== 'internal_hls') {
        return null;
    }

    const policy = getResolvedIngestPolicy(camera);
    return {
        label: policy === 'always_on' ? 'Ingest: Always On' : 'Ingest: On Demand',
        className: policy === 'always_on'
            ? 'bg-emerald-500/15 text-emerald-200'
            : 'bg-sky-500/15 text-sky-200',
    };
}
```

- [ ] **Step 3: Render the badge**

Inside the existing badge row for each camera, render:

```jsx
{getIngestBadge(camera) && (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getIngestBadge(camera).className}`}>
        {getIngestBadge(camera).label}
    </span>
)}
```

If the component already computes badges in arrays, add the ingest badge to that array instead of calling `getIngestBadge(camera)` twice.

- [ ] **Step 4: Add page/card assertion**

In `frontend/src/pages/CameraManagement.test.jsx`, add a camera fixture or assertion where an internal camera has:

```javascript
{
    id: 1035,
    name: 'Surabaya Remote',
    delivery_type: 'internal_hls',
    stream_source: 'internal',
    internal_ingest_policy_override: 'default',
    area_internal_ingest_policy_default: 'on_demand',
    source_profile: null,
}
```

Assert:

```javascript
expect(await screen.findByText('Ingest: On Demand')).toBeTruthy();
```

If the test renders `CameraCard` indirectly, place the fixture in the mocked `cameraService.getCameras()` response.

- [ ] **Step 5: Run focused camera tests**

Run:

```bash
cd frontend
npm test -- CameraManagement.test.jsx src/utils/admin/cameraFormAdapter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/cameras/CameraCard.jsx frontend/src/pages/CameraManagement.test.jsx
git commit -m "Add: show resolved camera ingest policy"
git push
```

---

### Task 7: Final Verification And Map Sync

**Files:**
- Possibly modify: `SYSTEM_MAP.md`
- Possibly modify: `backend/.module_map.md`
- Possibly modify: `backend/services/.module_map.md`
- Possibly modify: `frontend/src/.module_map.md`

- [ ] **Step 1: Check docs for flow drift**

Run:

```bash
Select-String -LiteralPath 'C:\project\cctv\SYSTEM_MAP.md','C:\project\cctv\backend\.module_map.md','C:\project\cctv\backend\services\.module_map.md','C:\project\cctv\frontend\src\.module_map.md' -Pattern 'streamWarmer|prewarm|MediaMTX|internal ingest|Camera CRUD|Area bulk'
```

Expected: If maps already describe MediaMTX/stream warmer generically enough, no edit is needed. If they say all internal cameras are prewarmed, change that wording to policy-aware prewarming.

- [ ] **Step 2: Run backend focused gate**

Run:

```bash
cd backend
npm test -- internalIngestPolicy.test.js streamWarmer.test.js mediaMtxService.test.js
```

Expected: PASS.

- [ ] **Step 3: Run frontend focused gate**

Run:

```bash
cd frontend
npm test -- src/components/admin/areas/AreaFormModal.test.jsx CameraManagement.test.jsx src/utils/admin/cameraFormAdapter.test.js
```

Expected: PASS.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: Only intentional map/test/code files are modified.

- [ ] **Step 5: Commit docs/map sync if changed**

If Step 1 required map edits:

```bash
git add SYSTEM_MAP.md backend/.module_map.md backend/services/.module_map.md frontend/src/.module_map.md
git commit -m "Add: document internal ingest policy flow"
git push
```

If no map edits were needed, skip this commit.

- [ ] **Step 6: Final push check**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: working tree clean except unrelated user changes; recent commits include the task commits above.

---

## Self-Review

Spec coverage:
- Area-level customization is covered by Task 4.
- Camera-level override is covered by Task 5.
- MediaMTX `sourceOnDemand` behavior is covered by Task 3.
- Stream warmer skip behavior is covered by Task 2.
- Default local `always_on` and compatibility profile `on_demand` are covered by Task 1.
- Operator badge visibility is covered by Task 6.

No new DB table or migration is planned because the approved design uses existing columns.
