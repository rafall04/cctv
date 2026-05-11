/**
 * Purpose: Verify Telegram multi-target camera notification routing and on-demand filtering.
 * Caller: Backend Vitest suite for services/telegramService.js.
 * Deps: Vitest, mocked database settings, mocked timezone, global fetch.
 * MainFuncs: sendCameraStatusNotifications.
 * SideEffects: Mocks Telegram HTTP calls; no real network or database writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock, executeMock } = vi.hoisted(() => ({
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
}));

vi.mock('../database/database.js', () => ({
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    formatDateTime: () => '2026-05-05 04:10:00',
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
});
