/**
 * Purpose: Verify the Telegram '/darurat' emergency command module — lists presets as buttons, the
 *          two-step confirm (FIRE -> confirm card -> EXEC -> fireEmergency), result rendering, audit
 *          logging, and that unrelated callback actions are NOT handled (return undefined). Security note:
 *          authorization is enforced by telegramBotService's isCommandChat gate BEFORE this module is
 *          reached, so these tests cover routing/behaviour, not the gate.
 * Caller: Backend Vitest suite for services/telegramEmergencyCommand.js.
 * Deps: Vitest; mocked audioEmergencyService + securityAuditLogger; real presenter; a fake bot.
 * SideEffects: none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ listPresets: vi.fn(), fireEmergency: vi.fn(), logAdminAction: vi.fn() }));

vi.mock('../services/audioEmergencyService.js', () => ({
    listPresets: h.listPresets,
    fireEmergency: h.fireEmergency,
}));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: h.logAdminAction }));

const { encodeCallback } = await import('../services/telegramBotPresenter.js');
const emergencyCmd = (await import('../services/telegramEmergencyCommand.js')).default;

const PRESET = {
    id: 7, label: 'Banjir', source_type: 'clip', source_id: 3, target_kind: 'area', area_id: 2,
    camera_ids: [10, 11], device_ids: [5], loop: 3, gain_db: 0, siren: 1,
};

function fakeBot() {
    return {
        sendMessage: vi.fn(async () => ({ ok: true })),
        editMessage: vi.fn(async () => ({ ok: true })),
        answerCallback: vi.fn(async () => ({ ok: true })),
        botRequest: vi.fn(() => ({ ip: 'telegram' })),
    };
}

beforeEach(() => { for (const fn of Object.values(h)) fn.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('telegramEmergencyCommand', () => {
    it('/darurat lists each preset as a button encoding efire:<id>', async () => {
        h.listPresets.mockReturnValue([PRESET, { ...PRESET, id: 8, label: 'Kebakaran' }]);
        const bot = fakeBot();
        await emergencyCmd.handleCommand(bot, 99);
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        const msg = bot.sendMessage.mock.calls[0][1];
        const flat = msg.reply_markup.inline_keyboard.flat();
        expect(flat.some((b) => b.callback_data === encodeCallback('efire', 7))).toBe(true);
        expect(flat.some((b) => b.callback_data === encodeCallback('efire', 8))).toBe(true);
    });

    it('/darurat with no presets tells the operator to create one', async () => {
        h.listPresets.mockReturnValue([]);
        const bot = fakeBot();
        await emergencyCmd.handleCommand(bot, 99);
        expect(bot.sendMessage.mock.calls[0][1].text).toMatch(/belum ada preset/i);
        expect(h.fireEmergency).not.toHaveBeenCalled();
    });

    it('efire shows a confirm card with an efix button and does NOT fire yet', async () => {
        h.listPresets.mockReturnValue([PRESET]);
        const bot = fakeBot();
        await emergencyCmd.handleCallback(bot, { id: 'cq1' }, 99, 500, 'efire', ['7'], { name: 'aldi' });
        expect(h.fireEmergency).not.toHaveBeenCalled();
        const edit = bot.editMessage.mock.calls[0][2];
        expect(edit.text).toMatch(/Konfirmasi/i);
        expect(edit.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === encodeCallback('efix', 7))).toBe(true);
    });

    it('efix fires the preset and reports the result + audit', async () => {
        h.listPresets.mockReturnValue([PRESET]);
        h.fireEmergency.mockResolvedValue({ results: [{ ok: true }, { ok: false }], devices: 1, sirens: 2 });
        const bot = fakeBot();
        await emergencyCmd.handleCallback(bot, { id: 'cq2' }, 99, 500, 'efix', ['7'], { name: 'aldi' });
        expect(h.fireEmergency).toHaveBeenCalledTimes(1);
        const arg = h.fireEmergency.mock.calls[0][0];
        expect(arg).toMatchObject({ sourceType: 'clip', sourceId: 3, targetKind: 'area', areaId: 2, cameraIds: [10, 11], deviceIds: [5], siren: true });
        expect(h.logAdminAction).toHaveBeenCalledTimes(1);
        const result = bot.editMessage.mock.calls[0][2].text;
        expect(result).toMatch(/1\/2/); // 1 of 2 cameras ok
    });

    it('efix surfaces a fireEmergency failure instead of throwing', async () => {
        h.listPresets.mockReturnValue([PRESET]);
        h.fireEmergency.mockRejectedValue(new Error('Tak ada kamera/titik speaker untuk target darurat ini'));
        const bot = fakeBot();
        await emergencyCmd.handleCallback(bot, { id: 'cq3' }, 99, 500, 'efix', ['7'], { name: 'aldi' });
        expect(bot.editMessage.mock.calls[0][2].text).toMatch(/GAGAL/i);
    });

    it('ignores unrelated callback actions (returns undefined)', async () => {
        const bot = fakeBot();
        const out = await emergencyCmd.handleCallback(bot, { id: 'cq4' }, 99, 500, 'appr', ['1'], { name: 'aldi' });
        expect(out).toBeUndefined();
        expect(bot.answerCallback).not.toHaveBeenCalled();
        expect(h.fireEmergency).not.toHaveBeenCalled();
    });

    it('efire/efix on a missing preset alerts, never fires', async () => {
        h.listPresets.mockReturnValue([PRESET]);
        const bot = fakeBot();
        await emergencyCmd.handleCallback(bot, { id: 'cq5' }, 99, 500, 'efix', ['999'], { name: 'aldi' });
        expect(h.fireEmergency).not.toHaveBeenCalled();
        expect(bot.answerCallback).toHaveBeenCalledWith('cq5', expect.stringMatching(/tidak ditemukan/i), { alert: true });
    });
});
