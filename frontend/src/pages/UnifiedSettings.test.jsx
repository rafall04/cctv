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

vi.mock('../components/admin/settings/BrandingSettingsPanel', () => ({
    default: () => <div>branding-panel</div>,
}));

vi.mock('../components/settings/TimezoneSettingsTab', () => ({
    default: () => <div>timezone-panel</div>,
}));

vi.mock('../components/settings/BackupSettingsTab', () => ({
    default: () => <div>backup-panel</div>,
}));

vi.mock('../components/settings/ApiKeySettings', () => ({
    default: () => <div>apikey-panel</div>,
}));

describe('UnifiedSettings', () => {
    it('merender tab settings dari panel admin yang aktif', () => {
        render(<UnifiedSettings />);

        expect(screen.getByText('general-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Telegram Bot'));
        expect(screen.getByText('telegram-panel')).toBeTruthy();

        fireEvent.click(screen.getByText('Branding'));
        expect(screen.getByText('branding-panel')).toBeTruthy();
    });
});
