/*
 * Purpose: Shared playback segment selection rules for URL timestamps and fallback playback.
 * Caller: Playback page and focused unit tests.
 * Deps: Browser JavaScript Date parsing only.
 * MainFuncs: findSegmentForTimestamp, findClosestSegmentByStartTime.
 * SideEffects: None.
 */

const toMillis = (value) => {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : null;
};

const toTargetMillis = (timestamp) => {
    const parsed = Number.parseInt(timestamp, 10);
    return Number.isFinite(parsed) ? parsed : null;
};

export const findSegmentForTimestamp = (segments = [], timestamp) => {
    if (!Array.isArray(segments) || segments.length === 0) {
        return null;
    }

    const targetTime = toTargetMillis(timestamp);
    if (targetTime === null) {
        return null;
    }

    return segments.find((segment) => {
        const startTime = toMillis(segment?.start_time);
        const endTime = toMillis(segment?.end_time);
        if (startTime === null || endTime === null) {
            return false;
        }

        return targetTime >= startTime && targetTime <= endTime;
    }) || null;
};

export const findClosestSegmentByStartTime = (segments = [], timestamp) => {
    if (!Array.isArray(segments) || segments.length === 0) {
        return null;
    }

    const targetTime = toTargetMillis(timestamp);
    if (targetTime === null) {
        return segments[0];
    }

    return segments.reduce((previous, current) => {
        const previousStartTime = toMillis(previous?.start_time);
        const currentStartTime = toMillis(current?.start_time);
        const previousDiff = previousStartTime === null ? Number.POSITIVE_INFINITY : Math.abs(previousStartTime - targetTime);
        const currentDiff = currentStartTime === null ? Number.POSITIVE_INFINITY : Math.abs(currentStartTime - targetTime);
        return currentDiff < previousDiff ? current : previous;
    }, segments[0]);
};
