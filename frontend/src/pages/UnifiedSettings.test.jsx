// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('../components/admin/settings/AdsSettingsPanel', () => ({
    default: () => <div>ads-panel</div>,
}));

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
    it('merender tab settings dari panel admin yang aktif', () => {
        render(<UnifiedSettings />);

        expect(screen.getByText('general-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Telegram Bot'));
        expect(screen.getByText('telegram-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Ads'));
        expect(screen.getByText('ads-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Health'));
        expect(screen.getByText('health-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Playback'));
        expect(screen.getByText('playback-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Branding'));
        expect(screen.getByText('branding-panel')).toBeTruthy();
    });
});
