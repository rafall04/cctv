<!--
Purpose: Implementation plan for extracting Playback.jsx share and snapshot behavior into a hook.
Caller: Agents executing the approved playback share/snapshot hook design.
Deps: docs/superpowers/specs/2026-05-02-playback-share-snapshot-hook-design.md, frontend/src/pages/Playback.jsx, frontend/src/hooks/playback.
MainFuncs: Defines TDD tasks, file edits, verification commands, and commit checkpoints.
SideEffects: None; documentation only.
-->

# Playback Share/Snapshot Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract playback share and snapshot behavior from `frontend/src/pages/Playback.jsx` into a focused `usePlaybackShareAndSnapshot` hook without behavior changes.

**Architecture:** Keep `Playback.jsx` as the route shell and move notification state plus share/snapshot callbacks into `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`. The hook receives route state and refs, derives share URLs through existing utilities, owns notification timers, and exposes stable callbacks back to the page.

**Tech Stack:** React 18 hooks, React Testing Library `renderHook`, Vitest, existing `buildPublicPlaybackShareUrl` and `createCameraSlug` utilities.

---

## File Structure

- Create: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`
  - Owns snapshot/share notification state and timers.
  - Exposes `snapshotNotification`, `clearSnapshotNotification`, `takeSnapshot`, and `handleShare`.
- Create: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`
  - Unit tests for notification behavior, admin no-op share, public copy fallback, and snapshot not-ready guard.
- Modify: `frontend/src/pages/Playback.jsx`
  - Remove inline `snapshotNotification` state, `takeSnapshot`, and `handleShare`.
  - Import and use `usePlaybackShareAndSnapshot`.
  - Keep UI props and share button behavior stable.
- Modify: `frontend/src/.module_map.md`
  - Mention share/snapshot hook in playback boundary if not already explicit.
- Modify: `frontend/src/pages/.module_map.md`
  - Remove `share/snapshot hook` from extraction targets after implementation.

---

### Task 1: Share/Snapshot Hook Tests

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`:

```jsx
/*
 * Purpose: Validate playback share and snapshot hook behavior outside Playback.jsx.
 * Caller: Frontend Vitest suite before extracting share/snapshot behavior.
 * Deps: React Testing Library, usePlaybackShareAndSnapshot hook, browser API mocks.
 * MainFuncs: usePlaybackShareAndSnapshot.
 * SideEffects: Mocks navigator share/clipboard and canvas APIs.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackShareAndSnapshot } from './usePlaybackShareAndSnapshot.js';

function buildHookProps(overrides = {}) {
    return {
        videoRef: {
            current: {
                paused: false,
                readyState: 4,
                currentTime: 12.4,
                videoWidth: 640,
                videoHeight: 360,
            },
        },
        branding: {
            logo_text: 'R',
            company_name: 'RAF NET',
        },
        selectedCamera: {
            id: 7,
            name: 'Lobby Camera',
        },
        selectedSegment: {
            start_time: '2026-05-02T10:00:00.000Z',
        },
        searchParams: new URLSearchParams('mode=simple&view=playback&cam=7-lobby-camera'),
        isAdminPlayback: false,
        ...overrides,
    };
}

describe('usePlaybackShareAndSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { origin: 'https://cctv.example.test' },
        });

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });

        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: undefined,
        });

        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: undefined,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows not-ready notification when snapshot video is unavailable', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps({
            videoRef: { current: null },
        })));

        await act(async () => {
            await result.current.takeSnapshot();
        });

        expect(result.current.snapshotNotification).toEqual({
            type: 'error',
            message: 'Video belum siap untuk snapshot',
        });

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.snapshotNotification).toBe(null);
    });

    it('copies public share URL with camera slug and precise timestamp', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps()));

        await act(async () => {
            await result.current.handleShare();
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'https://cctv.example.test/?mode=simple&view=playback&cam=7-lobby-camera&t=1777716012400'
        );
        expect(result.current.snapshotNotification).toEqual({
            type: 'success',
            message: 'Tautan disalin ke clipboard!',
        });
    });

    it('does not share admin playback links', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps({
            isAdminPlayback: true,
        })));

        await act(async () => {
            await result.current.handleShare();
        });

        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        expect(result.current.snapshotNotification).toBe(null);
    });

    it('clears notification through returned callback', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps()));

        await act(async () => {
            await result.current.handleShare();
        });

        act(() => {
            result.current.clearSnapshotNotification();
        });

        expect(result.current.snapshotNotification).toBe(null);
    });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx
```

Expected: FAIL because `usePlaybackShareAndSnapshot.js` does not exist.

---

### Task 2: Share/Snapshot Hook Implementation

**Files:**
- Create: `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`

- [ ] **Step 1: Implement the hook**

Create `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`:

```javascript
/*
 * Purpose: Manage playback share links, snapshots, and notification lifecycle outside Playback.jsx.
 * Caller: Playback route and share/snapshot hook tests.
 * Deps: React hooks, public share URL utility, camera slug utility, browser media/canvas/share APIs.
 * MainFuncs: usePlaybackShareAndSnapshot.
 * SideEffects: Reads video element state, draws canvas snapshots, invokes native share/clipboard/download APIs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCameraSlug } from '../../utils/slugify.js';
import { buildPublicPlaybackShareUrl } from '../../utils/publicShareUrl.js';

const NOTIFICATION_TIMEOUT_MS = 3000;
const LONG_NOTIFICATION_TIMEOUT_MS = 5000;

export function usePlaybackShareAndSnapshot({
    videoRef,
    branding,
    selectedCamera,
    selectedSegment,
    searchParams,
    isAdminPlayback,
}) {
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const notificationTimeoutRef = useRef(null);

    const clearSnapshotNotification = useCallback(() => {
        if (notificationTimeoutRef.current) {
            clearTimeout(notificationTimeoutRef.current);
            notificationTimeoutRef.current = null;
        }
        setSnapshotNotification(null);
    }, []);

    const showSnapshotNotification = useCallback((notification, timeoutMs = NOTIFICATION_TIMEOUT_MS) => {
        if (notificationTimeoutRef.current) {
            clearTimeout(notificationTimeoutRef.current);
        }

        setSnapshotNotification(notification);
        notificationTimeoutRef.current = setTimeout(() => {
            setSnapshotNotification(null);
            notificationTimeoutRef.current = null;
        }, timeoutMs);
    }, []);

    useEffect(() => {
        return () => {
            if (notificationTimeoutRef.current) {
                clearTimeout(notificationTimeoutRef.current);
            }
        };
    }, []);

    const takeSnapshot = useCallback(async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            showSnapshotNotification({ type: 'error', message: 'Video belum siap untuk snapshot' });
            return;
        }

        const cameraName = selectedCamera?.name || 'camera';

        try {
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const watermarkHeight = Math.max(40, canvas.height * 0.08);
            const padding = watermarkHeight * 0.3;
            const fontSize = watermarkHeight * 0.4;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(canvas.width - (watermarkHeight * 4) - padding, canvas.height - watermarkHeight - padding, watermarkHeight * 4, watermarkHeight);

            const logoSize = watermarkHeight * 0.6;
            const logoX = canvas.width - (watermarkHeight * 3.5) - padding;
            const logoY = canvas.height - (watermarkHeight / 2) - padding;

            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${logoSize * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding?.logo_text || 'R', logoX, logoY);

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding?.company_name || 'RAF NET', logoX + logoSize / 2 + padding / 2, logoY - fontSize / 3);

            ctx.font = `${fontSize * 0.7}px Arial`;
            ctx.fillStyle = '#94a3b8';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            ctx.fillText(timestamp, logoX + logoSize / 2 + padding / 2, logoY + fontSize / 2);

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showSnapshotNotification({ type: 'error', message: 'Gagal membuat snapshot' });
                    return;
                }

                const filename = `${cameraName}-${Date.now()}.png`;

                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: `Snapshot - ${cameraName}` });
                            showSnapshotNotification({ type: 'success', message: 'Snapshot berhasil dibagikan!' });
                            return;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') console.warn('Share failed:', err);
                    }
                }

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);

                showSnapshotNotification({ type: 'success', message: 'Snapshot berhasil diunduh!' });
            }, 'image/png', 0.95);
        } catch (error) {
            console.error('Snapshot error:', error);
            showSnapshotNotification({ type: 'error', message: 'Gagal mengambil snapshot' });
        }
    }, [branding, selectedCamera, showSnapshotNotification, videoRef]);

    const handleShare = useCallback(async () => {
        if (isAdminPlayback) {
            return;
        }

        let preciseTimestamp = null;
        if (selectedSegment?.start_time) {
            const baseTimeMs = new Date(selectedSegment.start_time).getTime();
            preciseTimestamp = baseTimeMs;

            if (videoRef.current && typeof videoRef.current.currentTime === 'number') {
                const currentSecsMs = Math.floor(videoRef.current.currentTime * 1000);
                preciseTimestamp += currentSecsMs;
            }
        }

        const shareUrl = buildPublicPlaybackShareUrl({
            searchParams,
            camera: selectedCamera?.id ? createCameraSlug(selectedCamera) : null,
            timestamp: preciseTimestamp,
        });

        const shareData = {
            title: `Playback - ${selectedCamera?.name || 'CCTV'}`,
            text: `Lihat rekaman dari kamera ${selectedCamera?.name || 'CCTV'}`,
            url: shareUrl,
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    await navigator.clipboard.writeText(shareUrl);
                    showSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                }
            }
        } else {
            try {
                await navigator.clipboard.writeText(shareUrl);
                showSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
            } catch (err) {
                showSnapshotNotification({ type: 'error', message: 'Gagal menyalin tautan' }, LONG_NOTIFICATION_TIMEOUT_MS);
            }
        }
    }, [isAdminPlayback, searchParams, selectedCamera, selectedSegment, showSnapshotNotification, videoRef]);

    return {
        snapshotNotification,
        clearSnapshotNotification,
        takeSnapshot,
        handleShare,
    };
}
```

- [ ] **Step 2: Run the hook tests and verify GREEN**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx
```

Expected: PASS with 4 tests.

- [ ] **Step 3: Commit the hook implementation**

Run:

```bash
git add frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx
git commit -m "Refactor: extract playback share snapshot hook"
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
import { usePlaybackShareAndSnapshot } from '../hooks/playback/usePlaybackShareAndSnapshot.js';
```

Remove this import after wiring because the hook owns public share URL creation:

```javascript
import { buildPublicPlaybackShareUrl } from '../utils/publicShareUrl';
```

Keep this import because `Playback.jsx` still uses camera slugs for playback URL state:

```javascript
import { createCameraSlug, parseCameraIdFromSlug } from '../utils/slugify';
```

- [ ] **Step 2: Replace page notification state**

Remove this state:

```javascript
const [snapshotNotification, setSnapshotNotification] = useState(null);
```

Add this hook call after `selectedCamera` and segment state are available:

```javascript
const {
    snapshotNotification,
    clearSnapshotNotification,
    takeSnapshot,
    handleShare,
} = usePlaybackShareAndSnapshot({
    videoRef,
    branding,
    selectedCamera,
    selectedSegment,
    searchParams,
    isAdminPlayback,
});
```

- [ ] **Step 3: Remove inline snapshot/share functions**

Delete the inline `takeSnapshot` function from `Playback.jsx`.

Delete the inline `handleShare` function from `Playback.jsx`.

Keep all existing call sites:

```jsx
onSnapshot={takeSnapshot}
onShare={isAdminPlayback ? null : handleShare}
```

Update the notification close prop:

```jsx
onSnapshotNotificationClose={clearSnapshotNotification}
```

- [ ] **Step 4: Run focused route tests**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx Playback.test.jsx src/utils/publicShareUrl.test.js
```

Expected: PASS. Existing `Playback.test.jsx` share assertions should still pass, including simple/full mode public share URLs.

- [ ] **Step 5: Commit Playback wiring**

Run:

```bash
git add frontend/src/pages/Playback.jsx frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx
git commit -m "Refactor: wire playback share snapshot hook"
git push
```

Expected: commit succeeds and branch pushes.

---

### Task 4: Documentation And Final Gate

**Files:**
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/pages/.module_map.md`
- Modify: `docs/superpowers/plans/2026-05-02-playback-share-snapshot-hook.md`

- [ ] **Step 1: Update frontend module map**

In `frontend/src/.module_map.md`, update the playback stabilization target to mention share/snapshot:

```markdown
- `pages/Playback.jsx`: route shell should delegate URL state to `utils/playbackUrlState.js`, segment loading, viewer/media lifecycle, and share/snapshot behavior to `hooks/playback/*`; keep future playback features in these boundaries.
```

- [ ] **Step 2: Update pages module map**

In `frontend/src/pages/.module_map.md`, replace the `Playback.jsx` extraction target:

```markdown
- `Playback.jsx`:
  - any future playback feature state that does not belong in `../hooks/playback/*`
```

- [ ] **Step 3: Run final frontend gate**

Run:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx Playback.test.jsx src/utils/publicShareUrl.test.js
npm run build
```

Expected:
- Hook, page, and URL tests pass.
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
git add frontend/src/.module_map.md frontend/src/pages/.module_map.md docs/superpowers/plans/2026-05-02-playback-share-snapshot-hook.md
git commit -m "Add: document playback share snapshot extraction"
git push
```

Expected: commit succeeds and branch pushes.

---

## Final Verification

Run from repo root after all commits:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx Playback.test.jsx src/utils/publicShareUrl.test.js
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

Each task is committed separately. If route integration regresses behavior, revert only the Playback wiring commit and keep the hook test/implementation commit if its isolated tests remain green.
