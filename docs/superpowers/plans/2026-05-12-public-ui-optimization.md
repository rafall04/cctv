<!--
Purpose: Implementation plan for safe public UI optimizations on the CCTV landing page.
Caller: Agents implementing public landing UI performance and search UX improvements.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/components/landing/.module_map.md, public landing tests.
MainFuncs: Documents task sequence, target files, exact checks, and verification gates.
SideEffects: None; documentation only.
-->

# Public UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize public landing UI search and list computations without changing stream, map, playback, popup, or backend behavior.

**Architecture:** Keep changes isolated to small public landing presentation/hooks. Add missing header docs where touched, preserve existing route/query contracts, and verify each optimization through focused component/hook tests before the full frontend gate.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Tailwind CSS.

---

## File Structure

- Modify: `frontend/src/components/landing/LandingSearchBox.jsx`
  - Responsibility: Search input presentation and keyboard/dropdown UX only.
  - Changes: Add header doc, add `useEffect`, wire `Ctrl/Cmd+K`, `Escape`, and outside click cleanup.
- Modify: `frontend/src/components/landing/LandingCamerasSection.jsx`
  - Responsibility: Camera workspace orchestration.
  - Changes: Pass `onCloseDropdown` to search box; keep render decisions unchanged.
- Modify: `frontend/src/hooks/public/useLandingCameraFilters.js`
  - Responsibility: Public search/filter/ranking state and derived lists.
  - Changes: Convert repeated `favorites.includes()` calls to one memoized `Set`; no result-order changes.
- Modify: `frontend/src/pages/LandingPage.jsx`
  - Responsibility: Public landing shell and lightweight derived data.
  - Changes: Convert favorite/recent lookups to memoized `Set`/`Map`; preserve popup and refresh-pause behavior.
- Modify: `frontend/src/components/landing/LandingStatsBar.jsx`
  - Responsibility: Public hero stats and stats modal data.
  - Changes: Add header doc; replace three camera passes with one reducer; preserve modal content.
- Test: `frontend/src/components/landing/LandingSearchBox.test.jsx`
  - Responsibility: Search keyboard and outside-click behavior.
- Test: existing public tests:
  - `frontend/src/components/landing/LandingCamerasSection.test.jsx`
  - `frontend/src/components/landing/LandingStatsBar.test.jsx`
  - `frontend/src/pages/LandingPage.test.jsx`
  - `frontend/src/hooks/public/useLandingCameraFilters.test.js`

Out of scope:
- `frontend/src/components/MapView.jsx`
- playback media lifecycle
- API requests
- stream resolution
- ad script behavior
- route/query semantics

---

### Task 1: Search Box Keyboard UX

**Files:**
- Modify: `frontend/src/components/landing/LandingSearchBox.jsx`
- Modify: `frontend/src/components/landing/LandingCamerasSection.jsx`
- Test: `frontend/src/components/landing/LandingSearchBox.test.jsx`
- Test: `frontend/src/components/landing/LandingCamerasSection.test.jsx`

- [ ] **Step 1: Write failing tests for search keyboard behavior**

Create `frontend/src/components/landing/LandingSearchBox.test.jsx` with:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingSearchBox from './LandingSearchBox';

function renderSearchBox(overrides = {}) {
    const searchInputRef = { current: null };
    const searchContainerRef = { current: null };
    const props = {
        searchQuery: '',
        onSearchChange: vi.fn(),
        onFocus: vi.fn(),
        onClear: vi.fn(),
        onCloseDropdown: vi.fn(),
        searchInputRef,
        searchContainerRef,
        showSearchDropdown: true,
        dropdownContent: <div data-testid="search-dropdown">Dropdown</div>,
        ...overrides,
    };

    render(<LandingSearchBox {...props} />);
    return props;
}

describe('LandingSearchBox', () => {
    it('focuses the search input when Ctrl+K is pressed', () => {
        renderSearchBox();
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        expect(document.activeElement).toBe(input);
    });

    it('focuses the search input when Meta+K is pressed', () => {
        renderSearchBox();
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');

        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        expect(document.activeElement).toBe(input);
    });

    it('clears search and closes dropdown when Escape is pressed', () => {
        const props = renderSearchBox({ searchQuery: 'kamera' });
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');
        input.focus();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(props.onClear).toHaveBeenCalledTimes(1);
        expect(props.onCloseDropdown).toHaveBeenCalledTimes(1);
    });

    it('closes dropdown when the user clicks outside the search container', () => {
        const props = renderSearchBox();

        fireEvent.mouseDown(document.body);

        expect(props.onCloseDropdown).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- LandingSearchBox.test.jsx
```

Expected: FAIL because `LandingSearchBox.test.jsx` does not exist yet or `LandingSearchBox` has no keyboard/outside-click behavior.

- [ ] **Step 3: Implement minimal search box behavior**

Edit `frontend/src/components/landing/LandingSearchBox.jsx` with a strict focused patch:

```jsx
/*
 * Purpose: Render public landing camera search input, dropdown, and keyboard shortcuts.
 * Caller: LandingCamerasSection.
 * Deps: React effect cleanup and landing UI icons.
 * MainFuncs: LandingSearchBox.
 * SideEffects: Focuses search input on Ctrl/Cmd+K and closes dropdown on Escape/outside click.
 */

import { useEffect } from 'react';
import { Icons } from '../ui/Icons';

export default function LandingSearchBox({
    searchQuery,
    onSearchChange,
    onFocus,
    onClear,
    onCloseDropdown,
    searchInputRef,
    searchContainerRef,
    showSearchDropdown,
    dropdownContent,
}) {
    useEffect(() => {
        const handleKeyDown = (event) => {
            const isSearchShortcut = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey);
            if (isSearchShortcut) {
                event.preventDefault();
                searchInputRef?.current?.focus();
                return;
            }

            if (event.key === 'Escape') {
                if (searchQuery) {
                    onClear?.();
                }
                onCloseDropdown?.();
            }
        };

        const handleMouseDown = (event) => {
            if (!showSearchDropdown) {
                return;
            }
            if (searchContainerRef?.current?.contains(event.target)) {
                return;
            }
            onCloseDropdown?.();
        };

        window.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [onClear, onCloseDropdown, searchContainerRef, searchInputRef, searchQuery, showSearchDropdown]);

    return (
        <div className="relative" ref={searchContainerRef}>
            <div className="relative flex items-center">
                <div className="absolute left-3 text-gray-400 dark:text-gray-500 pointer-events-none">
                    <Icons.Search />
                </div>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    onFocus={onFocus}
                    placeholder="Cari kamera berdasarkan nama, lokasi, atau area..."
                    className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-20 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 sm:pr-24 sm:text-base"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                    {searchQuery && (
                        <button
                            onClick={onClear}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Hapus pencarian (Esc)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                    <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 rounded">
                        <kbd className="font-sans">Ctrl</kbd>
                        <kbd className="font-sans">K</kbd>
                    </span>
                </div>
            </div>

            {showSearchDropdown && dropdownContent}
        </div>
    );
}
```

In `frontend/src/components/landing/LandingCamerasSection.jsx`, pass the close handler:

```jsx
searchProps={{
    searchQuery,
    onSearchChange: setSearchQuery,
    onFocus: () => searchQuery.trim() && setShowSearchDropdown(true),
    onClear: clearSearch,
    onCloseDropdown: () => setShowSearchDropdown(false),
    searchInputRef,
    searchContainerRef,
    showSearchDropdown,
    dropdownContent: searchDropdown,
}}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd frontend
npm test -- LandingSearchBox.test.jsx LandingCamerasSection.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/components/landing/LandingSearchBox.jsx frontend/src/components/landing/LandingCamerasSection.jsx frontend/src/components/landing/LandingSearchBox.test.jsx
git commit -m "Fix: improve public search keyboard controls"
git push
```

---

### Task 2: Favorite And Recent Lookup Memoization

**Files:**
- Modify: `frontend/src/pages/LandingPage.jsx`
- Test: `frontend/src/pages/LandingPage.test.jsx`

- [ ] **Step 1: Add assertions to existing landing tests**

In `frontend/src/pages/LandingPage.test.jsx`, add or extend a test so it verifies:

```jsx
expect(screen.getByTestId('landing-mobile-dock')).toBeInTheDocument();
expect(screen.getByLabelText(/Favorit/i)).toBeInTheDocument();
```

This guards the favorite/recent count surfaces after memoization. Use existing render helpers in the file.

- [ ] **Step 2: Run test to verify current behavior**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx
```

Expected: PASS before implementation because this task is a safe refactor. If it fails, fix the test setup before changing production code.

- [ ] **Step 3: Replace repeated linear lookups**

In `frontend/src/pages/LandingPage.jsx`, replace the favorite/recent derived data block with:

```jsx
const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
const cameraById = useMemo(() => new Map(cameras.map((camera) => [camera.id, camera])), [cameras]);
const favoriteCameras = useMemo(() => (
    cameras.filter((camera) => favoriteIds.has(camera.id)).slice(0, 5)
), [cameras, favoriteIds]);
const recentCameraItems = useMemo(() => (
    recentCameras
        .slice(0, 5)
        .map((recentCamera) => cameraById.get(recentCamera.id) || recentCamera)
), [cameraById, recentCameras]);
```

Do not change:

```jsx
const quickAccessCount = favoriteCameras.length + recentCameraItems.length;
const favoriteCount = favoriteCameras.length;
```

- [ ] **Step 4: Run focused landing tests**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx LandingMobileDock.test.jsx LandingQuickAccessStrip.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/pages/LandingPage.jsx frontend/src/pages/LandingPage.test.jsx
git commit -m "Refactor: memoize public landing camera lookups"
git push
```

---

### Task 3: Filter Hook Favorite Set

**Files:**
- Modify: `frontend/src/hooks/public/useLandingCameraFilters.js`
- Test: `frontend/src/hooks/public/useLandingCameraFilters.test.js`
- Test: `frontend/src/components/landing/LandingCamerasSection.test.jsx`

- [ ] **Step 1: Add filter stability test**

In `frontend/src/hooks/public/useLandingCameraFilters.test.js`, add or extend a test that verifies favorites filtering still returns the same camera ids in the same order:

```js
expect(result.current.filteredForGrid.map((camera) => camera.id)).toEqual([2, 4]);
```

Use the existing hook render pattern and set `favorites` to `[2, 4]`.

- [ ] **Step 2: Run hook test**

Run:

```bash
cd frontend
npm test -- useLandingCameraFilters.test.js
```

Expected: PASS before refactor or FAIL only if the new test setup is incorrect.

- [ ] **Step 3: Memoize favorite membership**

In `frontend/src/hooks/public/useLandingCameraFilters.js`, add:

```js
const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
```

Then replace:

```js
favorites.includes(camera.id)
```

with:

```js
favoriteIds.has(camera.id)
```

Update dependency arrays from `favorites` to `favoriteIds` where the callback/memo now reads `favoriteIds`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd frontend
npm test -- useLandingCameraFilters.test.js LandingCamerasSection.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/hooks/public/useLandingCameraFilters.js frontend/src/hooks/public/useLandingCameraFilters.test.js
git commit -m "Refactor: optimize public favorite filters"
git push
```

---

### Task 4: Stats Bar Single-Pass Classification

**Files:**
- Modify: `frontend/src/components/landing/LandingStatsBar.jsx`
- Test: `frontend/src/components/landing/LandingStatsBar.test.jsx`

- [ ] **Step 1: Extend stats test**

In `frontend/src/components/landing/LandingStatsBar.test.jsx`, verify counts and modal classification:

```jsx
expect(screen.getByText('Online')).toBeInTheDocument();
fireEvent.click(screen.getByText('Online'));
expect(screen.getByText('Kamera Online')).toBeInTheDocument();
expect(screen.getByText('Camera Online Name')).toBeInTheDocument();
```

Use the existing mocked camera names in the test file; if names differ, assert those exact existing names.

- [ ] **Step 2: Run test before refactor**

Run:

```bash
cd frontend
npm test -- LandingStatsBar.test.jsx
```

Expected: PASS before refactor.

- [ ] **Step 3: Add header doc and replace three filters with reducer**

At the top of `frontend/src/components/landing/LandingStatsBar.jsx`, add:

```jsx
/*
 * Purpose: Render public landing status counters and camera/area detail modals.
 * Caller: LandingHero and public landing status surfaces.
 * Deps: React state/effects/memo, CameraContext, camera availability helpers, landing UI icons.
 * MainFuncs: StatsBar, ListModal.
 * SideEffects: Locks body scroll while stats modal is open and handles Escape to close it.
 */
```

Replace the `stats` memo with:

```jsx
const stats = useMemo(() => {
    const initialStats = {
        online: 0,
        offline: 0,
        maintenance: 0,
        total: cameras.length,
        onlineList: [],
        offlineList: [],
        maintenanceList: [],
    };

    return cameras.reduce((nextStats, camera) => {
        if (camera.status === 'maintenance') {
            nextStats.maintenance += 1;
            nextStats.maintenanceList.push(camera);
            return nextStats;
        }

        if (getCameraAvailabilityState(camera) === 'offline') {
            nextStats.offline += 1;
            nextStats.offlineList.push(camera);
            return nextStats;
        }

        nextStats.online += 1;
        nextStats.onlineList.push(camera);
        return nextStats;
    }, initialStats);
}, [cameras]);
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd frontend
npm test -- LandingStatsBar.test.jsx LandingHero.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add frontend/src/components/landing/LandingStatsBar.jsx frontend/src/components/landing/LandingStatsBar.test.jsx
git commit -m "Refactor: optimize public stats classification"
git push
```

---

### Task 5: Full Public Landing Regression Gate

**Files:**
- Verify only unless a test exposes a regression.

- [ ] **Step 1: Run public landing test suite**

Run:

```bash
cd frontend
npm test -- LandingPage.test.jsx LandingNavbar.test.jsx LandingMobileDock.test.jsx LandingDiscoveryStrip.test.jsx LandingQuickAccessStrip.test.jsx LandingSmartFeed.test.jsx LandingResultsGrid.test.jsx LandingHero.test.jsx LandingCamerasSection.test.jsx LandingSearchBox.test.jsx LandingStatsBar.test.jsx useLandingCameraFilters.test.js
```

Expected: all tests PASS. Existing `act(...)` warnings in `LandingPage.test.jsx` may remain only if the pass/fail result is green.

- [ ] **Step 2: Run build and lint**

Run:

```bash
cd frontend
npm run build
npm run lint
```

Expected: both PASS.

- [ ] **Step 3: Manual browser smoke check**

Run:

```bash
cd frontend
npm run dev
```

Open the Vite URL and verify:

- `Ctrl+K` focuses public search.
- `Escape` clears search and closes dropdown.
- Clicking outside search closes dropdown.
- Grid cards still open popup.
- Map mode still loads and markers open popup.
- Mobile dock still switches `Home`, `Map`, `Grid`, `Favorit`, and `Playback`.
- Favorite count still appears.
- Stats modal opens and closes with Escape.

- [ ] **Step 4: Final status and push check**

Run:

```bash
git status --short
git log -4 --oneline
git push
```

Expected: clean working tree except unrelated user files; latest task commits already pushed.

---

## Self-Review

- Spec coverage: Covers search UX, favorite/recent lookup memoization, filter hook membership optimization, stats classification optimization, focused tests, build, lint, and browser smoke checks.
- Placeholder scan: No implementation step depends on undefined files, undefined helpers, or delayed decisions.
- Type consistency: Uses existing React component props and existing public landing file names. New prop `onCloseDropdown` is introduced in `LandingSearchBox` and passed from `LandingCamerasSection`.
- Risk control: Does not touch `MapView`, playback, stream resolver, API clients, backend, routing semantics, or ad loading logic.
