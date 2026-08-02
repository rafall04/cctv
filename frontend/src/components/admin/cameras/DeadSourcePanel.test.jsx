// @vitest-environment jsdom

/*
 * Purpose: Prove the panel tells an operator which feeds are gone for good — and stays completely
 *          out of the way when none are.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraService.
 * SideEffects: jsdom render only.
 *
 * The silence cases are the point. This sits at the top of the busiest admin page, so a panel that
 * renders a reassuring empty box on every visit would cost that space permanently and train people
 * to skip the exact region where the warning later appears.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeadSourcePanel from './DeadSourcePanel';
import { cameraService } from '../../../services/cameraService';

// Named export, matching how every other camera consumer imports it.
vi.mock('../../../services/cameraService', () => ({
    cameraService: { getSourceHealth: vi.fn() },
}));

const DEAD = {
    confirmAfterHours: 6,
    total: 2,
    stillPublic: 1,
    cameras: [
        {
            id: 25, name: 'JEMBATAN SOSRODILOGO', areaName: 'KEC BOJONEGORO', enabled: true,
            cameraClass: 'community', reason: 'http_404',
            explanation: 'Alamat stream sudah tidak ada di server penyedia (404/410).',
            since: '2026-07-31T03:29:22.000Z', hours: 56,
        },
        {
            id: 37, name: 'ALUN-ALUN', areaName: 'KEC BOJONEGORO', enabled: false,
            cameraClass: 'community', reason: 'stream_ended',
            explanation: 'Playlist sumber sudah ditutup (#EXT-X-ENDLIST) — encoder di sisi penyedia berhenti.',
            since: '2026-07-31T09:50:33.000Z', hours: 49,
        },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
    cameraService.getSourceHealth.mockResolvedValue({ success: true, data: DEAD });
});

describe('DeadSourcePanel', () => {
    it('names each dead feed with how long it has been gone and why', async () => {
        render(<DeadSourcePanel />);

        expect(await screen.findByText('2 kamera mati di sumber')).toBeTruthy();
        expect(screen.getByText('JEMBATAN SOSRODILOGO')).toBeTruthy();
        // Both rows carry "sejak <tanggal> · <lama>"; 56 h and 49 h both render "2 hari".
        expect(screen.getAllByText(/^sejak .+ · \d+ (jam|hari)$/)).toHaveLength(2);
        expect(screen.getByText(/tidak ada di server penyedia/)).toBeTruthy();
        expect(screen.getByText(/#EXT-X-ENDLIST/)).toBeTruthy();
    });

    /* The actionable half: a dead camera already disabled needs nothing from anyone. */
    it('separates the ones still on air from the ones already switched off', async () => {
        render(<DeadSourcePanel />);

        expect(await screen.findByText('1 masih tayang')).toBeTruthy();
        expect(screen.getByText('Masih tayang')).toBeTruthy();
        expect(screen.getByText('Sudah dimatikan')).toBeTruthy();
    });

    it('says how long a source must be gone before it is listed at all', async () => {
        render(<DeadSourcePanel />);

        expect(await screen.findByText(/lebih dari 6 jam berturut-turut/)).toBeTruthy();
    });

    it('renders nothing at all when every source is alive', async () => {
        cameraService.getSourceHealth.mockResolvedValue({
            success: true, data: { confirmAfterHours: 6, total: 0, stillPublic: 0, cameras: [] },
        });
        const { container } = render(<DeadSourcePanel />);

        await waitFor(() => expect(cameraService.getSourceHealth).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    /** A failed fetch must not put a broken box on the camera page; the page has its own errors. */
    it('stays silent when the request fails', async () => {
        cameraService.getSourceHealth.mockResolvedValue({ success: false, message: 'Sesi habis' });
        const { container } = render(<DeadSourcePanel />);

        await waitFor(() => expect(cameraService.getSourceHealth).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });
});
