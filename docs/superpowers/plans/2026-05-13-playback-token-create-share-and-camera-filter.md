# Playback Token Create Share and Camera Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to execute this plan.

## Goal

Fix three playback token admin issues without regressing repeat-share behavior:

1. Initial token creation must immediately produce usable Share and Copy Teks actions.
2. Initial share text for selected-camera tokens must include the selected CCTV name, matching repeat-share output.
3. The selected-camera picker must support fast filtering by CCTV name so admins can handle thousands of cameras.

## Baseline Verification

Current clean baseline before implementation:

```powershell
git status --short --branch
```

Expected observed result:

```text
## main...origin/main
```

Backend token tests currently pass:

```powershell
cd C:\project\cctv\backend
npm test -- playbackTokenService.test.js playbackTokenController.test.js
```

Observed result: 2 test files passed, 22 tests passed.

Frontend admin hook tests currently pass:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx
```

Observed result: 1 test file passed, 3 tests passed.

Component-level tests for the affected share/form components do not exist yet:

```powershell
cd C:\project\cctv\frontend
npm test -- src/components/admin/playback-tokens/PlaybackTokenSharePanel.test.jsx src/components/admin/playback-tokens/PlaybackTokenForm.test.jsx
```

Observed result: no matching test files. Create these tests as part of this change.

## Root Cause

Repeat-share already includes CCTV names because `backend/services/playbackTokenService.js` builds camera names before calling `buildShareText()`.

Initial create does not include CCTV names because `createToken()` builds share text directly from the inserted token row plus normalized rules, without loading the selected camera names.

Share and Copy Teks are fragile after initial create because `frontend/src/hooks/admin/usePlaybackTokenManagementPage.js` stores only `response.share_text`. If the API response is wrapped under `response.data.share_text`, the panel receives empty text and the click actions have no reliable payload.

The selected-camera picker renders the full `cameras` list in `frontend/src/components/admin/playback-tokens/PlaybackTokenForm.jsx`, so admins have no name filter and the DOM can become heavy when thousands of cameras exist.

## Architecture

Keep the backend as source of truth for share text. The frontend should only display and copy the returned text, with a defensive response normalizer so old and wrapped service responses both work.

Use a single batch camera-name lookup for selected scopes:

```sql
SELECT id, name FROM cameras WHERE id IN (?, ?, ...)
```

Do not query per camera. This keeps DB I/O proportional to one selected-token creation, with no N+1 behavior.

For the frontend camera picker:

- Keep selected cameras pinned at the top.
- Filter unselected cameras by `name`, `id`, and `area_name`.
- Limit visible unselected rows to 100 per filter result.
- Always keep selected cameras visible even when they do not match the current search.
- Apply the same filter behavior to create and edit flows.

## Files

Backend:

- `C:\project\cctv\backend\services\playbackTokenService.js`
- `C:\project\cctv\backend\__tests__\playbackTokenService.test.js`
- `C:\project\cctv\backend\.module_map.md`
- `C:\project\cctv\backend\services\.module_map.md`

Frontend:

- `C:\project\cctv\frontend\src\hooks\admin\usePlaybackTokenManagementPage.js`
- `C:\project\cctv\frontend\src\hooks\admin\.module_map.md`
- `C:\project\cctv\frontend\src\__tests__\usePlaybackTokenManagementPage.test.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenSharePanel.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenSharePanel.test.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenForm.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenForm.test.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenTable.jsx`
- `C:\project\cctv\frontend\src\components\admin\playback-tokens\.module_map.md`
- `C:\project\cctv\frontend\src\.module_map.md`

## Task 1: Backend Initial Create Share Text Includes CCTV Names

### 1.1 Add failing backend test

Modify `C:\project\cctv\backend\__tests__\playbackTokenService.test.js`.

Add a service test that creates a selected-camera token with custom access code `SANDI1234`, camera id `1168`, and camera name `CCTV ALANG ALANG`.

Test shape:

```javascript
it('includes selected camera names in share text after initial token creation', () => {
    vi.spyOn(connectionPool, 'transaction').mockImplementation((callback) => callback());
    vi.spyOn(connectionPool, 'execute').mockReturnValue({ lastInsertRowid: 77, changes: 1 });
    vi.spyOn(connectionPool, 'queryOne')
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
            id: 77,
            label: 'Client Alang',
            share_key_prefix: 'SANDI1234',
            scope_type: 'selected',
            camera_ids_json: '[1168]',
            share_template: 'Halo, berikut token akses playback CCTV RAF NET.\n\nKode Akses: {{token}}\nAkses: {{camera_scope}}',
        });
    vi.spyOn(connectionPool, 'query').mockReturnValue([
        { id: 1168, name: 'CCTV ALANG ALANG' },
    ]);

    const result = playbackTokenService.createToken({
        label: 'Client Alang',
        preset: 'lifetime',
        access_code_mode: 'custom',
        custom_access_code: 'SANDI1234',
        scope_type: 'selected',
        camera_rules: [{ camera_id: 1168, enabled: true }],
        share_template: 'Halo, berikut token akses playback CCTV RAF NET.\n\nKode Akses: {{token}}\nAkses: {{camera_scope}}',
    }, buildRequest());

    expect(result.share_text).toContain('Kode Akses: SANDI1234');
    expect(result.share_text).toContain('Akses: 1 kamera terpilih: CCTV ALANG ALANG');
});
```

Run the focused backend test and confirm it fails because initial create currently returns only `1 kamera terpilih`.

```powershell
cd C:\project\cctv\backend
npm test -- playbackTokenService.test.js -t "includes selected camera names"
```

### 1.2 Implement one batch camera-name helper

Modify `C:\project\cctv\backend\services\playbackTokenService.js`.

Add a helper near the share-text helpers:

```javascript
function getCameraNamesByIds(cameraIds = []) {
    const ids = [...new Set(
        cameraIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
    )];

    if (ids.length === 0) {
        return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    return query(
        `SELECT id, name FROM cameras WHERE id IN (${placeholders}) ORDER BY id ASC`,
        ids
    );
}
```

In `createToken()`, load names only for selected scope before `buildShareText()`:

```javascript
const cameraNames = scopeType === 'selected'
    ? getCameraNamesByIds(cameraIds)
    : [];

const data = sanitizeTokenRow({
    ...row,
    camera_rules: normalizedRules,
    allowed_camera_ids: cameraIds,
    camera_names: cameraNames,
});
```

Update `buildRepeatShareText()` to call the same helper instead of having a duplicate inline camera-name query.

### 1.3 Verify backend

Run:

```powershell
cd C:\project\cctv\backend
npm test -- playbackTokenService.test.js playbackTokenController.test.js
```

Required result: all tests pass.

## Task 2: Frontend Share Text Normalization and Guarded Actions

### 2.1 Add failing hook tests

Modify `C:\project\cctv\frontend\src\__tests__\usePlaybackTokenManagementPage.test.jsx`.

Add a test that proves initial create accepts nested API response text:

```javascript
it('stores share text from nested create response data', async () => {
    playbackTokenService.createToken.mockResolvedValue({
        data: {
            share_text: 'Halo token nested',
        },
    });

    const { result } = renderHook(() => usePlaybackTokenManagementPage());

    await waitFor(() => expect(cameraService.getAllCameras).toHaveBeenCalled());
    await act(async () => {
        await result.current.handleCreate({
            label: 'Client',
            preset: 'lifetime',
            scope_type: 'all',
        });
    });

    expect(result.current.createdShare.shareText).toBe('Halo token nested');
});
```

Add a pure-helper test for top-level and nested shapes:

```javascript
expect(extractPlaybackTokenShareText({ share_text: 'Top' })).toBe('Top');
expect(extractPlaybackTokenShareText({ data: { share_text: 'Nested' } })).toBe('Nested');
expect(extractPlaybackTokenShareText({ data: { shareText: 'Camel' } })).toBe('Camel');
expect(extractPlaybackTokenShareText({})).toBe('');
```

Run and confirm failure before implementation:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx -t "share text"
```

### 2.2 Implement response normalizer and action guards

Modify `C:\project\cctv\frontend\src\hooks\admin\usePlaybackTokenManagementPage.js`.

Export this helper:

```javascript
export function extractPlaybackTokenShareText(response = {}) {
    return String(
        response.share_text
        || response.shareText
        || response.data?.share_text
        || response.data?.shareText
        || ''
    ).trim();
}
```

Use it in `handleCreate()` and repeat-share handling:

```javascript
const shareText = extractPlaybackTokenShareText(response);

if (shareText) {
    setCreatedShare({ shareText });
} else {
    setCreatedShare(null);
    notifyError('Teks share kosong', 'Backend tidak mengirim teks share token.');
}
```

Guard clipboard and native share:

```javascript
const shareText = String(text || '').trim();
if (!shareText) {
    notifyError('Teks share kosong', 'Tidak ada teks token yang bisa disalin.');
    return;
}
```

### 2.3 Add SharePanel component tests

Create `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenSharePanel.test.jsx`.

Test disabled empty-state actions:

```jsx
it('disables share actions when share text is empty', () => {
    render(
        <PlaybackTokenSharePanel
            createdShare={{ shareText: '' }}
            whatsappHref="#"
            onCopy={vi.fn()}
            onNativeShare={vi.fn()}
        />
    );

    expect(screen.getByRole('button', { name: /copy teks/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^share$/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /whatsapp/i }).getAttribute('aria-disabled')).toBe('true');
});
```

Test enabled actions call handlers with the exact text:

```jsx
it('passes current share text to copy and native share handlers', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onNativeShare = vi.fn();

    render(
        <PlaybackTokenSharePanel
            createdShare={{ shareText: 'Kode Akses: SANDI1234' }}
            whatsappHref="https://wa.me/?text=Kode%20Akses%3A%20SANDI1234"
            onCopy={onCopy}
            onNativeShare={onNativeShare}
        />
    );

    await user.click(screen.getByRole('button', { name: /copy teks/i }));
    await user.click(screen.getByRole('button', { name: /^share$/i }));

    expect(onCopy).toHaveBeenCalledWith('Kode Akses: SANDI1234');
    expect(onNativeShare).toHaveBeenCalledWith('Kode Akses: SANDI1234');
});
```

### 2.4 Implement SharePanel disabled state

Modify `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenSharePanel.jsx`.

Add:

```javascript
const shareText = String(createdShare?.shareText || '').trim();
const hasShareText = shareText.length > 0;
```

Use `shareText` in the textarea value and button handlers. Disable Copy and Share when `hasShareText` is false. Add `aria-disabled`, `tabIndex`, and `onClick` prevention to the WhatsApp link when empty.

### 2.5 Verify frontend share behavior

Run:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx src/components/admin/playback-tokens/PlaybackTokenSharePanel.test.jsx
```

Required result: all tests pass.

## Task 3: Add Camera Picker Filtering for Create and Edit

### 3.1 Add failing hook tests for filtering

Modify `C:\project\cctv\frontend\src\__tests__\usePlaybackTokenManagementPage.test.jsx`.

Mock camera list:

```javascript
cameraService.getAllCameras.mockResolvedValue([
    { id: 1168, name: 'CCTV ALANG ALANG', area_name: 'Utara' },
    { id: 2001, name: 'CCTV LOBBY RAF NET', area_name: 'Kantor' },
    { id: 3001, name: 'CCTV JALAN DEPAN', area_name: 'Jalan' },
]);
```

Add test:

```javascript
it('filters create token camera picker by name and keeps selected cameras visible', async () => {
    const { result } = renderHook(() => usePlaybackTokenManagementPage());

    await waitFor(() => expect(result.current.cameras).toHaveLength(3));

    act(() => {
        result.current.handleToggleCamera(2001, true);
        result.current.setCameraSearch('alang');
    });

    expect(result.current.visibleCreateCameras.map((camera) => camera.id)).toEqual([2001, 1168]);
});
```

Add pure-helper test for id and area matching:

```javascript
expect(cameraMatchesPlaybackTokenSearch({ id: 1168, name: 'CCTV ALANG ALANG' }, '1168')).toBe(true);
expect(cameraMatchesPlaybackTokenSearch({ name: 'CCTV POS', area_name: 'Utara' }, 'utara')).toBe(true);
expect(cameraMatchesPlaybackTokenSearch({ name: 'CCTV POS', area_name: 'Utara' }, 'selatan')).toBe(false);
```

Run and confirm failure before implementation:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx -t "filters create token camera picker"
```

### 3.2 Implement camera filter helpers in the hook

Modify `C:\project\cctv\frontend\src\hooks\admin\usePlaybackTokenManagementPage.js`.

Add:

```javascript
const CAMERA_PICKER_VISIBLE_LIMIT = 100;

export function normalizePlaybackTokenCameraSearch(value = '') {
    return String(value).trim().toLowerCase();
}

export function cameraMatchesPlaybackTokenSearch(camera, searchValue) {
    const search = normalizePlaybackTokenCameraSearch(searchValue);
    if (!search) {
        return true;
    }

    const values = [
        camera.id,
        camera.name,
        camera.area_name,
        camera.areaName,
    ];

    return values.some((value) => String(value || '').toLowerCase().includes(search));
}

export function buildVisiblePlaybackTokenCameras({
    cameras,
    selectedIds,
    search,
    limit = CAMERA_PICKER_VISIBLE_LIMIT,
}) {
    const selectedIdSet = new Set(selectedIds.map((id) => Number(id)));
    const selected = cameras.filter((camera) => selectedIdSet.has(Number(camera.id)));
    const unselectedMatches = cameras.filter((camera) => {
        const id = Number(camera.id);
        return !selectedIdSet.has(id) && cameraMatchesPlaybackTokenSearch(camera, search);
    });

    return [
        ...selected,
        ...unselectedMatches.slice(0, limit),
    ];
}
```

Add state:

```javascript
const [cameraSearch, setCameraSearch] = useState('');
const [editCameraSearch, setEditCameraSearch] = useState('');
```

Add memoized lists:

```javascript
const visibleCreateCameras = useMemo(() => buildVisiblePlaybackTokenCameras({
    cameras,
    selectedIds: selectedCameraIds,
    search: cameraSearch,
}), [cameras, selectedCameraIds, cameraSearch]);

const visibleEditCameras = useMemo(() => buildVisiblePlaybackTokenCameras({
    cameras,
    selectedIds: editSelectedCameraIds,
    search: editCameraSearch,
}), [cameras, editSelectedCameraIds, editCameraSearch]);
```

Return the new state, setters, visible lists, and `CAMERA_PICKER_VISIBLE_LIMIT`.

Clear `cameraSearch` after successful create and clear `editCameraSearch` when closing or saving edit.

### 3.3 Add PlaybackTokenForm component tests

Create `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenForm.test.jsx`.

Test that the search field calls the filter setter:

```jsx
it('updates camera search from the selected camera picker', async () => {
    const user = userEvent.setup();
    const onUpdateCameraSearch = vi.fn();

    render(
        <PlaybackTokenForm
            form={{ scope_type: 'selected' }}
            cameras={[{ id: 1168, name: 'CCTV ALANG ALANG' }]}
            selectedCameraIds={[]}
            cameraSearch=""
            totalCameraCount={1}
            visibleCameraCount={1}
            onUpdateForm={vi.fn()}
            onUpdateCameraSearch={onUpdateCameraSearch}
            onToggleCamera={vi.fn()}
            onCreate={vi.fn()}
            creating={false}
        />
    );

    await user.type(screen.getByPlaceholderText(/filter nama cctv/i), 'alang');

    expect(onUpdateCameraSearch).toHaveBeenLastCalledWith('alang');
});
```

Test selected count and rendered camera name:

```jsx
expect(screen.getByText('CCTV ALANG ALANG')).toBeInTheDocument();
expect(screen.getByText(/1 dari 1 CCTV/i)).toBeInTheDocument();
```

### 3.4 Implement create form filter UI

Modify `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenForm.jsx`.

When `form.scope_type === 'selected'`, render a compact input above the checkbox list:

```jsx
<input
    type="search"
    value={cameraSearch}
    onChange={(event) => onUpdateCameraSearch(event.target.value)}
    placeholder="Filter nama CCTV"
    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-dark-600 dark:bg-dark-800 dark:text-white"
/>
<p className="text-xs text-gray-500 dark:text-gray-400">
    Menampilkan {visibleCameraCount} dari {totalCameraCount} CCTV
</p>
```

Render the passed `cameras` list, which is now the visible filtered list from the hook.

### 3.5 Implement edit form filter UI

Modify `C:\project\cctv\frontend\src\components\admin\playback-tokens\PlaybackTokenTable.jsx`.

When editing a selected-camera token, render the same search input and summary above the edit checkbox list. Use props:

```javascript
editCameraSearch
onUpdateEditCameraSearch
visibleEditCameras
totalCameraCount
visibleEditCameraCount
```

Render `visibleEditCameras` instead of the full `cameras` list in the edit checkbox list.

### 3.6 Wire filtered lists into the page

Modify the page/container that consumes `usePlaybackTokenManagementPage()` and renders `PlaybackTokenForm` and `PlaybackTokenTable`.

Pass:

```jsx
<PlaybackTokenForm
    cameras={page.visibleCreateCameras}
    cameraSearch={page.cameraSearch}
    totalCameraCount={page.cameras.length}
    visibleCameraCount={page.visibleCreateCameras.length}
    onUpdateCameraSearch={page.setCameraSearch}
/>
```

Pass edit props to the table:

```jsx
<PlaybackTokenTable
    visibleEditCameras={page.visibleEditCameras}
    editCameraSearch={page.editCameraSearch}
    totalCameraCount={page.cameras.length}
    visibleEditCameraCount={page.visibleEditCameras.length}
    onUpdateEditCameraSearch={page.setEditCameraSearch}
/>
```

### 3.7 Verify camera picker behavior

Run:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx src/components/admin/playback-tokens/PlaybackTokenForm.test.jsx
```

Required result: all tests pass.

## Task 4: Documentation and Module Maps

Update header docs for every edited or created source/test file.

Update module maps:

- `C:\project\cctv\backend\.module_map.md`
- `C:\project\cctv\backend\services\.module_map.md`
- `C:\project\cctv\frontend\src\.module_map.md`
- `C:\project\cctv\frontend\src\hooks\admin\.module_map.md`

Create `C:\project\cctv\frontend\src\components\admin\playback-tokens\.module_map.md` if it is still absent. Include:

```markdown
# playback-tokens module map

Purpose: Admin playback token UI components for create, share, list, and edit flows.
Caller: Admin playback token page/container.
Deps: React, UI primitives, playback token hook state.
MainFuncs: PlaybackTokenForm, PlaybackTokenSharePanel, PlaybackTokenTable.
SideEffects: User clipboard/share actions are delegated to hook callbacks.
```

## Task 5: Full Verification Before Commit and Push

Run backend focused tests:

```powershell
cd C:\project\cctv\backend
npm test -- playbackTokenService.test.js playbackTokenController.test.js
```

Run frontend focused tests:

```powershell
cd C:\project\cctv\frontend
npm test -- src/hooks/admin/usePlaybackTokenManagementPage.test.jsx src/components/admin/playback-tokens/PlaybackTokenSharePanel.test.jsx src/components/admin/playback-tokens/PlaybackTokenForm.test.jsx
```

Run frontend lint:

```powershell
cd C:\project\cctv\frontend
npm run lint
```

Run frontend production build:

```powershell
cd C:\project\cctv\frontend
npm run build
```

Run full backend suite:

```powershell
cd C:\project\cctv\backend
npm test
```

Run full frontend suite:

```powershell
cd C:\project\cctv\frontend
npm test -- --run
```

Inspect final diff:

```powershell
cd C:\project\cctv
git diff --check
git status --short
```

Required result: no whitespace errors, only intended files changed.

## Task 6: Commit and Push

Stage only relevant files:

```powershell
cd C:\project\cctv
git add backend/services/playbackTokenService.js backend/__tests__/playbackTokenService.test.js backend/.module_map.md backend/services/.module_map.md frontend/src/hooks/admin/usePlaybackTokenManagementPage.js frontend/src/hooks/admin/.module_map.md frontend/src/__tests__/usePlaybackTokenManagementPage.test.jsx frontend/src/components/admin/playback-tokens/PlaybackTokenSharePanel.jsx frontend/src/components/admin/playback-tokens/PlaybackTokenSharePanel.test.jsx frontend/src/components/admin/playback-tokens/PlaybackTokenForm.jsx frontend/src/components/admin/playback-tokens/PlaybackTokenForm.test.jsx frontend/src/components/admin/playback-tokens/PlaybackTokenTable.jsx frontend/src/components/admin/playback-tokens/.module_map.md frontend/src/.module_map.md
git commit -m "Fix: stabilize playback token sharing"
git push origin main
```

## Rollback Plan

If backend tests fail after the service change, revert only the helper and `createToken()` share-text enrichment while keeping the failing test for diagnosis.

If frontend hook tests fail after response normalization, keep the pure helper test and inspect the mocked service response shape before changing component code.

If component tests fail due missing jest-dom matchers, use vanilla DOM assertions such as `element.disabled` and `element.getAttribute('aria-disabled')`.

If build fails due prop naming mismatch, trace props from the admin token page/container into `PlaybackTokenForm` and `PlaybackTokenTable`, then update only the consumer and component signatures.

## Acceptance Criteria

Manual behavior after implementation:

- Creating a selected token for one CCTV immediately shows share text containing `Akses: 1 kamera terpilih: <camera name>`.
- Copy Teks works immediately after initial create.
- Share works immediately after initial create when `navigator.share` is available.
- WhatsApp link is active only when share text exists.
- Repeat-share keeps using the same access code and still includes CCTV names.
- The selected-camera picker filters by CCTV name, id, and area, while selected cameras stay visible.
- Backend and frontend focused tests pass.
- Frontend lint and build pass.
- Full backend and frontend test suites pass before push.
