/*
 * Purpose: Verify the customer-portal API wrapper hits the right endpoints with payloads.
 * Caller: Frontend focused customer service test gate.
 * Deps: vitest, mocked apiClient, customerService.
 * MainFuncs: customerService request tests.
 * SideEffects: Mocks HTTP client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, putMock, deleteMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    putMock: vi.fn(),
    deleteMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { get: getMock, post: postMock, put: putMock, delete: deleteMock },
}));

import customerService from './customerService';

describe('customerService', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        getMock.mockResolvedValue({ data: { success: true, data: [] } });
        postMock.mockResolvedValue({ data: { success: true, data: {} } });
    });

    it('loads own cameras from the customer-scoped endpoint', async () => {
        await customerService.getMyCameras();
        expect(getMock).toHaveBeenCalledWith('/api/customer/cameras');
    });

    it('loads the billing summary', async () => {
        await customerService.getSummary();
        expect(getMock).toHaveBeenCalledWith('/api/customer/summary');
    });

    it('loads the wallet ledger with a limit', async () => {
        await customerService.getWallet(25);
        expect(getMock).toHaveBeenCalledWith('/api/customer/wallet', { params: { limit: 25 } });
    });

    it('creates a top-up with an integer amount', async () => {
        await customerService.createTopup(25000);
        expect(postMock).toHaveBeenCalledWith('/api/customer/topup', { amount: 25000 });
    });

    it('polls a top-up status by payment id', async () => {
        await customerService.getTopupStatus(12);
        expect(getMock).toHaveBeenCalledWith('/api/customer/topup/12');
    });

    it('switches plans via plan_key', async () => {
        await customerService.switchPlan('hemat');
        expect(postMock).toHaveBeenCalledWith('/api/customer/plan', { plan_key: 'hemat' });
    });

    it('creates, updates, and deletes own cameras through the customer endpoints', async () => {
        putMock.mockResolvedValue({ data: { success: true } });
        deleteMock.mockResolvedValue({ data: { success: true } });

        await customerService.createCamera({ name: 'Cam', private_rtsp_url: 'rtsp://x/1' });
        expect(postMock).toHaveBeenCalledWith('/api/customer/cameras', { name: 'Cam', private_rtsp_url: 'rtsp://x/1' });

        await customerService.updateCamera(5, { name: 'Baru' });
        expect(putMock).toHaveBeenCalledWith('/api/customer/cameras/5', { name: 'Baru' });

        await customerService.deleteCamera(5);
        expect(deleteMock).toHaveBeenCalledWith('/api/customer/cameras/5');
    });
});
