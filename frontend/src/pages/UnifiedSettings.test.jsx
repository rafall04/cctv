// @vitest-environment jsdom
/*
Purpose: Verify the settings route switches panels, loads each one on demand, and exposes proper
  tab semantics.
Caller: Vitest frontend jsdom suite.
Deps: UnifiedSettings, mocked settings panels.
MainFuncs: UnifiedSettings tab-switching assertions.
SideEffects: None.
*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UnifiedSettings from './UnifiedSettings';

vi.mock('../components/admin/settings/GeneralSettingsPanel', () => ({
    default: () => <div>general-panel</div>,
}));

vi.mock('../components/admin/settings/TelegramSettingsPanel', () => ({
    default: () => <div>telegram-panel</div>,
}));

vi.mock('../components/admin/settings/SaweriaSettingsPanel', () => ({
    default: () => <div>saweria-panel</div>,
}));

// AdsSettingsPanel intentionally not mocked here — Ads moved to its own
// admin page (/admin/ads) so UnifiedSettings no longer mounts it.

vi.mock('../components/admin/settings/BrandingSettingsPanel', () => ({
    default: () => <div>branding-panel</div>,
}));

vi.mock('../components/admin/settings/StreamHealthSettingsPanel', () => ({
    default: () => <div>health-panel</div>,
}));

vi.mock('../components/admin/settings/PlaybackSettingsPanel', () => ({
    default: () => <div>playback-panel</div>,
}));

vi.mock('../components/admin/settings/TimezoneSettingsTab', () => ({
    default: () => <div>timezone-panel</div>,
}));

vi.mock('../components/admin/settings/BackupSettingsTab', () => ({
    default: () => <div>backup-panel</div>,
}));

vi.mock('../components/admin/settings/ApiKeySettings', () => ({
    default: () => <div>apikey-panel</div>,
}));

describe('UnifiedSettings', () => {
    it('merender tab settings dari panel admin yang aktif', async () => {
        render(<UnifiedSettings />);

        expect(await screen.findByText('general-panel')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Bot Telegram' }));
        expect(await screen.findByText('telegram-panel')).toBeTruthy();

        // Ads tab removed from UnifiedSettings — it now lives at /admin/ads.
        expect(screen.queryByRole('tab', { name: 'Ads' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Kesehatan Stream' }));
        expect(await screen.findByText('health-panel')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Putar Ulang' }));
        expect(await screen.findByText('playback-panel')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Branding' }));
        expect(await screen.findByText('branding-panel')).toBeTruthy();
    });

    it('hanya memasang panel yang aktif — sembilan panel tidak ikut termuat sekaligus', async () => {
        render(<UnifiedSettings />);

        expect(await screen.findByText('general-panel')).toBeTruthy();
        expect(screen.queryByText('telegram-panel')).toBeNull();
        expect(screen.queryByText('backup-panel')).toBeNull();
        expect(screen.queryByText('apikey-panel')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Cadangan' }));
        await waitFor(() => expect(screen.getByText('backup-panel')).toBeTruthy());
        expect(screen.queryByText('general-panel')).toBeNull();
    });

    it('mengumumkan tab mana yang sedang tampil', async () => {
        render(<UnifiedSettings />);
        await screen.findByText('general-panel');

        expect(screen.getByRole('tab', { name: 'Umum' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Branding' }).getAttribute('aria-selected')).toBe('false');
        expect(screen.getByRole('tabpanel')).toBeTruthy();
    });
});
