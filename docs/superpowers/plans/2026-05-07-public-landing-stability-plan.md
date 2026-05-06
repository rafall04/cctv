# Public Landing Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public CCTV experience stable, fast, and responsive across small phones, tablets, laptops, and wide desktops without changing public behavior.

**Architecture:** Split the public landing shell into a thin route wrapper plus focused public hooks/components, keep expensive ranking and filtering in pure memoized helpers, and harden mobile navigation, popup handling, and modal behavior so one state change does not cascade into layout shifts or duplicate work. Preserve the current route structure, public/admin playback scope split, and popup flow, but move rendering and orchestration to smaller units with explicit interfaces.

**Tech Stack:** React 18, React Router, Vite, Tailwind CSS, Vitest, existing public landing hooks/services/utils.

---

### Task 1: Establish public stability guards and baseline coverage

**Files:**
- Modify: `frontend/src/pages/LandingPage.test.jsx`
- Modify: `frontend/src/pages/AreaPublicPage.test.jsx`
- Modify: `frontend/src/components/landing/LandingNavbar.test.jsx`
- Modify: `frontend/src/components/landing/LandingMobileDock.test.jsx`
- Modify: `frontend/src/components/landing/LandingDiscoveryStrip.test.jsx`
- Modify: `frontend/src/components/landing/LandingQuickAccessStrip.test.jsx`
- Modify: `frontend/src/components/landing/LandingSmartFeed.test.jsx`
- Modify: `frontend/src/components/landing/LandingResultsGrid.test.jsx`

- [ ] **Step 1: Define the regression cases that matter most**

Cover these current risks in tests before changing behavior:
- `LandingPage` does not hard-reload when clicking the brand link.
- Public popup resolution keeps stale results from reopening an older camera.
- `LandingMobileDock` remains usable on narrow viewports.
- Public discovery and quick-access sections cap visible items deterministically.
- `AreaPublicPage` opens the correct camera from the `camera` query parameter and ignores unrelated search changes.

- [ ] **Step 2: Run the focused public tests once to record the current state**

Run:
```bash
cd frontend && npm test -- LandingPage.test.jsx AreaPublicPage.test.jsx LandingNavbar.test.jsx LandingMobileDock.test.jsx LandingDiscoveryStrip.test.jsx LandingQuickAccessStrip.test.jsx LandingSmartFeed.test.jsx LandingResultsGrid.test.jsx
```

Expected:
- Existing public tests pass or show only the specific gaps listed above.

---

### Task 2: Extract the landing page orchestration into a focused hook

**Files:**
- Create: `frontend/src/hooks/public/useLandingPageController.js`
- Modify: `frontend/src/pages/LandingPage.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx`

- [ ] **Step 1: Define the hook interface**

Create `useLandingPageController` to own:
- discovery fetch and loading state
- meta tag updates
- popup source tracking
- refresh pause signaling
- stream-resolution request token handling
- mobile scroll helpers
- map preload triggers

The hook should return a small object used by `LandingPage.jsx`, including:
- `publicDiscovery`
- `discoveryLoading`
- `activePopupSource`
- `setActivePopupSource`
- `handleGridPopupOpen(camera, options)`
- `handleMapPopupOpen(camera, options)`
- `handlePopupClose()`
- `shouldPauseRefresh`

- [ ] **Step 2: Move orchestration out of the route file**

Refactor `LandingPage.jsx` so it becomes a route shell that:
- selects full/simple mode
- passes props to the existing landing components
- renders popups and multi-view from hook state
- keeps ads and PWA shell wiring outside the heavy UI flow

Keep the current popup request-token guard intact, but relocate the duplicated resolution logic behind the new hook so grid and map follow one code path.

- [ ] **Step 3: Add a hook-level regression test**

Add coverage for:
- stale stream-resolution results cannot overwrite a newer popup
- refresh pause toggles when popup or multi-view is active
- closing a popup clears the pending request token

Run:
```bash
cd frontend && npm test -- LandingPage.test.jsx
```

Expected:
- the new hook behavior is covered without breaking current public route rendering

---

### Task 3: Cut playback out of the public landing bundle

**Files:**
- Modify: `frontend/src/components/landing/LandingCamerasSection.jsx`
- Modify: `frontend/src/components/landing/LandingPlaybackPanel.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx` if prop wiring changes
- Modify: `frontend/src/pages/LandingPage.jsx` if imports move

- [ ] **Step 1: Replace the static playback page import**

Move the public playback screen to lazy loading so the grid and map paths do not pull `frontend/src/pages/Playback.jsx` into the default landing chunk.

The target behavior is:
- playback mode loads only when `viewMode === 'playback'`
- grid and map modes stay light
- the `public_preview` access scope remains unchanged

- [ ] **Step 2: Keep the playback shell API stable**

Do not change the public playback route contract. The landing page should still pass:
- `cameras`
- `selectedCamera`
- `adsConfig`
- `accessScope="public_preview"`

- [ ] **Step 3: Verify the landing route still works without playback**

Run:
```bash
cd frontend && npm test -- LandingPage.test.jsx LandingCamerasSection.test.jsx
```

Expected:
- public landing grid and map behavior remains intact
- playback is still reachable only through the playback mode

---

### Task 4: Make public navigation mobile-safe and router-aware

**Files:**
- Modify: `frontend/src/components/landing/LandingNavbar.jsx`
- Modify: `frontend/src/components/landing/LandingPageSimple.jsx`
- Modify: `frontend/src/components/landing/LandingMobileDock.jsx`
- Modify: `frontend/src/components/landing/LayoutModeToggle.jsx` if button sizing needs normalization

- [ ] **Step 1: Replace hard reload links with router links**

Convert the landing brand links from `<a href="/">` to `Link` so navigation stays inside the SPA and preserves public UI state where possible.

This applies to:
- `LandingNavbar`
- `LandingPageSimple`

- [ ] **Step 2: Make the mobile dock resilient on 320px devices**

Rework the dock so the 5-item navigation does not depend on fixed-width labels alone. The dock should:
- keep hit targets tall enough for touch
- preserve safe-area padding
- avoid label overlap on small screens
- keep the current action order intact

Preferred outcome:
- icon-first or icon+short-label presentation for narrow widths
- text remains readable without horizontal overflow

- [ ] **Step 3: Add navigation tests**

Cover:
- brand clicks stay in-app
- dock buttons still invoke the correct mode or section handlers
- the quick-access badge remains visible without pushing the layout sideways

Run:
```bash
cd frontend && npm test -- LandingNavbar.test.jsx LandingMobileDock.test.jsx LandingPageSimple.test.jsx
```

Expected:
- no hard reloads from public navigation
- no layout breakage on narrow widths

---

### Task 5: Tighten the responsive rendering windows for public discovery and camera lists

**Files:**
- Modify: `frontend/src/components/landing/LandingDiscoveryStrip.jsx`
- Modify: `frontend/src/components/landing/LandingQuickAccessStrip.jsx`
- Modify: `frontend/src/components/landing/LandingSmartFeed.jsx`
- Modify: `frontend/src/components/landing/LandingResultsGrid.jsx`
- Create: `frontend/src/utils/publicLandingSections.js` if repeated shaping becomes hard to keep in sync

- [ ] **Step 1: Separate pure list shaping from rendering**

Move repeated section-building and cap logic into pure helpers where it makes the render path simpler:
- discovery section selection
- quick-access grouping
- smart-feed section selection
- grid window sizing for mobile vs desktop

Keep the helpers deterministic and side-effect free so the UI can memoize them safely.

- [ ] **Step 2: Stabilize visible item counts**

Maintain the current caps, but make them explicit and predictable:
- discovery strips show only a bounded active set
- smart feed stays compact in simple mode
- the grid loads more items in fixed windows
- list keys stay stable across renders

- [ ] **Step 3: Verify list behavior**

Run:
```bash
cd frontend && npm test -- LandingDiscoveryStrip.test.jsx LandingQuickAccessStrip.test.jsx LandingSmartFeed.test.jsx LandingResultsGrid.test.jsx
```

Expected:
- list counts and caps remain correct
- rendering stays stable when unrelated state changes

---

### Task 6: Make the area public page cheaper to render and safer on URL changes

**Files:**
- Modify: `frontend/src/pages/AreaPublicPage.jsx`
- Create: `frontend/src/utils/areaPublicRanking.js`
- Modify: `frontend/src/pages/AreaPublicPage.test.jsx`

- [ ] **Step 1: Move ranking logic into pure helpers**

Extract the camera ranking logic into pure utilities for:
- live-now ordering
- trending/top ordering
- newest ordering
- related popup ordering

This keeps the route file focused on state and rendering instead of repeated sort chains.

- [ ] **Step 2: Stabilize URL-driven popup selection**

Only react to the `camera` query parameter when the effective camera id changes. Keep the existing popup resolution guard, but make the effect narrower so unrelated search changes do not reopen or re-resolve the same camera.

- [ ] **Step 3: Preserve progressive loading**

Keep the existing visible-camera window and "load more" behavior, but make the derived arrays memoized and cheap enough for low-end phones.

- [ ] **Step 4: Verify the area page**

Run:
```bash
cd frontend && npm test -- AreaPublicPage.test.jsx
```

Expected:
- area page still deep-links correctly
- popup resolution stays stable
- list growth remains progressive and bounded

---

### Task 7: Harden modal, scroll, and public HTML safety

**Files:**
- Modify: `frontend/src/components/landing/LandingStatsBar.jsx`
- Modify: `frontend/src/components/landing/LandingHero.jsx`
- Create: `frontend/src/utils/sanitizePublicHtml.js`
- Create: `frontend/src/utils/sanitizePublicHtml.test.js`

- [ ] **Step 1: Make the stats modal safe on mobile**

Keep the current modal UI, but add the minimum safety behaviors needed for public pages:
- lock page scroll while the modal is open
- close on Escape
- avoid body scroll bleed on iOS-like narrow viewports

- [ ] **Step 2: Sanitize public HTML before rendering**

Replace raw `dangerouslySetInnerHTML` usage with a small allowlist sanitizer for the public `area_coverage` field.

Minimum allowlist:
- `strong`
- `em`
- `br`
- `span`
- `a` with safe `href`

Anything outside the allowlist should render as text or be stripped.

- [ ] **Step 3: Verify the safety layer**

Run:
```bash
cd frontend && npm test -- LandingStatsBar.test.jsx LandingHero.test.jsx sanitizePublicHtml.test.js
```

Expected:
- modal remains usable without background scroll issues
- unsafe HTML does not reach the DOM as executable markup

---

### Task 8: Run the full public verification gate and record the result

**Files:**
- None new; this is the final verification pass for all public changes

- [ ] **Step 1: Run the focused public suite**

Run:
```bash
cd frontend && npm test -- LandingPage.test.jsx AreaPublicPage.test.jsx LandingNavbar.test.jsx LandingMobileDock.test.jsx LandingDiscoveryStrip.test.jsx LandingQuickAccessStrip.test.jsx LandingSmartFeed.test.jsx LandingResultsGrid.test.jsx LandingHero.test.jsx LandingStatsBar.test.jsx sanitizePublicHtml.test.js
```

- [ ] **Step 2: Run build and lint**

Run:
```bash
cd frontend && npm run build && npm run lint
```

Expected:
- build succeeds
- lint succeeds
- no public route regression remains

- [ ] **Step 3: Validate the implementation against the original stability goals**

Confirm the finished work still satisfies:
- no hard reloads in public navigation
- no duplicate popup race behavior
- no playback chunk in the default landing path
- stable rendering on narrow, medium, and wide devices
- sanitized public HTML output
- scroll-safe modal behavior

---

## Self-Review Checklist

- Spec coverage: every public stability problem has a task path.
- Scope check: public landing, public area page, shared UI safety, and verification are separated cleanly.
- Placeholder scan: no TBD/TODO/future-work wording remains in the actionable sections.
- Consistency check: route ownership stays in `LandingPage.jsx` and `AreaPublicPage.jsx`, while reusable behavior moves into hooks/utils/components.
- Risk check: the highest-risk changes are isolated first, before layout polish and sanitization.

