/**
 * Purpose: Validate recording HTTP controller stream range handling.
 * Caller: Vitest backend test suite.
 * Deps: mocked recordingPlaybackService and fs.createReadStream.
 * MainFuncs: streamSegment.
 * SideEffects: None; stream creation is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStreamSegmentMock = vi.fn();
const createReadStreamMock = vi.fn();

vi.mock('../services/recordingPlaybackService.js', () => ({
    default: {
        getStreamSegment: getStreamSegmentMock,
    },
}));

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        createReadStream: createReadStreamMock,
    };
});

const { streamSegment } = await import('../controllers/recordingController.js');

function createReply() {
    return {
        statusCode: null,
        headers: {},
        payload: null,
        header: vi.fn(function setHeader(name, value) {
            this.headers[name] = value;
            return this;
        }),
        code: vi.fn(function setCode(statusCode) {
            this.statusCode = statusCode;
            return this;
        }),
        send: vi.fn(function send(payload) {
            this.payload = payload;
            return this;
        }),
    };
}

describe('recordingController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getStreamSegmentMock.mockReturnValue({
            segment: { file_path: 'C:\\recordings\\camera7\\20260517_010000.mp4' },
            stats: { size: 100 },
        });
    });

    it('returns 416 for unsatisfiable recording byte ranges', async () => {
        const reply = createReply();

        await streamSegment({
            params: { cameraId: 7, filename: '20260517_010000.mp4' },
            headers: { range: 'bytes=100-101' },
        }, reply);

        expect(reply.code).toHaveBeenCalledWith(416);
        expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes */100');
        expect(reply.send).toHaveBeenCalledWith({
            success: false,
            message: 'range_not_satisfiable',
        });
        expect(createReadStreamMock).not.toHaveBeenCalled();
    });
});
