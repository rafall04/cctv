/**
 * Purpose: Verify the pure archive-route alert transition core — grace window, edge-trigger,
 *          renag, and recovery — without any I/O or clock.
 * Caller: Vitest backend suite.
 * Deps: evaluateArchiveRouteAlert.
 * MainFuncs: evaluateArchiveRouteAlert.
 * SideEffects: none.
 */
import { describe, expect, it } from 'vitest';
import { evaluateArchiveRouteAlert } from '../services/archiveRouteAlertPolicy.js';

const GRACE = 6 * 60 * 60 * 1000; // 6h
const RENAG = 24 * 60 * 60 * 1000; // 24h
const EMPTY = { firstSeen: {}, reported: [], lastNagMs: null };
const cam = (id, name = `Cam ${id}`, areaName = 'DANDER') => ({ id, name, areaName });

function run(prev, unrouted, nowMs, { graceMs = GRACE, renagMs = RENAG } = {}) {
    return evaluateArchiveRouteAlert(prev, { unrouted, nowMs, graceMs, renagMs });
}

describe('evaluateArchiveRouteAlert', () => {
    it('stays silent and holds no state when nothing is unrouted', () => {
        const { state, action } = run(EMPTY, [], 1000);
        expect(action).toEqual({ type: 'none' });
        expect(state.reported).toEqual([]);
        expect(state.firstSeen).toEqual({});
    });

    it('does not fire while a fresh camera is still inside the grace window', () => {
        const { state, action } = run(EMPTY, [cam(1)], 1000);
        expect(action.type).toBe('none');
        // firstSeen is stamped so the grace clock starts now.
        expect(state.firstSeen[1]).toBe(1000);
        expect(state.reported).toEqual([]);
    });

    it('fires once the camera has been unrouted past the grace window', () => {
        const first = run(EMPTY, [cam(1)], 0);
        const { state, action } = run(first.state, [cam(1)], GRACE + 1);
        expect(action.type).toBe('alert');
        expect(action.reason).toBe('new');
        expect(action.cameras.map((c) => c.id)).toEqual([1]);
        expect(state.reported).toEqual([1]);
    });

    it('measures grace from the FIRST sighting, not each tick', () => {
        let s = run(EMPTY, [cam(1)], 0).state;
        // Many ticks inside the window — still no alert, firstSeen unchanged.
        s = run(s, [cam(1)], GRACE - 2).state;
        const res = run(s, [cam(1)], GRACE + 5);
        expect(res.action.type).toBe('alert');
        expect(res.state.firstSeen[1]).toBe(0);
    });

    it('is edge-triggered: no re-alert while the same gap holds and renag is not due', () => {
        const first = run(EMPTY, [cam(1)], 0);
        const alerted = run(first.state, [cam(1)], GRACE + 1);
        const held = run(alerted.state, [cam(1)], GRACE + 2);
        expect(held.action.type).toBe('none');
    });

    it('renags after the renag window elapses', () => {
        const first = run(EMPTY, [cam(1)], 0);
        const alerted = run(first.state, [cam(1)], GRACE + 1); // lastNag = GRACE+1
        const renag = run(alerted.state, [cam(1)], GRACE + 1 + RENAG);
        expect(renag.action.type).toBe('alert');
        expect(renag.action.reason).toBe('renag');
        expect(renag.action.cameras.map((c) => c.id)).toEqual([1]);
    });

    it('sends a recovery notice when every reported camera is routed', () => {
        const first = run(EMPTY, [cam(1)], 0);
        const alerted = run(first.state, [cam(1)], GRACE + 1);
        const recovered = run(alerted.state, [], GRACE + 2);
        expect(recovered.action.type).toBe('recover');
        expect(recovered.state.reported).toEqual([]);
        expect(recovered.state.lastNagMs).toBeNull();
    });

    it('does not recover while some reported cameras are still unrouted', () => {
        const first = run(EMPTY, [cam(1), cam(2)], 0);
        const alerted = run(first.state, [cam(1), cam(2)], GRACE + 1);
        expect(alerted.action.cameras.map((c) => c.id).sort()).toEqual([1, 2]);
        // Cam 1 routed, cam 2 still unrouted → no recover, no re-alert.
        const partial = run(alerted.state, [cam(2)], GRACE + 2);
        expect(partial.action.type).toBe('none');
        expect(partial.state.reported).toEqual([2]);
    });

    it('alerts about a newly-overdue camera even while another is already reported', () => {
        const first = run(EMPTY, [cam(1)], 0);
        const alerted = run(first.state, [cam(1)], GRACE + 1); // cam1 reported
        // cam2 appears later; once it crosses its own grace, the alert lists BOTH overdue cameras.
        const withNew = run(alerted.state, [cam(1), cam(2)], GRACE + 2); // cam2 firstSeen here
        expect(withNew.action.type).toBe('none'); // cam2 still inside grace
        const bothOverdue = run(withNew.state, [cam(1), cam(2)], GRACE + 2 + GRACE);
        expect(bothOverdue.action.type).toBe('alert');
        expect(bothOverdue.action.reason).toBe('new');
        expect(bothOverdue.action.cameras.map((c) => c.id).sort()).toEqual([1, 2]);
    });

    it('drops firstSeen for cameras that became routed', () => {
        const first = run(EMPTY, [cam(1), cam(2)], 0);
        const next = run(first.state, [cam(2)], 100);
        expect(next.state.firstSeen).toEqual({ 2: 0 });
    });
});
