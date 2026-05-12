<!--
Purpose: Implementation plan for per-camera public playback token entitlements and customization.
Caller: Agents and maintainers implementing scoped playback token access.
Deps: SYSTEM_MAP.md, backend playback token services/routes/controllers, frontend playback token management, existing playback token tests.
MainFuncs: Documents task sequence, target files, test cases, migration design, verification, and commit checkpoints.
SideEffects: None; documentation only.
-->

# Public Playback Token Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public playback tokens work as explicit per-CCTV entitlements with editable camera rules, per-camera playback windows, safer share links, and backend-enforced access on every playback endpoint.

**Architecture:** Keep `playback_tokens` as the token/session/audit owner, add a normalized `playback_token_camera_rules` table for selected/custom camera access, and route validation through a focused policy helper so `/segments`, `/playlist.m3u8`, and `/stream/:filename` share one rule path. Frontend changes keep `Playback.jsx` thin by moving admin token form state into a hook and components while public playback uses token metadata to select only allowed cameras.

**Tech Stack:** Node.js 20+, Fastify 4.28.1, SQLite/better-sqlite3, Vitest, React 18.3.1, Vite 5.3.1, Tailwind CSS.

---

## Baseline Verification

- Current focused backend token tests passed before this plan:
  - Run: `cd backend && npm test -- playbackTokenService.test.js playbackTokenController.test.js`
  - Result: `2 passed`, `15 tests passed`
- Current selected-token behavior already exists but is JSON-backed:
  - `backend/services/playbackTokenService.js` validates `scope_type === 'selected'` against `camera_ids_json`.
  - `frontend/src/pages/PlaybackTokenManagement.jsx` can select cameras only at create time.
  - `backend/__tests__/playbackTokenService.test.js` currently asserts update does not modify `scope_type`; this must change.

---

## File Structure

- Create: `backend/database/migrations/zz_20260513_add_playback_token_camera_rules.js`
  - Adds normalized per-token camera rules and backfills existing selected-token JSON scopes.
- Create: `backend/services/playbackTokenRuleService.js`
  - Owns rule normalization, persistence, lookup, per-camera effective policy, and share URL target selection.
- Modify: `backend/services/playbackTokenService.js`
  - Delegates camera rule operations, allows editable scope/camera/window settings, returns `allowed_camera_ids`, and audits rule changes.
- Modify: `backend/services/recordingPlaybackService.js`
  - Consumes effective token rule policy and keeps all public token checks centralized before segment/playlist/stream delivery.
- Modify: `backend/controllers/playbackTokenController.js`
  - Sends camera context during activation and returns allowed cameras/rules to frontend.
- Modify: `backend/__tests__/playbackTokenService.test.js`
  - Updates old immutable-scope expectation and adds rule coverage.
- Create: `backend/__tests__/playbackTokenRuleService.test.js`
  - Tests normalized rules without large service mocks.
- Modify: `backend/__tests__/recordingPlaybackService.test.js`
  - Adds token entitlement regression cases for `admin_only`, `scope=all`, selected camera deny, and per-camera window.
- Modify: `frontend/src/services/playbackTokenService.js`
  - Sends/receives `camera_rules`, `allowed_camera_ids`, and target camera params.
- Create: `frontend/src/hooks/admin/usePlaybackTokenManagementPage.js`
  - Owns token admin data loading, create/edit forms, camera rule toggles, share actions, and validation state.
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenForm.jsx`
  - Renders create/edit token form, camera rule grid, and per-camera override controls.
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenTable.jsx`
  - Renders token list, active sessions, scope summary, and row actions.
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenSharePanel.jsx`
  - Renders generated share text and copy/share actions.
- Modify: `frontend/src/pages/PlaybackTokenManagement.jsx`
  - Becomes a thin shell using the hook and components.
- Modify: `frontend/src/hooks/playback/usePlaybackTokenAccess.js`
  - Activates share/token with selected camera, refreshes token metadata, and exposes allowed camera ids.
- Modify: `frontend/src/pages/Playback.jsx`
  - Filters/switches public cameras using token metadata and keeps URL `cam` aligned with token share target.
- Modify: `frontend/src/components/playback/PlaybackTokenAccess.jsx`
  - Shows active token scope/window in public playback without exposing admin-only internals.
- Create: `frontend/src/hooks/admin/usePlaybackTokenManagementPage.test.jsx`
  - Tests admin create/edit payload shaping and camera rules.
- Create: `frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx`
  - Tests public activation, URL cleanup, heartbeat, and selected-camera behavior.
- Modify: `frontend/src/pages/Playback.test.jsx`
  - Adds selected-token camera switch and denied-camera regression coverage.
- Modify: `backend/.module_map.md`, `backend/services/.module_map.md`, `frontend/src/.module_map.md`, `frontend/src/pages/.module_map.md`, `frontend/src/hooks/playback/.module_map.md`
  - Documents normalized token rule flow.

---

## Task 1: Database Rules Table

**Files:**
- Create: `backend/database/migrations/zz_20260513_add_playback_token_camera_rules.js`
- Test: migration via `npm run migrate`

- [ ] **Step 1: Create migration skeleton with Header Doc**

```javascript
/**
 * Purpose: Add normalized per-camera entitlement rules for playback tokens.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_tokens, cameras.
 * MainFuncs: migration script body.
 * SideEffects: Creates playback_token_camera_rules, indexes, and backfills selected token JSON scopes.
 */
```

- [ ] **Step 2: Implement schema and indexes**

Use this table shape:

```sql
CREATE TABLE IF NOT EXISTS playback_token_camera_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    camera_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    playback_window_hours INTEGER,
    expires_at DATETIME,
    note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE CASCADE,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE,
    UNIQUE(token_id, camera_id)
);

CREATE INDEX IF NOT EXISTS idx_playback_token_camera_rules_token_enabled
    ON playback_token_camera_rules(token_id, enabled, camera_id);

CREATE INDEX IF NOT EXISTS idx_playback_token_camera_rules_camera_enabled
    ON playback_token_camera_rules(camera_id, enabled, token_id);
```

- [ ] **Step 3: Backfill existing selected scopes**

For each `playback_tokens` row where `scope_type = 'selected'`, parse `camera_ids_json` and upsert one enabled rule per camera. Keep invalid JSON as empty.

```javascript
const selectedTokens = db.prepare(`
    SELECT id, camera_ids_json, playback_window_hours
    FROM playback_tokens
    WHERE scope_type = 'selected'
`).all();

const upsertRule = db.prepare(`
    INSERT INTO playback_token_camera_rules
    (token_id, camera_id, enabled, playback_window_hours)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(token_id, camera_id) DO UPDATE SET
        enabled = excluded.enabled,
        playback_window_hours = COALESCE(playback_token_camera_rules.playback_window_hours, excluded.playback_window_hours),
        updated_at = CURRENT_TIMESTAMP
`);
```

- [ ] **Step 4: Run migration**

Run: `cd backend && npm run migrate`

Expected: migration completes, no SQLite errors.

- [ ] **Step 5: Inspect indexes**

Run:

```powershell
cd backend
node -e "import Database from 'better-sqlite3'; const db = new Database('./data/cctv.db'); console.log(db.prepare('PRAGMA index_list(playback_token_camera_rules)').all()); db.close();"
```

Expected: includes `idx_playback_token_camera_rules_token_enabled`, `idx_playback_token_camera_rules_camera_enabled`, and the unique autoindex.

- [ ] **Step 6: Commit**

```bash
git add backend/database/migrations/zz_20260513_add_playback_token_camera_rules.js
git commit -m "Add: playback token camera rule migration"
git push
```

---

## Task 2: Rule Service

**Files:**
- Create: `backend/services/playbackTokenRuleService.js`
- Test: `backend/__tests__/playbackTokenRuleService.test.js`

- [ ] **Step 1: Write failing tests**

Add tests covering:

```javascript
it('normalizes selected camera rules with per-camera windows and expiry', () => {
    const rules = playbackTokenRuleService.normalizeRules([
        { camera_id: '7', enabled: true, playback_window_hours: '24', expires_at: '2026-05-20T00:00:00.000Z', note: 'Gate' },
        { camera_id: 7, enabled: true, playback_window_hours: 48 },
        { camera_id: 'x', enabled: true },
    ]);

    expect(rules).toEqual([
        {
            camera_id: 7,
            enabled: true,
            playback_window_hours: 24,
            expires_at: '2026-05-20 00:00:00',
            note: 'Gate',
        },
    ]);
});

it('denies all-scope token on admin_only camera unless explicit rule exists', () => {
    const policy = playbackTokenRuleService.resolveCameraAccess({
        token: { scope_type: 'all', playback_window_hours: 72 },
        camera: { id: 9, public_playback_mode: 'admin_only' },
        rules: [],
    });

    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe('token_all_excludes_admin_only');
});

it('allows selected explicit rule on admin_only camera', () => {
    const policy = playbackTokenRuleService.resolveCameraAccess({
        token: { scope_type: 'selected', playback_window_hours: 72 },
        camera: { id: 9, public_playback_mode: 'admin_only' },
        rules: [{ camera_id: 9, enabled: true, playback_window_hours: 12, expires_at: null }],
    });

    expect(policy).toMatchObject({
        allowed: true,
        playbackWindowHours: 12,
        ruleSource: 'camera_rule',
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- playbackTokenRuleService.test.js`

Expected: FAIL because `playbackTokenRuleService.js` does not exist.

- [ ] **Step 3: Implement service**

Export methods:

```javascript
normalizeRules(rawRules = [])
replaceRulesForToken(tokenId, rawRules = [])
getRulesForToken(tokenId)
getAllowedCameraIds(token)
resolveCameraAccess({ token, camera, rules = null })
buildCameraRulesSummary(token)
```

Rules:
- `scope_type='all'` allows public-playback eligible cameras by default.
- `scope_type='all'` denies `admin_only` unless an enabled explicit rule exists for that camera.
- `scope_type='selected'` allows only enabled explicit rules.
- Per-camera `playback_window_hours` overrides token-level `playback_window_hours`.
- Per-camera `expires_at` denies access after expiry.
- `camera_ids_json` remains a compatibility fallback only when rules table is missing.

- [ ] **Step 4: Run rule service tests**

Run: `cd backend && npm test -- playbackTokenRuleService.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/playbackTokenRuleService.js backend/__tests__/playbackTokenRuleService.test.js
git commit -m "Add: playback token camera rule service"
git push
```

---

## Task 3: Token Service Integration

**Files:**
- Modify: `backend/services/playbackTokenService.js`
- Modify: `backend/__tests__/playbackTokenService.test.js`

- [ ] **Step 1: Update failing tests**

Change the existing immutable-update test so update can modify rule fields:

```javascript
it('updates mutable settings and camera entitlement rules without changing token secrets', async () => {
    const updated = playbackTokenService.updateTokenSettings(51, {
        label: 'Nama Baru',
        scope_type: 'selected',
        camera_rules: [
            { camera_id: 1, enabled: true, playback_window_hours: 24 },
            { camera_id: 3, enabled: true, playback_window_hours: 12 },
        ],
        max_active_sessions: 2,
        session_limit_mode: 'replace_oldest',
        session_timeout_seconds: 120,
        client_note: 'Catatan baru',
        share_template: 'Kode {{token}}',
        expires_at: '2099-01-01 00:00:00',
    }, { user: { id: 3 }, headers: {} });

    expect(updated).toMatchObject({
        label: 'Nama Baru',
        scope_type: 'selected',
        allowed_camera_ids: [1, 3],
        max_active_sessions: 2,
        session_limit_mode: 'replace_oldest',
    });
    expect(connectionPool.execute.mock.calls[0][0]).not.toContain('token_hash');
    expect(connectionPool.execute.mock.calls[0][0]).not.toContain('share_key_hash');
});
```

Add a test for `createToken()` persisting `camera_rules`.

- [ ] **Step 2: Run service tests to verify failure**

Run: `cd backend && npm test -- playbackTokenService.test.js`

Expected: FAIL because service does not yet import or call `playbackTokenRuleService`.

- [ ] **Step 3: Update service imports and sanitization**

Add:

```javascript
import playbackTokenRuleService from './playbackTokenRuleService.js';
```

Update `sanitizeTokenRow(row)` to include:

```javascript
camera_rules: row.camera_rules || [],
allowed_camera_ids: row.allowed_camera_ids || cameraIds,
```

- [ ] **Step 4: Update `createToken()`**

After token row insert:

```javascript
const ruleInput = payload.camera_rules || cameraIds.map((cameraId) => ({ camera_id: cameraId, enabled: true }));
const normalizedRules = scopeType === 'selected' || ruleInput.length > 0
    ? playbackTokenRuleService.replaceRulesForToken(result.lastInsertRowid, ruleInput)
    : [];
```

Return sanitized data with `camera_rules` and `allowed_camera_ids`.

- [ ] **Step 5: Update `updateTokenSettings()`**

Allow these mutable fields:
- `label`
- `scope_type`
- `camera_rules`
- `playback_window_hours`
- `expires_at`
- `max_active_sessions`
- `session_limit_mode`
- `session_timeout_seconds`
- `client_note`
- `share_template`

Keep immutable:
- `token_hash`
- `share_key_hash` except explicit repeat share action
- `created_by`
- `created_at`

- [ ] **Step 6: Update validation**

In `validateRawTokenForCamera()`, replace JSON scope check with:

```javascript
const cameraPolicy = playbackTokenRuleService.resolveCameraAccess({
    token,
    camera: options.camera || { id: normalizedCameraId, public_playback_mode: options.publicPlaybackMode || 'inherit' },
});

if (normalizedCameraId > 0 && !cameraPolicy.allowed) {
    const err = new Error(cameraPolicy.message || 'Token playback tidak mencakup kamera ini');
    err.statusCode = 403;
    throw err;
}
```

Return token with:

```javascript
effective_playback_window_hours: cameraPolicy.playbackWindowHours,
allowed_camera_ids: playbackTokenRuleService.getAllowedCameraIds(token),
```

- [ ] **Step 7: Run token service tests**

Run: `cd backend && npm test -- playbackTokenService.test.js playbackTokenRuleService.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/services/playbackTokenService.js backend/__tests__/playbackTokenService.test.js backend/__tests__/playbackTokenRuleService.test.js
git commit -m "Refactor: enforce playback token camera entitlements"
git push
```

---

## Task 4: Playback Access Enforcement

**Files:**
- Modify: `backend/services/recordingPlaybackService.js`
- Modify: `backend/__tests__/recordingPlaybackService.test.js`

- [ ] **Step 1: Write failing recording playback tests**

Add coverage:

```javascript
it('allows explicit selected token for admin_only camera', () => {
    playbackTokenService.validateRequestForCamera.mockReturnValue({
        id: 20,
        scope_type: 'selected',
        effective_playback_window_hours: 12,
    });

    const access = recordingPlaybackService.resolvePlaybackAccess({
        id: 4,
        public_playback_mode: 'admin_only',
        public_playback_preview_minutes: 10,
    }, buildPublicRequest('/api/recordings/4/segments'));

    expect(access).toMatchObject({
        accessMode: 'token_full',
        playbackWindowHours: 12,
        tokenId: 20,
    });
});

it('denies all-scope token for admin_only camera when token service rejects it', () => {
    playbackTokenService.validateRequestForCamera.mockImplementation(() => {
        const err = new Error('Token playback tidak mencakup kamera ini');
        err.statusCode = 403;
        throw err;
    });

    expect(() => recordingPlaybackService.resolvePlaybackAccess({
        id: 4,
        public_playback_mode: 'admin_only',
        public_playback_preview_minutes: 10,
    }, buildPublicRequest('/api/recordings/4/segments'))).toThrow('Token playback tidak mencakup kamera ini');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- recordingPlaybackService.test.js`

Expected: FAIL until service passes full camera context to token validation.

- [ ] **Step 3: Pass camera context to token validation**

Change `resolvePlaybackAccess()` token call to include:

```javascript
const tokenAccess = playbackTokenService.validateRequestForCamera(request, camera.id, {
    touch: shouldTouchToken,
    eventType: isPlaylistRequest ? 'access_playlist' : 'access_segments',
    camera,
});
```

Use:

```javascript
playbackWindowHours: tokenAccess.effective_playback_window_hours ?? tokenAccess.playback_window_hours,
```

- [ ] **Step 4: Keep stream endpoint protected**

Confirm `getStreamSegment()` still calls `resolvePlaybackContext()` before reading `recordingSegmentRepository.findSegmentByFilename()`.

- [ ] **Step 5: Run backend playback tests**

Run:

```bash
cd backend
npm test -- playbackTokenService.test.js playbackTokenRuleService.test.js playbackTokenController.test.js recordingPlaybackService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingPlaybackService.js backend/__tests__/recordingPlaybackService.test.js
git commit -m "Fix: enforce playback token rules on recording access"
git push
```

---

## Task 5: Public Activation And Share Links

**Files:**
- Modify: `backend/services/playbackTokenService.js`
- Modify: `backend/controllers/playbackTokenController.js`
- Modify: `backend/__tests__/playbackTokenController.test.js`
- Modify: `backend/__tests__/playbackTokenService.test.js`

- [ ] **Step 1: Write failing tests**

Add service test:

```javascript
it('builds selected-camera share link with target camera slug id', async () => {
    const shareText = playbackTokenService.buildShareText({
        shareKey: 'CLIENT88',
        tokenRow: {
            label: 'Client Gate',
            scope_type: 'selected',
            camera_rules: [{ camera_id: 7, enabled: true }],
            allowed_camera_ids: [7],
            share_template: 'Link: {{playback_url}}',
        },
        request: { headers: { origin: 'https://cctv.raf.my.id' } },
    });

    expect(shareText).toContain('/playback?cam=7&share=CLIENT88');
});
```

Add controller test asserting activation returns `allowed_camera_ids` and `camera_rules`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- playbackTokenService.test.js playbackTokenController.test.js`

Expected: FAIL because share URL has no `cam` and controller response lacks rule metadata.

- [ ] **Step 3: Update `buildPlaybackUrl()`**

Accept optional `targetCameraId`:

```javascript
buildPlaybackUrl({ token, shareKey, request, targetCameraId = null }) {
    const origin = getRequestOrigin(request);
    const queryName = shareKey ? 'share' : 'token';
    const queryValue = encodeURIComponent(shareKey || token);
    const params = new URLSearchParams();
    if (targetCameraId) {
        params.set('cam', String(targetCameraId));
    }
    params.set(queryName, queryValue);
    return `${origin}/playback?${params.toString()}`;
}
```

- [ ] **Step 4: Resolve target camera for selected shares**

In `buildShareText()`, choose first enabled allowed camera id when scope is selected:

```javascript
const targetCameraId = row?.scope_type === 'selected'
    ? row.allowed_camera_ids?.[0] || row.camera_rules?.find((rule) => rule.enabled)?.camera_id || null
    : null;
const playbackUrl = this.buildPlaybackUrl({ token, shareKey, request, targetCameraId });
```

- [ ] **Step 5: Return rule metadata from activation**

Make `activatePlaybackToken()` return `data.allowed_camera_ids` and `data.camera_rules` from `validateRawTokenForCamera()`.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- playbackTokenService.test.js playbackTokenController.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/playbackTokenService.js backend/controllers/playbackTokenController.js backend/__tests__/playbackTokenService.test.js backend/__tests__/playbackTokenController.test.js
git commit -m "Fix: target playback share links to entitled cameras"
git push
```

---

## Task 6: Admin Token Management UI Split

**Files:**
- Create: `frontend/src/hooks/admin/usePlaybackTokenManagementPage.js`
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenForm.jsx`
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenTable.jsx`
- Create: `frontend/src/components/admin/playback-tokens/PlaybackTokenSharePanel.jsx`
- Modify: `frontend/src/pages/PlaybackTokenManagement.jsx`
- Test: `frontend/src/hooks/admin/usePlaybackTokenManagementPage.test.jsx`

- [ ] **Step 1: Write failing hook tests**

Test payload shaping:

```javascript
it('creates selected token payload with per-camera rules', async () => {
    const { result } = renderHook(() => usePlaybackTokenManagementPage(), { wrapper: TestProviders });

    act(() => {
        result.current.updateForm('scope_type', 'selected');
        result.current.toggleCameraRule(3, true);
        result.current.updateCameraRule(3, 'playback_window_hours', '24');
    });

    await act(async () => {
        await result.current.handleCreate(fakeSubmitEvent);
    });

    expect(playbackTokenService.createToken).toHaveBeenCalledWith(expect.objectContaining({
        scope_type: 'selected',
        camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 24, expires_at: null, note: '' }],
    }));
});
```

Test edit can change scope/camera rules:

```javascript
it('updates token scope and camera rules from edit form', async () => {
    await result.current.handleUpdateToken(9);

    expect(playbackTokenService.updateToken).toHaveBeenCalledWith(9, expect.objectContaining({
        scope_type: 'selected',
        camera_rules: expect.arrayContaining([expect.objectContaining({ camera_id: 3, enabled: true })]),
    }));
});
```

- [ ] **Step 2: Run frontend test to verify failure**

Run: `cd frontend && npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx`

Expected: FAIL because hook/components do not exist.

- [ ] **Step 3: Extract hook**

Move state and handlers from `PlaybackTokenManagement.jsx` into `usePlaybackTokenManagementPage.js`:
- `tokens`
- `auditLogs`
- `cameras`
- `form`
- `editForm`
- `createdShare`
- `loadData`
- `handleCreate`
- `handleUpdateToken`
- `handleRepeatShare`
- `handleClearSessions`
- `handleRevoke`
- `toggleCameraRule`
- `updateCameraRule`

- [ ] **Step 4: Create presentational components**

`PlaybackTokenForm.jsx` props:

```javascript
{
    form,
    cameras,
    saving,
    selectedCameraIds,
    onUpdateForm,
    onToggleCameraRule,
    onUpdateCameraRule,
    onSubmit,
}
```

`PlaybackTokenTable.jsx` props:

```javascript
{
    tokens,
    editingTokenId,
    editForm,
    onEdit,
    onCancelEdit,
    onUpdateEditForm,
    onUpdateToken,
    onRepeatShare,
    onClearSessions,
    onRevoke,
}
```

`PlaybackTokenSharePanel.jsx` props:

```javascript
{
    createdShare,
    onCopy,
    onNativeShare,
}
```

- [ ] **Step 5: Thin page shell**

Keep `PlaybackTokenManagement.jsx` responsible only for:
- calling `usePlaybackTokenManagementPage()`
- rendering heading
- rendering form/share/table/audit sections

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
cd frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/admin/usePlaybackTokenManagementPage.js frontend/src/hooks/admin/usePlaybackTokenManagementPage.test.jsx frontend/src/components/admin/playback-tokens frontend/src/pages/PlaybackTokenManagement.jsx
git commit -m "Refactor: split playback token management UI"
git push
```

---

## Task 7: Public Playback Token UX

**Files:**
- Modify: `frontend/src/hooks/playback/usePlaybackTokenAccess.js`
- Modify: `frontend/src/pages/Playback.jsx`
- Modify: `frontend/src/components/playback/PlaybackTokenAccess.jsx`
- Test: `frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx`
- Test: `frontend/src/pages/Playback.test.jsx`

- [ ] **Step 1: Write failing public hook tests**

```javascript
it('activates share key with current camera id and exposes allowed cameras', async () => {
    playbackTokenService.activateShareKey.mockResolvedValue({
        success: true,
        data: {
            id: 8,
            scope_type: 'selected',
            allowed_camera_ids: [3],
            camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 24 }],
        },
    });

    const { result } = renderHook(() => usePlaybackTokenAccess({
        enabled: true,
        searchParams: new URLSearchParams('cam=3&share=CLIENT88'),
        setSearchParams,
        cameraId: 3,
    }));

    await waitFor(() => expect(result.current.tokenStatus.allowed_camera_ids).toEqual([3]));
    expect(playbackTokenService.activateShareKey).toHaveBeenCalledWith('CLIENT88', 3, expect.any(String));
});
```

- [ ] **Step 2: Write failing page test**

```javascript
it('switches public playback to first allowed camera after selected token activation', async () => {
    playbackTokenService.activateShareKey.mockResolvedValue({
        success: true,
        data: {
            scope_type: 'selected',
            allowed_camera_ids: [2],
            camera_rules: [{ camera_id: 2, enabled: true }],
        },
    });

    render(<Playback accessScope="public_preview" />);

    await userEvent.type(screen.getByLabelText(/Token Playback/i), 'CLIENT88');
    await userEvent.click(screen.getByRole('button', { name: /Aktifkan/i }));

    await waitFor(() => expect(recordingService.getSegments).toHaveBeenCalledWith(2, expect.anything()));
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx src/pages/Playback.test.jsx
```

Expected: FAIL until hook/page consumes `allowed_camera_ids`.

- [ ] **Step 4: Update public token hook**

Expose:

```javascript
allowedCameraIds: tokenStatus?.allowed_camera_ids || null,
cameraRules: tokenStatus?.camera_rules || [],
```

Call activation with current camera id and preserve `cam` while removing `share`/`token` from URL.

- [ ] **Step 5: Update `Playback.jsx`**

When public token is active and selected:
- filter camera selector to allowed ids
- if current camera is not allowed, switch to first allowed camera
- update URL with `cam` for the allowed camera
- reload segments after switch

- [ ] **Step 6: Update `PlaybackTokenAccess.jsx`**

Show concise active status:
- `Token aktif`
- `Akses: N kamera`
- `Window: X jam terakhir` when effective/rule window exists

- [ ] **Step 7: Run focused frontend tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx src/pages/Playback.test.jsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/playback/usePlaybackTokenAccess.js frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx frontend/src/pages/Playback.jsx frontend/src/pages/Playback.test.jsx frontend/src/components/playback/PlaybackTokenAccess.jsx
git commit -m "Fix: align public playback with token camera entitlements"
git push
```

---

## Task 8: Documentation Maps And Final Gates

**Files:**
- Modify: `backend/.module_map.md`
- Modify: `backend/services/.module_map.md`
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`
- Modify: `frontend/src/hooks/playback/.module_map.md`

- [ ] **Step 1: Update backend maps**

Document:
- `playbackTokenRuleService.js`
- `playback_token_camera_rules`
- selected token can explicitly grant `admin_only`
- all-scope token excludes `admin_only` unless explicit rule exists

- [ ] **Step 2: Update frontend maps**

Document:
- `usePlaybackTokenManagementPage.js`
- admin playback token components
- public playback token metadata filters camera selector
- share links may include `cam`

- [ ] **Step 3: Run migration and backend tests**

Run:

```bash
cd backend
npm run migrate
npm test -- playbackTokenService.test.js playbackTokenRuleService.test.js playbackTokenController.test.js recordingPlaybackService.test.js
npm test
```

Expected: PASS.

- [ ] **Step 4: Run frontend tests and build**

Run:

```bash
cd frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx src/hooks/playback/usePlaybackTokenAccess.test.jsx src/pages/Playback.test.jsx
npm test
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Check git status**

Run: `git status --short`

Expected: only planned files are changed.

- [ ] **Step 6: Commit maps and any remaining verified changes**

```bash
git add backend/.module_map.md backend/services/.module_map.md frontend/src/.module_map.md frontend/src/pages/.module_map.md frontend/src/hooks/playback/.module_map.md
git commit -m "Add: document playback token entitlement flow"
git push
```

---

## Risk Controls

- DB load: all per-token rule lookups use indexed `token_id, enabled, camera_id`; no per-camera N+1 loops in list endpoints.
- Backward compatibility: existing `camera_ids_json` remains readable until all tokens have normalized rules.
- Security: raw token/share secrets remain hashed in DB; repeat-share can rotate share key without changing the raw token hash.
- Access policy: `admin_only` is available through token only when explicitly selected in a camera rule.
- Public UX: token share links target the first allowed camera to avoid a denial page before the token metadata is loaded.
- Test strategy: backend policy first, frontend payload/route behavior second, full gates last.

---

## Self-Review

- Spec coverage: covers normalized rules, explicit `admin_only`, editable token camera rules, per-camera playback windows, targeted share URLs, public UX filtering, audits through existing token service, maps, migration, and full verification.
- Placeholder scan: no placeholder tasks remain; every task names files, commands, and expected outcomes.
- Type consistency: `camera_rules`, `allowed_camera_ids`, `effective_playback_window_hours`, `scope_type`, `playback_window_hours`, and `expires_at` are used consistently across backend and frontend tasks.
