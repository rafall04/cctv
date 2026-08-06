// @vitest-environment jsdom

/*
 * Purpose: Prove the owner's recording page asks for a SLICE, and still tells the truth about the
 *          days that slice leaves out.
 * Caller: Frontend focused customer portal test gate.
 * Deps: vitest, testing-library, mocked customerService/recordingService.
 * MainFuncs: MyRecordings range + coverage tests.
 * SideEffects: None (mocked services).
 *
 * `owner_full` reaches the Telegram archive as well as the disk, so an unscoped request is the
 * camera's whole history — ~1,400 segments on production, rendered as one list. Narrowing that is
 * only safe while something still speaks for the days off screen, which is what these lock.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getMyCamerasMock, getPlaybackTokensMock, getSegmentsMock } = vi.hoisted(() => ({
    getMyCamerasMock: vi.fn(),
    getPlaybackTokensMock: vi.fn(),
    getSegmentsMock: vi.fn(),
}));

vi.mock('../../services/customerService', () => ({
    default: {
        getMyCameras: getMyCamerasMock,
        getPlaybackTokens: getPlaybackTokensMock,
        createPlaybackToken: vi.fn(),
        revokePlaybackToken: vi.fn(),
    },
}));

vi.mock('../../services/recordingService', () => ({
    getSegments: getSegmentsMock,
    getSegmentStreamUrl: () => 'blob:stream',
}));

import MyRecordings from './MyRecordings';

const CAMERA = { id: 42, name: 'CCTV Toko', enable_recording: 1 };

const SEGMENT = {
    id: 9001,
    filename: '20260806_200002.mp4',
    start_time: '2026-08-06T13:00:02.000Z',
    end_time: '2026-08-06T13:10:02.000Z',
    file_size: 156_607_843,
};

const COVERAGE = {
    start: '2026-07-27T12:50:04.000Z',
    end: '2026-08-06T13:10:02.000Z',
    runs: [
        { from: '2026-07-27T12:50:04.000Z', to: '2026-08-03T10:30:00.000Z' },
        { from: '2026-08-06T00:20:00.000Z', to: '2026-08-06T13:10:02.000Z' },
    ],
};

function answerWith({ segments = [SEGMENT], coverage = COVERAGE } = {}) {
    getSegmentsMock.mockResolvedValue({ data: { segments, coverage, total_segments: segments.length } });
}

const renderPage = () => render(<MemoryRouter><MyRecordings /></MemoryRouter>);

describe('MyRecordings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getMyCamerasMock.mockResolvedValue({ data: [CAMERA] });
        getPlaybackTokensMock.mockResolvedValue({ data: [] });
        answerWith();
    });

    it('asks for a rolling window instead of the camera\'s whole history', async () => {
        renderPage();

        await waitFor(() => expect(getSegmentsMock).toHaveBeenCalled());
        expect(getSegmentsMock).toHaveBeenCalledWith(
            42, undefined, {}, 'owner_full', expect.objectContaining({ key: 'rolling:24' }),
        );
    });

    it('draws the hole in the whole span, not just the slice being listed', async () => {
        renderPage();

        // 2026-08-03T10:30Z -> 2026-08-06T00:20Z is 61.8 hours the owner has no footage for.
        await waitFor(() => expect(screen.getByTitle('Tidak ada rekaman: 61.8 jam')).toBeTruthy());
    });

    it('re-asks for one whole day when a day is picked', async () => {
        renderPage();
        await waitFor(() => expect(getSegmentsMock).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Kemarin' }));

        await waitFor(() => expect(getSegmentsMock).toHaveBeenCalledTimes(2));
        const slice = getSegmentsMock.mock.calls[1][4];
        expect(slice.key).toMatch(/^day:\d{4}-\d{2}-\d{2}$/);
        expect(slice.to).toBeTruthy();
    });

    it('says the RANGE is empty, not that the camera has no recordings, when footage exists elsewhere', async () => {
        answerWith({ segments: [] });
        renderPage();

        await waitFor(() => expect(screen.getByText(/Tidak ada rekaman pada rentang ini/)).toBeTruthy());
        expect(screen.queryByText('Belum ada rekaman tersimpan untuk kamera ini.')).toBeNull();
    });

    it('still says "belum ada rekaman" when the camera genuinely has none anywhere', async () => {
        answerWith({ segments: [], coverage: { start: null, end: null, runs: [], segments: 0 } });
        renderPage();

        await waitFor(() => expect(screen.getByText('Belum ada rekaman tersimpan untuk kamera ini.')).toBeTruthy());
    });

    it('lists what the slice does hold', async () => {
        renderPage();

        await waitFor(() => expect(screen.getByText('1 potongan')).toBeTruthy());
        expect(screen.getByText('149 MB')).toBeTruthy();
    });
});
