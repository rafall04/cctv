/**
 * Purpose: Verify recording disk free-space reader behavior.
 * Caller: Vitest backend suite.
 * Deps: recordingDiskSpaceService with injected exec.
 * MainFuncs: createRecordingDiskSpaceService.
 * SideEffects: None; shell exec is mocked.
 */

import { describe, expect, it, vi } from 'vitest';

describe('recordingDiskSpaceService', () => {
    it('reads Windows drive free bytes from the recording base path', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const exec = vi.fn(async () => ({ stdout: '2147483648\n' }));
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('C:\\recordings')).resolves.toBe(2147483648);
        expect(exec).toHaveBeenCalledWith(
            'powershell -Command "(Get-PSDrive C).Free"',
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('falls back to df when PowerShell fails', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const exec = vi.fn()
            .mockRejectedValueOnce(new Error('powershell unavailable'))
            .mockResolvedValueOnce({ stdout: '999\n' });
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('C:\\recordings')).resolves.toBe(999);
        expect(exec).toHaveBeenNthCalledWith(
            2,
            'df -B1 "C:\\recordings" | tail -1 | awk \'{print $4}\'',
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('returns null when free bytes cannot be determined', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const exec = vi.fn().mockRejectedValue(new Error('no disk command'));
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('/recordings')).resolves.toBe(null);
    });
});
