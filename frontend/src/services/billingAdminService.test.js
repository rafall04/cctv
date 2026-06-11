import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { get: getMock, post: postMock, put: vi.fn() },
}));

import billingAdminService from './billingAdminService';

describe('billingAdminService registration approval', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        getMock.mockResolvedValue({ data: { success: true, data: [] } });
        postMock.mockResolvedValue({ data: { success: true } });
    });

    it('lists pending registrations', async () => {
        await billingAdminService.getRegistrations();
        expect(getMock).toHaveBeenCalledWith('/api/admin/billing/registrations');
    });

    it('approves a registration by id', async () => {
        await billingAdminService.approveRegistration(7);
        expect(postMock).toHaveBeenCalledWith('/api/admin/billing/registrations/7/approve');
    });

    it('rejects a registration by id', async () => {
        await billingAdminService.rejectRegistration(7);
        expect(postMock).toHaveBeenCalledWith('/api/admin/billing/registrations/7/reject');
    });
});
