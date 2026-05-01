import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: getMock,
            post: postMock,
            patch: patchMock,
        }),
    },
}));

vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: {
            apiUrl: 'http://localhost:9997',
        },
    },
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('mediaMtxService on-demand path sync', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getMock.mockReset();
        postMock.mockReset();
        patchMock.mockReset();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('updates existing path when on-demand settings drift even if source matches', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        getMock.mockResolvedValueOnce({ data: { items: [{ name: 'stream-1' }] } });
        getMock.mockResolvedValueOnce({
            data: {
                name: 'stream-1',
                source: 'rtsp://admin:pass@36.66.208.98:554/live',
                sourceProtocol: 'tcp',
                sourceOnDemand: false,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '0s',
            },
        });

        const result = await mediaMtxService.updateCameraPath('stream-1', 'rtsp://admin:pass@36.66.208.98:554/live');

        expect(result).toEqual({ success: true, action: 'updated' });
        expect(patchMock).toHaveBeenCalledWith('/config/paths/patch/stream-1', expect.objectContaining({
            sourceOnDemand: true,
            sourceOnDemandCloseAfter: '30s',
        }));
    });
});
