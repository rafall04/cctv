/**
 * Purpose: Verify Telegram multi-target camera notification routing and on-demand filtering.
 * Caller: Backend Vitest suite for services/telegramService.js.
 * Deps: Vitest, mocked database settings, mocked timezone, global fetch.
 * MainFuncs: sendCameraStatusNotifications.
 * SideEffects: Mocks Telegram HTTP calls; no real network or database writes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock, executeMock } = vi.hoisted(() => ({
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
}));

const ORIGINAL_TELEGRAM_ENV = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_MONITORING_CHAT_ID: process.env.TELEGRAM_MONITORING_CHAT_ID,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_FEEDBACK_CHAT_ID: process.env.TELEGRAM_FEEDBACK_CHAT_ID,
};

vi.mock('../database/database.js', () => ({
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    formatDateTime: (date) => {
        const value = date instanceof Date ? date : new Date(date);
        return value.toISOString().replace('T', ' ').replace('.000Z', '');
    },
}));

async function loadTelegramService(config) {
    vi.resetModules();
    queryOneMock.mockReturnValue({
        value: JSON.stringify(config),
    });
    return import('../services/telegramService.js');
}

describe('telegramService notification routing', () => {
    beforeEach(() => {
        queryOneMock.mockReset();
        executeMock.mockReset();
        global.fetch = vi.fn(async () => ({
            json: async () => ({ ok: true }),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_ENV.TELEGRAM_BOT_TOKEN;
        process.env.TELEGRAM_MONITORING_CHAT_ID = ORIGINAL_TELEGRAM_ENV.TELEGRAM_MONITORING_CHAT_ID;
        process.env.TELEGRAM_CHAT_ID = ORIGINAL_TELEGRAM_ENV.TELEGRAM_CHAT_ID;
        process.env.TELEGRAM_FEEDBACK_CHAT_ID = ORIGINAL_TELEGRAM_ENV.TELEGRAM_FEEDBACK_CHAT_ID;
    });

    it('routes one camera event to an area target and excludes on-demand cameras by default', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '-100-main',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['offline'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        await telegram.sendCameraStatusNotifications('offline', [
            {
                id: 10,
                name: 'CCTV Lokal',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
            },
            {
                id: 11,
                name: 'CCTV Surabaya',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                source_profile: 'surabaya_private_rtsp',
            },
        ]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.chat_id).toBe('-100-area');
        expect(payload.text).toContain('CCTV Lokal');
        expect(payload.text).not.toContain('CCTV Surabaya');
    });

    it('includes per-camera detected DOWN time and alert send time in grouped notifications', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-13T07:23:00.000Z'));
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '-100-main',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['offline'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        await telegram.sendCameraStatusNotifications('offline', [
            {
                id: 10,
                name: 'CCTV Lokal',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
                alertDetectedAt: 1_778_656_860_000,
            },
        ], { bypassCooldown: true });

        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.text).toContain('1. CCTV Lokal');
        expect(payload.text).toContain('Terdeteksi DOWN: 2026-05-13 07:21:00');
        expect(payload.text).toContain('Alert dikirim: 2026-05-13 07:23:00');
    });

    it('includes per-camera detected UP time in grouped recovery notifications', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-13T07:26:00.000Z'));
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '-100-main',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        await telegram.sendCameraStatusNotifications('online', [
            {
                id: 10,
                name: 'CCTV Lokal',
                area_id: 7,
                area_name: 'KAB BOJONEGORO',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
                alertDetectedAt: 1_778_657_100_000,
            },
        ], { bypassCooldown: true });

        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.text).toContain('1. CCTV Lokal');
        expect(payload.text).toContain('Terdeteksi UP: 2026-05-13 07:25:00');
        expect(payload.text).toContain('Alert dikirim: 2026-05-13 07:26:00');
    });

    it('dedupes identical chat IDs when a camera matches multiple rules', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            notificationTargets: [
                { id: 'noc', name: 'NOC', chatId: '-100-noc' },
            ],
            notificationRules: [
                { id: 'global', enabled: true, targetId: 'noc', scope: 'global', events: ['online'], ingestModes: ['always_on'] },
                { id: 'camera', enabled: true, targetId: 'noc', scope: 'camera', cameraId: 20, events: ['online'], ingestModes: ['always_on'] },
            ],
        });

        await telegram.sendCameraStatusNotifications('online', [
            {
                id: 20,
                name: 'CCTV VIP',
                area_id: 8,
                area_name: 'KAB TUBAN',
                delivery_type: 'internal_hls',
                internal_ingest_policy_override: 'always_on',
            },
        ]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.chat_id).toBe('-100-noc');
        expect(payload.text).toContain('CCTV VIP');
    });

    it('preserves the existing full bot token when admin saves a masked token', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:real-secret-token',
            monitoringChatId: '-100-main',
            feedbackChatId: '',
            notificationTargets: [],
            notificationRules: [],
        });

        queryOneMock.mockReturnValueOnce({
            value: JSON.stringify({
                botToken: '123456789:real-secret-token',
                monitoringChatId: '-100-main',
                feedbackChatId: '',
                notificationTargets: [],
                notificationRules: [],
            }),
        });

        const saved = telegram.saveTelegramSettings({
            botToken: '123456789...',
            monitoringChatId: '-100-main',
            feedbackChatId: '',
            notificationTargets: [],
            notificationRules: [],
        });

        expect(saved).toBe(true);
        const savedPayload = JSON.parse(executeMock.mock.calls[0][1][0]);
        expect(savedPayload.botToken).toBe('123456789:real-secret-token');
    });

    it('reports camera monitoring configured when only custom routing targets exist', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'rule-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: 7,
                    events: ['offline', 'online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        const status = telegram.getTelegramStatus();

        expect(status.enabled).toBe(true);
        expect(status.monitoringConfigured).toBe(false);
        expect(status.cameraMonitoringConfigured).toBe(true);
        expect(status.notificationTargets).toHaveLength(1);
        expect(status.notificationRules).toHaveLength(1);
    });

    it('sends a test notification to a custom monitoring target by target id', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [],
        });

        const sent = await telegram.sendTestNotification('target', { targetId: 'area-bojonegoro' });

        expect(sent).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(payload.chat_id).toBe('-100-area');
        expect(payload.text).toContain('Area Bojonegoro');
    });

    it('does not send a custom target test for an unknown target id', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [],
        });

        const sent = await telegram.sendTestNotification('target', { targetId: 'missing-target' });

        expect(sent).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports invalid routing rules without sending them as healthy policy', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:test',
            monitoringChatId: '',
            feedbackChatId: '',
            notificationTargets: [
                { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area' },
            ],
            notificationRules: [
                {
                    id: 'missing-area',
                    enabled: true,
                    targetId: 'area-bojonegoro',
                    scope: 'area',
                    areaId: '',
                    events: ['offline'],
                    ingestModes: ['always_on'],
                },
                {
                    id: 'missing-target',
                    enabled: true,
                    targetId: 'unknown-target',
                    scope: 'global',
                    events: ['online'],
                    ingestModes: ['always_on'],
                },
            ],
        });

        const status = telegram.getTelegramStatus();

        expect(status.notificationRuleIssues).toEqual([
            {
                id: 'missing-area',
                severity: 'error',
                message: 'Rule area membutuhkan areaId valid.',
            },
            {
                id: 'missing-target',
                severity: 'error',
                message: 'Rule mengarah ke target Telegram yang tidak tersedia.',
            },
        ]);
    });

    it('previews camera routing for area-scoped Telegram notification rules', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:token',
            notificationTargets: [
                { id: 'area-a', name: 'Area A Group', chatId: '-1001', enabled: true },
                { id: 'area-b', name: 'Area B Group', chatId: '-1002', enabled: true },
            ],
            notificationRules: [
                { id: 'rule-area-a', targetId: 'area-a', scope: 'area', areaId: 10, events: ['offline'], ingestModes: ['any'], enabled: true },
                { id: 'rule-area-b', targetId: 'area-b', scope: 'area', areaId: 20, events: ['offline'], ingestModes: ['any'], enabled: true },
            ],
        });

        const preview = telegram.inspectCameraNotificationRouting('offline', {
            id: 7,
            name: 'Gate 1',
            area_id: 10,
            area_name: 'Area A',
            source_profile: 'internal',
            internal_ingest_policy_mode: 'always_on',
        });

        expect(preview.configured).toBe(true);
        expect(preview.matchedTargets).toEqual([
            expect.objectContaining({ id: 'area-a', name: 'Area A Group', chatIdMasked: '-1001' }),
        ]);
        expect(preview.matchedRules).toEqual([
            expect.objectContaining({ id: 'rule-area-a', targetId: 'area-a', matched: true }),
        ]);
        expect(preview.unmatchedRules).toEqual([
            expect.objectContaining({ id: 'rule-area-b', targetId: 'area-b', matched: false }),
        ]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns disabled reason when no Telegram target matches a camera event', async () => {
        const telegram = await loadTelegramService({
            botToken: '123456789:token',
            notificationTargets: [{ id: 'online-only', name: 'Online Group', chatId: '-1009', enabled: true }],
            notificationRules: [
                { id: 'online-rule', targetId: 'online-only', scope: 'global', events: ['online'], ingestModes: ['any'], enabled: true },
            ],
        });

        const preview = telegram.inspectCameraNotificationRouting('offline', {
            id: 7,
            name: 'Gate 1',
            area_id: 10,
            area_name: 'Area A',
        });

        expect(preview.configured).toBe(true);
        expect(preview.canSend).toBe(false);
        expect(preview.skippedReason).toBe('NO_MATCHING_TARGET');
        expect(preview.matchedTargets).toEqual([]);
    });

    it('falls back to env Telegram config when DB config is missing', async () => {
        vi.resetModules();
        queryOneMock.mockReturnValue(null);
        process.env.TELEGRAM_BOT_TOKEN = '123456789:env-token';
        process.env.TELEGRAM_MONITORING_CHAT_ID = '-100-env-monitoring';
        process.env.TELEGRAM_CHAT_ID = '';
        process.env.TELEGRAM_FEEDBACK_CHAT_ID = '';

        const telegram = await import('../services/telegramService.js');
        const status = telegram.getTelegramStatus();

        expect(status.cameraMonitoringConfigured).toBe(true);
        expect(status.monitoringChatId).toBe('-100-env-monitoring');
    });

    it('keeps DB Telegram config ahead of env fallback', async () => {
        vi.resetModules();
        process.env.TELEGRAM_BOT_TOKEN = '123456789:env-token';
        process.env.TELEGRAM_MONITORING_CHAT_ID = '-100-env-monitoring';
        queryOneMock.mockReturnValue({
            value: JSON.stringify({
                botToken: '123456789:db-token',
                monitoringChatId: '-100-db-monitoring',
                feedbackChatId: '',
                notificationTargets: [],
                notificationRules: [],
            }),
        });

        const telegram = await import('../services/telegramService.js');
        const status = telegram.getTelegramStatus();

        expect(status.cameraMonitoringConfigured).toBe(true);
        expect(status.monitoringChatId).toBe('-100-db-monitoring');
    });
});
