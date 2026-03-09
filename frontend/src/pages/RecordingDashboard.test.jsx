// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecordingDashboard from './RecordingDashboard.jsx';

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        showNotification: vi.fn(),
    }),
}));

vi.mock('../hooks/admin/useRecordingDashboardData', () => ({
    useRecordingDashboardData: () => ({
        recordings: [],
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
        fetchData: vi.fn(),
    }),
}));

describe('RecordingDashboard', () => {
    it('merender header overview dan pill update dengan tone dark-mode yang eksplisit', () => {
        render(<RecordingDashboard />);

        expect(screen.getByText('Recording Dashboard')).toBeTruthy();
        expect(screen.getByText(/Monitor recording aktif/i).className).toContain('dark:text-gray-200');
        expect(screen.getByText(/Update terakhir:/i).className).toContain('dark:text-gray-50');
        expect(screen.getByRole('button', { name: /Refresh/i }).className).toContain('dark:text-gray-100');
    });
});
