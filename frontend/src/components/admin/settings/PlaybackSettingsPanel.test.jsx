// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackSettingsPanel from './PlaybackSettingsPanel';

const { getAllMock, updateMock, successMock, errorMock } = vi.hoisted(() => ({
    getAllMock: vi.fn(),
    updateMock: vi.fn(),
    successMock: vi.fn(),
    errorMock: vi.fn(),
}));

vi.mock('../../../services/settingsService', () => ({
    settingsService: {
        getAllSettings: getAllMock,
        updateSetting: updateMock,
    },
}));

vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: successMock,
        error: errorMock,
    }),
}));

function settingsPayload(overrides = {}) {
    return {
        success: true,
        data: {
            public_playback_enabled: true,
            public_playback_contact_mode: 'branding_whatsapp',
            ...overrides,
        },
    };
}

describe('PlaybackSettingsPanel — WhatsApp contact status', () => {
    beforeEach(() => {
        getAllMock.mockReset();
        updateMock.mockReset();
        successMock.mockReset();
        errorMock.mockReset();
    });

    it('warns that the public contact button is hidden when whatsapp_number is empty', async () => {
        getAllMock.mockResolvedValue(settingsPayload());
        render(<PlaybackSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByText(/whatsapp_number masih kosong/)).toBeTruthy();
        });
        expect(screen.getByText(/tab Branding/)).toBeTruthy();
        expect(screen.queryByText(/Kontak aktif:/)).toBeNull();
    });

    it('shows the configured number when whatsapp_number is set', async () => {
        getAllMock.mockResolvedValue(settingsPayload({ whatsapp_number: ' 0812-3456-7890 ' }));
        render(<PlaybackSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByText(/Kontak aktif: 0812-3456-7890/)).toBeTruthy();
        });
        expect(screen.queryByText(/masih kosong/)).toBeNull();
    });
});
