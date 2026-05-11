/**
 * Purpose: Build a read-only assurance snapshot for enabled CCTV recording health.
 * Caller: Recording admin controller and future dashboard/alerting surfaces.
 * Deps: database query helper, recordingService runtime state, and bounded filesystem stat checks.
 * MainFuncs: RecordingAssuranceService.getSnapshot().
 * SideEffects: Reads database rows and latest segment file metadata; does not mutate recording state.
 */

import { existsSync, statSync } from 'fs';
import { query } from '../database/connectionPool.js';
import { recordingService } from './recordingService.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_GAP_TOLERANCE_SECONDS = 180;
const DEFAULT_RECENT_WINDOW_HOURS = 24;

function parseDateMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function buildPlaceholders(count) {
    return Array.from({ length: count }, () => '?').join(', ');
}

function makeEmptySnapshot(now) {
    return {
        generated_at: now.toISOString(),
        summary: {
            total_monitored: 0,
            healthy: 0,
            warning: 0,
            critical: 0,
            recording_down: 0,
            stale_segments: 0,
            missing_segments: 0,
            recent_gap_cameras: 0,
        },
        cameras: [],
        recoveryDiagnostics: recordingRecoveryDiagnosticsRepository.summarizeActive(),
    };
}

function readLatestSegmentFileState(segment) {
    if (!segment?.file_path) {
        return { exists: false, size: 0 };
    }

    if (!existsSync(segment.file_path)) {
        return { exists: false, size: 0 };
    }

    try {
        const stats = statSync(segment.file_path);
        return {
            exists: true,
            size: stats.size,
        };
    } catch {
        return { exists: false, size: 0 };
    }
}

class RecordingAssuranceService {
    getSnapshot(options = {}) {
        const now = options.now || new Date();
        const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
        const gapToleranceSeconds = options.gapToleranceSeconds ?? DEFAULT_GAP_TOLERANCE_SECONDS;
        const recentWindowHours = options.recentWindowHours ?? DEFAULT_RECENT_WINDOW_HOURS;

        const cameras = query(`
            SELECT
                c.id,
                c.name,
                c.stream_source,
                c.recording_status,
                c.last_recording_start
            FROM cameras c
            WHERE c.enabled = 1
              AND c.enable_recording = 1
            ORDER BY c.id ASC
        `);

        if (cameras.length === 0) {
            return makeEmptySnapshot(now);
        }

        const cameraIds = cameras.map((camera) => camera.id);
        const placeholders = buildPlaceholders(cameraIds.length);
        const latestSegments = query(`
            WITH ranked_segments AS (
                SELECT
                    rs.camera_id,
                    rs.filename,
                    rs.start_time,
                    rs.end_time,
                    rs.file_size,
                    rs.duration,
                    rs.file_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY rs.camera_id
                        ORDER BY datetime(rs.start_time) DESC, rs.id DESC
                    ) as rank
                FROM recording_segments rs
                WHERE rs.camera_id IN (${placeholders})
            )
            SELECT
                camera_id,
                filename,
                start_time,
                end_time,
                file_size,
                duration,
                file_path
            FROM ranked_segments
            WHERE rank = 1
        `, cameraIds);

        const recentWindowStart = new Date(now.getTime() - recentWindowHours * 60 * 60 * 1000).toISOString();
        const recentGaps = query(`
            WITH ordered_segments AS (
                SELECT
                    rs.camera_id,
                    rs.start_time,
                    rs.end_time,
                    LAG(rs.end_time) OVER (
                        PARTITION BY rs.camera_id
                        ORDER BY datetime(rs.start_time) ASC, rs.id ASC
                    ) as previous_end_time
                FROM recording_segments rs
                WHERE rs.camera_id IN (${placeholders})
                  AND rs.start_time >= ?
            ),
            measured_gaps AS (
                SELECT
                    camera_id,
                    CAST((julianday(start_time) - julianday(previous_end_time)) * 86400 AS INTEGER) as gap_seconds
                FROM ordered_segments
                WHERE previous_end_time IS NOT NULL
            )
            SELECT
                camera_id,
                COUNT(*) as gap_count,
                MAX(gap_seconds) as max_gap_seconds
            FROM measured_gaps
            WHERE gap_seconds > ?
            GROUP BY camera_id
        `, [...cameraIds, recentWindowStart, gapToleranceSeconds]);

        const latestByCamera = new Map(latestSegments.map((segment) => [segment.camera_id, segment]));
        const gapByCamera = new Map(recentGaps.map((gap) => [gap.camera_id, gap]));
        const snapshot = makeEmptySnapshot(now);
        snapshot.summary.total_monitored = cameras.length;

        snapshot.cameras = cameras.map((camera) => {
            const runtimeStatus = recordingService.getRecordingStatus(camera.id);
            const latestSegment = latestByCamera.get(camera.id) || null;
            const recentGap = gapByCamera.get(camera.id) || null;
            const reasons = [];

            if (!runtimeStatus?.isRecording) {
                reasons.push('recording_process_down');
                snapshot.summary.recording_down += 1;
            }

            let secondsSinceLatestEnd = null;
            if (!latestSegment) {
                const startedAtMs = parseDateMs(camera.last_recording_start);
                if (!startedAtMs || now.getTime() - startedAtMs > staleAfterMs) {
                    reasons.push('no_segments_after_start');
                    snapshot.summary.missing_segments += 1;
                } else {
                    reasons.push('waiting_first_segment');
                }
            } else {
                const latestEndMs = parseDateMs(latestSegment.end_time) || parseDateMs(latestSegment.start_time);
                if (latestEndMs) {
                    secondsSinceLatestEnd = Math.max(0, Math.round((now.getTime() - latestEndMs) / 1000));
                    if (now.getTime() - latestEndMs > staleAfterMs) {
                        reasons.push('segment_stale');
                        snapshot.summary.stale_segments += 1;
                    }
                }

                if (Number(latestSegment.file_size || 0) <= 0) {
                    reasons.push('latest_segment_empty');
                }

                const fileState = readLatestSegmentFileState(latestSegment);
                if (!fileState.exists) {
                    reasons.push('latest_segment_file_missing');
                } else if (Number(latestSegment.file_size || 0) > 0 && fileState.size !== Number(latestSegment.file_size)) {
                    reasons.push('latest_segment_size_mismatch');
                }
            }

            if (recentGap) {
                reasons.push('recent_segment_gap');
                snapshot.summary.recent_gap_cameras += 1;
            }

            const hasCriticalReason = reasons.some((reason) => [
                'recording_process_down',
                'no_segments_after_start',
                'segment_stale',
                'latest_segment_empty',
                'latest_segment_file_missing',
            ].includes(reason));
            const health = hasCriticalReason ? 'critical' : (reasons.length > 0 ? 'warning' : 'healthy');
            snapshot.summary[health] += 1;

            return {
                id: camera.id,
                name: camera.name,
                stream_source: camera.stream_source,
                recording_status: camera.recording_status,
                runtime_status: runtimeStatus,
                health,
                reasons,
                seconds_since_latest_end: secondsSinceLatestEnd,
                latest_segment: latestSegment,
                recent_gap: recentGap ? {
                    gap_count: Number(recentGap.gap_count || 0),
                    max_gap_seconds: Number(recentGap.max_gap_seconds || 0),
                } : null,
            };
        });

        return snapshot;
    }
}

export default new RecordingAssuranceService();
