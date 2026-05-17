// Purpose: Centralize safe recording file delete and quarantine operations.
// Caller: recordingCleanupService and recordingRecoveryService.
// Deps: fs promises, node:path, node:url, recordingPathSafetyPolicy.
// MainFuncs: createRecordingFileOperationService, deleteFileSafely, quarantineFile.
// SideEffects: Deletes, renames, copies, and quarantines recording files after safety checks.

import { promises as defaultFs } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isSafeRecordingFilePath } from './recordingPathSafetyPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');
const QUARANTINE_DIR_NAME = '.quarantine';

export function createRecordingFileOperationService({
    fs = defaultFs,
    recordingsBasePath = DEFAULT_RECORDINGS_BASE_PATH,
    logger = console,
    now = Date.now,
} = {}) {
    async function deleteFileSafely({ cameraId, filename, filePath, reason }) {
        if (!isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename })) {
            logger.warn?.(`[Cleanup] Refusing unsafe delete for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
            return { success: false, skipped: true, reason: 'unsafe_path', size: 0 };
        }

        try {
            const stats = await fs.stat(filePath);
            await fs.unlink(filePath);
            return { success: true, size: stats.size };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: true, missing: true, size: 0 };
            }

            logger.error?.(`[Cleanup] Error deleting ${filename || basename(filePath)} (${reason}):`, error.message);
            return { success: false, reason: error.message, size: 0 };
        }
    }

    async function quarantineFile({ cameraId, filename, filePath, reason }) {
        if (!isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename })) {
            logger.warn?.(`[Segment] Refusing unsafe quarantine for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
            return { success: false, skipped: true, reason: 'unsafe_path' };
        }

        try {
            await fs.access(filePath);
        } catch {
            return { success: true, missing: true };
        }

        const quarantineDir = join(recordingsBasePath, QUARANTINE_DIR_NAME, `camera${cameraId}`);
        const safeReason = String(reason || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
        const quarantineName = `${now()}_${safeReason}_${filename}`;
        const quarantinePath = join(quarantineDir, quarantineName);

        try {
            await fs.mkdir(quarantineDir, { recursive: true });
            await fs.rename(filePath, quarantinePath);
            logger.warn?.(`[Segment] Quarantined file: camera${cameraId}/${filename} -> ${QUARANTINE_DIR_NAME}/camera${cameraId}/${quarantineName}`);
            return { success: true, path: quarantinePath };
        } catch (error) {
            if (error.code === 'EXDEV') {
                await fs.copyFile(filePath, quarantinePath);
                await fs.unlink(filePath);
                logger.warn?.(`[Segment] Quarantined file with copy fallback: camera${cameraId}/${filename}`);
                return { success: true, path: quarantinePath };
            }

            logger.error?.(`[Segment] Failed to quarantine ${filename}:`, error.message);
            return { success: false, reason: error.message };
        }
    }

    return { deleteFileSafely, quarantineFile };
}

export default createRecordingFileOperationService();
