<!--
Purpose: Design spec for hardening Playback.jsx lifecycle before adding new playback-facing features.
Caller: Agents and maintainers planning frontend playback stabilization work.
Deps: SYSTEM_MAP.md, frontend/src/.module_map.md, frontend/src/pages/Playback.jsx, playback services/components/tests.
MainFuncs: Defines scope, extraction boundaries, data flow, risks, and verification for playback lifecycle hardening.
SideEffects: None; documentation only.
-->

# Playback Lifecycle Hardening Design

## Goal

Make playback safe to extend by reducing `frontend/src/pages/Playback.jsx` responsibility and locking the current user-facing behavior with focused tests. The hardening must preserve existing public and admin playback behavior while making camera changes, segment changes, media source loading, URL sync, and playback viewer session tracking easier to reason about.

This is stabilization work, not a new feature.

## Current Risk

`Playback.jsx` currently owns too many coupled responsibilities:

- camera and segment state
- URL parameter parsing and updates
- recording segment API loading
- public/admin playback policy
- media element source lifecycle
- auto-play and segment advance behavior
- playback viewer session start/stop
- share URL generation
- ad trigger timing
- presentation wiring

The highest-risk area is lifecycle timing. A camera or segment can change while async segment loading, media events, viewer tracking, or URL updates are still in flight. The file already uses refs/tokens to reduce this risk, but those protections are embedded in a large page component and are hard to verify independently.

## Invariants

The implementation must preserve these invariants:

- Public playback uses `/playback` and `accessScope='public_preview'`.
- Admin playback uses `/admin/playback` and `accessScope='admin_full'`.
- Public share links must never leak admin scope.
- Playback URL params stay distinct from live view params: playback uses `cam` and `t`.
- Segment URL selection must be ignored when it belongs to a stale camera.
- Changing camera or segment stops the old playback viewer session before tracking a new one.
- Playback viewer tracking starts only after real media playback begins, not when the page first opens.
- Duplicate `playing` or progress events must not create duplicate playback sessions.
- Media event listeners, timers, and pending async work must clean up on source change and unmount.

## Recommended Approach

Use a behavior-preserving extraction in small steps.

1. Move pure URL and segment selection helpers out of `Playback.jsx` first.
2. Move playback viewer session state into a focused hook.
3. Move media source lifecycle/event handling into a focused hook.
4. Leave `Playback.jsx` as the route orchestrator that wires hooks to existing UI components.

This approach has the lowest risk because it keeps UI components and service contracts stable while separating the race-prone lifecycle logic into testable units.

## Boundaries

### Route Shell

`frontend/src/pages/Playback.jsx` remains the route-level shell. It should own:

- public/admin scope selection
- high-level loading/error state
- composition of `PlaybackHeader`, `PlaybackVideo`, `PlaybackTimeline`, and `PlaybackSegmentList`
- passing callbacks and values to existing components

It should not directly own low-level media listener wiring or playback viewer session token management after extraction.

### URL Helper

Create or extend a pure utility for playback URL state. It should handle:

- parsing `cam` and `t`
- building replacement search params
- preserving existing unrelated public query params when appropriate
- preventing admin-only scope from entering share URLs

Tests should cover public share links, admin route behavior, missing camera, and timestamp replacement.

### Segment Loading Hook

Create a hook that loads segments for the selected camera and ignores stale results. It should expose:

- `segments`
- `segmentsCameraId`
- `selectedSegment`
- `setSelectedSegment`
- `loading`
- `error`
- `reload`

The hook should use a request token/ref so a slow response for camera A cannot update state after camera B is selected.

### Viewer Session Hook

Create a hook for playback viewer tracking. It should expose:

- `ensureSessionStarted()`
- `stopSession()`
- `stopAllSessions()`
- active key/session state only through stable callbacks

It should start a session only after media `playing` or confirmed progress. It must guard duplicate event bursts with pending key/token logic and must stop stale sessions when camera, segment, or scope changes.

### Media Source Hook

Create a hook for video source lifecycle. It should handle:

- source token creation
- stream URL assignment
- seek target state
- progress/stall tracking
- buffering timeout cleanup
- `loadeddata`, `playing`, `timeupdate`, `ended`, `waiting`, and error event wiring

It should call route callbacks for segment advance, warnings, and tracking instead of directly mutating page-specific state beyond its ownership.

## Out Of Scope

- No visual redesign.
- No new playback feature.
- No backend route/API change.
- No change to public/admin playback access policy.
- No change to recording cleanup or retention behavior.
- No broad frontend lint expansion in this task.

## Test Plan

Add or update focused tests before moving logic:

- URL helper tests for `cam`/`t`, public share safety, and admin scope exclusion.
- Segment loading hook tests for stale response ignore and camera switch reset.
- Viewer session hook tests for duplicate media events, camera/segment switch stop/start, and unmount cleanup.
- Media source lifecycle tests for listener cleanup, source token mismatch, and end-of-segment advance.
- Existing playback page tests should still cover rendered integration with `PlaybackVideo`, `PlaybackTimeline`, and `PlaybackSegmentList`.

Verification command target:

```bash
cd frontend
npm test -- Playback.test.jsx PlaybackVideo.test.jsx src/utils/playbackSegmentSelection.test.js
npm run build
```

If new hook test files are added, include them explicitly in the focused command before the build.

## Acceptance Criteria

- `Playback.jsx` is smaller and mostly orchestration.
- Existing UI behavior is preserved.
- Public/admin route scope behavior is unchanged.
- Segment/camera URL sync is covered by tests.
- Playback viewer tracking has explicit tests for duplicate event bursts and stale transitions.
- Media event cleanup has explicit tests.
- Focused frontend tests and build pass.

