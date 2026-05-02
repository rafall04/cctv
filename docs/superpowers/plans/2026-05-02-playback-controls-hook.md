<!--
Purpose: Implementation plan for extracting Playback.jsx control state and handlers into a hook.
Caller: Agents executing the approved playback controls hook design.
Deps: docs/superpowers/specs/2026-05-02-playback-controls-hook-design.md, frontend/src/pages/Playback.jsx, frontend/src/hooks/playback.
MainFuncs: Defines TDD tasks, file edits, verification commands, and commit checkpoints.
SideEffects: None; documentation only.
-->

# Playback Controls Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract playback control state and handlers from `frontend/src/pages/Playback.jsx` into `usePlaybackControls` without changing playback route behavior.

**Architecture:** Keep `Playback.jsx` as the route shell and move fullscreen state, autoplay toggle state, autoplay notification state, seek warning state, and timeline-click seeking into a focused hook. The page keeps media lifecycle and transition logic, but consumes hook setters/clearers where those flows need to set or clear control notifications.

**Tech Stack:** React 18 hooks, React Testing Library `renderHook`, Vitest, localStorage, DOM Fullscreen API, HTMLMediaElement-compatible refs.

---

## File Structure

- Create: `frontend/src/hooks/playback/usePlaybackControls.js`
  - Owns playback control state and handlers.
  - Exposes `isFullscreen`, `seekWarning`, `autoPlayEnabled`, `autoPlayNotification`, setters/clearers, and UI callbacks.
- Create: `frontend/src/hooks/playback/usePlaybackControls.test.jsx`
  - Unit tests for autoplay persistence/notification, seek limiting, and fullscreen state.
- Modify: `frontend/src/pages/Playback.jsx`
  - Remove inline control state and handlers now owned by the hook.
  - Import and use `usePlaybackControls`.
  - Keep media lifecycle and camera/segment transition behavior unchanged.
- Modify: `frontend/src/.module_map.md`
  - Mention controls behavior in playback hook boundaries.
- Modify: `frontend/src/pages/.module_map.md`
  - Keep extraction target generic after controls are extracted.

---

### Task 1: Playback Controls Hook Tests

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackControls.test.jsx`

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/hooks/playback/usePlaybackControls.test.jsx`:

```jsx
/*
 * Purpose: Validate playback controls hook behavior outside Playback.jsx.
 * Caller: Frontend Vitest suite before extracting playback controls.
 * Deps: React Testing Library, usePlaybackControls hook, localStorage and fullscreen mocks.
 * MainFuncs: usePlaybackControls.
 * SideEffects: Mutates localStorage, fake fullscreen state, and in-memory video refs.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackControls } from './usePlaybackControls.js';

function buildRefs({
    currentTime = 0,
    requestFullscreen = vi.fn().mockResolvedValue(undefined),
} = {}) {
    return {
        videoRef: {
            current: {
                currentTime,
            },
        },
        containerRef: {
            current: {
                requestFullscreen,
            },
        },
        lastSeekTimeRef: {
            current: 0,
        },
        requestFullscreen,
    };
}

function setFullscreenElement(value) {
    Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value,
    });
}

describe('usePlaybackControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        localStorage.clear();
        setFullscreenElement(null);

        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reads autoplay default from localStorage and persists toggle value', () => {
        localStorage.setItem('playback-autoplay-enabled', 'false');
        const refs = buildRefs();

        const { result } = renderHook(() => usePlaybackControls(refs));

        expect(result.current.autoPlayEnabled).toBe(false);

        act(() => {
            result.current.handleAutoPlayToggle();
        });

        expect(result.current.autoPlayEnabled).toBe(true);
        expect(localStorage.getItem('playback-autoplay-enabled')).toBe('true');
        expect(result.current.autoPlayNotification).toEqual({
            type: 'enabled',
            message: 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis',
        });
    });

    it('clears autoplay notification after timeout and through callback', () => {
        const refs = buildRefs();
        const { result } = renderHook(() => usePlaybackControls(refs));

        act(() => {
            result.current.handleAutoPlayToggle();
        });

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.autoPlayNotification).toBe(null);

        act(() => {
            result.current.setAutoPlayNotification({ type: 'manual', message: 'Manual' });
        });
        act(() => {
            result.current.clearAutoPlayNotification();
        });

        expect(result.current.autoPlayNotification).toBe(null);
    });

    it('seeks directly when timeline target is within the allowed distance', () => {
        const refs = buildRefs({ currentTime: 10 });
        refs.lastSeekTimeRef.current = 10;
        const { result } = renderHook(() => usePlaybackControls({
            ...refs,
            maxSeekDistance: 180,
        }));

        act(() => {
            result.current.handleTimelineClick(120);
        });

        expect(refs.videoRef.current.currentTime).toBe(120);
        expect(refs.lastSeekTimeRef.current).toBe(120);
        expect(result.current.seekWarning).toBe(null);
    });

    it('clamps timeline target and sets seek warning when jump exceeds allowed distance', () => {
        const refs = buildRefs({ currentTime: 0 });
        refs.lastSeekTimeRef.current = 0;
        const { result } = renderHook(() => usePlaybackControls({
            ...refs,
            maxSeekDistance: 180,
        }));

        act(() => {
            result.current.handleTimelineClick(400);
        });

        expect(refs.videoRef.current.currentTime).toBe(180);
        expect(refs.lastSeekTimeRef.current).toBe(180);
        expect(result.current.seekWarning).toEqual({ type: 'limit' });

        act(() => {
            result.current.clearSeekWarning();
        });

        expect(result.current.seekWarning).toBe(null);
    });

    it('tracks fullscreen state and toggles fullscreen API', async () => {
        const refs = buildRefs();
        const { result } = renderHook(() => usePlaybackControls(refs));

        await act(async () => {
            await result.current.toggleFullscreen();
        });

        expect(refs.requestFullscreen).toHaveBeenCalled();

        act(() => {
            setFullscreenElement(refs.containerRef.current);
            document.dispatchEvent(new Event('fullscreenchange'));
        });

        expect(result.current.isFullscreen).toBe(true);

        await act(async () => {
            await result.current.toggleFullscreen();
        });

        expect(document.exitFullscreen).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx
```

Expected: FAIL because `usePlaybackControls.js` does not exist.

---

### Task 2: Playback Controls Hook Implementation

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackControls.js`

- [ ] **Step 1: Implement the hook**

Create `frontend/src/hooks/playback/usePlaybackControls.js`:

```javascript
/*
 * Purpose: Manage playback control state and handlers outside Playback.jsx.
 * Caller: Playback route and playback controls hook tests.
 * Deps: React hooks, localStorage, Fullscreen API, and HTMLMediaElement-compatible refs.
 * MainFuncs: usePlaybackControls.
 * SideEffects: Reads/writes localStorage, mutates video currentTime, calls fullscreen APIs, manages timers/listeners.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_SEEK_DISTANCE = 180;
const AUTOPLAY_STORAGE_KEY = 'playback-autoplay-enabled';
const AUTOPLAY_NOTIFICATION_TIMEOUT_MS = 3000;

function readInitialAutoPlayEnabled() {
    const saved = localStorage.getItem(AUTOPLAY_STORAGE_KEY);
    return saved !== null ? saved === 'true' : true;
}

export function usePlaybackControls({
    videoRef,
    containerRef,
    lastSeekTimeRef,
    maxSeekDistance = DEFAULT_MAX_SEEK_DISTANCE,
}) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [seekWarning, setSeekWarning] = useState(null);
    const [autoPlayNotification, setAutoPlayNotification] = useState(null);
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(readInitialAutoPlayEnabled);
    const autoPlayNotificationTimeoutRef = useRef(null);

    const clearAutoPlayNotification = useCallback(() => {
        if (autoPlayNotificationTimeoutRef.current) {
            clearTimeout(autoPlayNotificationTimeoutRef.current);
            autoPlayNotificationTimeoutRef.current = null;
        }
        setAutoPlayNotification(null);
    }, []);

    const showAutoPlayNotification = useCallback((notification, timeoutMs = AUTOPLAY_NOTIFICATION_TIMEOUT_MS) => {
        if (autoPlayNotificationTimeoutRef.current) {
            clearTimeout(autoPlayNotificationTimeoutRef.current);
        }

        setAutoPlayNotification(notification);
        autoPlayNotificationTimeoutRef.current = setTimeout(() => {
            setAutoPlayNotification(null);
            autoPlayNotificationTimeoutRef.current = null;
        }, timeoutMs);
    }, []);

    const clearSeekWarning = useCallback(() => {
        setSeekWarning(null);
    }, []);

    const handleAutoPlayToggle = useCallback(() => {
        const newValue = !autoPlayEnabled;
        setAutoPlayEnabled(newValue);
        localStorage.setItem(AUTOPLAY_STORAGE_KEY, String(newValue));

        showAutoPlayNotification({
            type: newValue ? 'enabled' : 'disabled',
            message: newValue
                ? 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis'
                : 'Auto-play dinonaktifkan - video akan berhenti di akhir segment',
        });
    }, [autoPlayEnabled, showAutoPlayNotification]);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (!document.fullscreenElement) {
                await containerRef.current?.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    }, [containerRef]);

    const handleTimelineClick = useCallback((targetTime) => {
        if (!videoRef.current) return;

        const currentPos = videoRef.current.currentTime;
        const seekDistance = Math.abs(targetTime - currentPos);

        if (seekDistance > maxSeekDistance) {
            const direction = targetTime > currentPos ? 1 : -1;
            const limitedTarget = currentPos + (maxSeekDistance * direction);
            videoRef.current.currentTime = limitedTarget;
            lastSeekTimeRef.current = limitedTarget;
            setSeekWarning({ type: 'limit' });
        } else {
            videoRef.current.currentTime = targetTime;
            lastSeekTimeRef.current = targetTime;
        }
    }, [lastSeekTimeRef, maxSeekDistance, videoRef]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        return () => {
            if (autoPlayNotificationTimeoutRef.current) {
                clearTimeout(autoPlayNotificationTimeoutRef.current);
            }
        };
    }, []);

    return {
        isFullscreen,
        seekWarning,
        autoPlayEnabled,
        autoPlayNotification,
        setAutoPlayNotification,
        setSeekWarning,
        clearAutoPlayNotification,
        clearSeekWarning,
        handleAutoPlayToggle,
        toggleFullscreen,
        handleTimelineClick,
    };
}
```

- [ ] **Step 2: Run the hook tests and verify GREEN**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx
```

Expected: PASS with 5 tests.

- [ ] **Step 3: Commit the hook implementation**

Run:

```bash
git add frontend/src/hooks/playback/usePlaybackControls.js frontend/src/hooks/playback/usePlaybackControls.test.jsx
git commit -m "Refactor: extract playback controls hook"
git push
```

Expected: commit succeeds and branch pushes.

---

### Task 3: Wire Hook Into Playback Route

**Files:**
- Modify: `frontend/src/pages/Playback.jsx`

- [ ] **Step 1: Import the hook**

In `frontend/src/pages/Playback.jsx`, add:

```javascript
import { usePlaybackControls } from '../hooks/playback/usePlaybackControls.js';
```

- [ ] **Step 2: Replace page control state**

Remove these states from `Playback.jsx`:

```javascript
const [isFullscreen, setIsFullscreen] = useState(false);
const [seekWarning, setSeekWarning] = useState(null);
const [autoPlayNotification, setAutoPlayNotification] = useState(null);
const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
    const saved = localStorage.getItem('playback-autoplay-enabled');
    return saved !== null ? saved === 'true' : true;
});
```

Add this hook call after refs are declared:

```javascript
const {
    isFullscreen,
    seekWarning,
    autoPlayEnabled,
    autoPlayNotification,
    setAutoPlayNotification,
    setSeekWarning,
    clearAutoPlayNotification,
    clearSeekWarning,
    handleAutoPlayToggle,
    toggleFullscreen,
    handleTimelineClick,
} = usePlaybackControls({
    videoRef,
    containerRef,
    lastSeekTimeRef,
    maxSeekDistance: MAX_SEEK_DISTANCE,
});
```

- [ ] **Step 3: Remove inline control handlers**

Delete these inline blocks from `Playback.jsx`:

```javascript
const handleAutoPlayToggle = useCallback(() => {
    const newValue = !autoPlayEnabled;
    setAutoPlayEnabled(newValue);
    localStorage.setItem('playback-autoplay-enabled', String(newValue));

    setAutoPlayNotification({
        type: newValue ? 'enabled' : 'disabled',
        message: newValue
            ? 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis'
            : 'Auto-play dinonaktifkan - video akan berhenti di akhir segment'
    });

    setTimeout(() => {
        setAutoPlayNotification(null);
    }, 3000);
}, [autoPlayEnabled]);
```

Delete:

```javascript
useEffect(() => {
    const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
}, []);

const toggleFullscreen = async () => {
    try {
        if (!document.fullscreenElement) {
            await containerRef.current?.requestFullscreen?.();
        } else {
            await document.exitFullscreen?.();
        }
    } catch (err) {
        console.error('Fullscreen error:', err);
    }
};

const handleTimelineClick = (targetTime) => {
    if (!videoRef.current) return;

    const currentPos = videoRef.current.currentTime;
    const seekDistance = Math.abs(targetTime - currentPos);

    if (seekDistance > MAX_SEEK_DISTANCE) {
        const direction = targetTime > currentPos ? 1 : -1;
        const limitedTarget = currentPos + (MAX_SEEK_DISTANCE * direction);
        videoRef.current.currentTime = limitedTarget;
        lastSeekTimeRef.current = limitedTarget;
        setSeekWarning({ type: 'limit' });
    } else {
        videoRef.current.currentTime = targetTime;
        lastSeekTimeRef.current = targetTime;
    }
};
```

- [ ] **Step 4: Update existing control clear call sites**

Replace:

```jsx
onAutoPlayNotificationClose={() => setAutoPlayNotification(null)}
onSeekWarningClose={() => setSeekWarning(null)}
```

with:

```jsx
onAutoPlayNotificationClose={clearAutoPlayNotification}
onSeekWarningClose={clearSeekWarning}
```

Keep existing `setAutoPlayNotification(...)` calls in media lifecycle code unchanged because the hook returns the setter for this purpose.

Keep existing `setSeekWarning(...)` calls in media lifecycle and reset/segment-transition code unchanged unless it is more local to replace `setSeekWarning(null)` with `clearSeekWarning()`.

- [ ] **Step 5: Run focused route tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx Playback.test.jsx
```

Expected: PASS. Existing seeking, autoplay notification, and fullscreen-related route behavior should remain stable.

- [ ] **Step 6: Commit Playback wiring**

Run:

```bash
git add frontend/src/pages/Playback.jsx frontend/src/hooks/playback/usePlaybackControls.js frontend/src/hooks/playback/usePlaybackControls.test.jsx
git commit -m "Refactor: wire playback controls hook"
git push
```

Expected: commit succeeds and branch pushes.

---

### Task 4: Documentation And Final Gate

**Files:**
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`
- Modify: `docs/superpowers/plans/2026-05-02-playback-controls-hook.md`

- [ ] **Step 1: Update frontend module map**

In `frontend/src/.module_map.md`, update the playback stabilization target:

```markdown
- `pages/Playback.jsx`: route shell should delegate URL state to `utils/playbackUrlState.js`, segment loading, viewer/media lifecycle, share/snapshot behavior, and playback controls to `hooks/playback/*`; keep future playback features in these boundaries.
```

- [ ] **Step 2: Update pages module map**

In `frontend/src/pages/.module_map.md`, update the `Playback.jsx` public page line:

```markdown
- `Playback.jsx`: shared public/admin playback route shell. Public scope is `public_preview`; admin scope is `admin_full`; URL state, segment loading, media/viewer lifecycle, share/snapshot behavior, and controls live in `../utils/playbackUrlState.js` and `../hooks/playback/*`.
```

- [ ] **Step 3: Run final frontend gate**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx Playback.test.jsx
npm run build
```

Expected:
- Hook and page tests pass.
- Build exits 0.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only intended map and plan files are modified.

- [ ] **Step 5: Commit docs and map updates**

Run:

```bash
git add frontend/src/.module_map.md frontend/src/pages/.module_map.md docs/superpowers/plans/2026-05-02-playback-controls-hook.md
git commit -m "Add: document playback controls extraction"
git push
```

Expected: commit succeeds and branch pushes.

---

## Final Verification

Run from repo root after all commits:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx Playback.test.jsx
npm run build
cd ..
git status --short --branch
```

Expected:
- Focused tests pass.
- Frontend build exits 0.
- Branch tracks `origin/codex/playback-lifecycle-hardening`.
- Worktree is clean.

## Rollback Plan

Each task is committed separately. If route integration regresses behavior, revert only the Playback wiring commit and keep the hook test/implementation commit if isolated hook tests remain green.
