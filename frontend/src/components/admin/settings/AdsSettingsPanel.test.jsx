// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdsSettingsPanel from './AdsSettingsPanel';

const { getAllSettingsMock, updateSettingMock, successMock, errorMock } = vi.hoisted(() => ({
    getAllSettingsMock: vi.fn(),
    updateSettingMock: vi.fn(),
    successMock: vi.fn(),
    errorMock: vi.fn(),
}));

vi.mock('../../../services/settingsService', () => ({
    settingsService: {
        getAllSettings: getAllSettingsMock,
        updateSetting: updateSettingMock,
    },
}));

vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: successMock,
        error: errorMock,
    }),
}));

describe('AdsSettingsPanel', () => {
    beforeEach(() => {
        getAllSettingsMock.mockReset();
        updateSettingMock.mockReset();
        successMock.mockReset();
        errorMock.mockReset();

        getAllSettingsMock.mockResolvedValue({
            data: {
                ads_enabled: 'true',
                ads_provider: 'adsterra',
                ads_desktop_enabled: 'true',
                ads_mobile_enabled: 'true',
                ads_popup_slots_enabled: 'true',
                ads_popup_preferred_slot: 'bottom',
                ads_hide_social_bar_on_popup: 'true',
                ads_hide_floating_widgets_on_popup: 'true',
                ads_popup_desktop_max_height: '160',
                ads_popup_mobile_max_height: '220',
                ads_playback_popunder_enabled: 'true',
                ads_playback_popunder_script: '<script src="https://pl.example.com/popunder.js"></script>',
                ads_playback_popunder_desktop_enabled: 'true',
                ads_playback_popunder_mobile_enabled: 'false',
                ads_social_bar_enabled: 'true',
                ads_social_bar_script: '<script src="https://pl.example.com/social.js"></script>',
            },
        });
        updateSettingMock.mockResolvedValue({ success: true });
    });

    it('memuat field ads dari settings admin existing', async () => {
        render(<AdsSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('adsterra')).toBeTruthy();
        });

        expect(screen.getByDisplayValue('<script src="https://pl.example.com/social.js"></script>')).toBeTruthy();
        expect(screen.getByDisplayValue('<script src="https://pl.example.com/popunder.js"></script>')).toBeTruthy();
        expect(screen.getByDisplayValue('160')).toBeTruthy();
        expect(screen.getByLabelText('Prioritas slot desktop').value).toBe('bottom');
    });

    it('menyimpan perubahan slot iklan ke settings store', async () => {
        render(<AdsSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('adsterra')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('Provider'), {
            target: { value: 'adsterra-custom' },
        });
        fireEvent.change(screen.getByLabelText('Prioritas slot desktop'), {
            target: { value: 'top' },
        });
        fireEvent.click(screen.getByLabelText('Tampilkan di mobile'));
        fireEvent.change(screen.getByLabelText('Script', { selector: '#ads_top_banner_script' }), {
            target: { value: '<div>top banner</div>' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => {
            expect(updateSettingMock).toHaveBeenCalled();
        });

        expect(updateSettingMock).toHaveBeenCalledWith(
            'ads_provider',
            'adsterra-custom',
            expect.any(String)
        );
        expect(updateSettingMock).toHaveBeenCalledWith(
            'ads_popup_preferred_slot',
            'top',
            expect.any(String)
        );
        expect(updateSettingMock).toHaveBeenCalledWith(
            'ads_playback_popunder_mobile_enabled',
            'true',
            expect.any(String)
        );
        expect(updateSettingMock).toHaveBeenCalledWith(
            'ads_top_banner_script',
            '<div>top banner</div>',
            expect.any(String)
        );
        expect(successMock).toHaveBeenCalled();
    });
});
