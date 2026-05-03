/*
 * Purpose: Validate pure admin area bulk policy target and payload helpers.
 * Caller: Frontend Vitest suite for AreaManagement bulk policy regressions.
 * Deps: areaBulkPolicy utilities.
 * MainFuncs: getEffectiveTargetFilter, buildBulkPayload.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { buildBulkPayload, getEffectiveTargetFilter } from './areaBulkPolicy';

describe('areaBulkPolicy', () => {
    it('forces external HLS target when proxy, TLS, or origin policy changes', () => {
        expect(getEffectiveTargetFilter({
            operation: 'policy_update',
            targetFilter: 'all',
            external_use_proxy: '1',
            external_tls_mode: 'ignore',
            external_origin_mode: 'ignore',
            external_health_mode: 'ignore',
        })).toBe('external_hls_only');
    });

    it('forces external streams target when only health mode changes', () => {
        expect(getEffectiveTargetFilter({
            operation: 'maintenance',
            targetFilter: 'all',
            external_use_proxy: 'ignore',
            external_tls_mode: 'ignore',
            external_origin_mode: 'ignore',
            external_health_mode: 'passive_first',
        })).toBe('external_streams_only');
    });

    it('builds policy update payload without ignored fields', () => {
        expect(buildBulkPayload({
            operation: 'policy_update',
            delivery_type: 'external_hls',
            external_health_mode: 'ignore',
            external_use_proxy: '0',
            enable_recording: '1',
            enabled: 'ignore',
            external_tls_mode: 'auto',
            external_origin_mode: 'ignore',
            video_codec: 'h264',
            clear_internal_rtsp: true,
        })).toEqual({
            delivery_type: 'external_hls',
            external_use_proxy: 0,
            enable_recording: 1,
            external_tls_mode: 'auto',
            video_codec: 'h264',
        });
    });

    it('builds normalization payload with optional internal RTSP cleanup only', () => {
        expect(buildBulkPayload({
            operation: 'normalization',
            delivery_type: 'external_mjpeg',
            clear_internal_rtsp: true,
        })).toEqual({
            delivery_type: 'external_mjpeg',
            clear_internal_rtsp: true,
        });
    });
});
