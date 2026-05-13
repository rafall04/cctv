<!--
Purpose: Implementation plan to harden Telegram CCTV up/down monitoring without changing public map/grid availability behavior.
Caller: Agentic workers implementing the Telegram monitoring alert fix.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, frontend/src/.module_map.md.
MainFuncs: Defines staged tasks, tests, file ownership, verification gates, and rollback-safe implementation order.
SideEffects: Documentation only.
-->

# Telegram Monitoring Alert Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram CCTV up/down alerts fire from real monitoring transitions while preserving existing public map/grid availability behavior.

**Architecture:** Keep stream/public availability and Telegram monitoring availability as separate signals. Public UI continues to use `availability_state` from `cameraHealthService.enrichCameraAvailability()`, while Telegram uses monitoring-only transitions from `camera_runtime_state.monitoring_state`. Internal HLS cameras that are always-on get strict RTSP monitoring for alert decisions, without forcing public cards or map markers to change behavior unless their existing availability logic already marks them offline.

**Tech Stack:** Node.js 20+, Fastify services, better-sqlite3 via existing connection helpers, Vitest backend tests.

---

## Verified Baseline

- Focused backend gate run before this plan:
  - Command: `cd backend && npm test -- cameraHealthService.test.js telegramService.test.js notificationDiagnosticsService.test.js`
  - Result: 3 test files passed, 60 tests passed.
- Public map/grid status source verified:
  - Backend `/api/cameras/active` read models call `cameraHealthService.enrichCameraAvailability()` in `backend/services/cameraService.js`.
  - Map/grid components use `availability_state` through `frontend/src/utils/cameraAvailability.js`.
  - Telegram currently sends only when `cameras.is_online` changes in `backend/services/cameraHealthService.js`.

## File Structure

- Modify: `backend/services/cameraHealthService.js`
  - Add monitoring-only evaluation around the existing health loop.
  - Keep `cameras.is_online` and runtime `is_online` updates tied to current stream/public availability.
  - Route Telegram from monitoring state transitions, not public stream state transitions.
- Create: `backend/services/cameraMonitoringAlertPolicy.js`
  - Pure policy helper for monitoring state normalization, transition detection, and strict internal HLS monitoring eligibility.
- Modify: `backend/services/telegramService.js`
  - Add safe fallback for env-based Telegram config only when DB config is absent or incomplete.
  - Preserve DB config precedence.
- Modify: `backend/config/config.js`
  - Support legacy `TELEGRAM_CHAT_ID` as fallback for `TELEGRAM_MONITORING_CHAT_ID`.
- Modify: `backend/__tests__/cameraHealthService.test.js`
  - Add regression tests for monitoring-only Telegram transitions.
- Create: `backend/__tests__/cameraMonitoringAlertPolicy.test.js`
  - Cover pure transition and strict monitoring policy rules.
- Modify: `backend/__tests__/telegramService.test.js`
  - Cover env fallback behavior and DB precedence.
- Modify: `backend/services/.module_map.md`
  - Document the new monitoring alert policy boundary.

No database migration is planned. Existing `camera_runtime_state.monitoring_state` and `monitoring_reason` are sufficient.

---

### Task 1: Pure Monitoring Alert Policy

**Files:**
- Create: `backend/services/cameraMonitoringAlertPolicy.js`
- Test: `backend/__tests__/cameraMonitoringAlertPolicy.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/__tests__/cameraMonitoringAlertPolicy.test.js`:

```javascript
/*
Purpose: Verify pure Telegram monitoring alert policy for CCTV up/down transition detection.
Caller: Backend focused health/Telegram test gate.
Deps: vitest, cameraMonitoringAlertPolicy.
MainFuncs: describe cameraMonitoringAlertPolicy.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    getMonitoringAlertTransition,
    normalizeMonitoringOnline,
    shouldUseStrictInternalMonitoring,
} from '../services/cameraMonitoringAlertPolicy.js';

describe('cameraMonitoringAlertPolicy', () => {
    it('normalizes online-like monitoring states', () => {
        expect(normalizeMonitoringOnline('online')).toBe(1);
        expect(normalizeMonitoringOnline('passive')).toBe(1);
        expect(normalizeMonitoringOnline('stale')).toBe(1);
        expect(normalizeMonitoringOnline('probe_failed')).toBe(0);
        expect(normalizeMonitoringOnline('offline')).toBe(0);
        expect(normalizeMonitoringOnline('unresolved')).toBe(0);
        expect(normalizeMonitoringOnline(null)).toBeNull();
    });

    it('returns only real online/offline transitions', () => {
        expect(getMonitoringAlertTransition('online', 'offline')).toBe('offline');
        expect(getMonitoringAlertTransition('offline', 'online')).toBe('online');
        expect(getMonitoringAlertTransition('online', 'passive')).toBeNull();
        expect(getMonitoringAlertTransition(null, 'offline')).toBeNull();
        expect(getMonitoringAlertTransition('offline', null)).toBeNull();
    });

    it('uses strict internal monitoring only for always-on internal HLS cameras with RTSP source', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'always_on',
        })).toBe(true);

        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'on_demand',
        })).toBe(false);

        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.test/live.m3u8',
        })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- cameraMonitoringAlertPolicy.test.js
```

Expected: FAIL because `backend/services/cameraMonitoringAlertPolicy.js` does not exist.

- [ ] **Step 3: Add pure policy helper**

Create `backend/services/cameraMonitoringAlertPolicy.js`:

```javascript
/*
Purpose: Pure policy helpers for Telegram CCTV monitoring alert decisions.
Caller: cameraHealthService and focused monitoring policy tests.
Deps: internal ingest policy resolver.
MainFuncs: normalizeMonitoringOnline, getMonitoringAlertTransition, shouldUseStrictInternalMonitoring.
SideEffects: None.
*/

import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';

const ONLINE_MONITORING_STATES = new Set(['online', 'passive', 'stale']);
const OFFLINE_MONITORING_STATES = new Set(['offline', 'probe_failed', 'unresolved']);

export function normalizeMonitoringOnline(state) {
    if (ONLINE_MONITORING_STATES.has(state)) {
        return 1;
    }

    if (OFFLINE_MONITORING_STATES.has(state)) {
        return 0;
    }

    return null;
}

export function getMonitoringAlertTransition(previousState, nextState) {
    const previousOnline = normalizeMonitoringOnline(previousState);
    const nextOnline = normalizeMonitoringOnline(nextState);

    if (previousOnline === null || nextOnline === null || previousOnline === nextOnline) {
        return null;
    }

    return nextOnline === 1 ? 'online' : 'offline';
}

export function shouldUseStrictInternalMonitoring(camera = {}) {
    if (camera.delivery_type !== 'internal_hls' || !camera.private_rtsp_url) {
        return false;
    }

    const policy = resolveInternalIngestPolicy(camera, {
        internal_ingest_policy_default: camera.area_internal_ingest_policy_default,
        internal_on_demand_close_after_seconds: camera.area_internal_on_demand_close_after_seconds,
    });

    return policy.mode === 'always_on';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend
npm test -- cameraMonitoringAlertPolicy.test.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cameraMonitoringAlertPolicy.js backend/__tests__/cameraMonitoringAlertPolicy.test.js
git commit -m "Add: Telegram monitoring alert policy"
```

---

### Task 2: Telegram Config Fallback Without Overriding DB

**Files:**
- Modify: `backend/config/config.js:174-178`
- Modify: `backend/services/telegramService.js:333-361`
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Write failing tests**

Append to `backend/__tests__/telegramService.test.js`:

```javascript
it('falls back to env Telegram config when DB config is missing', async () => {
    vi.resetModules();
    queryOneMock.mockReturnValue(null);
    process.env.TELEGRAM_BOT_TOKEN = '123456789:env-token';
    process.env.TELEGRAM_MONITORING_CHAT_ID = '-100-env-monitoring';

    const telegram = await import('../services/telegramService.js');
    const status = telegram.getTelegramStatus();

    expect(status.cameraMonitoringConfigured).toBe(true);
    expect(status.monitoringChatId).toBe('-100-env-monitoring');
});

it('keeps DB Telegram config ahead of env fallback', async () => {
    vi.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = '123456789:env-token';
    process.env.TELEGRAM_MONITORING_CHAT_ID = '-100-env-monitoring';
    queryOneMock.mockReturnValue({
        value: JSON.stringify({
            botToken: '123456789:db-token',
            monitoringChatId: '-100-db-monitoring',
            feedbackChatId: '',
            notificationTargets: [],
            notificationRules: [],
        }),
    });

    const telegram = await import('../services/telegramService.js');
    const status = telegram.getTelegramStatus();

    expect(status.cameraMonitoringConfigured).toBe(true);
    expect(status.monitoringChatId).toBe('-100-db-monitoring');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected: FAIL on env fallback because `telegramService.js` currently returns empty config when `settings.telegram_config` is missing.

- [ ] **Step 3: Implement config fallback**

In `backend/config/config.js`, replace the Telegram block with:

```javascript
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    monitoringChatId: process.env.TELEGRAM_MONITORING_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '',
    feedbackChatId: process.env.TELEGRAM_FEEDBACK_CHAT_ID || '',
    enabled: !!(
      process.env.TELEGRAM_BOT_TOKEN
      && (
        process.env.TELEGRAM_MONITORING_CHAT_ID
        || process.env.TELEGRAM_CHAT_ID
        || process.env.TELEGRAM_FEEDBACK_CHAT_ID
      )
    ),
  },
```

In `backend/services/telegramService.js`, add this import near the other imports:

```javascript
import { config } from '../config/config.js';
```

Add this helper before `getTelegramSettings()`:

```javascript
function getEnvTelegramSettings() {
    return normalizeTelegramSettings({
        botToken: config.telegram.botToken || '',
        monitoringChatId: config.telegram.monitoringChatId || '',
        feedbackChatId: config.telegram.feedbackChatId || '',
        enabled: config.telegram.enabled,
    });
}
```

Replace the no-setting fallback inside `getTelegramSettings()` with:

```javascript
        } else {
            settingsCache = getEnvTelegramSettings();
        }
```

Replace the `catch` return in `getTelegramSettings()` with:

```javascript
        return getEnvTelegramSettings();
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected: PASS, including env fallback and DB precedence tests.

- [ ] **Step 5: Commit**

```bash
git add backend/config/config.js backend/services/telegramService.js backend/__tests__/telegramService.test.js
git commit -m "Fix: add Telegram config fallback"
```

---

### Task 3: Monitoring-Only Evaluation In Health Loop

**Files:**
- Modify: `backend/services/cameraHealthService.js`
- Modify: `backend/__tests__/cameraHealthService.test.js`

- [ ] **Step 1: Write failing tests**

Append these tests inside `describe('cameraHealthService check loop', () => { ... })` in `backend/__tests__/cameraHealthService.test.js`:

```javascript
it('sends Telegram offline when monitoring state changes even if stream availability stays online', async () => {
    const telegram = await import('../services/telegramService.js');
    telegram.isTelegramConfigured.mockReturnValue(true);

    const service = new CameraHealthService();
    const camera = {
        id: 61,
        name: 'Always On Internal',
        enabled: 1,
        is_online: 1,
        monitoring_state: 'online',
        stream_source: 'internal',
        delivery_type: 'internal_hls',
        private_rtsp_url: 'rtsp://admin:secret@10.0.0.61/stream',
        stream_key: 'camera-61',
        internal_ingest_policy_override: 'always_on',
    };

    vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
    vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
        camera,
        isOnline: 1,
        rawReason: 'mediamtx_path_configured_idle',
        rawDetails: null,
    });
    vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
        isOnline: 0,
        monitoring_state: 'offline',
        monitoring_reason: 'rtsp_stream_not_found',
    });

    queryMock
        .mockReturnValueOnce([{ id: 61, is_online: 1 }])
        .mockReturnValueOnce([camera]);
    executeMock.mockReturnValue({ changes: 1 });
    upsertRuntimeStateMock.mockImplementation(() => {});

    await service.checkAllCameras();

    expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [camera]);
    expect(connectionPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE cameras SET is_online'),
        expect.arrayContaining([1, expect.any(String), 61])
    );
    expect(upsertRuntimeStateMock).toHaveBeenCalledWith(61, expect.objectContaining({
        is_online: 1,
        monitoring_state: 'offline',
        monitoring_reason: 'rtsp_stream_not_found',
    }));
});

it('does not send Telegram when monitoring state has not crossed online/offline boundary', async () => {
    const telegram = await import('../services/telegramService.js');
    telegram.isTelegramConfigured.mockReturnValue(true);

    const service = new CameraHealthService();
    const camera = {
        id: 62,
        name: 'Stable Internal',
        enabled: 1,
        is_online: 1,
        monitoring_state: 'online',
        delivery_type: 'internal_hls',
        private_rtsp_url: 'rtsp://admin:secret@10.0.0.62/stream',
        internal_ingest_policy_override: 'always_on',
    };

    vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
    vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
        camera,
        isOnline: 1,
        rawReason: 'mediamtx_path_ready',
        rawDetails: null,
    });
    vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
        isOnline: 1,
        monitoring_state: 'online',
        monitoring_reason: 'rtsp_reachable',
    });

    queryMock
        .mockReturnValueOnce([{ id: 62, is_online: 1 }])
        .mockReturnValueOnce([camera]);
    executeMock.mockReturnValue({ changes: 1 });
    upsertRuntimeStateMock.mockImplementation(() => {});

    await service.checkAllCameras();

    expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js
```

Expected: FAIL because `evaluateCameraMonitoringStatus()` is not implemented and Telegram is still gated on `cameras.is_online`.

- [ ] **Step 3: Implement monitoring-only method**

In `backend/services/cameraHealthService.js`, add imports:

```javascript
import {
    getMonitoringAlertTransition,
    shouldUseStrictInternalMonitoring,
} from './cameraMonitoringAlertPolicy.js';
```

Add this method inside `CameraHealthService` before `checkAllCameras()`:

```javascript
    async evaluateCameraMonitoringStatus(camera, activePaths, streamResult) {
        if (shouldUseStrictInternalMonitoring(camera)) {
            const rtspResult = await this.probeInternalRtspSource(camera.private_rtsp_url);
            return {
                isOnline: rtspResult.online ? 1 : 0,
                monitoring_state: rtspResult.online ? 'online' : 'offline',
                monitoring_reason: rtspResult.reason || (rtspResult.online ? 'rtsp_reachable' : 'rtsp_unreachable'),
            };
        }

        return {
            isOnline: streamResult.isOnline,
            monitoring_state: streamResult.isOnline ? 'online' : 'offline',
            monitoring_reason: streamResult.rawReason || (streamResult.isOnline ? 'health_check_online' : 'health_check_offline'),
        };
    }
```

- [ ] **Step 4: Route Telegram from monitoring transition**

In `checkAllCameras()`, change `finalResults` construction to include monitoring:

```javascript
            const finalResults = [];
            for (const probe of probeResults.filter(p => p.result.status === 'fulfilled')) {
                const streamResult = probe.result.value;
                const monitoring = await this.evaluateCameraMonitoringStatus(streamResult.camera, activePaths, streamResult);
                finalResults.push({
                    cameraId: streamResult.camera.id,
                    isOnline: streamResult.isOnline,
                    monitoringOnline: monitoring.isOnline,
                    monitoringState: monitoring.monitoring_state,
                    monitoringReason: monitoring.monitoring_reason,
                    timestamp,
                });
            }
```

Update the runtime state write in the existing transaction:

```javascript
                    cameraRuntimeStateService.upsertRuntimeState(res.cameraId, {
                        is_online: res.isOnline,
                        monitoring_state: res.monitoringState,
                        monitoring_reason: res.monitoringReason,
                        last_health_check_at: res.timestamp,
                    });
```

Inside the loop over `probeResults`, replace the Telegram candidate logic with monitoring transition logic:

```javascript
                const finalResult = finalResults.find((item) => item.cameraId === camera.id);
                const statusChanged = camera.is_online !== isOnline;
                const alertTransition = getMonitoringAlertTransition(
                    camera.monitoring_state,
                    finalResult?.monitoringState || deriveMonitoringStateFromOnline(isOnline)
                );

                if (statusChanged) {
                    await this.handleCameraStatusTransition(camera, camera.is_online, isOnline, rawReason);
                    changedCount += 1;
                }

                if (alertTransition === 'online') wentOnline.push(camera);
                if (alertTransition === 'offline') wentOffline.push(camera);
```

Keep the existing Telegram send block, cooldown behavior, recording transition behavior, and `cameras.is_online` update unchanged.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/cameraHealthService.js backend/__tests__/cameraHealthService.test.js
git commit -m "Fix: route Telegram alerts from monitoring transitions"
```

---

### Task 4: Preserve Public Map/Grid Status Contract

**Files:**
- Modify: `backend/__tests__/cameraHealthService.test.js`
- Modify: `frontend/src/utils/cameraAvailability.js` only if tests expose an actual regression.

- [ ] **Step 1: Add backend regression test for public availability isolation**

Append to `backend/__tests__/cameraHealthService.test.js`:

```javascript
it('keeps public availability derived from existing availability state, not Telegram transition side effects', () => {
    const service = new CameraHealthService();
    const camera = {
        id: 71,
        is_online: 1,
        status: 'active',
        delivery_type: 'internal_hls',
    };

    const state = service.ensureCameraState(camera.id, camera.is_online);
    state.effectiveOnline = true;
    state.state = 'healthy';
    state.lastReason = 'mediamtx_path_ready';
    state.confidence = 0.98;

    expect(service.getPublicAvailability(camera)).toEqual({
        availability_state: 'online',
        availability_reason: 'mediamtx_path_ready',
        availability_confidence: 0.98,
    });
});
```

- [ ] **Step 2: Run focused backend test**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js
```

Expected: PASS. If it fails because implementation coupled monitoring state to `state.effectiveOnline`, revert that coupling and keep monitoring state stored only in `camera_runtime_state.monitoring_state`.

- [ ] **Step 3: Run focused frontend availability tests**

Run:

```bash
cd frontend
npm test -- cameraAvailability
```

Expected: PASS if a matching test file exists. If Vitest reports no matching test file, run:

```bash
cd frontend
npm test -- LandingStatsBar.test.jsx LandingCameraCard.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/__tests__/cameraHealthService.test.js
git commit -m "Add: protect public availability contract"
```

---

### Task 5: Map Documentation And Final Verification

**Files:**
- Modify: `backend/services/.module_map.md`
- Optional modify: `backend/.module_map.md` only if the flow description needs more precision after implementation.

- [ ] **Step 1: Update service map**

In `backend/services/.module_map.md`, add `cameraMonitoringAlertPolicy.js` under Camera domain:

```markdown
  - `cameraMonitoringAlertPolicy.js`: pure Telegram monitoring alert policy for strict internal HLS monitoring eligibility and online/offline transition detection.
```

Update the health transition side effect bullet to say:

```markdown
- Health transitions may update DB runtime state, route grouped Telegram up/down notifications through monitoring-state transitions, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing.
```

- [ ] **Step 2: Run focused backend gate**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

Expected: PASS.

- [ ] **Step 3: Run migration safety check**

Run:

```bash
cd backend
npm run migrate
```

Expected: command exits 0. No new migration should be added for this plan.

- [ ] **Step 4: Check git status and commit docs**

Run:

```bash
git status --short
git add backend/services/.module_map.md
git commit -m "Add: document Telegram monitoring alert flow"
```

Expected: only files from this plan are staged and committed.

- [ ] **Step 5: Push branch**

Run:

```bash
git push
```

Expected: branch pushes successfully to the configured upstream.

---

## Rollback Plan

If strict monitoring produces false offline alerts:

1. Revert the commit `Fix: route Telegram alerts from monitoring transitions`.
2. Keep Task 1 pure policy and Task 2 config fallback if their tests pass and no runtime issue is observed.
3. Re-run:

```bash
cd backend
npm test -- cameraHealthService.test.js telegramService.test.js notificationDiagnosticsService.test.js
```

Expected after rollback: previous behavior restored with focused tests passing.

## Self-Review

- Spec coverage: The plan covers Telegram delivery config, monitoring transition source, strict internal HLS RTSP monitoring, public UI preservation, tests, docs, commits, and push.
- Placeholder scan: No incomplete-work marker phrases remain.
- Type consistency: `monitoring_state`, `monitoring_reason`, `isOnline`, and `camera_runtime_state` names match existing service conventions.
- Scope check: This is one subsystem: backend Telegram monitoring alert correctness. Frontend is verification-only unless an availability regression appears.
