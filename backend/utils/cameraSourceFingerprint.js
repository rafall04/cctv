/**
 * Purpose: Sanitizes and fingerprints camera source values for lifecycle diagnostics.
 * Caller: cameraSourceLifecycleService and camera source lifecycle tests.
 * Deps: Node crypto.
 * MainFuncs: maskRtspUrl, hashSourceValue.
 * SideEffects: None.
 */

import crypto from 'crypto';

export function maskRtspUrl(value) {
    if (!value || typeof value !== 'string') {
        return value;
    }

    return value.replace(/(rtsp:\/\/[^:\s/@]+:)([^@\s]+)(@)/i, '$1***$3');
}

export function hashSourceValue(value) {
    return crypto
        .createHash('sha256')
        .update(String(value ?? ''))
        .digest('hex');
}
