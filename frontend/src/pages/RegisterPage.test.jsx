// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { registerInfoMock, registerMock, loginMock } = vi.hoisted(() => ({
    registerInfoMock: vi.fn(),
    registerMock: vi.fn(),
    loginMock: vi.fn(),
}));

vi.mock('../services/authService', () => ({
    authService: {
        registerInfo: registerInfoMock,
        register: registerMock,
        login: loginMock,
    },
}));

import RegisterPage from './RegisterPage';

function renderPage() {
    return render(
        <MemoryRouter>
            <RegisterPage />
        </MemoryRouter>
    );
}

async function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'warung_sri' } });
    fireEvent.change(screen.getByLabelText(/No. HP/), { target: { value: '081234567890' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'PasswordAman2026!' } });
    fireEvent.change(screen.getByLabelText('Ulangi Password'), { target: { value: 'PasswordAman2026!' } });
    fireEvent.click(screen.getByRole('button', { name: /Daftar Sekarang/ }));
}

describe('RegisterPage (approval-gated)', () => {
    beforeEach(() => {
        registerInfoMock.mockReset();
        registerMock.mockReset();
        loginMock.mockReset();
        registerInfoMock.mockResolvedValue({
            success: true,
            data: { enabled: true, requires_approval: true, default_plan: { key: 'trial', name: 'Trial', is_trial: true, trial_days: 3, max_cameras: 1 } },
        });
        registerMock.mockResolvedValue({ success: true, data: { user: { status: 'pending' } } });
    });

    it('shows the approval-required note before submitting', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByText(/perlu/)).toBeTruthy();
        });
        expect(screen.getByText(/persetujuan admin/)).toBeTruthy();
    });

    it('shows a pending confirmation and does NOT auto-login after registering', async () => {
        renderPage();
        await waitFor(() => screen.getByLabelText('Username'));

        await fillAndSubmit();

        await waitFor(() => {
            expect(screen.getByText('Pendaftaran terkirim!')).toBeTruthy();
        });
        expect(screen.getByText(/menunggu persetujuan admin/)).toBeTruthy();
        // Critical: no auto-login while pending approval.
        expect(loginMock).not.toHaveBeenCalled();
    });

    it('keeps the form and shows the error when registration fails', async () => {
        registerMock.mockResolvedValue({ success: false, message: 'Nomor HP sudah terdaftar' });
        renderPage();
        await waitFor(() => screen.getByLabelText('Username'));

        await fillAndSubmit();

        await waitFor(() => {
            expect(screen.getByText('Nomor HP sudah terdaftar')).toBeTruthy();
        });
        expect(screen.queryByText('Pendaftaran terkirim!')).toBeNull();
    });
});
