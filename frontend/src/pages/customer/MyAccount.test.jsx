/*
 * Purpose: Verify the customer Account page loads the profile into its form and blocks a
 *          password change when the confirmation does not match (no API call made).
 * Caller: Frontend focused customer portal test gate.
 * Deps: vitest, testing-library, mocked userService/authService.
 * SideEffects: None (mocked services).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getProfileMock, updateProfileMock, changeOwnPasswordMock, getReqMock } = vi.hoisted(() => ({
    getProfileMock: vi.fn(),
    updateProfileMock: vi.fn(),
    changeOwnPasswordMock: vi.fn(),
    getReqMock: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
    default: {
        getProfile: getProfileMock,
        updateProfile: updateProfileMock,
        changeOwnPassword: changeOwnPasswordMock,
        getPasswordRequirements: getReqMock,
    },
}));

vi.mock('../../services/authService', () => ({
    authService: { logout: vi.fn().mockResolvedValue(undefined) },
}));

import MyAccount from './MyAccount';

function renderPage() {
    return render(<MemoryRouter><MyAccount /></MemoryRouter>);
}

describe('MyAccount', () => {
    beforeEach(() => {
        getProfileMock.mockReset();
        updateProfileMock.mockReset();
        changeOwnPasswordMock.mockReset();
        getReqMock.mockReset();
        getReqMock.mockResolvedValue({ success: true, data: { requirements: ['At least 8 characters'] } });
    });

    it('loads the profile into the form fields', async () => {
        getProfileMock.mockResolvedValue({
            success: true,
            data: { username: 'budi', phone: '0812', email: 'budi@mail.com', created_at: '2026-06-01T10:00:00' },
        });
        renderPage();
        await waitFor(() => expect(screen.getByDisplayValue('budi')).toBeTruthy());
        expect(screen.getByDisplayValue('budi@mail.com')).toBeTruthy();
        expect(screen.getByText('Informasi Akun')).toBeTruthy();
    });

    it('blocks a password change when the confirmation does not match', async () => {
        getProfileMock.mockResolvedValue({ success: true, data: { username: 'budi', created_at: '2026-06-01' } });
        renderPage();
        await waitFor(() => expect(screen.getByDisplayValue('budi')).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Password lama'), { target: { value: 'OldPass1!' } });
        fireEvent.change(screen.getByLabelText('Password baru'), { target: { value: 'NewPass1!' } });
        fireEvent.change(screen.getByLabelText('Ulangi password baru'), { target: { value: 'Mismatch1!' } });
        fireEvent.click(screen.getByRole('button', { name: 'Ubah Password' }));

        await waitFor(() => expect(screen.getByText(/tidak cocok/)).toBeTruthy());
        expect(changeOwnPasswordMock).not.toHaveBeenCalled();
    });
});
