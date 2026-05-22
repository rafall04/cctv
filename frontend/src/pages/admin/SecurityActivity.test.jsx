// @vitest-environment jsdom
/*
Purpose: Regression coverage for the admin Security Activity page.
Caller: Vitest frontend jsdom suite.
Deps: SecurityActivity, mocked adminService + contexts.
MainFuncs: SecurityActivity rendering assertions.
SideEffects: Mocks the security log/stat API calls.
*/

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecurityActivity from './SecurityActivity.jsx';

const { getSecurityLogsMock, getSecurityStatsMock, notifyErrorMock } = vi.hoisted(() => ({
    getSecurityLogsMock: vi.fn(),
    getSecurityStatsMock: vi.fn(),
    notifyErrorMock: vi.fn(),
}));

vi.mock('../../services/adminService', () => ({
    adminService: {
        getSecurityLogs: getSecurityLogsMock,
        getSecurityStats: getSecurityStatsMock,
    },
}));

vi.mock('../../contexts/NotificationContext', () => ({
    useNotification: () => ({ error: notifyErrorMock, success: vi.fn() }),
}));

vi.mock('../../contexts/TimezoneContext', () => ({
    useTimezone: () => ({ timezone: 'Asia/Jakarta' }),
}));

describe('SecurityActivity', () => {
    beforeEach(() => {
        getSecurityLogsMock.mockReset();
        getSecurityStatsMock.mockReset();
        notifyErrorMock.mockReset();
        getSecurityStatsMock.mockResolvedValue({
            success: true,
            data: { period_days: 7, total_events: 12, events_by_type: { AUTH_FAILURE: 3, AUTHZ_FAILURE: 2 } },
        });
    });

    it('renders security events and the 7-day stat summary', async () => {
        getSecurityLogsMock.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    event_type: 'AUTHZ_FAILURE',
                    timestamp: '2026-05-22T03:15:00.000Z',
                    username: 'viewer1',
                    ip_address: '10.0.0.5',
                    endpoint: '/api/users',
                    details: JSON.stringify({ reason: 'admin_role_required', required_role: 'admin', actual_role: 'viewer' }),
                },
            ],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        });

        render(<SecurityActivity />);

        await waitFor(() => {
            expect(screen.getByText('AUTHZ_FAILURE')).toBeTruthy();
        });
        expect(screen.getByText('viewer1')).toBeTruthy();
        expect(screen.getByText('10.0.0.5')).toBeTruthy();
        // Stat tile reflects the mocked 7-day stats.
        expect(screen.getByText('12')).toBeTruthy();
    });

    it('shows an error toast when the log request fails', async () => {
        getSecurityLogsMock.mockResolvedValue({ success: false, message: 'Boom' });

        render(<SecurityActivity />);

        await waitFor(() => {
            expect(notifyErrorMock).toHaveBeenCalledWith('Gagal Memuat Log', 'Boom');
        });
    });
});
