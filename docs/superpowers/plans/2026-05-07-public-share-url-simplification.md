<!--
Purpose: Implementation plan for simplifying public CCTV share URLs while preserving legacy URL compatibility.
Caller: Agentic workers implementing the public URL/share refactor.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/pages/.module_map.md, frontend/src/hooks/playback/.module_map.md.
MainFuncs: Defines test-first tasks for public live, area, and playback share URL canonicalization.
SideEffects: Documentation only.
-->

# Public Share URL Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify public live, area, and playback share URLs while keeping every existing URL format usable.

**Architecture:** Keep the current route tree and avoid adding `/cctv/:slug`. Canonical share builders generate short URLs, while existing landing/playback parsers continue accepting `mode`, `view`, `camera`, `cam`, and `t` legacy params. Compatibility stays in pure URL utilities and route hooks, not in presentational components.

**Tech Stack:** React 18, React Router search params, Vite/Vitest, ES modules, existing `slugify`, `publicShareUrl`, `publicGrowthShare`, and `playbackUrlState` utilities.

---

## File Structure

- Modify: `frontend/src/utils/publicShareUrl.js`
  - Responsibility: Build canonical public live and playback share URLs.
  - Keep `mode` and `view` parsing helpers for legacy tests and existing callers.
- Modify: `frontend/src/utils/publicShareUrl.test.js`
  - Responsibility: Lock canonical share output and legacy helper behavior.
- Modify: `frontend/src/utils/publicGrowthShare.js`
  - Responsibility: Build canonical area and area-camera public URLs.
- Create: `frontend/src/utils/publicGrowthShare.test.js`
  - Responsibility: Lock area share URL behavior for slug, raw area name, and camera slug variants.
- Modify: `frontend/src/utils/playbackUrlState.js`
  - Responsibility: Parse playback params from `/playback` and legacy root playback URLs; build playback search params without live-only noise.
- Modify: `frontend/src/utils/playbackUrlState.test.js`
  - Responsibility: Lock legacy playback compatibility and canonical playback param cleanup.
- Modify: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`
  - Responsibility: Continue delegating playback URL creation to `buildPublicPlaybackShareUrl`; no route logic inline.
- Modify: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`
  - Responsibility: Verify public playback share copies `/playback?cam=...&t=...`.
- Modify: `frontend/src/hooks/public/useLandingInteractions.js`
  - Responsibility: Keep `/?camera=...` working when `mode/view` are absent; no canonical share logic here.
- Modify: `frontend/src/pages/LandingModeState.test.jsx`
  - Responsibility: Verify user-new URL `/?camera=...` gets default layout/view without losing the camera param.
- Modify: `frontend/src/.module_map.md` and `frontend/src/pages/.module_map.md`
  - Responsibility: Sync documented canonical URL contract and legacy compatibility.

No backend or database files change. DB justification: no schema, query, or persistence changes are required.

---

### Task 1: Canonical Public Share URL Tests

**Files:**
- Modify: `frontend/src/utils/publicShareUrl.test.js`
- Test: `frontend/src/utils/publicShareUrl.test.js`

- [ ] **Step 1: Replace the share URL output tests with canonical URL expectations**

Use this exact test shape in `frontend/src/utils/publicShareUrl.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import {
    buildPublicCameraShareUrl,
    buildPublicPlaybackShareUrl,
    getPublicLayoutMode,
    getPublicLiveView,
} from './publicShareUrl';

describe('publicShareUrl', () => {
    it('builds canonical live camera links without layout params', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=grid'),
            camera: '1-lobby',
        });

        expect(url).toBe('https://cctv.example.com/?camera=1-lobby');
    });

    it('builds the public landing URL when no camera is selected', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=full&view=map'),
            camera: null,
        });

        expect(url).toBe('https://cctv.example.com/');
    });

    it('builds canonical playback links on the playback route', () => {
        const url = buildPublicPlaybackShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=full&view=playback'),
            camera: '1-lobby',
            timestamp: 1710000000000,
        });

        expect(url).toBe('https://cctv.example.com/playback?cam=1-lobby&t=1710000000000');
    });

    it('omits empty playback params from the canonical playback route', () => {
        const url = buildPublicPlaybackShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=playback'),
            camera: null,
            timestamp: null,
        });

        expect(url).toBe('https://cctv.example.com/playback');
    });

    it('keeps legacy layout parsing for URL compatibility', () => {
        expect(getPublicLayoutMode(new URLSearchParams('mode=simple'))).toBe('simple');
        expect(getPublicLayoutMode(new URLSearchParams('mode=playback'))).toBe('full');
    });

    it('keeps legacy live view parsing for URL compatibility', () => {
        expect(getPublicLiveView(new URLSearchParams('view=grid'))).toBe('grid');
        expect(getPublicLiveView(new URLSearchParams('view=playback'))).toBe('map');
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the expected reason**

Run:

```powershell
cd frontend
npm test -- publicShareUrl.test.js
```

Expected: FAIL because `buildPublicCameraShareUrl` still includes `mode/view`, and `buildPublicPlaybackShareUrl` still returns root `/?mode=...&view=playback`.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add frontend/src/utils/publicShareUrl.test.js
git commit -m "Add: canonical public share URL tests"
```

---

### Task 2: Canonical Public Share URL Builder

**Files:**
- Modify: `frontend/src/utils/publicShareUrl.js`
- Test: `frontend/src/utils/publicShareUrl.test.js`

- [ ] **Step 1: Replace only the two builder functions in `publicShareUrl.js`**

Search for:

```javascript
export function buildPublicCameraShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    searchParams,
    camera,
}) {
    const params = new URLSearchParams();
    params.set('mode', getPublicLayoutMode(searchParams));
    params.set('view', getPublicLiveView(searchParams));

    if (camera) {
        params.set('camera', camera);
    }

    return `${origin}/?${params.toString()}`;
}

export function buildPublicPlaybackShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    searchParams,
    camera,
    timestamp,
}) {
    const params = new URLSearchParams();
    params.set('mode', getPublicLayoutMode(searchParams));
    params.set('view', 'playback');

    if (camera) {
        params.set('cam', camera);
    }

    if (timestamp !== null && timestamp !== undefined) {
        params.set('t', String(timestamp));
    }

    return `${origin}/?${params.toString()}`;
}
```

Replace with:

```javascript
export function buildPublicCameraShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    camera,
}) {
    if (!camera) {
        return `${origin}/`;
    }

    const params = new URLSearchParams();
    params.set('camera', camera);

    return `${origin}/?${params.toString()}`;
}

export function buildPublicPlaybackShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    camera,
    timestamp,
}) {
    const params = new URLSearchParams();

    if (camera) {
        params.set('cam', camera);
    }

    if (timestamp !== null && timestamp !== undefined) {
        params.set('t', String(timestamp));
    }

    const queryString = params.toString();
    return queryString ? `${origin}/playback?${queryString}` : `${origin}/playback`;
}
```

- [ ] **Step 2: Run the focused test and verify it passes**

Run:

```powershell
cd frontend
npm test -- publicShareUrl.test.js
```

Expected: PASS for every `publicShareUrl` test.

- [ ] **Step 3: Commit the implementation**

Run:

```powershell
git add frontend/src/utils/publicShareUrl.js
git commit -m "Fix: simplify canonical public share URLs"
```

---

### Task 3: Area Share URL Tests

**Files:**
- Create: `frontend/src/utils/publicGrowthShare.test.js`
- Test: `frontend/src/utils/publicGrowthShare.test.js`

- [ ] **Step 1: Create `publicGrowthShare.test.js`**

Create `frontend/src/utils/publicGrowthShare.test.js` with:

```javascript
import { describe, expect, it } from 'vitest';
import {
    buildAreaPath,
    buildAreaUrl,
    buildCameraUrl,
    getPublicAreaSlug,
} from './publicGrowthShare';

describe('publicGrowthShare', () => {
    it('normalizes raw area names into canonical area paths', () => {
        expect(getPublicAreaSlug('Jakarta Pusat')).toBe('jakarta-pusat');
        expect(buildAreaPath('Jakarta Pusat')).toBe('/area/jakarta-pusat');
    });

    it('prefers persisted area slug fields over display names', () => {
        expect(buildAreaPath({
            slug: 'tanah-abang',
            name: 'Tanah Abang Updated',
        })).toBe('/area/tanah-abang');
    });

    it('builds canonical area URLs', () => {
        expect(buildAreaUrl({ slug: 'tanah-abang' }, 'https://cctv.example.com'))
            .toBe('https://cctv.example.com/area/tanah-abang');
    });

    it('builds canonical area camera URLs with slug camera params', () => {
        expect(buildCameraUrl({
            id: 7,
            name: 'Gerbang Utama',
            area_slug: 'tanah-abang',
        }, 'https://cctv.example.com')).toBe('https://cctv.example.com/area/tanah-abang?camera=7-gerbang-utama');
    });

    it('falls back to the landing camera URL when area slug is missing', () => {
        expect(buildCameraUrl({
            id: 8,
            name: 'Lobby Barat',
        }, 'https://cctv.example.com')).toBe('https://cctv.example.com/?camera=8-lobby-barat');
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the expected reason**

Run:

```powershell
cd frontend
npm test -- publicGrowthShare.test.js
```

Expected: FAIL because `buildCameraUrl` currently uses `camera.id` and falls back through `/area/all`.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add frontend/src/utils/publicGrowthShare.test.js
git commit -m "Add: canonical public area share tests"
```

---

### Task 4: Area Share URL Builder

**Files:**
- Modify: `frontend/src/utils/publicGrowthShare.js`
- Test: `frontend/src/utils/publicGrowthShare.test.js`

- [ ] **Step 1: Add the slug import**

Search for the header block ending and current first function:

```javascript
 */

function normalizeSlug(value = '') {
```

Replace with:

```javascript
 */

import { createCameraSlug } from './slugify';

function normalizeSlug(value = '') {
```

- [ ] **Step 2: Replace `buildCameraUrl`**

Search for:

```javascript
export function buildCameraUrl(camera, origin = window.location.origin) {
    const baseUrl = buildAreaUrl(getPublicAreaSlug(camera) || 'all', origin);
    return `${baseUrl}?camera=${encodeURIComponent(camera.id)}`;
}
```

Replace with:

```javascript
export function buildCameraUrl(camera, origin = window.location.origin) {
    const cameraSlug = createCameraSlug(camera);
    const areaSlug = getPublicAreaSlug(camera);
    const cameraParam = cameraSlug ? `?camera=${encodeURIComponent(cameraSlug)}` : '';

    if (!areaSlug) {
        return `${origin}/${cameraParam}`;
    }

    return `${origin}${buildAreaPath(areaSlug)}${cameraParam}`;
}
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```powershell
cd frontend
npm test -- publicGrowthShare.test.js
```

Expected: PASS for every `publicGrowthShare` test.

- [ ] **Step 4: Commit the implementation**

Run:

```powershell
git add frontend/src/utils/publicGrowthShare.js
git commit -m "Fix: simplify canonical area share URLs"
```

---

### Task 5: Playback URL Compatibility Tests

**Files:**
- Modify: `frontend/src/utils/playbackUrlState.test.js`
- Test: `frontend/src/utils/playbackUrlState.test.js`

- [ ] **Step 1: Add tests for legacy root playback params and cleanup**

Append these tests inside the existing `describe` block in `frontend/src/utils/playbackUrlState.test.js`:

```javascript
it('reads canonical playback params from cam and t', () => {
    const state = getPlaybackUrlState(new URLSearchParams('cam=1-lobby&t=1710000000000'));

    expect(state).toEqual({
        cameraParam: '1-lobby',
        timestampParam: '1710000000000',
        isLegacyRootPlayback: false,
    });
});

it('detects legacy root playback URLs using view=playback', () => {
    const state = getPlaybackUrlState(new URLSearchParams('mode=full&view=playback&cam=1-lobby&t=1710000000000'));

    expect(state).toEqual({
        cameraParam: '1-lobby',
        timestampParam: '1710000000000',
        isLegacyRootPlayback: true,
    });
});

it('detects legacy root playback URLs using mode=playback', () => {
    const state = getPlaybackUrlState(new URLSearchParams('mode=playback&cam=1-lobby&t=1710000000000'));

    expect(state).toEqual({
        cameraParam: '1-lobby',
        timestampParam: '1710000000000',
        isLegacyRootPlayback: true,
    });
});

it('removes live and legacy playback-only params when building playback params', () => {
    const next = buildPlaybackSearchParams({
        currentParams: new URLSearchParams('camera=2-live&mode=full&view=playback&scope=admin_full&accessScope=admin_full'),
        camera: '1-lobby',
        timestamp: 1710000000000,
    });

    expect(next.toString()).toBe('cam=1-lobby&t=1710000000000');
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the expected reason**

Run:

```powershell
cd frontend
npm test -- playbackUrlState.test.js
```

Expected: FAIL because `getPlaybackUrlState` does not expose `isLegacyRootPlayback`, and `buildPlaybackSearchParams` still preserves `mode/view`.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add frontend/src/utils/playbackUrlState.test.js
git commit -m "Add: playback URL compatibility tests"
```

---

### Task 6: Playback URL State Compatibility

**Files:**
- Modify: `frontend/src/utils/playbackUrlState.js`
- Test: `frontend/src/utils/playbackUrlState.test.js`

- [ ] **Step 1: Replace the playback-only param list and `getPlaybackUrlState`**

Search for:

```javascript
const PLAYBACK_ONLY_PARAMS = ['camera', 'scope', 'accessScope'];

export function getPlaybackUrlState(searchParams) {
    return {
        cameraParam: searchParams.get('cam'),
        timestampParam: searchParams.get('t'),
    };
}
```

Replace with:

```javascript
const PLAYBACK_ONLY_PARAMS = ['camera', 'mode', 'view', 'scope', 'accessScope'];

export function getPlaybackUrlState(searchParams) {
    const viewParam = searchParams.get('view');
    const modeParam = searchParams.get('mode');

    return {
        cameraParam: searchParams.get('cam'),
        timestampParam: searchParams.get('t'),
        isLegacyRootPlayback: viewParam === 'playback' || modeParam === 'playback',
    };
}
```

- [ ] **Step 2: Run the focused test and verify it passes**

Run:

```powershell
cd frontend
npm test -- playbackUrlState.test.js
```

Expected: PASS for every `playbackUrlState` test.

- [ ] **Step 3: Commit the implementation**

Run:

```powershell
git add frontend/src/utils/playbackUrlState.js
git commit -m "Fix: preserve legacy playback URL compatibility"
```

---

### Task 7: Playback Share Hook Regression Test

**Files:**
- Modify: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`
- Test: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`

- [ ] **Step 1: Add a test that copied playback links use `/playback`**

Add this test next to the existing share tests:

```javascript
it('copies canonical public playback share links', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
    Object.defineProperty(window.navigator, 'share', {
        configurable: true,
        value: undefined,
    });
    Object.defineProperty(window.navigator, 'canShare', {
        configurable: true,
        value: undefined,
    });

    const videoRef = {
        current: {
            currentTime: 2.4,
        },
    };
    const selectedSegment = {
        start_time: '2024-03-09T16:00:00.000Z',
    };
    const selectedCamera = {
        id: 7,
        name: 'Gerbang Utama',
    };

    const { result } = renderHook(() => usePlaybackShareAndSnapshot({
        videoRef,
        branding: {},
        selectedCamera,
        selectedSegment,
        searchParams: new URLSearchParams('mode=full&view=playback&cam=7-gerbang-utama'),
        isAdminPlayback: false,
    }));

    await act(async () => {
        await result.current.handleShare();
    });

    expect(writeText).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/localhost:3000\/playback\?cam=7-gerbang-utama&t=\d+$/)
    );
});
```

If the test file uses a different origin setup, keep the same assertion intent and match that test file's existing origin convention exactly.

- [ ] **Step 2: Run the focused hook test**

Run:

```powershell
cd frontend
npm test -- usePlaybackShareAndSnapshot.test.jsx
```

Expected: PASS because the hook already delegates to `buildPublicPlaybackShareUrl` after Task 2.

- [ ] **Step 3: Commit the regression test**

Run:

```powershell
git add frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx
git commit -m "Add: playback share route regression test"
```

---

### Task 8: Landing URL Default Regression Test

**Files:**
- Modify: `frontend/src/pages/LandingModeState.test.jsx`
- Test: `frontend/src/pages/LandingModeState.test.jsx`

- [ ] **Step 1: Add a regression test for user-new camera URLs without mode/view**

Add this test to the `LandingModeState` tests:

```javascript
it('keeps camera-only URLs usable by adding default layout and view params', () => {
    const setSearchParams = vi.fn();
    const searchParams = new URLSearchParams('camera=1-gerbang-utama');

    renderHook(() => useLandingModeState(searchParams, setSearchParams));

    expect(setSearchParams).toHaveBeenCalledWith(
        expect.any(URLSearchParams),
        { replace: true }
    );

    const nextParams = setSearchParams.mock.calls[0][0];
    expect(nextParams.get('camera')).toBe('1-gerbang-utama');
    expect(['full', 'simple']).toContain(nextParams.get('mode'));
    expect(['map', 'grid']).toContain(nextParams.get('view'));
});
```

If the test file currently mocks device detection for deterministic layout/view, assert that deterministic pair instead of `toContain`.

- [ ] **Step 2: Run the focused landing mode test**

Run:

```powershell
cd frontend
npm test -- LandingModeState.test.jsx
```

Expected: PASS because current `useLandingModeState` already preserves unknown params while adding default `mode/view`.

- [ ] **Step 3: Commit the regression test**

Run:

```powershell
git add frontend/src/pages/LandingModeState.test.jsx
git commit -m "Add: camera-only landing URL regression test"
```

---

### Task 9: Documentation Map Sync

**Files:**
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`

- [ ] **Step 1: Update frontend route ownership docs**

In `frontend/src/.module_map.md`, replace the public playback critical flow line:

```markdown
- Public playback: URL `cam`/`t` params plus one-time `token` activation -> `utils/playbackUrlState.js` -> `Playback.jsx` camera shell -> `hooks/playback/usePlaybackSegments.js` -> segment URL/media lifecycle hooks -> playback viewer session; cameras with no recording segments must stay inside the playback shell with the camera selector visible, while true public access denial can use the dedicated denied state.
```

With:

```markdown
- Public playback: canonical `/playback?cam=:cameraSlug&t=:timestamp` URLs and legacy root `/?view=playback&cam=:cameraSlug&t=:timestamp` URLs -> `utils/playbackUrlState.js` -> `Playback.jsx` camera shell -> `hooks/playback/usePlaybackSegments.js` -> segment URL/media lifecycle hooks -> playback viewer session; cameras with no recording segments must stay inside the playback shell with the camera selector visible, while true public access denial can use the dedicated denied state.
```

- [ ] **Step 2: Update page URL contract docs**

In `frontend/src/pages/.module_map.md`, replace:

```markdown
- URL params: live public uses `camera`; playback uses `cam` and `t`.
```

With:

```markdown
- URL params: canonical live public shares use `/?camera=:cameraSlug`; area camera shares use `/area/:areaSlug?camera=:cameraSlug`; canonical public playback shares use `/playback?cam=:cameraSlug&t=:timestamp`; legacy `mode/view` live and root playback URLs remain supported.
```

- [ ] **Step 3: Commit docs sync**

Run:

```powershell
git add frontend/src/.module_map.md frontend/src/pages/.module_map.md
git commit -m "Add: public share URL contract docs"
```

---

### Task 10: Final Verification and Push

**Files:**
- Verify: all files changed by Tasks 1-9

- [ ] **Step 1: Run focused frontend tests**

Run:

```powershell
cd frontend
npm test -- publicShareUrl.test.js publicGrowthShare.test.js playbackUrlState.test.js usePlaybackShareAndSnapshot.test.jsx LandingModeState.test.jsx Playback.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```powershell
cd frontend
npm run build
```

Expected: PASS with Vite build output and no fatal errors.

- [ ] **Step 3: Run lint**

Run:

```powershell
cd frontend
npm run lint
```

Expected: PASS or only pre-existing warnings already accepted by the repository. New URL files must not introduce lint errors.

- [ ] **Step 4: Check final git status**

Run:

```powershell
git status --short
```

Expected: no unstaged implementation changes. If docs or tests remain modified, stage and commit only those files with a message matching the specific change.

- [ ] **Step 5: Push the active branch**

Run:

```powershell
git push
```

Expected: push succeeds to the active upstream branch.

---

## Self-Review

- Spec coverage: canonical live, area, area-camera, playback, and legacy compatibility are covered by Tasks 1-8.
- Placeholder scan: no placeholder tasks remain; each task has exact files, code, commands, and expected output.
- Type consistency: `cameraParam`, `timestampParam`, `isLegacyRootPlayback`, `buildPublicCameraShareUrl`, `buildPublicPlaybackShareUrl`, `buildAreaPath`, `buildAreaUrl`, and `buildCameraUrl` are used consistently across tests and implementations.
- Scope check: plan is frontend-only and does not touch backend routes, database schema, or streaming services.
