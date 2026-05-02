<!--
Purpose: Design the next Playback.jsx extraction for share and snapshot behavior.
Caller: Agents and maintainers preparing a focused implementation plan.
Deps: frontend/src/pages/Playback.jsx, frontend/src/hooks/playback, frontend/src/utils/publicShareUrl.js.
MainFuncs: Defines hook boundary, data flow, testing, and rollout constraints for usePlaybackShareAndSnapshot.
SideEffects: None; documentation only.
-->

# Playback Share/Snapshot Hook Design

## Goal

Extract public playback sharing and video snapshot behavior from `frontend/src/pages/Playback.jsx` into a focused hook without changing public/admin playback behavior.

## Scope

Create `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.js`.

The hook owns:
- `snapshotNotification`
- `setSnapshotNotification` only as an internal detail
- `takeSnapshot()`
- `handleShare()`

The hook receives:
- `videoRef`
- `branding`
- `selectedCamera`
- `selectedSegment`
- `searchParams`
- `isAdminPlayback`

The hook returns:
- `snapshotNotification`
- `clearSnapshotNotification()`
- `takeSnapshot`
- `handleShare`

`Playback.jsx` remains responsible for route shell composition, passing callbacks into `PlaybackVideo`, rendering the share button, and passing `null` share handlers for admin UI if needed.

## Behavior

Snapshot behavior stays unchanged:
- If the video is missing, paused, or not ready, show the existing error notification.
- Draw the current video frame into a canvas.
- Add the existing RAF NET watermark using branding values.
- Prefer native file sharing when supported.
- Fall back to local download.
- Show the same success/error messages and auto-clear timings.

Share behavior stays unchanged:
- Admin playback share is a no-op.
- Public playback share uses `buildPublicPlaybackShareUrl`.
- The timestamp uses segment start time plus current video time when available.
- Prefer `navigator.share` when supported.
- Fall back to clipboard copy.
- Show the same success/error notification messages and auto-clear timings.

## Data Flow

`Playback.jsx` provides current playback state to the hook. The hook derives share timestamps from `selectedSegment.start_time` plus `videoRef.current.currentTime`. It emits notification state back to `Playback.jsx`, which forwards it into `PlaybackVideo` unchanged.

No API calls, DB changes, route changes, or UI layout changes are included.

## Error Handling

The hook should preserve current defensive behavior:
- Ignore admin share requests.
- Handle missing/paused/unready video before canvas work.
- Handle `canvas.toBlob()` returning null.
- Ignore native share `AbortError`.
- Catch snapshot and clipboard failures and surface existing Indonesian notification messages.

Timers used to clear notifications should be cleaned up on unmount to avoid state updates after the route changes.

## Testing

Add `frontend/src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx`.

Focused tests should cover:
- Snapshot returns the existing not-ready error when video is unavailable or not ready.
- Public share builds/copies a URL with `cam` and timestamp.
- Admin share does not call native share or clipboard.
- Notification clear callback resets state.

Keep existing `frontend/src/pages/Playback.test.jsx` integration assertions for public share behavior.

Focused verification:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx Playback.test.jsx publicShareUrl.test.js
```

Final verification:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackShareAndSnapshot.test.jsx Playback.test.jsx publicShareUrl.test.js
npm run build
```

## Implementation Constraints

- Use TDD: write hook tests first and verify RED before production code.
- Keep `Playback.jsx` call sites stable where practical.
- Do not move unrelated playback reset, segment transition, media source, or viewer tracking behavior.
- Add Header Docs to every created or edited file.
- Update `frontend/src/.module_map.md` and `frontend/src/pages/.module_map.md` if this extraction changes the documented playback boundaries.
