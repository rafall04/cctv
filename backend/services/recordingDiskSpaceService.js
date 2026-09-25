// Purpose: Read free disk bytes for recording storage behind an injectable boundary.
// Caller: recordingEmergencyDiskService.
// Deps: child_process exec via injected promise function.
// MainFuncs: createRecordingDiskSpaceService, getFreeBytes.
// SideEffects: Executes OS disk-space commands.

import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';

// execFile + argv array: recordingsBasePath comes from operator config, but a shell string
// would still expand "$( )"/quotes — argv never interprets them.
const defaultExecFile = promisify(execFileCallback);

export function createRecordingDiskSpaceService({ execFile = defaultExecFile } = {}) {
    async function getFreeBytes(recordingsBasePath) {
        const drive = String(recordingsBasePath || '').charAt(0);
        if (/^[A-Za-z]$/.test(drive)) {
            try {
                const { stdout } = await execFile(
                    'powershell',
                    ['-Command', `(Get-PSDrive ${drive}).Free`],
                    { encoding: 'utf8', timeout: 5000 }
                );
                const value = Number.parseInt(String(stdout).trim(), 10);
                if (Number.isFinite(value)) {
                    return value;
                }
            } catch {
                // Fall through to POSIX df for non-Windows runtimes.
            }
        }

        try {
            const { stdout } = await execFile(
                'df',
                ['-B1', String(recordingsBasePath)],
                { encoding: 'utf8', timeout: 5000 }
            );
            // df output: header line + one data line ("Filesystem 1B-blocks Used Available Use% Mounted")
            const lastLine = String(stdout || '').trim().split('\n').pop() || '';
            const value = Number.parseInt(lastLine.trim().split(/\s+/)[3], 10);
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    }

    return { getFreeBytes };
}

export default createRecordingDiskSpaceService();
