/**
 * Purpose: Verify recordingHealthAlertService alerts only on health-level transitions.
 * Caller: Vitest backend suite.
 * Deps: createRecordingHealthAlertService with injected snapshot/send/config stubs.
 * MainFuncs: checkAndAlert.
 * SideEffects: None — Telegram send is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingHealthAlertService } from '../services/recordingHealthAlertService.js';
import settingsService from '../services/settingsService.js';

function snapshot(level, reasons = []) {
    return {
        status: { level, reasons },
        scheduler: { running: level !== 'critical', tasks: [] },
        recovery: { diagnostics: { activeTotal: 0, terminalTotal: reasons.length } },
    };
}

function build({ level = 'ok', enabled = true, configured = true } = {}) {
    const sendMessage = vi.fn().mockResolvedValue(true);
    let current = snapshot(level);
    const service = createRecordingHealthAlertService({
        healthService: { getSnapshot: () => current },
        sendMessage,
        telegramConfigured: () => configured,
        isEnabled: () => enabled,
        logger: { error: () => {} },
    });
    return {
        service,
        sendMessage,
        setSnapshot: (lvl, reasons) => { current = snapshot(lvl, reasons); },
    };
}

describe('recordingHealthAlertService.checkAndAlert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stays silent while the level does not change (ok → ok)', async () => {
        const { service, sendMessage } = build({ level: 'ok' });
        const result = await service.checkAndAlert();
        expect(result.changed).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('sends one alert when the level worsens to critical', async () => {
        const { service, sendMessage, setSnapshot } = build({ level: 'ok' });
        setSnapshot('critical', ['scheduler is not running']);

        const result = await service.checkAndAlert();

        expect(result).toMatchObject({ changed: true, level: 'critical', sent: true });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0]).toContain('scheduler is not running');
    });

    it('does not re-alert while the level stays critical (edge-triggered)', async () => {
        const { service, sendMessage, setSnapshot } = build({ level: 'ok' });
        setSnapshot('critical', ['scheduler is not running']);
        await service.checkAndAlert();
        await service.checkAndAlert();
        await service.checkAndAlert();
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends a recovery message when the level returns to ok', async () => {
        const { service, sendMessage, setSnapshot } = build({ level: 'ok' });
        setSnapshot('critical', ['scheduler is not running']);
        await service.checkAndAlert();
        setSnapshot('ok');

        const result = await service.checkAndAlert();

        expect(result).toMatchObject({ changed: true, level: 'ok' });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0]).toContain('Pulih');
    });

    it('skips entirely when alerts are disabled', async () => {
        const { service, sendMessage, setSnapshot } = build({ enabled: false });
        setSnapshot('critical', ['scheduler is not running']);
        const result = await service.checkAndAlert();
        expect(result).toEqual({ skipped: 'disabled' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips when Telegram is not configured', async () => {
        const { service, sendMessage, setSnapshot } = build({ configured: false });
        setSnapshot('critical', ['scheduler is not running']);
        const result = await service.checkAndAlert();
        expect(result).toEqual({ skipped: 'telegram_not_configured' });
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('recordingHealthAlertService default on/off reads the admin setting', () => {
    afterEach(() => vi.restoreAllMocks());

    // Build WITHOUT injecting isEnabled, so the module's own default reader runs — the one that
    // consults `recording_health_alerts_enabled` (settable from the Rekaman dashboard).
    function buildDefault() {
        const sendMessage = vi.fn().mockResolvedValue(true);
        let current = snapshot('ok');
        const service = createRecordingHealthAlertService({
            healthService: { getSnapshot: () => current },
            sendMessage,
            telegramConfigured: () => true,
            logger: { error: () => {} },
        });
        return { service, sendMessage, setSnapshot: (lvl, reasons) => { current = snapshot(lvl, reasons); } };
    }

    it('the setting = false silences alerts (skipped: disabled)', async () => {
        vi.spyOn(settingsService, 'getSettingValue').mockReturnValue(false);
        const { service, sendMessage, setSnapshot } = buildDefault();
        setSnapshot('critical', ['scheduler is not running']);
        expect(await service.checkAndAlert()).toEqual({ skipped: 'disabled' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('the setting = true lets the alert through', async () => {
        vi.spyOn(settingsService, 'getSettingValue').mockReturnValue(true);
        const { service, sendMessage, setSnapshot } = buildDefault();
        setSnapshot('critical', ['scheduler is not running']);
        const result = await service.checkAndAlert();
        expect(result).toMatchObject({ changed: true, level: 'critical', sent: true });
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});
