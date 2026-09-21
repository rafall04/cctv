// @vitest-environment jsdom
/*
Purpose: Regression coverage for the admin login page's TWO-STEP flow — password factor,
         then the TOTP/recovery challenge. The critical invariant under test: when the
         backend answers requiresTwoFactor, the password form is replaced by the code
         step and NO navigation happens until verifyTotp succeeds.
Caller: Vitest frontend jsdom suite.
Deps: LoginPage, mocked authService + contexts, MemoryRouter.
SideEffects: None — all services mocked.
*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';

const { loginMock, verifyTotpMock, navigateMock, notifySuccessMock } = vi.hoisted(() => ({
    loginMock: vi.fn(),
    verifyTotpMock: vi.fn(),
    navigateMock: vi.fn(),
    notifySuccessMock: vi.fn(),
}));

vi.mock('../services/authService', () => ({
    authService: { login: loginMock, verifyTotp: verifyTotpMock },
}));
vi.mock('react-router-dom', async (importActual) => ({
    ...(await importActual()),
    useNavigate: () => navigateMock,
}));
vi.mock('../contexts/ThemeContext', () => ({
    useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ success: notifySuccessMock, error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { company_name: 'RAF NET' } }),
}));

const fillLogin = () => {
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    // Anchored: the show/hide eye toggle also carries "password" in its aria-label.
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
};

describe('LoginPage — TOTP second factor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        vi.useRealTimers();
    });

    it('swaps to the code step when login returns requiresTwoFactor — no navigate yet', async () => {
        loginMock.mockResolvedValue({ success: true, requiresTwoFactor: true, pendingToken: 'pend.tok' });
        render(<MemoryRouter><LoginPage /></MemoryRouter>);

        fillLogin();
        fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));

        await waitFor(() => expect(screen.getByLabelText(/kode verifikasi/i)).toBeTruthy());
        // Password factor UI is gone — the challenge replaced it.
        expect(screen.queryByLabelText(/username/i)).toBeNull();
        expect(screen.getByRole('button', { name: 'Verifikasi' })).toBeTruthy();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('verifyTotp success finishes the login and navigates to /admin/dashboard', async () => {
        loginMock.mockResolvedValue({ success: true, requiresTwoFactor: true, pendingToken: 'pend.tok' });
        verifyTotpMock.mockResolvedValue({ success: true, user: { id: 1, username: 'admin', role: 'admin' } });
        render(<MemoryRouter><LoginPage /></MemoryRouter>);

        fillLogin();
        fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
        await waitFor(() => screen.getByLabelText(/kode verifikasi/i));

        // Fake timers BEFORE the submit — finishLogin schedules navigate via setTimeout(500).
        vi.useFakeTimers();
        fireEvent.change(screen.getByLabelText(/kode verifikasi/i), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));
        await vi.advanceTimersByTimeAsync(600);
        await vi.waitFor(() => expect(verifyTotpMock).toHaveBeenCalledWith('pend.tok', '123456'));
        expect(notifySuccessMock).toHaveBeenCalledWith('Berhasil Masuk', expect.any(String));
        expect(navigateMock).toHaveBeenCalledWith('/admin/dashboard');
    });

    it('a wrong code stays on the challenge step with the server message', async () => {
        loginMock.mockResolvedValue({ success: true, requiresTwoFactor: true, pendingToken: 'pend.tok' });
        verifyTotpMock.mockResolvedValue({ success: false, message: 'Kode verifikasi salah' });
        render(<MemoryRouter><LoginPage /></MemoryRouter>);

        fillLogin();
        fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
        await waitFor(() => screen.getByLabelText(/kode verifikasi/i));
        fireEvent.change(screen.getByLabelText(/kode verifikasi/i), { target: { value: '000000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));

        await waitFor(() => expect(screen.getByText('Kode verifikasi salah')).toBeTruthy());
        expect(screen.getByLabelText(/kode verifikasi/i)).toBeTruthy(); // still on step 2
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('an expired pending token drops back to the password step', async () => {
        loginMock.mockResolvedValue({ success: true, requiresTwoFactor: true, pendingToken: 'pend.tok' });
        verifyTotpMock.mockResolvedValue({ success: false, message: 'Sesi verifikasi kedaluwarsa — ulangi login' });
        render(<MemoryRouter><LoginPage /></MemoryRouter>);

        fillLogin();
        fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
        await waitFor(() => screen.getByLabelText(/kode verifikasi/i));
        fireEvent.change(screen.getByLabelText(/kode verifikasi/i), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));

        // Challenge cleared → username field returns so a fresh password login mints a new token.
        await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeTruthy());
    });
});
