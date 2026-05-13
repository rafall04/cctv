# Telegram Alert Confirmation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable Telegram DOWN/UP confirmation layer so camera alerts are sent only after a monitored state remains down/up long enough, while preserving internal HLS UDP/TCP behavior and current public map/grid availability.

**Architecture:** Add a small pure policy module that owns alert confirmation timing, then wire it into `cameraHealthService` before `sendCameraStatusNotifications()`. Keep transport policy untouched: internal HLS TCP/UDP/auto remains owned by `internalRtspTransportPolicy.js` and MediaMTX/FFmpeg consumers. Update Telegram settings UI wording so "5 menit" is clearly anti-spam cooldown, not the first DOWN delay.

**Tech Stack:** Node.js 20 ES modules, Fastify service layer, Vitest, React 18, Vite, Tailwind CSS.

---

## File Structure

- Create `backend/services/telegramAlertConfirmationPolicy.js`
  - Pure state machine for pending DOWN/UP confirmation.
  - No DB, no Telegram, no timers, no process state.
- Create `backend/__tests__/telegramAlertConfirmationPolicy.test.js`
  - TDD coverage for immediate candidate, delayed send, recovery cancellation, and UP confirmation.
- Modify `backend/services/cameraHealthService.js`
  - Keep existing health scoring, `monitoring_state`, UI map/grid availability, strict RTSP opt-in, and UDP/TCP behavior unchanged.
  - Add in-memory `telegramAlertState` map and call the pure policy before building `wentOffline` / `wentOnline`.
- Modify `backend/__tests__/cameraHealthService.test.js`
  - Regression tests proving Telegram DOWN is delayed while runtime state still updates immediately.
- Modify `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
  - Change misleading "Cooldown 5 Menit" copy to explicitly say anti-spam after an alert is sent.
  - Add operator-facing static explanation for planned confirmation behavior.
- Modify `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`
  - Assert the new wording so the UI cannot regress back to misleading text.
- Modify `backend/services/.module_map.md`
  - Document that Telegram alerts use confirmation timing and that RTSP transport remains separate.

## Defaults

- DOWN confirmation: `120` seconds.
- UP confirmation: `60` seconds.
- Telegram cooldown: remains existing `300` seconds in `telegramService.js`.
- No DB migration in this first execution. Confirmation state resets on backend restart, which is safer than sending stale alerts after restart. A persisted audit/confirmation table can be a later phase.

## Non-Goals

- Do not change `internalRtspTransportPolicy.js`.
- Do not change MediaMTX `rtspTransport` or FFmpeg `-rtsp_transport` behavior.
- Do not make strict RTSP monitoring default again.
- Do not delay public map/grid status updates; only Telegram alert sending is delayed.

---

### Task 1: Add Pure Telegram Confirmation Policy

**Files:**
- Create: `backend/services/telegramAlertConfirmationPolicy.js`
- Create: `backend/__tests__/telegramAlertConfirmationPolicy.test.js`

- [ ] **Step 1: Write the failing policy test**

Create `backend/__tests__/telegramAlertConfirmationPolicy.test.js`:

```js
/*
Purpose: Verify pure Telegram alert confirmation timing before cameraHealthService sends DOWN/UP messages.
Caller: Backend Vitest suite for services/telegramAlertConfirmationPolicy.js.
Deps: Vitest, telegramAlertConfirmationPolicy.
MainFuncs: describe telegramAlertConfirmationPolicy.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    createTelegramAlertConfirmationState,
    evaluateTelegramAlertConfirmation,
} from '../services/telegramAlertConfirmationPolicy.js';

describe('telegramAlertConfirmationPolicy', () => {
    it('starts a DOWN candidate without sending immediately', () => {
        const state = createTelegramAlertConfirmationState('online', 1_000);

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'offline',
            now: 2_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.pendingTransition).toBe('offline');
        expect(result.state.pendingSince).toBe(2_000);
        expect(result.state.confirmedState).toBe('online');
    });

    it('sends DOWN only after the offline candidate remains stable long enough', () => {
        const state = {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 2_000,
            lastObservedState: 'offline',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'offline',
            now: 122_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBe('offline');
        expect(result.state.confirmedState).toBe('offline');
        expect(result.state.pendingTransition).toBeNull();
        expect(result.state.pendingSince).toBeNull();
    });

    it('cancels pending DOWN when the camera recovers before confirmation', () => {
        const state = {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 2_000,
            lastObservedState: 'offline',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'online',
            now: 30_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
        expect(result.state.pendingSince).toBeNull();
    });

    it('sends UP only after the online candidate remains stable long enough', () => {
        const state = {
            confirmedState: 'offline',
            pendingTransition: 'online',
            pendingSince: 10_000,
            lastObservedState: 'online',
        };

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'online',
            now: 70_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBe('online');
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
    });

    it('ignores non-alert states without starting a candidate', () => {
        const state = createTelegramAlertConfirmationState('online', 1_000);

        const result = evaluateTelegramAlertConfirmation(state, {
            nextState: 'stale',
            now: 2_000,
            downConfirmationMs: 120_000,
            upConfirmationMs: 60_000,
        });

        expect(result.transitionToSend).toBeNull();
        expect(result.state.confirmedState).toBe('online');
        expect(result.state.pendingTransition).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend
npm test -- telegramAlertConfirmationPolicy.test.js
```

Expected: FAIL because `../services/telegramAlertConfirmationPolicy.js` does not exist.

- [ ] **Step 3: Add the pure policy implementation**

Create `backend/services/telegramAlertConfirmationPolicy.js`:

```js
/*
Purpose: Pure Telegram alert confirmation policy for delaying DOWN/UP sends until states are stable.
Caller: cameraHealthService and focused Telegram confirmation tests.
Deps: None.
MainFuncs: createTelegramAlertConfirmationState, evaluateTelegramAlertConfirmation.
SideEffects: None.
*/

const ALERT_STATES = new Set(['online', 'offline']);

export const DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS = 120 * 1000;
export const DEFAULT_TELEGRAM_UP_CONFIRMATION_MS = 60 * 1000;

function normalizeAlertState(state) {
    return ALERT_STATES.has(state) ? state : null;
}

export function createTelegramAlertConfirmationState(initialState = null, now = Date.now()) {
    return {
        confirmedState: normalizeAlertState(initialState),
        pendingTransition: null,
        pendingSince: null,
        lastObservedState: normalizeAlertState(initialState),
        lastUpdatedAt: now,
    };
}

export function evaluateTelegramAlertConfirmation(currentState = {}, options = {}) {
    const nextAlertState = normalizeAlertState(options.nextState);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const downConfirmationMs = Number.isFinite(options.downConfirmationMs)
        ? Math.max(0, options.downConfirmationMs)
        : DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS;
    const upConfirmationMs = Number.isFinite(options.upConfirmationMs)
        ? Math.max(0, options.upConfirmationMs)
        : DEFAULT_TELEGRAM_UP_CONFIRMATION_MS;

    const state = {
        confirmedState: normalizeAlertState(currentState.confirmedState),
        pendingTransition: normalizeAlertState(currentState.pendingTransition),
        pendingSince: Number.isFinite(currentState.pendingSince) ? currentState.pendingSince : null,
        lastObservedState: normalizeAlertState(currentState.lastObservedState),
        lastUpdatedAt: now,
    };

    if (!nextAlertState) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: null,
            },
        };
    }

    if (state.confirmedState === null) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                confirmedState: nextAlertState,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: nextAlertState,
            },
        };
    }

    if (nextAlertState === state.confirmedState) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: null,
                pendingSince: null,
                lastObservedState: nextAlertState,
            },
        };
    }

    const pendingSince = state.pendingTransition === nextAlertState && state.pendingSince !== null
        ? state.pendingSince
        : now;
    const requiredMs = nextAlertState === 'offline' ? downConfirmationMs : upConfirmationMs;
    const isConfirmed = now - pendingSince >= requiredMs;

    if (!isConfirmed) {
        return {
            transitionToSend: null,
            state: {
                ...state,
                pendingTransition: nextAlertState,
                pendingSince,
                lastObservedState: nextAlertState,
            },
        };
    }

    return {
        transitionToSend: nextAlertState,
        state: {
            ...state,
            confirmedState: nextAlertState,
            pendingTransition: null,
            pendingSince: null,
            lastObservedState: nextAlertState,
        },
    };
}
```

- [ ] **Step 4: Run the policy test to verify it passes**

Run:

```bash
cd backend
npm test -- telegramAlertConfirmationPolicy.test.js
```

Expected: PASS, `5 tests passed`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add backend/services/telegramAlertConfirmationPolicy.js backend/__tests__/telegramAlertConfirmationPolicy.test.js
git commit -m "Add: Telegram alert confirmation policy"
```

---

### Task 2: Wire Confirmation Into Camera Health Telegram Routing

**Files:**
- Modify: `backend/services/cameraHealthService.js`
- Modify: `backend/__tests__/cameraHealthService.test.js`

- [ ] **Step 1: Add failing health-loop test for delayed DOWN**

Add this test inside `describe('cameraHealthService check loop', ...)` in `backend/__tests__/cameraHealthService.test.js`:

```js
    it('updates runtime offline immediately but delays Telegram DOWN until confirmation window passes', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };

        const camera = {
            id: 65,
            name: 'Delayed Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.65/stream',
            stream_key: 'camera-65',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000);
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
            .mockReturnValueOnce([{ id: 65, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(65, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_auth_failed',
        }));
    });
```

- [ ] **Step 2: Add failing health-loop test for confirmed DOWN**

Add this second test inside the same describe block:

```js
    it('sends Telegram DOWN after offline state stays stable through the confirmation window', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };
        service.telegramAlertState.set(66, {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 1_000,
            lastObservedState: 'offline',
            lastUpdatedAt: 1_000,
        });

        const camera = {
            id: 66,
            name: 'Confirmed Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.66/stream',
            stream_key: 'camera-66',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(Date, 'now').mockReturnValue(121_000);
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
            .mockReturnValueOnce([{ id: 66, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [camera]);
    });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js -t "Telegram DOWN"
```

Expected: FAIL because `service.telegramAlertState` / confirmation delay wiring does not exist yet and the first test still sends immediately.

- [ ] **Step 4: Import the policy in cameraHealthService**

In `backend/services/cameraHealthService.js`, extend the import from `cameraMonitoringAlertPolicy.js` area by adding a new import:

```js
import {
    DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS,
    DEFAULT_TELEGRAM_UP_CONFIRMATION_MS,
    createTelegramAlertConfirmationState,
    evaluateTelegramAlertConfirmation,
} from './telegramAlertConfirmationPolicy.js';
```

- [ ] **Step 5: Add constructor state**

Inside the `CameraHealthService` constructor, after `this.offlineSince = new Map();`, add:

```js
        this.telegramAlertState = new Map();
        this.telegramAlertConfirmationMs = {
            down: DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS,
            up: DEFAULT_TELEGRAM_UP_CONFIRMATION_MS,
        };
```

- [ ] **Step 6: Replace immediate alert transition routing**

In `checkAllCameras()`, replace the existing block:

```js
                const alertTransition = getMonitoringAlertTransition(
                    camera.monitoring_state || deriveMonitoringStateFromOnline(camera.is_online),
                    finalResult?.monitoringState || deriveMonitoringStateFromOnline(isOnline)
                );
```

with:

```js
                const previousMonitoringState = camera.monitoring_state || deriveMonitoringStateFromOnline(camera.is_online);
                const nextMonitoringState = finalResult?.monitoringState || deriveMonitoringStateFromOnline(isOnline);
                const rawAlertTransition = getMonitoringAlertTransition(previousMonitoringState, nextMonitoringState);
                const currentAlertState = this.telegramAlertState.get(camera.id)
                    || createTelegramAlertConfirmationState(previousMonitoringState, Date.now());
                const confirmedAlert = evaluateTelegramAlertConfirmation(currentAlertState, {
                    nextState: rawAlertTransition ? nextMonitoringState : previousMonitoringState === nextMonitoringState ? nextMonitoringState : null,
                    now: Date.now(),
                    downConfirmationMs: this.telegramAlertConfirmationMs.down,
                    upConfirmationMs: this.telegramAlertConfirmationMs.up,
                });
                this.telegramAlertState.set(camera.id, confirmedAlert.state);
                const alertTransition = confirmedAlert.transitionToSend;
```

- [ ] **Step 7: Keep cleanup for removed cameras**

In the existing inactive-camera cleanup block:

```js
                    this.healthState.delete(cameraId);
                    this.offlineSince.delete(cameraId);
```

add:

```js
                    this.telegramAlertState.delete(cameraId);
```

- [ ] **Step 8: Run focused health tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js
```

Expected: PASS, all `cameraHealthService` tests pass. If the existing immediate strict RTSP DOWN test fails because Telegram is now delayed, update that test expectation to assert runtime state only, and keep the confirmed-DOWN test as the proof that Telegram still sends after the confirmation window.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add backend/services/cameraHealthService.js backend/__tests__/cameraHealthService.test.js
git commit -m "Add: delay Telegram camera alerts until confirmed"
```

---

### Task 3: Clarify Telegram Settings UI Wording

**Files:**
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`

- [ ] **Step 1: Write failing UI wording test**

In `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`, add:

```jsx
    it('explains cooldown as anti-spam instead of first DOWN delay', async () => {
        renderPanel();

        expect(await screen.findByText('Telegram Bot')).toBeTruthy();
        expect(screen.getByText('Cooldown Anti-Spam 5 Menit')).toBeTruthy();
        expect(screen.getByText('Mencegah pesan berulang setelah alert terkirim, bukan menunda deteksi DOWN pertama.')).toBeTruthy();
    });
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx -t "cooldown as anti-spam"
```

Expected: FAIL because the current UI still renders `Cooldown 5 Menit`.

- [ ] **Step 3: Update the FeatureItem copy**

In `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`, replace:

```jsx
<FeatureItem title="Cooldown 5 Menit" description="Mengurangi spam notifikasi berulang." enabled={telegramStatus?.enabled} />
```

with:

```jsx
<FeatureItem
    title="Cooldown Anti-Spam 5 Menit"
    description="Mencegah pesan berulang setelah alert terkirim, bukan menunda deteksi DOWN pertama."
    enabled={telegramStatus?.enabled}
/>
```

- [ ] **Step 4: Run the UI test to verify it passes**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx -t "cooldown as anti-spam"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add frontend/src/components/admin/settings/TelegramSettingsPanel.jsx frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
git commit -m "Fix: clarify Telegram cooldown wording"
```

---

### Task 4: Update Module Map Documentation

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update service group entry**

In `backend/services/.module_map.md`, replace:

```md
  - `cameraMonitoringAlertPolicy.js`: pure Telegram monitoring alert policy for opt-in strict internal HLS monitoring eligibility and online/offline transition detection.
```

with:

```md
  - `cameraMonitoringAlertPolicy.js`: pure Telegram monitoring alert policy for opt-in strict internal HLS monitoring eligibility and online/offline transition detection.
  - `telegramAlertConfirmationPolicy.js`: pure Telegram alert confirmation timing policy that delays DOWN/UP sends until monitored state remains stable.
```

- [ ] **Step 2: Update side-effect note**

In the health transitions bullet, replace:

```md
Health transitions may update DB runtime state, route grouped Telegram up/down notifications through monitoring-state transitions, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, strict RTSP Telegram checks are opt-in for explicit internal camera policies/source profiles, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

with:

```md
Health transitions may update DB runtime state immediately, route grouped Telegram up/down notifications only after confirmation timing accepts a stable monitoring-state transition, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, strict RTSP Telegram checks are opt-in for explicit internal camera policies/source profiles, RTSP transport remains governed by internal RTSP transport policy, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add backend/services/.module_map.md
git commit -m "Add: document Telegram alert confirmation flow"
```

---

### Task 5: Full Verification And Push

**Files:**
- Verify only.

- [ ] **Step 1: Run backend focused gate**

Run:

```bash
cd backend
npm test -- telegramAlertConfirmationPolicy.test.js cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js internalRtspTransportPolicy.test.js mediaMtxService.test.js
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused gate**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run backend full gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: migrations complete successfully and full backend test suite passes.

- [ ] **Step 4: Run frontend build gate**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS with Vite production build output.

- [ ] **Step 5: Inspect final status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: branch `main` is ahead of `origin/main` by the new task commits and has no uncommitted files.

- [ ] **Step 6: Push to main**

Run:

```bash
git push origin main
```

Expected: push succeeds.

---

## Self-Review

- Spec coverage: Covers Telegram alert confirmation, cooldown wording, strict RTSP opt-in preservation, public UI status preservation, and internal HLS UDP/TCP non-regression.
- Placeholder scan: No deferred-work markers found.
- Type consistency: Uses `telegramAlertState`, `telegramAlertConfirmationMs.down`, `telegramAlertConfirmationMs.up`, `createTelegramAlertConfirmationState()`, and `evaluateTelegramAlertConfirmation()` consistently across tasks.
- Scope control: No DB migration in this phase; persisted audit trail remains a later explicit phase.
