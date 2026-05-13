# Telegram Alert Timing UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram settings page explicitly show DOWN confirmation, UP confirmation, and anti-spam cooldown timing so operators do not confuse the existing 5-minute cooldown with first DOWN alert delay.

**Architecture:** Keep backend alert detection and confirmation policy unchanged. Add a small frontend-only timing summary in `TelegramSettingsPanel.jsx`, then lock the copy with focused Vitest coverage. Documentation updates are limited to the settings module map because this is a UI clarity polish, not a runtime flow change.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Tailwind CSS.

---

## File Structure

- Modify `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
  - Add a compact, read-only timing explanation inside the existing "Fitur Notifikasi" area.
  - Keep existing edit/save form state untouched.
  - Keep `FeatureItem` behavior unchanged for existing feature indicators.
- Modify `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`
  - Add assertions for DOWN confirmation, UP confirmation, and cooldown wording.
  - Reuse existing mocked `adminService.getTelegramStatus()` data.
- Modify `frontend/src/components/admin/settings/.module_map.md`
  - Document that Telegram settings now shows timing semantics for confirmation and cooldown.

## Safety Constraints

- Do not modify `backend/services/telegramAlertConfirmationPolicy.js`.
- Do not modify `backend/services/cameraHealthService.js`.
- Do not modify `backend/services/telegramService.js`.
- Do not change the 120-second DOWN confirmation, 60-second UP confirmation, or existing 5-minute Telegram cooldown.
- Do not add a backend setting or migration in this polish pass.
- Do not change public map/grid status behavior.
- Do not change internal HLS, RTSP TCP, RTSP UDP, or RTSP auto behavior.

## Expected Operator Copy

- Title: `Timing Alert Telegram`
- DOWN row: `DOWN dikirim setelah offline stabil 2 menit.`
- UP row: `UP dikirim setelah online stabil 1 menit.`
- Cooldown row: `Cooldown 5 menit hanya menahan pesan berulang setelah alert terkirim.`
- Clarifier: `Status di Map/Grid tetap mengikuti runtime kamera; delay ini hanya berlaku untuk pesan Telegram.`

---

### Task 1: Lock Timing Copy With a Failing UI Test

**Files:**
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`

- [ ] **Step 1: Add the failing test assertions**

In `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`, replace the current cooldown copy test:

```jsx
    it('explains cooldown as anti-spam instead of first DOWN delay', async () => {
        renderPanel();

        expect(await screen.findByText('Telegram Bot')).toBeTruthy();
        expect(screen.getByText('Cooldown Anti-Spam 5 Menit')).toBeTruthy();
        expect(screen.getByText('Mencegah pesan berulang setelah alert terkirim, bukan menunda deteksi DOWN pertama.')).toBeTruthy();
    });
```

with:

```jsx
    it('explains Telegram alert confirmation timing separately from cooldown', async () => {
        renderPanel();

        expect(await screen.findByText('Telegram Bot')).toBeTruthy();
        expect(screen.getByText('Timing Alert Telegram')).toBeTruthy();
        expect(screen.getByText('DOWN dikirim setelah offline stabil 2 menit.')).toBeTruthy();
        expect(screen.getByText('UP dikirim setelah online stabil 1 menit.')).toBeTruthy();
        expect(screen.getByText('Cooldown 5 menit hanya menahan pesan berulang setelah alert terkirim.')).toBeTruthy();
        expect(screen.getByText('Status di Map/Grid tetap mengikuti runtime kamera; delay ini hanya berlaku untuk pesan Telegram.')).toBeTruthy();
    });
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
cd C:\project\cctv\frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected: FAIL because `Timing Alert Telegram` and the new timing rows do not exist yet.

- [ ] **Step 3: Commit nothing**

Do not commit the failing test alone. Continue to Task 2 in the same working tree.

---

### Task 2: Add the Read-Only Timing Summary

**Files:**
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`

- [ ] **Step 1: Add a focused timing summary helper**

In `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`, add this helper after `FeatureItem`:

```jsx
function AlertTimingSummary() {
    const timingRows = [
        {
            label: 'DOWN',
            description: 'DOWN dikirim setelah offline stabil 2 menit.',
        },
        {
            label: 'UP',
            description: 'UP dikirim setelah online stabil 1 menit.',
        },
        {
            label: 'Cooldown',
            description: 'Cooldown 5 menit hanya menahan pesan berulang setelah alert terkirim.',
        },
    ];

    return (
        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Timing Alert Telegram</h4>
            <div className="mt-3 space-y-2">
                {timingRows.map((row) => (
                    <div key={row.label} className="flex items-start gap-3">
                        <span className="min-w-20 rounded-md bg-white px-2 py-1 text-xs font-bold text-blue-700 shadow-sm dark:bg-gray-900/70 dark:text-blue-300">
                            {row.label}
                        </span>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{row.description}</p>
                    </div>
                ))}
            </div>
            <p className="mt-3 text-xs font-medium text-gray-600 dark:text-gray-400">
                Status di Map/Grid tetap mengikuti runtime kamera; delay ini hanya berlaku untuk pesan Telegram.
            </p>
        </div>
    );
}
```

- [ ] **Step 2: Render the helper in the notification feature section**

In the "Fitur Notifikasi" card, after the closing `</div>` for the feature grid, change:

```jsx
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureItem title="Kamera Offline" description="Notifikasi otomatis saat kamera terputus." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kamera Online" description="Notifikasi saat kamera kembali terhubung." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kritik dan Saran" description="Notifikasi saat ada feedback baru." enabled={telegramStatus?.feedbackConfigured} />
                    <FeatureItem
                        title="Cooldown Anti-Spam 5 Menit"
                        description="Mencegah pesan berulang setelah alert terkirim, bukan menunda deteksi DOWN pertama."
                        enabled={telegramStatus?.enabled}
                    />
                </div>
            </div>
```

to:

```jsx
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureItem title="Kamera Offline" description="Notifikasi otomatis saat kamera terputus." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kamera Online" description="Notifikasi saat kamera kembali terhubung." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kritik dan Saran" description="Notifikasi saat ada feedback baru." enabled={telegramStatus?.feedbackConfigured} />
                    <FeatureItem
                        title="Cooldown Anti-Spam 5 Menit"
                        description="Mencegah pesan berulang setelah alert terkirim, bukan menunda deteksi DOWN pertama."
                        enabled={telegramStatus?.enabled}
                    />
                </div>
                <AlertTimingSummary />
            </div>
```

- [ ] **Step 3: Run the focused test to verify it passes**

Run:

```powershell
cd C:\project\cctv\frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected: PASS with 5 tests passing.

- [ ] **Step 4: Commit the UI polish**

Run:

```powershell
cd C:\project\cctv
git add frontend/src/components/admin/settings/TelegramSettingsPanel.jsx frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
git commit -m "Fix: clarify Telegram alert timing settings"
```

---

### Task 3: Document Settings Panel Timing Semantics

**Files:**
- Modify: `frontend/src/components/admin/settings/.module_map.md`

- [ ] **Step 1: Update the Telegram panel map entry**

In `frontend/src/components/admin/settings/.module_map.md`, change:

```md
- `TelegramSettingsPanel.jsx`: Telegram bot settings, multi-target monitoring groups, and notification routing rules.
```

to:

```md
- `TelegramSettingsPanel.jsx`: Telegram bot settings, multi-target monitoring groups, notification routing rules, and read-only timing semantics for DOWN/UP confirmation versus cooldown.
```

- [ ] **Step 2: Run a docs-only status check**

Run:

```powershell
cd C:\project\cctv
git diff -- frontend/src/components/admin/settings/.module_map.md
```

Expected: one line updated in the Telegram panel entry.

- [ ] **Step 3: Commit the doc sync**

Run:

```powershell
cd C:\project\cctv
git add frontend/src/components/admin/settings/.module_map.md
git commit -m "Add: document Telegram settings timing semantics"
```

---

### Task 4: Final Verification and Push

**Files:**
- Verify: frontend settings panel, frontend production build, backend Telegram/health safety tests.

- [ ] **Step 1: Run the frontend focused test**

Run:

```powershell
cd C:\project\cctv\frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected: PASS with 5 tests passing.

- [ ] **Step 2: Run the frontend build**

Run:

```powershell
cd C:\project\cctv\frontend
npm run build
```

Expected: PASS with Vite production build completed.

- [ ] **Step 3: Run backend guard tests to prove runtime logic stayed unchanged**

Run:

```powershell
cd C:\project\cctv\backend
npm test -- telegramAlertConfirmationPolicy.test.js cameraHealthService.test.js cameraMonitoringAlertPolicy.test.js telegramService.test.js internalRtspTransportPolicy.test.js
```

Expected: PASS with all targeted Telegram, health, monitoring policy, and RTSP transport tests passing.

- [ ] **Step 4: Confirm only planned commits are ahead**

Run:

```powershell
cd C:\project\cctv
git status --short --branch
git log --oneline --decorate -5
```

Expected: branch `main` is ahead of `origin/main` only by:

```text
Fix: clarify Telegram alert timing settings
Add: document Telegram settings timing semantics
```

- [ ] **Step 5: Push to main**

Run:

```powershell
cd C:\project\cctv
git push origin main
```

Expected: push succeeds and `main` updates on GitHub.

---

## Self-Review

- Spec coverage: This plan covers the requested polish only: operator-visible timing clarity while keeping backend UP/DOWN detection unchanged.
- Placeholder scan: No unfinished markers or vague future steps are used.
- Type consistency: `AlertTimingSummary`, `timingRows`, and all expected strings are defined before use and match the test assertions.
- Risk check: The only runtime code planned is static React rendering. Backend health, Telegram alert routing, RTSP transport, and public map/grid status are verification-only in this plan.
