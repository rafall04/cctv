// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { registerInfoMock, registerMock, loginMock } = vi.hoisted(() => ({
    registerInfoMock: vi.fn(),
    registerMock: vi.fn(),
    loginMock: vi.fn(),
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { whatsapp_number: '6289685645956', company_name: 'RAF' } }),
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

/*
 * Registration stays gated on admin approval — this only shortens the wait by letting the applicant
 * ask for it. The autocomplete attributes matter just as much: without them a password manager can
 * neither fill the form nor offer to save the new credentials, and the login page next door already
 * gets this right, so their absence here was an oversight rather than a decision.
 */
describe('RegisterPage form affordances', () => {
    it('lets a password manager fill and save the form', async () => {
        renderPage();
        await screen.findByPlaceholderText('nama_warung');

        expect(document.getElementById('reg-username').getAttribute('autocomplete')).toBe('username');
        expect(document.getElementById('reg-email').getAttribute('autocomplete')).toBe('email');
        // new-password, not current-password: this pair CREATES credentials.
        expect(document.getElementById('reg-password').getAttribute('autocomplete')).toBe('new-password');
        expect(document.getElementById('reg-confirm').getAttribute('autocomplete')).toBe('new-password');
    });

    it('asks for a phone number with a phone keypad, not a full keyboard', async () => {
        renderPage();
        await screen.findByPlaceholderText('nama_warung');

        const phone = document.getElementById('reg-phone');
        expect(phone.type).toBe('tel');
        expect(phone.getAttribute('inputmode')).toBe('numeric');
        expect(phone.getAttribute('autocomplete')).toBe('tel');
    });
});
