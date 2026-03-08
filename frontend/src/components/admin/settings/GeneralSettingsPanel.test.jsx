// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralSettingsPanel from './GeneralSettingsPanel';

const { getMock, putMock, successMock, errorMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    putMock: vi.fn(),
    successMock: vi.fn(),
    errorMock: vi.fn(),
}));

vi.mock('axios', () => ({
    default: {
        get: getMock,
    },
}));

vi.mock('../../../services/api', () => ({
    adminAPI: {
        put: putMock,
    },
}));

vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: successMock,
        error: errorMock,
    }),
}));

describe('GeneralSettingsPanel', () => {
    beforeEach(() => {
        getMock.mockReset();
        putMock.mockReset();
        successMock.mockReset();
        errorMock.mockReset();

        getMock.mockResolvedValue({
            data: {
                data: {
                    area_coverage: 'Coverage aktif',
                    hero_badge: 'LIVE STREAMING 24 JAM',
                    section_title: 'CCTV Publik',
                    eventBanner: {
                        enabled: true,
                        title: 'Ramadan Kareem',
                        text: 'Selamat menunaikan ibadah puasa.',
                        theme: 'ramadan',
                        start_at: '2026-03-08T08:00',
                        end_at: '2026-03-10T23:00',
                        show_in_full: true,
                        show_in_simple: true,
                        isActive: true,
                    },
                    announcement: {
                        enabled: true,
                        title: 'Info Layanan',
                        text: 'Maintenance malam ini.',
                        style: 'warning',
                        start_at: '2026-03-08T20:00',
                        end_at: '2026-03-08T23:30',
                        show_in_full: true,
                        show_in_simple: false,
                        isActive: true,
                    },
                },
            },
        });
        putMock.mockResolvedValue({ data: { success: true } });
    });

    it('memuat field event banner dan announcement dari settings publik', async () => {
        render(<GeneralSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('Ramadan Kareem')).toBeTruthy();
        });

        expect(screen.getByDisplayValue('Selamat menunaikan ibadah puasa.')).toBeTruthy();
        expect(screen.getByDisplayValue('Info Layanan')).toBeTruthy();
        expect(screen.getByDisplayValue('Maintenance malam ini.')).toBeTruthy();
    });

    it('menyimpan field event banner dan announcement ke settings admin', async () => {
        render(<GeneralSettingsPanel />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('Ramadan Kareem')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('Title', { selector: '#event_banner_title' }), {
            target: { value: 'Idul Fitri' },
        });
        fireEvent.change(screen.getByLabelText('Announcement Text'), {
            target: { value: 'Gangguan layanan telah selesai.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => {
            expect(putMock).toHaveBeenCalled();
        });

        expect(putMock).toHaveBeenCalledWith('/api/settings/event_banner_title', expect.objectContaining({
            value: 'Idul Fitri',
        }));
        expect(putMock).toHaveBeenCalledWith('/api/settings/announcement_text', expect.objectContaining({
            value: 'Gangguan layanan telah selesai.',
        }));
        expect(successMock).toHaveBeenCalled();
    });
});
