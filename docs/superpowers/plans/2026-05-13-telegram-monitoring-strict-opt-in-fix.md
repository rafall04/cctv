<!--
Purpose: Implementation plan to stop false Telegram DOWN alerts by making strict RTSP monitoring opt-in.
Caller: Agentic workers fixing Telegram monitoring false-positive alerts.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, cameraHealthService.js, cameraMonitoringAlertPolicy.js.
MainFuncs: Defines TDD tasks, exact file changes, verification gates, and rollback-safe execution order.
SideEffects: Documentation only.
-->

# Telegram Monitoring Strict Opt-In Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false Telegram DOWN alerts for normal `internal_hls` cameras by making direct RTSP strict monitoring opt-in, while preserving real up/down alerts and public UI availability behavior.

**Architecture:** Keep the existing monitoring-state transition pipeline, but change the strict RTSP eligibility policy so `default + default -> always_on` does not automatically mean strict RTSP monitoring. Default internal HLS cameras use the existing stream health result for Telegram monitoring; strict RTSP monitoring remains available only for explicit operator/source-profile cases. Tests must prove that a direct RTSP failure does not send Telegram DOWN when stream health is online for default internal cameras.

**Tech Stack:** Node.js 20+, Fastify backend services, better-sqlite3 through existing helpers, Vitest backend tests.

---

## Root Cause Summary

The previous implementation made `shouldUseStrictInternalMonitoring(camera)` return true for any `internal_hls` camera with a private RTSP URL whose resolved ingest policy is `always_on`. Because the ingest resolver maps `default + default` to `always_on`, normal cameras were treated as strict. Direct RTSP `DESCRIBE` probes then returned `rtsp_auth_failed` or `rtsp_stream_not_found`, causing `monitoring_state` to flip from `online` to `offline` and Telegram to send DOWN even when the stream/public path could still be considered online.

## File Structure

- Modify: `backend/services/cameraMonitoringAlertPolicy.js`
  - Narrow strict RTSP monitoring eligibility to explicit cases only.
  - Keep pure helper boundary; no DB or Telegram side effects.
- Modify: `backend/__tests__/cameraMonitoringAlertPolicy.test.js`
  - Add regression coverage for default internal HLS cameras and explicit strict cases.
- Modify: `backend/__tests__/cameraHealthService.test.js`
  - Add regression coverage that default internal HLS camera with failed direct RTSP does not send Telegram DOWN if stream health is online.
  - Keep existing strict monitoring transition coverage.
- Modify: `backend/services/.module_map.md`
  - Document strict RTSP monitoring as opt-in, not default resolved policy behavior.

No database migration is planned. This fix changes policy logic only.

---

### Task 1: Narrow Strict RTSP Monitoring Eligibility

**Files:**
- Modify: `backend/__tests__/cameraMonitoringAlertPolicy.test.js`
- Modify: `backend/services/cameraMonitoringAlertPolicy.js`

- [ ] **Step 1: Write failing policy tests**

In `backend/__tests__/cameraMonitoringAlertPolicy.test.js`, replace the current strict-monitoring eligibility test with:

```javascript
    it('does not use strict RTSP monitoring for default internal HLS cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'default',
            area_internal_ingest_policy_default: 'default',
        })).toBe(false);

        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.11/stream',
        })).toBe(false);
    });

    it('uses strict RTSP monitoring for explicit always-on internal HLS cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.12/stream',
            internal_ingest_policy_override: 'always_on',
        })).toBe(true);
    });

    it('uses strict RTSP monitoring for strict source profiles', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.13/stream',
            internal_ingest_policy_override: 'default',
            source_profile: 'surabaya_private_rtsp',
        })).toBe(true);
    });

    it('does not use strict RTSP monitoring for on-demand or external cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.14/stream',
            internal_ingest_policy_override: 'on_demand',
        })).toBe(false);

        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.test/live.m3u8',
        })).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- cameraMonitoringAlertPolicy.test.js
```

Expected: FAIL because default internal HLS cameras currently return strict monitoring true.

- [ ] **Step 3: Implement opt-in strict policy**

In `backend/services/cameraMonitoringAlertPolicy.js`, replace `shouldUseStrictInternalMonitoring()` with:

```javascript
export function shouldUseStrictInternalMonitoring(camera = {}) {
    if (camera.delivery_type !== 'internal_hls' || !camera.private_rtsp_url) {
        return false;
    }

    if (camera.source_profile === 'surabaya_private_rtsp') {
        return true;
    }

    if (camera.internal_ingest_policy_override === 'always_on') {
        return true;
    }

    return false;
}
```

Also remove the now-unused import from the same file:

```javascript
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';
```

Update the Header Doc `Deps:` line to:

```javascript
Deps: None.
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
cd backend
npm test -- cameraMonitoringAlertPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cameraMonitoringAlertPolicy.js backend/__tests__/cameraMonitoringAlertPolicy.test.js
git commit -m "Fix: make strict Telegram RTSP monitoring opt-in"
```

---

### Task 2: Protect Default Internal Cameras From False DOWN Alerts

**Files:**
- Modify: `backend/__tests__/cameraHealthService.test.js`
- No production file expected if Task 1 policy is correct.

- [ ] **Step 1: Add failing health-loop regression test**

Inside `describe('cameraHealthService check loop', () => { ... })` in `backend/__tests__/cameraHealthService.test.js`, add:

```javascript
    it('does not send Telegram DOWN for default internal HLS when direct RTSP would fail but stream health is online', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 63,
            name: 'Default Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:wrong@10.0.0.63/stream',
            stream_key: 'camera-63',
            internal_ingest_policy_override: 'default',
            area_internal_ingest_policy_default: 'default',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        const rtspProbeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 63, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(rtspProbeSpy).not.toHaveBeenCalled();
        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(63, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'mediamtx_path_configured_idle',
        }));
    });
```

- [ ] **Step 2: Run test to verify current false-positive risk fails before Task 1 fix or passes after Task 1**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js -t "does not send Telegram DOWN for default internal HLS"
```

Expected after Task 1 implementation: PASS. If it fails, inspect `shouldUseStrictInternalMonitoring()` and ensure default internal cameras return false.

- [ ] **Step 3: Run full focused health tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/__tests__/cameraHealthService.test.js
git commit -m "Add: prevent false Telegram DOWN for default internal cameras"
```

---

### Task 3: Keep Explicit Strict Monitoring Working

**Files:**
- Modify: `backend/__tests__/cameraHealthService.test.js`
- No production file expected if Task 1 policy is correct.

- [ ] **Step 1: Add explicit strict positive regression test**

Inside `describe('cameraHealthService check loop', () => { ... })` in `backend/__tests__/cameraHealthService.test.js`, add:

```javascript
    it('still sends Telegram DOWN for explicit strict internal HLS monitoring when RTSP probe fails', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 64,
            name: 'Explicit Strict Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:wrong@10.0.0.64/stream',
            stream_key: 'camera-64',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 64, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [camera]);
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(64, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_auth_failed',
        }));
    });
```

- [ ] **Step 2: Run targeted health tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js -t "explicit strict internal HLS"
```

Expected: PASS.

- [ ] **Step 3: Run focused suite**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/__tests__/cameraHealthService.test.js
git commit -m "Add: preserve explicit strict Telegram monitoring"
```

---

### Task 4: Documentation And Final Verification

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update service map wording**

In `backend/services/.module_map.md`, replace:

```markdown
  - `cameraMonitoringAlertPolicy.js`: pure Telegram monitoring alert policy for strict internal HLS monitoring eligibility and online/offline transition detection.
```

with:

```markdown
  - `cameraMonitoringAlertPolicy.js`: pure Telegram monitoring alert policy for opt-in strict internal HLS monitoring eligibility and online/offline transition detection.
```

Replace:

```markdown
- Health transitions may update DB runtime state, route grouped Telegram up/down notifications through monitoring-state transitions, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

with:

```markdown
- Health transitions may update DB runtime state, route grouped Telegram up/down notifications through monitoring-state transitions, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, strict RTSP Telegram checks are opt-in for explicit internal camera policies/source profiles, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

- [ ] **Step 2: Run focused backend gate**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

Expected: PASS.

- [ ] **Step 3: Run backend full gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected:
- `npm run migrate` exits 0.
- `npm test` exits 0.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only files changed by this plan are listed before staging.

- [ ] **Step 5: Commit docs**

```bash
git add backend/services/.module_map.md
git commit -m "Add: document opt-in Telegram strict monitoring"
```

- [ ] **Step 6: Push main**

```bash
git push
```

Expected: `main -> main` push succeeds.

---

## Verification Matrix

The implementation is not complete until these commands have run successfully after all code changes:

```bash
cd backend
npm run migrate
npm test
```

Also run the focused suite while developing:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

## Rollback Plan

If this fix causes Telegram to miss real strict RTSP DOWN alerts:

1. Keep default cameras protected.
2. Re-check the camera has either `internal_ingest_policy_override='always_on'` or `source_profile='surabaya_private_rtsp'`.
3. If the camera is meant to be strict but has no explicit marker, set the explicit camera policy instead of broadening default behavior again.
4. Re-run focused backend tests before push.

## Self-Review

- Spec coverage: The plan covers the false DOWN root cause, default internal camera protection, explicit strict monitoring preservation, documentation sync, migration safety, full backend verification, and push.
- Placeholder scan: No incomplete-work marker phrases remain.
- Type consistency: Uses existing `internal_ingest_policy_override`, `source_profile`, `monitoring_state`, `monitoring_reason`, and `sendCameraStatusNotifications` names.
- Scope check: This is one backend policy fix; no frontend UI change or DB migration is required.
