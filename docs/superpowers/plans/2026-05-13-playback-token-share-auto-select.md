<!--
Purpose: Implementation plan for correcting playback token share text camera counts and auto-selecting allowed public playback cameras.
Caller: Agents implementing the playback token share/activation polish after user approval.
Deps: backend/services/playbackTokenService.js, backend/controllers/playbackTokenController.js, frontend/src/hooks/playback/usePlaybackTokenAccess.js, frontend/src/pages/Playback.jsx.
MainFuncs: Defines TDD tasks, exact files, expected behavior, verification, commit boundaries, and push requirements.
SideEffects: Documentation only.
-->

# Playback Token Share Auto-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix selected-token WhatsApp/share text so it reports the correct CCTV count, and make public playback automatically switch to the CCTV allowed by an activated token/share key.

**Architecture:** Keep entitlement truth in the backend token service. Backend returns normalized `allowed_camera_ids`, `camera_rules`, and a new `default_camera_id`; frontend uses that response to select the right playback camera before reloading segments. No schema changes are needed.

**Tech Stack:** Node.js 20+, Fastify controller/service tests with Vitest, React 18/Vite frontend, React Testing Library, existing playback token service/hook/page boundaries.

---

## Baseline Verification Already Run

- Backend focused gate: `cd backend && npm test -- playbackTokenService.test.js playbackTokenController.test.js recordingPlaybackService.test.js`
  - Expected current result before implementation: 3 files pass, 29 tests pass.
- Frontend focused gate: `cd frontend && npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx src/pages/Playback.test.jsx src/hooks/admin/usePlaybackTokenManagementPage.test.jsx`
  - Expected current result before implementation: 3 files pass, 28 tests pass.
- Git state: `git status --short`
  - Expected current result before implementation: no output.

## File Structure

- Modify `backend/services/playbackTokenService.js`
  - Responsibility: normalize selected-token camera metadata for share text and activation responses.
  - Add small pure helpers near `sanitizeTokenRow` or before `PlaybackTokenService`:
    - `getEnabledRuleCameraIds(row)`
    - `resolveAllowedCameraIds(row)`
    - `resolveDefaultCameraId(row, requestedCameraId = null)`
  - Use helpers in `buildShareText()` and `validateRawTokenForCamera()`.
- Modify `backend/__tests__/playbackTokenService.test.js`
  - Responsibility: lock the regression for `Akses: 1 kamera terpilih` when selected tokens rely on `allowed_camera_ids`/`camera_rules`, and lock `default_camera_id`.
- Modify `backend/__tests__/playbackTokenController.test.js`
  - Responsibility: verify activation response exposes `default_camera_id` metadata from the service.
- Modify `frontend/src/hooks/playback/usePlaybackTokenAccess.js`
  - Responsibility: expose `defaultCameraId`, pass activation response data to `onActivated`, and preserve existing token/share activation behavior.
- Modify `frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx`
  - Responsibility: verify hook exposes default camera id and passes activation data to callback.
- Modify `frontend/src/pages/Playback.jsx`
  - Responsibility: choose the correct public playback camera after token activation, update URL to the selected allowed camera, then reload segments for that camera.
- Modify `frontend/src/pages/Playback.test.jsx`
  - Responsibility: verify manual token activation and share-link activation automatically load the allowed camera.
- Modify maps if flow documentation changes:
  - `backend/.module_map.md`
  - `backend/services/.module_map.md`
  - `frontend/src/.module_map.md`
  - `frontend/src/hooks/playback/.module_map.md`
  - `frontend/src/pages/.module_map.md`

---

### Task 1: Backend Share Count And Default Camera Metadata

**Files:**
- Modify: `backend/__tests__/playbackTokenService.test.js`
- Modify: `backend/services/playbackTokenService.js`

- [ ] **Step 1: Write failing backend tests for selected share count and default camera**

Add this test after the existing `builds selected-camera share link with target camera id` test in `backend/__tests__/playbackTokenService.test.js`:

```javascript
    it('builds selected-camera share text count from allowed camera metadata', async () => {
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const shareText = playbackTokenService.buildShareText({
            shareKey: 'SANDI1234',
            tokenRow: {
                label: 'Client Alang Alang',
                scope_type: 'selected',
                camera_ids_json: '[]',
                camera_rules: [{ camera_id: 1168, enabled: true }],
                allowed_camera_ids: [1168],
                expires_at: null,
                share_template: 'Kode Akses: {{token}}\nLink: {{playback_url}}\nBerlaku: {{expires_at}}\nAkses: {{camera_scope}}',
            },
            request: { headers: { origin: 'http://172.17.11.12:800' } },
        });

        expect(shareText).toContain('Kode Akses: SANDI1234');
        expect(shareText).toContain('Link: http://172.17.11.12:800/playback?cam=1168&share=SANDI1234');
        expect(shareText).toContain('Akses: 1 kamera terpilih');
        expect(shareText).not.toContain('Akses: 0 kamera terpilih');
    });
```

Add this test after `allows only cameras included in selected scope`:

```javascript
    it('returns default selected camera metadata when validating a token without requested camera', async () => {
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 77,
            label: 'Client Single CCTV',
            token_prefix: 'rafpb_single',
            share_key_prefix: 'SANDI1234',
            preset: 'custom',
            scope_type: 'selected',
            camera_ids_json: '[]',
            playback_window_hours: null,
            expires_at: null,
            revoked_at: null,
            last_used_at: null,
            use_count: 0,
            share_template: null,
            created_by: 1,
            created_at: '2026-05-05 12:00:00',
            updated_at: '2026-05-05 12:00:00',
        });
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            { camera_id: 1168, enabled: 1, playback_window_hours: null, expires_at: null, note: '' },
        ]);
        const { default: playbackTokenService } = await import('../services/playbackTokenService.js');

        const result = playbackTokenService.validateRawTokenForCamera('SANDI1234', 0, { touch: false });

        expect(result.allowed_camera_ids).toEqual([1168]);
        expect(result.default_camera_id).toBe(1168);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
npm test -- playbackTokenService.test.js
```

Expected before implementation:
- Test `builds selected-camera share text count from allowed camera metadata` fails because share text says `0 kamera terpilih`.
- Test `returns default selected camera metadata when validating a token without requested camera` fails because `default_camera_id` is missing.

- [ ] **Step 3: Implement backend helper functions**

In `backend/services/playbackTokenService.js`, add these pure helpers after `sanitizeTokenRow(row)` or just before `class PlaybackTokenService`:

```javascript
function getEnabledRuleCameraIds(row = {}) {
    const rules = Array.isArray(row.camera_rules) ? row.camera_rules : [];
    return [...new Set(rules
        .filter((rule) => rule && rule.enabled !== false && rule.enabled !== 0)
        .map((rule) => Number.parseInt(rule.camera_id, 10))
        .filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0))];
}

function resolveAllowedCameraIds(row = {}) {
    if (Array.isArray(row.allowed_camera_ids) && row.allowed_camera_ids.length > 0) {
        return [...new Set(row.allowed_camera_ids
            .map((cameraId) => Number.parseInt(cameraId, 10))
            .filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0))];
    }

    const ruleCameraIds = getEnabledRuleCameraIds(row);
    if (ruleCameraIds.length > 0) {
        return ruleCameraIds;
    }

    if (Array.isArray(row.camera_ids) && row.camera_ids.length > 0) {
        return [...new Set(row.camera_ids
            .map((cameraId) => Number.parseInt(cameraId, 10))
            .filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0))];
    }

    return parseCameraIdsJson(row.camera_ids_json);
}

function resolveDefaultCameraId(row = {}, requestedCameraId = null) {
    const allowedCameraIds = resolveAllowedCameraIds(row);
    const normalizedRequestedCameraId = Number.parseInt(requestedCameraId, 10);
    if (
        Number.isInteger(normalizedRequestedCameraId)
        && normalizedRequestedCameraId > 0
        && allowedCameraIds.includes(normalizedRequestedCameraId)
    ) {
        return normalizedRequestedCameraId;
    }

    return allowedCameraIds[0] || null;
}
```

- [ ] **Step 4: Use helpers in `buildShareText()`**

Replace the selected-scope part of `buildShareText()` in `backend/services/playbackTokenService.js` with:

```javascript
        const allowedCameraIds = row?.scope_type === 'selected'
            ? resolveAllowedCameraIds(row)
            : [];
        const targetCameraId = row?.scope_type === 'selected'
            ? resolveDefaultCameraId({ ...row, allowed_camera_ids: allowedCameraIds })
            : null;
        const playbackUrl = this.buildPlaybackUrl({ token, shareKey, request, targetCameraId });
        const cameraScope = row?.scope_type === 'selected'
            ? `${allowedCameraIds.length} kamera terpilih`
            : 'Semua kamera playback';
```

Keep the rest of `buildShareText()` unchanged.

- [ ] **Step 5: Return default camera id from `validateRawTokenForCamera()`**

In the return object near the end of `validateRawTokenForCamera()` in `backend/services/playbackTokenService.js`, replace:

```javascript
            allowed_camera_ids: playbackTokenRuleService.getAllowedCameraIds(token),
            camera_rules: Array.isArray(token.camera_rules) ? token.camera_rules : playbackTokenRuleService.getRulesForToken(token.id),
```

with:

```javascript
            allowed_camera_ids: playbackTokenRuleService.getAllowedCameraIds(token),
            camera_rules: Array.isArray(token.camera_rules) ? token.camera_rules : playbackTokenRuleService.getRulesForToken(token.id),
            default_camera_id: token.scope_type === 'selected'
                ? resolveDefaultCameraId({
                    ...token,
                    allowed_camera_ids: playbackTokenRuleService.getAllowedCameraIds(token),
                    camera_rules: Array.isArray(token.camera_rules) ? token.camera_rules : playbackTokenRuleService.getRulesForToken(token.id),
                }, normalizedCameraId)
                : null,
```

- [ ] **Step 6: Run backend token service test**

Run:

```bash
cd backend
npm test -- playbackTokenService.test.js
```

Expected:
- `playbackTokenService.test.js` passes.

- [ ] **Step 7: Commit backend service fix**

Run:

```bash
git status --short
git add backend/services/playbackTokenService.js backend/__tests__/playbackTokenService.test.js
git commit -m "Fix: correct playback token selected camera share metadata"
git push origin main
```

Expected:
- Commit succeeds.
- Push updates `origin/main`.

---

### Task 2: Backend Activation Response Contract

**Files:**
- Modify: `backend/__tests__/playbackTokenController.test.js`

- [ ] **Step 1: Extend controller activation metadata test**

In `backend/__tests__/playbackTokenController.test.js`, update the mocked data in `returns allowed camera metadata after playback token activation` to include `default_camera_id`:

```javascript
        validateRawTokenForCameraMock.mockReturnValue({
            id: 2,
            expires_at: null,
            scope_type: 'selected',
            allowed_camera_ids: [7],
            camera_rules: [{ camera_id: 7, enabled: true, playback_window_hours: 24 }],
            default_camera_id: 7,
        });
```

Update the final assertion to:

```javascript
        expect(payload.data).toMatchObject({
            scope_type: 'selected',
            allowed_camera_ids: [7],
            camera_rules: [{ camera_id: 7, enabled: true, playback_window_hours: 24 }],
            default_camera_id: 7,
        });
```

- [ ] **Step 2: Run controller test**

Run:

```bash
cd backend
npm test -- playbackTokenController.test.js
```

Expected:
- `playbackTokenController.test.js` passes.

- [ ] **Step 3: Run backend focused gate**

Run:

```bash
cd backend
npm test -- playbackTokenService.test.js playbackTokenController.test.js recordingPlaybackService.test.js
```

Expected:
- 3 files pass.

- [ ] **Step 4: Commit response contract test**

Run:

```bash
git status --short
git add backend/__tests__/playbackTokenController.test.js
git commit -m "Fix: expose playback token default camera metadata"
git push origin main
```

Expected:
- Commit succeeds.
- Push updates `origin/main`.

---

### Task 3: Frontend Token Hook Exposes Activation Target

**Files:**
- Modify: `frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx`
- Modify: `frontend/src/hooks/playback/usePlaybackTokenAccess.js`

- [ ] **Step 1: Write failing hook test**

In `frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx`, update the existing activation test response data:

```javascript
            data: {
                id: 8,
                scope_type: 'selected',
                allowed_camera_ids: [3],
                camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 24 }],
                default_camera_id: 3,
            },
```

Add `onActivated` to renderHook:

```javascript
        const onActivated = vi.fn();

        const { result } = renderHook(() => usePlaybackTokenAccess({
            enabled: true,
            searchParams: new URLSearchParams('cam=3&share=CLIENT88'),
            setSearchParams,
            cameraId: 3,
            onActivated,
        }));
```

Add assertions:

```javascript
        expect(result.current.defaultCameraId).toBe(3);
        expect(onActivated).toHaveBeenCalledWith(expect.objectContaining({
            default_camera_id: 3,
            allowed_camera_ids: [3],
        }));
```

- [ ] **Step 2: Run hook test to verify it fails**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx
```

Expected before implementation:
- Fails because `defaultCameraId` is not returned and `onActivated` is called without activation data.

- [ ] **Step 3: Implement hook activation payload**

In `frontend/src/hooks/playback/usePlaybackTokenAccess.js`, inside `activateToken`, replace:

```javascript
            setTokenStatus(response.data || null);
            setTokenInput('');
            setTokenMessage('Token playback aktif');
            onActivated?.();
            return true;
```

with:

```javascript
            const tokenData = response.data || null;
            setTokenStatus(tokenData);
            setTokenInput('');
            setTokenMessage('Token playback aktif');
            onActivated?.(tokenData);
            return true;
```

In the hook return object, add:

```javascript
        defaultCameraId: tokenStatus?.default_camera_id || null,
```

Keep existing `allowedCameraIds` and `cameraRules` returns unchanged.

- [ ] **Step 4: Run hook test**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx
```

Expected:
- Hook test passes.

- [ ] **Step 5: Commit hook change**

Run:

```bash
git status --short
git add frontend/src/hooks/playback/usePlaybackTokenAccess.js frontend/src/hooks/playback/usePlaybackTokenAccess.test.jsx
git commit -m "Fix: expose playback token activation target"
git push origin main
```

Expected:
- Commit succeeds.
- Push updates `origin/main`.

---

### Task 4: Public Playback Auto-Selects Allowed Camera

**Files:**
- Modify: `frontend/src/pages/Playback.test.jsx`
- Modify: `frontend/src/pages/Playback.jsx`

- [ ] **Step 1: Add playback token service mock to `Playback.test.jsx`**

In `frontend/src/pages/Playback.test.jsx`, extend the hoisted mock block:

```javascript
const {
    activateTokenMock,
    activateShareKeyMock,
    heartbeatTokenMock,
    clearTokenMock,
} = vi.hoisted(() => ({
    activateTokenMock: vi.fn(),
    activateShareKeyMock: vi.fn(),
    heartbeatTokenMock: vi.fn(),
    clearTokenMock: vi.fn(),
}));
```

If there is already a `vi.hoisted()` block for playback viewer mocks, use a separate block to avoid changing existing mock names.

Add this mock after the playback viewer service mock:

```javascript
vi.mock('../services/playbackTokenService', () => ({
    default: {
        activateToken: activateTokenMock,
        activateShareKey: activateShareKeyMock,
        heartbeatToken: heartbeatTokenMock,
        clearToken: clearTokenMock,
    },
}));
```

In `beforeEach`, reset and default the mocks:

```javascript
        activateTokenMock.mockReset();
        activateShareKeyMock.mockReset();
        heartbeatTokenMock.mockReset();
        clearTokenMock.mockReset();
        activateTokenMock.mockResolvedValue({ success: false, message: 'Token tidak valid' });
        activateShareKeyMock.mockResolvedValue({ success: false, message: 'Share tidak valid' });
        heartbeatTokenMock.mockResolvedValue({ success: true });
        clearTokenMock.mockResolvedValue({ success: true });
```

- [ ] **Step 2: Write failing test for manual token input**

Add this test in `frontend/src/pages/Playback.test.jsx` near other public playback behavior tests:

```jsx
    it('memilih otomatis CCTV yang diizinkan setelah token manual diaktifkan', async () => {
        activateTokenMock.mockResolvedValueOnce({
            success: true,
            data: {
                id: 99,
                scope_type: 'selected',
                allowed_camera_ids: [2],
                camera_rules: [{ camera_id: 2, enabled: true }],
                default_camera_id: 2,
            },
        });

        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
                <LocationProbe />
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1 },
                        { id: 2, name: 'Gate', enable_recording: 1 },
                    ]}
                />
            </TestRouter>
        );

        fireEvent.change(screen.getByPlaceholderText('Masukkan token akses'), {
            target: { value: 'SANDI1234' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));

        await waitFor(() => {
            expect(activateTokenMock).toHaveBeenCalledWith('SANDI1234', 1, expect.any(String));
        });
        await waitFor(() => {
            expect(getSegments).toHaveBeenCalledWith(2, expect.objectContaining({ accessScope: 'public_preview' }));
        });
        expect(screen.getByTestId('location-search').textContent).toContain('cam=2');
    });
```

- [ ] **Step 3: Write failing test for share link without `cam`**

Add this test after the manual token test:

```jsx
    it('memilih otomatis CCTV default dari share link tanpa parameter cam', async () => {
        activateShareKeyMock.mockResolvedValueOnce({
            success: true,
            data: {
                id: 100,
                scope_type: 'selected',
                allowed_camera_ids: [2],
                camera_rules: [{ camera_id: 2, enabled: true }],
                default_camera_id: 2,
            },
        });

        render(
            <TestRouter initialEntries={['/playback?share=SANDI1234']}>
                <LocationProbe />
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1 },
                        { id: 2, name: 'Gate', enable_recording: 1 },
                    ]}
                />
            </TestRouter>
        );

        await waitFor(() => {
            expect(activateShareKeyMock).toHaveBeenCalledWith('SANDI1234', 1, expect.any(String));
        });
        await waitFor(() => {
            expect(getSegments).toHaveBeenCalledWith(2, expect.objectContaining({ accessScope: 'public_preview' }));
        });
        expect(screen.getByTestId('location-search').textContent).toContain('cam=2');
        expect(screen.getByTestId('location-search').textContent).not.toContain('share=');
    });
```

- [ ] **Step 4: Run Playback test to verify failures**

Run:

```bash
cd frontend
npm test -- src/pages/Playback.test.jsx
```

Expected before implementation:
- New manual-token test fails because activation reloads the old selected camera before switching.
- New share-link test fails if URL/camera selection does not move to default camera reliably.

- [ ] **Step 5: Move playback camera memo before token hook**

In `frontend/src/pages/Playback.jsx`, move this memo so it appears before the `usePlaybackTokenAccess()` call:

```javascript
    const playbackCameras = useMemo(() => cameras.filter((camera) => getStreamCapabilities(camera).playback), [cameras]);
```

Do not duplicate the memo. Remove the old instance below the token hook.

- [ ] **Step 6: Add token activation target resolver**

In `frontend/src/pages/Playback.jsx`, before `usePlaybackTokenAccess()`, add this callback:

```javascript
    const selectTokenDefaultCamera = useCallback((tokenData) => {
        if (isAdminPlayback || !tokenData) {
            return selectedCameraId;
        }

        const allowedIds = Array.isArray(tokenData.allowed_camera_ids)
            ? tokenData.allowed_camera_ids.map((cameraId) => Number.parseInt(cameraId, 10)).filter((cameraId) => Number.isInteger(cameraId) && cameraId > 0)
            : [];
        const defaultCameraId = Number.parseInt(tokenData.default_camera_id, 10);
        const targetCameraId = Number.isInteger(defaultCameraId) && defaultCameraId > 0
            ? defaultCameraId
            : allowedIds[0];
        const targetCamera = playbackCameras.find((camera) => camera.id === targetCameraId);

        if (!targetCamera) {
            return selectedCameraId;
        }

        setSelectedCameraId(targetCamera.id);
        updatePlaybackSearchParams({ camera: targetCamera, replace: true });
        return targetCamera.id;
    }, [isAdminPlayback, playbackCameras, selectedCameraId, updatePlaybackSearchParams]);
```

If `updatePlaybackSearchParams` is currently declared below this location, move `updatePlaybackSearchParams` above `selectTokenDefaultCamera`. Keep the body unchanged.

- [ ] **Step 7: Use activation data for reload**

In the `usePlaybackTokenAccess()` call inside `frontend/src/pages/Playback.jsx`, replace:

```javascript
        onActivated: () => reloadSegments(selectedCameraId, { mode: 'initial' }),
```

with:

```javascript
        onActivated: (tokenData) => {
            const targetCameraId = selectTokenDefaultCamera(tokenData);
            reloadSegments(targetCameraId || selectedCameraId, { mode: 'initial' });
        },
```

Keep `onCleared` unchanged.

- [ ] **Step 8: Keep selected-token effect as a safety net**

Leave the existing effect that checks `allowedCameraIds` and switches to the first allowed camera when the current selected camera is not allowed. This remains useful when token status is restored or activation response lacks `default_camera_id`.

- [ ] **Step 9: Run Playback test**

Run:

```bash
cd frontend
npm test -- src/pages/Playback.test.jsx
```

Expected:
- `Playback.test.jsx` passes.

- [ ] **Step 10: Commit public playback auto-select**

Run:

```bash
git status --short
git add frontend/src/pages/Playback.jsx frontend/src/pages/Playback.test.jsx
git commit -m "Fix: auto-select playback token camera"
git push origin main
```

Expected:
- Commit succeeds.
- Push updates `origin/main`.

---

### Task 5: Documentation Map Sync

**Files:**
- Modify: `backend/.module_map.md`
- Modify: `backend/services/.module_map.md`
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/hooks/playback/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`

- [ ] **Step 1: Update backend maps**

In `backend/.module_map.md`, refine playback stream/token lines to include:

```markdown
- Playback token activation returns selected-token metadata including `allowed_camera_ids`, `camera_rules`, and `default_camera_id`; public clients use this to move to an entitled CCTV without guessing.
```

In `backend/services/.module_map.md`, refine playback token entitlements to include:

```markdown
  - `playbackTokenService.js`: token/session/share/audit orchestration, selected-camera share text, and activation metadata including `default_camera_id`.
```

- [ ] **Step 2: Update frontend maps**

In `frontend/src/.module_map.md`, refine public playback flow to include:

```markdown
Token activation can auto-select `default_camera_id` from backend metadata before segment reload; selected-token metadata still filters the selector to `allowed_camera_ids`.
```

In `frontend/src/hooks/playback/.module_map.md`, refine `usePlaybackTokenAccess.js` to include:

```markdown
- `usePlaybackTokenAccess.js`: Activates public token/share-key cookies, exposes `allowedCameraIds`, `cameraRules`, and `defaultCameraId`, and passes activation metadata to the playback route.
```

In `frontend/src/pages/.module_map.md`, refine `Playback.jsx` to include:

```markdown
- `Playback.jsx`: shared public/admin playback route shell. Public scope is `public_preview`; admin scope is `admin_full`; URL state, segment loading, token camera filtering/default-camera selection, and media/viewer lifecycle live in `../utils/playbackUrlState.js` and `../hooks/playback/*`.
```

- [ ] **Step 3: Commit maps**

Run:

```bash
git status --short
git add backend/.module_map.md backend/services/.module_map.md frontend/src/.module_map.md frontend/src/hooks/playback/.module_map.md frontend/src/pages/.module_map.md
git commit -m "Add: document playback token default camera flow"
git push origin main
```

Expected:
- Commit succeeds.
- Push updates `origin/main`.

---

### Task 6: Final Verification Gate

**Files:**
- No source edits expected.

- [ ] **Step 1: Run backend migration**

Run:

```bash
cd backend
npm run migrate
```

Expected:
- All migrations complete successfully.
- `zz_20260513_add_playback_token_camera_rules.js` remains idempotent.

- [ ] **Step 2: Run backend focused gate**

Run:

```bash
cd backend
npm test -- playbackTokenService.test.js playbackTokenController.test.js recordingPlaybackService.test.js
```

Expected:
- All focused playback token/recording playback tests pass.

- [ ] **Step 3: Run backend full gate**

Run:

```bash
cd backend
npm test
```

Expected:
- Full backend suite passes.

- [ ] **Step 4: Run frontend focused gate**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackTokenAccess.test.jsx src/pages/Playback.test.jsx src/hooks/admin/usePlaybackTokenManagementPage.test.jsx
```

Expected:
- Focused frontend playback/admin token tests pass.

- [ ] **Step 5: Run frontend full test gate**

Run:

```bash
cd frontend
npm test
```

Expected:
- Full frontend suite passes.
- Existing React `act(...)` and React Router future warnings may appear; they are not failures if exit code is 0.

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected:
- Vite production build completes successfully.

- [ ] **Step 7: Run frontend lint**

Run:

```bash
cd frontend
npm run lint
```

Expected:
- ESLint exits 0 with `--max-warnings 0`.

- [ ] **Step 8: Verify git and remote**

Run:

```bash
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected:
- `git status --short` prints no output.
- Local `HEAD` equals remote `refs/heads/main`.

---

## Self-Review

- Spec coverage: The plan covers the observed WhatsApp text bug (`Akses: 0 kamera terpilih`) through backend share count tests and implementation. It covers public auto-select through backend `default_camera_id`, hook propagation, and Playback page selection/reload tests.
- Placeholder scan: No task uses placeholder wording. Each code-changing task includes concrete snippets and exact commands.
- Type consistency: Backend uses snake_case API properties (`allowed_camera_ids`, `camera_rules`, `default_camera_id`). Frontend hook exposes camelCase convenience (`allowedCameraIds`, `cameraRules`, `defaultCameraId`) while preserving API data in `tokenStatus`.
- Risk notes: `Playback.jsx` is already a large file, so the plan keeps edits focused and does not restructure unrelated playback logic. The selected-token effect remains as a fallback so older activation responses still work.
