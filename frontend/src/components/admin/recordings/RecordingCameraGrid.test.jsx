// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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
        expect(screen.getByText('Dander').className).toContain('dark:text-gray-300');
        expect(screen.getByText('Duration:').className).toContain('dark:text-gray-300');
        expect(screen.getByTestId('recording-status-7').className).toContain('dark:text-red-200');
    });

    it('merender empty state yang tetap terbaca', () => {
        render(
            <RecordingCameraGrid recordings={[]} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />
        );

        expect(screen.getByText('Tidak ada kamera dengan recording enabled').className).toContain('dark:text-gray-300');
    });
});
