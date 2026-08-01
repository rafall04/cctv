// @vitest-environment jsdom

/*
 * Purpose: Prove the archive list stops repeating what the filter already says — once a single
 *          camera is picked, the name and area leave every row and appear once in the sticky day
 *          header instead, while a mixed list keeps them.
 * Caller: Vitest frontend suite for the admin archive page.
 * Deps: React Testing Library, mocked telegramArchiveLibraryService + NotificationContext.
 * SideEffects: Renders jsdom UI against mocked async service responses only.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramArchiveLibrary from './TelegramArchiveLibrary';

const { getSummary, listUploads, streamUrl, dayBounds, notifyError, notifyWarning } = vi.hoisted(() => ({
    getSummary: vi.fn(),
    listUploads: vi.fn(),
    streamUrl: vi.fn((id) => `/stream/${id}`),
    dayBounds: vi.fn(() => undefined),
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
}));

vi.mock('../services/telegramArchiveLibraryService', () => ({
    default: { getSummary, listUploads, streamUrl, dayBounds },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ error: notifyError, warning: notifyWarning }),
}));

const CAMERA_NAME = 'SIMPANG 3 AHMAD YANI - VETERAN';
const AREA_NAME = 'KEC BOJONEGORO DAN SEKITARNYA';

function segment(segmentId, cameraName, cameraId) {
    return {
        segmentId,
        cameraId,
        cameraName,
        areaName: AREA_NAME,
        filename: `2026080_${segmentId}.mp4`,
        fileSize: 73_800_000,
        status: 'ok',
        playable: true,
        recordedAt: '2026-08-01T06:40:00.000Z',
        recordedUntil: '2026-08-01T06:50:00.000Z',
        durationSeconds: 600,
        uploadedAt: '2026-08-01 06:51:00',
        groups: [],
    };
}

const SUMMARY = {
    total: 226,
    playable: 226,
    bytes: 1_000_000,
    cameras: [
        { id: 16, name: CAMERA_NAME, segments: 226 },
        { id: 41, name: 'SIMPANG 3 PASAR PLAOSAN', segments: 175 },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
    getSummary.mockResolvedValue(SUMMARY);
    listUploads.mockResolvedValue({
        items: [segment(1, CAMERA_NAME, 16), segment(2, 'SIMPANG 3 PASAR PLAOSAN', 41)],
        total: 401,
    });
});

describe('TelegramArchiveLibrary row density', () => {
    it('keeps camera and area on each row while the list mixes cameras', async () => {
        render(<TelegramArchiveLibrary />);

        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        const [firstRow] = screen.getAllByRole('listitem');
        expect(within(firstRow).getByText(CAMERA_NAME)).toBeTruthy();
        expect(within(firstRow).getByText(/KEC BOJONEGORO/)).toBeTruthy();
    });

    it('drops the repeated camera and area from rows once one camera is selected', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        listUploads.mockResolvedValue({ items: [segment(1, CAMERA_NAME, 16)], total: 226 });
        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '16' } });

        await waitFor(() => expect(listUploads).toHaveBeenCalledWith(
            expect.objectContaining({ cameraId: '16' }),
        ));

        await waitFor(() => {
            const [row] = screen.getAllByRole('listitem');
            // The name is gone from the ROW, not from the page — the day header still carries it.
            expect(within(row).queryByText(CAMERA_NAME)).toBeNull();
            expect(within(row).queryByText(/KEC BOJONEGORO/)).toBeNull();
        });

        // Still visible exactly once as scroll-surviving context, in the sticky day heading.
        expect(screen.getByRole('heading', { name: new RegExp(CAMERA_NAME) })).toBeTruthy();
    });
});
