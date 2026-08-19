// Purpose: Classify FFmpeg recording exits into operator-meaningful lifecycle or failure reasons.
// Caller: recordingProcessManager and recordingService close handling.
// Deps: None.
// MainFuncs: classifyRecordingExit.
// SideEffects: None.

/*
 * Reasons that mean WE stopped this recorder on purpose.
 *
 * The set has to match what the producers actually send, and for a long time it did not: it listed
 * 'camera_disabled' and 'process_shutdown', which nothing in the codebase ever emits, while the
 * real reasons — the ones the lifecycle policy, the freeze detector and the admin endpoint pass
 * in — fell through to `ffmpeg_failed`. The fallout was not cosmetic:
 *
 *   * every deliberate stop was logged to stderr as a crash and written to restart_logs as
 *     'process_crashed' — exactly the noise the logging policy exists to prevent;
 *   * a freeze-restart counted the failure TWICE (once in the monitor's tick, again on the close
 *     it had just caused), so the circuit breaker suspended a camera in half the intended number
 *     of failures.
 *
 * The `signaled` escape hatch below does not rescue these: SIGINT makes ffmpeg exit 255 with no
 * exitSignal, and `-loglevel error` suppresses the "received signal" line it would otherwise print.
 */
const INTENTIONAL_STOP_REASONS = new Set([
    'manual_stop',
    'admin_stop',
    'camera_offline',
    'camera_or_recording_disabled',
    'delivery_not_recordable',
]);

const SHUTDOWN_REASONS = new Set([
    'server_shutdown',
    'process_shutdown',
]);

const RESTART_REASONS = new Set([
    'stream_frozen_restart',
    'stream_frozen',
    'health_restart',
    'manual_restart',
    'camera_source_updated',
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

    // restartRecording appends '_restart' to whatever reason it was given, so 'api_restart'
    // becomes 'api_restart_restart'. Matching the suffix covers every future restart reason
    // without anyone having to remember to add it here.
    if (RESTART_REASONS.has(stopReason) || String(stopReason || '').endsWith('_restart')) {
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
    // An audio track that is ADVERTISED but never delivered. FFmpeg holds video packets in the
    // muxing queue waiting for audio to interleave against, overruns it, and exits — having
    // written nothing. Camera 1169 on production does exactly this: ffprobe reads `pcm_alaw` in
    // its SDP, no audio RTP packet ever arrives over its mandatory UDP transport, and the
    // recorder dies in 8 seconds. Classified apart from `ffmpeg_failed` because it is the one
    // failure the recorder can actually repair by itself — see recordingAudioFallback.js.
    if (output.includes('too many packets buffered')) {
        return 'audio_stream_stalled';
    }
    // A track the MP4 container cannot hold. This MUST be tested before 'invalid argument'
    // below, because FFmpeg reports the same failure twice and the second line wins the
    // naive match: "Could not find tag for codec pcm_alaw in stream #1, codec not currently
    // supported in container" is followed by "Could not write header for output file #0
    // (incorrect codec parameters ?): Invalid argument". Classified by that tail, a camera
    // whose microphone speaks an unmuxable codec would be reported as `invalid_source` —
    // sending the operator to check the RTSP URL, which is fine. The source is reachable;
    // the codec is the problem, and it is fixed by transcoding, not by editing the camera.
    if (output.includes('codec not currently supported in container') || output.includes('could not find tag for codec')) {
        return 'unsupported_track_codec';
    }
    if (output.includes('invalid argument') || output.includes('protocol not found') || output.includes('no such file or directory')) {
        return 'invalid_source';
    }

    return exitCode === 0 && !exitSignal ? 'intentional_stop' : 'ffmpeg_failed';
}
