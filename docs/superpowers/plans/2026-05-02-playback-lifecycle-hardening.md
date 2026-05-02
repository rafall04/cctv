<!--
Purpose: Track the playback lifecycle hardening implementation plan and execution status.
Caller: Agents and maintainers extracting Playback.jsx lifecycle boundaries.
Deps: frontend/src/pages/Playback.jsx, frontend/src/hooks/playback, frontend/src/utils/playbackUrlState.js.
MainFuncs: Documents URL, segment, viewer tracking, media source, and documentation tasks.
SideEffects: None; documentation only.
-->

# Playback Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `frontend/src/pages/Playback.jsx` into safer, testable playback lifecycle boundaries without changing public/admin playback behavior.

**Architecture:** Keep `Playback.jsx` as the route shell and extract pure URL helpers plus focused hooks for segment loading and playback viewer tracking. Keep existing UI components and service contracts stable; move one lifecycle concern at a time with regression tests before implementation.

**Tech Stack:** React 18, React Router, Vite 5, Vitest, Testing Library, existing frontend services and playback components.

---

## File Structure

- Create: `frontend/src/utils/playbackUrlState.js`
  - Pure helpers for reading/writing playback `cam` and `t` search params.
  - No React imports.
- Create: `frontend/src/utils/playbackUrlState.test.js`
  - Unit tests for URL helper behavior and share-scope safety.
- Create: `frontend/src/hooks/playback/usePlaybackSegments.js`
  - Hook for camera segment loading, stale request protection, URL timestamp selection, and camera reset.
- Create: `frontend/src/hooks/playback/usePlaybackSegments.test.jsx`
  - Hook tests using mocked `recordingService`.
- Create: `frontend/src/hooks/playback/usePlaybackViewerTracking.js`
  - Hook for playback viewer session lifecycle, pending token guard, duplicate event protection, and cleanup.
- Create: `frontend/src/hooks/playback/usePlaybackViewerTracking.test.jsx`
  - Hook tests using mocked `playbackViewerService`.
- Modify: `frontend/src/pages/Playback.jsx`
  - Replace inline helper/session/segment loading logic with extracted helpers/hooks.
  - Keep route composition and existing UI props stable.
- Modify: `frontend/src/.module_map.md`
  - Document the new playback helper/hook boundaries.
- Modify: `frontend/src/pages/Playback.test.jsx`
  - Add or update integration assertions if route behavior shifts during extraction.

---

### Task 1: Playback URL State Helper

**Files:**
- Create: `frontend/src/utils/playbackUrlState.js`
- Create: `frontend/src/utils/playbackUrlState.test.js`
- Modify: `frontend/src/pages/Playback.jsx`

- [x] **Step 1: Write failing tests for URL state helper**

Create `frontend/src/utils/playbackUrlState.test.js`:

```javascript
/*
 * Purpose: Validate playback URL search param parsing and updates.
 * Caller: Vitest frontend suite before changing Playback route URL behavior.
 * Deps: playbackUrlState utility.
 * MainFuncs: getPlaybackUrlState, buildPlaybackSearchParams.
 * SideEffects: None; pure URLSearchParams tests only.
 */
import { describe, expect, it } from 'vitest';
import {
    buildPlaybackSearchParams,
    getPlaybackUrlState,
} from './playbackUrlState.js';

describe('playbackUrlState', () => {
    it('reads playback camera and timestamp params without using live camera param', () => {
        const state = getPlaybackUrlState(new URLSearchParams('camera=99&cam=area-cam-7&t=1777716000000'));

        expect(state.cameraParam).toBe('area-cam-7');
        expect(state.timestampParam).toBe('1777716000000');
    });

    it('builds playback params with cam and t only for playback selection', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('utm_source=share&camera=99'),
            camera: 'jalan-raya-7',
            timestamp: 1777716000000,
        });

        expect(params.get('cam')).toBe('jalan-raya-7');
        expect(params.get('t')).toBe('1777716000000');
        expect(params.has('camera')).toBe(false);
        expect(params.get('utm_source')).toBe('share');
    });

    it('removes timestamp when selecting a camera without a segment', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('cam=old&t=1777716000000'),
            camera: 'new-camera',
            timestamp: null,
        });

        expect(params.get('cam')).toBe('new-camera');
        expect(params.has('t')).toBe(false);
    });

    it('does not serialize admin scope into public playback params', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('scope=admin_full&cam=old'),
            camera: 'public-camera',
            timestamp: 1777716000000,
        });

        expect(params.get('cam')).toBe('public-camera');
        expect(params.get('t')).toBe('1777716000000');
        expect(params.has('scope')).toBe(false);
    });
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/utils/playbackUrlState.test.js
```

Expected: FAIL because `playbackUrlState.js` does not exist.

- [x] **Step 3: Implement helper**

Create `frontend/src/utils/playbackUrlState.js`:

```javascript
/*
 * Purpose: Provide pure helpers for playback route search params.
 * Caller: Playback route and playback URL helper tests.
 * Deps: URLSearchParams browser API.
 * MainFuncs: getPlaybackUrlState, buildPlaybackSearchParams.
 * SideEffects: None; returns new URLSearchParams instances.
 */

const PLAYBACK_ONLY_PARAMS = ['camera', 'scope', 'accessScope'];

export function getPlaybackUrlState(searchParams) {
    return {
        cameraParam: searchParams.get('cam'),
        timestampParam: searchParams.get('t'),
    };
}

export function buildPlaybackSearchParams({
    currentParams,
    camera,
    timestamp,
}) {
    const nextParams = new URLSearchParams(currentParams);

    PLAYBACK_ONLY_PARAMS.forEach((param) => nextParams.delete(param));

    if (camera) {
        nextParams.set('cam', String(camera));
    } else {
        nextParams.delete('cam');
    }

    if (timestamp !== null && timestamp !== undefined && timestamp !== '') {
        nextParams.set('t', String(timestamp));
    } else {
        nextParams.delete('t');
    }

    return nextParams;
}
```

- [x] **Step 4: Wire helper into Playback route**

In `frontend/src/pages/Playback.jsx`, import the helper:

```javascript
import {
    buildPlaybackSearchParams,
    getPlaybackUrlState,
} from '../utils/playbackUrlState.js';
```

Replace direct reads:

```javascript
const cameraIdFromUrl = searchParams.get('cam');
```

with:

```javascript
const { cameraParam: cameraIdFromUrl, timestampParam: timestampFromUrl } = getPlaybackUrlState(searchParams);
```

Replace update logic inside the existing playback search param updater so it calls:

```javascript
const nextParams = buildPlaybackSearchParams({
    currentParams: searchParams,
    camera: camera ? createCameraSlug(camera) : cameraId,
    timestamp,
});
setSearchParams(nextParams, { replace });
```

Preserve the existing updater function name and call sites to keep the page diff small.

- [x] **Step 5: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/utils/playbackUrlState.test.js Playback.test.jsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/utils/playbackUrlState.js frontend/src/utils/playbackUrlState.test.js frontend/src/pages/Playback.jsx
git commit -m "Refactor: extract playback URL state helpers"
git push
```

---

### Task 2: Playback Viewer Tracking Hook

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackViewerTracking.js`
- Create: `frontend/src/hooks/playback/usePlaybackViewerTracking.test.jsx`
- Modify: `frontend/src/pages/Playback.jsx`

- [x] **Step 1: Write failing hook tests**

Create `frontend/src/hooks/playback/usePlaybackViewerTracking.test.jsx`:

```jsx
/*
 * Purpose: Validate playback viewer session lifecycle independent from Playback.jsx.
 * Caller: Vitest frontend suite before extracting playback viewer tracking.
 * Deps: React Testing Library, playback viewer tracking hook, mocked playbackViewerService.
 * MainFuncs: usePlaybackViewerTracking.
 * SideEffects: Uses mock service calls only.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackViewerTracking } from './usePlaybackViewerTracking.js';
import playbackViewerService from '../../services/playbackViewerService.js';

vi.mock('../../services/playbackViewerService.js', () => ({
    default: {
        startSession: vi.fn(),
        stopSession: vi.fn(),
        stopAllSessions: vi.fn(),
    },
}));

const segmentA = {
    filename: '20260502_100000.mp4',
    start_time: '2026-05-02T10:00:00.000Z',
};

const segmentB = {
    filename: '20260502_100500.mp4',
    start_time: '2026-05-02T10:05:00.000Z',
};

describe('usePlaybackViewerTracking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playbackViewerService.startSession.mockResolvedValue('session-1');
        playbackViewerService.stopSession.mockResolvedValue(undefined);
        playbackViewerService.stopAllSessions.mockResolvedValue(undefined);
    });

    it('starts one session for duplicate media event bursts', async () => {
        const { result } = renderHook(() => usePlaybackViewerTracking({
            cameraId: 7,
            segment: segmentA,
            accessScope: 'public_preview',
        }));

        await act(async () => {
            await Promise.all([
                result.current.ensureSessionStarted(),
                result.current.ensureSessionStarted(),
            ]);
        });

        expect(playbackViewerService.startSession).toHaveBeenCalledTimes(1);
        expect(playbackViewerService.startSession).toHaveBeenCalledWith({
            cameraId: 7,
            segmentFilename: '20260502_100000.mp4',
            segmentStartedAt: '2026-05-02T10:00:00.000Z',
            accessMode: 'public_preview',
        });
    });

    it('stops previous session when segment changes', async () => {
        const { result, rerender } = renderHook(
            ({ segment }) => usePlaybackViewerTracking({
                cameraId: 7,
                segment,
                accessScope: 'public_preview',
            }),
            { initialProps: { segment: segmentA } }
        );

        await act(async () => {
            await result.current.ensureSessionStarted();
        });

        playbackViewerService.startSession.mockResolvedValueOnce('session-2');
        rerender({ segment: segmentB });

        await act(async () => {
            await result.current.stopSession();
            await result.current.ensureSessionStarted();
        });

        expect(playbackViewerService.stopSession).toHaveBeenCalledWith('session-1');
        expect(playbackViewerService.startSession).toHaveBeenCalledTimes(2);
    });

    it('cleans up active sessions on unmount', async () => {
        const { result, unmount } = renderHook(() => usePlaybackViewerTracking({
            cameraId: 7,
            segment: segmentA,
            accessScope: 'admin_full',
        }));

        await act(async () => {
            await result.current.ensureSessionStarted();
        });

        unmount();

        expect(playbackViewerService.stopAllSessions).toHaveBeenCalled();
    });
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackViewerTracking.test.jsx
```

Expected: FAIL because hook does not exist.

- [x] **Step 3: Implement hook**

Create `frontend/src/hooks/playback/usePlaybackViewerTracking.js`:

```javascript
/*
 * Purpose: Manage playback viewer session lifecycle outside Playback.jsx.
 * Caller: Playback route and hook tests.
 * Deps: React hooks, playbackViewerService.
 * MainFuncs: usePlaybackViewerTracking.
 * SideEffects: Starts/stops playback viewer sessions through playbackViewerService.
 */

import { useCallback, useEffect, useRef } from 'react';
import playbackViewerService from '../../services/playbackViewerService.js';

function buildPlaybackViewerKey(cameraId, segment, accessScope) {
    if (!cameraId || !segment?.filename) {
        return null;
    }

    return `${cameraId}:${segment.filename}:${accessScope}`;
}

export function usePlaybackViewerTracking({
    cameraId,
    segment,
    accessScope,
}) {
    const activeSessionIdRef = useRef(null);
    const activeKeyRef = useRef(null);
    const pendingKeyRef = useRef(null);
    const pendingTokenRef = useRef(0);
    const latestRef = useRef({ cameraId, segment, accessScope });

    useEffect(() => {
        latestRef.current = { cameraId, segment, accessScope };
    }, [accessScope, cameraId, segment]);

    const stopSession = useCallback(async () => {
        const activeSessionId = activeSessionIdRef.current;
        activeSessionIdRef.current = null;
        activeKeyRef.current = null;
        pendingKeyRef.current = null;
        pendingTokenRef.current += 1;

        if (activeSessionId) {
            await playbackViewerService.stopSession(activeSessionId);
        }
    }, []);

    const ensureSessionStarted = useCallback(async () => {
        const current = latestRef.current;
        const nextKey = buildPlaybackViewerKey(current.cameraId, current.segment, current.accessScope);

        if (!nextKey) {
            return;
        }

        if (activeSessionIdRef.current && activeKeyRef.current === nextKey) {
            return;
        }

        if (pendingKeyRef.current === nextKey) {
            return;
        }

        const pendingToken = pendingTokenRef.current + 1;
        pendingTokenRef.current = pendingToken;
        pendingKeyRef.current = nextKey;

        if (activeSessionIdRef.current && activeKeyRef.current !== nextKey) {
            await stopSession();
        }

        try {
            const sessionId = await playbackViewerService.startSession({
                cameraId: current.cameraId,
                segmentFilename: current.segment.filename,
                segmentStartedAt: current.segment.start_time || null,
                accessMode: current.accessScope,
            });

            const latest = latestRef.current;
            const currentKey = buildPlaybackViewerKey(latest.cameraId, latest.segment, latest.accessScope);

            if (pendingToken !== pendingTokenRef.current || currentKey !== nextKey) {
                if (sessionId) {
                    await playbackViewerService.stopSession(sessionId);
                }
                return;
            }

            if (sessionId) {
                activeSessionIdRef.current = sessionId;
                activeKeyRef.current = nextKey;
            }
        } finally {
            if (pendingToken === pendingTokenRef.current) {
                pendingKeyRef.current = null;
            }
        }
    }, [stopSession]);

    useEffect(() => {
        const nextKey = buildPlaybackViewerKey(cameraId, segment, accessScope);
        if (activeKeyRef.current && activeKeyRef.current !== nextKey) {
            stopSession();
        }
    }, [accessScope, cameraId, segment, stopSession]);

    useEffect(() => {
        return () => {
            stopSession();
            playbackViewerService.stopAllSessions();
        };
    }, [stopSession]);

    return {
        ensureSessionStarted,
        stopSession,
        stopAllSessions: playbackViewerService.stopAllSessions,
    };
}
```

- [x] **Step 4: Wire hook into Playback**

In `frontend/src/pages/Playback.jsx`:

```javascript
import { usePlaybackViewerTracking } from '../hooks/playback/usePlaybackViewerTracking.js';
```

Replace the inline playback viewer refs and functions:

```javascript
const playbackViewerSessionIdRef = useRef(null);
const playbackViewerKeyRef = useRef(null);
const playbackViewerPendingKeyRef = useRef(null);
const playbackViewerPendingTokenRef = useRef(0);
const buildPlaybackViewerKey = useCallback(...);
const stopTrackedPlaybackViewerSession = useCallback(...);
const ensurePlaybackViewerSession = useCallback(...);
```

with:

```javascript
const {
    ensureSessionStarted: ensurePlaybackViewerSession,
    stopSession: stopTrackedPlaybackViewerSession,
} = usePlaybackViewerTracking({
    cameraId: selectedCameraId,
    segment: selectedSegment,
    accessScope,
});
```

Keep all existing call sites using `ensurePlaybackViewerSession()` and `stopTrackedPlaybackViewerSession()`.

- [x] **Step 5: Run tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackViewerTracking.test.jsx Playback.test.jsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/hooks/playback/usePlaybackViewerTracking.js frontend/src/hooks/playback/usePlaybackViewerTracking.test.jsx frontend/src/pages/Playback.jsx
git commit -m "Refactor: extract playback viewer tracking hook"
git push
```

---

### Task 3: Playback Segment Loading Hook

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackSegments.js`
- Create: `frontend/src/hooks/playback/usePlaybackSegments.test.jsx`
- Modify: `frontend/src/pages/Playback.jsx`

- [x] **Step 1: Write failing hook tests**

Create `frontend/src/hooks/playback/usePlaybackSegments.test.jsx`:

```jsx
/*
 * Purpose: Validate playback segment loading, camera reset, and stale response guards.
 * Caller: Vitest frontend suite before extracting segment loading from Playback.jsx.
 * Deps: React Testing Library, usePlaybackSegments hook, mocked recordingService.
 * MainFuncs: usePlaybackSegments.
 * SideEffects: Uses mock recording service calls only.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackSegments } from './usePlaybackSegments.js';
import recordingService from '../../services/recordingService.js';

vi.mock('../../services/recordingService.js', () => ({
    default: {
        getSegments: vi.fn(),
    },
}));

const segmentA = {
    id: 1,
    filename: '20260502_100000.mp4',
    start_time: '2026-05-02T10:00:00.000Z',
    end_time: '2026-05-02T10:05:00.000Z',
};

const segmentB = {
    id: 2,
    filename: '20260502_100500.mp4',
    start_time: '2026-05-02T10:05:00.000Z',
    end_time: '2026-05-02T10:10:00.000Z',
};

describe('usePlaybackSegments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads segments for the selected camera and selects timestamp match', async () => {
        recordingService.getSegments.mockResolvedValue({
            success: true,
            data: [segmentA, segmentB],
        });

        const { result } = renderHook(() => usePlaybackSegments({
            cameraId: 7,
            timestampParam: String(Date.parse('2026-05-02T10:06:00.000Z')),
            accessScope: 'public_preview',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.segments).toEqual([segmentA, segmentB]);
        expect(result.current.selectedSegment).toEqual(segmentB);
        expect(result.current.segmentsCameraId).toBe(7);
    });

    it('ignores stale response after camera changes', async () => {
        let resolveFirst;
        recordingService.getSegments
            .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ success: true, data: [segmentB] });

        const { result, rerender } = renderHook(
            ({ cameraId }) => usePlaybackSegments({
                cameraId,
                timestampParam: null,
                accessScope: 'admin_full',
            }),
            { initialProps: { cameraId: 7 } }
        );

        rerender({ cameraId: 8 });

        await waitFor(() => expect(result.current.segmentsCameraId).toBe(8));

        await act(async () => {
            resolveFirst({ success: true, data: [segmentA] });
        });

        expect(result.current.segments).toEqual([segmentB]);
        expect(result.current.selectedSegment).toEqual(segmentB);
    });

    it('resets segment state when camera is cleared', async () => {
        recordingService.getSegments.mockResolvedValue({ success: true, data: [segmentA] });

        const { result, rerender } = renderHook(
            ({ cameraId }) => usePlaybackSegments({
                cameraId,
                timestampParam: null,
                accessScope: 'public_preview',
            }),
            { initialProps: { cameraId: 7 } }
        );

        await waitFor(() => expect(result.current.segments).toHaveLength(1));

        rerender({ cameraId: null });

        expect(result.current.segments).toEqual([]);
        expect(result.current.selectedSegment).toBe(null);
        expect(result.current.segmentsCameraId).toBe(null);
    });
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackSegments.test.jsx
```

Expected: FAIL because hook does not exist.

- [x] **Step 3: Implement hook**

Create `frontend/src/hooks/playback/usePlaybackSegments.js`:

```javascript
/*
 * Purpose: Load playback recording segments for a selected camera with stale response protection.
 * Caller: Playback route and hook tests.
 * Deps: React hooks, recordingService, playback segment selection utils.
 * MainFuncs: usePlaybackSegments.
 * SideEffects: Fetches recording segments through recordingService.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import recordingService from '../../services/recordingService.js';
import {
    findClosestSegmentByStartTime,
    findSegmentForTimestamp,
} from '../../utils/playbackSegmentSelection.js';

function selectInitialSegment(segments, timestampParam) {
    if (!segments.length) {
        return null;
    }

    if (!timestampParam) {
        return segments[0];
    }

    const timestamp = Number(timestampParam);
    if (!Number.isFinite(timestamp)) {
        return segments[0];
    }

    return findSegmentForTimestamp(segments, timestamp)
        || findClosestSegmentByStartTime(segments, timestamp)
        || segments[0];
}

export function usePlaybackSegments({
    cameraId,
    timestampParam,
    accessScope,
}) {
    const [segments, setSegments] = useState([]);
    const [segmentsCameraId, setSegmentsCameraId] = useState(null);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    const loadSegments = useCallback(async () => {
        const requestCameraId = cameraId;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!requestCameraId) {
            setSegments([]);
            setSegmentsCameraId(null);
            setSelectedSegment(null);
            setLoading(false);
            setError('');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await recordingService.getSegments(requestCameraId, { accessScope });

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (!result?.success) {
                setSegments([]);
                setSegmentsCameraId(requestCameraId);
                setSelectedSegment(null);
                setError(result?.message || 'Gagal memuat segment playback');
                return;
            }

            const nextSegments = Array.isArray(result.data) ? result.data : [];
            setSegments(nextSegments);
            setSegmentsCameraId(requestCameraId);
            setSelectedSegment(selectInitialSegment(nextSegments, timestampParam));
        } catch (loadError) {
            if (requestId !== requestIdRef.current) {
                return;
            }

            setSegments([]);
            setSegmentsCameraId(requestCameraId);
            setSelectedSegment(null);
            setError(loadError?.message || 'Gagal memuat segment playback');
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, [accessScope, cameraId, timestampParam]);

    useEffect(() => {
        loadSegments();
    }, [loadSegments]);

    return {
        segments,
        segmentsCameraId,
        selectedSegment,
        setSelectedSegment,
        loading,
        error,
        reload: loadSegments,
    };
}
```

- [x] **Step 4: Wire hook into Playback**

In `frontend/src/pages/Playback.jsx`, import:

```javascript
import { usePlaybackSegments } from '../hooks/playback/usePlaybackSegments.js';
```

Replace the inline segment state:

```javascript
const [segments, setSegments] = useState([]);
const [segmentsCameraId, setSegmentsCameraId] = useState(null);
const [selectedSegment, setSelectedSegment] = useState(null);
```

with:

```javascript
const {
    segments,
    segmentsCameraId,
    selectedSegment,
    setSelectedSegment,
    loading: segmentsLoading,
    error: segmentsError,
    reload: reloadSegments,
} = usePlaybackSegments({
    cameraId: selectedCameraId,
    timestampParam: timestampFromUrl,
    accessScope,
});
```

Then preserve existing page-level `loading` by deriving it from `segmentsLoading` and any remaining camera/policy loading state:

```javascript
const loading = camerasLoading || segmentsLoading;
```

If `Playback.jsx` currently has a `fetchSegments` function, remove it only after all its call sites are replaced with `reloadSegments` or covered by the hook.

- [x] **Step 5: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackSegments.test.jsx Playback.test.jsx src/utils/playbackSegmentSelection.test.js
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/hooks/playback/usePlaybackSegments.js frontend/src/hooks/playback/usePlaybackSegments.test.jsx frontend/src/pages/Playback.jsx
git commit -m "Refactor: extract playback segment loading hook"
git push
```

---

### Task 4: Media Source Lifecycle Boundary

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackMediaSource.js`
- Create: `frontend/src/hooks/playback/usePlaybackMediaSource.test.jsx`
- Modify: `frontend/src/pages/Playback.jsx`

- [x] **Step 1: Write failing media hook tests**

Create `frontend/src/hooks/playback/usePlaybackMediaSource.test.jsx`:

```jsx
/*
 * Purpose: Validate playback media source lifecycle and listener cleanup.
 * Caller: Vitest frontend suite before extracting media event wiring from Playback.jsx.
 * Deps: React Testing Library and usePlaybackMediaSource hook.
 * MainFuncs: usePlaybackMediaSource.
 * SideEffects: Attaches listeners to an in-memory video element.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackMediaSource } from './usePlaybackMediaSource.js';

function createVideoElement() {
    const listeners = new Map();
    return {
        src: '',
        currentTime: 0,
        duration: 300,
        paused: false,
        ended: false,
        addEventListener: vi.fn((event, handler) => {
            listeners.set(event, handler);
        }),
        removeEventListener: vi.fn((event, handler) => {
            if (listeners.get(event) === handler) {
                listeners.delete(event);
            }
        }),
        load: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        dispatch(event) {
            listeners.get(event)?.();
        },
    };
}

describe('usePlaybackMediaSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('assigns stream URL and attaches media listeners', () => {
        const video = createVideoElement();
        const videoRef = { current: video };

        renderHook(() => usePlaybackMediaSource({
            videoRef,
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted: vi.fn(),
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        expect(video.src).toContain('/api/recordings/stream/a.mp4');
        expect(video.addEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    it('calls playback started once for repeated playing events on same source', () => {
        const video = createVideoElement();
        const onPlaybackStarted = vi.fn();

        renderHook(() => usePlaybackMediaSource({
            videoRef: { current: video },
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted,
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        act(() => {
            video.dispatch('playing');
            video.dispatch('playing');
        });

        expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
    });

    it('removes listeners on unmount', () => {
        const video = createVideoElement();
        const { unmount } = renderHook(() => usePlaybackMediaSource({
            videoRef: { current: video },
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted: vi.fn(),
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        unmount();

        expect(video.removeEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackMediaSource.test.jsx
```

Expected: FAIL because hook does not exist.

- [x] **Step 3: Implement minimal media hook**

Create `frontend/src/hooks/playback/usePlaybackMediaSource.js`:

```javascript
/*
 * Purpose: Manage playback video source assignment and media event listener lifecycle.
 * Caller: Playback route and media source hook tests.
 * Deps: React hooks and HTMLMediaElement-compatible video ref.
 * MainFuncs: usePlaybackMediaSource.
 * SideEffects: Mutates video element src, calls load/play, attaches/removes media listeners.
 */

import { useEffect, useRef } from 'react';

export function usePlaybackMediaSource({
    videoRef,
    streamUrl,
    selectedSegmentKey,
    onPlaybackStarted,
    onEnded,
    onProgress,
}) {
    const startedKeyRef = useRef(null);
    const sourceKeyRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !streamUrl || !selectedSegmentKey) {
            return undefined;
        }

        sourceKeyRef.current = selectedSegmentKey;
        startedKeyRef.current = null;

        if (video.src !== streamUrl) {
            video.src = streamUrl;
            video.load?.();
        }

        const handlePlaying = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }

            if (startedKeyRef.current === selectedSegmentKey) {
                return;
            }

            startedKeyRef.current = selectedSegmentKey;
            onPlaybackStarted?.();
        };

        const handleTimeUpdate = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }
            onProgress?.(video.currentTime);
        };

        const handleEnded = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }
            onEnded?.();
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('ended', handleEnded);
        };
    }, [onEnded, onPlaybackStarted, onProgress, selectedSegmentKey, streamUrl, videoRef]);
}
```

- [x] **Step 4: Wire hook into Playback incrementally**

In `frontend/src/pages/Playback.jsx`, import:

```javascript
import { usePlaybackMediaSource } from '../hooks/playback/usePlaybackMediaSource.js';
```

Use the hook for the first event subset only:

```javascript
usePlaybackMediaSource({
    videoRef,
    streamUrl: playbackSourceRef.current.streamUrl,
    selectedSegmentKey,
    onPlaybackStarted: ensurePlaybackViewerSession,
    onEnded: handleVideoEnded,
    onProgress: markPlaybackProgress,
});
```

Then remove only the duplicated inline `playing`, `timeupdate`, and `ended` listener registration after confirming the hook receives the same callbacks. Keep buffering/error/listener logic inline until a follow-up task moves it, unless the diff is small and tests remain clear.

- [x] **Step 5: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackMediaSource.test.jsx Playback.test.jsx PlaybackVideo.test.jsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/hooks/playback/usePlaybackMediaSource.js frontend/src/hooks/playback/usePlaybackMediaSource.test.jsx frontend/src/pages/Playback.jsx
git commit -m "Refactor: extract playback media source hook"
git push
```

---

### Task 5: Documentation And Final Frontend Gate

**Files:**
- Modify: `frontend/src/.module_map.md`
- Modify: `docs/superpowers/plans/2026-05-02-playback-lifecycle-hardening.md`

- [x] **Step 1: Update frontend module map**

In `frontend/src/.module_map.md`, update the public playback route ownership line to mention:

```markdown
- Public playback: `pages/Playback.jsx` with `accessScope='public_preview'`, `hooks/playback/*`, `utils/playbackUrlState.js`, `components/playback/*`, `services/recordingService.js`, `services/playbackViewerService.js`.
```

Update the stabilization target for `pages/Playback.jsx` to:

```markdown
- `pages/Playback.jsx`: route shell should delegate URL state to `utils/playbackUrlState.js`, segment loading and viewer/media lifecycle to `hooks/playback/*`; keep future playback features in these boundaries.
```

- [x] **Step 2: Run final focused frontend gate**

Run:

```bash
cd frontend
npm test -- src/utils/playbackUrlState.test.js src/hooks/playback/usePlaybackViewerTracking.test.jsx src/hooks/playback/usePlaybackSegments.test.jsx src/hooks/playback/usePlaybackMediaSource.test.jsx Playback.test.jsx PlaybackVideo.test.jsx src/utils/playbackSegmentSelection.test.js
npm run build
```

Expected: all tests PASS and build exits 0.

- [x] **Step 3: Run git status**

Run:

```bash
git status --short
```

Expected: only intended frontend and plan files are modified.

- [x] **Step 4: Commit docs/final map**

```bash
git add frontend/src/.module_map.md docs/superpowers/plans/2026-05-02-playback-lifecycle-hardening.md
git commit -m "Add: document playback lifecycle boundaries"
git push
```

---

## Final Verification

Run from repo root after all task commits:

```bash
cd frontend
npm test -- src/utils/playbackUrlState.test.js src/hooks/playback/usePlaybackViewerTracking.test.jsx src/hooks/playback/usePlaybackSegments.test.jsx src/hooks/playback/usePlaybackMediaSource.test.jsx Playback.test.jsx PlaybackVideo.test.jsx src/utils/playbackSegmentSelection.test.js
npm run build
git status --short
```

Expected:

- Focused playback tests pass.
- Frontend build exits 0.
- Git status is clean after final commit and push.

## Rollback Plan

Each task is committed separately. If a task introduces regressions that are not resolved within the task, revert only that task commit and keep earlier extracted helpers/hooks that passed their gates.
