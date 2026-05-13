/*
Purpose: Verify pure Telegram monitoring alert policy for CCTV up/down transition detection.
Caller: Backend focused health/Telegram test gate.
Deps: vitest, cameraMonitoringAlertPolicy.
MainFuncs: describe cameraMonitoringAlertPolicy.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    getMonitoringAlertTransition,
    normalizeMonitoringOnline,
    shouldUseStrictInternalMonitoring,
} from '../services/cameraMonitoringAlertPolicy.js';

describe('cameraMonitoringAlertPolicy', () => {
    it('normalizes online-like monitoring states', () => {
        expect(normalizeMonitoringOnline('online')).toBe(1);
        expect(normalizeMonitoringOnline('passive')).toBe(1);
        expect(normalizeMonitoringOnline('stale')).toBe(1);
        expect(normalizeMonitoringOnline('probe_failed')).toBe(0);
        expect(normalizeMonitoringOnline('offline')).toBe(0);
        expect(normalizeMonitoringOnline('unresolved')).toBe(0);
        expect(normalizeMonitoringOnline(null)).toBeNull();
    });

    it('returns only real online/offline transitions', () => {
        expect(getMonitoringAlertTransition('online', 'offline')).toBe('offline');
        expect(getMonitoringAlertTransition('offline', 'online')).toBe('online');
        expect(getMonitoringAlertTransition('online', 'passive')).toBeNull();
        expect(getMonitoringAlertTransition(null, 'offline')).toBeNull();
        expect(getMonitoringAlertTransition('offline', null)).toBeNull();
    });

    it('does not use strict internal monitoring for default internal HLS cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'default',
            area_internal_ingest_policy_default: 'default',
        })).toBe(false);
    });

    it('uses strict internal monitoring for explicitly always-on internal HLS cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'always_on',
        })).toBe(true);
    });

    it('uses strict internal monitoring for Surabaya private RTSP source profile cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            source_profile: 'surabaya_private_rtsp',
        })).toBe(true);
    });

    it('does not use strict internal monitoring for on-demand or external cameras', () => {
        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10/stream',
            internal_ingest_policy_override: 'on_demand',
        })).toBe(false);

        expect(shouldUseStrictInternalMonitoring({
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.test/live.m3u8',
        })).toBe(false);
    });
});
