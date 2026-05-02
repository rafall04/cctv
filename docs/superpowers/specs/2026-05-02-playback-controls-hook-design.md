<!--
Purpose: Design the next Playback.jsx extraction for playback control state and handlers.
Caller: Agents and maintainers preparing a focused implementation plan.
Deps: frontend/src/pages/Playback.jsx, frontend/src/hooks/playback, frontend/src/components/playback.
MainFuncs: Defines hook boundary, data flow, testing, and rollout constraints for usePlaybackControls.
SideEffects: None; documentation only.
-->

# Playback Controls Hook Design

## Goal

Extract playback control state and handlers from `frontend/src/pages/Playback.jsx` into a focused hook without changing playback route behavior.

## Scope

Create `frontend/src/hooks/playback/usePlaybackControls.js`.

The hook owns:
- `isFullscreen`
- `seekWarning`
- `autoPlayEnabled`
- `autoPlayNotification`
- `handleAutoPlayToggle()`
- `clearAutoPlayNotification()`
- `clearSeekWarning()`
- `toggleFullscreen()`
- `handleTimelineClick()`

The hook receives:
- `videoRef`
- `containerRef`
- `lastSeekTimeRef`
- optional `maxSeekDistance`, defaulting to `180`

The hook returns:
- `isFullscreen`
- `seekWarning`
- `autoPlayEnabled`
- `autoPlayNotification`
- `setAutoPlayNotification`
- `setSeekWarning`
- `clearAutoPlayNotification`
- `clearSeekWarning`
- `handleAutoPlayToggle`
- `toggleFullscreen`
- `handleTimelineClick`

`Playback.jsx` remains responsible for camera/segment transitions, media source lifecycle, segment loading, playback tracking, and share/snapshot behavior.

## Behavior

Control behavior stays unchanged:
- Autoplay preference is read from `localStorage` key `playback-autoplay-enabled`.
- Autoplay toggle persists the next value to localStorage.
- Toggle notifications use the existing Indonesian messages and auto-clear after 3 seconds.
- Fullscreen state follows `document.fullscreenElement`.
- Fullscreen toggling calls `containerRef.current.requestFullscreen()` or `document.exitFullscreen()`.
- Timeline seeking limits each jump to `maxSeekDistance` seconds from `lastSeekTimeRef.current`.
- Seek limit warnings keep the existing `{ type: 'limit' }` shape.

The hook returns `setAutoPlayNotification` because `Playback.jsx` still needs to set autoplay messages from media lifecycle and auto-next-segment behavior. It returns `setSeekWarning` because the existing media `seeking` listener still raises seek-limit warnings outside timeline clicks. A later extraction can move those media/autoplay flows separately.

## Data Flow

`Playback.jsx` passes video/container refs and the shared `lastSeekTimeRef` into the hook. The hook mutates `videoRef.current.currentTime` for timeline seeking, updates `lastSeekTimeRef.current`, and returns control state and callbacks for `PlaybackHeader`, `PlaybackVideo`, and `PlaybackTimeline`.

No API calls, DB changes, route changes, or UI layout changes are included.

## Error Handling

The hook should preserve current defensive behavior:
- `handleTimelineClick` is a no-op when `videoRef.current` is missing.
- `toggleFullscreen` catches fullscreen API errors and logs `Fullscreen error:`.
- Notification timers are cleaned up on unmount.
- Fullscreen event listener is removed on unmount.

## Testing

Add `frontend/src/hooks/playback/usePlaybackControls.test.jsx`.

Focused tests should cover:
- Default autoplay value reads from localStorage and toggle persists the inverse.
- Autoplay toggle shows and clears the existing notification.
- Timeline click within limit directly updates `video.currentTime` and `lastSeekTimeRef.current`.
- Timeline click beyond limit clamps the seek and sets `{ type: 'limit' }`.
- Fullscreen change listener updates `isFullscreen`.

Keep existing `frontend/src/pages/Playback.test.jsx` integration assertions for buffering, seeking, autoplay, and sharing behavior.

Focused verification:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx Playback.test.jsx
```

Final verification:

```bash
cd frontend
npm test -- src/hooks/playback/usePlaybackControls.test.jsx Playback.test.jsx
npm run build
```

## Implementation Constraints

- Use TDD: write hook tests first and verify RED before production code.
- Keep `Playback.jsx` call sites stable where practical.
- Do not move camera/segment transition logic, source lifecycle, viewer tracking, or share/snapshot behavior.
- Add Header Docs to every created or edited file.
- Update `frontend/src/.module_map.md` and `frontend/src/pages/.module_map.md` if this extraction changes the documented playback boundaries.
