// Purpose: Build the FFmpeg recording invocation (args, dirs, env, callbacks) for one camera.
// Caller: recordingService.startRecording.
// Deps: fs.mkdirSync, recording segment file policy, process time policy, internal RTSP transport policy,
//        camera delivery utilities. Pure beyond mkdirSync side effect.
// MainFuncs: prepareRecordingStart, getRecordingSourceConfig, buildRecordingFfmpegArgs,
//        maskRecordingSourceForLog, isRecordingAudioEnabled.
// SideEffects: Creates the camera + pending recording directories (idempotent mkdirSync recursive).

import { mkdirSync } from 'fs';
import { join } from 'path';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import { buildFfmpegRtspInputArgs, resolveInternalRtspTransport } from '../utils/internalRtspTransportPolicy.js';
import {
    buildRecordingProcessEnv,
    getRecordingProcessTimezone,
} from './recordingProcessTimePolicy.js';
import {
    getCameraRecordingDir,
    getPendingRecordingDir,
    getPendingRecordingPattern,
} from './recordingSegmentFilePolicy.js';
import { RECORDING_RTSP_SOCKET_TIMEOUT_MICROS } from './recordingIntervalsPolicy.js';
import { getFfmpegLogPath } from './recordingFfmpegLog.js';
import { shouldSkipRecordingAudio } from './recordingAudioFallback.js';
import settingsService from './settingsService.js';

const EXTERNAL_RECORDING_PROTOCOL_WHITELIST = 'file,http,https,tcp,tls,crypto';

// Record the microphone when the camera has one, stay video-only when it does not —
// decided by FFmpeg per camera at start time, NOT by a database column.
//
// The `?` in `-map 0:a?` is the whole adaptation mechanism: it makes the audio stream
// OPTIONAL. Without it, a camera with no microphone dies instantly with
// "Stream map '0:a' matches no streams" — verified on the production binary against a
// real audio-less camera (exit 1 in 2s). With it, the same camera records video-only
// and exits 0, while its neighbour on the same server records both.
//
// Why no `has_audio` column: `cameras.video_codec` is the cautionary tale. It is set by
// hand, and on production it claims h264 for cameras 1 and 2 while ffprobe reads hevc on
// both. A hand-maintained capability column goes stale; `-map 0:a?` re-decides on every
// recorder start, so a camera that gains or loses a mic corrects itself.
//
// Why transcode instead of `-c:a copy`: every microphone on this deployment speaks G.711
// (`pcm_alaw`/`pcm_mulaw`, 8 kHz mono, 64 kbps), and G.711 HAS NO TAG IN THE MP4
// CONTAINER. Stream-copying it does not degrade — it kills the recorder before the first
// segment exists. Measured on the prod binary (ffmpeg 4.2.7) against cameras 1 and 1435:
//
//   -c:a copy  -> "Could not find tag for codec pcm_alaw in stream #1, codec not
//                  currently supported in container" / "Could not write header"
//                  -> exit 1, 0 bytes on disk, in ~1.2s
//   -c:a aac   -> exit 0, aac LC 8000 Hz mono, segments play
//
// Nine of the twelve recording cameras carry G.711, so `-c:a copy` would have stopped
// nine recorders at once. It also passes the whole test suite, which is exactly why the
// reasoning lives here.
//
// 32k, not 64k: FFmpeg's native AAC encoder is bounded by the 8 kHz mono source. Asking
// for 64k yielded 40.7 kbps of actual output; 32k yielded 32.05 kbps. The extra request
// buys nothing. Measured cost per camera, 120s wall on prod camera 9:
//   video-only 4.06s CPU -> with audio 4.61s CPU  (+0.46% of one core)
//   audio track 244,550 B / 60s = 32.6 kbps ~ 350 MB/camera/day
// On-disk impact is bounded by the ~5h retention window (<1 GB); the long-term cost lands
// on the Telegram archive, which copies segments byte-for-byte with no transcode.
const RECORDING_AUDIO_MAP_ARGS = ['-map', '0:a?'];
const RECORDING_AUDIO_CODEC_ARGS = ['-c:a', 'aac', '-b:a', '32k'];

// Escape hatch. A wrong argument here does not degrade one camera, it stops EVERY
// recorder on the next restart, and this file's history is a list of exactly that kind of
// incident. Restores the previous video-only behaviour without a deploy.
//
// Precedence DB -> env -> default(on), read lazily so the knob is honoured per call rather
// than frozen at import: the admin toggle (`recording_audio_enabled` in the settings table)
// wins, `RECORDING_AUDIO=off` stays a working fallback for installs that never opened the UI,
// and an untouched install records audio exactly as before.
export function isRecordingAudioEnabled() {
    const stored = settingsService.getSettingValue('recording_audio_enabled');
    if (stored === true || stored === false) return stored;
    if (stored === 'true' || stored === 1 || stored === '1' || stored === 'on') return true;
    if (stored === 'false' || stored === 0 || stored === '0' || stored === 'off') return false;
    return String(process.env.RECORDING_AUDIO || '').trim().toLowerCase() !== 'off';
}

export function maskRecordingSourceForLog(sourceUrl) {
    if (!sourceUrl) return '';
    try {
        const url = new URL(sourceUrl);
        if (url.username || url.password) {
            url.username = '****';
            url.password = '****';
        }
        if (url.search) {
            for (const [key] of url.searchParams.entries()) {
                url.searchParams.set(key, '***');
            }
        }
        return url.toString();
    } catch {
        return sourceUrl.replace(/:[^:@]+@/, ':****@');
    }
}

export function getRecordingSourceConfig(camera) {
    const deliveryType = getEffectiveDeliveryType(camera);
    const streamSource = deliveryType === 'internal_hls' ? 'internal' : 'external';

    if (deliveryType === 'external_hls') {
        const externalUrl = (getPrimaryExternalStreamUrl(camera) || '').trim();
        if (!externalUrl) {
            return {
                success: false,
                reason: 'invalid_source',
                message: 'External HLS URL is required for external recording',
            };
        }
        if (!/^https?:\/\//i.test(externalUrl)) {
            return {
                success: false,
                reason: 'invalid_source',
                message: 'Invalid external HLS URL',
            };
        }
        return {
            success: true,
            streamSource,
            inputUrl: externalUrl,
            logSource: maskRecordingSourceForLog(externalUrl),
        };
    }

    if (deliveryType !== 'internal_hls') {
        return {
            success: false,
            reason: 'unsupported_source',
            message: 'Playback recording only supports internal HLS or external HLS cameras',
        };
    }

    const rtspUrl = (camera?.private_rtsp_url || '').trim();
    if (!rtspUrl || !/^rtsp:\/\//i.test(rtspUrl)) {
        return {
            success: false,
            reason: 'invalid_source',
            message: 'Invalid RTSP URL',
        };
    }

    return {
        success: true,
        streamSource,
        inputUrl: rtspUrl,
        logSource: maskRecordingSourceForLog(rtspUrl),
        rtspTransport: resolveInternalRtspTransport(camera),
    };
}

// Quiet FFmpeg down to what a human can act on, WITHOUT losing the progress line.
//
// `-stats` is the load-bearing flag, not decoration. FFmpeg's progress output is
// the heartbeat recordingHealthMonitor uses to detect a frozen recorder, and at
// `-loglevel error` the normal av_log path would swallow it. With `-stats` passed
// explicitly FFmpeg bypasses av_log and writes the progress line straight to
// stderr, so the heartbeat survives the quieter level. Verified on the production
// binary (ffmpeg 4.4.2, real upstream, 12s run):
//
//                                 stderr bytes   lines   frame= heartbeats
//   current (no -loglevel)               3,998      48                   3
//   -hide_banner -loglevel error -stats    244       3                   3
//
// Same heartbeat, 94% less output, and a broken input still reports
// "Server returned 404 Not Found". `-nostats` would break the freeze detector —
// see the warning in recordingFfmpegLog.js.
const RECORDING_LOG_ARGS = ['-hide_banner', '-loglevel', 'error', '-stats'];

// Survive a hiccup on the far end instead of dying and leaving a hole in the recording.
//
// External cameras are third-party HLS endpoints reached over the public internet, and
// they drop connections routinely: production logged 278 recorder exits in 2.5 days,
// classified `upstream_unreachable` (212) and `ffmpeg_failed` (49). Every one of those
// is a gap in the footage plus a respawn. Without these options FFmpeg treats a dropped
// TCP connection as end-of-input and exits.
//
// These are HTTP-protocol options, so they apply to the external branch ONLY — RTSP has
// its own reconnect semantics and its socket timeout is handled in
// internalRtspTransportPolicy.
//
// The important property is what these do NOT retry. FFmpeg's reconnect covers transport
// failures, not HTTP status codes (`-reconnect_on_http_error` would be needed for that,
// and is deliberately not set). So the split lands exactly where it should:
//
//   connection refused / timed out  -> retried, recording continues
//   404 / 403                       -> still fails immediately
//
// That second half matters: six cameras on this deployment are permanently dead at the
// source (stable 404). If reconnect retried those, ffmpeg would sit there forever
// holding a slot and never reach the failure handler — worse than the crashes being
// fixed. Verified on the production binary (ffmpeg 4.4.2) against a real 404 URL:
// exits in 0s with "Server returned 404 Not Found", identical to today's behaviour.
// `-reconnect_delay_max 30` bounds the backoff so even transport retries give up.
const EXTERNAL_RECONNECT_ARGS = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '30',
];

export function buildRecordingFfmpegArgs({
    cameraDir,
    outputPattern,
    inputUrl,
    streamSource,
    rtspTransport = 'tcp',
    // null = decide from the global knob. A caller passes false for a camera that has already
    // proven its advertised audio cannot be recorded (recordingAudioFallback.js).
    withAudio = null,
}) {
    const resolvedOutputPattern = outputPattern || join(cameraDir, '%Y%m%d_%H%M%S.mp4');
    const inputArgs = streamSource === 'external'
        ? [
            '-protocol_whitelist', EXTERNAL_RECORDING_PROTOCOL_WHITELIST,
            ...EXTERNAL_RECONNECT_ARGS,
            '-i', inputUrl,
        ]
        : buildFfmpegRtspInputArgs(inputUrl, rtspTransport, {
            socketTimeoutMicros: RECORDING_RTSP_SOCKET_TIMEOUT_MICROS,
        });

    const audioEnabled = withAudio === null ? isRecordingAudioEnabled() : Boolean(withAudio);

    return [
        ...RECORDING_LOG_ARGS,
        ...inputArgs,
        '-map', '0:v',
        ...(audioEnabled ? RECORDING_AUDIO_MAP_ARGS : []),
        '-c:v', 'copy',
        ...(audioEnabled ? RECORDING_AUDIO_CODEC_ARGS : ['-an']),
        '-f', 'segment',
        '-segment_time', '600',
        '-segment_format', 'mp4',
        // The fragmented-MP4 flags MUST be handed to the inner mp4 muxer via
        // -segment_format_options. As a bare top-level `-movflags` they are applied to
        // the SEGMENT muxer, which has no such option and drops them silently — no
        // warning, no error, and the mp4 muxer then runs with its default behaviour of
        // holding the whole moov atom in memory until the segment closes.
        //
        // Measured on prod ffmpeg 4.2.7, 12 seconds into a segment:
        //   bare -movflags            ->     48 bytes on disk, "moov atom not found"
        //   -segment_format_options   -> 236,140 bytes, plays fine, survives SIGKILL
        //
        // That silent drop is why every abrupt stop destroyed the entire in-flight
        // segment (up to 10 minutes per camera) instead of losing a few seconds, and
        // why the 2026-07-27 crash loop left 2,087 unrecoverable partials behind.
        '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
        '-segment_atclocktime', '1',
        '-reset_timestamps', '1',
        '-strftime', '1',
        resolvedOutputPattern,
    ];
}

/**
 * Prepare directories, build ffmpeg args, build spawn env. Returns a struct that
 * the facade can hand directly to recordingProcessManager.start().
 *
 * Returns { success: true, sourceConfig, ffmpegArgs, spawnOptions, cameraDir }
 * or       { success: false, message, reason }.
 */
export function prepareRecordingStart({ camera, recordingsBasePath }) {
    if (!camera) {
        return { success: false, message: 'Camera not found' };
    }

    const sourceConfig = getRecordingSourceConfig(camera);
    if (!sourceConfig.success) {
        return { success: false, message: sourceConfig.message, reason: sourceConfig.reason };
    }

    if (!camera.enabled) {
        return { success: false, message: 'Camera is disabled' };
    }
    if (!camera.enable_recording) {
        return { success: false, message: 'Recording not enabled for this camera' };
    }

    const cameraDir = getCameraRecordingDir(recordingsBasePath, camera.id);
    const pendingDir = getPendingRecordingDir(recordingsBasePath, camera.id);
    mkdirSync(cameraDir, { recursive: true });
    mkdirSync(pendingDir, { recursive: true });

    // A camera that already proved its advertised audio cannot be recorded is spawned
    // video-only, so it does not die the same way every retry. `-map 0:a?` handles cameras
    // with NO audio; this handles the ones that claim audio and never send it.
    const withAudio = shouldSkipRecordingAudio(camera.id) ? false : null;

    const ffmpegArgs = buildRecordingFfmpegArgs({
        cameraDir,
        outputPattern: getPendingRecordingPattern(recordingsBasePath, camera.id),
        inputUrl: sourceConfig.inputUrl,
        streamSource: sourceConfig.streamSource,
        rtspTransport: sourceConfig.rtspTransport,
        withAudio,
    });

    const recordingTimezone = getRecordingProcessTimezone();
    const spawnOptions = {
        env: buildRecordingProcessEnv(process.env, recordingTimezone),
        // detached: put ffmpeg in its OWN process group so a signal aimed at the
        // backend's group (and the backend's own death) never reaches the recorder.
        //
        // This is one of THREE things that all have to hold, or recordings still break
        // on restart — verified the hard way on prod:
        //   1. detached (here)          — survives group-wide signals
        //   2. stderr on a FILE         — recordingProcessManager; a pipe to a dead
        //                                 parent kills ffmpeg on its next write
        //   3. treekill:false in pm2    — deployment/ecosystem.config.cjs; pm2 otherwise
        //                                 walks the process tree by PPID and kills our
        //                                 children regardless of what group they're in
        // Missing #3 alone was enough to change every recorder pid across a restart
        // while 1 and 2 were already in place.
        detached: true,
    };

    return {
        success: true,
        sourceConfig,
        ffmpegArgs,
        spawnOptions,
        cameraDir,
        recordingTimezone,
        stderrLogPath: getFfmpegLogPath(recordingsBasePath, camera.id),
    };
}
