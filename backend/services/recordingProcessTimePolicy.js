// Purpose: Standardize FFmpeg recording process timezone so strftime filenames match parser policy.
// Caller: recordingService before spawning FFmpeg through recordingProcessManager.
// Deps: recordingTimePolicy.
// MainFuncs: getRecordingProcessTimezone, buildRecordingProcessEnv.
// SideEffects: Reads configured recording timestamp timezone.

import { getRecordingTimestampTimezone, normalizeRecordingTimezone } from './recordingTimePolicy.js';

export function getRecordingProcessTimezone() {
    return getRecordingTimestampTimezone();
}

export function buildRecordingProcessEnv(baseEnv = process.env, timezone = getRecordingProcessTimezone()) {
    return {
        ...baseEnv,
        TZ: normalizeRecordingTimezone(timezone),
    };
}
