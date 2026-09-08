// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecordingRetentionManager from './RecordingRetentionManager.jsx';

const recordings = [
    { id: 1, name: 'Cam A', location: 'Dander', area_id: 2, area_name: 'Dander', group_name: 'Masjid', recording_duration_hours: 5, runtime_status: { isRecording: true }, storage: {} },
    { id: 2, name: 'Cam B', location: 'Kota', area_id: 3, area_name: 'Kota', group_name: 'Alun', recording_duration_hours: 5, runtime_status: { isRecording: false }, storage: {} },
    { id: 3, name: 'Cam C', location: 'Dander', area_id: 2, area_name: 'Dander', group_name: 'Masjid', recording_duration_hours: 5, runtime_status: { isRecording: true }, storage: {} },
];

function setup(onBulkUpdate = vi.fn().mockResolvedValue({ success: true })) {
    render(
        <RecordingRetentionManager
            recordings={recordings}
            onStartRecording={vi.fn()}
            onStopRecording={vi.fn()}
            onUpdateSettings={vi.fn()}
            onBulkUpdate={onBulkUpdate}
        />,
    );
    return { onBulkUpdate };
}

describe('RecordingRetentionManager', () => {
    it('memfilter grid berdasarkan area', () => {
        setup();
        expect(screen.getByText('Cam A')).toBeTruthy();
        expect(screen.getByText('Cam B')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Area'), { target: { value: '2' } });

        expect(screen.getByText('Cam A')).toBeTruthy();
        expect(screen.getByText('Cam C')).toBeTruthy();
        expect(screen.queryByText('Cam B')).toBeNull();
    });

    it('terapkan ke hasil filter mengirim scope=ids setelah konfirmasi', async () => {
        const { onBulkUpdate } = setup();
        fireEvent.change(screen.getByLabelText('Area'), { target: { value: '2' } });

        fireEvent.click(screen.getByRole('button', { name: /Terapkan ke/i }));
        // Panel konfirmasi muncul
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Ya, terapkan' }));
        });

        await waitFor(() => {
            expect(onBulkUpdate).toHaveBeenCalledWith({ scope: 'ids', cameraIds: [1, 3], recordingDurationHours: 24 });
        });
    });

    it('centang kamera lalu terapkan ke terpilih', async () => {
        const { onBulkUpdate } = setup();
        fireEvent.click(screen.getByLabelText('Pilih Cam B'));

        fireEvent.click(screen.getByRole('button', { name: /Terapkan ke 1 kamera terpilih/i }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Ya, terapkan' }));
        });

        await waitFor(() => {
            expect(onBulkUpdate).toHaveBeenCalledWith({ scope: 'ids', cameraIds: [2], recordingDurationHours: 24 });
        });
    });

    it('panel pintas per Area mengirim scope=area', async () => {
        const { onBulkUpdate } = setup();
        fireEvent.change(screen.getByLabelText('Pilih area'), { target: { value: '3' } });

        fireEvent.click(screen.getByRole('button', { name: /Terapkan \(1 kamera\)/i }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Ya, terapkan' }));
        });

        await waitFor(() => {
            expect(onBulkUpdate).toHaveBeenCalledWith({ scope: 'area', areaId: '3', recordingDurationHours: 24 });
        });
    });
});
