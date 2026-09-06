/**
 * Purpose: Verify archiveRouteAlertService — skip guards (disabled / not-configured / sidecar /
 *          cold-start / list-error), grace-then-alert, edge-trigger, recovery, subscriber &
 *          exempt exclusion, persisted (restart-proof) state, and commit-only-after-send.
 * Caller: Vitest backend suite.
 * Deps: createArchiveRouteAlertService with injected list/send/state stubs.
 * MainFuncs: checkAndAlert.
 * SideEffects: none — Telegram send and state persistence are stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArchiveRouteAlertService } from '../services/archiveRouteAlertService.js';
import settingsService from '../services/settingsService.js';

const GRACE = 6 * 60 * 60 * 1000;
const RENAG = 24 * 60 * 60 * 1000;
const cam = (id, name = `Cam ${id}`, areaName = 'DANDER', cameraClass = 'community') =>
    ({ id, name, areaName, cameraClass });

function build({
    unrouted = [],
    enabled = true,
    configured = true,
    available = true,
    routesConfigured = true,
    exempt = new Set(),
    initialState = null,
} = {}) {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const saveState = vi.fn();
    let current = unrouted;
    const service = createArchiveRouteAlertService({
        listUnrouted: () => current,
        sidecarAvailable: () => available,
        hasRoutes: () => routesConfigured,
        sendMessage,
        telegramConfigured: () => configured,
        isEnabled: () => enabled,
        exemptIds: () => exempt,
        loadState: () => initialState,
        saveState,
        graceMs: GRACE,
        renagMs: RENAG,
        logger: { error: () => {} },
    });
    return { service, sendMessage, saveState, setUnrouted: (list) => { current = list; } };
}

describe('archiveRouteAlertService.checkAndAlert — guards', () => {
    beforeEach(() => vi.clearAllMocks());

    it('skips when disabled', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)], enabled: false });
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'disabled' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips when Telegram is not configured', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)], configured: false });
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'telegram_not_configured' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips silently when the sidecar is not installed (would flag every camera)', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)], available: false });
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'sidecar_unavailable' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips on a cold-start box with no routes configured yet (no fleet dump)', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)], routesConfigured: false });
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'not_configured' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips gracefully when listing throws', async () => {
        const sendMessage = vi.fn();
        const service = createArchiveRouteAlertService({
            listUnrouted: () => { throw new Error('routes.json rusak'); },
            sidecarAvailable: () => true,
            hasRoutes: () => true,
            sendMessage,
            telegramConfigured: () => true,
            isEnabled: () => true,
            exemptIds: () => new Set(),
            loadState: () => null,
            saveState: vi.fn(),
            logger: { error: () => {} },
        });
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'list_error' });
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('archiveRouteAlertService.checkAndAlert — flow', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stays silent inside the grace window, then fires once past it', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1, 'CCTV BALAI DESA')] });
        expect((await service.checkAndAlert(0)).changed).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();

        const res = await service.checkAndAlert(GRACE + 1);
        expect(res).toMatchObject({ changed: true, type: 'alert', cameras: 1, sent: true });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const msg = sendMessage.mock.calls[0][0];
        expect(msg).toContain('CCTV BALAI DESA');
        expect(msg).toContain('/admin/telegram-archive');
    });

    it('does not re-alert while the same gap holds (edge-triggered)', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)] });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1);
        await service.checkAndAlert(GRACE + 2);
        await service.checkAndAlert(GRACE + 3);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends an honest recovery message once the gap is closed', async () => {
        const { service, sendMessage, setUnrouted } = build({ unrouted: [cam(1)] });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1); // alert
        setUnrouted([]);
        const res = await service.checkAndAlert(GRACE + 2);
        expect(res).toMatchObject({ changed: true, type: 'recover' });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        // Must NOT assert footage was backed up (the gap may have closed by disabling recording).
        expect(sendMessage.mock.calls[1][0]).toContain('Tidak Ada Kamera Terlewat');
        expect(sendMessage.mock.calls[1][0]).not.toContain('Sudah Dicadangkan');
    });

    it('renags with a reminder title after the renag window', async () => {
        const { service, sendMessage } = build({ unrouted: [cam(1)] });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1); // alert, lastNag = GRACE+1
        const res = await service.checkAndAlert(GRACE + 1 + RENAG);
        expect(res).toMatchObject({ changed: true, type: 'alert' });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0]).toContain('Pengingat');
    });
});

describe('archiveRouteAlertService — scope (subscriber & exempt)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('never nags about subscriber cameras (footage belongs to the customer)', async () => {
        const { service, sendMessage } = build({
            unrouted: [cam(1, 'Kamera Sewa', 'DANDER', 'subscriber')],
        });
        await service.checkAndAlert(0);
        expect((await service.checkAndAlert(GRACE + 1)).changed).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips a camera on the exempt list, alerts only the rest', async () => {
        const { service, sendMessage } = build({
            unrouted: [cam(1, 'Sengaja Lokal'), cam(2, 'Harus Diarsip')],
            exempt: new Set([1]),
        });
        await service.checkAndAlert(0);
        const res = await service.checkAndAlert(GRACE + 1);
        expect(res.cameras).toBe(1);
        expect(sendMessage.mock.calls[0][0]).toContain('Harus Diarsip');
        expect(sendMessage.mock.calls[0][0]).not.toContain('Sengaja Lokal');
    });
});

describe('archiveRouteAlertService — persistence & delivery', () => {
    beforeEach(() => vi.clearAllMocks());

    it('measures grace against PERSISTED firstSeen, so a long gap fires right after a restart', async () => {
        // Simulate a process that restarted: state persisted from before says cam1 was first seen
        // unrouted at t=0. Even on the very first tick after "boot", grace is already satisfied.
        const { service, sendMessage } = build({
            unrouted: [cam(1)],
            initialState: { firstSeen: { 1: 0 }, reported: [], lastNagMs: null },
        });
        const res = await service.checkAndAlert(GRACE + 1);
        expect(res).toMatchObject({ changed: true, type: 'alert' });
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('persists state after an alert so it survives a restart', async () => {
        const { service, saveState } = build({ unrouted: [cam(1)] });
        await service.checkAndAlert(0);
        await service.checkAndAlert(GRACE + 1);
        const lastSaved = saveState.mock.calls.at(-1)[0];
        expect(lastSaved.reported).toEqual([1]);
        expect(lastSaved.lastNagMs).toBe(GRACE + 1);
    });

    it('does NOT commit state when the send fails, and retries on the next tick', async () => {
        const saveState = vi.fn();
        const sendMessage = vi.fn()
            .mockResolvedValueOnce(false) // first attempt: delivery fails
            .mockResolvedValueOnce(true); // retry: succeeds
        let current = [cam(1)];
        const service = createArchiveRouteAlertService({
            listUnrouted: () => current,
            sidecarAvailable: () => true,
            hasRoutes: () => true,
            sendMessage,
            telegramConfigured: () => true,
            isEnabled: () => true,
            exemptIds: () => new Set(),
            loadState: () => ({ firstSeen: { 1: 0 }, reported: [], lastNagMs: null }),
            saveState,
            graceMs: GRACE,
            renagMs: RENAG,
            logger: { error: () => {} },
        });

        const first = await service.checkAndAlert(GRACE + 1);
        expect(first).toMatchObject({ type: 'alert', sent: false });
        // A failed send must not persist "reported" — otherwise the gap goes silent until renag.
        expect(saveState.mock.calls.every((c) => c[0].reported.length === 0)).toBe(true);

        const second = await service.checkAndAlert(GRACE + 2);
        expect(second).toMatchObject({ type: 'alert', sent: true });
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});

describe('archiveRouteAlertService default on/off reads the admin setting', () => {
    afterEach(() => vi.restoreAllMocks());

    // Build WITHOUT injecting isEnabled so the module's own reader runs (archive_route_alerts_enabled).
    function buildDefault(unrouted) {
        const sendMessage = vi.fn().mockResolvedValue(true);
        const service = createArchiveRouteAlertService({
            listUnrouted: () => unrouted,
            sidecarAvailable: () => true,
            hasRoutes: () => true,
            sendMessage,
            telegramConfigured: () => true,
            exemptIds: () => new Set(),
            loadState: () => null,
            saveState: vi.fn(),
            graceMs: GRACE,
            renagMs: RENAG,
            logger: { error: () => {} },
        });
        return { service, sendMessage };
    }

    it('the setting = false silences the nag', async () => {
        vi.spyOn(settingsService, 'getSettingValue').mockReturnValue(false);
        const { service, sendMessage } = buildDefault([cam(1)]);
        expect(await service.checkAndAlert(GRACE + 1)).toEqual({ skipped: 'disabled' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('the setting = true lets the nag through', async () => {
        vi.spyOn(settingsService, 'getSettingValue').mockReturnValue(true);
        const { service, sendMessage } = buildDefault([cam(1)]);
        await service.checkAndAlert(0);
        const res = await service.checkAndAlert(GRACE + 1);
        expect(res).toMatchObject({ changed: true, type: 'alert', sent: true });
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});
