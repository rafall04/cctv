<!--
Purpose: Implementation plan to fix unresolved multi-view streams and support all project-defined public live stream delivery types.
Caller: Agents implementing the multi-view live playback fix.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/components/MultiView/.module_map.md, publicCameraResolver, cameraDelivery, MultiView components.
MainFuncs: Defines TDD tasks for resolving camera stream payloads before multi-view playback and adding multi-format tile rendering.
SideEffects: Documentation only.
-->

# Multi-View Universal Stream Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix multi-view stuck-at-connecting by resolving camera stream payloads before playback and make multi-view support the same public live delivery types already modeled by the project.

**Architecture:** Keep multi-view selection in `useLandingInteractions`, but inject a resolver from `useLandingPageController` so selected cameras are upgraded from `/api/cameras/active` metadata to `/api/stream/:id` playback payloads before tiles mount. Split tile rendering so `MultiViewVideoItem.jsx` routes by delivery type: HLS uses the existing HLS state machine, FLV uses `flv.js`, MJPEG uses `<img>`, embed/JS MPEG/custom fallback uses `<iframe>` when an embed URL exists, and truly unsupported custom WebSocket URLs show a deterministic tile error instead of endless connecting.

**Tech Stack:** React 18 hooks, Vite/Vitest, HLS.js, FLV.js, existing `cameraDelivery.js`, `publicCameraResolver.js`, `streamService.js`, `viewerService.js`, Tailwind.

---

## Root Cause

`/api/cameras/active` returns the public landing read model without `streams.hls`. Single-camera popup fixes that by calling `resolvePublicPopupCamera()` before mounting `VideoPopup`. Multi-view currently stores the raw card camera in `multiCameras`, so `MultiViewVideoItem` computes an empty `effectiveUrl` and returns before HLS init, timeout, or error handling. The initial status remains `connecting`.

## File Structure

- Modify: `frontend/src/hooks/public/useLandingInteractions.js`
  - Responsibility: Own multi-view selection state and resolve camera payloads before adding a tile.
- Modify: `frontend/src/hooks/public/useLandingPageController.js`
  - Responsibility: Pass `resolvePublicPopupCamera(camera, cameras)` into multi-view interactions.
- Modify: `frontend/src/utils/cameraDelivery.js`
  - Responsibility: Mark browser-renderable delivery types as multi-view capable and expose a helper for tile render mode.
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.jsx`
  - Responsibility: Render one multi-view tile for HLS, FLV, MJPEG, and embed/fallback streams with isolated lifecycle cleanup.
- Modify: `frontend/src/components/MultiView/.module_map.md`
  - Responsibility: Sync documented flow from HLS-only to multi-format multi-view.
- Test: `frontend/src/hooks/public/useLandingInteractions.test.js`
  - Responsibility: Prove multi-view resolves metadata-only cameras and avoids duplicate unresolved entries.
- Test: `frontend/src/components/MultiView/MultiViewVideoItem.test.jsx`
  - Responsibility: Prove FLV, MJPEG, embed fallback, unsupported custom WebSocket, and missing URL behavior.
- Test: `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`
  - Responsibility: Update source-level guard from HLS-only to multi-format lifecycle rules.

---

### Task 1: Multi-View Capability Policy

**Files:**
- Modify: `frontend/src/utils/cameraDelivery.js`
- Test: add assertions to existing relevant frontend tests, or create focused tests only if no coverage exists.

- [ ] **Step 1: Write the failing capability test**

Add a focused test block in the existing camera delivery utility test if present. If no file exists, create `frontend/src/utils/cameraDelivery.test.js` with this header and assertions:

```javascript
/*
Purpose: Verify camera delivery capability policy for public live and multi-view surfaces.
Caller: Vitest frontend utility suite.
Deps: cameraDelivery.
MainFuncs: cameraDelivery capability tests.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import { getMultiViewRenderMode, isMultiViewSupported } from './cameraDelivery.js';

describe('cameraDelivery multi-view capability', () => {
    it.each([
        ['internal_hls', 'hls'],
        ['external_hls', 'hls'],
        ['external_flv', 'flv'],
        ['external_mjpeg', 'mjpeg'],
        ['external_embed', 'embed'],
        ['external_jsmpeg', 'embed'],
    ])('supports %s in multi-view as %s', (deliveryType, expectedMode) => {
        const camera = {
            delivery_type: deliveryType,
            external_stream_url: deliveryType === 'external_mjpeg' ? 'https://example.com/mjpeg' : undefined,
            external_embed_url: deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg'
                ? 'https://example.com/embed'
                : undefined,
        };

        expect(isMultiViewSupported(camera)).toBe(true);
        expect(getMultiViewRenderMode(camera)).toBe(expectedMode);
    });

    it('does not claim unsupported custom websocket URLs are playable without an embed fallback', () => {
        expect(isMultiViewSupported({
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/live',
        })).toBe(false);
        expect(getMultiViewRenderMode({
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/live',
        })).toBe('unsupported');
    });

    it('supports custom websocket cameras when an embed fallback exists', () => {
        const camera = {
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/live',
            external_embed_url: 'https://example.com/player',
        };

        expect(isMultiViewSupported(camera)).toBe(true);
        expect(getMultiViewRenderMode(camera)).toBe('embed');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- cameraDelivery.test.js`

Expected: FAIL because `getMultiViewRenderMode` is not exported and non-HLS delivery types currently report `multiview: false`.

- [ ] **Step 3: Implement capability policy**

Update `frontend/src/utils/cameraDelivery.js`:

```javascript
export function getMultiViewRenderMode(camera = {}) {
    const deliveryType = getEffectiveDeliveryType(camera);

    if (deliveryType === 'internal_hls' || deliveryType === 'external_hls') {
        return 'hls';
    }

    if (deliveryType === 'external_flv') {
        return 'flv';
    }

    if (deliveryType === 'external_mjpeg') {
        return 'mjpeg';
    }

    if (deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg') {
        return getPopupEmbedUrl(camera) ? 'embed' : 'unsupported';
    }

    if (deliveryType === 'external_custom_ws') {
        return getPopupEmbedUrl(camera) ? 'embed' : 'unsupported';
    }

    return 'unsupported';
}

export function isMultiViewSupported(camera = {}) {
    return getMultiViewRenderMode(camera) !== 'unsupported';
}
```

Keep `getStreamCapabilities()` fallback data aligned so it does not contradict `isMultiViewSupported()`:

```javascript
const fallbackCapabilities = {
    internal_hls: { live: true, popup: true, multiview: true, playback: true, supported_player: 'hls' },
    external_hls: { live: true, popup: true, multiview: true, playback: true, supported_player: 'hls' },
    external_flv: { live: true, popup: true, multiview: true, playback: false, supported_player: 'flv' },
    external_mjpeg: { live: true, popup: true, multiview: true, playback: false, supported_player: 'mjpeg' },
    external_embed: { live: true, popup: true, multiview: true, playback: false, supported_player: 'embed' },
    external_jsmpeg: { live: true, popup: true, multiview: true, playback: false, supported_player: 'embed_fallback' },
    external_custom_ws: { live: false, popup: true, multiview: false, playback: false, supported_player: 'unsupported' },
};
```

- [ ] **Step 4: Run capability test**

Run: `cd frontend && npm test -- cameraDelivery.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status
git add frontend/src/utils/cameraDelivery.js frontend/src/utils/cameraDelivery.test.js
git commit -m "Fix: expand multi-view stream capability policy"
git push
```

---

### Task 2: Resolve Multi-View Camera Payloads Before Selection

**Files:**
- Modify: `frontend/src/hooks/public/useLandingInteractions.js`
- Modify: `frontend/src/hooks/public/useLandingPageController.js`
- Test: `frontend/src/hooks/public/useLandingInteractions.test.js`

- [ ] **Step 1: Write failing resolver tests**

Add tests to `frontend/src/hooks/public/useLandingInteractions.test.js`:

```javascript
it('resolves metadata-only cameras before adding them to multi-view', async () => {
    const resolveUrlCamera = vi.fn().mockResolvedValue({
        ...createCamera(7),
        streams: { hls: 'https://example.com/resolved.m3u8' },
    });
    const hook = renderInteractions('high', { resolveUrlCamera });

    await act(async () => {
        await hook.result.current.handleAddMulti({
            ...createCamera(7),
            streams: {},
        });
    });

    expect(resolveUrlCamera).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    expect(hook.result.current.multiCameras).toEqual([
        expect.objectContaining({
            id: 7,
            streams: { hls: 'https://example.com/resolved.m3u8' },
        }),
    ]);
});

it('keeps a deterministic warning when multi-view stream resolution fails', async () => {
    const resolveUrlCamera = vi.fn().mockRejectedValue(new Error('network'));
    const hook = renderInteractions('high', { resolveUrlCamera });

    await act(async () => {
        await hook.result.current.handleAddMulti(createCamera(8));
    });

    expect(hook.result.current.multiCameras).toEqual([]);
    expect(hook.addToast).toHaveBeenCalledWith(
        '"Camera 8" gagal disiapkan untuk Multi-View',
        'warning'
    );
});
```

If `renderInteractions` currently does not accept overrides, update its helper in the test file:

```javascript
function renderInteractions(deviceTier = 'high', overrides = {}) {
    const addToast = vi.fn();
    const setSearchParams = vi.fn();
    const addRecentCamera = vi.fn();
    const searchParams = new URLSearchParams();

    const result = renderHook(() => useLandingInteractions({
        cameras: [],
        layoutMode: 'full',
        viewMode: 'grid',
        deviceTier,
        searchParams,
        setSearchParams,
        addToast,
        addRecentCamera,
        resolveUrlCamera: overrides.resolveUrlCamera,
    }));

    return { ...result, addToast, setSearchParams, addRecentCamera };
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd frontend && npm test -- useLandingInteractions.test.js`

Expected: FAIL because `handleAddMulti` is synchronous and stores the raw camera.

- [ ] **Step 3: Implement resolver-first selection**

In `frontend/src/hooks/public/useLandingInteractions.js`, add state:

```javascript
const [pendingMultiCameraIds, setPendingMultiCameraIds] = useState([]);
```

Replace `handleAddMulti` with an async resolver-aware version:

```javascript
const handleAddMulti = useCallback(async (camera) => {
    if (!isMultiViewSupported(camera)) {
        addToast(`"${camera.name}" tidak mendukung Multi-View untuk format stream ini`, 'warning');
        return;
    }

    const existing = multiCameras.some((item) => item.id === camera.id);
    if (existing) {
        setMultiCameras((previous) => previous.filter((item) => item.id !== camera.id));
        addToast(`"${camera.name}" removed from Multi-View`, 'info');
        setMaxReached(false);
        return;
    }

    if (multiCameras.length >= maxStreams) {
        addToast(`Maximum ${maxStreams} cameras allowed in Multi-View mode (${deviceTier}-end device)`, 'warning');
        setMaxReached(true);
        setTimeout(() => setMaxReached(false), 3000);
        return;
    }

    setPendingMultiCameraIds((previous) => (
        previous.includes(camera.id) ? previous : [...previous, camera.id]
    ));

    try {
        const resolvedCamera = typeof resolveUrlCamera === 'function'
            ? await resolveUrlCamera(camera)
            : camera;
        const nextCamera = resolvedCamera || camera;

        if (!isMultiViewSupported(nextCamera)) {
            addToast(`"${camera.name}" tidak mendukung Multi-View untuk format stream ini`, 'warning');
            return;
        }

        setMultiCameras((previous) => {
            if (previous.some((item) => item.id === nextCamera.id)) {
                return previous;
            }

            if (previous.length >= maxStreams) {
                setMaxReached(true);
                setTimeout(() => setMaxReached(false), 3000);
                return previous;
            }

            addToast(`"${nextCamera.name}" added to Multi-View (${previous.length + 1}/${maxStreams})`, 'success');
            return [...previous, nextCamera];
        });
    } catch {
        addToast(`"${camera.name}" gagal disiapkan untuk Multi-View`, 'warning');
    } finally {
        setPendingMultiCameraIds((previous) => previous.filter((id) => id !== camera.id));
    }
}, [addToast, deviceTier, maxStreams, multiCameras, resolveUrlCamera]);
```

Expose the pending ids from the hook return:

```javascript
return {
    popup,
    multiCameras,
    pendingMultiCameraIds,
    showMulti,
    maxReached,
    maxStreams,
    setShowMulti,
    setPopup,
    handleAddMulti,
    handleRemoveMulti,
    handleCameraClick,
    handlePopupClose,
};
```

In `frontend/src/hooks/public/useLandingPageController.js`, pass through `pendingMultiCameraIds` from `useLandingInteractions` and return it to callers. If the UI does not consume it yet, returning it still keeps the state observable for tests and future disabled/loading button state.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- useLandingInteractions.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status
git add frontend/src/hooks/public/useLandingInteractions.js frontend/src/hooks/public/useLandingPageController.js frontend/src/hooks/public/useLandingInteractions.test.js
git commit -m "Fix: resolve multi-view cameras before playback"
git push
```

---

### Task 3: Multi-Format Tile Playback

**Files:**
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.jsx`
- Test: `frontend/src/components/MultiView/MultiViewVideoItem.test.jsx`

- [ ] **Step 1: Write failing tile tests**

Add tests to `frontend/src/components/MultiView/MultiViewVideoItem.test.jsx`:

```javascript
it('renders external MJPEG streams with an image tile', async () => {
    render(
        <MultiViewVideoItem
            camera={{
                ...baseCamera,
                id: 41,
                delivery_type: 'external_mjpeg',
                external_stream_url: 'https://example.com/live.mjpg',
                streams: {},
            }}
            onRemove={vi.fn()}
            onError={vi.fn()}
            onStatusChange={vi.fn()}
        />
    );

    expect(await screen.findByTestId('multi-view-mjpeg')).toHaveAttribute('src', 'https://example.com/live.mjpg');
    expect(hlsInstances).toHaveLength(0);
});

it('renders external embed fallback streams with an iframe tile', async () => {
    render(
        <MultiViewVideoItem
            camera={{
                ...baseCamera,
                id: 42,
                delivery_type: 'external_embed',
                external_embed_url: 'https://example.com/embed',
                streams: {},
            }}
            onRemove={vi.fn()}
            onError={vi.fn()}
            onStatusChange={vi.fn()}
        />
    );

    expect(await screen.findByTestId('multi-view-embed')).toHaveAttribute('src', 'https://example.com/embed');
    expect(hlsInstances).toHaveLength(0);
});

it('initializes external FLV streams with flv.js', async () => {
    render(
        <MultiViewVideoItem
            camera={{
                ...baseCamera,
                id: 43,
                delivery_type: 'external_flv',
                external_stream_url: 'https://example.com/live.flv',
                streams: {},
            }}
            onRemove={vi.fn()}
            onError={vi.fn()}
            onStatusChange={vi.fn()}
        />
    );

    await waitFor(() => {
        expect(flvPlayers).toHaveLength(1);
    });
    expect(flvPlayers[0].attachMediaElement).toHaveBeenCalledWith(screen.getByTestId('multi-view-video'));
    expect(hlsInstances).toHaveLength(0);
});

it('shows a clear error for unsupported custom websocket streams without fallback', async () => {
    const onError = vi.fn();

    render(
        <MultiViewVideoItem
            camera={{
                ...baseCamera,
                id: 44,
                delivery_type: 'external_custom_ws',
                external_stream_url: 'wss://example.com/live',
                streams: {},
            }}
            onRemove={vi.fn()}
            onError={onError}
            onStatusChange={vi.fn()}
        />
    );

    expect(await screen.findByText('Format stream tidak didukung')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(44, expect.any(Error));
});
```

Mock `flv.js` in the test file following the `VideoPopup.test.jsx` pattern:

```javascript
const flvPlayers = [];

vi.mock('flv.js', () => ({
    default: {
        isSupported: vi.fn(() => true),
        Events: {
            ERROR: 'error',
        },
        createPlayer: vi.fn(() => {
            const player = {
                attachMediaElement: vi.fn(),
                load: vi.fn(),
                play: vi.fn(),
                pause: vi.fn(),
                destroy: vi.fn(),
                on: vi.fn(),
            };
            flvPlayers.push(player);
            return player;
        }),
    },
}));
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd frontend && npm test -- MultiViewVideoItem.test.jsx`

Expected: FAIL because the tile is HLS-only and does not import `flv.js` or render MJPEG/embed modes.

- [ ] **Step 3: Implement stream mode routing**

In `frontend/src/components/MultiView/MultiViewVideoItem.jsx`, update imports:

```javascript
import flvjs from 'flv.js';
import {
    getMultiViewRenderMode,
    getPopupEmbedUrl,
    getPrimaryExternalUrl,
} from '../../utils/cameraDelivery.js';
```

Add refs and derived values near existing refs/state:

```javascript
const flvRef = useRef(null);
const renderMode = getMultiViewRenderMode(camera);
const embedUrl = getPopupEmbedUrl(camera);
const primaryExternalUrl = getPrimaryExternalUrl(camera);
const flvUrl = renderMode === 'flv'
    ? (camera.external_stream_url || camera.external_hls_url || null)
    : null;
const mjpegUrl = renderMode === 'mjpeg'
    ? (camera.external_stream_url || camera.external_hls_url || primaryExternalUrl || null)
    : null;
const externalFrameUrl = renderMode === 'embed' ? embedUrl : null;
const hasRenderableExternalUrl = Boolean(flvUrl || mjpegUrl || externalFrameUrl);
```

Extend `cleanupResources()`:

```javascript
if (flvRef.current) {
    flvRef.current.destroy();
    flvRef.current = null;
}
```

Guard HLS effect so it only owns HLS:

```javascript
if (renderMode !== 'hls') return;
if (!effectiveUrl || !videoRef.current) {
    setStatus('error');
    setLoadingStage(LoadingStage.ERROR);
    onError?.(camera.id, new Error('Stream URL belum tersedia untuk Multi-View'));
    return;
}
```

Add FLV effect:

```javascript
useEffect(() => {
    if (isMaintenance || isOffline || renderMode !== 'flv') return;

    if (!flvUrl || !videoRef.current) {
        setStatus('error');
        setLoadingStage(LoadingStage.ERROR);
        onError?.(camera.id, new Error('FLV URL tidak tersedia'));
        return;
    }

    if (!flvjs.isSupported()) {
        setStatus('error');
        setLoadingStage(LoadingStage.ERROR);
        onError?.(camera.id, new Error('Browser tidak mendukung FLV'));
        return;
    }

    const player = flvjs.createPlayer({
        type: 'flv',
        url: flvUrl,
        isLive: true,
        cors: true,
    });
    const video = videoRef.current;
    flvRef.current = player;
    setStatus('connecting');
    setLoadingStage(LoadingStage.LOADING);

    const markLive = () => {
        setStatus('live');
        setLoadingStage(LoadingStage.PLAYING);
        clearStreamTimeout();
    };
    const markError = () => {
        setStatus('error');
        setLoadingStage(LoadingStage.ERROR);
        onError?.(camera.id, new Error('FLV stream error'));
    };

    video.addEventListener('playing', markLive);
    video.addEventListener('error', markError);
    player.attachMediaElement(video);
    player.load();
    video.play().catch(() => {});
    player.on(flvjs.Events.ERROR, markError);

    return () => {
        video.removeEventListener('playing', markLive);
        video.removeEventListener('error', markError);
        player.destroy();
        if (flvRef.current === player) {
            flvRef.current = null;
        }
    };
}, [camera.id, clearStreamTimeout, flvUrl, isMaintenance, isOffline, onError, renderMode]);
```

Add non-video external status effect:

```javascript
useEffect(() => {
    if (isMaintenance || isOffline) return;
    if (renderMode !== 'mjpeg' && renderMode !== 'embed' && renderMode !== 'unsupported') return;

    if (renderMode === 'unsupported' || !hasRenderableExternalUrl) {
        setStatus('error');
        setLoadingStage(LoadingStage.ERROR);
        onError?.(camera.id, new Error('Format stream tidak didukung'));
        return;
    }

    setStatus('live');
    setLoadingStage(LoadingStage.PLAYING);
    clearStreamTimeout();
}, [
    camera.id,
    clearStreamTimeout,
    hasRenderableExternalUrl,
    isMaintenance,
    isOffline,
    onError,
    renderMode,
]);
```

Update render body inside the existing `wrapperRef`:

```jsx
<div ref={wrapperRef} className="w-full h-full">
    {renderMode === 'mjpeg' && mjpegUrl ? (
        <img
            src={mjpegUrl}
            alt={camera.name}
            data-testid="multi-view-mjpeg"
            className="h-full w-full object-contain bg-black"
            onLoad={() => setStatus('live')}
            onError={() => {
                setStatus('error');
                setLoadingStage(LoadingStage.ERROR);
                onError?.(camera.id, new Error('MJPEG stream error'));
            }}
        />
    ) : renderMode === 'embed' && externalFrameUrl ? (
        <iframe
            src={externalFrameUrl}
            title={camera.name}
            data-testid="multi-view-embed"
            className="h-full w-full border-0 bg-black"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            referrerPolicy="no-referrer"
            onLoad={() => setStatus('live')}
        />
    ) : (
        <ZoomableVideo videoRef={videoRef} status={status} maxZoom={3} onZoomChange={setZoom} isFullscreen={isFullscreen} />
    )}
</div>
```

Update the error overlay text for unsupported mode:

```jsx
<p className="text-white text-xs font-medium mb-1">
    {renderMode === 'unsupported' ? 'Format stream tidak didukung' : 'Tidak Terkoneksi'}
</p>
```

- [ ] **Step 4: Run tile tests**

Run: `cd frontend && npm test -- MultiViewVideoItem.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status
git add frontend/src/components/MultiView/MultiViewVideoItem.jsx frontend/src/components/MultiView/MultiViewVideoItem.test.jsx
git commit -m "Fix: support multi-format multi-view tiles"
git push
```

---

### Task 4: Lifecycle Stability And Documentation Sync

**Files:**
- Modify: `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`
- Modify: `frontend/src/components/MultiView/.module_map.md`

- [ ] **Step 1: Update stability tests**

In `frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js`, keep existing HLS dependency guards and add:

```javascript
it('routes non-HLS formats outside the HLS effect', () => {
    expect(source).toContain(\"renderMode !== 'hls'\");
    expect(source).toContain(\"renderMode === 'flv'\");
    expect(source).toContain(\"renderMode === 'mjpeg'\");
    expect(source).toContain(\"renderMode === 'embed'\");
});

it('cleans up FLV player instances on tile unmount', () => {
    expect(source).toContain('flvRef.current.destroy()');
    expect(source).toContain('flvRef.current = null');
});

it('does not silently stay connecting when no stream URL exists', () => {
    expect(source).toContain('Stream URL belum tersedia untuk Multi-View');
    expect(source).toContain('Format stream tidak didukung');
});
```

- [ ] **Step 2: Run stability tests**

Run: `cd frontend && npm test -- MultiViewVideoItem.stability.test.js`

Expected: PASS after Task 3.

- [ ] **Step 3: Update module map**

In `frontend/src/components/MultiView/.module_map.md`, replace HLS-only statements:

```markdown
- `MultiViewVideoItem.jsx`: one live camera tile inside multi-view. Owns HLS, FLV, MJPEG, and embed/fallback tile lifecycle, playback timeout state, viewer session lifecycle, snapshot, zoom, fullscreen, and per-tile retry/error UI.
```

```markdown
- `MultiViewVideoItem` routes by `getMultiViewRenderMode(camera)`: HLS uses HLS.js, FLV uses flv.js, MJPEG uses an image stream, embed/JS MPEG/custom fallback uses an iframe when an embed URL exists, and unsupported custom WebSocket streams show a deterministic error.
- Multi-view selection resolves public landing camera metadata through `resolvePublicPopupCamera` before adding a tile, so tiles receive the same stream payload shape as `VideoPopup`.
```

Replace:

```markdown
- Multi-view is HLS-only. Non-HLS external formats should remain blocked by capability checks before selection.
```

With:

```markdown
- Multi-view supports project-defined browser-renderable public live formats: internal/external HLS, external FLV, external MJPEG, external embed, and embed fallbacks for JS MPEG/custom WebSocket cameras. Raw custom WebSocket streams remain unsupported unless an embed fallback URL is available.
```

- [ ] **Step 4: Commit**

```bash
git status
git add frontend/src/components/MultiView/MultiViewVideoItem.stability.test.js frontend/src/components/MultiView/.module_map.md
git commit -m "Fix: document multi-view stream format lifecycle"
git push
```

---

### Task 5: Integration Verification

**Files:**
- No new source changes unless verification finds a failing edge case.

- [ ] **Step 1: Run focused multi-view suite**

Run:

```bash
cd frontend
npm test -- cameraDelivery.test.js useLandingInteractions.test.js MultiViewVideoItem.test.jsx MultiViewVideoItem.stability.test.js
```

Expected: all tests PASS.

- [ ] **Step 2: Run broader popup/media regression suite**

Run:

```bash
cd frontend
npm test -- VideoPopup.test.jsx CameraDetailPanel.test.jsx RelatedCamerasStrip.test.jsx
```

Expected: all tests PASS; this confirms shared delivery helpers did not regress single-camera popup behavior.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd frontend
npm run build
```

Expected: build completes successfully with no import/export errors.

- [ ] **Step 4: Run lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: lint completes successfully. If existing unrelated lint failures appear, record exact file/line and do not mix unrelated fixes into this branch.

- [ ] **Step 5: Manual browser verification**

Start dev server:

```bash
cd frontend
npm run dev
```

Open the landing page and verify:

- Adding an internal HLS camera to multi-view leaves `connecting` and reaches `LIVE`.
- Adding an external HLS camera uses the same proxy/direct behavior as popup.
- Adding an external FLV camera renders a video tile.
- Adding an external MJPEG camera renders an image tile.
- Adding an external embed/JS MPEG fallback camera renders an iframe tile.
- Adding a custom WebSocket camera without `external_embed_url` shows `Format stream tidak didukung` and does not spin forever.
- Removing a tile destroys only that tile’s player and does not reset other tiles.

- [ ] **Step 6: Final commit if verification required fixes**

```bash
git status
git add <only-files-changed-by-verification-fix>
git commit -m "Fix: stabilize universal multi-view verification"
git push
```

If no verification fixes were needed, only run:

```bash
git status
```

Expected: clean working tree.

---

## Self-Review

- Spec coverage: The plan covers the root cause (`multiCameras` storing unresolved public camera metadata), all project-defined delivery types (`internal_hls`, `external_hls`, `external_flv`, `external_mjpeg`, `external_embed`, `external_jsmpeg`, `external_custom_ws`), deterministic unsupported handling, docs sync, focused tests, build, lint, and manual verification.
- Placeholder scan: No `TBD`, `TODO`, or vague test instructions remain.
- Type consistency: New helper name is consistently `getMultiViewRenderMode`; existing helper names `getPopupEmbedUrl`, `getPrimaryExternalUrl`, `resolvePublicPopupCamera`, and `isMultiViewSupported` match current code.
