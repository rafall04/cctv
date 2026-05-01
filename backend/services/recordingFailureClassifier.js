// Purpose: Classify FFmpeg recording exits into operator-meaningful lifecycle or failure reasons.
// Caller: recordingProcessManager and recordingService close handling.
// Deps: None.
// MainFuncs: classifyRecordingExit.
// SideEffects: None.

const INTENTIONAL_STOP_REASONS = new Set([
    'manual_stop',
    'camera_disabled',
    'camera_offline',
]);

const SHUTDOWN_REASONS = new Set([
    'server_shutdown',
    'process_shutdown',
]);

const RESTART_REASONS = new Set([
    'stream_frozen_restart',
    'health_restart',
    'manual_restart',
]);

export function classifyRecordingExit({
    ffmpegOutput = '',
    exitCode = null,
    exitSignal = null,
    streamSource = 'internal',
    stopReason = null,
} = {}) {
    if (SHUTDOWN_REASONS.has(stopReason)) {
        return 'intentional_shutdown';
    }

    if (RESTART_REASONS.has(stopReason)) {
        return 'restart_requested';
    }

    if (INTENTIONAL_STOP_REASONS.has(stopReason)) {
        return 'intentional_stop';
    }

    const output = String(ffmpegOutput).toLowerCase();
    const signaled = exitSignal || output.includes('received signal') || output.includes('immediate exit requested');

    if (signaled && stopReason) {
        return stopReason === 'server_shutdown' ? 'intentional_shutdown' : 'intentional_stop';
    }

    if (output.includes('http error 403') || output.includes('forbidden') || output.includes('access denied')) {
        return 'upstream_unreachable';
    }
    if (output.includes('404 not found') || output.includes('server returned 404')) {
        return 'upstream_unreachable';
    }
    if (output.includes('connection refused') || output.includes('connection timed out') || output.includes('timed out')) {
        return 'upstream_unreachable';
    }
    if (streamSource === 'external' && (output.includes('invalid data found') || output.includes('failed to open segment') || output.includes('error when loading first segment'))) {
        return 'unsupported_playlist';
    }
    if (output.includes('invalid argument') || output.includes('protocol not found') || output.includes('no such file or directory')) {
        return 'invalid_source';
    }

    return exitCode === 0 && !exitSignal ? 'intentional_stop' : 'ffmpeg_failed';
}
