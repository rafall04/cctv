/**
 * Purpose: Guard the cancel-vs-bounce distinction the viewer session stop call carries.
 * Caller: Frontend Vitest suite for services/viewerService.js.
 * Deps: Vitest, mocked apiClient.
 * SideEffects: None; every HTTP call is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('./apiClient', () => ({
    default: { post: postMock },
}));

import { ViewerService } from './viewerService';

async function startedService() {
    const service = new ViewerService();
    postMock.mockResolvedValueOnce({ data: { success: true, data: { sessionId: 'abc' } } });
    await service.startSession(7);
    postMock.mockResolvedValue({ data: { success: true } });
    return service;
}

describe('viewerService.stopSession', () => {
    beforeEach(() => {
        postMock.mockReset();
    });

    it('flags a race-guard cancellation so the backend can erase the session', async () => {
        const service = await startedService();

        await service.stopSession('abc', { cancelled: true });

        expect(postMock).toHaveBeenLastCalledWith('/api/viewer/stop', {
            sessionId: 'abc',
            cancelled: true,
        });
    });

    it('sends a plain stop unchanged, so a real 2-second bounce still reaches history', async () => {
        const service = await startedService();

        await service.stopSession('abc');

        expect(postMock).toHaveBeenLastCalledWith('/api/viewer/stop', { sessionId: 'abc' });
    });
});
