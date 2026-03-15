// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLandingPublicConfig } from './useLandingPublicConfig';
import { LANDING_SCHEDULE_RECHECK_MS } from './landingScheduledContent';

const { getPublicSaweriaConfig, getPublicLandingPageSettings } = vi.hoisted(() => ({
    getPublicSaweriaConfig: vi.fn(),
    getPublicLandingPageSettings: vi.fn(),
}));

vi.mock('../../services/saweriaService', () => ({
    getPublicSaweriaConfig,
}));

vi.mock('../../services/settingsService', () => ({
    settingsService: {
        getPublicLandingPageSettings,
    },
}));

describe('useLandingPublicConfig', () => {
    const flushAsyncState = async () => {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-15T10:00:00'));

        getPublicSaweriaConfig.mockReset();
        getPublicLandingPageSettings.mockReset();

        getPublicSaweriaConfig.mockResolvedValue({
            success: true,
            data: {
                enabled: false,
                saweria_link: null,
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('re-evaluates announcement activity while mounted without refetching', async () => {
        getPublicLandingPageSettings.mockResolvedValue({
            success: true,
            data: {
                area_coverage: 'Coverage',
                hero_badge: 'Live',
                section_title: 'CCTV Publik',
                eventBanner: null,
                announcement: {
                    enabled: true,
                    title: 'Info',
                    text: 'Pengumuman aktif',
                    style: 'warning',
                    start_at: '2026-03-15T09:55:00',
                    end_at: '2026-03-15T10:00:10',
                    show_in_full: true,
                    show_in_simple: true,
                    isActive: true,
                },
            },
        });

        const { result } = renderHook(() => useLandingPublicConfig());

        await flushAsyncState();

        expect(result.current.publicConfigLoading).toBe(false);
        expect(result.current.landingSettings.announcement.isActive).toBe(true);
        expect(getPublicLandingPageSettings).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.setSystemTime(new Date('2026-03-15T10:00:45'));
            vi.advanceTimersByTime(LANDING_SCHEDULE_RECHECK_MS);
        });

        expect(result.current.landingSettings.announcement.isActive).toBe(false);
        expect(result.current.landingSettings.announcement.text).toBe('Pengumuman aktif');
        expect(getPublicLandingPageSettings).toHaveBeenCalledTimes(1);
    });

    it('normalizes missing landing scheduled content safely', async () => {
        getPublicLandingPageSettings.mockResolvedValue({
            success: true,
            data: {
                area_coverage: null,
                hero_badge: undefined,
                section_title: 'CCTV Publik',
                eventBanner: {
                    enabled: true,
                    title: null,
                    text: null,
                    theme: null,
                },
                announcement: null,
            },
        });

        const { result } = renderHook(() => useLandingPublicConfig());

        await flushAsyncState();

        expect(result.current.publicConfigLoading).toBe(false);
        expect(result.current.landingSettings.area_coverage).toBe('');
        expect(result.current.landingSettings.hero_badge).toBe('');
        expect(result.current.landingSettings.eventBanner.isActive).toBe(false);
        expect(result.current.landingSettings.eventBanner.theme).toBe('neutral');
        expect(result.current.landingSettings.announcement.title).toBe('');
        expect(result.current.landingSettings.announcement.text).toBe('');
    });
});
