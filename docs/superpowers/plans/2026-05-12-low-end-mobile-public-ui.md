<!--
Purpose: Implementation plan for safe low-end Android public UI optimizations.
Caller: Agents implementing public landing performance improvements after baseline verification.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/components/landing/.module_map.md, existing public landing tests.
MainFuncs: Documents low-risk task sequence, exact files, test-first checks, and verification gates.
SideEffects: None; documentation only.
-->

# Low-End Mobile Public UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public landing page lighter on small-RAM Android devices without changing map, playback, popup stream, API, ad script, or route behavior.

**Architecture:** Keep the first pass limited to pure helpers, thumbnail lifecycle, simple-mode counters, and optional floating-widget scheduling. Every change is isolated behind existing device-tier signals or preserves existing output, with focused tests proving the old behavior remains intact for normal devices.

**Tech Stack:** React 18, Vite 5, Vitest, Testing Library, Tailwind CSS.

---

## Safety Baseline

Before this plan was written, the current targeted baseline was verified with:

```bash
cd frontend
npm test -- CameraThumbnail.test.jsx LandingPageSimple.test.jsx LandingPage.test.jsx LandingResultsGrid.test.jsx LandingSmartFeed.test.jsx LandingDiscoveryStrip.test.jsx
```

Observed result: `6 passed`, `32 tests passed`. Existing `act(...)` and React Router future warnings may appear; they are not failures and are not introduced by this plan.

---

## File Structure

- Modify: `frontend/src/utils/publicLandingSections.js`
  - Responsibility: Public landing list/window sizing helpers.
  - Change: Lower low-end/mobile priority thumbnail count from `4` to `2`; keep render window unchanged.
- Modify: `frontend/src/components/CameraThumbnail.jsx`
  - Responsibility: Thumbnail image/fallback lifecycle.
  - Change: Reset `error` state when `thumbnailPath` changes.
- Modify: `frontend/src/hooks/public/landingScheduledContent.js`
  - Responsibility: Pure landing scheduled-content normalization.
  - Change: Export `hasLandingScheduleWindow(settings)` to identify when periodic schedule rechecks are useful.
- Modify: `frontend/src/hooks/public/useLandingPublicConfig.js`
  - Responsibility: Public landing config fetch and scheduled-content recheck.
  - Change: Run the 30-second recheck interval only when a scheduled start/end exists.
- Create: `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.js`
  - Responsibility: Low-end-only delayed mount decision for optional floating widgets.
  - Change: On low-end devices, defer optional floating widgets until idle or a timeout fallback; render immediately on normal/high devices.
- Modify: `frontend/src/pages/LandingPage.jsx`
  - Responsibility: Public landing full/simple shell.
  - Change: Use deferred floating-widget gate for full mode; pass `deviceTier` to simple mode.
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx`
  - Responsibility: Simple public landing shell.
  - Change: Use deferred floating-widget gate and single-pass status counts.
- Tests:
  - Modify: `frontend/src/components/landing/LandingResultsGrid.test.jsx`
  - Modify: `frontend/src/components/CameraThumbnail.test.jsx`
  - Create: `frontend/src/hooks/public/landingScheduledContent.test.js`
  - Create: `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.test.js`
  - Modify: `frontend/src/components/landing/LandingPageSimple.test.jsx`
  - Modify: `frontend/src/pages/LandingPage.test.jsx`

Out of scope:

- `frontend/src/components/MapView.jsx`
- playback/video session lifecycle
- `VideoPopup`
- public API payload shape
- service worker caching
- third-party ad script timing
- desktop/laptop-specific optimizations

---

### Task 1: Low-End Thumbnail Priority Window

**Files:**
- Modify: `frontend/src/utils/publicLandingSections.js`
- Modify: `frontend/src/components/landing/LandingResultsGrid.test.jsx`

- [ ] **Step 1: Write the failing expectation**

In `frontend/src/components/landing/LandingResultsGrid.test.jsx`, change the mobile/low-end expectation from `priorityThumbnailCount: 4` to `priorityThumbnailCount: 2`:

```jsx
expect(getAdaptiveGridWindow({ isMobile: true, tier: 'medium' })).toEqual({
    initialVisibleCount: 12,
    loadMoreCount: 12,
    priorityThumbnailCount: 2,
});
expect(getAdaptiveGridWindow({ isMobile: false, tier: 'low' })).toEqual({
    initialVisibleCount: 12,
    loadMoreCount: 12,
    priorityThumbnailCount: 2,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- LandingResultsGrid.test.jsx
```

Expected: FAIL showing expected `2` but received `4` for low-end/mobile `priorityThumbnailCount`.

- [ ] **Step 3: Implement the minimal helper change**

In `frontend/src/utils/publicLandingSections.js`, change only the compact window:

```js
const COMPACT_GRID_WINDOW = {
    initialVisibleCount: 12,
    loadMoreCount: 12,
    priorityThumbnailCount: 2,
};
```

Do not change `initialVisibleCount`, `loadMoreCount`, or `DEFAULT_GRID_WINDOW`.

- [ ] **Step 4: Run focused test**

Run:

```bash
cd frontend
npm test -- LandingResultsGrid.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/utils/publicLandingSections.js frontend/src/components/landing/LandingResultsGrid.test.jsx
git commit -m "Refactor: reduce low-end thumbnail priority"
git push origin main
```

---

### Task 2: Thumbnail Error Reset On URL Change

**Files:**
- Modify: `frontend/src/components/CameraThumbnail.jsx`
- Modify: `frontend/src/components/CameraThumbnail.test.jsx`

- [ ] **Step 1: Write the failing regression test**

In `frontend/src/components/CameraThumbnail.test.jsx`, add:

```jsx
it('retries image rendering when thumbnail path changes after an error', () => {
    const { rerender, container } = render(
        <CameraThumbnail
            thumbnailPath="/api/thumbnails/failed.jpg"
            cameraName="Retry Camera"
        />
    );

    const firstImage = container.querySelector('img');
    fireEvent.error(firstImage);

    expect(container.querySelector('img')).toBeNull();

    rerender(
        <CameraThumbnail
            thumbnailPath="/api/thumbnails/recovered.jpg"
            cameraName="Retry Camera"
        />
    );

    const recoveredImage = container.querySelector('img');
    expect(recoveredImage).toBeTruthy();
    expect(recoveredImage.getAttribute('src')).toBe('/api/thumbnails/recovered.jpg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- CameraThumbnail.test.jsx
```

Expected: FAIL because `error` remains true after `thumbnailPath` changes.

- [ ] **Step 3: Reset error state when path changes**

In `frontend/src/components/CameraThumbnail.jsx`, add this effect after `imageRef` is declared:

```jsx
useEffect(() => {
    setError(false);
}, [thumbnailPath]);
```

Keep the existing `fetchpriority` effect unchanged.

- [ ] **Step 4: Run focused test**

Run:

```bash
cd frontend
npm test -- CameraThumbnail.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/components/CameraThumbnail.jsx frontend/src/components/CameraThumbnail.test.jsx
git commit -m "Fix: retry changed camera thumbnails"
git push origin main
```

---

### Task 3: Scheduled Config Timer Gating

**Files:**
- Modify: `frontend/src/hooks/public/landingScheduledContent.js`
- Modify: `frontend/src/hooks/public/useLandingPublicConfig.js`
- Create: `frontend/src/hooks/public/landingScheduledContent.test.js`

- [ ] **Step 1: Add pure helper tests**

Create `frontend/src/hooks/public/landingScheduledContent.test.js`:

```js
/*
 * Purpose: Verify landing scheduled-content timer gating helpers.
 * Caller: Frontend focused public config test gate.
 * Deps: Vitest and landingScheduledContent pure helpers.
 * MainFuncs: hasLandingScheduleWindow tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { hasLandingScheduleWindow } from './landingScheduledContent';

describe('hasLandingScheduleWindow', () => {
    it('returns false when enabled content has no start or end window', () => {
        expect(hasLandingScheduleWindow({
            eventBanner: {
                enabled: true,
                text: 'Always visible',
                start_at: '',
                end_at: '',
            },
            announcement: {
                enabled: false,
                text: '',
                start_at: '',
                end_at: '',
            },
        })).toBe(false);
    });

    it('returns true when event banner has a future start time', () => {
        expect(hasLandingScheduleWindow({
            eventBanner: {
                enabled: true,
                text: 'Scheduled',
                start_at: '2026-05-12T10:00:00+07:00',
                end_at: '',
            },
        })).toBe(true);
    });

    it('returns true when announcement has an end time', () => {
        expect(hasLandingScheduleWindow({
            announcement: {
                enabled: true,
                text: 'Ends later',
                start_at: '',
                end_at: '2026-05-12T12:00:00+07:00',
            },
        })).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- landingScheduledContent.test.js
```

Expected: FAIL because `hasLandingScheduleWindow` is not exported.

- [ ] **Step 3: Implement pure helper**

In `frontend/src/hooks/public/landingScheduledContent.js`, add:

```js
export function hasLandingScheduleWindow(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    return [source.eventBanner, source.announcement].some((content) => {
        if (!content || typeof content !== 'object' || content.enabled !== true) {
            return false;
        }

        return Boolean(normalizeScheduleValue(content.start_at) || normalizeScheduleValue(content.end_at));
    });
}
```

Use existing `normalizeScheduleValue`; do not duplicate schedule parsing.

- [ ] **Step 4: Gate interval in public config hook**

In `frontend/src/hooks/public/useLandingPublicConfig.js`, update imports:

```js
import {
    DEFAULT_LANDING_SETTINGS,
    LANDING_SCHEDULE_RECHECK_MS,
    hasLandingScheduleWindow,
    normalizeLandingSettings,
} from './landingScheduledContent';
```

Add:

```js
const shouldRecheckSchedule = useMemo(() => (
    hasLandingScheduleWindow(rawLandingSettings)
), [rawLandingSettings]);
```

Replace the schedule interval effect with:

```js
useEffect(() => {
    if (!shouldRecheckSchedule) {
        return undefined;
    }

    const intervalId = window.setInterval(() => {
        setScheduleNow(Date.now());
    }, LANDING_SCHEDULE_RECHECK_MS);

    return () => {
        window.clearInterval(intervalId);
    };
}, [shouldRecheckSchedule]);
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd frontend
npm test -- landingScheduledContent.test.js LandingPage.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add frontend/src/hooks/public/landingScheduledContent.js frontend/src/hooks/public/useLandingPublicConfig.js frontend/src/hooks/public/landingScheduledContent.test.js
git commit -m "Refactor: gate public schedule rechecks"
git push origin main
```

---

### Task 4: Low-End Floating Widget Deferral

**Files:**
- Create: `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.js`
- Create: `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.test.js`
- Modify: `frontend/src/pages/LandingPage.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.test.jsx`
- Modify: `frontend/src/pages/LandingPage.test.jsx`

- [ ] **Step 1: Write hook tests**

Create `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.test.js`:

```js
/*
 * Purpose: Verify low-end deferred rendering gate for optional public floating widgets.
 * Caller: Frontend focused public landing performance test gate.
 * Deps: React createElement, Testing Library, Vitest, useDeferredPublicFloatingWidgets.
 * MainFuncs: Deferred widget hook tests.
 * SideEffects: Uses fake timers and window idle callback stubs in jsdom.
 */

import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeferredPublicFloatingWidgets } from './useDeferredPublicFloatingWidgets';

function Probe(props) {
    const shouldRender = useDeferredPublicFloatingWidgets(props);
    return createElement('div', { 'data-testid': 'value' }, shouldRender ? 'render' : 'defer');
}

describe('useDeferredPublicFloatingWidgets', () => {
    afterEach(() => {
        vi.useRealTimers();
        delete window.requestIdleCallback;
        delete window.cancelIdleCallback;
    });

    it('renders immediately on non-low-end devices', () => {
        render(createElement(Probe, { enabled: true, deviceTier: 'medium' }));
        expect(screen.getByTestId('value').textContent).toBe('render');
    });

    it('stays hidden when disabled', () => {
        render(createElement(Probe, { enabled: false, deviceTier: 'low' }));
        expect(screen.getByTestId('value').textContent).toBe('defer');
    });

    it('defers on low-end devices until timeout fallback', () => {
        vi.useFakeTimers();

        render(createElement(Probe, { enabled: true, deviceTier: 'low', delayMs: 1000 }));

        expect(screen.getByTestId('value').textContent).toBe('defer');
        vi.advanceTimersByTime(1000);
        expect(screen.getByTestId('value').textContent).toBe('render');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- useDeferredPublicFloatingWidgets.test.js
```

Expected: FAIL because the hook file does not exist.

- [ ] **Step 3: Create the hook**

Create `frontend/src/hooks/public/useDeferredPublicFloatingWidgets.js`:

```js
/*
 * Purpose: Delay optional public floating widgets on low-end devices until idle or timeout fallback.
 * Caller: LandingPage and LandingPageSimple public shells.
 * Deps: React effects/state and browser idle callback when available.
 * MainFuncs: useDeferredPublicFloatingWidgets.
 * SideEffects: Schedules and cleans idle callback or timeout for low-end widget mounting.
 */

import { useEffect, useState } from 'react';

export function useDeferredPublicFloatingWidgets({
    enabled = true,
    deviceTier = 'medium',
    delayMs = 1200,
} = {}) {
    const [shouldRender, setShouldRender] = useState(() => enabled && deviceTier !== 'low');

    useEffect(() => {
        if (!enabled) {
            setShouldRender(false);
            return undefined;
        }

        if (deviceTier !== 'low') {
            setShouldRender(true);
            return undefined;
        }

        setShouldRender(false);

        if (typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(() => {
                setShouldRender(true);
            }, { timeout: delayMs });

            return () => {
                window.cancelIdleCallback?.(idleId);
            };
        }

        const timeoutId = window.setTimeout(() => {
            setShouldRender(true);
        }, delayMs);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [delayMs, deviceTier, enabled]);

    return shouldRender;
}

export default useDeferredPublicFloatingWidgets;
```

- [ ] **Step 4: Wire full landing mode**

In `frontend/src/pages/LandingPage.jsx`, import:

```js
import { useDeferredPublicFloatingWidgets } from '../hooks/public/useDeferredPublicFloatingWidgets';
```

After `shouldHideFloatingWidgets` is computed, add:

```js
const shouldRenderFloatingWidgets = useDeferredPublicFloatingWidgets({
    enabled: !shouldHideFloatingWidgets,
    deviceTier,
});
```

Replace:

```jsx
{!shouldHideFloatingWidgets && (
```

with:

```jsx
{shouldRenderFloatingWidgets && (
```

When rendering `LandingPageSimple`, pass:

```jsx
deviceTier={deviceTier}
```

- [ ] **Step 5: Wire simple landing mode**

In `frontend/src/components/landing/LandingPageSimple.jsx`, import:

```js
import { useDeferredPublicFloatingWidgets } from '../../hooks/public/useDeferredPublicFloatingWidgets';
```

Add prop:

```js
deviceTier = 'medium',
```

Then add before return:

```js
const shouldRenderFloatingWidgets = useDeferredPublicFloatingWidgets({
    enabled: !hideFloatingWidgets,
    deviceTier,
});
```

Replace:

```jsx
{!hideFloatingWidgets && (
```

with:

```jsx
{shouldRenderFloatingWidgets && (
```

- [ ] **Step 6: Add component integration tests**

In `frontend/src/components/landing/LandingPageSimple.test.jsx`, add:

```jsx
it('menunda floating widgets pada device low-end sampai fallback timer', async () => {
    vi.useFakeTimers();
    const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

    renderWithRouter(
        <LandingPageSimple
            onCameraClick={vi.fn()}
            onAddMulti={vi.fn()}
            multiCameras={[]}
            saweriaEnabled={false}
            saweriaLink=""
            CamerasSection={CamerasSection}
            layoutMode="simple"
            onLayoutToggle={vi.fn()}
            favorites={[]}
            onToggleFavorite={vi.fn()}
            isFavorite={vi.fn(() => false)}
            viewMode="grid"
            setViewMode={vi.fn()}
            adsConfig={null}
            deviceTier="low"
        />
    );

    expect(screen.queryByText('feedback-widget')).toBeNull();

    vi.advanceTimersByTime(1200);

    expect(await screen.findByText('feedback-widget')).toBeTruthy();
    vi.useRealTimers();
});
```

In `frontend/src/pages/LandingPage.test.jsx`, add a focused assertion to an existing low-end test:

```jsx
expect(landingPageSimplePropsSpy).toHaveBeenCalledWith(expect.objectContaining({
    deviceTier: 'low',
}));
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd frontend
npm test -- useDeferredPublicFloatingWidgets.test.js LandingPageSimple.test.jsx LandingPage.test.jsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git status --short
git add frontend/src/hooks/public/useDeferredPublicFloatingWidgets.js frontend/src/hooks/public/useDeferredPublicFloatingWidgets.test.js frontend/src/pages/LandingPage.jsx frontend/src/components/landing/LandingPageSimple.jsx frontend/src/components/landing/LandingPageSimple.test.jsx frontend/src/pages/LandingPage.test.jsx
git commit -m "Refactor: defer low-end public widgets"
git push origin main
```

---

### Task 5: Simple Mode Status Single-Pass Count

**Files:**
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.test.jsx`

- [ ] **Step 1: Strengthen existing status test**

In `frontend/src/components/landing/LandingPageSimple.test.jsx`, keep the current expected values:

```jsx
expect(screen.getByText('Online')).toBeTruthy();
expect(screen.getByText('Offline')).toBeTruthy();
expect(screen.getByText('Total')).toBeTruthy();
expect(screen.getByText('2')).toBeTruthy();
expect(screen.getByText('1')).toBeTruthy();
expect(screen.getByText('3')).toBeTruthy();
```

This test already protects output and should remain unchanged.

- [ ] **Step 2: Run test before refactor**

Run:

```bash
cd frontend
npm test -- LandingPageSimple.test.jsx
```

Expected: PASS before production refactor.

- [ ] **Step 3: Refactor status count to one pass**

In `frontend/src/components/landing/LandingPageSimple.jsx`, replace:

```js
const onlineCount = cameras.filter((camera) => camera?.is_online === 1 || camera?.is_online === true).length;
const offlineCount = Math.max(cameras.length - onlineCount, 0);
```

with:

```js
const statusCounts = cameras.reduce((counts, camera) => {
    if (camera?.is_online === 1 || camera?.is_online === true) {
        counts.online += 1;
    }
    return counts;
}, { online: 0 });
const onlineCount = statusCounts.online;
const offlineCount = Math.max(cameras.length - onlineCount, 0);
```

- [ ] **Step 4: Run focused test**

Run:

```bash
cd frontend
npm test -- LandingPageSimple.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/components/landing/LandingPageSimple.jsx frontend/src/components/landing/LandingPageSimple.test.jsx
git commit -m "Refactor: optimize simple status counts"
git push origin main
```

---

### Task 6: Final Low-End Regression Gate

**Files:**
- Verify only unless a regression appears.

- [ ] **Step 1: Run focused public/low-end suite**

Run:

```bash
cd frontend
npm test -- CameraThumbnail.test.jsx LandingPageSimple.test.jsx LandingPage.test.jsx LandingResultsGrid.test.jsx LandingSmartFeed.test.jsx LandingDiscoveryStrip.test.jsx landingScheduledContent.test.js useDeferredPublicFloatingWidgets.test.js
```

Expected: all tests PASS.

- [ ] **Step 2: Run broader public landing shell suite**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx LandingNavbar.test.jsx LandingMobileDock.test.jsx LandingDiscoveryStrip.test.jsx LandingQuickAccessStrip.test.jsx LandingSmartFeed.test.jsx LandingResultsGrid.test.jsx LandingHero.test.jsx LandingCamerasSection.test.jsx LandingSearchBox.test.jsx LandingStatsBar.test.jsx useLandingCameraFilters.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Run build and lint**

Run:

```bash
cd frontend
npm run build
npm run lint
```

Expected: both PASS.

- [ ] **Step 4: Local low-end smoke check**

Run:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/?mode=simple&view=grid` and verify:

- Page renders without console errors.
- Search input appears.
- Camera workspace appears.
- On a low-end mocked/tested path, floating widgets are delayed but still appear after fallback.
- Grid first paint still shows cards; only first two low-end thumbnails are priority.

- [ ] **Step 5: Final commit check**

Run:

```bash
git status --short
git log -6 --oneline
git push origin main
```

Expected: clean working tree after all commits are pushed.

---

## Self-Review

- Spec coverage: Covers mobile Android small-RAM first pass by reducing eager thumbnails, avoiding stale thumbnail fallback, gating unnecessary scheduled timer renders, deferring optional floating widgets, and reducing simple-mode count work.
- Placeholder scan: No task contains placeholder markers, unspecified implementation, or vague test instructions.
- Type consistency: New exported helper is `hasLandingScheduleWindow`; new hook is `useDeferredPublicFloatingWidgets`; usage names match import/export snippets.
- Risk control: The plan avoids `MapView`, playback, popup streams, public API contracts, route params, and ad script timing. Each production behavior change has a focused test and a final public regression gate.
