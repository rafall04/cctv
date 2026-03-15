// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecordingCameraGrid from './RecordingCameraGrid.jsx';

describe('RecordingCameraGrid', () => {
    it('merender metadata dan badge status dengan tone dark-mode yang lebih tegas', () => {
        render(
            <RecordingCameraGrid
                recordings={[
                    {
                        id: 7,
                        name: 'CCTV LAPANGAN DANDER',
                        location: 'Dander',
                        recording_status: 'recording',
                        recording_duration_hours: 10,
                        storage: {
                            segmentCount: 65,
                            totalSize: 14020000000,
                        },
                    },
                ]}
                onStartRecording={vi.fn()}
                onStopRecording={vi.fn()}
            />
        );

        expect(screen.getByText('CCTV LAPANGAN DANDER')).toBeTruthy();
        expect(screen.getByText('Dander').className).toContain('dark:text-gray-200');
        expect(screen.getByText('Duration:').className).toContain('dark:text-gray-200');
        expect(screen.getByText('Recording Enabled:')).toBeTruthy();
        expect(screen.getByTestId('recording-status-7').className).toContain('dark:text-red-100');
    });

    it('membuka quick edit dan menyimpan pengaturan recording per kamera', async () => {
        const onUpdateSettings = vi.fn().mockResolvedValue({ success: true });

        render(
            <RecordingCameraGrid
                recordings={[
                    {
                        id: 9,
                        name: 'CCTV ALUN-ALUN',
                        location: 'Kota',
                        recording_status: 'stopped',
                        enable_recording: 1,
                        recording_duration_hours: 5,
                        stream_source: 'external',
                        storage: {
                            segmentCount: 12,
                            totalSize: 1200000,
                        },
                    },
                ]}
                onStartRecording={vi.fn()}
                onStopRecording={vi.fn()}
                onUpdateSettings={onUpdateSettings}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /Pengaturan Rekaman/i }));
        fireEvent.change(screen.getByLabelText('Durasi Penyimpanan'), { target: { value: '24' } });
        fireEvent.click(screen.getByRole('button', { name: /Aktifkan Rekaman/i }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
        });

        await waitFor(() => {
            expect(onUpdateSettings).toHaveBeenCalledWith(9, {
                enable_recording: false,
                recording_duration_hours: 24,
            });
        });
    });

    it('menjaga draft edit saat props refresh datang selama mode edit aktif', () => {
        const { rerender } = render(
            <RecordingCameraGrid
                recordings={[
                    {
                        id: 11,
                        name: 'CCTV PASAR',
                        location: 'Pasar',
                        recording_status: 'stopped',
                        enable_recording: 1,
                        recording_duration_hours: 5,
                        storage: {
                            segmentCount: 2,
                            totalSize: 3000,
                        },
                    },
                ]}
                onStartRecording={vi.fn()}
                onStopRecording={vi.fn()}
                onUpdateSettings={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /Pengaturan Rekaman/i }));
        fireEvent.change(screen.getByLabelText('Durasi Penyimpanan'), { target: { value: '24' } });

        rerender(
            <RecordingCameraGrid
                recordings={[
                    {
                        id: 11,
                        name: 'CCTV PASAR',
                        location: 'Pasar Baru',
                        recording_status: 'recording',
                        enable_recording: 1,
                        recording_duration_hours: 10,
                        storage: {
                            segmentCount: 5,
                            totalSize: 9000,
                        },
                    },
                ]}
                onStartRecording={vi.fn()}
                onStopRecording={vi.fn()}
                onUpdateSettings={vi.fn()}
            />
        );

        expect(screen.getByLabelText('Durasi Penyimpanan').value).toBe('24');
    });

    it('merender empty state yang tetap terbaca', () => {
        render(
            <RecordingCameraGrid
                recordings={[]}
                onStartRecording={vi.fn()}
                onStopRecording={vi.fn()}
                onUpdateSettings={vi.fn()}
            />
        );

        expect(screen.getByText('Tidak ada kamera dengan recording enabled').className).toContain('dark:text-gray-300');
    });
});
