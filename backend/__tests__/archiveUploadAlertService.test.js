/**
 * Purpose: Verify archiveUploadAlertService — the two delivery-health signals (sidecar STALL and
 *          per-camera BROKEN route), the POSITIVE-evidence recovery rule, the evidence-unavailable
 *          HOLD, guards, subscriber/exempt scope, persisted state, and commit-only-after-send.
 * Caller: Vitest backend suite.
 * Deps: createArchiveUploadAlertService with injected snapshot/send/state stubs.
 * MainFuncs: checkAndAlert.
 * SideEffects: none — Telegram send and state persistence are stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createArchiveUploadAlertService } from '../services/archiveUploadAlertService.js';

const GRACE = 45 * 60 * 1000;
const RENAG = 12 * 60 * 60 * 1000;
const STALL = 30; // minutes
const fcam = (id, name = `Cam ${id}`, detail = '403 kicked', cameraClass = 'community') =>
    ({ id, name, areaName: 'DANDER', cameraClass, detail });
// backlogMinutes drives the state: > STALL = stalled, <= STALL = current (proven keeping up),
// null = indeterminate (idle / empty table). Default null.
const snap = (over = {}) => ({ evidenceAvailable: true, failingCameras: [], backlogMinutes: null, ...over });

function build({ snapshot = snap(), enabled = true, configured = true, available = true, routes = true, exempt = new Set(), initialState = null } = {}) {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const saveState = vi.fn();
    let current = snapshot;
    const service = createArchiveUploadAlertService({
        getSnapshot: () => current,
        sidecarAvailable: () => available,
        hasRoutes: () => routes,
        sendMessage,
        telegramConfigured: () => configured,
        isEnabled: () => enabled,
        exemptIds: () => exempt,
        loadState: () => initialState,
        saveState,
        graceMs: GRACE,
        renagMs: RENAG,
        stallMinutes: STALL,
        failWindowMinutes: 45,
        logger: { error: () => {} },
    });
    return { service, sendMessage, saveState, setSnapshot: (s) => { current = s; } };
}

describe('archiveUploadAlertService — guards', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['disabled', { enabled: false }, 'disabled'],
        ['telegram not configured', { configured: false }, 'telegram_not_configured'],
        ['sidecar absent', { available: false }, 'sidecar_unavailable'],
        ['no routes configured', { routes: false }, 'not_configured'],
    ])('skips when %s', async (_label, opts, expected) => {
        const { service, sendMessage } = build({ snapshot: snap({ backlogMinutes: 40 }), ...opts });
        expect(await service.checkAndAlert(1000)).toEqual({ skipped: expected });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips gracefully when the snapshot throws', async () => {
        const sendMessage = vi.fn();
        const service = createArchiveUploadAlertService({
            getSnapshot: () => { throw new Error('state.db rusak'); },
            sidecarAvailable: () => true, hasRoutes: () => true, sendMessage,
            telegramConfigured: () => true, isEnabled: () => true, exemptIds: () => new Set(),
            loadState: () => null, saveState: vi.fn(), logger: { error: () => {} },
        });
        expect(await service.checkAndAlert(1000)).toEqual({ skipped: 'snapshot_error' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('HOLDS (sends nothing) when the evidence cannot be read — not treated as healthy', async () => {
        // stallActive was true and a camera was reported; an unreadable snapshot must NOT recover either.
        const { service, sendMessage } = build({
            snapshot: snap({ evidenceAvailable: false }),
            initialState: { firstSeen: { 1: 0 }, reported: [1], lastNagMs: 500, stallActive: true },
        });
        expect(await service.checkAndAlert(1000)).toEqual({ skipped: 'evidence_unavailable' });
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('archiveUploadAlertService — sidecar stall (Signal B)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('alerts once on stall, holds, then recovers on POSITIVE proof (backlog small again)', async () => {
        const { service, sendMessage, setSnapshot } = build({ snapshot: snap({ backlogMinutes: 45 }) });

        expect((await service.checkAndAlert(1000)).stall).toBe('alert');
        expect(sendMessage.mock.calls[0][0]).toContain('BERHENTI');

        await service.checkAndAlert(2000); // still stalled → no re-alert
        expect(sendMessage).toHaveBeenCalledTimes(1);

        setSnapshot(snap({ backlogMinutes: 2 })); // uploads caught up
        expect((await service.checkAndAlert(3000)).stall).toBe('recover');
        expect(sendMessage.mock.calls[1][0]).toContain('Jalan Lagi');
    });

    it('does NOT falsely recover on an INDETERMINATE reading (idle/backlog null) while still stalled', async () => {
        const { service, sendMessage, setSnapshot } = build({
            snapshot: snap({ backlogMinutes: 40 }),
            initialState: { firstSeen: {}, reported: [], lastNagMs: null, stallActive: true },
        });
        // backlog null = fleet went idle during the outage; sidecar may STILL be dead → must not recover.
        setSnapshot(snap({ backlogMinutes: null }));
        const r = await service.checkAndAlert(1000);
        expect(r.stall).toBeUndefined();
        expect(sendMessage).not.toHaveBeenCalled();
        // ...only a proven-current reading clears it.
        setSnapshot(snap({ backlogMinutes: 3 }));
        expect((await service.checkAndAlert(2000)).stall).toBe('recover');
    });

    it('does not re-alert a persistent stall carried across a restart', async () => {
        const { service, sendMessage } = build({
            snapshot: snap({ backlogMinutes: 60 }),
            initialState: { firstSeen: {}, reported: [], lastNagMs: null, stallActive: true },
        });
        await service.checkAndAlert(1000);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('archiveUploadAlertService — broken route (Signal A)', () => {
    beforeEach(() => vi.clearAllMocks());
    const live = (over) => snap({ backlogMinutes: 2, ...over }); // sidecar proven current

    it('stays silent inside grace, then alerts with the camera and reason', async () => {
        const { service, sendMessage } = build({ snapshot: live({ failingCameras: [fcam(1, 'CCTV PASAR', '403 bot kicked')] }) });
        expect((await service.checkAndAlert(0)).changed).toBe(false);

        const r = await service.checkAndAlert(GRACE + 1);
        expect(r.failing).toBe('alert');
        const msg = sendMessage.mock.calls[0][0];
        expect(msg).toContain('CCTV PASAR');
        expect(msg).toContain('403 bot kicked');
        expect(msg).toContain('TIDAK Berfungsi');
    });

    it('is edge-triggered and recovers when the route is fixed', async () => {
        const { service, sendMessage, setSnapshot } = build({ snapshot: live({ failingCameras: [fcam(1)] }) });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1);
        await service.checkAndAlert(GRACE + 2);
        expect(sendMessage).toHaveBeenCalledTimes(1);

        setSnapshot(live({ failingCameras: [] }));
        const r = await service.checkAndAlert(GRACE + 3);
        expect(r.failing).toBe('recover');
        expect(sendMessage.mock.calls[1][0]).toContain('Pulih');
    });

    it('renags after the renag window', async () => {
        const { service, sendMessage } = build({ snapshot: live({ failingCameras: [fcam(1)] }) });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1);
        const r = await service.checkAndAlert(GRACE + 1 + RENAG);
        expect(r.failing).toBe('alert');
        expect(sendMessage.mock.calls[1][0]).toContain('Pengingat');
    });

    it('never flags a subscriber camera, and respects the exempt list', async () => {
        const sub = build({ snapshot: live({ failingCameras: [fcam(1, 'Sewa', 'x', 'subscriber')] }) });
        await sub.service.checkAndAlert(0);
        expect((await sub.service.checkAndAlert(GRACE + 1)).changed).toBe(false);
        expect(sub.sendMessage).not.toHaveBeenCalled();

        const ex = build({ snapshot: live({ failingCameras: [fcam(1, 'Diam'), fcam(2, 'Lapor')] }), exempt: new Set([1]) });
        await ex.service.checkAndAlert(0);
        const r = await ex.service.checkAndAlert(GRACE + 1);
        expect(r.cameras).toBe(1);
        expect(ex.sendMessage.mock.calls[0][0]).toContain('Lapor');
        expect(ex.sendMessage.mock.calls[0][0]).not.toContain('Diam');
    });

    it('HOLDS Signal A while the sidecar is stalled — never a false "route recovered"', async () => {
        const { service, sendMessage, setSnapshot } = build({ snapshot: live({ failingCameras: [fcam(1)] }) });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1); // alert, reported=[1]
        expect(sendMessage).toHaveBeenCalledTimes(1);

        // Sidecar dies: backlog large (stalled) and failed rows aged out → failingCameras empty.
        // Signal A must HOLD (not send "recovered"); only Signal B (stall) fires.
        setSnapshot(snap({ backlogMinutes: 50, failingCameras: [] }));
        const r = await service.checkAndAlert(GRACE + 2);
        expect(r.failing).toBeUndefined();
        expect(r.stall).toBe('alert');
        expect(sendMessage.mock.calls[1][0]).toContain('BERHENTI');
        expect(sendMessage.mock.calls[1][0]).not.toContain('Pulih');
    });

    it('measures grace against persisted firstSeen so a long-broken route fires after restart', async () => {
        const { service, sendMessage } = build({
            snapshot: live({ failingCameras: [fcam(1)] }),
            initialState: { firstSeen: { 1: 0 }, reported: [], lastNagMs: null, stallActive: false },
        });
        expect((await service.checkAndAlert(GRACE + 1)).failing).toBe('alert');
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('does not commit a failing alert when the send fails, and retries next tick', async () => {
        const saveState = vi.fn();
        const sendMessage = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const service = createArchiveUploadAlertService({
            getSnapshot: () => live({ failingCameras: [fcam(1)] }),
            sidecarAvailable: () => true, hasRoutes: () => true, sendMessage,
            telegramConfigured: () => true, isEnabled: () => true, exemptIds: () => new Set(),
            loadState: () => ({ firstSeen: { 1: 0 }, reported: [], lastNagMs: null, stallActive: false }),
            saveState, graceMs: GRACE, renagMs: RENAG, stallMinutes: STALL, failWindowMinutes: 45,
            logger: { error: () => {} },
        });

        const r1 = await service.checkAndAlert(GRACE + 1);
        expect(r1.failing).toBeUndefined();
        expect(saveState.mock.calls.every((c) => c[0].reported.length === 0)).toBe(true);

        const r2 = await service.checkAndAlert(GRACE + 2);
        expect(r2.failing).toBe('alert');
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});
