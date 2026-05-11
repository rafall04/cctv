<!--
Purpose: Implementation plan for hardening Telegram notification configuration, per-area routing, and admin validation.
Caller: Superpowers planning workflow after Telegram notification routing analysis.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, frontend/src/.module_map.md, frontend/src/components/admin/settings/.module_map.md.
MainFuncs: Documents TDD steps, exact target edits, verification commands, and commit checkpoints.
SideEffects: None; documentation only.
-->

# Telegram Notification Routing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram monitoring safe to edit, accurate in admin status, testable per custom group, and reliable for per-area/per-camera routing.

**Architecture:** Keep routing decisions in `backend/services/telegramService.js`, keep HTTP request shaping in `backend/controllers/adminController.js`, and keep UI-only form state in `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`. Preserve existing public service exports while adding small pure helpers around token preservation, status calculation, target lookup, and rule validation. Add backend service tests first, then frontend component tests for the admin settings panel.

**Tech Stack:** Node.js 20, Fastify 4, SQLite settings table, Vitest, React 18, React Testing Library, Vite, Tailwind CSS.

---

## File Structure

- Modify: `backend/services/telegramService.js`
  - Responsibility: Normalize Telegram settings, route camera status notifications to monitoring targets, send test/feedback messages, expose admin status.
  - Planned change: Preserve masked bot tokens on save, calculate camera monitoring status from legacy or custom targets, expose per-target test sending, and expose validation metadata for invalid/unrouted rules.
- Modify: `backend/controllers/adminController.js`
  - Responsibility: Shape admin Telegram status/update/test responses.
  - Planned change: Accept `type: 'target'` plus `targetId` for test notifications, keep update payloads strict, and return precise 400 messages for invalid test targets.
- Modify: `backend/__tests__/telegramService.test.js`
  - Responsibility: Verify Telegram service routing and settings behavior without real network/database.
  - Planned change: Add tests for masked token preservation, custom-only monitoring status, target test delivery, invalid area/camera rules, and unrouted camera fallback behavior.
- Create: `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`
  - Responsibility: Verify the admin Telegram panel loads, saves, displays target routing state, and sends target tests.
  - Planned change: Mock `adminService` and `areaService`; cover masked token handling in the form, custom target status labels, and per-target test calls.
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
  - Responsibility: Admin UI for Telegram bot settings, monitoring groups, and routing rules.
  - Planned change: Do not encourage resaving masked tokens blindly, show camera-monitoring active status for custom-only target configs, add per-target test buttons, add event checkboxes, and surface rule validation warnings.
- Modify: `frontend/src/services/adminService.js`
  - Responsibility: Frontend wrapper for admin API calls.
  - Planned change: Allow `testTelegramNotification(type, options)` to send `targetId` while preserving current call sites.
- No database migration is required:
  - Telegram configuration remains in the existing `settings` table under `telegram_config`.
  - DB I/O stays one indexed key lookup/update per status/update call; no high-cardinality table changes.

## Target Behavior

- Saving an unchanged masked token from admin UI must keep the existing full bot token in the database.
- Clearing the token field must clear Telegram authentication.
- Entering a new non-masked token must replace the old token.
- A config with `botToken` plus only `notificationTargets` and `notificationRules` must be considered camera-monitoring configured.
- Per-area groups must receive only cameras whose `camera.area_id` matches the area rule and whose ingest mode matches the rule.
- Per-camera groups must receive only cameras whose `camera.id` matches the camera rule.
- A custom target must be testable without requiring `monitoringChatId`.
- Invalid area/camera rules must be visible in admin status and not silently presented as healthy.
- Existing fallback behavior must remain: when there are no routing rules and `monitoringChatId` exists, legacy monitoring receives internal always-on offline/online events.

---

### Task 1: Backend Tests For Safe Settings Persistence And Status

**Files:**
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Add tests for masked token preservation and custom-only status**

Append these tests inside `describe('telegramService notification routing', () => { ... })`:

```javascript
    it('preserves the existing full bot token when admin saves a masked token', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:real-secret-token',
            monitoringChatId: '-100-main',
            feedbackChatId: '',
            notificationTargets: [],
            notificationRules: [],
        });

        queryOneMock.mockReturnValueOnce({
            value: JSON.stringify({
                botToken: '123456789:real-secret-token',
                monitoringChatId: '-100-main',
                feedbackChatId: '',
                notificationTargets: [],
                notificationRules: [],
            }),
        });

        const saved = telegram.saveTelegramSettings({
            botToken: '123456789...',
            monitoringChatId: '-100-main',
            feedbackChatId: '',
            notificationTargets: [],
            notificationRules: [],
        });

        expect(saved).toBe(true);
        const savedPayload = JSON.parse(executeMock.mock.calls[0][1][0]);
        expect(savedPayload.botToken).toBe('123456789:real-secret-token');
    });

    it('reports camera monitoring configured when only custom routing targets exist', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
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
                    events: ['offline', 'online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        const status = telegram.getTelegramStatus();

        expect(status.enabled).toBe(true);
        expect(status.monitoringConfigured).toBe(false);
        expect(status.cameraMonitoringConfigured).toBe(true);
        expect(status.notificationTargets).toHaveLength(1);
        expect(status.notificationRules).toHaveLength(1);
    });
```

- [ ] **Step 2: Run focused backend test and confirm it fails**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result before implementation:

```text
FAIL backend/__tests__/telegramService.test.js
AssertionError: expected '123456789...' to be '123456789:real-secret-token'
```

- [ ] **Step 3: Commit the failing tests if red-state commits are required**

Run only if the maintainer wants red-state commits:

```bash
git add backend/__tests__/telegramService.test.js
git commit -m "Fix: add Telegram settings persistence regression tests"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 2: Preserve Bot Tokens And Correct Status Semantics

**Files:**
- Modify: `backend/services/telegramService.js`

- [ ] **Step 1: Add pure token/status helpers near constants**

Add this block after `const VALID_EVENTS = new Set(['offline', 'online']);`:

```javascript
const MASKED_TOKEN_SUFFIX = '...';

function isMaskedTelegramToken(value = '') {
    return typeof value === 'string' && value.endsWith(MASKED_TOKEN_SUFFIX);
}

function resolveBotTokenForSave(nextToken = '', currentToken = '') {
    const normalizedNext = String(nextToken || '').trim();
    const normalizedCurrent = String(currentToken || '').trim();

    if (!normalizedNext) {
        return '';
    }

    if (isMaskedTelegramToken(normalizedNext)) {
        const visiblePrefix = normalizedNext.slice(0, -MASKED_TOKEN_SUFFIX.length);
        if (normalizedCurrent && normalizedCurrent.startsWith(visiblePrefix)) {
            return normalizedCurrent;
        }
    }

    return normalizedNext;
}

function hasCameraMonitoringTarget(settings = {}) {
    return Boolean(settings.monitoringChatId)
        || (Array.isArray(settings.notificationTargets) && settings.notificationTargets.length > 0);
}
```

- [ ] **Step 2: Replace `saveTelegramSettings` with token-preserving persistence**

Find the existing `export function saveTelegramSettings(settings) { ... }` block and replace it with:

```javascript
export function saveTelegramSettings(settings) {
    try {
        const existing = queryOne('SELECT * FROM settings WHERE key = ?', ['telegram_config']);
        const currentSettings = existing?.value
            ? normalizeTelegramSettings(JSON.parse(existing.value))
            : normalizeTelegramSettings({});
        const normalized = normalizeTelegramSettings({
            ...settings,
            botToken: resolveBotTokenForSave(settings.botToken, currentSettings.botToken),
        });
        const valueStr = JSON.stringify(normalized);

        if (existing) {
            execute(
                'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                [valueStr, 'telegram_config']
            );
        } else {
            execute(
                'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
                ['telegram_config', valueStr, 'Telegram Bot Configuration']
            );
        }

        clearSettingsCache();
        return true;
    } catch (error) {
        console.error('[Telegram] Error saving settings:', error);
        return false;
    }
}
```

- [ ] **Step 3: Replace `getTelegramStatus` status booleans**

Find:

```javascript
        enabled: !!(settings.botToken && (settings.monitoringChatId || settings.feedbackChatId)),
        monitoringConfigured: !!(settings.botToken && settings.monitoringChatId),
        feedbackConfigured: !!(settings.botToken && settings.feedbackChatId),
```

Replace with:

```javascript
        enabled: !!(settings.botToken && (hasCameraMonitoringTarget(settings) || settings.feedbackChatId)),
        monitoringConfigured: !!(settings.botToken && settings.monitoringChatId),
        cameraMonitoringConfigured: !!(settings.botToken && hasCameraMonitoringTarget(settings)),
        feedbackConfigured: !!(settings.botToken && settings.feedbackChatId),
```

- [ ] **Step 4: Run focused backend test and confirm it passes**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result:

```text
PASS backend/__tests__/telegramService.test.js
```

- [ ] **Step 5: Commit backend token/status fix**

Run:

```bash
git add backend/services/telegramService.js backend/__tests__/telegramService.test.js
git commit -m "Fix: preserve Telegram token and custom monitoring status"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 3: Backend Tests For Per-Target Test Notifications

**Files:**
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Add service tests for custom target test delivery**

Append these tests inside `describe('telegramService notification routing', () => { ... })`:

```javascript
    it('sends a test notification to a custom monitoring target by target id', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [],
        });

        const sent = await telegram.sendTestNotification('target', { targetId: 'area-bojonegoro' });

        expect(sent).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.chat_id).toBe('-100-area');
        expect(payload.text).toContain('Area Bojonegoro');
    });

    it('does not send a custom target test for an unknown target id', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [],
        });

        const sent = await telegram.sendTestNotification('target', { targetId: 'missing-target' });

        expect(sent).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run focused backend test and confirm it fails**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result before implementation:

```text
FAIL backend/__tests__/telegramService.test.js
AssertionError: expected false to be true
```

---

### Task 4: Implement Per-Target Test Notifications

**Files:**
- Modify: `backend/services/telegramService.js`
- Modify: `backend/controllers/adminController.js`

- [ ] **Step 1: Add a target lookup helper in `telegramService.js`**

Add this function after `sendFeedbackMessage`:

```javascript
export async function sendTargetTestMessage(targetId) {
    const settings = getTelegramSettings();
    const normalizedTargetId = String(targetId || '').trim();
    const target = settings.notificationTargets.find((item) => item.id === normalizedTargetId);

    if (!target?.chatId) {
        return false;
    }

    const message = `
✅ <b>Test Notifikasi Berhasil</b>
━━━━━━━━━━━━━━━━━━━━
Bot Telegram terhubung dengan baik.
Target: ${target.name}
⏰ ${formatDateTime(new Date())}
━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendToTelegram(message, target.chatId);
}
```

- [ ] **Step 2: Replace `sendTestNotification` signature and branch logic**

Find:

```javascript
export async function sendTestNotification(type = 'monitoring') {
```

Replace with:

```javascript
export async function sendTestNotification(type = 'monitoring', options = {}) {
```

Find:

```javascript
    if (type === 'feedback') {
        return sendFeedbackMessage(message);
    }
    return sendMonitoringMessage(message);
```

Replace with:

```javascript
    if (type === 'feedback') {
        return sendFeedbackMessage(message);
    }

    if (type === 'target') {
        return sendTargetTestMessage(options.targetId);
    }

    return sendMonitoringMessage(message);
```

- [ ] **Step 3: Add `sendTargetTestMessage` to the default export**

Find:

```javascript
    sendFeedbackMessage,
```

Replace with:

```javascript
    sendFeedbackMessage,
    sendTargetTestMessage,
```

- [ ] **Step 4: Update admin controller test handling**

In `backend/controllers/adminController.js`, find:

```javascript
        const { type = 'monitoring' } = request.body || {};
```

Replace with:

```javascript
        const { type = 'monitoring', targetId = '' } = request.body || {};
```

Find:

```javascript
        const sent = await sendTestNotification(type);
```

Replace with:

```javascript
        const sent = await sendTestNotification(type, { targetId });
```

- [ ] **Step 5: Run focused backend tests**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result:

```text
PASS backend/__tests__/telegramService.test.js
```

- [ ] **Step 6: Commit backend target test support**

Run:

```bash
git add backend/services/telegramService.js backend/controllers/adminController.js backend/__tests__/telegramService.test.js
git commit -m "Fix: support Telegram custom target test notifications"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 5: Backend Tests For Rule Validation Metadata

**Files:**
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Add status validation tests**

Append this test inside `describe('telegramService notification routing', () => { ... })`:

```javascript
    it('reports invalid routing rules without sending them as healthy policy', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'missing-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: '',
                    events: ['offline'],
                    ingestModes: ['always_on'],
                },
                {
                    id: 'missing-target',
                    enabled: true,
                    targetId: 'unknown-target',
                    scope: 'global',
                    events: ['online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        const status = telegram.getTelegramStatus();

        expect(status.notificationRuleIssues).toEqual([
            {
                id: 'missing-area',
                severity: 'error',
                message: 'Rule area membutuhkan areaId valid.',
            },
            {
                id: 'missing-target',
                severity: 'error',
                message: 'Rule mengarah ke target Telegram yang tidak tersedia.',
            },
        ]);
    });
```

- [ ] **Step 2: Run focused backend test and confirm it fails**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result before implementation:

```text
FAIL backend/__tests__/telegramService.test.js
AssertionError: expected undefined to deeply equal [...]
```

---

### Task 6: Implement Rule Validation Metadata

**Files:**
- Modify: `backend/services/telegramService.js`

- [ ] **Step 1: Add rule issue builder**

Add this function after `ruleMatchesCamera`:

```javascript
function buildNotificationRuleIssues(settings = {}) {
    const targetsById = new Map((settings.notificationTargets || []).map((target) => [target.id, target]));
    const issues = [];

    for (const rule of settings.notificationRules || []) {
        if (!targetsById.has(rule.targetId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule mengarah ke target Telegram yang tidak tersedia.',
            });
            continue;
        }

        if (rule.scope === 'area' && Number.isNaN(rule.areaId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule area membutuhkan areaId valid.',
            });
        }

        if (rule.scope === 'camera' && Number.isNaN(rule.cameraId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule kamera membutuhkan cameraId valid.',
            });
        }

        if (!Array.isArray(rule.events) || rule.events.length === 0) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule membutuhkan minimal satu event offline atau online.',
            });
        }
    }

    return issues;
}
```

- [ ] **Step 2: Add validation issues to `getTelegramStatus`**

In `getTelegramStatus`, add this line before `return {`:

```javascript
    const notificationRuleIssues = buildNotificationRuleIssues(settings);
```

Then add this property before the closing object:

```javascript
        notificationRuleIssues,
```

- [ ] **Step 3: Run focused backend tests**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result:

```text
PASS backend/__tests__/telegramService.test.js
```

- [ ] **Step 4: Commit backend validation metadata**

Run:

```bash
git add backend/services/telegramService.js backend/__tests__/telegramService.test.js
git commit -m "Fix: expose Telegram routing rule validation"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 7: Frontend Tests For Telegram Settings Panel

**Files:**
- Create: `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`

- [ ] **Step 1: Create the component test file**

Create `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx` with:

```jsx
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramSettingsPanel from './TelegramSettingsPanel';
import { adminService } from '../../../services/adminService';
import { areaService } from '../../../services/areaService';

vi.mock('../../../services/adminService', () => ({
    adminService: {
        getTelegramStatus: vi.fn(),
        updateTelegramConfig: vi.fn(),
        testTelegramNotification: vi.fn(),
    },
}));

vi.mock('../../../services/areaService', () => ({
    areaService: {
        getAllAreas: vi.fn(),
    },
}));

const statusPayload = {
    enabled: true,
    monitoringConfigured: false,
    cameraMonitoringConfigured: true,
    feedbackConfigured: false,
    botToken: '123456789...',
    monitoringChatId: '',
    feedbackChatId: '',
    notificationTargets: [
        { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area', enabled: true },
    ],
    notificationRules: [
        {
            id: 'rule-area',
            enabled: true,
            targetId: 'area-bojonegoro',
            scope: 'area',
            areaId: 7,
            cameraId: null,
            events: ['offline'],
            ingestModes: ['always_on'],
        },
    ],
    notificationRuleIssues: [],
};

describe('TelegramSettingsPanel', () => {
    beforeEach(() => {
        adminService.getTelegramStatus.mockResolvedValue({ success: true, data: statusPayload });
        adminService.updateTelegramConfig.mockResolvedValue({ success: true, data: statusPayload });
        adminService.testTelegramNotification.mockResolvedValue({ success: true, message: 'ok' });
        areaService.getAllAreas.mockResolvedValue({
            success: true,
            data: [{ id: 7, name: 'KAB BOJONEGORO' }],
        });
    });

    it('shows custom-only camera monitoring as active', async () => {
        render(<TelegramSettingsPanel />);

        expect(await screen.findByText('Telegram Bot')).toBeTruthy();
        expect(screen.getByText('Multi Grup Monitoring')).toBeTruthy();
        expect(screen.getByText('Routing Policy')).toBeTruthy();
        expect(screen.getAllByText('AKTIF').length).toBeGreaterThan(0);
    });

    it('sends a test notification to a custom target', async () => {
        render(<TelegramSettingsPanel />);

        expect(await screen.findByText('Area Bojonegoro')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Test Area Bojonegoro' }));

        await waitFor(() => {
            expect(adminService.testTelegramNotification).toHaveBeenCalledWith('target', {
                targetId: 'area-bojonegoro',
            });
        });
    });

    it('saves the masked token unchanged so backend can preserve the full token', async () => {
        render(<TelegramSettingsPanel />);

        fireEvent.click(await screen.findByText('Edit'));
        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => {
            expect(adminService.updateTelegramConfig).toHaveBeenCalledWith(
                expect.objectContaining({ botToken: '123456789...' })
            );
        });
    });
});
```

- [ ] **Step 2: Run focused frontend test and confirm it fails**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected result before implementation:

```text
FAIL frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Test Area Bojonegoro"
```

---

### Task 8: Update Frontend Service And Telegram Panel UI

**Files:**
- Modify: `frontend/src/services/adminService.js`
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`

- [ ] **Step 1: Update `adminService.testTelegramNotification` signature**

In `frontend/src/services/adminService.js`, find:

```javascript
    async testTelegramNotification(type = 'monitoring') {
        try {
            const response = await apiClient.post('/api/admin/telegram/test', { type });
```

Replace with:

```javascript
    async testTelegramNotification(type = 'monitoring', options = {}) {
        try {
            const response = await apiClient.post('/api/admin/telegram/test', { type, ...options });
```

- [ ] **Step 2: Update panel test loading state for dynamic target keys**

In `TelegramSettingsPanel.jsx`, replace:

```javascript
    const [testLoading, setTestLoading] = useState({ monitoring: false, feedback: false });
```

With:

```javascript
    const [testLoading, setTestLoading] = useState({});
```

- [ ] **Step 3: Replace `handleTestNotification` with target-aware handling**

Find:

```javascript
    const handleTestNotification = async (type) => {
        setTestLoading((prev) => ({ ...prev, [type]: true }));
        setTestResult(null);

        try {
            const response = await adminService.testTelegramNotification(type);
            setTestResult({
                type: response.success ? 'success' : 'error',
                message: response.message || (response.success ? 'Notifikasi test berhasil dikirim.' : 'Gagal mengirim notifikasi test'),
            });
        } catch (requestError) {
            setTestResult({ type: 'error', message: 'Gagal terhubung ke server' });
        } finally {
            setTestLoading((prev) => ({ ...prev, [type]: false }));
        }
    };
```

Replace with:

```javascript
    const handleTestNotification = async (type, options = {}) => {
        const loadingKey = options.targetId ? `target:${options.targetId}` : type;
        setTestLoading((prev) => ({ ...prev, [loadingKey]: true }));
        setTestResult(null);

        try {
            const response = await adminService.testTelegramNotification(type, options);
            setTestResult({
                type: response.success ? 'success' : 'error',
                message: response.message || (response.success ? 'Notifikasi test berhasil dikirim.' : 'Gagal mengirim notifikasi test'),
            });
        } catch (requestError) {
            setTestResult({ type: 'error', message: 'Gagal terhubung ke server' });
        } finally {
            setTestLoading((prev) => ({ ...prev, [loadingKey]: false }));
        }
    };
```

- [ ] **Step 4: Add target test buttons in read-only mode**

After the read-only `FeatureItem` grid for `Multi Grup Monitoring` and `Routing Policy`, insert:

```jsx
                            {(telegramStatus?.notificationTargets || []).length > 0 && (
                                <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Target Grup Aktif</h3>
                                    <div className="space-y-2">
                                        {(telegramStatus.notificationTargets || []).map((target) => {
                                            const loadingKey = `target:${target.id}`;
                                            return (
                                                <div key={target.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-gray-900 dark:text-white truncate">{target.name}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{target.chatId}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        aria-label={`Test ${target.name}`}
                                                        onClick={() => handleTestNotification('target', { targetId: target.id })}
                                                        disabled={testLoading[loadingKey]}
                                                        className="shrink-0 text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-60"
                                                    >
                                                        {testLoading[loadingKey] ? 'Mengirim...' : 'Test'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
```

- [ ] **Step 5: Update camera feature status booleans**

Find both uses:

```jsx
enabled={telegramStatus?.monitoringConfigured}
```

For camera offline/online feature items only, replace with:

```jsx
enabled={telegramStatus?.cameraMonitoringConfigured}
```

Keep feedback status using `feedbackConfigured`.

- [ ] **Step 6: Surface validation issues**

Add this block near the top of the return body after success/test alerts:

```jsx
            {(telegramStatus?.notificationRuleIssues || []).length > 0 && (
                <Alert
                    type="warning"
                    title="Routing Telegram perlu diperiksa"
                    message={telegramStatus.notificationRuleIssues.map((issue) => issue.message).join(' ')}
                />
            )}
```

- [ ] **Step 7: Run focused frontend test**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected result:

```text
PASS frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
```

- [ ] **Step 8: Commit frontend panel changes**

Run:

```bash
git add frontend/src/services/adminService.js frontend/src/components/admin/settings/TelegramSettingsPanel.jsx frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
git commit -m "Fix: expose Telegram custom target tests in settings"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 9: Add Event Selection Controls For Rules

**Files:**
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx`

- [ ] **Step 1: Add frontend test for event selection persistence**

Append this test inside `describe('TelegramSettingsPanel', () => { ... })`:

```jsx
    it('allows operators to disable online events for an area rule', async () => {
        render(<TelegramSettingsPanel />);

        fireEvent.click(await screen.findByText('Edit'));
        fireEvent.click(screen.getByLabelText('Online rule-area'));
        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => {
            expect(adminService.updateTelegramConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    notificationRules: [
                        expect.objectContaining({
                            id: 'rule-area',
                            events: ['offline'],
                        }),
                    ],
                })
            );
        });
    });
```

- [ ] **Step 2: Add event toggle helper in the component**

Add this helper after `updateRule`:

```javascript
    const toggleRuleEvent = (index, eventName) => {
        setFormData((prev) => ({
            ...prev,
            notificationRules: (prev.notificationRules || []).map((rule, ruleIndex) => {
                if (ruleIndex !== index) return rule;
                const currentEvents = Array.isArray(rule.events) ? rule.events : [];
                const nextEvents = currentEvents.includes(eventName)
                    ? currentEvents.filter((item) => item !== eventName)
                    : [...currentEvents, eventName];
                return { ...rule, events: nextEvents };
            }),
        }));
    };
```

- [ ] **Step 3: Insert event checkboxes into each rule row**

In the rule row grid, after the `Ingest` select block and before the `Hapus` button, insert:

```jsx
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Event</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {['offline', 'online'].map((eventName) => (
                                                        <label key={eventName} className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`${eventName === 'offline' ? 'Offline' : 'Online'} ${rule.id}`}
                                                                checked={(rule.events || []).includes(eventName)}
                                                                onChange={() => toggleRuleEvent(index, eventName)}
                                                                className="rounded border-gray-300 text-primary focus:ring-primary"
                                                            />
                                                            {eventName === 'offline' ? 'Offline' : 'Online'}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
```

- [ ] **Step 4: Adjust rule grid columns**

Find:

```jsx
className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl"
```

Replace with:

```jsx
className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-3 items-end p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl"
```

- [ ] **Step 5: Run focused frontend test**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx
```

Expected result:

```text
PASS frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
```

- [ ] **Step 6: Commit frontend rule event controls**

Run:

```bash
git add frontend/src/components/admin/settings/TelegramSettingsPanel.jsx frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
git commit -m "Fix: add Telegram routing event controls"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 10: Regression Verification And Docs Sync

**Files:**
- Modify if flow wording changes are needed: `backend/services/.module_map.md`
- Modify if frontend panel responsibility wording changes is needed: `frontend/src/components/admin/settings/.module_map.md`

- [ ] **Step 1: Check whether map docs need updates**

Run:

```bash
git diff -- backend/services/telegramService.js frontend/src/components/admin/settings/TelegramSettingsPanel.jsx
```

Expected decision:

```text
If the implementation only hardens existing Telegram target/rule/test responsibilities already described in maps, no map change is required.
If new responsibility wording is needed, update the relevant .module_map.md header/body before final verification.
```

- [ ] **Step 2: Run backend focused tests**

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected result:

```text
PASS backend/__tests__/telegramService.test.js
```

- [ ] **Step 3: Run frontend focused tests**

Run:

```bash
cd frontend
npm test -- TelegramSettingsPanel.test.jsx UnifiedSettings.test.jsx
```

Expected result:

```text
PASS frontend/src/components/admin/settings/TelegramSettingsPanel.test.jsx
PASS frontend/src/pages/UnifiedSettings.test.jsx
```

- [ ] **Step 4: Run backend full gate if focused tests pass**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected result:

```text
All migrations already applied or completed successfully.
PASS
```

- [ ] **Step 5: Run frontend build/lint gate if focused tests pass**

Run:

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected result:

```text
PASS
vite build completed successfully
ESLint completed without errors
```

- [ ] **Step 6: Commit any docs or cleanup changes**

Run only if Step 1 required doc sync or verification caused deterministic formatting updates:

```bash
git add backend/services/.module_map.md frontend/src/components/admin/settings/.module_map.md
git commit -m "Fix: sync Telegram notification routing docs"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

## Manual Acceptance Checklist

- [ ] Open Admin Settings -> Telegram Bot.
- [ ] Confirm a config with bot token and only custom target groups shows camera monitoring active.
- [ ] Click `Test` for a custom group and confirm the Telegram group receives the message.
- [ ] Save without changing the masked bot token, then run the same custom target test again.
- [ ] Create one area rule for an area group and trigger or simulate an offline camera in that area.
- [ ] Confirm that only the target area group receives that camera.
- [ ] Confirm an unrelated area camera is not sent to that area group.
- [ ] Disable `online` event for one rule, save, and confirm online recovery notifications no longer route through that rule.
- [ ] Create an invalid area rule with no area selected and confirm the admin panel shows a routing warning.

## Self-Review Notes

- Spec coverage: Covers token safety, custom-only monitoring status, per-target tests, area/camera routing validation, event controls, focused tests, full verification, and commit/push boundaries.
- Placeholder scan: No `TBD`, `TODO`, or unresolved implementation placeholders are present.
- Type consistency: Uses existing payload names `notificationTargets`, `notificationRules`, `targetId`, `areaId`, `cameraId`, `events`, and `ingestModes`; new status fields are `cameraMonitoringConfigured` and `notificationRuleIssues`.
- DB impact: Reads/writes stay on the single `settings.key = 'telegram_config'` row; no new indexes or migrations are needed.
