import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, putMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    putMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { get: getMock, post: postMock, put: putMock },
}));

import billingAdminService from './billingAdminService';

describe('billingAdminService registration approval', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        putMock.mockReset();
        getMock.mockResolvedValue({ data: { success: true, data: [] } });
        postMock.mockResolvedValue({ data: { success: true } });
        putMock.mockResolvedValue({ data: { success: true } });
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

    it('loads, updates, and tests the payment gateway config', async () => {
        await billingAdminService.getPaymentGateway();
        expect(getMock).toHaveBeenCalledWith('/api/admin/billing/payment-gateway');

        await billingAdminService.updatePaymentGateway({ gateway: 'ipaymu' });
        expect(putMock).toHaveBeenCalledWith('/api/admin/billing/payment-gateway', { gateway: 'ipaymu' });

        await billingAdminService.testPaymentGateway();
        expect(postMock).toHaveBeenCalledWith('/api/admin/billing/payment-gateway/test');
    });
});
