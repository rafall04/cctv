// Purpose: Remux a recording segment file into MP4 with faststart so it is web-seekable.
// Caller: recordingSegmentFinalizer.
// Deps: child_process spawn.
// MainFuncs: createRecordingRemuxer, remuxToFile.
// SideEffects: Spawns ffmpeg child process; writes to the target path.

import { spawn } from 'child_process';

const STDERR_SAMPLE_LIMIT = 10000;
const STDERR_TAIL_LIMIT = 500;

export function createRecordingRemuxer({ ffmpegBinary = 'ffmpeg' } = {}) {
    function remuxToFile(sourcePath, targetPath) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegBinary, [
                '-i', sourcePath,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-fflags', '+genpts',
                '-avoid_negative_ts', 'make_zero',
                '-f', 'mp4',
                '-y',
                targetPath,
            ]);

            let stderr = '';
            ffmpeg.stderr?.on('data', (chunk) => {
                if (stderr.length < STDERR_SAMPLE_LIMIT) {
                    stderr += chunk.toString();
                }
            });
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`ffmpeg remux failed with code ${code}: ${stderr.slice(-STDERR_TAIL_LIMIT)}`));
            });
            ffmpeg.on('error', reject);
        });
    }

    return { remuxToFile };
}
