# Telegram Notification Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a protected admin diagnostics page that proves Telegram notification routing for a selected CCTV before operators depend on production offline/online alerts.

**Architecture:** Keep Telegram Settings focused on configuration and add a separate `/admin/notification-diagnostics` operational page. Backend owns routing preview, read-only camera health snapshot, drill delivery through the same Telegram camera-status routing logic, and persisted diagnostic audit rows. Frontend renders a dense admin workflow: select camera/event, preview matched rules and targets, run drill, and inspect recent delivery results.

**Tech Stack:** Node.js 20+, Fastify, SQLite via existing database helpers, React 18, Vite, Tailwind, Vitest.

<!--
Purpose: Implementation plan for Telegram notification diagnostics page and API.
Caller: Agents implementing the notification diagnostics feature.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, frontend/src/.module_map.md, frontend/src/pages/.module_map.md.
MainFuncs: Defines backend diagnostics service/API, frontend admin page/service/navigation, tests, verification, commit sequence.
SideEffects: Documentation only.
-->

---

## File Structure

- Create `backend/database/migrations/202605110001_create_notification_diagnostic_runs.js`
  - Owns one forward-only SQLite table for diagnostic drill audit rows and indexes.
- Modify `backend/services/telegramService.js`
  - Expose pure routing inspection and drill send helpers so preview and drill share the same rule matching as production camera notifications.
- Create `backend/services/notificationDiagnosticsService.js`
  - Owns camera lookup, health snapshot read, routing preview composition, drill execution, and audit row persistence.
- Modify `backend/controllers/adminController.js`
  - Add thin handlers for diagnostics preview, drill, and recent runs.
- Modify `backend/routes/adminRoutes.js`
  - Register protected diagnostics endpoints under `/api/admin/notification-diagnostics`.
- Create `backend/__tests__/notificationDiagnosticsService.test.js`
  - Focused service coverage for preview, drill success/failure, and audit masking.
- Modify `backend/__tests__/telegramService.test.js`
  - Add routing-inspection tests close to the existing Telegram routing tests.
- Modify `frontend/src/services/adminService.js`
  - Add API client methods for diagnostics preview, drill, and history.
- Create `frontend/src/pages/NotificationDiagnostics.jsx`
  - Route-level admin page for camera/event selection, preview, drill action, and recent run list.
- Create `frontend/src/pages/NotificationDiagnostics.test.jsx`
  - Focused UI coverage for preview, disabled drill when no target, successful drill, and error display.
- Modify `frontend/src/App.jsx`
  - Lazy-load and register `/admin/notification-diagnostics`.
- Modify `frontend/src/layouts/AdminLayout.jsx`
  - Add navigation item, preferably near `Health Debug` or `Settings`.
- Modify `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
  - Add a compact link to the diagnostics page without adding diagnostics UI into settings.
- Modify maps:
  - `backend/.module_map.md`
  - `backend/services/.module_map.md`
  - `frontend/src/.module_map.md`
  - `frontend/src/pages/.module_map.md`

---

### Task 1: Database Audit Table

**Files:**
- Create: `backend/database/migrations/202605110001_create_notification_diagnostic_runs.js`

- [ ] **Step 1: Write the migration**

Create the file with this exact content:

```javascript
/**
 * Purpose: Create persisted audit rows for admin-triggered Telegram notification diagnostics.
 * Caller: backend/database/run-all-migrations.js.
 * Deps: better-sqlite3 migration connection.
 * MainFuncs: up.
 * SideEffects: Creates notification_diagnostic_runs table and lookup indexes.
 */

export function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_diagnostic_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER,
            camera_name TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN ('offline', 'online')),
            mode TEXT NOT NULL CHECK (mode IN ('preview', 'drill')),
            success INTEGER NOT NULL DEFAULT 0,
            target_count INTEGER NOT NULL DEFAULT 0,
            sent_count INTEGER NOT NULL DEFAULT 0,
            skipped_reason TEXT,
            error_message TEXT,
            targets_json TEXT NOT NULL DEFAULT '[]',
            routing_json TEXT NOT NULL DEFAULT '{}',
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notification_diagnostic_runs_created_at
            ON notification_diagnostic_runs(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_notification_diagnostic_runs_camera_event
            ON notification_diagnostic_runs(camera_id, event_type, created_at DESC);
    `);
}
```

- [ ] **Step 2: Run migration**

Run:

```bash
cd backend
npm run migrate
```

Expected: exit 0 and `All migrations completed successfully`.

- [ ] **Step 3: Verify index coverage**

Run:

```bash
cd backend
node -e "import('./database/database.js').then(({ query }) => console.log(query('PRAGMA index_list(notification_diagnostic_runs)')))"
```

Expected: output includes `idx_notification_diagnostic_runs_created_at` and `idx_notification_diagnostic_runs_camera_event`.

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/202605110001_create_notification_diagnostic_runs.js
git commit -m "Add: Telegram notification diagnostics audit table"
```

---

### Task 2: Telegram Routing Inspection Boundary

**Files:**
- Modify: `backend/services/telegramService.js`
- Modify: `backend/__tests__/telegramService.test.js`

- [ ] **Step 1: Add failing Telegram service tests**

Append tests to `backend/__tests__/telegramService.test.js` that assert routing inspection does not send network requests and uses the same custom target/rule model:

```javascript
it('previews camera routing for area-scoped Telegram notification rules', async () => {
    mockSetting({
        botToken: '123456789:token',
        notificationTargets: [
            { id: 'area-a', name: 'Area A Group', chatId: '-1001', enabled: true },
            { id: 'area-b', name: 'Area B Group', chatId: '-1002', enabled: true },
        ],
        notificationRules: [
            { id: 'rule-area-a', targetId: 'area-a', scope: 'area', areaId: 10, events: ['offline'], ingestModes: ['any'], enabled: true },
            { id: 'rule-area-b', targetId: 'area-b', scope: 'area', areaId: 20, events: ['offline'], ingestModes: ['any'], enabled: true },
        ],
    });

    const { inspectCameraNotificationRouting } = await import('../services/telegramService.js');
    const preview = inspectCameraNotificationRouting('offline', {
        id: 7,
        name: 'Gate 1',
        area_id: 10,
        area_name: 'Area A',
        source_profile: 'internal',
        internal_ingest_policy_mode: 'always_on',
    });

    expect(preview.configured).toBe(true);
    expect(preview.matchedTargets).toEqual([
        expect.objectContaining({ id: 'area-a', name: 'Area A Group', chatIdMasked: '-1001' }),
    ]);
    expect(preview.matchedRules).toEqual([
        expect.objectContaining({ id: 'rule-area-a', targetId: 'area-a', matched: true }),
    ]);
    expect(preview.unmatchedRules).toEqual([
        expect.objectContaining({ id: 'rule-area-b', targetId: 'area-b', matched: false }),
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
});

it('returns disabled reason when no Telegram target matches a camera event', async () => {
    mockSetting({
        botToken: '123456789:token',
        notificationTargets: [{ id: 'online-only', name: 'Online Group', chatId: '-1009', enabled: true }],
        notificationRules: [
            { id: 'online-rule', targetId: 'online-only', scope: 'global', events: ['online'], ingestModes: ['any'], enabled: true },
        ],
    });

    const { inspectCameraNotificationRouting } = await import('../services/telegramService.js');
    const preview = inspectCameraNotificationRouting('offline', {
        id: 7,
        name: 'Gate 1',
        area_id: 10,
        area_name: 'Area A',
    });

    expect(preview.configured).toBe(true);
    expect(preview.canSend).toBe(false);
    expect(preview.skippedReason).toBe('NO_MATCHING_TARGET');
    expect(preview.matchedTargets).toEqual([]);
});
```

Run:

```bash
cd backend
npm test -- telegramService.test.js
```

Expected now: fail with `inspectCameraNotificationRouting` missing.

- [ ] **Step 2: Add routing inspection helpers**

In `backend/services/telegramService.js`, add these helpers near the existing `buildNotificationRuleIssues` and `sendCameraStatusNotifications` code:

```javascript
function maskChatId(chatId = '') {
    const value = String(chatId || '').trim();
    if (value.length <= 4) {
        return value ? '***' : '';
    }
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function formatTargetForDiagnostics(target = {}) {
    return {
        id: target.id,
        name: target.name,
        enabled: target.enabled !== false,
        chatIdMasked: maskChatId(target.chatId),
    };
}

export function inspectCameraNotificationRouting(eventType, camera = {}) {
    const settings = getTelegramSettings();
    const validEvent = VALID_EVENTS.has(eventType);
    const targetsById = new Map(settings.notificationTargets.map((target) => [target.id, target]));
    const matchedTargetByChatId = new Map();
    const matchedRules = [];
    const unmatchedRules = [];

    if (!validEvent) {
        return {
            configured: false,
            canSend: false,
            skippedReason: 'INVALID_EVENT',
            matchedTargets: [],
            matchedRules: [],
            unmatchedRules: [],
            ruleIssues: buildNotificationRuleIssues(settings),
        };
    }

    for (const rule of settings.notificationRules) {
        const target = targetsById.get(rule.targetId);
        const matched = Boolean(target?.chatId && ruleMatchesCamera(rule, camera, eventType));
        const ruleInfo = {
            id: rule.id,
            targetId: rule.targetId,
            targetName: target?.name || rule.targetId,
            scope: rule.scope,
            eventType,
            matched,
        };

        if (matched) {
            matchedRules.push(ruleInfo);
            matchedTargetByChatId.set(target.chatId, formatTargetForDiagnostics(target));
        } else {
            unmatchedRules.push(ruleInfo);
        }
    }

    const matchedTargets = Array.from(matchedTargetByChatId.values());
    const configured = Boolean(settings.botToken && settings.notificationTargets.length > 0);

    return {
        configured,
        canSend: configured && matchedTargets.length > 0,
        skippedReason: !settings.botToken
            ? 'BOT_TOKEN_MISSING'
            : matchedTargets.length === 0
                ? 'NO_MATCHING_TARGET'
                : null,
        matchedTargets,
        matchedRules,
        unmatchedRules,
        ruleIssues: buildNotificationRuleIssues(settings),
    };
}
```

Add `inspectCameraNotificationRouting` to the default export.

- [ ] **Step 3: Run focused tests**

```bash
cd backend
npm test -- telegramService.test.js
```

Expected: all Telegram tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/services/telegramService.js backend/__tests__/telegramService.test.js
git commit -m "Add: Telegram notification routing diagnostics preview"
```

---

### Task 3: Backend Diagnostics Service

**Files:**
- Create: `backend/services/notificationDiagnosticsService.js`
- Create: `backend/__tests__/notificationDiagnosticsService.test.js`

- [ ] **Step 1: Write failing service tests**

Create `backend/__tests__/notificationDiagnosticsService.test.js` with service-level mocks for DB and Telegram:

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryOne = vi.fn();
const mockQuery = vi.fn();
const mockExecute = vi.fn();
const mockInspectRouting = vi.fn();
const mockSendCameraStatusNotifications = vi.fn();

vi.mock('../database/database.js', () => ({
    queryOne: mockQueryOne,
    query: mockQuery,
    execute: mockExecute,
}));

vi.mock('../services/telegramService.js', () => ({
    inspectCameraNotificationRouting: mockInspectRouting,
    sendCameraStatusNotifications: mockSendCameraStatusNotifications,
}));

describe('notificationDiagnosticsService', () => {
    beforeEach(() => {
        vi.resetModules();
        mockQueryOne.mockReset();
        mockQuery.mockReset();
        mockExecute.mockReset();
        mockInspectRouting.mockReset();
        mockSendCameraStatusNotifications.mockReset();
    });

    it('builds a routing preview with camera and runtime health snapshot', async () => {
        mockQueryOne
            .mockReturnValueOnce({
                id: 5,
                name: 'Gate 1',
                area_id: 10,
                area_name: 'North',
                location: 'North Gate',
                enabled: 1,
            })
            .mockReturnValueOnce({
                camera_id: 5,
                health_status: 'online',
                last_checked_at: '2026-05-11 10:00:00',
                last_error: null,
            });
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: true,
            skippedReason: null,
            matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
            matchedRules: [{ id: 'north-offline', matched: true }],
            unmatchedRules: [],
            ruleIssues: [],
        });

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = service.previewCameraEvent({ cameraId: 5, eventType: 'offline' });

        expect(result.camera).toEqual(expect.objectContaining({ id: 5, name: 'Gate 1', areaName: 'North' }));
        expect(result.health).toEqual(expect.objectContaining({ status: 'online' }));
        expect(result.routing.canSend).toBe(true);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('runs a drill through production camera status routing and writes audit row', async () => {
        mockQueryOne
            .mockReturnValueOnce({
                id: 5,
                name: 'Gate 1',
                area_id: 10,
                area_name: 'North',
                location: 'North Gate',
                enabled: 1,
            })
            .mockReturnValueOnce({ camera_id: 5, health_status: 'online' });
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: true,
            skippedReason: null,
            matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
            matchedRules: [{ id: 'north-offline', matched: true }],
            unmatchedRules: [],
            ruleIssues: [],
        });
        mockSendCameraStatusNotifications.mockResolvedValue(true);

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = await service.runCameraEventDrill({ cameraId: 5, eventType: 'offline', userId: 99 });

        expect(result.success).toBe(true);
        expect(mockSendCameraStatusNotifications).toHaveBeenCalledWith('offline', [expect.objectContaining({ id: 5 })], {
            bypassCooldown: true,
            diagnostic: true,
        });
        expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_diagnostic_runs'), expect.arrayContaining([
            5,
            'Gate 1',
            'offline',
            'drill',
            1,
        ]));
    });

    it('does not send drill when routing preview has no matching target', async () => {
        mockQueryOne
            .mockReturnValueOnce({ id: 5, name: 'Gate 1', area_id: 10, area_name: 'North', enabled: 1 })
            .mockReturnValueOnce(null);
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: false,
            skippedReason: 'NO_MATCHING_TARGET',
            matchedTargets: [],
            matchedRules: [],
            unmatchedRules: [],
            ruleIssues: [],
        });

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = await service.runCameraEventDrill({ cameraId: 5, eventType: 'offline', userId: 99 });

        expect(result.success).toBe(false);
        expect(result.skippedReason).toBe('NO_MATCHING_TARGET');
        expect(mockSendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(mockExecute).toHaveBeenCalled();
    });
});
```

Run:

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js
```

Expected: fail because service file does not exist.

- [ ] **Step 2: Implement service skeleton and core logic**

Create `backend/services/notificationDiagnosticsService.js`:

```javascript
/**
 * Purpose: Provide admin diagnostics for Telegram camera notification routing and drill delivery.
 * Caller: adminController notification diagnostics handlers.
 * Deps: database camera/runtime tables, telegramService routing and send helpers.
 * MainFuncs: previewCameraEvent, runCameraEventDrill, listRecentRuns.
 * SideEffects: Drill mode sends Telegram messages and writes notification_diagnostic_runs audit rows.
 */

import { execute, query, queryOne } from '../database/database.js';
import {
    inspectCameraNotificationRouting,
    sendCameraStatusNotifications,
} from './telegramService.js';

const VALID_EVENTS = new Set(['offline', 'online']);

function assertEventType(eventType) {
    if (!VALID_EVENTS.has(eventType)) {
        const err = new Error('Invalid event type');
        err.statusCode = 400;
        throw err;
    }
}

function normalizeCameraId(cameraId) {
    const parsed = Number.parseInt(cameraId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        const err = new Error('Invalid camera id');
        err.statusCode = 400;
        throw err;
    }
    return parsed;
}

function getCamera(cameraId) {
    const id = normalizeCameraId(cameraId);
    const camera = queryOne(`
        SELECT c.*, a.name AS area_name
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        WHERE c.id = ?
    `, [id]);

    if (!camera) {
        const err = new Error('Camera not found');
        err.statusCode = 404;
        throw err;
    }

    return camera;
}

function getRuntimeState(cameraId) {
    return queryOne(`
        SELECT camera_id, health_status, last_checked_at, last_error, response_time_ms, consecutive_failures
        FROM camera_runtime_state
        WHERE camera_id = ?
    `, [cameraId]);
}

function formatCamera(camera) {
    return {
        id: camera.id,
        name: camera.name,
        areaId: camera.area_id || null,
        areaName: camera.area_name || camera.location || 'Tanpa Area',
        location: camera.location || '',
        enabled: camera.enabled !== 0,
    };
}

function formatHealth(runtime) {
    if (!runtime) {
        return {
            status: 'unknown',
            lastCheckedAt: null,
            lastError: null,
            responseTimeMs: null,
            consecutiveFailures: 0,
        };
    }

    return {
        status: runtime.health_status || 'unknown',
        lastCheckedAt: runtime.last_checked_at || null,
        lastError: runtime.last_error || null,
        responseTimeMs: runtime.response_time_ms || null,
        consecutiveFailures: runtime.consecutive_failures || 0,
    };
}

function writeRunAudit({ camera, eventType, mode, success, routing, skippedReason = null, errorMessage = null, userId = null }) {
    execute(`
        INSERT INTO notification_diagnostic_runs (
            camera_id, camera_name, event_type, mode, success, target_count, sent_count,
            skipped_reason, error_message, targets_json, routing_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        camera.id,
        camera.name,
        eventType,
        mode,
        success ? 1 : 0,
        routing.matchedTargets.length,
        success ? routing.matchedTargets.length : 0,
        skippedReason,
        errorMessage,
        JSON.stringify(routing.matchedTargets),
        JSON.stringify({
            matchedRules: routing.matchedRules,
            unmatchedRules: routing.unmatchedRules,
            ruleIssues: routing.ruleIssues,
        }),
        userId,
    ]);
}

function buildPreview(cameraId, eventType) {
    assertEventType(eventType);
    const camera = getCamera(cameraId);
    const runtime = getRuntimeState(camera.id);
    const routing = inspectCameraNotificationRouting(eventType, camera);

    return {
        camera: formatCamera(camera),
        health: formatHealth(runtime),
        eventType,
        routing,
        generatedAt: new Date().toISOString(),
        rawCamera: camera,
    };
}

function previewCameraEvent({ cameraId, eventType }) {
    const preview = buildPreview(cameraId, eventType);
    const { rawCamera, ...response } = preview;
    return response;
}

async function runCameraEventDrill({ cameraId, eventType, userId = null }) {
    const preview = buildPreview(cameraId, eventType);
    const { rawCamera, routing } = preview;

    if (!routing.canSend) {
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: false,
            routing,
            skippedReason: routing.skippedReason,
            userId,
        });
        const { rawCamera: omitted, ...response } = preview;
        return { ...response, success: false, skippedReason: routing.skippedReason };
    }

    try {
        const sent = await sendCameraStatusNotifications(eventType, [rawCamera], {
            bypassCooldown: true,
            diagnostic: true,
        });
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: sent,
            routing,
            skippedReason: sent ? null : 'TELEGRAM_SEND_FAILED',
            userId,
        });
        const { rawCamera: omitted, ...response } = preview;
        return { ...response, success: sent, skippedReason: sent ? null : 'TELEGRAM_SEND_FAILED' };
    } catch (error) {
        writeRunAudit({
            camera: rawCamera,
            eventType,
            mode: 'drill',
            success: false,
            routing,
            skippedReason: 'TELEGRAM_SEND_ERROR',
            errorMessage: error.message,
            userId,
        });
        throw error;
    }
}

function listRecentRuns({ cameraId = null, limit = 20 } = {}) {
    const normalizedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
    const params = [];
    let where = '';

    if (cameraId) {
        where = 'WHERE camera_id = ?';
        params.push(normalizeCameraId(cameraId));
    }
    params.push(normalizedLimit);

    return query(`
        SELECT id, camera_id, camera_name, event_type, mode, success, target_count, sent_count,
               skipped_reason, error_message, targets_json, created_at
        FROM notification_diagnostic_runs
        ${where}
        ORDER BY created_at DESC
        LIMIT ?
    `, params).map((row) => ({
        id: row.id,
        cameraId: row.camera_id,
        cameraName: row.camera_name,
        eventType: row.event_type,
        mode: row.mode,
        success: row.success === 1,
        targetCount: row.target_count,
        sentCount: row.sent_count,
        skippedReason: row.skipped_reason,
        errorMessage: row.error_message,
        targets: JSON.parse(row.targets_json || '[]'),
        createdAt: row.created_at,
    }));
}

export default {
    previewCameraEvent,
    runCameraEventDrill,
    listRecentRuns,
};
```

- [ ] **Step 3: Extend Telegram send helper for diagnostics bypass**

Modify `sendCameraStatusNotifications` signature in `backend/services/telegramService.js`:

```javascript
export async function sendCameraStatusNotifications(eventType, cameras = [], options = {}) {
```

Replace the cooldown block with:

```javascript
        if (!options.bypassCooldown && isInCooldown(cooldownKey)) {
            console.log(`[Telegram] Skipping ${eventType} group notification for ${target.name} (cooldown)`);
            continue;
        }
```

Replace cooldown set with:

```javascript
        if (sent && !options.bypassCooldown) {
            setCooldown(cooldownKey);
            sentCount += 1;
        } else if (sent) {
            sentCount += 1;
        }
```

- [ ] **Step 4: Run focused service tests**

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js telegramService.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/notificationDiagnosticsService.js backend/services/telegramService.js backend/__tests__/notificationDiagnosticsService.test.js
git commit -m "Add: Telegram notification diagnostics service"
```

---

### Task 4: Backend Admin API

**Files:**
- Modify: `backend/controllers/adminController.js`
- Modify: `backend/routes/adminRoutes.js`

- [ ] **Step 1: Add controller handlers**

In `backend/controllers/adminController.js`, import the service:

```javascript
import notificationDiagnosticsService from '../services/notificationDiagnosticsService.js';
```

Add handlers:

```javascript
export async function previewNotificationDiagnostics(request, reply) {
    try {
        const result = notificationDiagnosticsService.previewCameraEvent(request.body || {});
        return reply.send({ success: true, data: result });
    } catch (error) {
        console.error('Notification diagnostics preview error:', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.message || 'Failed to preview notification diagnostics',
        });
    }
}

export async function runNotificationDiagnosticsDrill(request, reply) {
    try {
        const result = await notificationDiagnosticsService.runCameraEventDrill({
            ...(request.body || {}),
            userId: request.user?.id || null,
        });
        return reply.send({ success: result.success, data: result, message: result.success ? 'Diagnostic drill sent' : 'Diagnostic drill skipped' });
    } catch (error) {
        console.error('Notification diagnostics drill error:', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.message || 'Failed to run notification diagnostics drill',
        });
    }
}

export async function listNotificationDiagnosticsRuns(request, reply) {
    try {
        const data = notificationDiagnosticsService.listRecentRuns(request.query || {});
        return reply.send({ success: true, data });
    } catch (error) {
        console.error('Notification diagnostics history error:', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.message || 'Failed to load notification diagnostics history',
        });
    }
}
```

- [ ] **Step 2: Register routes**

In `backend/routes/adminRoutes.js`, add the handlers to the admin controller import:

```javascript
previewNotificationDiagnostics,
runNotificationDiagnosticsDrill,
listNotificationDiagnosticsRuns,
```

Register these routes near the Telegram endpoints:

```javascript
    fastify.post('/notification-diagnostics/preview', {
        onRequest: [authMiddleware],
        handler: previewNotificationDiagnostics,
    });

    fastify.post('/notification-diagnostics/drill', {
        onRequest: [authMiddleware],
        handler: runNotificationDiagnosticsDrill,
    });

    fastify.get('/notification-diagnostics/runs', {
        onRequest: [authMiddleware],
        handler: listNotificationDiagnosticsRuns,
    });
```

- [ ] **Step 3: Run focused backend tests**

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js telegramService.test.js
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add backend/controllers/adminController.js backend/routes/adminRoutes.js
git commit -m "Add: Telegram notification diagnostics admin API"
```

---

### Task 5: Frontend Service Client

**Files:**
- Modify: `frontend/src/services/adminService.js`

- [ ] **Step 1: Add admin service methods**

Add these methods before the closing `};`:

```javascript
    async previewNotificationDiagnostics(payload) {
        try {
            const response = await apiClient.post('/api/admin/notification-diagnostics/preview', payload);
            return response.data;
        } catch (error) {
            console.error('Preview notification diagnostics error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to preview notification diagnostics',
            };
        }
    },

    async runNotificationDiagnosticsDrill(payload) {
        try {
            const response = await apiClient.post('/api/admin/notification-diagnostics/drill', payload);
            return response.data;
        } catch (error) {
            console.error('Run notification diagnostics drill error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to run notification diagnostics drill',
            };
        }
    },

    async getNotificationDiagnosticsRuns(params = {}) {
        try {
            const searchParams = new URLSearchParams();
            Object.entries(params || {}).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    searchParams.set(key, String(value));
                }
            });

            const response = await apiClient.get(
                `/api/admin/notification-diagnostics/runs${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
            );
            return response.data;
        } catch (error) {
            console.error('Get notification diagnostics runs error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to load notification diagnostics runs',
            };
        }
    }
```

When inserting, ensure the preceding method has a trailing comma and the final method does not leave invalid object syntax.

- [ ] **Step 2: Run service syntax check through frontend tests**

```bash
cd frontend
npm test -- UnifiedSettings.test.jsx
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/adminService.js
git commit -m "Add: notification diagnostics admin client"
```

---

### Task 6: Admin Diagnostics Page

**Files:**
- Create: `frontend/src/pages/NotificationDiagnostics.jsx`
- Create: `frontend/src/pages/NotificationDiagnostics.test.jsx`

- [ ] **Step 1: Write failing UI tests**

Create `frontend/src/pages/NotificationDiagnostics.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationDiagnostics from './NotificationDiagnostics';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';

vi.mock('../services/adminService', () => ({
    adminService: {
        previewNotificationDiagnostics: vi.fn(),
        runNotificationDiagnosticsDrill: vi.fn(),
        getNotificationDiagnosticsRuns: vi.fn(),
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getCameras: vi.fn(),
    },
}));

describe('NotificationDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cameraService.getCameras.mockResolvedValue({
            success: true,
            data: [{ id: 5, name: 'Gate 1', area_name: 'North' }],
        });
        adminService.getNotificationDiagnosticsRuns.mockResolvedValue({ success: true, data: [] });
    });

    it('previews routing and enables drill when Telegram target matches', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online', lastCheckedAt: '2026-05-11 10:00:00' },
                eventType: 'offline',
                routing: {
                    canSend: true,
                    matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
                    matchedRules: [{ id: 'north-offline', targetName: 'North Group', scope: 'area' }],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));

        expect(await screen.findByText('North Group')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Kirim Drill Offline/i })).not.toBeDisabled();
    });

    it('keeps drill disabled when no Telegram target matches', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online' },
                eventType: 'offline',
                routing: {
                    canSend: false,
                    skippedReason: 'NO_MATCHING_TARGET',
                    matchedTargets: [],
                    matchedRules: [],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));

        expect(await screen.findByText(/NO_MATCHING_TARGET/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Kirim Drill Offline/i })).toBeDisabled();
    });

    it('runs drill and refreshes recent diagnostics', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online' },
                eventType: 'offline',
                routing: {
                    canSend: true,
                    matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
                    matchedRules: [],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });
        adminService.runNotificationDiagnosticsDrill.mockResolvedValue({ success: true, data: { success: true } });
        adminService.getNotificationDiagnosticsRuns
            .mockResolvedValueOnce({ success: true, data: [] })
            .mockResolvedValueOnce({
                success: true,
                data: [{ id: 1, cameraName: 'Gate 1', eventType: 'offline', success: true, targetCount: 1, sentCount: 1, createdAt: '2026-05-11 10:01:00' }],
            });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Kirim Drill Offline/i }));

        await waitFor(() => expect(adminService.runNotificationDiagnosticsDrill).toHaveBeenCalledWith({ cameraId: 5, eventType: 'offline' }));
        expect(await screen.findByText(/Gate 1/)).toBeInTheDocument();
    });
});
```

Run:

```bash
cd frontend
npm test -- NotificationDiagnostics.test.jsx
```

Expected: fail because page file does not exist.

- [ ] **Step 2: Implement page**

Create `frontend/src/pages/NotificationDiagnostics.jsx`:

```jsx
/*
Purpose: Render admin workflow for Telegram camera notification routing preview, drill delivery, and recent diagnostic audit rows.
Caller: App.jsx protected /admin/notification-diagnostics route.
Deps: adminService, cameraService, React hooks, Tailwind admin UI classes.
MainFuncs: NotificationDiagnostics.
SideEffects: Fetches cameras/diagnostics and can trigger Telegram diagnostic drill sends.
*/

import { useEffect, useMemo, useState } from 'react';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';

const EVENT_OPTIONS = [
    { value: 'offline', label: 'Offline' },
    { value: 'online', label: 'Online' },
];

function statusTone(success) {
    return success ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
}

export default function NotificationDiagnostics() {
    const [cameras, setCameras] = useState([]);
    const [cameraId, setCameraId] = useState('');
    const [eventType, setEventType] = useState('offline');
    const [preview, setPreview] = useState(null);
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [drilling, setDrilling] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let mounted = true;
        async function loadInitialData() {
            const [cameraResponse, runsResponse] = await Promise.all([
                cameraService.getCameras(),
                adminService.getNotificationDiagnosticsRuns({ limit: 20 }),
            ]);
            if (!mounted) return;
            if (cameraResponse.success) {
                setCameras(cameraResponse.data || []);
            }
            if (runsResponse.success) {
                setRuns(runsResponse.data || []);
            }
        }
        loadInitialData();
        return () => { mounted = false; };
    }, []);

    const selectedCameraId = useMemo(() => Number.parseInt(cameraId, 10), [cameraId]);
    const canPreview = Number.isInteger(selectedCameraId) && selectedCameraId > 0;
    const canDrill = Boolean(preview?.routing?.canSend && canPreview && !drilling);

    async function refreshRuns() {
        const response = await adminService.getNotificationDiagnosticsRuns({ cameraId: selectedCameraId || '', limit: 20 });
        if (response.success) {
            setRuns(response.data || []);
        }
    }

    async function handlePreview() {
        if (!canPreview) return;
        setLoading(true);
        setError('');
        setMessage('');
        const response = await adminService.previewNotificationDiagnostics({ cameraId: selectedCameraId, eventType });
        setLoading(false);
        if (!response.success) {
            setError(response.message);
            setPreview(null);
            return;
        }
        setPreview(response.data);
    }

    async function handleDrill() {
        if (!canDrill) return;
        setDrilling(true);
        setError('');
        setMessage('');
        const response = await adminService.runNotificationDiagnosticsDrill({ cameraId: selectedCameraId, eventType });
        setDrilling(false);
        if (!response.success) {
            setError(response.message || response.data?.skippedReason || 'Diagnostic drill failed');
        } else {
            setMessage('Diagnostic drill terkirim ke target Telegram yang match.');
        }
        await refreshRuns();
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notification Diagnostics</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Preview routing dan kirim drill Telegram untuk memastikan CCTV masuk ke grup yang tepat.
                </p>
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="grid gap-4 md:grid-cols-[1fr_180px_auto_auto] md:items-end">
                    <label className="block">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">CCTV</span>
                        <select
                            aria-label="CCTV"
                            value={cameraId}
                            onChange={(event) => {
                                setCameraId(event.target.value);
                                setPreview(null);
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            <option value="">Pilih CCTV</option>
                            {cameras.map((camera) => (
                                <option key={camera.id} value={camera.id}>
                                    {camera.name} {camera.area_name ? `- ${camera.area_name}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Event</span>
                        <select
                            aria-label="Event"
                            value={eventType}
                            onChange={(event) => {
                                setEventType(event.target.value);
                                setPreview(null);
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            {EVENT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        onClick={handlePreview}
                        disabled={!canPreview || loading}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900"
                    >
                        {loading ? 'Loading...' : 'Preview Routing'}
                    </button>

                    <button
                        type="button"
                        onClick={handleDrill}
                        disabled={!canDrill}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {drilling ? 'Mengirim...' : `Kirim Drill ${eventType === 'offline' ? 'Offline' : 'Online'}`}
                    </button>
                </div>
            </section>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
            {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</div>}

            {preview && (
                <section className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Camera Health</h2>
                        <dl className="mt-3 space-y-2 text-sm">
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Camera</dt><dd className="font-semibold text-gray-900 dark:text-white">{preview.camera.name}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Area</dt><dd className="text-gray-900 dark:text-white">{preview.camera.areaName}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Status</dt><dd className="text-gray-900 dark:text-white">{preview.health.status}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Last Check</dt><dd className="text-gray-900 dark:text-white">{preview.health.lastCheckedAt || '-'}</dd></div>
                        </dl>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Matched Targets</h2>
                        {preview.routing.matchedTargets.length === 0 ? (
                            <p className="mt-3 text-sm text-red-600 dark:text-red-300">{preview.routing.skippedReason || 'Tidak ada target match'}</p>
                        ) : (
                            <ul className="mt-3 space-y-2">
                                {preview.routing.matchedTargets.map((target) => (
                                    <li key={target.id} className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-950">
                                        <span className="font-semibold text-gray-900 dark:text-white">{target.name}</span>
                                        <span className="ml-2 text-gray-500">{target.chatIdMasked}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Matched Rules</h2>
                        <ul className="mt-3 space-y-2 text-sm">
                            {preview.routing.matchedRules.map((rule) => (
                                <li key={rule.id} className="rounded-md bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    {rule.id} - {rule.targetName} - {rule.scope}
                                </li>
                            ))}
                            {preview.routing.matchedRules.length === 0 && <li className="text-gray-500">Tidak ada rule match.</li>}
                        </ul>
                    </div>
                </section>
            )}

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Recent Diagnostic Runs</h2>
                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500">
                                <th className="py-2 pr-4">Time</th>
                                <th className="py-2 pr-4">Camera</th>
                                <th className="py-2 pr-4">Event</th>
                                <th className="py-2 pr-4">Targets</th>
                                <th className="py-2 pr-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {runs.map((run) => (
                                <tr key={run.id}>
                                    <td className="py-2 pr-4 text-gray-500">{run.createdAt}</td>
                                    <td className="py-2 pr-4 text-gray-900 dark:text-white">{run.cameraName}</td>
                                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{run.eventType}</td>
                                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{run.sentCount}/{run.targetCount}</td>
                                    <td className={`py-2 pr-4 font-semibold ${statusTone(run.success)}`}>
                                        {run.success ? 'Sent' : (run.skippedReason || 'Failed')}
                                    </td>
                                </tr>
                            ))}
                            {runs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-6 text-center text-gray-500">Belum ada diagnostic run.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
```

- [ ] **Step 3: Run focused UI test**

```bash
cd frontend
npm test -- NotificationDiagnostics.test.jsx
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NotificationDiagnostics.jsx frontend/src/pages/NotificationDiagnostics.test.jsx
git commit -m "Add: notification diagnostics admin page"
```

---

### Task 7: Route, Navigation, And Settings Link

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/layouts/AdminLayout.jsx`
- Modify: `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`
- Modify: `frontend/src/pages/UnifiedSettings.test.jsx`
- Modify: `frontend/src/layouts/AdminLayout.test.jsx`

- [ ] **Step 1: Add route**

In `frontend/src/App.jsx`, add lazy import:

```javascript
const NotificationDiagnostics = lazyWithRetry(() => import('./pages/NotificationDiagnostics'), 'notification-diagnostics');
```

Add protected route before settings:

```jsx
                <Route
                    path="/admin/notification-diagnostics"
                    element={
                        <AdminPageRoute>
                            <NotificationDiagnostics />
                        </AdminPageRoute>
                    }
                />
```

- [ ] **Step 2: Add admin navigation**

In `frontend/src/layouts/AdminLayout.jsx`, add icon:

```jsx
    Bell: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9" /></svg>,
```

Add nav item near health/settings:

```javascript
        { label: 'Notification Diagnostics', path: '/admin/notification-diagnostics', icon: <Icons.Bell /> },
```

- [ ] **Step 3: Add compact settings link**

In `frontend/src/components/admin/settings/TelegramSettingsPanel.jsx`, import `Link`:

```javascript
import { Link } from 'react-router-dom';
```

Add a compact link in the panel header/actions area:

```jsx
<Link
    to="/admin/notification-diagnostics"
    className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
>
    Buka Notification Diagnostics
</Link>
```

- [ ] **Step 4: Update tests**

In `frontend/src/layouts/AdminLayout.test.jsx`, add assertion:

```jsx
expect(screen.getByRole('link', { name: /Notification Diagnostics/i })).toHaveAttribute('href', '/admin/notification-diagnostics');
```

In `frontend/src/pages/UnifiedSettings.test.jsx`, add assertion after Telegram panel render:

```jsx
expect(screen.getByRole('link', { name: /Buka Notification Diagnostics/i })).toHaveAttribute('href', '/admin/notification-diagnostics');
```

- [ ] **Step 5: Run focused frontend tests**

```bash
cd frontend
npm test -- NotificationDiagnostics.test.jsx UnifiedSettings.test.jsx AdminLayout.test.jsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/layouts/AdminLayout.jsx frontend/src/components/admin/settings/TelegramSettingsPanel.jsx frontend/src/pages/UnifiedSettings.test.jsx frontend/src/layouts/AdminLayout.test.jsx
git commit -m "Add: notification diagnostics admin navigation"
```

---

### Task 8: Documentation Maps

**Files:**
- Modify: `backend/.module_map.md`
- Modify: `backend/services/.module_map.md`
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`

- [ ] **Step 1: Update backend maps**

Add to `backend/.module_map.md` domain ownership:

```markdown
- Notification diagnostics: `services/notificationDiagnosticsService.js` plus protected admin endpoints under `/api/admin/notification-diagnostics/*` preview Telegram routing, run explicit drill sends, and persist masked diagnostic audit rows.
```

Add to `backend/services/.module_map.md` support utilities:

```markdown
  - `notificationDiagnosticsService.js`: admin-only Telegram notification preview/drill workflow; reads cameras/runtime state, uses `telegramService.js` routing helpers, and writes masked diagnostic audit rows.
```

- [ ] **Step 2: Update frontend maps**

Add to `frontend/src/.module_map.md` route ownership:

```markdown
- Notification diagnostics: `pages/NotificationDiagnostics.jsx` under `/admin/notification-diagnostics` previews Telegram routing for selected CCTV events, runs explicit drills, and lists recent diagnostic outcomes.
```

Add to `frontend/src/pages/.module_map.md` admin pages:

```markdown
- `NotificationDiagnostics.jsx`: admin operational page for Telegram notification routing preview, read-only health snapshot, drill send action, and recent diagnostic runs.
```

- [ ] **Step 3: Commit**

```bash
git add backend/.module_map.md backend/services/.module_map.md frontend/src/.module_map.md frontend/src/pages/.module_map.md
git commit -m "Docs: map notification diagnostics flow"
```

---

### Task 9: Verification And Push

**Files:**
- All files changed in Tasks 1-8.

- [ ] **Step 1: Backend focused verification**

Run:

```bash
cd backend
npm run migrate
npm test -- telegramService.test.js notificationDiagnosticsService.test.js
```

Expected:
- Migration succeeds.
- Telegram focused tests pass.
- Notification diagnostics service tests pass.

- [ ] **Step 2: Frontend focused verification**

Run:

```bash
cd frontend
npm test -- NotificationDiagnostics.test.jsx UnifiedSettings.test.jsx AdminLayout.test.jsx
```

Expected: all listed tests pass.

- [ ] **Step 3: Frontend full gate**

Run:

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: test, build, and lint all exit 0.

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: branch contains the new task commits and has no unstaged changes.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: push succeeds and GitHub `main` includes the diagnostics plan/implementation commits.

---

## Self-Review

- Spec coverage: Covers the chosen design: new admin page, Telegram Settings link only, routing preview, read-only health snapshot, drill send through production routing, masked persisted audit, navigation, tests, map docs, and push.
- Placeholder scan: Plan contains no incomplete requirement markers or deferred work instructions.
- Type consistency: Backend request shape is `{ cameraId, eventType }`; frontend service/page/tests use the same shape. Response fields use `routing.canSend`, `matchedTargets`, `matchedRules`, `skippedReason`, and recent run fields consistently.
- DB note: Audit writes are one insert per drill only. Indexes cover recent-history ordering and per-camera lookup, avoiding table scans for the diagnostics page.
