# Notification Diagnostics Runtime State Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `/admin/notification-diagnostics` so it reads the real `camera_runtime_state` schema and no longer crashes with `no such column: health_status`.

**Architecture:** Keep the diagnostics page/API unchanged and correct only the backend runtime-state read model. `notificationDiagnosticsService.js` should read the existing runtime columns (`monitoring_state`, `monitoring_reason`, `last_health_check_at`, `is_online`, `updated_at`) used by `cameraRuntimeStateService.js` and `cameraService.js`. Tests must include a real SQLite schema smoke check so mocked field names cannot hide schema drift again.

**Tech Stack:** Node.js 20+, Fastify service layer, SQLite/better-sqlite3, Vitest.

<!--
Purpose: Implementation plan for fixing notification diagnostics runtime-state schema mismatch.
Caller: Agents implementing the diagnostics bugfix.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, notificationDiagnosticsService.js.
MainFuncs: Defines test-first backend fix and verification commands.
SideEffects: Documentation only.
-->

---

## File Structure

- Modify `backend/services/notificationDiagnosticsService.js`
  - Replace invalid `camera_runtime_state` columns with the actual schema.
  - Map health snapshot fields from `monitoring_state`, `monitoring_reason`, and `last_health_check_at`.
- Modify `backend/__tests__/notificationDiagnosticsService.test.js`
  - Update existing mocks to real runtime-state column names.
  - Add a schema regression test using an in-memory SQLite table with the real columns and exported pure mapper/query builder.
- No database migration is needed.
  - The diagnostics audit table exists.
  - The error is not missing migration; it is a wrong SELECT projection in service code.
- No frontend change is needed unless backend response keys change.
  - Keep response shape `{ health: { status, lastCheckedAt, lastError, responseTimeMs, consecutiveFailures } }`.
  - Set `responseTimeMs` to `null` and `consecutiveFailures` to `0` because current runtime table does not store those values.

---

### Task 1: Add A Failing Schema Regression Test

**Files:**
- Modify: `backend/__tests__/notificationDiagnosticsService.test.js`

- [ ] **Step 1: Update existing mocked runtime rows to the real schema**

Replace the first test runtime mock:

```javascript
            .mockReturnValueOnce({
                camera_id: 5,
                health_status: 'online',
                last_checked_at: '2026-05-11 10:00:00',
                last_error: null,
            });
```

with:

```javascript
            .mockReturnValueOnce({
                camera_id: 5,
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'health_check_ok',
                last_runtime_signal_at: '2026-05-11 09:59:30',
                last_runtime_signal_type: 'hls_probe',
                last_health_check_at: '2026-05-11 10:00:00',
                updated_at: '2026-05-11 10:00:01',
            });
```

Replace the second test runtime mock:

```javascript
            .mockReturnValueOnce({ camera_id: 5, health_status: 'online' });
```

with:

```javascript
            .mockReturnValueOnce({
                camera_id: 5,
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'health_check_ok',
                last_health_check_at: '2026-05-11 10:00:00',
                updated_at: '2026-05-11 10:00:01',
            });
```

- [ ] **Step 2: Add direct mapper test**

Add this test before the drill tests:

```javascript
    it('maps the real camera_runtime_state schema into diagnostics health fields', async () => {
        const service = await import('../services/notificationDiagnosticsService.js');

        const health = service.formatRuntimeHealthForDiagnostics({
            camera_id: 5,
            is_online: 0,
            monitoring_state: 'offline',
            monitoring_reason: 'probe_timeout',
            last_runtime_signal_at: '2026-05-11 09:50:00',
            last_runtime_signal_type: 'manifest',
            last_health_check_at: '2026-05-11 10:00:00',
            updated_at: '2026-05-11 10:00:01',
        });

        expect(health).toEqual({
            status: 'offline',
            isOnline: false,
            reason: 'probe_timeout',
            lastCheckedAt: '2026-05-11 10:00:00',
            lastRuntimeSignalAt: '2026-05-11 09:50:00',
            lastRuntimeSignalType: 'manifest',
            updatedAt: '2026-05-11 10:00:01',
            lastError: 'probe_timeout',
            responseTimeMs: null,
            consecutiveFailures: 0,
        });
    });
```

- [ ] **Step 3: Add schema smoke test for the runtime SELECT**

Add `better-sqlite3` import at the top:

```javascript
import Database from 'better-sqlite3';
```

Add this test:

```javascript
    it('runtime state SELECT is compatible with the real camera_runtime_state columns', async () => {
        const service = await import('../services/notificationDiagnosticsService.js');
        const db = new Database(':memory:');
        try {
            db.exec(`
                CREATE TABLE camera_runtime_state (
                    camera_id INTEGER PRIMARY KEY,
                    is_online INTEGER DEFAULT 0,
                    monitoring_state TEXT DEFAULT 'unknown',
                    monitoring_reason TEXT,
                    last_runtime_signal_at DATETIME,
                    last_runtime_signal_type TEXT,
                    last_health_check_at DATETIME,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO camera_runtime_state (
                    camera_id, is_online, monitoring_state, monitoring_reason,
                    last_runtime_signal_at, last_runtime_signal_type, last_health_check_at, updated_at
                ) VALUES (
                    5, 1, 'online', 'health_check_ok',
                    '2026-05-11 09:59:30', 'hls_probe', '2026-05-11 10:00:00', '2026-05-11 10:00:01'
                );
            `);

            const row = db.prepare(service.RUNTIME_STATE_DIAGNOSTICS_SELECT).get(5);

            expect(row).toEqual(expect.objectContaining({
                camera_id: 5,
                monitoring_state: 'online',
                monitoring_reason: 'health_check_ok',
                last_health_check_at: '2026-05-11 10:00:00',
            }));
        } finally {
            db.close();
        }
    });
```

- [ ] **Step 4: Run the focused test and confirm failure**

Run:

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js
```

Expected failure:
- `formatRuntimeHealthForDiagnostics is not a function`
- or `RUNTIME_STATE_DIAGNOSTICS_SELECT` still references `health_status`

---

### Task 2: Fix Runtime-State Projection And Formatter

**Files:**
- Modify: `backend/services/notificationDiagnosticsService.js`

- [ ] **Step 1: Add an exported runtime-state SELECT constant**

Add near the top after `VALID_EVENTS`:

```javascript
export const RUNTIME_STATE_DIAGNOSTICS_SELECT = `
    SELECT
        camera_id,
        is_online,
        monitoring_state,
        monitoring_reason,
        last_runtime_signal_at,
        last_runtime_signal_type,
        last_health_check_at,
        updated_at
    FROM camera_runtime_state
    WHERE camera_id = ?
`;
```

- [ ] **Step 2: Replace the invalid `getRuntimeState` query**

Replace:

```javascript
function getRuntimeState(cameraId) {
    return queryOne(`
        SELECT camera_id, health_status, last_checked_at, last_error, response_time_ms, consecutive_failures
        FROM camera_runtime_state
        WHERE camera_id = ?
    `, [cameraId]);
}
```

with:

```javascript
function getRuntimeState(cameraId) {
    return queryOne(RUNTIME_STATE_DIAGNOSTICS_SELECT, [cameraId]);
}
```

- [ ] **Step 3: Export a pure formatter using the real schema**

Replace:

```javascript
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
```

with:

```javascript
export function formatRuntimeHealthForDiagnostics(runtime) {
    if (!runtime) {
        return {
            status: 'unknown',
            isOnline: false,
            reason: null,
            lastCheckedAt: null,
            lastRuntimeSignalAt: null,
            lastRuntimeSignalType: null,
            updatedAt: null,
            lastError: null,
            responseTimeMs: null,
            consecutiveFailures: 0,
        };
    }

    const reason = runtime.monitoring_reason || null;
    return {
        status: runtime.monitoring_state || (runtime.is_online === 1 ? 'online' : 'unknown'),
        isOnline: runtime.is_online === 1,
        reason,
        lastCheckedAt: runtime.last_health_check_at || null,
        lastRuntimeSignalAt: runtime.last_runtime_signal_at || null,
        lastRuntimeSignalType: runtime.last_runtime_signal_type || null,
        updatedAt: runtime.updated_at || null,
        lastError: reason,
        responseTimeMs: null,
        consecutiveFailures: 0,
    };
}
```

- [ ] **Step 4: Update preview builder to use the new formatter**

Replace:

```javascript
        health: formatHealth(runtime),
```

with:

```javascript
        health: formatRuntimeHealthForDiagnostics(runtime),
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js telegramService.test.js
```

Expected: pass.

- [ ] **Step 6: Run a local DB smoke query**

Run:

```bash
cd backend
node -e "import('./services/notificationDiagnosticsService.js').then(({ RUNTIME_STATE_DIAGNOSTICS_SELECT }) => import('./database/database.js').then(({ query }) => console.log(query(RUNTIME_STATE_DIAGNOSTICS_SELECT, [1]))))"
```

Expected:
- No `no such column` error.
- Output is either `[]` or one row with `monitoring_state`.

- [ ] **Step 7: Commit**

```bash
git add backend/services/notificationDiagnosticsService.js backend/__tests__/notificationDiagnosticsService.test.js
git commit -m "Fix: align notification diagnostics with runtime state schema"
```

---

### Task 3: Final Verification And Push

**Files:**
- Modified backend service and test from Tasks 1-2.

- [ ] **Step 1: Backend migration check**

Run:

```bash
cd backend
npm run migrate
```

Expected: all migrations complete successfully.

- [ ] **Step 2: Backend focused tests**

Run:

```bash
cd backend
npm test -- notificationDiagnosticsService.test.js telegramService.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Frontend focused smoke**

Run:

```bash
cd frontend
npm test -- NotificationDiagnostics.test.jsx
```

Expected: page still renders diagnostics health fields and passes.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected:
- Branch ahead by the bugfix commit.
- No unstaged changes.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: push succeeds.

---

## Self-Review

- Spec coverage: Fixes the exact `no such column: health_status` root cause by changing the invalid SELECT and formatter to the real `camera_runtime_state` schema.
- Placeholder scan: Plan contains no incomplete requirement markers or deferred work instructions.
- Type consistency: Response keeps existing frontend-compatible keys while adding `isOnline`, `reason`, signal, and update fields.
- DB note: No migration is needed; the existing runtime table already has the correct columns and the diagnostics service must conform to it.
