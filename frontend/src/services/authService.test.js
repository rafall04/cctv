/*
 * Purpose: Lock down the 2FA exchange request policy — /api/auth/totp/verify answers
 *          401 for a WRONG CODE, and without skipAuthRefresh the response interceptor
 *          would burn a session-refresh round-trip, then reject with the REFRESH error
 *          (hiding "Kode verifikasi salah" and breaking the expired-challenge fallback).
 * Caller: Frontend focused authService test gate.
 * Deps: vitest, mocked apiClient, authService.
 * SideEffects: Mocks HTTP client + localStorage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, fetchCsrfMock } = vi.hoisted(() => ({
    postMock: vi.fn(),
    fetchCsrfMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { post: postMock },
    fetchCsrfToken: fetchCsrfMock,
    clearCsrfToken: vi.fn(),
}));

import { authService } from './authService';

describe('authService.verifyTotp', () => {
    beforeEach(() => {
        postMock.mockReset();
        localStorage.clear();
    });

    it('posts pendingToken+code with skipAuthRefresh — a bad code must surface ITS message', async () => {
        postMock.mockRejectedValue({ response: { status: 401, data: { message: 'Kode verifikasi salah' } } });

        const res = await authService.verifyTotp('pend.tok', '000000');

        expect(postMock).toHaveBeenCalledWith('/api/auth/totp/verify',
            { pendingToken: 'pend.tok', code: '000000' },
            expect.objectContaining({ skipAuthRefresh: true }));
        expect(res).toEqual({ success: false, message: 'Kode verifikasi salah', isRateLimited: false });
    });

    it('stores the user and passes passwordExpiryWarning through on success', async () => {
        postMock.mockResolvedValue({
            data: {
                success: true,
                data: {
                    user: { id: 1, username: 'admin', role: 'admin' },
                    passwordExpiryWarning: { shouldWarn: true, message: 'Password expires in 3 days.' },
                },
            },
        });

        const res = await authService.verifyTotp('pend.tok', '123456');

        expect(res.success).toBe(true);
        expect(res.user.username).toBe('admin');
        expect(res.passwordExpiryWarning?.message).toContain('3 days');
        expect(JSON.parse(localStorage.getItem('user')).username).toBe('admin');
    });
});
