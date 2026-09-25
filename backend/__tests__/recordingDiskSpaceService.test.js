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
        const execFile = vi.fn(async () => ({ stdout: '2147483648\n' }));
        const service = createRecordingDiskSpaceService({ execFile });

        await expect(service.getFreeBytes('C:\\recordings')).resolves.toBe(2147483648);
        expect(execFile).toHaveBeenCalledWith(
            'powershell',
            ['-Command', '(Get-PSDrive C).Free'],
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('falls back to df when PowerShell fails — path dikirim sebagai argv, bukan shell', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const execFile = vi.fn()
            .mockRejectedValueOnce(new Error('powershell unavailable'))
            .mockResolvedValueOnce({ stdout: 'Filesystem 1B-blocks Used Available Use% Mounted\noverlay 5000 4001 999 81% /recordings\n' });
        const service = createRecordingDiskSpaceService({ execFile });

        await expect(service.getFreeBytes('C:\\recordings')).resolves.toBe(999);
        expect(execFile).toHaveBeenNthCalledWith(
            2,
            'df',
            ['-B1', 'C:\\recordings'],
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('metachar di path tidak bisa jadi injection — ia hanya arg df', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const execFile = vi.fn().mockResolvedValue({ stdout: 'Filesystem 1B-blocks Used Available Use% Mounted\noverlay 1 1 7 50% /x\n' });
        const service = createRecordingDiskSpaceService({ execFile });

        await expect(service.getFreeBytes('/r"; rm -rf / #')).resolves.toBe(7);
        expect(execFile).toHaveBeenCalledWith('df', ['-B1', '/r"; rm -rf / #'], expect.anything());
    });

    it('returns null when free bytes cannot be determined', async () => {
        const { createRecordingDiskSpaceService } = await import('../services/recordingDiskSpaceService.js');
        const execFile = vi.fn().mockRejectedValue(new Error('no disk command'));
        const service = createRecordingDiskSpaceService({ execFile });

        await expect(service.getFreeBytes('/recordings')).resolves.toBe(null);
    });
});
