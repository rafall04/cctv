// Purpose: Read free disk bytes for recording storage behind an injectable boundary.
// Caller: recordingEmergencyDiskService.
// Deps: child_process exec via injected promise function.
// MainFuncs: createRecordingDiskSpaceService, getFreeBytes.
// SideEffects: Executes OS disk-space commands.

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const defaultExec = promisify(execCallback);

export function createRecordingDiskSpaceService({ exec = defaultExec } = {}) {
    async function getFreeBytes(recordingsBasePath) {
        const drive = String(recordingsBasePath || '').charAt(0);
        if (/^[A-Za-z]$/.test(drive)) {
            try {
                const { stdout } = await exec(
                    `powershell -Command "(Get-PSDrive ${drive}).Free"`,
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
            const { stdout } = await exec(
                `df -B1 "${recordingsBasePath}" | tail -1 | awk '{print $4}'`,
                { encoding: 'utf8', timeout: 5000 }
            );
            const value = Number.parseInt(String(stdout).trim(), 10);
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    }

    return { getFreeBytes };
}

export default createRecordingDiskSpaceService();
