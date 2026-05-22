// @vitest-environment jsdom
/*
Purpose: Regression coverage for the admin Recording Health panel.
Caller: Vitest frontend jsdom suite.
Deps: RecordingHealthPanel, mocked adminService.getRecordingHealth.
MainFuncs: RecordingHealthPanel rendering assertions.
SideEffects: Mocks the recording-health API call.
*/

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingHealthPanel from './RecordingHealthPanel.jsx';
import { adminService } from '../../../services/adminService';

vi.mock('../../../services/adminService', () => ({
    adminService: {
        getRecordingHealth: vi.fn(),
    },
}));

function snapshot(overrides = {}) {
    return {
        success: true,
        data: {
            generatedAt: new Date().toISOString(),
            status: { level: 'ok', reasons: [] },
            scheduler: {
                running: true,
                taskCount: 1,
                tasks: [
                    {
                        name: 'segment-recovery-scanner',
                        intervalMs: 60000,
                        runCount: 9,
                        lastRunAt: Date.now() - 5000,
                        lastDurationMs: 120,
                        lastError: null,
                        healthy: true,
                        overdue: false,
                    },
                ],
            },
            recovery: {
                queue: { queueLength: 0, inFlightCount: 0, activeCount: 0, maxConcurrent: 3 },
                diagnostics: { byState: {}, activeTotal: 0, terminalTotal: 0, maxAttemptCount: 0, recentTerminal: [] },
            },
            recordingProcesses: { byStatus: {}, recording: 5, stopped: 1 },
            restarts: { last24h: { total: 4, succeeded: 4, failed: 0 }, recent: [] },
            storage: { totalSegments: 100, totalSizeBytes: 0, totalSizeGB: 0 },
            ...overrides,
        },
    };
}

describe('RecordingHealthPanel', () => {
    beforeEach(() => {
        adminService.getRecordingHealth.mockReset();
    });

    it('renders a healthy snapshot with the status badge and scheduler task', async () => {
        adminService.getRecordingHealth.mockResolvedValue(snapshot());

        render(<RecordingHealthPanel />);

        await waitFor(() => {
            expect(screen.getByText('Sehat')).toBeTruthy();
        });
        expect(screen.getByText('Kesehatan Pipeline Recording')).toBeTruthy();
        expect(screen.getByText('segment-recovery-scanner')).toBeTruthy();
        expect(screen.getByText('9× jalan')).toBeTruthy();
    });

    it('shows the critical badge and reasons when the pipeline is broken', async () => {
        adminService.getRecordingHealth.mockResolvedValue(
            snapshot({
                status: { level: 'critical', reasons: ['scheduler is not running'] },
                scheduler: { running: false, taskCount: 0, tasks: [] },
            })
        );

        render(<RecordingHealthPanel />);

        await waitFor(() => {
            expect(screen.getByText('Kritis')).toBeTruthy();
        });
        expect(screen.getByText('scheduler is not running')).toBeTruthy();
        expect(screen.getByText('Mati')).toBeTruthy();
    });

    it('renders an error state when the request fails', async () => {
        adminService.getRecordingHealth.mockResolvedValue({
            success: false,
            message: 'Failed to fetch recording health',
        });

        render(<RecordingHealthPanel />);

        await waitFor(() => {
            expect(screen.getByText('Failed to fetch recording health')).toBeTruthy();
        });
    });
});
