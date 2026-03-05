// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserManagement from './UserManagement';

const { getAllUsers, createUser } = vi.hoisted(() => ({
    getAllUsers: vi.fn(),
    createUser: vi.fn(),
}));

vi.mock('../services/userService', () => ({
    userService: {
        getAllUsers,
        createUser,
        updateUser: vi.fn(),
        changeUserPassword: vi.fn(),
        deleteUser: vi.fn(),
    },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('../services/authService', () => ({
    authService: {
        getCurrentUser: () => ({ id: 99, username: 'admin' }),
    },
}));

describe('UserManagement', () => {
    beforeEach(() => {
        getAllUsers.mockReset();
        createUser.mockReset();
        getAllUsers.mockResolvedValue({ success: true, data: [] });
        createUser.mockResolvedValue({ success: false, message: 'Username already exists' });
    });

    it('menandai field username saat create user gagal karena duplikat', async () => {
        render(<UserManagement />);

        await waitFor(() => {
            expect(screen.getByText('Add User')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Add User'));
        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator_1' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
        fireEvent.submit(screen.getByLabelText('Username').closest('form'));

        await waitFor(() => {
            expect(screen.getByText('Username already taken')).toBeTruthy();
        });
    });
});
