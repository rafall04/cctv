/**
 * Purpose: Verify the interactive Telegram bot's orchestration — authorization gate,
 *          command/callback routing, approve/topup/suspend actions, drain-on-start poll
 *          loop, and the new-registration notification. Real presenter, mocked I/O.
 * Caller: Backend Vitest suite for services/telegramBotService.js.
 * Deps: Vitest; mocked telegramService API + billing/wallet services + connectionPool.
 * SideEffects: none (all network/db calls are mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    callTelegramApi: vi.fn(),
    getBotRuntimeConfig: vi.fn(),
    isCommandChat: vi.fn(),
    approveCustomer: vi.fn(),
    rejectCustomer: vi.fn(),
    listPendingRegistrations: vi.fn(),
    getPlanById: vi.fn(),
    listPlans: vi.fn(),
    changeUserPlan: vi.fn(),
    getCustomerBillingSummary: vi.fn(),
    tryResumeForUser: vi.fn(),
    updateSubscription: vi.fn(),
    credit: vi.fn(),
    logAdminAction: vi.fn(),
    query: vi.fn(),
    queryOne: vi.fn(),
}));

vi.mock('../services/telegramService.js', () => ({
    callTelegramApi: h.callTelegramApi,
    getBotRuntimeConfig: h.getBotRuntimeConfig,
    isCommandChat: h.isCommandChat,
}));
vi.mock('../services/billingPlanService.js', () => ({
    default: {
        approveCustomer: h.approveCustomer,
        rejectCustomer: h.rejectCustomer,
        listPendingRegistrations: h.listPendingRegistrations,
        getPlanById: h.getPlanById,
        listPlans: h.listPlans,
        changeUserPlan: h.changeUserPlan,
    },
}));
vi.mock('../services/billingService.js', () => ({
    default: {
        getCustomerBillingSummary: h.getCustomerBillingSummary,
        tryResumeForUser: h.tryResumeForUser,
        updateSubscription: h.updateSubscription,
    },
    dailyCostOf: (monthly) => Math.ceil(monthly / 30),
}));
vi.mock('../services/walletService.js', () => ({ default: { credit: h.credit } }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: h.logAdminAction }));
vi.mock('../services/timezoneService.js', () => ({ formatDateTime: () => '2026-06-13 10:00' }));
vi.mock('../database/connectionPool.js', () => ({ query: h.query, queryOne: h.queryOne }));

const { encodeCallback, ACTIONS } = await import('../services/telegramBotPresenter.js');
const { default: bot } = await import('../services/telegramBotService.js');

function apiCalls(method) {
    return h.callTelegramApi.mock.calls.filter((c) => c[0] === method).map((c) => c[1]);
}

beforeEach(() => {
    for (const fn of Object.values(h)) {
        fn.mockReset();
    }
    h.callTelegramApi.mockResolvedValue({ ok: true });
    h.isCommandChat.mockReturnValue(true);
    h.getBotRuntimeConfig.mockReturnValue({ hasToken: true, commandChatIds: ['-100'] });
    bot.isRunning = false;
    bot.offset = undefined;
    bot.tokenSeen = false;
    bot.startupLogged = false;
});

afterEach(() => {
    bot.stop();
});

describe('authorization gate', () => {
    it('denies commands from an unauthorized chat', async () => {
        h.isCommandChat.mockReturnValue(false);
        await bot.handleMessage({ chat: { id: '-999' }, from: { id: 1 }, text: '/pending' });
        const sent = apiCalls('sendMessage');
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain('Tidak diizinkan');
        expect(h.listPendingRegistrations).not.toHaveBeenCalled();
    });

    it('still answers /help (with chat id) for an unauthorized chat', async () => {
        h.isCommandChat.mockReturnValue(false);
        await bot.handleMessage({ chat: { id: '-999' }, from: { id: 1 }, text: '/help' });
        expect(apiCalls('sendMessage')[0].text).toContain('belum diizinkan');
        expect(apiCalls('sendMessage')[0].text).toContain('-999');
    });

    it('denies a button tap from an unauthorized chat', async () => {
        h.isCommandChat.mockReturnValue(false);
        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.APPROVE, 5), message: { chat: { id: '-999' }, message_id: 1 }, from: { id: 1 } });
        const answered = apiCalls('answerCallbackQuery');
        expect(answered[0]).toMatchObject({ show_alert: true });
        expect(answered[0].text).toContain('Tidak diizinkan');
        expect(h.approveCustomer).not.toHaveBeenCalled();
    });
});

describe('approve / reject via button', () => {
    it('approves and edits the card to a result', async () => {
        h.approveCustomer.mockReturnValue({ username: 'budi' });
        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.APPROVE, 42), message: { chat: { id: '-100' }, message_id: 9 }, from: { id: 1, username: 'admin' } });

        expect(h.approveCustomer).toHaveBeenCalledWith(42, expect.objectContaining({ ip: 'telegram-bot' }));
        const edit = apiCalls('editMessageText')[0];
        expect(edit.text).toContain('disetujui');
        expect(edit.text).toContain('budi');
        // resolved card clears its buttons
        expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
    });

    it('surfaces an approval error as an alert without editing', async () => {
        h.approveCustomer.mockImplementation(() => { throw new Error('Akun sudah disetujui'); });
        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.APPROVE, 42), message: { chat: { id: '-100' }, message_id: 9 }, from: { id: 1, username: 'admin' } });
        expect(apiCalls('answerCallbackQuery')[0]).toMatchObject({ show_alert: true, text: 'Akun sudah disetujui' });
        expect(apiCalls('editMessageText')).toHaveLength(0);
    });
});

describe('top-up execution', () => {
    it('credits the wallet, resumes, audits, and reports the new balance', async () => {
        h.queryOne.mockReturnValue({ id: 42, username: 'budi', phone: '0812', email: null, account_status: 'approved', plan_id: null });
        h.getCustomerBillingSummary.mockReturnValue({ balance: 10000, daily_cost: 0, estimated_days_left: null, low_balance: false, subscriptions: [] });
        h.credit.mockReturnValue({ balance_after: 60000 });
        h.tryResumeForUser.mockReturnValue({ resumedCameraIds: [3] });

        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.TOPUP_EXEC, 42, 50000), message: { chat: { id: '-100' }, message_id: 9 }, from: { id: 7, username: 'admin' } });

        expect(h.credit).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, amount: 50000, type: 'topup' }));
        expect(h.tryResumeForUser).toHaveBeenCalledWith(42);
        expect(h.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing_manual_topup', via: 'telegram', amount: 50000 }), expect.any(Object));
        const edit = apiCalls('editMessageText')[0];
        expect(edit.text).toContain('Rp60.000');
        expect(edit.text).toContain('1 kamera diaktifkan');
    });

    it('rejects an over-limit amount before crediting', async () => {
        h.queryOne.mockReturnValue({ id: 42, username: 'budi', plan_id: null });
        h.getCustomerBillingSummary.mockReturnValue({ balance: 0, daily_cost: 0, estimated_days_left: null, low_balance: false, subscriptions: [] });
        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.TOPUP_EXEC, 42, 99999999), message: { chat: { id: '-100' }, message_id: 9 }, from: { id: 7, username: 'admin' } });
        expect(h.credit).not.toHaveBeenCalled();
        expect(apiCalls('answerCallbackQuery')[0]).toMatchObject({ show_alert: true });
    });
});

describe('suspend via button', () => {
    it('suspends only active subscriptions and audits', async () => {
        h.queryOne.mockReturnValue({ id: 42, username: 'budi', plan_id: null, account_status: 'approved' });
        h.getCustomerBillingSummary.mockReturnValue({
            balance: 0, daily_cost: 0, estimated_days_left: null, low_balance: false,
            subscriptions: [
                { id: 11, camera_name: 'A', status: 'active', monthly_price: 25000 },
                { id: 12, camera_name: 'B', status: 'suspended', monthly_price: 25000 },
            ],
        });
        await bot.handleCallback({ id: 'cb', data: encodeCallback(ACTIONS.SUSPEND_EXEC, 42), message: { chat: { id: '-100' }, message_id: 9 }, from: { id: 7, username: 'admin' } });
        expect(h.updateSubscription).toHaveBeenCalledTimes(1);
        expect(h.updateSubscription).toHaveBeenCalledWith(11, { status: 'suspended' }, expect.any(Object));
        expect(apiCalls('editMessageText')[0].text).toContain('disuspend');
    });
});

describe('notifyNewRegistration', () => {
    it('sends an approve/reject card to every command chat', async () => {
        h.getBotRuntimeConfig.mockReturnValue({ hasToken: true, commandChatIds: ['-100', '-200'] });
        h.queryOne.mockReturnValue({ id: 42, username: 'budi', phone: '0812', email: null, plan_id: 1 });
        h.getPlanById.mockReturnValue({ name: 'Trial', is_trial: 1 });

        await bot.notifyNewRegistration(42);

        const sent = apiCalls('sendMessage');
        expect(sent.map((s) => s.chat_id)).toEqual(['-100', '-200']);
        expect(sent[0].text).toContain('Pendaftaran Pelanggan Baru');
        expect(sent[0].text).toContain('budi');
    });

    it('no-ops when no token or no command chat is configured', async () => {
        h.getBotRuntimeConfig.mockReturnValue({ hasToken: false, commandChatIds: [] });
        await bot.notifyNewRegistration(42);
        expect(apiCalls('sendMessage')).toHaveLength(0);
    });
});

describe('every command produces a response (authorized chat)', () => {
    const commands = ['/start', '/help', '/id', '/pending', '/customers', '/customer 1', '/stats', '/topup 1 50000', '/suspend 1', '/resume 1', '/plan 1'];

    it.each(commands)('responds to %s', async (text) => {
        h.listPendingRegistrations.mockReturnValue([]);
        h.listPlans.mockReturnValue([]);
        h.query.mockReturnValue([]);
        h.queryOne.mockReturnValue({ id: 1, username: 'budi', phone: '0812', email: null, plan_id: null, account_status: 'approved', n: 0, total: 0 });
        h.getCustomerBillingSummary.mockReturnValue({ balance: 0, daily_cost: 0, estimated_days_left: null, low_balance: false, subscriptions: [] });
        h.tryResumeForUser.mockReturnValue({ resumedCameraIds: [] });

        await bot.handleMessage({ chat: { id: '-100' }, from: { id: 1, username: 'a' }, text });

        expect(h.callTelegramApi).toHaveBeenCalledWith('sendMessage', expect.objectContaining({ chat_id: '-100' }));
    });
});

describe('logBotHealth', () => {
    it('probes getMe + getWebhookInfo so a bad token / stale webhook is visible', async () => {
        h.callTelegramApi.mockResolvedValue({ ok: true, result: { username: 'RafBot', id: 5, url: '' } });
        await bot.logBotHealth();
        const methods = h.callTelegramApi.mock.calls.map((c) => c[0]);
        expect(methods).toContain('getMe');
        expect(methods).toContain('getWebhookInfo');
    });
});

describe('poll loop', () => {
    it('drains backlog on start, then handles a live update and advances the offset', async () => {
        // Short-poll: drain AND live use timeout=0, so count getUpdates calls instead.
        // Call 1 = drain (empty → drain exits); call 2 = live update; call 3 = stop.
        let getUpdatesCalls = 0;
        h.query.mockReturnValue([]);
        h.queryOne.mockReturnValue({ n: 0, total: 0 });
        h.callTelegramApi.mockImplementation(async (method) => {
            if (method !== 'getUpdates') {
                return { ok: true };
            }
            getUpdatesCalls += 1;
            if (getUpdatesCalls === 1) {
                return { ok: true, result: [] }; // drain → nothing queued
            }
            if (getUpdatesCalls === 2) {
                return { ok: true, result: [{ update_id: 100, message: { chat: { id: '-100' }, from: { id: 1, username: 'a' }, text: '/stats' } }] };
            }
            bot.stop();
            return { ok: true, result: [] };
        });

        bot.start();
        await bot.loopPromise;

        const sent = apiCalls('sendMessage');
        expect(sent.some((s) => /Ringkasan/.test(s.text))).toBe(true);
        expect(bot.offset).toBe(101);
    });

    it('stays idle (no getUpdates) until a token is configured', async () => {
        h.getBotRuntimeConfig.mockReturnValue({ hasToken: false, commandChatIds: [] });
        bot.start();
        // let the first loop iteration run, then abort the idle sleep
        await Promise.resolve();
        bot.stop();
        await bot.loopPromise;
        expect(apiCalls('getUpdates')).toHaveLength(0);
    });
});
