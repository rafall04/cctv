<!--
Purpose: Implementation plan for preventing the admin mobile quick-action dock from covering admin modal and drawer actions.
Caller: Superpowers planning workflow after admin overlay analysis approval.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/pages/.module_map.md, frontend/src/layouts/AdminLayout.jsx, frontend/src/layouts/AdminLayout.test.jsx.
MainFuncs: Documents TDD steps, exact target edits, verification commands, and commit checkpoints.
SideEffects: None; documentation only.
-->

# Admin Quick Actions Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the admin mobile quick-action dock never blocks modal, drawer, or sticky form actions on protected admin pages.

**Architecture:** Keep the fix centralized in `AdminLayout` because every protected admin route is wrapped by that shell. Lower the mobile dock stacking layer beneath existing `z-50` admin overlays while preserving normal page bottom padding and hiding the dock when the mobile sidebar is open. Add focused layout tests so future z-index changes cannot reintroduce the bug.

**Tech Stack:** React 18, React Router, Tailwind CSS, Vitest, React Testing Library, Vite.

---

## File Structure

- Modify: `frontend/src/layouts/AdminLayout.jsx`
  - Responsibility: Owns admin shell chrome, sidebar, mobile header, and mobile quick-action dock.
  - Planned change: Replace the quick-action dock `z-[1200]` class with `z-30`, keeping modal/drawer overlays at `z-50` above it.
- Modify: `frontend/src/layouts/AdminLayout.test.jsx`
  - Responsibility: Guards admin shell navigation, mobile dock behavior, and overlay stacking regressions.
  - Planned change: Add assertions that the dock uses `z-30` and does not use `z-[1200]`.
- No page-level modal files should be modified for this fix:
  - `frontend/src/components/admin/cameras/CameraFormModal.jsx`
  - `frontend/src/components/admin/areas/AreaFormModal.jsx`
  - `frontend/src/pages/AreaManagement.jsx`
  - `frontend/src/pages/UserManagement.jsx`
  - `frontend/src/pages/SponsorManagement.jsx`
  - `frontend/src/components/admin/dashboard/DashboardStreams.jsx`
  - `frontend/src/components/admin/analytics/AnalyticsHistoryTable.jsx`
  - `frontend/src/components/admin/analytics/DailyDetailModal.jsx`

## Admin Pages Covered By Central Fix

- `/admin/cameras`: camera create/edit modal submit actions.
- `/admin/areas`: area form, bulk policy, map center, delete confirmation modals.
- `/admin/users`: self-delete warning, add/edit user, password modal.
- `/admin/sponsors`: sponsor form modal.
- `/admin/dashboard`: viewer modal and streams drawer.
- `/admin/analytics`: daily detail modal and history drawer.
- `/admin/playback-analytics`: history drawer.
- `/admin/playback`, `/admin/recordings`, `/admin/settings`, `/admin/feedback`, `/admin/health-debug`, `/admin/import-export`, `/admin/backup-restore`, `/admin/playback-tokens`: normal route content remains protected by `pb-28` and no conflicting fixed-bottom admin overlay was found in static audit.

---

### Task 1: Add Regression Test For Dock Stack Layer

**Files:**
- Modify: `frontend/src/layouts/AdminLayout.test.jsx`

- [ ] **Step 1: Add the failing assertion to the existing quick-action dock test**

Find this block in `frontend/src/layouts/AdminLayout.test.jsx`:

```jsx
        const dock = screen.getByTestId('admin-pwa-quick-actions');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-3');
        expect(dock.querySelector('.grid-cols-5')).toBeTruthy();
```

Replace it with:

```jsx
        const dock = screen.getByTestId('admin-pwa-quick-actions');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-3');
        expect(dock.className).toContain('z-30');
        expect(dock.className).not.toContain('z-[1200]');
        expect(dock.querySelector('.grid-cols-5')).toBeTruthy();
```

- [ ] **Step 2: Run the focused test to verify it fails before implementation**

Run:

```bash
cd frontend
npm test -- AdminLayout.test.jsx
```

Expected result before implementation:

```text
FAIL frontend/src/layouts/AdminLayout.test.jsx
AssertionError: expected '...' to contain 'z-30'
```

- [ ] **Step 3: Commit the failing test only if working in a red-green commit workflow**

Run only if the project lead wants red-state commits:

```bash
git add frontend/src/layouts/AdminLayout.test.jsx
git commit -m "Fix: add admin quick action overlay regression test"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 2: Lower Admin Quick-Action Dock Stack Layer

**Files:**
- Modify: `frontend/src/layouts/AdminLayout.jsx`

- [ ] **Step 1: Update only the dock z-index class**

Find this class in `AdminPwaQuickActions`:

```jsx
            className="fixed inset-x-3 bottom-3 z-[1200] rounded-2xl border border-gray-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/95 lg:hidden"
```

Replace it with:

```jsx
            className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-gray-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/95 lg:hidden"
```

- [ ] **Step 2: Verify focused layout tests pass**

Run:

```bash
cd frontend
npm test -- AdminLayout.test.jsx
```

Expected result:

```text
PASS frontend/src/layouts/AdminLayout.test.jsx
```

- [ ] **Step 3: Commit the centralized fix**

Run:

```bash
git add frontend/src/layouts/AdminLayout.jsx frontend/src/layouts/AdminLayout.test.jsx
git commit -m "Fix: prevent admin quick actions covering modals"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

### Task 3: Verify High-Risk Admin Modal Surfaces

**Files:**
- Read only: `frontend/src/components/admin/cameras/CameraFormModal.jsx`
- Read only: `frontend/src/components/admin/areas/AreaFormModal.jsx`
- Read only: `frontend/src/pages/AreaManagement.jsx`
- Read only: `frontend/src/pages/UserManagement.jsx`
- Read only: `frontend/src/pages/SponsorManagement.jsx`

- [ ] **Step 1: Re-run static overlay scan**

Run:

```bash
rg -n 'fixed inset-0|sticky bottom|bottom-0|bottom-3|z-\[|z-50|z-40|z-30' frontend/src/pages frontend/src/components/admin frontend/src/layouts/AdminLayout.jsx
```

Expected result includes:

```text
frontend/src/layouts/AdminLayout.jsx:... z-30 ...
frontend/src/components/admin/cameras/CameraFormModal.jsx:... z-50 ...
frontend/src/components/admin/areas/AreaFormModal.jsx:... z-50 ...
```

Expected result must not include:

```text
frontend/src/layouts/AdminLayout.jsx:... z-[1200] ...
```

- [ ] **Step 2: Run focused admin tests that cover affected routes/components**

Run:

```bash
cd frontend
npm test -- AdminLayout.test.jsx CameraManagement.test.jsx AreaManagement.test.jsx
```

Expected result:

```text
PASS frontend/src/layouts/AdminLayout.test.jsx
PASS frontend/src/pages/CameraManagement.test.jsx
PASS frontend/src/pages/AreaManagement.test.jsx
```

- [ ] **Step 3: Build frontend to verify Tailwind class generation**

Run:

```bash
cd frontend
npm run build
```

Expected result:

```text
✓ built in
```

---

### Task 4: Browser Smoke Test On Mobile Width

**Files:**
- No code files modified.

- [ ] **Step 1: Start Vite dev server**

Run:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Expected result:

```text
Local:   http://127.0.0.1:5173/
```

If port `5173` is busy, use the port printed by Vite.

- [ ] **Step 2: Open `/admin/cameras` at mobile viewport**

Use browser automation or manual QA:

```text
Viewport: 390x844
URL: http://127.0.0.1:5173/admin/cameras
Action: open Add/Edit Camera modal and scroll to the bottom.
Expected: the Update/Create button is visible and clickable above any quick-action dock.
```

- [ ] **Step 3: Open `/admin/areas` bulk policy modal at mobile viewport**

Use browser automation or manual QA:

```text
Viewport: 390x844
URL: http://127.0.0.1:5173/admin/areas
Action: open Bulk Policy Center and scroll to the bottom.
Expected: Terapkan Segera is visible and clickable; dock does not cover it.
```

- [ ] **Step 4: Open `/admin/users` add/edit modal at mobile viewport**

Use browser automation or manual QA:

```text
Viewport: 390x844
URL: http://127.0.0.1:5173/admin/users
Action: open Add User modal and inspect the submit row.
Expected: Create/Update button is visible and clickable; dock does not cover it.
```

- [ ] **Step 5: Stop the dev server**

Stop the Vite process with `Ctrl+C`.

Expected result:

```text
Terminate batch job
```

---

### Task 5: Final Verification And Push

**Files:**
- Modify only if implementation changed them:
  - `frontend/src/layouts/AdminLayout.jsx`
  - `frontend/src/layouts/AdminLayout.test.jsx`

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected result includes only planned files:

```text
 M frontend/src/layouts/AdminLayout.jsx
 M frontend/src/layouts/AdminLayout.test.jsx
```

- [ ] **Step 2: Run final focused gate**

Run:

```bash
cd frontend
npm test -- AdminLayout.test.jsx CameraManagement.test.jsx AreaManagement.test.jsx
npm run build
```

Expected result:

```text
PASS frontend/src/layouts/AdminLayout.test.jsx
PASS frontend/src/pages/CameraManagement.test.jsx
PASS frontend/src/pages/AreaManagement.test.jsx
✓ built in
```

- [ ] **Step 3: Commit and push if Task 2 was not already committed**

Run:

```bash
git add frontend/src/layouts/AdminLayout.jsx frontend/src/layouts/AdminLayout.test.jsx
git commit -m "Fix: prevent admin quick actions covering modals"
git push
```

Expected result:

```text
To <remote>
   <old>..<new>  <branch> -> <branch>
```

---

## Self-Review

- Spec coverage: The plan covers the approved root cause, all high-risk admin modal pages, focused tests, static overlay audit, mobile smoke checks, build verification, commit, and push.
- Placeholder scan: No placeholder markers, generic edge-case instructions, or undefined helper names are used.
- Type and path consistency: The same component names and paths are used throughout: `AdminPwaQuickActions`, `AdminLayout.jsx`, `AdminLayout.test.jsx`, `CameraFormModal.jsx`, and `AreaFormModal.jsx`.
