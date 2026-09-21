// @vitest-environment jsdom
/*
Purpose: Regression coverage for the admin Security Activity page.
Caller: Vitest frontend jsdom suite.
Deps: SecurityActivity, mocked adminService + contexts.
MainFuncs: SecurityActivity rendering assertions.
SideEffects: Mocks the security log/stat API calls.
*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecurityActivity from './SecurityActivity.jsx';

const {
    getSecurityLogsMock, getSecurityStatsMock, notifyErrorMock, notifySuccessMock,
    getTotpStatusMock, startTotpSetupMock, confirmTotpSetupMock, disableTotpMock,
} = vi.hoisted(() => ({
    getSecurityLogsMock: vi.fn(),
    getSecurityStatsMock: vi.fn(),
    notifyErrorMock: vi.fn(),
    notifySuccessMock: vi.fn(),
    getTotpStatusMock: vi.fn(),
    startTotpSetupMock: vi.fn(),
    confirmTotpSetupMock: vi.fn(),
    disableTotpMock: vi.fn(),
}));

vi.mock('../../services/adminService', () => ({
    adminService: {
        getSecurityLogs: getSecurityLogsMock,
        getSecurityStats: getSecurityStatsMock,
        getTotpStatus: getTotpStatusMock,
        startTotpSetup: startTotpSetupMock,
        confirmTotpSetup: confirmTotpSetupMock,
        disableTotp: disableTotpMock,
    },
}));

vi.mock('../../contexts/NotificationContext', () => ({
    useNotification: () => ({ error: notifyErrorMock, success: notifySuccessMock }),
}));

/*
 * Only useTimezone is stubbed. parseBackendDateInput/TIMESTAMP_STORAGE are pure and deterministic,
 * and mocking them away is exactly what would hide a timezone bug: these rows are SQLite
 * CURRENT_TIMESTAMP (UTC, no zone marker), and rendering them with a plain `new Date()` showed
 * the admin log 7 hours early.
 */
vi.mock('../../contexts/TimezoneContext', async (importActual) => ({
    ...(await importActual()),
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
        // Default: 2FA off — the card offers "Aktifkan 2FA".
        getTotpStatusMock.mockResolvedValue({ success: true, data: { enabled: false, recoveryRemaining: 0 } });
        startTotpSetupMock.mockReset();
        confirmTotpSetupMock.mockReset();
        disableTotpMock.mockReset();
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

describe('SecurityActivity — 2FA card', () => {
    it('offers setup when disabled, shows QR + secret, then recovery codes once', async () => {
        getSecurityLogsMock.mockResolvedValue({ success: true, data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
        startTotpSetupMock.mockResolvedValue({
            success: true,
            data: { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauthUrl: 'otpauth://x', qrDataUrl: 'data:image/png;base64,AAAA' },
        });
        confirmTotpSetupMock.mockResolvedValue({ success: true, data: { recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] } });

        render(<SecurityActivity />);

        // Enabled? No — the setup button must be offered.
        const enableBtn = await screen.findByRole('button', { name: 'Aktifkan 2FA' });
        fireEvent.click(enableBtn);

        await waitFor(() => expect(startTotpSetupMock).toHaveBeenCalled());
        expect(screen.getByAltText('QR code untuk aplikasi authenticator')).toBeTruthy();
        expect(screen.getByText('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toBeTruthy();

        // Confirm requires a 6-digit code.
        fireEvent.change(screen.getByLabelText(/kode 6 digit/i), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: /verifikasi & aktifkan/i }));

        await waitFor(() => expect(confirmTotpSetupMock).toHaveBeenCalledWith('123456'));
        // Recovery codes appear exactly once — dismissal clears them.
        await waitFor(() => expect(screen.getByText('aaaa-bbbb')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /sudah saya simpan/i }));
        await waitFor(() => expect(screen.queryByText('aaaa-bbbb')).toBeNull());
    });

    it('shows enabled status and gates disable behind a code input', async () => {
        getSecurityLogsMock.mockResolvedValue({ success: true, data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
        getTotpStatusMock.mockResolvedValue({ success: true, data: { enabled: true, recoveryRemaining: 6 } });
        disableTotpMock.mockResolvedValue({ success: true });

        render(<SecurityActivity />);

        await waitFor(() => expect(screen.getByText(/kode pemulihan tersisa 6/i)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan 2FA' }));
        fireEvent.change(screen.getByLabelText(/kode authenticator saat ini/i), { target: { value: '654321' } });
        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan 2FA' }));

        await waitFor(() => expect(disableTotpMock).toHaveBeenCalledWith('654321'));
        await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith('2FA Dinonaktifkan', expect.any(String)));
    });
});
