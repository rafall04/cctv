// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthDebug from './HealthDebug';

const { getCameraHealthDebug } = vi.hoisted(() => ({
    getCameraHealthDebug: vi.fn(),
}));

vi.mock('../../services/adminService', () => ({
    adminService: {
        getCameraHealthDebug,
    },
}));

describe('HealthDebug page', () => {
    beforeEach(() => {
        getCameraHealthDebug.mockReset();
        getCameraHealthDebug.mockResolvedValue({
            success: true,
            data: {
                summary: {
                    total: 3,
                    healthy: 1,
                    degraded: 1,
                    offline: 1,
                    unresolved: 0,
                },
                items: [{
                    cameraId: 12,
                    cameraName: 'Jombang MJPEG',
                    areaName: 'Kabuh',
                    delivery_type: 'external_mjpeg',
                    healthStrategy: 'external_mjpeg_stream_primary',
                    state: 'degraded',
                    confidence: 0.73,
                    errorClass: 'tls',
                    availability_state: 'degraded',
                    availability_reason: 'runtime_recent_success',
                    availability_confidence: 0.7,
                    lastReason: 'runtime_probe_tls_mismatch',
                    failureScore: 1.4,
                    runtimeTarget: 'https://example.com/live',
                    probeTarget: 'https://example.com/live',
                    probeMethod: 'GET',
                    lastProbeAt: new Date().toISOString(),
                    lastRuntimeSuccessAt: new Date().toISOString(),
                    lastRuntimeFreshAt: new Date().toISOString(),
                    lastRuntimeSignalType: 'external_mjpeg_image_load',
                    runtimeGraceUntil: new Date(Date.now() + 60000).toISOString(),
                    domainBackoffUntil: null,
                }],
                pagination: {
                    page: 1,
                    limit: 25,
                    totalItems: 1,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            },
        });
    });

    it('memuat health debug dengan filter default problem', async () => {
        render(<HealthDebug />);

        await waitFor(() => {
            expect(getCameraHealthDebug).toHaveBeenCalledWith(
                expect.objectContaining({
                    state: 'problem',
                    page: 1,
                    limit: 25,
                    sort: 'severity',
                }),
                expect.any(String)
            );
        });

        expect(await screen.findByText('Jombang MJPEG')).toBeTruthy();
        expect(screen.getAllByText('degraded').length).toBeGreaterThan(0);
    });

    it('mengirim query baru saat filter berubah', async () => {
        render(<HealthDebug />);
        await screen.findByText('Jombang MJPEG');

        fireEvent.change(screen.getByDisplayValue('Problem only'), { target: { value: 'offline' } });

        await waitFor(() => {
            expect(getCameraHealthDebug).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    state: 'offline',
                    page: 1,
                }),
                expect.any(String)
            );
        });
    });
});
