// Purpose: Centralize every recording-domain interval, threshold, and batch knob.
// Caller: All recording maintenance/recovery/cleanup services and the recording facade.
// Deps: None.
// MainFuncs: Exports immutable constants (grouped by concern). No functions.
// SideEffects: None; reading process.env is the only side effect, done once at load.

function readPositiveIntEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// === Scheduling intervals ===
export const RECORDING_HEALTH_TICK_INTERVAL_MS = 5 * 1000;
export const RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS = 60 * 1000;
export const RECORDING_SEGMENT_SCAN_INTERVAL_MS = 60 * 1000;
export const RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS = readPositiveIntEnv(
    'RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS',
    5 * 60 * 1000
);
export const RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS = 30 * 1000;
export const RECORDING_BG_CLEANUP_BUILD_INTERVAL_MS = 5 * 60 * 1000;
export const RECORDING_BG_CLEANUP_BUILD_INITIAL_DELAY_MS = 30 * 1000;
export const RECORDING_BG_CLEANUP_PROCESS_INTERVAL_MS = 10 * 1000;

// === Cleanup behavior ===
export const RECORDING_CLEANUP_BATCH_SIZE = 6;
export const RECORDING_TEMP_FILE_MIN_AGE_MS = 5 * 60 * 1000;
export const RECORDING_FINALIZED_PARTIAL_MIN_AGE_MS = 5 * 60 * 1000;
export const RECORDING_CLEANUP_MIN_INTERVAL_MS = 60 * 1000;
export const RECORDING_BG_UNREGISTERED_MIN_AGE_MS = 30 * 60 * 1000;

// === Retention ===
export const RECORDING_RETENTION_GRACE_MS = 10 * 60 * 1000;
export const RECORDING_DEFAULT_RETENTION_HOURS = 5;

// === Recovery / recovery scanner ===
export const RECORDING_RECOVERY_MIN_AGE_MS = 30 * 1000;
export const RECORDING_RECOVERY_DUPLICATE_PARTIAL_MIN_AGE_MS = 5 * 60 * 1000;
export const RECORDING_RECOVERY_MAX_ATTEMPTS = 3;
// Attempts after which a PARTIAL stops being retried — it is kept on disk untouched
// (retention still owns its deletion), it just stops consuming recovery queue slots.
//
// Partials are deliberately never terminal-quarantined, but "never quarantine" had been
// implemented as "retry forever". On 2026-07-28 that turned 1,693 unrecoverable partials
// into a self-replenishing queue: with maxConcurrent=3, newly finished segments sat
// behind them and finalization stopped dead for 2 hours across every camera — which also
// removed them from playback, not just the Telegram archive.
//
// 12 attempts against a 30-minute capped backoff is roughly 6 hours of trying: far beyond
// what a genuinely recoverable file needs, and finite.
export const RECORDING_RECOVERY_PARTIAL_MAX_ATTEMPTS = readPositiveIntEnv(
    'RECORDING_RECOVERY_PARTIAL_MAX_ATTEMPTS',
    12
);
export const RECORDING_RECOVERY_MAX_CONCURRENT = readPositiveIntEnv(
    'RECORDING_RECOVERY_MAX_CONCURRENT',
    3
);
export const RECORDING_RECOVERY_RETRY_BASE_MS = 60 * 1000;
export const RECORDING_RECOVERY_RETRY_CAP_MS = 30 * 60 * 1000;
export const RECORDING_FINALIZER_STABILITY_DELAY_MS = 10 * 1000;

// === Process / restart cooldown ===
export const RECORDING_RETRY_BASE_COOLDOWN_MS = 15 * 1000;
export const RECORDING_RETRY_MAX_COOLDOWN_MS = 5 * 60 * 1000;
export const RECORDING_OFFLINE_COOLDOWN_MS = 60 * 1000;
export const RECORDING_FAILURE_SUSPEND_THRESHOLD = 3;
export const RECORDING_PROCESS_GRACEFUL_STOP_MS = 10 * 1000;

// === Health monitoring ===
export const RECORDING_HEALTH_TIMEOUT_INTERNAL_MS = 30 * 1000;
export const RECORDING_HEALTH_TIMEOUT_TUNNEL_MS = 10 * 1000;
// A (re)started recording only clears its failure counter after it has stayed
// healthy (data flowing) for this long — spawning the process is NOT proof of
// recovery. Must exceed the freeze timeout above so a no-media camera can never
// confirm recovery before its freeze is detected.
export const RECORDING_RECOVERY_CONFIRM_MS = 45 * 1000;
// FFmpeg RTSP socket I/O timeout (microseconds). Makes a recording process EXIT on
// data starvation instead of hanging, so a dead-media camera routes through the
// normal close→markFailure path. Kept below the internal freeze timeout above so
// FFmpeg self-exits before the health monitor has to kill it.
export const RECORDING_RTSP_SOCKET_TIMEOUT_MICROS = 20 * 1000 * 1000;
// Upper bound on the retry backoff for a camera stuck with NO media (frozen). Unlike
// a hard crash, a no-media camera usually recovers on its own (its live counterpart
// streams fine), so we keep retrying briskly instead of backing off to the 5-min
// general cap — recording resumes within ~1 min of the camera returning.
export const RECORDING_NO_MEDIA_MAX_COOLDOWN_MS = 60 * 1000;

// === Emergency disk ===
// Bulk-delete backstop (retention-bypass). Defaults MUST sit ABOVE the archive-hold safety floor
// (5 GB, recordingStorageSettings.js) so this aggressive guard engages BEFORE the normal per-batch
// path is the only thing between 5 GB and empty — with the old 1 GB/2 GB defaults (and prod leaves
// these env vars unset) the guard fired only ~13 min of headroom from a full disk, risking failed
// ffmpeg writes = lost LIVE footage. 8 GB trigger / 12 GB free target matches docs/spek-server.md.
export const RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES = readPositiveIntEnv(
    'RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES',
    8 * 1024 * 1024 * 1024
);
export const RECORDING_EMERGENCY_DISK_TARGET_BYTES = readPositiveIntEnv(
    'RECORDING_EMERGENCY_DISK_TARGET_BYTES',
    12 * 1024 * 1024 * 1024
);
export const RECORDING_EMERGENCY_DISK_BATCH_LIMIT = 200;

// === Assurance ===
export const RECORDING_ASSURANCE_STALE_AFTER_MS = 15 * 60 * 1000;
export const RECORDING_ASSURANCE_GAP_TOLERANCE_S = 180;
export const RECORDING_ASSURANCE_RECENT_WINDOW_HOURS = 24;
