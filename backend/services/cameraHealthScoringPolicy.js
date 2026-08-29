// Purpose: Pure scoring policy for camera health detection — the per-reason failure weights, the
//          offline threshold, the success-decay, and the reasons that are offline on sight.
// Caller: cameraHealthService (applyWeightedScoring / evaluateCameraStatus).
// Deps: none — pure data, no imports, trivially testable.
//
// Extracted from cameraHealthService.js (a frozen giant) so the policy an operator actually cares
// about — "what counts as down, and how fast" — lives in one small file instead of buried in a
// 3k-line service. A camera is marked offline only once its accumulated failure score reaches
// OFFLINE_SCORE_THRESHOLD (then a confirmation probe must also fail); each failed probe adds the
// reason's weight, each success decays or clears it. Unknown reasons get a low default at the call
// site, so anything that MUST reliably flip a camera offline has to be listed here.

export const SCORE_DECAY_ON_SUCCESS = 0.5;
export const OFFLINE_SCORE_THRESHOLD = 3.0;

// Weight for a probe that FAILED (online:false) with a reason not listed below. FAIL-SAFE, and that
// is the whole point: the old default was 0.3, which meant "an unrecognised failure is almost
// ignored" — a camera whose every probe failed with an errno nobody had mapped (EHOSTUNREACH from a
// dead modem) needed ~10 checks to even reach the threshold and stayed green for hours. A status
// customers rely on must fail toward OFFLINE when it does not understand a failure, not toward
// online. 0.7 -> ~5 sustained failures to go offline: serious, but slightly more forgiving than a
// KNOWN-definitive error (1.0 / 3 checks) since we cannot be sure an unknown reason is not transient.
// Genuinely-transient reasons (timeout, DNS) stay explicitly LOW-weighted in FAILURE_WEIGHTS.
export const DEFAULT_FAILURE_WEIGHT = 0.7;

export const FAILURE_WEIGHTS = {
    'ECONNREFUSED':             1.0,
    // "No route to host / network is down" — what a camera behind a DEAD MODEM produces on every
    // RTSP probe. These raw socket errnos pass straight through rtspProbe.js as the reason, and were
    // NOT in this map, so they scored the 0.3 default: ~10 consecutive checks to even reach the
    // offline threshold, reset to 0 on every backend restart, so a genuinely-dead camera stayed green
    // for hours (CCTV GG SOMODIHARJO, modem died ~09:20, still "online" at 11:45). They are at least
    // as definitive as ECONNREFUSED, so they carry the same 1.0 weight — offline in ~3 checks.
    'EHOSTUNREACH':             1.0,
    'ENETUNREACH':              1.0,
    'EHOSTDOWN':                1.0,
    'ENETDOWN':                 1.0,
    'http_404':                 1.0,
    'http_403':                 0.8,
    'tls_verification_failed':  0.8,
    'invalid_rtsp_url':         1.0,
    'rtsp_auth_failed':         1.0,
    'rtsp_stream_not_found':    1.0,
    'missing_external_hls_url': 1.0,
    'master_has_no_variant':    0.7,
    'media_playlist_has_no_segments': 0.6,
    'internal_stream_unreachable': 0.8,
    'stream_ended':             1.0,
    'stale_program_date_time':  0.4,
    'stale_media_sequence':     0.5,
    'snapshot_unreachable':     0.15,
    'mjpeg_invalid_content_type': 0.4,
    'probe_target_mismatch':    0.4,
    'ECONNABORTED':             0.2,  // Timeout
    'ETIMEDOUT':                0.2,
    'ENOTFOUND':                0.15,
    'request_error':            0.3,
};

export const HARD_OFFLINE_REASONS = new Set([
    'missing_external_source_metadata',
    'missing_external_hls_url',
    'missing_external_probe_target',
    'invalid_rtsp_url',
    'rtsp_auth_failed',
    'rtsp_stream_not_found',
    'http_401',
    'http_403',
    'http_404',
    'mjpeg_invalid_content_type',
    'invalid_m3u8',
    'master_has_no_variant',
    'nested_master_without_media',
    'media_playlist_has_no_segments',
]);
