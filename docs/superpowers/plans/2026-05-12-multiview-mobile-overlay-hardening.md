<!--
Purpose: Implementation plan for fixing mobile quick-action overlap and hardening public multi-view startup/tracking behavior.
Caller: Agents implementing the public landing and MultiView mobile overlay fixes.
Deps: SYSTEM_MAP.md, frontend/src/components/landing/.module_map.md, frontend/src/components/MultiView/.module_map.md.
MainFuncs: Defines TDD tasks, exact files, expected changes, verification, and commit sequence.
SideEffects: None; documentation only.
-->

# MultiView Mobile Overlay Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix mobile quick-action dock overlap on public multi-view and preserve lightweight CCTV startup by keeping stream selection capped, staggered, and queued.

**Architecture:** Treat multi-view as a modal/fullscreen public video surface. The landing shell owns whether fixed public UI is visible, `MultiViewLayout` owns the overlay stacking layer, `MultiViewButton` remains only a launcher, and `MultiViewVideoItem` should only create frontend viewer sessions for stream types that are not already tracked by the HLS proxy and only after real playback starts.

**Tech Stack:** React 18, Vite, Tailwind CSS, Vitest, React Testing Library, HLS.js.

---

## File Structure

- Modify: `frontend/src/pages/LandingPage.jsx`
  - Responsibility: public landing composition. Hide mobile dock and launcher while multi-view is open in both simple and full modes.
- Modify: `frontend/src/pages/LandingPage.test.jsx`
  - Responsibility: regression coverage for fixed public UI visibility while multi-view is active.
- Modify: `frontend/src/components/MultiView/MultiViewLayout.jsx`
  - Responsibility: fullscreen multi-view shell. Raise modal stacking above mobile dock and other fixed widgets.
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.jsx`
  - Responsibility: one tile media lifecycle. Move viewer tracking from mount-time delayed session to playback-confirmed, non-proxied stream tracking.
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`
  - Responsibility: source-level lifecycle regression checks for viewer tracking and queued startup.
- Modify: `frontend/src/components/MultiView/MultiViewButton.test.jsx`
  - Responsibility: launcher lane regression. Keep existing lane test valid after launcher visibility is handled by the page shell.
- Modify: `frontend/src/components/MultiView/.module_map.md`
  - Responsibility: sync documented multi-view overlay and tracking policy.
- Modify: `frontend/src/components/landing/.module_map.md`
  - Responsibility: sync documented mobile dock suppression rule for video surfaces.

## Task 1: Landing Shell Fixed UI Suppression

**Files:**
- Modify: `frontend/src/pages/LandingPage.test.jsx`
- Modify: `frontend/src/pages/LandingPage.jsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/pages/LandingPage.test.jsx`, update the hoisted values and component mocks so tests can open multi-view from the page shell.

```jsx
const { getPublicSaweriaConfig, testBackendReachability, updateMetaTags, getPublicLandingPageSettings, getPublicAdsSettings, getDiscovery, preloadLandingMapView, resolvePublicPopupCamera, videoPopupPropsSpy, landingPageSimplePropsSpy, cameraProviderPropsSpy, cameraContextState } = vi.hoisted(() => ({
    getPublicSaweriaConfig: vi.fn(),
    testBackendReachability: vi.fn(),
    updateMetaTags: vi.fn(),
    getPublicLandingPageSettings: vi.fn(),
    getPublicAdsSettings: vi.fn(),
    getDiscovery: vi.fn(),
    preloadLandingMapView: vi.fn(),
    resolvePublicPopupCamera: vi.fn(),
    videoPopupPropsSpy: vi.fn(),
    landingPageSimplePropsSpy: vi.fn(),
    cameraProviderPropsSpy: vi.fn(),
    cameraContextState: { cameras: [], deviceTier: 'medium' },
}));
```

Replace the `LandingCamerasSection` mock with a version that can add one multi-view camera.

```jsx
vi.mock('../components/landing/LandingCamerasSection', () => ({
    default: ({ onMapCameraOpen, onAddMulti, viewMode }) => (
        <section id="camera-workspace" data-testid="camera-workspace" data-view-mode={viewMode}>
            <button
                type="button"
                data-testid="open-map-popup"
                onClick={() => onMapCameraOpen?.({
                    id: 99,
                    name: 'Map Camera',
                    status: 'active',
                    is_online: 1,
                })}
            >
                cameras-section
            </button>
            <button
                type="button"
                data-testid="open-map-popup-alt"
                onClick={() => onMapCameraOpen?.({
                    id: 100,
                    name: 'Map Camera Alt',
                    status: 'active',
                    is_online: 1,
                })}
            >
                alternate-camera
            </button>
            <button
                type="button"
                data-testid="add-multiview-camera"
                onClick={() => onAddMulti?.({
                    id: 101,
                    name: 'Multi Camera',
                    status: 'active',
                    is_online: 1,
                    stream_source: 'external',
                    delivery_type: 'external_hls',
                    streams: { hls: 'https://example.com/multi.m3u8' },
                })}
            >
                add-multiview-camera
            </button>
        </section>
    ),
}));
```

Replace the multi-view mocks with accessible test IDs.

```jsx
vi.mock('../components/MultiView/MultiViewButton', () => ({
    default: ({ count, onClick }) => (
        <button type="button" data-testid="multi-view-button" onClick={onClick}>
            multi-button-{count}
        </button>
    ),
}));

vi.mock('../components/MultiView/MultiViewLayout', () => ({
    default: () => <div data-testid="multi-view-layout">multi-layout</div>,
}));
```

Add this test inside the existing `describe('LandingPage public shell', () => { ... })` block.

```jsx
it('hides mobile dock and launcher while multi-view is open', async () => {
    resolvePublicPopupCamera.mockImplementation((camera) => Promise.resolve(camera));

    renderWithRouter(<LandingPage />);

    await waitFor(() => {
        expect(screen.getByTestId('add-multiview-camera')).toBeTruthy();
    });

    await act(async () => {
        screen.getByTestId('add-multiview-camera').click();
    });

    await waitFor(() => {
        expect(screen.getByTestId('multi-view-button')).toBeTruthy();
    });

    expect(screen.getByTestId('landing-mobile-dock')).toBeTruthy();

    await act(async () => {
        screen.getByTestId('multi-view-button').click();
    });

    await waitFor(() => {
        expect(screen.getByTestId('multi-view-layout')).toBeTruthy();
    });

    expect(screen.queryByTestId('landing-mobile-dock')).toBeNull();
    expect(screen.queryByTestId('multi-view-button')).toBeNull();
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx -t "hides mobile dock and launcher while multi-view is open"
```

Expected: FAIL because `LandingMobileDock` still renders when `showMulti === true`, and `MultiViewButton` still renders while the overlay is open.

- [ ] **Step 3: Implement minimal page-shell fix**

In `frontend/src/pages/LandingPage.jsx`, apply both replacements in the simple and full mode render paths.

```diff
-                <MultiViewButton
-                    count={multiCameras.length}
-                    onClick={() => setShowMulti(true)}
-                    maxReached={maxReached}
-                    maxStreams={maxStreams}
-                />
-                {!popup && (
+                {!showMulti && (
+                    <MultiViewButton
+                        count={multiCameras.length}
+                        onClick={() => setShowMulti(true)}
+                        maxReached={maxReached}
+                        maxStreams={maxStreams}
+                    />
+                )}
+                {!popup && !showMulti && (
                     <LandingMobileDock
                         viewMode={viewMode}
                         onViewModeChange={handleMobileViewModeChange}
                         onHomeClick={handleMobileHomeClick}
                         onQuickAccessClick={handleMobileQuickAccessClick}
```

- [ ] **Step 4: Run the focused test again**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx -t "hides mobile dock and launcher while multi-view is open"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git status
git add frontend/src/pages/LandingPage.jsx frontend/src/pages/LandingPage.test.jsx
git commit -m "Fix: hide mobile dock during multi-view"
```

## Task 2: MultiView Overlay Stack Token

**Files:**
- Modify: `frontend/src/components/MultiView/MultiViewLayout.jsx`
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`

- [ ] **Step 1: Write the failing source-level overlay test**

In `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`, add a `MultiViewLayout` source read near the existing `source` constant.

```js
const layoutSource = fs.readFileSync(path.join(dirname, 'MultiViewLayout.jsx'), 'utf8');
```

Add this test to the existing `describe`.

```js
it('renders the multi-view shell above public mobile dock overlays', () => {
    expect(layoutSource).toContain('z-[1300]');
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
cd frontend
npm test -- MultiViewVideoItem.stability.test.js -t "renders the multi-view shell above public mobile dock overlays"
```

Expected: FAIL because `MultiViewLayout` currently uses `z-50`.

- [ ] **Step 3: Raise the overlay layer**

In `frontend/src/components/MultiView/MultiViewLayout.jsx`, replace:

```jsx
<div className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 flex flex-col">
```

with:

```jsx
<div className="fixed inset-0 z-[1300] bg-gray-50 dark:bg-gray-950 flex flex-col">
```

- [ ] **Step 4: Run the focused test again**

Run:

```bash
cd frontend
npm test -- MultiViewVideoItem.stability.test.js -t "renders the multi-view shell above public mobile dock overlays"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git status
git add frontend/src/components/MultiView/MultiViewLayout.jsx frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js
git commit -m "Fix: raise multiview overlay layer"
```

## Task 3: Viewer Tracking Policy Alignment

**Files:**
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.jsx`
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`

- [ ] **Step 1: Write the failing source-level tracking tests**

Add these tests to `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`.

```js
it('starts frontend viewer sessions only after playback is confirmed', () => {
    const sessionStartIndex = source.indexOf('viewerService.startSession(camera.id)');
    const handlePlayingIndex = source.indexOf('const handlePlaying = () => {');

    expect(sessionStartIndex).toBeGreaterThan(handlePlayingIndex);
    expect(source).toContain('startViewerSessionAfterPlayback');
});

it('skips frontend viewer sessions for backend-proxied HLS streams', () => {
    expect(source).toContain('shouldTrackFrontendViewerSession');
    expect(source).toContain('return false;');
    expect(source).toContain('isDirectStream');
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
cd frontend
npm test -- MultiViewVideoItem.stability.test.js -t "frontend viewer sessions"
```

Expected: FAIL because the current viewer session effect starts on mount after `initDelay`.

- [ ] **Step 3: Replace mount-time viewer session tracking with playback-confirmed tracking**

In `frontend/src/components/MultiView/MultiViewVideoItem.jsx`, add refs after existing refs.

```jsx
const viewerSessionIdRef = useRef(null);
const viewerSessionPendingRef = useRef(false);
const viewerSessionActiveRef = useRef(true);
```

Add this helper after `hasRenderableExternalUrl`.

```jsx
const shouldTrackFrontendViewerSession = () => {
    if (isMaintenance || isOffline) {
        return false;
    }

    if (renderMode !== 'hls') {
        return true;
    }

    return Boolean(isDirectStream);
};
```

Remove the current viewer session `useEffect` that starts at mount with `initDelay`. Replace it with this cleanup-only effect.

```jsx
useEffect(() => {
    viewerSessionActiveRef.current = true;

    return () => {
        viewerSessionActiveRef.current = false;
        const sessionId = viewerSessionIdRef.current;
        viewerSessionIdRef.current = null;
        viewerSessionPendingRef.current = false;

        if (sessionId) {
            Promise.resolve(viewerService.stopSession(sessionId)).catch(err => {
                console.error('[MultiViewVideoItem] Failed to stop viewer session:', err);
            });
        }
    };
}, [camera.id]);
```

Add this callback before the HLS effect.

```jsx
const startViewerSessionAfterPlayback = useCallback(async () => {
    if (!shouldTrackFrontendViewerSession()) {
        return;
    }

    if (viewerSessionIdRef.current || viewerSessionPendingRef.current) {
        return;
    }

    viewerSessionPendingRef.current = true;

    try {
        const nextSessionId = await viewerService.startSession(camera.id);

        if (!viewerSessionActiveRef.current) {
            if (nextSessionId) {
                Promise.resolve(viewerService.stopSession(nextSessionId)).catch(() => { });
            }
            return;
        }

        viewerSessionIdRef.current = nextSessionId;
    } catch (error) {
        console.error('[MultiViewVideoItem] Failed to start viewer session:', error);
    } finally {
        viewerSessionPendingRef.current = false;
    }
}, [camera.id, isDirectStream, isMaintenance, isOffline, renderMode]);
```

Inside the HLS `handlePlaying`, FLV `markLive`, MJPEG `onLoad`, and embed load-success paths, call:

```jsx
startViewerSessionAfterPlayback();
```

For the HLS effect dependency array, add:

```jsx
startViewerSessionAfterPlayback,
```

For the FLV/MJPEG/embed effect dependency arrays, include the callback where those effects reference it.

- [ ] **Step 4: Run focused tracking tests**

Run:

```bash
cd frontend
npm test -- MultiViewVideoItem.stability.test.js -t "viewer sessions"
```

Expected: PASS.

- [ ] **Step 5: Run broader MultiView tests**

Run:

```bash
cd frontend
npm test -- streamInitQueue.test.js MultiViewVideoItem.stability.test.js MultiViewVideoItem.test.jsx MultiViewButton.test.jsx
```

Expected: PASS. If `MultiViewVideoItem.test.jsx` has mocks expecting mount-time tracking, update those tests to trigger `playing` on the rendered media element before asserting `viewerService.startSession`.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git status
git add frontend/src/components/MultiView/MultiViewVideoItem.jsx frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js frontend/src/components/MultiView/MultiViewVideoItem.test.jsx
git commit -m "Fix: track multiview viewers after playback"
```

## Task 4: Documentation Map Sync

**Files:**
- Modify: `frontend/src/components/MultiView/.module_map.md`
- Modify: `frontend/src/components/landing/.module_map.md`

- [ ] **Step 1: Update MultiView map**

In `frontend/src/components/MultiView/.module_map.md`, replace:

```md
- `MultiViewLayout` renders up to three `MultiViewVideoItem` tiles and staggers startup by tile index.
```

with:

```md
- `MultiViewLayout` renders up to three `MultiViewVideoItem` tiles, owns the fullscreen modal stacking layer above public mobile docks, and staggers startup by tile index.
```

Replace:

```md
- Keep viewer sessions guarded against async unmount races: if a delayed `startSession` resolves after unmount, immediately stop that session; do not start a frontend session for internal/proxied HLS streams.
```

with:

```md
- Keep viewer sessions guarded against async unmount races: start frontend viewer sessions only after playback is confirmed, immediately stop late sessions after unmount, and do not start a frontend session for internal/proxied HLS streams because the HLS proxy owns those sessions.
```

- [ ] **Step 2: Update landing map**

In `frontend/src/components/landing/.module_map.md`, replace:

```md
- `LandingMobileDock.jsx`: mobile-only bottom dock for public Home/Map/Grid/Favorit/Playback navigation; callback mode serves landing pages and href mode serves public playback route links.
```

with:

```md
- `LandingMobileDock.jsx`: mobile-only bottom dock for public Home/Map/Grid/Favorit/Playback navigation; callback mode serves landing pages and href mode serves public playback route links; page shells must suppress it while popup or multi-view video surfaces are active.
```

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git status
git add frontend/src/components/MultiView/.module_map.md frontend/src/components/landing/.module_map.md
git commit -m "Add: document multiview mobile overlay policy"
```

## Task 5: Final Verification And Push

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run focused frontend regression gate**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx LandingMobileDock.test.jsx streamInitQueue.test.js MultiViewVideoItem.stability.test.js MultiViewVideoItem.test.jsx MultiViewButton.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS and Vite build completes.

- [ ] **Step 3: Run lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: PASS. If unrelated existing lint failures appear, record exact files and do not mix unrelated fixes into this branch.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status
git diff -- frontend/src/pages/LandingPage.jsx frontend/src/pages/LandingPage.test.jsx frontend/src/components/MultiView/MultiViewLayout.jsx frontend/src/components/MultiView/MultiViewVideoItem.jsx frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js frontend/src/components/MultiView/MultiViewButton.test.jsx frontend/src/components/MultiView/.module_map.md frontend/src/components/landing/.module_map.md
```

Expected: only the planned landing, multi-view, test, and map-doc files are modified.

- [ ] **Step 5: Push**

Run:

```bash
git status
git push
```

Expected: branch pushes successfully to GitHub.

## Self-Review

- Spec coverage: covers mobile dock overlap, launcher visibility during overlay, overlay stacking, existing staggered/queued startup behavior, and viewer tracking policy.
- Incomplete marker scan: clean; each code step includes target file and concrete code.
- Type consistency: `showMulti`, `MultiViewButton`, `LandingMobileDock`, `MultiViewLayout`, `startViewerSessionAfterPlayback`, `shouldTrackFrontendViewerSession`, and `isDirectStream` match existing local code names.
