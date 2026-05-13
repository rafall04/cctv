# Telegram Alert Detected Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-camera detected DOWN/UP timestamps to Telegram camera status alerts so operators can see when a CCTV first entered the confirmed transition, separate from when the Telegram message was sent.

**Architecture:** Keep the existing confirmation delay and routing behavior unchanged. `cameraHealthService` will attach an in-memory `alertDetectedAt` timestamp to cameras only when a transition is confirmed, and `telegramService` will render that field per camera while keeping the existing footer as the message send time. No database migration is needed because this is notification enrichment, not persisted history.

**Tech Stack:** Node.js 20 ES modules, Fastify service layer, Vitest, existing `timezoneService.formatDateTime`.

---

## File Structure

- Modify `backend/services/cameraHealthService.js`
  - Compute the detected transition timestamp from `telegramAlertState.pendingSince` when a delayed DOWN/UP transition becomes confirmed.
  - Pass enriched camera objects to `sendCameraStatusNotifications()` without changing runtime state persistence or public UI status.
- Modify `backend/services/telegramService.js`
  - Render `Terdeteksi DOWN` / `Terdeteksi UP` under each camera when `alertDetectedAt` is present.
  - Rename the grouped message footer from bare timestamp to `Alert dikirim: <time>` so operators can distinguish detection time from send time.
- Modify `backend/__tests__/cameraHealthService.test.js`
  - Prove confirmed DOWN calls Telegram with `alertDetectedAt` based on the original pending transition time.
- Modify `backend/__tests__/telegramService.test.js`
  - Prove grouped Telegram messages include per-camera detected time and send time.
- Modify `backend/services/.module_map.md`
  - Document that Telegram grouped alerts include per-camera detected timestamps while confirmation timing remains in-memory.

## Safety Constraints

- Do not change `DEFAULT_TELEGRAM_DOWN_CONFIRMATION_MS` or `DEFAULT_TELEGRAM_UP_CONFIRMATION_MS`.
- Do not change `evaluateTelegramAlertConfirmation()` semantics.
- Do not change `camera_runtime_state` schema or write new timestamp columns.
- Do not delay or alter public map/grid offline/online visibility.
- Do not change internal HLS RTSP TCP/UDP/auto transport behavior.
- Do not change Telegram routing rules, cooldown keys, or multi-target grouping.
- Do not add external dependencies.

## Message Format

For grouped DOWN:

```text
<b>CCTV DOWN - Area Bojonegoro</b>
Total: 1 kamera

<b>KAB BOJONEGORO</b>
1. CCTV A
   Terdeteksi DOWN: 2026-05-13 14:21:00

Alert dikirim: 2026-05-13 14:23:00
```

For grouped UP:

```text
<b>CCTV RECOVERED - Area Bojonegoro</b>
Total: 1 kamera

<b>KAB BOJONEGORO</b>
1. CCTV A
   Terdeteksi UP: 2026-05-13 14:25:00

Alert dikirim: 2026-05-13 14:26:00
```

If `alertDetectedAt` is missing, keep the camera line without the detected timestamp so legacy callers still work.

---

### Task 1: Add Telegram Message Formatting Coverage

**Files:**
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Make the mocked formatter expose input time**

In `backend/__tests__/telegramService.test.js`, replace:

```js
vi.mock('../services/timezoneService.js', () => ({
    formatDateTime: () => '2026-05-05 04:10:00',
}));
```

with:

```js
vi.mock('../services/timezoneService.js', () => ({
    formatDateTime: (date) => {
        const value = date instanceof Date ? date : new Date(date);
        return value.toISOString().replace('T', ' ').replace('.000Z', '');
    },
}));
```

- [ ] **Step 2: Add a failing test for per-camera DOWN detected time**

In `backend/__tests__/telegramService.test.js`, after `routes one camera event to an area target and excludes on-demand cameras by default`, add:

```js
    it('includes per-camera detected DOWN time and alert send time in grouped notifications', async () => {
        vi.setSystemTime(new Date('2026-05-13T07:23:00.000Z'));
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '-100-main',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['offline'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        await telegram.sendCameraStatusNotifications('offline', [
            {
                id: 10,
                name: 'CCTV Lokal',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
                alertDetectedAt: 1_778_656_860_000,
            },
        ], { bypassCooldown: true });

        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.text).toContain('1. CCTV Lokal');
        expect(payload.text).toContain('Terdeteksi DOWN: 2026-05-13 07:21:00');
        expect(payload.text).toContain('Alert dikirim: 2026-05-13 07:23:00');
    });
```

- [ ] **Step 3: Add a failing test for per-camera UP detected time**

In `backend/__tests__/telegramService.test.js`, after the DOWN detected time test, add:

```js
    it('includes per-camera detected UP time in grouped recovery notifications', async () => {
        vi.setSystemTime(new Date('2026-05-13T07:26:00.000Z'));
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '-100-main',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        await telegram.sendCameraStatusNotifications('online', [
            {
                id: 10,
                name: 'CCTV Lokal',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
                alertDetectedAt: 1_778_657_100_000,
            },
        ], { bypassCooldown: true });

        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.text).toContain('1. CCTV Lokal');
        expect(payload.text).toContain('Terdeteksi UP: 2026-05-13 07:25:00');
        expect(payload.text).toContain('Alert dikirim: 2026-05-13 07:26:00');
    });
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- telegramService.test.js
```

Expected: FAIL because `Terdeteksi DOWN`, `Terdeteksi UP`, and `Alert dikirim` are not rendered yet.

---

### Task 2: Render Per-Camera Detected Time in Telegram Messages

**Files:**
- Modify: `backend/services/telegramService.js`
- Verify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Add small formatting helpers near `groupCamerasByArea`**

In `backend/services/telegramService.js`, add these helpers before `buildCameraStatusMessage`:

```js
function normalizeAlertDetectedAt(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value;
    }

    if (Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    return null;
}

function buildCameraStatusLine(camera, index, eventType) {
    const lines = [`${index + 1}. ${camera.name}`];
    const detectedAt = normalizeAlertDetectedAt(camera.alertDetectedAt);
    if (detectedAt) {
        const label = eventType === 'offline' ? 'Terdeteksi DOWN' : 'Terdeteksi UP';
        lines.push(`   ${label}: ${formatDateTime(detectedAt)}`);
    }
    return lines;
}
```

- [ ] **Step 2: Use the helpers inside `buildCameraStatusMessage`**

In `backend/services/telegramService.js`, replace:

```js
        areaCameras.slice(0, 20).forEach((camera, index) => {
            lines.push(`${index + 1}. ${camera.name}`);
        });
```

with:

```js
        areaCameras.slice(0, 20).forEach((camera, index) => {
            lines.push(...buildCameraStatusLine(camera, index, eventType));
        });
```

- [ ] **Step 3: Rename the footer timestamp**

In `backend/services/telegramService.js`, replace:

```js
    lines.push(formatDateTime(new Date()));
```

with:

```js
    lines.push(`Alert dikirim: ${formatDateTime(new Date())}`);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- telegramService.test.js
```

Expected: PASS with the new DOWN/UP message formatting tests.

- [ ] **Step 5: Commit Telegram message formatting**

Run:

```powershell
cd C:\project\cctv
git add backend/services/telegramService.js backend/__tests__/telegramService.test.js
git commit -m "Add: Telegram alert detected time in messages"
```

---

### Task 3: Pass Detected Time From Health Confirmation

**Files:**
- Modify: `backend/services/cameraHealthService.js`
- Modify: `backend/__tests__/cameraHealthService.test.js`

- [ ] **Step 1: Add a failing health-service assertion**

In `backend/__tests__/cameraHealthService.test.js`, in the test named `sends Telegram DOWN after offline state stays stable through the confirmation window`, replace:

```js
        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [camera]);
```

with:

```js
        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [
            expect.objectContaining({
                id: 66,
                name: 'Confirmed Delayed Telegram Internal',
                alertDetectedAt: 1_000,
            }),
        ]);
```

- [ ] **Step 2: Add a failing UP confirmation test**

In `backend/__tests__/cameraHealthService.test.js`, after the DOWN confirmation test, add:

```js
    it('sends Telegram UP with the original recovery detected time after confirmation', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };
        service.telegramAlertState.set(67, {
            confirmedState: 'offline',
            pendingTransition: 'online',
            pendingSince: 2_000,
            lastObservedState: 'online',
            lastUpdatedAt: 2_000,
        });

        const camera = {
            id: 67,
            name: 'Confirmed Recovery Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'offline',
            delivery_type: 'internal_hls',
            internal_ingest_policy_override: 'always_on',
            rtsp_url: 'rtsp://example/recovery-confirmed',
        };

        queryMock.mockReturnValueOnce([camera]);
        service.evaluateCameraStatus = vi.fn(async () => ({
            camera,
            isOnline: true,
            rawReason: 'online',
        }));
        service.evaluateCameraMonitoringResult = vi.fn(async () => ({
            monitoringState: 'online',
            monitoringReason: 'rtsp_probe_ok',
        }));
        vi.spyOn(Date, 'now').mockReturnValue(62_000);

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('online', [
            expect.objectContaining({
                id: 67,
                name: 'Confirmed Recovery Telegram Internal',
                alertDetectedAt: 2_000,
            }),
        ]);
    });
```

- [ ] **Step 3: Run health tests and verify RED**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- cameraHealthService.test.js
```

Expected: FAIL because `cameraHealthService` still passes raw camera objects without `alertDetectedAt`.

- [ ] **Step 4: Add transition timestamp capture in `cameraHealthService.js`**

In `backend/services/cameraHealthService.js`, replace this block:

```js
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

with:

```js
                const now = Date.now();
                const currentAlertState = this.telegramAlertState.get(camera.id)
                    || createTelegramAlertConfirmationState(previousMonitoringState, now);
                const nextAlertState = rawAlertTransition
                    ? nextMonitoringState
                    : previousMonitoringState === nextMonitoringState ? nextMonitoringState : null;
                const alertDetectedAt = currentAlertState.pendingTransition === nextAlertState
                    && Number.isFinite(currentAlertState.pendingSince)
                    ? currentAlertState.pendingSince
                    : now;
                const confirmedAlert = evaluateTelegramAlertConfirmation(currentAlertState, {
                    nextState: nextAlertState,
                    now,
                    downConfirmationMs: this.telegramAlertConfirmationMs.down,
                    upConfirmationMs: this.telegramAlertConfirmationMs.up,
                });
                this.telegramAlertState.set(camera.id, confirmedAlert.state);
                const alertTransition = confirmedAlert.transitionToSend;
```

- [ ] **Step 5: Enrich only confirmed Telegram transition camera objects**

In `backend/services/cameraHealthService.js`, replace:

```js
                if (alertTransition === 'online') wentOnline.push(camera);
                if (alertTransition === 'offline') wentOffline.push(camera);
```

with:

```js
                if (alertTransition === 'online') wentOnline.push({ ...camera, alertDetectedAt });
                if (alertTransition === 'offline') wentOffline.push({ ...camera, alertDetectedAt });
```

- [ ] **Step 6: Run health tests and verify GREEN**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- cameraHealthService.test.js
```

Expected: PASS with the DOWN/UP timestamp assertions.

- [ ] **Step 7: Commit health-service timestamp propagation**

Run:

```powershell
cd C:\project\cctv
git add backend/services/cameraHealthService.js backend/__tests__/cameraHealthService.test.js
git commit -m "Add: pass Telegram alert detected time from health checks"
```

---

### Task 4: Document and Verify the End-to-End Flow

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update the Telegram service description**

In `backend/services/.module_map.md`, replace:

```md
  - `telegramService.js`: Telegram bot config, multi-target monitoring groups, area/camera/global routing rules, grouped camera status messages, feedback messages.
```

with:

```md
  - `telegramService.js`: Telegram bot config, multi-target monitoring groups, area/camera/global routing rules, grouped camera status messages with per-camera detected timestamps, feedback messages.
```

- [ ] **Step 2: Update the health side-effect description**

In `backend/services/.module_map.md`, replace:

```md
- Health transitions may update DB runtime state immediately, route grouped Telegram up/down notifications only after confirmation timing accepts a stable monitoring-state transition, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, strict RTSP Telegram checks are opt-in for explicit internal camera policies/source profiles, RTSP transport remains governed by internal RTSP transport policy, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

with:

```md
- Health transitions may update DB runtime state immediately, route grouped Telegram up/down notifications only after confirmation timing accepts a stable monitoring-state transition, include the original detected transition time per camera in Telegram messages, pause/resume recording, and influence thumbnail generation; public map/grid availability stays derived from camera availability state rather than Telegram alert routing, strict RTSP Telegram checks are opt-in for explicit internal camera policies/source profiles, RTSP transport remains governed by internal RTSP transport policy, and background thumbnail work must remain capped and stale-first to avoid bandwidth spikes on large camera fleets.
```

- [ ] **Step 3: Run focused backend verification**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- telegramAlertConfirmationPolicy.test.js cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js internalRtspTransportPolicy.test.js
```

Expected: PASS with all Telegram confirmation, health, routing, and RTSP transport guard tests passing.

- [ ] **Step 4: Run full backend test gate**

Run:

```powershell
cd C:\project\cctv\backend
npm test
```

Expected: PASS for the backend suite.

- [ ] **Step 5: Commit documentation sync**

Run:

```powershell
cd C:\project\cctv
git add backend/services/.module_map.md
git commit -m "Add: document Telegram alert detected timestamps"
```

---

### Task 5: Final Status and Push

**Files:**
- Verify: repository status and planned commits.

- [ ] **Step 1: Confirm branch status**

Run:

```powershell
cd C:\project\cctv
git status --short --branch
git log --oneline --decorate -8
```

Expected: branch `main` is ahead of `origin/main` only by the commits from this plan:

```text
Add: Telegram alert detected time in messages
Add: pass Telegram alert detected time from health checks
Add: document Telegram alert detected timestamps
```

- [ ] **Step 2: Push to GitHub main**

Run:

```powershell
cd C:\project\cctv
git push origin main
```

Expected: push succeeds and `origin/main` points at the latest documentation commit.

---

## Self-Review

- Spec coverage: The plan covers per-camera detected DOWN/UP time, separate alert send time, no DB migration, no public UI delay, and no transport-policy change.
- Placeholder scan: No unfinished markers or vague future steps are used.
- Type consistency: The planned field is consistently named `alertDetectedAt` from `cameraHealthService` through `telegramService`.
- Risk check: Runtime status, confirmation delay, Telegram routing, cooldown behavior, and RTSP transport remain unchanged; only notification payload enrichment and message formatting are changed.
