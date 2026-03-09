// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecordingRestartLogs from './RecordingRestartLogs.jsx';

describe('RecordingRestartLogs', () => {
    it('menampilkan restart log dengan restart_time yang valid dan status recovery yang jelas', () => {
        render(
            <RecordingRestartLogs
                logs={[
                    {
                        camera_name: 'SIMPANG 3 AHMAD YANI - VETERAN',
                        reason: 'process_crashed',
                        success: 1,
                        restart_time: '2026-03-09T12:10:00.000Z',
                        recovery_time: '2026-03-09T12:11:30.000Z',
                    },
                ]}
            />
        );

        expect(screen.getByText('SIMPANG 3 AHMAD YANI - VETERAN')).toBeTruthy();
        expect(screen.getByText('Proses Crash')).toBeTruthy();
        expect(screen.getByText('Pulih')).toBeTruthy();
        expect(screen.queryByText('Invalid Date')).toBeNull();
        expect(screen.getByText(/Pulih dalam/i)).toBeTruthy();
    });

    it('menampilkan fallback aman saat timestamp tidak valid atau recovery belum ada', () => {
        render(
            <RecordingRestartLogs
                logs={[
                    {
                        camera_name: 'DEPAN UJI KENDARAAN BERMOTOR',
                        reason: 'stream_frozen',
                        success: 0,
                        restart_time: null,
                        recovery_time: null,
                    },
                ]}
            />
        );

        expect(screen.getByText('DEPAN UJI KENDARAAN BERMOTOR')).toBeTruthy();
        expect(screen.getByText('Stream Beku')).toBeTruthy();
        expect(screen.getByText('Belum Pulih')).toBeTruthy();
        expect(screen.queryByText('Invalid Date')).toBeNull();
        expect(screen.getByText('Belum pulih')).toBeTruthy();
        expect(screen.getByText('-')).toBeTruthy();
    });

    it('menampilkan state kosong saat belum ada restart logs', () => {
        render(<RecordingRestartLogs logs={[]} />);

        expect(screen.getByText('Belum ada restart logs')).toBeTruthy();
    });
});
