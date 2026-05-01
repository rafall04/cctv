// @vitest-environment jsdom
/*
Purpose: Regression coverage for admin Recording Dashboard rendering and operator notifications.
Caller: Vitest frontend jsdom suite.
Deps: RecordingDashboard, mocked recordingService, mocked useRecordingDashboardData.
MainFuncs: RecordingDashboard interaction assertions.
SideEffects: Mocks recording API calls and notification context methods.
*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingDashboard from './RecordingDashboard.jsx';
import recordingService from '../services/recordingService';

const success = vi.fn();
const notifyError = vi.fn();
const fetchData = vi.fn();

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success,
        error: notifyError,
    }),
}));

vi.mock('../services/recordingService', () => ({
    default: {
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        updateRecordingSettings: vi.fn(),
    },
}));

vi.mock('../hooks/admin/useRecordingDashboardData', () => ({
    useRecordingDashboardData: () => ({
        recordings: [
            {
                id: 3,
                name: 'CCTV TERMINAL',
                location: 'Terminal',
                enabled: 1,
                status: 'active',
                stream_source: 'internal',
                enable_recording: 1,
                recording_status: 'stopped',
                recording_duration_hours: 5,
                storage: {
                    segmentCount: 3,
                    totalSize: 9000,
                },
            },
        ],
        restartLogs: [],
        loading: false,
        error: null,
        refreshError: false,
        lastSuccessfulUpdate: new Date('2026-03-10T05:00:00.000Z'),
        summary: {
            cameras: 14,
            recordingCount: 14,
            totalSegments: 385,
            totalSize: 46100000000,
        },
        fetchData,
    }),
}));

describe('RecordingDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('merender header overview dan pill update dengan tone dark-mode yang eksplisit', () => {
        render(<RecordingDashboard />);

        expect(screen.getByText('Recording Dashboard')).toBeTruthy();
        expect(screen.getByText(/Monitor recording aktif/i).className).toContain('dark:text-gray-200');
        expect(screen.getByText(/Update terakhir:/i).className).toContain('dark:text-gray-50');
        expect(screen.getByRole('button', { name: /Refresh/i }).className).toContain('dark:text-gray-100');
    });

    it('menyimpan quick edit recording lalu me-refresh dashboard', async () => {
        recordingService.updateRecordingSettings.mockResolvedValue({ success: true });

        render(<RecordingDashboard />);

        fireEvent.click(screen.getByRole('button', { name: /Pengaturan Rekaman/i }));
        fireEvent.change(screen.getByLabelText('Durasi Penyimpanan'), { target: { value: '24' } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => {
            expect(recordingService.updateRecordingSettings).toHaveBeenCalledWith(3, {
                enable_recording: true,
                recording_duration_hours: 24,
            });
        });
        await waitFor(() => {
            expect(fetchData).toHaveBeenCalledWith({ mode: 'initial' });
        });
        expect(success).toHaveBeenCalledWith(
            'Pengaturan Recording Tersimpan',
            'Pengaturan kamera 3 berhasil diperbarui.'
        );
    });

    it('menampilkan notifikasi start recording dengan title dan message eksplisit', async () => {
        recordingService.startRecording.mockResolvedValue({ success: true });

        render(<RecordingDashboard />);

        fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));

        await waitFor(() => {
            expect(recordingService.startRecording).toHaveBeenCalledWith(3);
        });
        expect(success).toHaveBeenCalledWith('Recording Dimulai', 'Kamera 3 mulai direkam.');
        expect(fetchData).toHaveBeenCalledWith({ mode: 'initial' });
    });
});
