/**
 * Purpose: Verify the pure Telegram-bot presentation layer — command parsing, callback
 *          encode/decode round-trips, rupiah/HTML formatting, and inline-keyboard wiring.
 * Caller: Backend Vitest suite for services/telegramBotPresenter.js.
 * Deps: Vitest only (the module under test is pure — no mocks needed).
 * MainFuncs: parseCommand, encodeCallback/decodeCallback, build* builders.
 * SideEffects: none.
 */

import { describe, expect, it } from 'vitest';
import * as presenter from '../services/telegramBotPresenter.js';

const { ACTIONS } = presenter;

function callbacks(markup) {
    return (markup.inline_keyboard || []).flat().map((b) => b.callback_data);
}

describe('parseCommand', () => {
    it('parses a bare command', () => {
        expect(presenter.parseCommand('/pending')).toEqual({ command: 'pending', args: [], argsText: '' });
    });

    it('splits arguments and joins argsText', () => {
        expect(presenter.parseCommand('/topup 12 50000')).toEqual({
            command: 'topup', args: ['12', '50000'], argsText: '12 50000',
        });
    });

    it('strips a trailing @BotName and lowercases the verb', () => {
        expect(presenter.parseCommand('/Help@RafNetBot')).toEqual({ command: 'help', args: [], argsText: '' });
    });

    it('returns null for non-commands and bare slash', () => {
        expect(presenter.parseCommand('halo')).toBeNull();
        expect(presenter.parseCommand('/')).toBeNull();
        expect(presenter.parseCommand(123)).toBeNull();
    });
});

describe('callback encoding', () => {
    it('round-trips action + params', () => {
        const data = presenter.encodeCallback(ACTIONS.TOPUP_EXEC, 42, 50000);
        expect(data).toBe('t1:xtu:42:50000');
        expect(presenter.decodeCallback(data)).toEqual({ action: 'xtu', params: ['42', '50000'] });
    });

    it('rejects a wrong/absent version prefix and garbage', () => {
        expect(presenter.decodeCallback('t0:appr:1')).toBeNull();
        expect(presenter.decodeCallback('appr:1')).toBeNull();
        expect(presenter.decodeCallback('')).toBeNull();
        expect(presenter.decodeCallback(null)).toBeNull();
    });

    it('keeps payloads within Telegram 64-byte limit for realistic ids', () => {
        const data = presenter.encodeCallback(ACTIONS.PLAN_SET, 999999, 999999);
        expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    });
});

describe('formatting helpers', () => {
    it('formats rupiah with id-ID grouping', () => {
        expect(presenter.formatRupiah(50000)).toBe('Rp50.000');
        expect(presenter.formatRupiah(0)).toBe('Rp0');
        expect(presenter.formatRupiah('abc')).toBe('Rp0');
    });

    it('escapes HTML-significant characters', () => {
        expect(presenter.escapeHtml('<b>a&b</b>')).toBe('&lt;b&gt;a&amp;b&lt;/b&gt;');
    });
});

describe('buildRegistrationAlert', () => {
    it('includes customer details and approve/reject buttons', () => {
        const msg = presenter.buildRegistrationAlert({
            id: 42, username: 'budi', phone: '0812', email: 'b@x.id',
            plan: { name: 'Trial', is_trial: true },
        });
        expect(msg.text).toContain('budi');
        expect(msg.text).toContain('Pendaftaran Pelanggan Baru');
        expect(callbacks(msg.reply_markup)).toEqual(expect.arrayContaining([
            presenter.encodeCallback(ACTIONS.APPROVE, 42),
            presenter.encodeCallback(ACTIONS.REJECT, 42),
            presenter.encodeCallback(ACTIONS.CUSTOMER, 42),
        ]));
    });

    it('escapes a malicious username', () => {
        const msg = presenter.buildRegistrationAlert({ id: 1, username: '<script>', phone: '', plan: null });
        expect(msg.text).toContain('&lt;script&gt;');
        expect(msg.text).not.toContain('<script>');
    });
});

describe('buildCustomerDetail', () => {
    const base = {
        id: 7, username: 'budi', phone: '0812', email: null, account_status: 'approved',
        plan: { name: 'Basic', is_trial: false }, balance: 30000, daily_cost: 833,
        estimated_days_left: 36, low_balance: false,
    };

    it('shows suspend when there is an active sub and resume when suspended', () => {
        const msg = presenter.buildCustomerDetail({
            ...base,
            subscriptions: [
                { camera_name: 'Cam A', status: 'active', monthly_price: 25000 },
                { camera_name: 'Cam B', status: 'suspended', monthly_price: 25000 },
            ],
        }, { writeEnabled: { topup: true, suspendResume: true, changePlan: true } });
        const cbs = callbacks(msg.reply_markup);
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.SUSPEND_CONFIRM, 7));
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.RESUME_EXEC, 7));
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.TOPUP_AMOUNTS, 7));
        expect(msg.text).toContain('Rp30.000');
    });

    it('offers approve/reject for a pending account', () => {
        const msg = presenter.buildCustomerDetail({ ...base, account_status: 'pending', subscriptions: [] });
        const cbs = callbacks(msg.reply_markup);
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.APPROVE, 7));
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.REJECT, 7));
    });

    it('honors disabled write features', () => {
        const msg = presenter.buildCustomerDetail({
            ...base, subscriptions: [{ camera_name: 'A', status: 'active', monthly_price: 25000 }],
        }, { writeEnabled: { topup: false, suspendResume: false, changePlan: false } });
        const cbs = callbacks(msg.reply_markup);
        expect(cbs).not.toContain(presenter.encodeCallback(ACTIONS.TOPUP_AMOUNTS, 7));
        expect(cbs).not.toContain(presenter.encodeCallback(ACTIONS.SUSPEND_CONFIRM, 7));
    });
});

describe('buildCustomersPage', () => {
    const customers = [
        { id: 1, username: 'a', account_status: 'approved', balance: 1000, camera_count: 1, suspended_subscriptions: 0 },
        { id: 2, username: 'b', account_status: 'pending', balance: 0, camera_count: 0, suspended_subscriptions: 0 },
    ];

    it('shows only "next" on the first of several pages', () => {
        const cbs = callbacks(presenter.buildCustomersPage({ customers, page: 0, pageCount: 3, total: 14, query: '' }).reply_markup);
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.CUSTOMERS_PAGE, 1));
        expect(cbs).not.toContain(presenter.encodeCallback(ACTIONS.CUSTOMERS_PAGE, -1));
    });

    it('shows both nav buttons on a middle page', () => {
        const cbs = callbacks(presenter.buildCustomersPage({ customers, page: 1, pageCount: 3, total: 14, query: '' }).reply_markup);
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.CUSTOMERS_PAGE, 0));
        expect(cbs).toContain(presenter.encodeCallback(ACTIONS.CUSTOMERS_PAGE, 2));
    });

    it('renders an empty result without a keyboard', () => {
        const msg = presenter.buildCustomersPage({ customers: [], page: 0, pageCount: 1, total: 0, query: 'zzz' });
        expect(msg.text).toContain('Tidak ada pelanggan');
        expect(msg.reply_markup).toBeUndefined();
    });
});

describe('Telegram HTML safety (no stray < / > that break parse_mode=HTML)', () => {
    // Strip the tags we actually use + escaped entities; anything left with < or >
    // is an unescaped angle bracket Telegram would reject with HTTP 400.
    const ALLOWED_TAGS = /<\/?(?:b|i|u|s|code|pre|a)(?:\s[^>]*)?>/g;
    const strayAngles = (text) => text.replace(ALLOWED_TAGS, '').replace(/&lt;|&gt;|&amp;/g, '');

    it('stats message has no stray "<" (regression: the "<3 hari" bug)', () => {
        const msg = presenter.buildStatsMessage({
            customersTotal: 5, pending: 1, approved: 3, rejected: 1, subsActive: 2,
            subsSuspended: 1, customersWithSuspended: 1, walletTotal: 1000, lowBalanceCount: 2,
            generatedAt: '2026-06-13 10:00',
        });
        expect(msg.text).toContain('&lt;3 hari');
        expect(strayAngles(msg.text)).not.toMatch(/[<>]/);
    });

    it('escapes angle brackets coming from customer-supplied fields', () => {
        const reg = presenter.buildRegistrationAlert({ id: 1, username: '<a>&b', phone: '<x>', email: '<e>', plan: { name: '<p>', is_trial: false } });
        expect(strayAngles(reg.text)).not.toMatch(/[<>]/);

        const detail = presenter.buildCustomerDetail({
            id: 1, username: '<u>', phone: '<p>', email: null, account_status: 'approved',
            plan: { name: '<plan>', is_trial: false }, balance: 0, daily_cost: 0,
            estimated_days_left: 3, low_balance: true,
            subscriptions: [{ camera_name: '<cam>', status: 'active', monthly_price: 1000 }],
        });
        expect(strayAngles(detail.text)).not.toMatch(/[<>]/);

        const page = presenter.buildCustomersPage({
            customers: [{ id: 1, username: '<x>', account_status: 'approved', balance: 0, camera_count: 0, suspended_subscriptions: 0 }],
            page: 0, pageCount: 1, total: 1, query: '<q>',
        });
        expect(strayAngles(page.text)).not.toMatch(/[<>]/);
    });
});

describe('buildTopupConfirm / buildStatsMessage', () => {
    it('encodes the exact amount into the confirm button', () => {
        const msg = presenter.buildTopupConfirm({ customer: { id: 9, username: 'budi', balance: 10000 }, amount: 50000 });
        expect(callbacks(msg.reply_markup)).toContain(presenter.encodeCallback(ACTIONS.TOPUP_EXEC, 9, 50000));
        expect(msg.text).toContain('Rp60.000'); // balance after
    });

    it('summarizes stats counts', () => {
        const msg = presenter.buildStatsMessage({
            customersTotal: 10, pending: 2, approved: 7, rejected: 1,
            subsActive: 5, subsSuspended: 1, customersWithSuspended: 1,
            walletTotal: 500000, lowBalanceCount: 3, generatedAt: '2026-06-13 10:00',
        });
        expect(msg.text).toContain('Total: 10');
        expect(msg.text).toContain('Menunggu persetujuan: 2');
        expect(msg.text).toContain('Rp500.000');
    });
});
