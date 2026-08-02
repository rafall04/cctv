/**
 * Purpose: Answer "if I set retention to N hours, will it fit?" from what this fleet actually
 *          records, rather than from a number someone guessed once.
 * Caller: recordingCapacityController (GET /api/admin/recording-capacity).
 * Deps: connectionPool, recordingDiskSpaceService, recordingPaths, recordingIntervalsPolicy.
 * MainFuncs: getCapacity.
 * SideEffects: None to the database — reads segment rows and shells out once for free disk bytes.
 *
 * WHY MEASURE INSTEAD OF ASSUME
 * Bitrate per camera is not a property of the resolution — on production 720p, 480p and 360p feeds
 * all landed at roughly 1 Mbps, while an earlier estimate taken from high-bitrate owned RTSP
 * cameras was 20% lower and would have under-budgeted the disk. The only trustworthy figure is
 * this fleet's own bytes divided by this fleet's own recorded hours.
 *
 * WHY RETENTION IS NOT THE WHOLE COST
 * Files are deleted at retention + grace, where grace is max(10 min, retention × 0.1). A 4-hour
 * setting really occupies 4 h 24 m of footage, and budgeting for 4 h flat is how a disk fills up
 * at 96% and looks like a bug.
 */

import { query, queryOne } from '../database/connectionPool.js';
import diskSpaceService from './recordingDiskSpaceService.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import { RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES } from './recordingIntervalsPolicy.js';

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Fallback rate: 0.43 GB per camera-hour, measured on production 2026-07-31 across 30 concurrent
 * external-HLS recorders. Used only until this installation has produced enough of its own data.
 */
const DEFAULT_BYTES_PER_CAMERA_HOUR = 0.43 * BYTES_PER_GB;

/** Below this much recorded time a camera's rate is noise, not a measurement. */
const MIN_SAMPLE_HOURS = 0.5;

/** The retention values worth showing side by side. The live one is merged in on top. */
const PRESET_HOURS = [4, 6, 12, 24, 48, 72, 168];

/** Grace matches recordingRetentionPolicy: files survive retention + grace, so budget for both. */
export function effectiveHours(retentionHours) {
    const hours = Math.max(0, Number(retentionHours) || 0);
    return hours + Math.max(10 / 60, hours * 0.1);
}

/**
 * Bytes this fleet actually writes per camera-hour.
 *
 * The span is MIN(start_time)→MAX(start_time), which omits the final segment's own duration and so
 * understates recorded hours by roughly one segment per camera. That biases the rate slightly HIGH,
 * i.e. toward reserving more disk — the safe direction for a number used to size storage.
 *
 * julianday() rather than parsing in JS: segment timestamps are written UTC, but a bare
 * 'YYYY-MM-DD HH:MM:SS' would be read as local time by Date.parse and skew the span by the offset.
 */
function measureRate() {
    let row;
    try {
        row = queryOne(`
            SELECT SUM(bytes)       AS bytes,
                   SUM(span_hours)  AS camera_hours,
                   COUNT(*)         AS cameras
              FROM (SELECT camera_id,
                           SUM(file_size) AS bytes,
                           (julianday(MAX(start_time)) - julianday(MIN(start_time))) * 24.0 AS span_hours
                      FROM recording_segments
                     GROUP BY camera_id)
             WHERE span_hours >= ?
               AND bytes > 0
        `, [MIN_SAMPLE_HOURS]);
    } catch {
        row = null;
    }

    const bytes = Number(row?.bytes) || 0;
    const cameraHours = Number(row?.camera_hours) || 0;

    if (!bytes || cameraHours < MIN_SAMPLE_HOURS) {
        return {
            bytesPerCameraHour: DEFAULT_BYTES_PER_CAMERA_HOUR,
            source: 'default',
            sampleCameras: 0,
            sampleHours: 0,
        };
    }

    return {
        bytesPerCameraHour: bytes / cameraHours,
        source: 'measured',
        sampleCameras: Number(row.cameras) || 0,
        sampleHours: Math.round(cameraHours),
    };
}

class RecordingCapacityService {
    /**
     * @returns {Promise<object>} rate, current usage, disk headroom, and a projection per retention.
     *
     * `safeBytes` deliberately subtracts the emergency-cleanup threshold. That reserve is not
     * spare room — crossing it triggers bulk deletion of footage, so a retention that "fits" only
     * by eating into it does not actually fit.
     */
    async getCapacity() {
        const cameras = query(`
            SELECT id, recording_duration_hours
              FROM cameras
             WHERE enable_recording = 1
               AND enabled = 1
        `);

        const usage = queryOne('SELECT SUM(file_size) AS bytes FROM recording_segments');
        const usedBytes = Number(usage?.bytes) || 0;

        const freeBytes = await diskSpaceService.getFreeBytes(RECORDINGS_BASE_PATH);
        const rate = measureRate();

        const retentions = cameras
            .map((camera) => Number(camera.recording_duration_hours) || 0)
            .filter((hours) => hours > 0);
        const currentHours = retentions.length ? Math.max(...retentions) : null;

        // Free space PLUS what recordings already hold: changing retention re-sizes that same pile,
        // so the room available is both together, minus the reserve that must stay untouched.
        const safeBytes = freeBytes === null
            ? null
            : Math.max(0, freeBytes + usedBytes - RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES);

        const candidates = [...new Set([...PRESET_HOURS, ...(currentHours ? [currentHours] : [])])]
            .sort((a, b) => a - b);

        return {
            cameras: cameras.length,
            retention: {
                currentHours,
                minHours: retentions.length ? Math.min(...retentions) : null,
                maxHours: retentions.length ? Math.max(...retentions) : null,
                mixed: new Set(retentions).size > 1,
            },
            rate,
            disk: {
                freeBytes,
                usedByRecordingsBytes: usedBytes,
                reservedBytes: RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES,
                safeBytes,
                basePath: RECORDINGS_BASE_PATH,
            },
            projections: candidates.map((hours) => {
                const bytes = rate.bytesPerCameraHour * cameras.length * effectiveHours(hours);
                return {
                    hours,
                    effectiveHours: Math.round(effectiveHours(hours) * 100) / 100,
                    bytes: Math.round(bytes),
                    fits: safeBytes === null ? null : bytes <= safeBytes,
                    isCurrent: hours === currentHours,
                };
            }),
        };
    }
}

export default new RecordingCapacityService();
