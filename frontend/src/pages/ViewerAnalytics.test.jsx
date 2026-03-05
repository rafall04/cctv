// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyDetailModal } from './ViewerAnalytics';

describe('DailyDetailModal', () => {
    it('rerenders from hidden to visible without breaking hook order', () => {
        const sessions = [
            {
                started_at: '2026-03-05T10:00:00.000Z',
                ip_address: '127.0.0.1',
                duration_seconds: 120,
                sessionId: 'session-1',
                location: 'Jakarta',
                deviceType: 'desktop',
                viewerName: 'Operator',
                cameraName: 'Lobby',
                durationSeconds: 120,
            },
        ];

        const { rerender } = render(
            <DailyDetailModal date={null} sessions={sessions} onClose={() => {}} />
        );

        expect(screen.queryByText(/Detail Tanggal/i)).toBeNull();

        rerender(
            <DailyDetailModal date="2026-03-05" sessions={sessions} onClose={() => {}} />
        );

        expect(screen.getByText(/Detail Tanggal/i)).toBeTruthy();
        expect(screen.getByText(/1 sesi/i)).toBeTruthy();
    });
});
