// Purpose: Pure decision core for the "recording camera has no Telegram archive route" nag.
//          Given the currently-unrouted recording cameras and the previous run's state, decide
//          whether to send an alert, a recovery notice, or stay silent — and what the next state is.
// Caller: archiveRouteAlertService.js (the scheduled watcher wraps this with I/O).
// Deps: none — pure, no clock, no DB. All timing arrives as arguments.
// MainFuncs: evaluateArchiveRouteAlert.
// SideEffects: none.
//
// Two timers shape the behaviour, both restart-tolerant because the loud on-page banner is the
// always-on backstop:
//   - graceMs: how long a camera may sit unrouted before it counts as "overdue". This is the grace
//     for the normal setup flow — enable recording, then add the route a few minutes later — so a
//     mid-setup camera never fires. A camera is stamped `firstSeen` the first tick it is seen
//     unrouted; it becomes overdue once `now - firstSeen >= graceMs`.
//   - renagMs: once reported, how long to wait before nagging again about a gap left unfixed.
//
// Edge-triggered like recordingHealthAlertService: one alert when a camera crosses the grace line,
// no re-spam while it holds (bounded only by the slow renag), and one recovery notice when every
// previously-reported camera is finally backed up.

/**
 * @param {{ firstSeen?: Object, reported?: number[], lastNagMs?: number|null }} prev
 * @param {{ unrouted: Array<{id:number,name:string,areaName?:string|null}>, nowMs:number, graceMs:number, renagMs:number }} input
 * @returns {{ state: Object, action: {type:'none'|'alert'|'recover', cameras?:Array, reason?:'new'|'renag'} }}
 */
export function evaluateArchiveRouteAlert(prev, { unrouted, nowMs, graceMs, renagMs }) {
    const prevFirstSeen = prev.firstSeen || {};
    const prevReported = new Set(prev.reported || []);
    const currentIds = new Set(unrouted.map((cam) => cam.id));

    // firstSeen: carry the timestamp forward for cameras still unrouted, stamp `now` for ones seen
    // unrouted for the first time, and drop the ones that are now routed (absent from `unrouted`).
    const firstSeen = {};
    for (const cam of unrouted) {
        firstSeen[cam.id] = prevFirstSeen[cam.id] ?? nowMs;
    }

    // Overdue = unrouted past the grace window. firstSeen only ages, so a reported camera stays
    // overdue until it is routed — which keeps `overdue` and `stillReported` in lock-step below.
    const overdue = unrouted.filter((cam) => nowMs - firstSeen[cam.id] >= graceMs);

    const stillReported = [...prevReported].filter((id) => currentIds.has(id));
    const stillReportedSet = new Set(stillReported);
    const newlyOverdue = overdue.filter((cam) => !stillReportedSet.has(cam.id));

    let action = { type: 'none' };
    let reported = stillReported;
    let lastNagMs = prev.lastNagMs ?? null;

    if (newlyOverdue.length > 0) {
        // At least one camera just crossed the grace line and has not been reported yet.
        action = { type: 'alert', cameras: overdue, reason: 'new' };
        reported = overdue.map((cam) => cam.id);
        lastNagMs = nowMs;
    } else if (stillReported.length > 0 && lastNagMs != null && nowMs - lastNagMs >= renagMs) {
        // Everything overdue was already reported, but the gap has been ignored long enough — nag.
        action = { type: 'alert', cameras: overdue, reason: 'renag' };
        reported = overdue.map((cam) => cam.id);
        lastNagMs = nowMs;
    } else if (prevReported.size > 0 && stillReported.length === 0) {
        // Every camera we warned about is now backed up.
        action = { type: 'recover' };
        reported = [];
        lastNagMs = null;
    }

    return { state: { firstSeen, reported, lastNagMs }, action };
}

export default { evaluateArchiveRouteAlert };
