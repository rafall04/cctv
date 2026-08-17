// Purpose: Remember, per camera, that its advertised audio track cannot actually be recorded,
//          so the next recorder start is video-only instead of failing again.
// Caller: recordingService (marks on a failed close), recordingStarter (reads before spawning).
// Deps: None.
// MainFuncs: shouldSkipRecordingAudio, markRecordingAudioUnusable, clearRecordingAudioFallback,
//            isAudioFaultReason, listRecordingAudioFallbacks.
// SideEffects: Module-level in-memory state only.
//
// WHY THIS EXISTS (a real production regression, 2026-08-17)
// ---------------------------------------------------------
// `-map 0:a?` adapts to whether a camera DECLARES audio. Camera 1169 declares it and lies:
// ffprobe reads `pcm_alaw` in its SDP, but over its (mandatory) UDP transport no audio RTP
// packet ever arrives. FFmpeg then holds video packets in the muxing queue waiting for audio
// to interleave against, overruns it, and exits 1 with
//
//     Too many packets buffered for output stream 0:0.
//
// in 8 seconds, having written no segment at all. That camera recorded fine for months on the
// old video-only arguments, so mapping audio turned a working recorder into a dead one. It is
// not a codec problem and no ffmpeg flag fixes it: `-max_interleave_delta 0` was measured on
// the production binary against this exact camera and still died in 20s, and the camera
// refuses TCP outright ("Nonmatching transport in server reply"), so switching transport is
// not available either.
//
// So the adaptation has to go one level deeper than the SDP: try audio, and if THAT is what
// killed the recorder, record this camera without audio from then on.
//
// DELIBERATELY NOT PERSISTED
// --------------------------
// This is process-local and resets when the recorder restarts, which is the point. A DB column
// would be a hand-me-down claim about hardware that goes stale exactly like `cameras.video_codec`
// did (it still says h264 for two cameras that ffprobe reads as hevc). Re-testing reality once
// per boot costs one failed start on one camera and, in exchange, a camera whose firmware starts
// delivering audio picks it up on its own.

const camerasWithUnusableAudio = new Set();

/**
 * Reasons from recordingFailureClassifier that mean "the AUDIO track is what broke this",
 * as opposed to the source being unreachable or the process being stopped on purpose.
 * Anything else must NOT disable audio — an offline camera is not an audio problem, and
 * silently dropping the microphone because the network blipped would be the same class of
 * bug this module exists to fix, only quieter.
 */
const AUDIO_FAULT_REASONS = new Set([
    'audio_stream_stalled',
    'unsupported_track_codec',
]);

export function isAudioFaultReason(reason) {
    return AUDIO_FAULT_REASONS.has(reason);
}

export function shouldSkipRecordingAudio(cameraId) {
    return camerasWithUnusableAudio.has(Number(cameraId));
}

/** Returns true the FIRST time a camera is marked, so the caller can log the transition once. */
export function markRecordingAudioUnusable(cameraId) {
    const id = Number(cameraId);
    if (!Number.isFinite(id) || camerasWithUnusableAudio.has(id)) {
        return false;
    }
    camerasWithUnusableAudio.add(id);
    return true;
}

export function listRecordingAudioFallbacks() {
    return [...camerasWithUnusableAudio].sort((a, b) => a - b);
}

/** Test seam, and the manual way to make a camera re-try audio without a restart. */
export function clearRecordingAudioFallback(cameraId = null) {
    if (cameraId === null) {
        camerasWithUnusableAudio.clear();
        return;
    }
    camerasWithUnusableAudio.delete(Number(cameraId));
}
