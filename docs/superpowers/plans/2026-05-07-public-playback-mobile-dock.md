# Public Playback Mobile Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom public playback quick-action card with the same mobile bottom dock used by public landing: Home, Map, Grid, Favorit, Playback.

**Architecture:** Reuse `LandingMobileDock.jsx` so public playback and public landing share one navigation UI. Public playback will pass route-aware handlers that move the browser to the public landing URLs instead of changing in-page landing state, and `Playback` remains active without resetting the current playback URL.

**Tech Stack:** React 18, React Router, Vite, Vitest, Tailwind CSS.

---

## File Structure

- Modify `frontend/src/components/landing/LandingMobileDock.jsx`: allow optional href-based navigation per item while preserving current callback behavior for `LandingPage`.
- Modify `frontend/src/components/landing/LandingMobileDock.test.jsx`: verify the dock can render link navigation for public playback.
- Delete `frontend/src/components/playback/PlaybackQuickActions.jsx`: remove the incorrect card-based quick actions.
- Modify `frontend/src/pages/Playback.jsx`: render `LandingMobileDock` for public playback only and remove `PlaybackQuickActions`.
- Modify `frontend/src/pages/Playback.test.jsx`: assert public playback shows the same bottom dock, marks Playback active, and links Home/Map/Grid/Favorit correctly.
- Modify `frontend/src/.module_map.md` and `frontend/src/components/playback/.module_map.md`: sync docs with the actual dock-based flow.

## Tasks

### Task 1: Add Dock Link Mode

**Files:**
- Modify: `frontend/src/components/landing/LandingMobileDock.jsx`
- Test: `frontend/src/components/landing/LandingMobileDock.test.jsx`

- [ ] **Step 1: Write failing test**

Add a test rendering:

```jsx
<LandingMobileDock
    viewMode="playback"
    itemHrefs={{
        home: '/',
        map: '/?view=map&mode=full',
        grid: '/?view=grid&mode=full',
        quick: '/?view=grid&mode=full#public-quick-access',
        playback: '/playback?cam=1-lobby&t=1777716000000',
    }}
/>
```

Assert the dock renders links with matching `href`, and Playback is active.

- [ ] **Step 2: Run failing test**

Run: `npm test -- LandingMobileDock.test.jsx`

Expected before implementation: FAIL because the component renders buttons only.

- [ ] **Step 3: Implement link support**

Keep existing `NAV_ITEMS` and callbacks. If `itemHrefs[item.key]` exists, render an `<a>` using the same classes and contents; otherwise render the current `<button>`.

- [ ] **Step 4: Run focused dock test**

Run: `npm test -- LandingMobileDock.test.jsx`

Expected: PASS.

### Task 2: Replace Playback Quick Actions

**Files:**
- Delete: `frontend/src/components/playback/PlaybackQuickActions.jsx`
- Modify: `frontend/src/pages/Playback.jsx`
- Test: `frontend/src/pages/Playback.test.jsx`

- [ ] **Step 1: Write failing playback test**

In `Playback.test.jsx`, expect `landing-mobile-dock` inside public playback with:

```js
expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
expect(screen.getByRole('link', { name: 'Map' }).getAttribute('href')).toBe('/?view=map&mode=full');
expect(screen.getByRole('link', { name: 'Grid' }).getAttribute('href')).toBe('/?view=grid&mode=full');
expect(screen.getByRole('link', { name: 'Favorit' }).getAttribute('href')).toBe('/?view=grid&mode=full#public-quick-access');
expect(screen.getByRole('link', { name: 'Playback' }).getAttribute('href')).toContain('/playback?');
expect(screen.queryByTestId('playback-quick-actions')).toBeNull();
```

- [ ] **Step 2: Run failing playback test**

Run: `npm test -- Playback.test.jsx`

Expected before implementation: FAIL because public playback still renders `PlaybackQuickActions`.

- [ ] **Step 3: Implement playback dock**

Import `LandingMobileDock` in `Playback.jsx`, remove `PlaybackQuickActions`, compute:

```js
const currentPlaybackHref = `${window.location.pathname}${window.location.search || ''}`;
const publicDockHrefs = {
    home: '/',
    map: '/?view=map&mode=full',
    grid: '/?view=grid&mode=full',
    quick: '/?view=grid&mode=full#public-quick-access',
    playback: currentPlaybackHref || '/playback',
};
```

Render:

```jsx
{!isAdminPlayback && (
    <LandingMobileDock viewMode="playback" itemHrefs={publicDockHrefs} />
)}
```

- [ ] **Step 4: Run playback test**

Run: `npm test -- Playback.test.jsx`

Expected: PASS.

### Task 3: Docs And Verification

**Files:**
- Modify: `frontend/src/.module_map.md`
- Modify: `frontend/src/components/playback/.module_map.md`

- [ ] **Step 1: Sync docs**

Update maps so public playback references the shared landing mobile dock, not playback quick actions.

- [ ] **Step 2: Run final checks**

Run:

```bash
npm test -- LandingMobileDock.test.jsx Playback.test.jsx
npm run build
npm run lint
```

Expected: all PASS.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-05-07-public-playback-mobile-dock.md frontend/src/components/landing/LandingMobileDock.jsx frontend/src/components/landing/LandingMobileDock.test.jsx frontend/src/pages/Playback.jsx frontend/src/pages/Playback.test.jsx frontend/src/.module_map.md frontend/src/components/playback/.module_map.md
git add -u frontend/src/components/playback/PlaybackQuickActions.jsx
git commit -m "Fix: use public mobile dock on playback"
git push
```
