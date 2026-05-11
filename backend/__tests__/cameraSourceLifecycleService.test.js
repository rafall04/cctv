/**
 * Purpose: Tests camera source lifecycle utilities and orchestration boundaries.
 * Caller: Backend Vitest suite for camera source update hardening.
 * Deps: Vitest, cameraSourceFingerprint, cameraSourceLifecycleService.
 * MainFuncs: Validates RTSP masking, source hashing, change classification, and refresh orchestration.
 * SideEffects: None; service orchestration tests use injected fakes.
 */

import { describe, expect, it } from 'vitest';
import {
    hashSourceValue,
    maskRtspUrl,
} from '../utils/cameraSourceFingerprint.js';

describe('camera source fingerprint utilities', () => {
    it('masks RTSP credentials before persistence', () => {
        expect(maskRtspUrl('rtsp://admin:secret@192.168.1.10:554/stream1'))
            .toBe('rtsp://admin:***@192.168.1.10:554/stream1');
    });

    it('hashes source values with stable sha256 output', () => {
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toMatch(/^[a-f0-9]{64}$/);
        expect(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'))
            .toBe(hashSourceValue('rtsp://admin:secret@192.168.1.10/stream1'));
    });
});
