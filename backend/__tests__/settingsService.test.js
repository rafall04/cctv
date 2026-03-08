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
