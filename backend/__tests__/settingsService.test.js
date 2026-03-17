import { afterEach, describe, expect, it, vi } from 'vitest';
import * as database from '../database/database.js';
import * as timezoneService from '../services/timezoneService.js';
import settingsService from '../services/settingsService.js';

describe('settingsService.getLandingPageSettings', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mengembalikan struktur event banner dan announcement lengkap dengan fallback default', () => {
        vi.spyOn(database, 'query').mockReturnValue([]);
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');

        const result = settingsService.getLandingPageSettings();

        expect(result.hero_badge).toBe('LIVE STREAMING 24 JAM');
        expect(result.section_title).toBe('CCTV Publik');
        expect(result.eventBanner).toEqual(expect.objectContaining({
            enabled: false,
            theme: 'neutral',
            show_in_full: true,
            show_in_simple: true,
            isActive: false,
        }));
        expect(result.announcement).toEqual(expect.objectContaining({
            enabled: false,
            style: 'info',
            show_in_full: true,
            show_in_simple: true,
            isActive: false,
        }));
    });

    it('mengaktifkan event banner dan announcement jika jadwal aktif', () => {
        vi.spyOn(database, 'query').mockReturnValue([
            { key: 'event_banner_enabled', value: 'true' },
            { key: 'event_banner_title', value: 'Ramadan Kareem' },
            { key: 'event_banner_text', value: 'Selamat menunaikan ibadah puasa.' },
            { key: 'event_banner_theme', value: 'ramadan' },
            { key: 'event_banner_start_at', value: '2026-03-08T00:00' },
            { key: 'event_banner_end_at', value: '2026-03-10T23:59' },
            { key: 'announcement_enabled', value: 'true' },
            { key: 'announcement_title', value: 'Info Layanan' },
            { key: 'announcement_text', value: 'Akan ada perawatan malam ini.' },
            { key: 'announcement_style', value: 'warning' },
            { key: 'announcement_start_at', value: '2026-03-08T00:00' },
            { key: 'announcement_end_at', value: '2026-03-08T23:59' },
        ]);
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-08T12:00:00Z'));

        const result = settingsService.getLandingPageSettings();

        expect(result.eventBanner).toEqual(expect.objectContaining({
            enabled: true,
            title: 'Ramadan Kareem',
            theme: 'ramadan',
            isActive: true,
        }));
        expect(result.announcement).toEqual(expect.objectContaining({
            enabled: true,
            title: 'Info Layanan',
            style: 'warning',
            isActive: true,
        }));

        vi.useRealTimers();
    });

    it('menonaktifkan konten terjadwal jika belum mulai atau sudah habis', () => {
        vi.spyOn(database, 'query').mockReturnValue([
            { key: 'event_banner_enabled', value: 'true' },
            { key: 'event_banner_text', value: 'Banner aktif' },
            { key: 'event_banner_start_at', value: '2026-03-09T00:00' },
            { key: 'announcement_enabled', value: 'true' },
            { key: 'announcement_text', value: 'Announcement aktif' },
            { key: 'announcement_end_at', value: '2026-03-07T23:59' },
        ]);
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-08T12:00:00Z'));

        const result = settingsService.getLandingPageSettings();

        expect(result.eventBanner.isActive).toBe(false);
        expect(result.announcement.isActive).toBe(false);

        vi.useRealTimers();
    });
});

describe('settingsService.getPublicAdsSettings', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mengembalikan fallback ads config saat settings kosong', () => {
        vi.spyOn(database, 'query').mockReturnValue([]);

        const result = settingsService.getPublicAdsSettings();

        expect(result).toEqual(expect.objectContaining({
            enabled: false,
            provider: 'adsterra',
            devices: {
                desktop: true,
                mobile: true,
            },
            popup: {
                enabled: true,
                preferredSlot: 'bottom',
                hideSocialBarOnPopup: true,
                hideFloatingWidgetsOnPopup: true,
                maxHeight: {
                    desktop: 160,
                    mobile: 220,
                },
            },
        }));
        expect(result.slots.socialBar).toEqual({ enabled: false });
        expect(result.slots.footerBanner).toEqual({ enabled: false });
        expect(result.slots.playbackNative).toEqual({
            enabled: false,
            devices: {
                desktop: true,
                mobile: true,
            },
        });
        expect(result.slots.playbackPopunder).toEqual({
            enabled: false,
            devices: {
                desktop: true,
                mobile: true,
            },
        });
    });

    it('hanya mengirim script untuk slot yang aktif dan punya isi', () => {
        vi.spyOn(database, 'query').mockReturnValue([
            { key: 'ads_enabled', value: 'true' },
            { key: 'ads_provider', value: 'adsterra' },
            { key: 'ads_popup_slots_enabled', value: 'true' },
            { key: 'ads_popup_preferred_slot', value: 'top' },
            { key: 'ads_hide_social_bar_on_popup', value: 'false' },
            { key: 'ads_popup_desktop_max_height', value: '180' },
            { key: 'ads_playback_native_enabled', value: 'true' },
            { key: 'ads_playback_native_script', value: '<div>playback native</div>' },
            { key: 'ads_playback_native_desktop_enabled', value: 'true' },
            { key: 'ads_playback_native_mobile_enabled', value: 'true' },
            { key: 'ads_playback_popunder_enabled', value: 'true' },
            { key: 'ads_playback_popunder_script', value: '<script src=\"https://pl.example.com/pop.js\"></script>' },
            { key: 'ads_playback_popunder_desktop_enabled', value: 'true' },
            { key: 'ads_playback_popunder_mobile_enabled', value: 'false' },
            { key: 'ads_social_bar_enabled', value: 'true' },
            { key: 'ads_social_bar_script', value: '<script src=\"https://pl.example.com/social.js\"></script>' },
            { key: 'ads_top_banner_enabled', value: 'true' },
            { key: 'ads_top_banner_script', value: '   ' },
            { key: 'ads_popup_top_banner_enabled', value: 'true' },
            { key: 'ads_popup_top_banner_script', value: '<div>popup</div>' },
        ]);

        const result = settingsService.getPublicAdsSettings();

        expect(result.enabled).toBe(true);
        expect(result.popup).toEqual({
            enabled: true,
            preferredSlot: 'top',
            hideSocialBarOnPopup: false,
            hideFloatingWidgetsOnPopup: true,
            maxHeight: {
                desktop: 180,
                mobile: 220,
            },
        });
        expect(result.slots.socialBar).toEqual({
            enabled: true,
            script: '<script src=\"https://pl.example.com/social.js\"></script>',
        });
        expect(result.slots.playbackNative).toEqual({
            enabled: true,
            script: '<div>playback native</div>',
            devices: {
                desktop: true,
                mobile: true,
            },
        });
        expect(result.slots.playbackPopunder).toEqual({
            enabled: true,
            script: '<script src=\"https://pl.example.com/pop.js\"></script>',
            devices: {
                desktop: true,
                mobile: false,
            },
        });
        expect(result.slots.footerBanner).toEqual({ enabled: false });
        expect(result.slots.popupTopBanner).toEqual({
            enabled: true,
            script: '<div>popup</div>',
        });
    });
});
