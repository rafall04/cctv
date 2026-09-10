/*
 * Purpose: Prove every settings change is traceable — and that the trail never quotes a secret.
 * Caller: Backend Vitest suite.
 * Deps: mocked settingsService + securityAuditLogger, real settingsController.
 * MainFuncs: updateSetting audit tests.
 * SideEffects: None.
 *
 * PUT /api/settings/:key is the single endpoint behind branding, ads, Telegram routing, playback
 * policy and the backup destination — and it wrote NO audit at all. Production bore that out: not
 * one settings action existed in the log while 1,750 camera edits did. So a change to what the
 * public sees, or to where the database backup is sent, left no trace of who did it or what it was
 * before.
 *
 * The redaction half matters just as much: these rows hold bot tokens and gateway keys, and an
 * audit trail that copies values verbatim becomes the place credentials leak.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettingMock = vi.fn();
const getAllSettingsMock = vi.fn();
const updateSettingMock = vi.fn();
const logAdminActionMock = vi.fn();

vi.mock('../services/settingsService.js', () => ({
    default: { getSetting: getSettingMock, getAllSettings: getAllSettingsMock, updateSetting: updateSettingMock },
}));
vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
    TIMEZONE_MAP: { WIB: 'Asia/Jakarta' },
}));
vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: logAdminActionMock,
}));

const { updateSetting, getAllSettings, getSetting } = await import('../controllers/settingsController.js');

function makeReply() {
    return {
        statusCode: 200,
        body: null,
        code(status) { this.statusCode = status; return this; },
        send(payload) { this.body = payload; return this; },
    };
}

const request = (key, value) => ({ params: { key }, body: { value }, user: { id: 7 } });

beforeEach(() => {
    vi.clearAllMocks();
    updateSettingMock.mockReturnValue({ key: 'x', value: 'y' });
    getSettingMock.mockReturnValue({ value: 'lama' });
});

describe('updateSetting audit trail', () => {
    it('records who changed which key, and what it was BEFORE', async () => {
        await updateSetting(request('branding_name', 'RAF Baru'), makeReply());

        expect(logAdminActionMock).toHaveBeenCalledTimes(1);
        const [entry] = logAdminActionMock.mock.calls[0];
        expect(entry.action).toBe('UPDATE_SETTING');
        expect(entry.userId).toBe(7);
        expect(entry.details).toMatchObject({ key: 'branding_name', from: 'lama', to: 'RAF Baru' });
    });

    it('reads the previous value BEFORE the write — afterwards it is unrecoverable', async () => {
        const order = [];
        getSettingMock.mockImplementation(() => { order.push('read'); return { value: 'lama' }; });
        updateSettingMock.mockImplementation(() => { order.push('write'); return {}; });

        await updateSetting(request('branding_name', 'baru'), makeReply());

        expect(order).toEqual(['read', 'write']);
    });

    it('marks a key that did not exist yet as created, instead of failing', async () => {
        getSettingMock.mockImplementation(() => { const e = new Error('Setting not found'); e.statusCode = 404; throw e; });

        const reply = makeReply();
        await updateSetting(request('backup_telegram_chat_id', '-100123'), reply);

        expect(reply.statusCode).toBe(200);
        expect(logAdminActionMock.mock.calls[0][0].details).toMatchObject({ created: true, from: null });
    });

    it('never quotes a secret-looking KEY', async () => {
        getSettingMock.mockReturnValue({ value: 'token-lama-rahasia' });

        await updateSetting(request('ipaymu_api_key', 'token-baru-rahasia'), makeReply());

        const serialised = JSON.stringify(logAdminActionMock.mock.calls[0][0]);
        expect(serialised).not.toContain('token-lama-rahasia');
        expect(serialised).not.toContain('token-baru-rahasia');
        expect(serialised).toContain('[disunting]');
    });

    it('never quotes a secret-looking FIELD nested inside an object value', async () => {
        // telegram_config is the real case: an innocuous key holding a bot token.
        getSettingMock.mockReturnValue({ value: { botToken: 'AAA-lama', monitoringChatId: '-100' } });

        await updateSetting(
            request('telegram_config', { botToken: 'AAA-baru', monitoringChatId: '-200' }),
            makeReply()
        );

        const serialised = JSON.stringify(logAdminActionMock.mock.calls[0][0]);
        expect(serialised, 'a bot token must never reach the audit log').not.toContain('AAA-baru');
        expect(serialised).not.toContain('AAA-lama');
        // Non-secret siblings stay readable — that is the point of auditing at all.
        expect(serialised).toContain('-200');
    });

    it('truncates long free text so one landing-copy edit cannot bloat the log', async () => {
        getSettingMock.mockReturnValue({ value: '' });

        await updateSetting(request('landing_hero_text', 'x'.repeat(500)), makeReply());

        expect(logAdminActionMock.mock.calls[0][0].details.to.length).toBeLessThanOrEqual(121);
    });

    it('does not write an audit entry when the update itself fails', async () => {
        updateSettingMock.mockImplementation(() => { const e = new Error('nilai tidak valid'); e.statusCode = 400; throw e; });

        const reply = makeReply();
        await updateSetting(request('branding_name', ''), reply);

        expect(reply.statusCode).toBe(400);
        expect(logAdminActionMock).not.toHaveBeenCalled();
    });
});

describe('GET /api/settings — the generic dump never leaks a secret', () => {
    it('masks secret keys + nested tokens, but leaves non-secret values readable', async () => {
        getAllSettingsMock.mockReturnValue({
            ads_enabled: true,
            ipaymu_api_key: 'RAHASIA-IPAYMU',
            midtrans_server_key: 'RAHASIA-MIDTRANS', // used to slip past the pattern (no "api" before "key")
            telegram_config: { botToken: 'RAHASIA-BOT', monitoringChatId: '-100', enabled: true },
        });

        const reply = makeReply();
        await getAllSettings({}, reply);

        const serialised = JSON.stringify(reply.body.data);
        expect(serialised).not.toContain('RAHASIA-IPAYMU');
        expect(serialised).not.toContain('RAHASIA-MIDTRANS');
        expect(serialised).not.toContain('RAHASIA-BOT');
        // Non-secret data still flows through — the ads panel + telegram routing depend on it.
        expect(reply.body.data.ads_enabled).toBe(true);
        expect(reply.body.data.telegram_config.monitoringChatId).toBe('-100');
        expect(reply.body.data.telegram_config.enabled).toBe(true);
    });

    it('keeps an UNSET secret empty so configured-vs-empty stays visible', async () => {
        getAllSettingsMock.mockReturnValue({ ipaymu_api_key: '', midtrans_server_key: null });

        const reply = makeReply();
        await getAllSettings({}, reply);

        expect(reply.body.data.ipaymu_api_key).toBe('');
        expect(reply.body.data.midtrans_server_key).toBeNull();
    });
});

describe('GET /api/settings/:key — the sharper edge is masked too', () => {
    it('masks a directly-named secret value', async () => {
        getSettingMock.mockReturnValue({ key: 'ipaymu_api_key', value: 'RAHASIA-LANGSUNG', description: null });

        const reply = makeReply();
        await getSetting(request('ipaymu_api_key'), reply);

        expect(JSON.stringify(reply.body.data.value)).not.toContain('RAHASIA-LANGSUNG');
    });

    it('masks a nested bot token but keeps non-secret siblings', async () => {
        getSettingMock.mockReturnValue({ key: 'telegram_config', value: { botToken: 'RAHASIA-BOT', enabled: true }, description: null });

        const reply = makeReply();
        await getSetting(request('telegram_config'), reply);

        expect(JSON.stringify(reply.body.data.value)).not.toContain('RAHASIA-BOT');
        expect(reply.body.data.value.enabled).toBe(true);
    });
});
