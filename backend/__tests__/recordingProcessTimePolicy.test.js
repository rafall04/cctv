/**
 * Purpose: Verify recording process timezone environment policy.
 * Caller: Vitest backend test suite.
 * Deps: mocked timezoneService and recordingProcessTimePolicy.
 * MainFuncs: getRecordingProcessTimezone, buildRecordingProcessEnv.
 * SideEffects: None.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

const {
    buildRecordingProcessEnv,
    getRecordingProcessTimezone,
} = await import('../services/recordingProcessTimePolicy.js');

describe('recordingProcessTimePolicy', () => {
    it('uses the configured application timezone for FFmpeg strftime output', () => {
        expect(getRecordingProcessTimezone()).toBe('Asia/Jakarta');
    });

    it('preserves existing environment values while setting TZ explicitly', () => {
        expect(buildRecordingProcessEnv({ PATH: '/usr/bin', TZ: 'UTC' })).toEqual({
            PATH: '/usr/bin',
            TZ: 'Asia/Jakarta',
        });
    });
});
